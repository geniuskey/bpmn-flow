import { describe, expect, it } from 'vitest';
import { loadBpmnDocument } from '@/bpmn/document';
import { BpmnImportError } from '@/bpmn/import/parse';
import { newDiagramXml } from '@/bpmn/model/newDiagram';
import { fixture } from '../helpers';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('compatibility assessment', () => {
  it('opens MVP documents as editable', async () => {
    for (const name of [
      'simple-process.bpmn',
      'mvp-elements.bpmn',
      'collaboration-lanes.bpmn',
      'collaboration-messages.bpmn',
    ]) {
      const doc = await loadBpmnDocument(fixture(name));
      expect(doc.report.issues.filter((i) => i.severity !== 'info')).toEqual([]);
      expect(doc.report.mode).toBe('editable');
    }
  });

  it('opens new documents as editable', async () => {
    const doc = await loadBpmnDocument(newDiagramXml('test'));
    expect(doc.report).toEqual({ mode: 'editable', exportAllowed: true, issues: [] });
  });

  it('flags extensions as info only', async () => {
    const doc = await loadBpmnDocument(fixture('extensions.bpmn'));
    expect(doc.report.mode).toBe('editable');
    expect(codes(doc.report.issues)).toEqual(['EXTENSIONS_PRESENT']);
  });

  it('opens unsupported elements read-only but keeps export (lossless)', async () => {
    const doc = await loadBpmnDocument(fixture('unsupported-elements.bpmn'));
    expect(doc.report.mode).toBe('readonly');
    expect(doc.report.exportAllowed).toBe(true);
    const unsupported = doc.report.issues.filter((i) => i.code === 'UNSUPPORTED_ELEMENT');
    // Implicit throw events are not part of the editable set.
    expect(unsupported.map((i) => i.elementType).sort()).toEqual(['bpmn:ImplicitThrowEvent']);
    expect(codes(doc.report.issues)).toContain('PRESERVED_ELEMENT');
  });

  it('opens documents without DI read-only', async () => {
    const doc = await loadBpmnDocument(fixture('no-diagram.bpmn'));
    expect(doc.report.mode).toBe('readonly');
    expect(codes(doc.report.issues)).toContain('NO_DIAGRAM');
  });

  it('rejects malformed XML with a readable error', async () => {
    await expect(loadBpmnDocument(fixture('malformed.bpmn'))).rejects.toBeInstanceOf(
      BpmnImportError,
    );
    await expect(loadBpmnDocument('')).rejects.toThrow('empty');
    await expect(loadBpmnDocument('<html><body/></html>')).rejects.toBeInstanceOf(BpmnImportError);
  });
});

describe('new choreography template', () => {
  it('opens editable', async () => {
    const { newChoreographyXml } = await import('@/bpmn/model/newDiagram');
    const doc = await loadBpmnDocument(newChoreographyXml('t'));
    expect(doc.report).toEqual({ mode: 'editable', exportAllowed: true, issues: [] });
  });
});

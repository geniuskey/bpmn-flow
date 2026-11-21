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

describe('content the parser drops and structurally invalid DI', () => {
  const simple = () => fixture('simple-process.bpmn');
  const readonlyFor = async (xml: string) => {
    const doc = await loadBpmnDocument(xml);
    return {
      mode: doc.report.mode,
      exportAllowed: doc.report.exportAllowed,
      issues: doc.report.issues,
    };
  };

  it('blocks re-export of files with XML comments or processing instructions', async () => {
    const commented = simple().replace(
      '<bpmn:process',
      '<!-- reviewed by ops -->\n  <bpmn:process',
    );
    const withPi = simple().replace('<bpmn:process', '<?my-tool data?>\n  <bpmn:process');
    for (const xml of [commented, withPi]) {
      const r = await readonlyFor(xml);
      expect(r).toMatchObject({ mode: 'readonly', exportAllowed: false });
      expect(codes(r.issues)).toContain('DROPPED_MARKUP');
    }
    // The XML declaration and CDATA content are not dropped markup.
    const cdata = simple().replace(
      '<bpmn:task id="Task_check" name="Check order">',
      '<bpmn:task id="Task_check" name="Check order"><bpmn:documentation><![CDATA[a <!-- b --> <?c?>]]></bpmn:documentation>',
    );
    expect((await readonlyFor(cdata)).mode).toBe('editable');
  });

  it('keeps non-visual declarations and processes on no diagram editable (BPMN MIWG files)', async () => {
    const xml = simple()
      .replace(
        '<bpmn:process id="Process_simple"',
        `<bpmn:import importType="http://www.w3.org/2001/XMLSchema" location="types.xsd" namespace="http://example.com/types" />
  <bpmn:interface id="If_1" name="Orders"><bpmn:operation id="Op_1" name="place" /></bpmn:interface>
  <bpmn:process id="Process_called" isExecutable="false">
    <bpmn:startEvent id="Called_start" />
    <bpmn:task id="Called_task" name="Not drawn anywhere" />
    <bpmn:sequenceFlow id="Called_flow" sourceRef="Called_start" targetRef="Called_task" />
  </bpmn:process>
  <bpmn:process id="Process_simple"`,
      )
      .replace(
        '<bpmndi:BPMNDiagram',
        `<bpmn:relationship type="trace"><bpmn:source>Task_check</bpmn:source><bpmn:target>Called_task</bpmn:target></bpmn:relationship>
  <bpmndi:BPMNDiagram`,
      );
    const doc = await loadBpmnDocument(xml);
    expect(doc.report.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(doc.report).toMatchObject({ mode: 'editable', exportAllowed: true });
    const preserved = doc.report.issues.filter((i) => i.code === 'PRESERVED_ELEMENT');
    expect(preserved.map((i) => i.elementType).sort()).toEqual([
      'bpmn:Import',
      'bpmn:Interface',
      'bpmn:Process',
      'bpmn:Relationship',
    ]);
    expect(preserved.find((i) => i.elementType === 'bpmn:Import')!.message).toContain('types.xsd');
  });

  it('opens a drawn process whose element has no shape read-only', async () => {
    const xml = simple().replace(
      '<bpmn:task id="Task_check"',
      '<bpmn:task id="Undrawn" /><bpmn:task id="Task_check"',
    );
    const r = await readonlyFor(xml);
    expect(r.mode).toBe('readonly');
    expect(codes(r.issues)).toContain('MISSING_DI');
  });

  it('opens a diagram whose plane has no BPMN element read-only', async () => {
    const xml = simple().replace(' bpmnElement="Process_simple"', '');
    const r = await readonlyFor(xml);
    expect(r.mode).toBe('readonly');
    expect(r.issues.map((i) => i.message).join()).toContain('diagram has no BPMN element');
  });

  it('opens edges without waypoints and shapes without bounds read-only', async () => {
    const noWaypoints = simple().replace(
      /(<bpmndi:BPMNEdge id="Flow_a_di" bpmnElement="Flow_a">)[\s\S]*?(<\/bpmndi:BPMNEdge>)/,
      '$1$2',
    );
    expect((await readonlyFor(noWaypoints)).issues.map((i) => i.message).join()).toContain(
      'fewer than 2 waypoints',
    );
    const noBounds = simple().replace(
      /(<bpmndi:BPMNShape id="Task_check_di" bpmnElement="Task_check">)\s*<dc:Bounds[^>]*\/>/,
      '$1',
    );
    const r = await readonlyFor(noBounds);
    expect(r.mode).toBe('readonly');
    expect(r.issues.map((i) => i.message).join()).toContain('shape has no bounds');
  });

  it('opens an edge whose end is drawn only in another diagram read-only', async () => {
    // Move the end event's shape into a second diagram of the same process.
    const endShape = /<bpmndi:BPMNShape id="End_1_di"[\s\S]*?<\/bpmndi:BPMNShape>/.exec(
      simple(),
    )![0];
    const xml = simple()
      .replace(endShape, '')
      .replace(
        '</bpmn:definitions>',
        `<bpmndi:BPMNDiagram id="D2"><bpmndi:BPMNPlane id="P2" bpmnElement="Process_simple">${endShape}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
      );
    const r = await readonlyFor(xml);
    expect(r.mode).toBe('readonly');
    expect(r.issues.map((i) => i.message).join()).toContain(
      'End_1 is not drawn in the same diagram',
    );
  });
});

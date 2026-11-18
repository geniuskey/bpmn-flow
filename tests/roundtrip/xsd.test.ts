/**
 * Validates exported XML against the official OMG BPMN 2.0 schemas with
 * xmllint. Run `npm run schemas` once to download the XSDs; the test is skipped
 * when they or xmllint are missing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exportBpmnXml, loadBpmnDocument } from '@/bpmn/document';
import { newDiagramXml } from '@/bpmn/model/newDiagram';
import { EDITABLE_FIXTURES, fixture } from '../helpers';

const schema = fileURLToPath(new URL('../schema/BPMN20.xsd', import.meta.url));
function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const enabled = existsSync(schema) && hasXmllint();
const dir = enabled ? mkdtempSync(join(tmpdir(), 'bpmn-flow-xsd-')) : '';

function validate(xml: string, name: string): string {
  const file = join(dir, name);
  writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', schema, file], { stdio: 'pipe' });
    return 'valid';
  } catch (err) {
    return String((err as { stderr?: Buffer }).stderr ?? err);
  }
}

describe.skipIf(!enabled)('exported XML conforms to the BPMN 2.0 XSD', () => {
  it.each([...EDITABLE_FIXTURES, 'analysis-issues.bpmn', 'unsupported-elements.bpmn'])(
    '%s',
    async (name) => {
      const doc = await loadBpmnDocument(fixture(name), name);
      expect(validate(await exportBpmnXml(doc), name)).toBe('valid');
    },
  );

  it('new documents', async () => {
    const doc = await loadBpmnDocument(newDiagramXml('xsd'));
    expect(validate(await exportBpmnXml(doc), 'new.bpmn')).toBe('valid');
  });
});

describe.skipIf(!enabled)('new choreography template conforms to the XSD', () => {
  it('is valid', async () => {
    const { newChoreographyXml } = await import('@/bpmn/model/newDiagram');
    const doc = await loadBpmnDocument(newChoreographyXml('xsd'));
    expect(validate(await exportBpmnXml(doc), 'choreo.bpmn')).toBe('valid');
  });
});

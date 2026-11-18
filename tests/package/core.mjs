// Runs in plain Node against the installed package: headless core only.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  analyze,
  createBpmnDocument,
  exportBpmnXml,
  loadBpmnDocument,
  BpmnImportError,
  EDITABLE_FLOW_NODE_TYPES,
} from '@geniuskey/bpmn-flow';

const xml = readFileSync(process.argv[2], 'utf8');
const doc = await loadBpmnDocument(xml, 'sample.bpmn');
assert.equal(doc.report.mode, 'editable');
const result = analyze(doc.definitions);
assert.ok(result.metrics, 'analysis returns metrics');
const out = await exportBpmnXml(doc);
assert.match(out, /<bpmn:definitions/);

const fresh = await createBpmnDocument();
assert.equal(fresh.report.mode, 'editable');
assert.ok(EDITABLE_FLOW_NODE_TYPES.includes('bpmn:Task'));
await assert.rejects(loadBpmnDocument('not xml'), BpmnImportError);
console.log(`core ok: ${result.findings.length} findings, ${out.length} bytes exported`);

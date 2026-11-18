/**
 * Writes BPMN Flow exports (unchanged and edited) to $INTEROP_OUT so that an
 * independent BPMN implementation can read them (see scripts/interop/). Skipped
 * unless INTEROP_OUT is set.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportBpmnXml, loadBpmnDocument } from '@/bpmn/document';
import { getMany, type ModdleElement } from '@/bpmn/model/moddle';
import { EDITABLE_FIXTURES, fixture } from '../helpers';

const out = process.env.INTEROP_OUT;

describe.skipIf(!out)('interop exports', () => {
  it.each(EDITABLE_FIXTURES)('%s', async (name) => {
    mkdirSync(out!, { recursive: true });
    const doc = await loadBpmnDocument(fixture(name), name);
    // An edit through the model API: rename every task.
    for (const p of getMany(doc.definitions, 'rootElements')) {
      for (const el of getMany<ModdleElement>(p, 'flowElements')) {
        if (el.$type === 'bpmn:Task') el.set('name', `${el.name ?? ''} (edited)`);
      }
    }
    const xml = await exportBpmnXml(doc);
    writeFileSync(join(out!, name), xml);
    expect(xml.length).toBeGreaterThan(0);
  });
});

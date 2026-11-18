import { describe, expect, it } from 'vitest';
import { exportBpmnXml, loadBpmnDocument, BpmnExportError } from '@/bpmn/document';
import { snapshotModel } from '@/bpmn/model/snapshot';
import { indexDi, readBounds, translateLabel, writeBounds, writeWaypoints } from '@/bpmn/di/di';
import { EDITABLE_FIXTURES, fixture } from '../helpers';

describe('round-trip: Original → Import → Export → Re-import', () => {
  it.each(EDITABLE_FIXTURES)('%s preserves the model unchanged', async (name) => {
    const doc = await loadBpmnDocument(fixture(name), name);
    expect(doc.report.mode).toBe('editable');
    expect(doc.report.exportAllowed).toBe(true);

    const before = snapshotModel(doc.definitions);
    const xml = await exportBpmnXml(doc);
    const reimported = await loadBpmnDocument(xml, name);

    expect(snapshotModel(reimported.definitions)).toEqual(before);
    expect(reimported.report.mode).toBe('editable');
  });
});

describe('round-trip: Original → Import → Edit → Export → Re-import', () => {
  it.each(EDITABLE_FIXTURES)('%s keeps edits and everything else', async (name) => {
    const doc = await loadBpmnDocument(fixture(name), name);
    const di = indexDi(doc.definitions);
    const expected = snapshotModel(doc.definitions);

    // Edit 1: rename the first task-like element.
    const [taskId, taskShape] = [...di.shapes.entries()].find(
      ([, s]) => (readBounds(s)?.width ?? 0) === 100,
    )!;
    const task = doc.definitions.$parent ?? null; // definitions has no parent
    expect(task).toBeNull();
    const taskEl = taskShape.get('bpmnElement') as { set(k: string, v: unknown): void };
    taskEl.set('name', 'Renamed ✓ & <escaped>');
    expected.elements[taskId]!.name = 'Renamed ✓ & <escaped>';

    // Edit 2: move the first shape that has a label by (+40, +25), label follows.
    const [movedId, movedShape] =
      [...di.shapes.entries()].find(([id]) => expected.shapes[id]!.label) ??
      [...di.shapes.entries()][0]!;
    const b = readBounds(movedShape)!;
    writeBounds(doc.moddle, movedShape, { ...b, x: b.x + 40, y: b.y + 25 });
    translateLabel(movedShape, 40, 25);
    const snapShape = expected.shapes[movedId]!;
    snapShape.bounds = { ...b, x: b.x + 40, y: b.y + 25 };
    if (snapShape.label)
      snapShape.label = {
        ...snapShape.label,
        x: snapShape.label.x + 40,
        y: snapShape.label.y + 25,
      };

    // Edit 3: re-route the first edge with an extra bend point.
    const [edgeId, edge] = [...di.edges.entries()][0]!;
    const wps = expected.edges[edgeId]!.waypoints;
    const routed = [wps[0]!, { x: wps[0]!.x, y: wps[0]!.y + 0.5 }, wps[wps.length - 1]!];
    writeWaypoints(doc.moddle, edge, routed);
    expected.edges[edgeId]!.waypoints = routed;

    const xml = await exportBpmnXml(doc);
    const reimported = await loadBpmnDocument(xml, name);
    expect(snapshotModel(reimported.definitions)).toEqual(expected);
  });
});

describe('extension preservation', () => {
  it('keeps vendor attributes, extension elements, CDATA and namespaces', async () => {
    const doc = await loadBpmnDocument(fixture('extensions.bpmn'));
    const xml = await exportBpmnXml(doc);
    expect(xml).toContain('xmlns:acme="http://example.com/schema/acme"');
    expect(xml).toContain('xmlns:vendor="http://example.com/schema/vendor"');
    expect(xml).toContain('vendor:retries="3"');
    expect(xml).toContain('acme:color="#ff0000"');
    expect(xml).toContain('acme:schemaVersion="3"');
    const snap = snapshotModel((await loadBpmnDocument(xml)).definitions);
    expect(snap.elements.Call_api!.attrs).toEqual({
      'vendor:type': 'http-connector',
      'vendor:retries': '3',
    });
    expect(JSON.stringify(snap.elements.Call_api!.extensions)).toContain(
      'Uses <internal> gateway & retries',
    );
    expect(snap.elements.E1!.attrs).toEqual({ 'acme:weight': '0.7' });
  });
});

describe('lossy documents', () => {
  it('blocks re-export when the parser dropped content', async () => {
    const doc = await loadBpmnDocument(fixture('lossy-unknown-content.bpmn'));
    expect(doc.report.mode).toBe('readonly');
    expect(doc.report.exportAllowed).toBe(false);
    expect(doc.report.issues.filter((i) => i.code === 'PARSE_WARNING')).toHaveLength(2);
    await expect(exportBpmnXml(doc)).rejects.toBeInstanceOf(BpmnExportError);
    // The original text is still available for download.
    expect(doc.originalXml).toContain('acme:customStep');
  });
});

import { describe, expect, it } from 'vitest';
import { loadBpmnDocument } from '@/bpmn/document';
import { indexDi, readBounds, readLabelBounds, readWaypoints } from '@/bpmn/di/di';
import { getRef, type ModdleElement } from '@/bpmn/model/moddle';
import { syncElement } from '@/editor/commands/DiSync';
import { canMoveShape } from '@/editor/interaction/BpmnFlowRules';
import {
  arrowHeadPath,
  circlePath,
  diamondPath,
  polylineMid,
  rectPath,
} from '@/editor/renderer/geometry';
import { visualFor } from '@/editor/renderer/visuals';
import { fixture } from '../helpers';

async function load(name: string) {
  const doc = await loadBpmnDocument(fixture(name));
  return { doc, di: indexDi(doc.definitions) };
}

function bo(di: ReturnType<typeof indexDi>, id: string): ModdleElement {
  return getRef(di.shapes.get(id) ?? di.edges.get(id), 'bpmnElement')!;
}

describe('geometry', () => {
  it('builds closed outline paths', () => {
    const b = { x: 0, y: 0, width: 36, height: 36 };
    expect(circlePath(b)).toMatch(/^M18,0a18,18.*z$/);
    expect(diamondPath({ x: 0, y: 0, width: 50, height: 50 })).toBe('M25,0L50,25L25,50L0,25z');
    expect(rectPath({ x: 1, y: 2, width: 3, height: 4 })).toBe('M1,2h3v4h-3z');
  });

  it('places arrow heads on the last segment and finds midpoints', () => {
    expect(
      arrowHeadPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe('M100,0L90,4.5L90,-4.5z');
    expect(
      polylineMid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toEqual({ x: 100, y: 0 });
  });
});

describe('visual mapping', () => {
  it('maps supported and unsupported elements', async () => {
    const { di } = await load('unsupported-elements.bpmn');
    expect(visualFor(bo(di, 'End_unsup'), false).kind).toBe('event');
    // Implicit throw events are outside the editable set and drawn as placeholders.
    expect(visualFor(bo(di, 'Start_msg'), false).kind).toBe('event');
    expect(visualFor(bo(di, 'Implicit_1'), false)).toMatchObject({
      kind: 'unsupportedShape',
      outline: 'circle',
      caption: 'Implicit Throw Event',
    });
  });
});

describe('DI sync', () => {
  it('writes shape bounds and moves the label by the same delta', async () => {
    const { doc, di } = await load('simple-process.bpmn');
    const diShape = di.shapes.get('Start_1')!;
    const shape = {
      id: 'Start_1',
      parent: {},
      di: diShape,
      businessObject: bo(di, 'Start_1'),
      x: 172,
      y: 92,
      width: 36,
      height: 36,
    };
    syncElement(doc.moddle, shape as never);
    expect(readBounds(diShape)).toEqual({ x: 172, y: 92, width: 36, height: 36 });
    expect(readLabelBounds(diShape)).toEqual({ x: 153, y: 135, width: 74, height: 14 });
  });

  it('writes connection waypoints and leaves unchanged ones alone', async () => {
    const { doc, di } = await load('simple-process.bpmn');
    const edge = di.edges.get('Flow_a')!;
    const original = edge.get('waypoint');
    syncElement(doc.moddle, {
      id: 'Flow_a',
      parent: {},
      di: edge,
      waypoints: readWaypoints(edge),
    } as never);
    expect(edge.get('waypoint')).toBe(original);
    const next = [
      { x: 188, y: 120 },
      { x: 214, y: 120 },
      { x: 214, y: 140 },
      { x: 240, y: 140 },
    ];
    syncElement(doc.moddle, { id: 'Flow_a', parent: {}, di: edge, waypoints: next } as never);
    expect(readWaypoints(edge)).toEqual(next);
  });
});

describe('move rules', () => {
  it('keeps nodes inside their pool; lanes may change (membership follows)', async () => {
    const { di } = await load('collaboration-lanes.bpmn');
    const shapeOf = (id: string) => ({
      id,
      businessObject: bo(di, id),
      di: di.shapes.get(id),
      ...readBounds(di.shapes.get(id)),
    });
    const root = { id: '__root', children: [] as unknown[] };
    const pool = { ...shapeOf('Pool_support'), parent: root, children: [] as unknown[] };
    root.children.push(pool);
    const lanes = ['Lane_agent', 'Lane_expert'].map((id) => ({ ...shapeOf(id), parent: pool }));
    const triage = { ...shapeOf('Triage'), parent: pool };
    pool.children.push(...lanes, triage);

    expect(canMoveShape(triage as never, { x: 40, y: 0 })).toBe(true);
    expect(canMoveShape(triage as never, { x: 0, y: 150 })).toBe(true); // into the Expert lane
    expect(canMoveShape(triage as never, { x: 400, y: 0 })).toBe(false); // out of the pool
    expect(canMoveShape(triage as never, { x: 0, y: -100 })).toBe(false); // above the pool
    expect(canMoveShape(pool as never, { x: 10, y: 0 })).toBe(true); // pools move with their content
  });
});

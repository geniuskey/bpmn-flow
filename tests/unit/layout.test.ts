// @vitest-environment jsdom
/**
 * Auto layout on real diagrams: nothing overlaps, no flow runs through a
 * shape, lanes / pools hold their nodes, the main path is straight, and undo
 * restores the file exactly.
 */
import { describe, expect, it } from 'vitest';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { loadBpmnDocument } from '@/bpmn/document';
import { getMany, is } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { bo, isConnection } from '@/editor/model';
import { layoutDiagram, orderPools } from '@/editor/layout/engine';
import type { LDiagram } from '@/editor/layout/graph';
import { readFileSync } from 'node:fs';
import { EDITABLE_FIXTURES } from '../helpers';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');

type Box = { x: number; y: number; width: number; height: number };

async function open(xml: string) {
  const doc = await loadBpmnDocument(xml);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  return controller;
}

const inset = (b: Box, d: number): Box => ({
  x: b.x + d,
  y: b.y + d,
  width: b.width - 2 * d,
  height: b.height - 2 * d,
});
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, outer: Box) =>
  a.x >= outer.x - 0.5 &&
  a.y >= outer.y - 0.5 &&
  a.x + a.width <= outer.x + outer.width + 0.5 &&
  a.y + a.height <= outer.y + outer.height + 0.5;

function segmentHits(p: { x: number; y: number }, q: { x: number; y: number }, b: Box): boolean {
  const box = inset(b, 2);
  if (box.width <= 0 || box.height <= 0) return false;
  const seg = {
    x: Math.min(p.x, q.x),
    y: Math.min(p.y, q.y),
    width: Math.abs(p.x - q.x) || 0.01,
    height: Math.abs(p.y - q.y) || 0.01,
  };
  return overlaps(seg, box);
}

function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.parent; p; p = p.parent) out.push(p);
  return out;
}

/** Shapes the layout arranges, on the shown diagram. */
function shown(controller: EditorController): Element[] {
  const root = (controller as unknown as { get(n: string): { getRootElement(): Element } })
    .get('canvas')
    .getRootElement();
  return controller.getElements().filter((e) => e === root || ancestors(e).includes(root));
}

function placedShapes(controller: EditorController): Shape[] {
  return shown(controller).filter(
    (e) =>
      !isConnection(e) &&
      e.parent &&
      (is(bo(e), 'bpmn:FlowNode') ||
        /^bpmn:(DataObjectReference|DataStoreReference|TextAnnotation)$/.test(bo(e)?.$type ?? '')),
  ) as Shape[];
}

function problems(controller: EditorController): string[] {
  const out: string[] = [];
  const shapes = placedShapes(controller);
  const related = (a: Shape, b: Shape) =>
    a.host === b ||
    b.host === a ||
    (a.host && a.host === b.host) ||
    ancestors(a).includes(b) ||
    ancestors(b).includes(a);
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const [a, b] = [shapes[i]!, shapes[j]!];
      if (related(a, b)) continue;
      if (overlaps(inset(a, 1), inset(b, 1))) out.push(`overlap ${a.id} / ${b.id}`);
    }
  }
  const flows = shown(controller).filter(
    (e) => isConnection(e) && is(bo(e), 'bpmn:SequenceFlow'),
  ) as Connection[];
  for (const c of flows) {
    const ends = [c.source, c.target] as Shape[];
    for (const s of shapes) {
      if (ends.includes(s) || ends.some((e) => e.host === s || s.host === e)) continue;
      if (ends.some((e) => ancestors(e).includes(s))) continue;
      if (s.host && ends.includes(s.host as Shape)) continue;
      const pts = c.waypoints;
      for (let k = 1; k < pts.length; k++) {
        if (segmentHits(pts[k - 1]!, pts[k]!, s)) {
          out.push(`flow ${c.id} crosses ${s.id}`);
          break;
        }
      }
    }
  }
  // Lanes hold their nodes.
  for (const lane of shown(controller).filter((e) => is(bo(e), 'bpmn:Lane')) as Shape[]) {
    const refs = getMany(bo(lane), 'flowNodeRef');
    for (const s of shapes) {
      if (s.host || !refs.includes(bo(s)!)) continue;
      if (!inside(s, lane)) out.push(`${s.id} outside lane ${lane.id}`);
    }
  }
  return out;
}

describe('auto layout on the sample diagrams', () => {
  it.each(EDITABLE_FIXTURES)(
    '%s: no overlaps, no flow through a shape, undo restores',
    async (name) => {
      const controller = await open(fixture(name));
      const before = await controller.exportXml();
      const applied = await controller.autoLayout();
      if (!applied) return; // e.g. conversation diagrams
      expect(problems(controller)).toEqual([]);
      controller.undo();
      expect(await controller.exportXml()).toBe(before);
      controller.redo();
      expect(problems(controller)).toEqual([]);
    },
  );

  it.each(EDITABLE_FIXTURES)('%s: compact and top → bottom also stay clean', async (name) => {
    for (const options of [{ density: 'compact' as const }, { direction: 'TB' as const }]) {
      const controller = await open(fixture(name));
      if (!(await controller.autoLayout(options))) return;
      expect(problems(controller), JSON.stringify(options)).toEqual([]);
    }
  });
});

describe('lay out the selection', () => {
  const box = (s: Shape) => ({ x: s.x, y: s.y, width: s.width, height: s.height });

  it('arranges only the selected shapes, one undo step, the rest stays', async () => {
    const controller = await open(fixture('mvp-elements.bpmn'));
    const get = (id: string) => controller.getElement(id) as Shape;
    // Scramble the parallel block, then lay out just that block.
    controller.select(['Notify']);
    controller.nudge(0, 140);
    const before = await controller.exportXml();
    const outside = ['Start', 'Review', 'Paid', 'Rejected'].map((id) => box(get(id)));
    controller.select(['Split', 'Pay', 'Notify', 'Join']);
    expect(controller.canLayoutSelection()).toBe(true);
    expect(await controller.layoutSelection()).toBeNull();
    expect(['Start', 'Review', 'Paid', 'Rejected'].map((id) => box(get(id)))).toEqual(outside);
    const mid = (s: Shape) => s.y + s.height / 2;
    expect(mid(get('Split'))).toBe(mid(get('Join')));
    expect(get('Notify').y).toBeGreaterThan(get('Pay').y + get('Pay').height);
    expect(problems(controller)).toEqual([]);
    controller.undo();
    expect(await controller.exportXml()).toBe(before);
  });

  it('explains why a selection across lanes or with one shape cannot be laid out', async () => {
    const controller = await open(fixture('collaboration-lanes.bpmn'));
    controller.select(['Triage', 'Solve']);
    expect(await controller.layoutSelection()).toMatch(/several lanes/);
    controller.select(['Triage']);
    expect(controller.canLayoutSelection()).toBe(false);
    expect(await controller.layoutSelection()).toMatch(/two or more/);
    controller.select(['Start_ticket', 'Triage']);
    expect(await controller.layoutSelection()).toBeNull();
    const lane = controller.getElement('Lane_agent') as Shape;
    for (const id of ['Start_ticket', 'Triage']) {
      const s = controller.getElement(id) as Shape;
      expect(s.y).toBeGreaterThanOrEqual(lane.y);
      expect(s.y + s.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
  });
});

describe('layout engine', () => {
  const task = (id: string, lane?: string) => ({
    id,
    kind: 'activity' as const,
    width: 100,
    height: 80,
    ...(lane ? { lane } : {}),
  });
  const event = (id: string) => ({ id, kind: 'event' as const, width: 36, height: 36 });
  const gw = (id: string) => ({ id, kind: 'gateway' as const, width: 50, height: 50 });
  const flow = (id: string, source: string, target: string) => ({ id, source, target });
  const diagram = (c: Partial<LDiagram['containers'][number]>): LDiagram => ({
    containers: [{ lanes: [], nodes: [], edges: [], artifacts: [], ...c }],
    messages: [],
    groups: [],
    origin: { x: 0, y: 0 },
  });
  const cy = (b: Box) => b.y + b.height / 2;

  it('keeps the main path on one line and branches below it', () => {
    const r = layoutDiagram(
      diagram({
        nodes: [
          event('S'),
          gw('G'),
          task('A'),
          task('B1'),
          task('B2'),
          task('C'),
          gw('J'),
          event('E'),
        ],
        edges: [
          flow('f1', 'S', 'G'),
          flow('f2', 'G', 'A'),
          flow('f3', 'G', 'B1'),
          flow('f4', 'B1', 'B2'),
          flow('f5', 'B2', 'J'),
          flow('f6', 'A', 'J'),
          flow('f7', 'J', 'C'),
          flow('f8', 'C', 'E'),
        ],
      }),
    );
    const main = ['S', 'G', 'B1', 'B2', 'J', 'C', 'E'].map((id) => cy(r.shapes[id]!));
    expect(new Set(main).size).toBe(1);
    expect(cy(r.shapes.A!)).toBeGreaterThan(main[0]!);
    // Every flow is orthogonal.
    for (const pts of Object.values(r.connections))
      for (let k = 1; k < pts.length; k++)
        expect(pts[k - 1]!.x === pts[k]!.x || pts[k - 1]!.y === pts[k]!.y).toBe(true);
  });

  it('places exception paths below their host and loops on a free track', () => {
    const r = layoutDiagram(
      diagram({
        nodes: [
          event('S'),
          { ...task('A'), boundary: [{ id: 'B', width: 36, height: 36, order: 0 }] },
          task('X'),
          gw('G'),
          event('E'),
        ],
        edges: [
          flow('f1', 'S', 'A'),
          flow('f2', 'A', 'G'),
          flow('f3', 'G', 'E'),
          flow('loop', 'G', 'A'),
          { id: 'exc', source: 'A', target: 'X', from: 'B' },
        ],
      }),
    );
    const a = r.shapes.A!;
    const b = r.shapes.B!;
    expect(cy(b)).toBe(a.y + a.height); // on the bottom edge
    expect(r.shapes.X!.y).toBeGreaterThan(a.y + a.height);
    // Below is taken by the exception path: the loop runs above instead.
    const loop = r.connections.loop!;
    expect(Math.min(...loop.map((p) => p.y))).toBeLessThan(a.y);
  });

  it('runs a loop below when nothing is in the way, above when the rows below are taken', () => {
    const base = {
      nodes: [event('S'), task('A'), task('B'), gw('G'), event('E')],
      edges: [
        flow('f1', 'S', 'A'),
        flow('f2', 'A', 'B'),
        flow('f3', 'B', 'G'),
        flow('f4', 'G', 'E'),
        flow('loop', 'G', 'A'),
      ],
    };
    const free = layoutDiagram(diagram(base));
    const a = free.shapes.A!;
    expect(Math.max(...free.connections.loop!.map((p) => p.y))).toBeGreaterThan(a.y + a.height);
    // Two branches below A..G: going below would span three rows.
    const busy = layoutDiagram(
      diagram({
        nodes: [...base.nodes, task('X'), task('Y'), gw('S2')],
        edges: [
          ...base.edges.filter((e) => e.id !== 'f1'),
          flow('s1', 'S', 'S2'),
          flow('s2', 'S2', 'A'),
          flow('s3', 'S2', 'X'),
          flow('s4', 'S2', 'Y'),
          flow('s5', 'X', 'G'),
          flow('s6', 'Y', 'G'),
        ],
      }),
    );
    const a2 = busy.shapes.A!;
    expect(Math.min(...busy.connections.loop!.map((p) => p.y))).toBeLessThan(a2.y);
  });

  it('keeps nodes in their lanes and lines up layers across lanes', () => {
    const r = layoutDiagram(
      diagram({
        id: 'P',
        lanes: [
          { id: 'L1', children: [] },
          { id: 'L2', children: [] },
        ],
        nodes: [task('A', 'L1'), task('B', 'L2'), task('C', 'L1')],
        edges: [flow('f1', 'A', 'B'), flow('f2', 'B', 'C')],
      }),
    );
    for (const [id, lane] of [
      ['A', 'L1'],
      ['B', 'L2'],
      ['C', 'L1'],
    ] as const)
      expect(inside(r.shapes[id]!, r.shapes[lane]!)).toBe(true);
    expect(r.shapes.B!.x).toBeGreaterThan(r.shapes.A!.x);
    expect(r.shapes.C!.x).toBeGreaterThan(r.shapes.B!.x);
    expect(inside(r.shapes.L1!, r.shapes.P!)).toBe(true);
  });

  it('runs top → bottom', () => {
    const r = layoutDiagram(
      diagram({
        nodes: [event('S'), task('A'), event('E')],
        edges: [flow('f1', 'S', 'A'), flow('f2', 'A', 'E')],
      }),
      { direction: 'TB' },
    );
    expect(r.shapes.A!.y).toBeGreaterThan(r.shapes.S!.y);
    expect(r.shapes.E!.y).toBeGreaterThan(r.shapes.A!.y);
    const cx = (b: Box) => b.x + b.width / 2;
    expect(cx(r.shapes.S!)).toBe(cx(r.shapes.A!));
  });

  it('lays out 1000 tasks with branches quickly', () => {
    const nodes: LDiagram['containers'][number]['nodes'] = [event('S')];
    const edges: { id: string; source: string; target: string }[] = [];
    let prev = 'S';
    for (let i = 0; i < 250; i++) {
      nodes.push(gw(`G${i}`), task(`A${i}`), task(`B${i}`), gw(`J${i}`));
      edges.push(
        flow(`e${i}a`, prev, `G${i}`),
        flow(`e${i}b`, `G${i}`, `A${i}`),
        flow(`e${i}c`, `G${i}`, `B${i}`),
        flow(`e${i}d`, `A${i}`, `J${i}`),
        flow(`e${i}e`, `B${i}`, `J${i}`),
      );
      prev = `J${i}`;
    }
    const t0 = performance.now();
    const r = layoutDiagram(diagram({ nodes, edges }));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(Object.keys(r.shapes)).toHaveLength(nodes.length);
  });

  it('reorders pools so message flows do not cross a pool, unless told not to', () => {
    const pool = (id: string, node: string) => ({
      id,
      lanes: [],
      nodes: [task(node)],
      edges: [],
      artifacts: [],
    });
    const containers = [pool('P1', 'A'), pool('P2', 'B'), pool('P3', 'C')];
    const messages = [flow('m1', 'A', 'C'), flow('m2', 'C', 'A'), flow('m3', 'B', 'C')];
    const order = orderPools(containers, messages).map((c) => c.id);
    expect(order).not.toEqual(['P1', 'P2', 'P3']);
    expect(Math.abs(order.indexOf('P1') - order.indexOf('P3'))).toBe(1);
    // Already good: kept.
    const good = [containers[0]!, containers[2]!, containers[1]!];
    expect(orderPools(good, messages)).toEqual(good);

    const d: LDiagram = { containers, messages, groups: [], origin: { x: 0, y: 0 } };
    const r = layoutDiagram(d);
    const p2 = r.shapes.P2!;
    for (const id of ['m1', 'm2']) {
      const pts = r.connections[id]!;
      const ys = pts.map((p) => p.y);
      const crosses = Math.min(...ys) < p2.y && Math.max(...ys) > p2.y + p2.height;
      expect(crosses, id).toBe(false);
    }
    const kept = layoutDiagram(d, { reorderPools: false });
    expect(kept.shapes.P2!.y).toBeGreaterThan(kept.shapes.P1!.y);
    expect(kept.shapes.P3!.y).toBeGreaterThan(kept.shapes.P2!.y);
  });
});

describe('nested shapes', () => {
  const box = (s: Shape): Box => ({ x: s.x, y: s.y, width: s.width, height: s.height });
  /** Each listed shape lies inside its holder; shapes of one level do not overlap. */
  function nestingProblems(controller: EditorController, holderOf: Record<string, string>) {
    const out: string[] = [];
    const get = (id: string) => controller.getElement(id) as Shape;
    for (const [id, holder] of Object.entries(holderOf))
      if (!inside(box(get(id)), box(get(holder)))) out.push(`${id} outside ${holder}`);
    const levels = new Map<string, string[]>();
    for (const [id, holder] of Object.entries(holderOf))
      levels.set(holder, [...(levels.get(holder) ?? []), id]);
    for (const ids of levels.values())
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          if (overlaps(inset(box(get(ids[i]!)), 1), inset(box(get(ids[j]!)), 1)))
            out.push(`overlap ${ids[i]} / ${ids[j]}`);
    return out;
  }

  it('keeps sub-processes in sub-processes, in lanes, both directions', async () => {
    const holderOf = {
      OS: 'Outer',
      OT1: 'Outer',
      Inner: 'Outer',
      OT2: 'Outer',
      OE: 'Outer',
      IS: 'Inner',
      IT1: 'Inner',
      IG: 'Inner',
      IT2: 'Inner',
      IT3: 'Inner',
      IE: 'Inner',
    };
    for (const direction of ['LR', 'TB'] as const) {
      const controller = await open(fixture('nested-layers.bpmn'));
      expect(await controller.autoLayout({ direction })).toBeTruthy();
      expect(nestingProblems(controller, holderOf), direction).toEqual([]);
      expect(problems(controller), direction).toEqual([]);
    }
  });

  it('keeps shapes drawn inside an activity inside it, to any depth', async () => {
    // Siblings in the model, nested on the canvas: Phase ⊃ A, Inner, C; Inner ⊃ B1, B2.
    const holderOf = { A: 'Phase', Inner: 'Phase', C: 'Phase', B1: 'Inner', B2: 'Inner' };
    for (const direction of ['LR', 'TB'] as const) {
      const controller = await open(fixture('drawn-inside.bpmn'));
      const before = await controller.exportXml();
      expect(await controller.autoLayout({ direction })).toBeTruthy();
      expect(nestingProblems(controller, holderOf), direction).toEqual([]);
      for (const id of ['S', 'Z', 'E']) {
        const s = controller.getElement(id) as Shape;
        const phase = controller.getElement('Phase') as Shape;
        expect(overlaps(box(s), box(phase)), id).toBe(false);
      }
      controller.undo();
      expect(await controller.exportXml()).toBe(before);
    }
  });

  it('moves what is drawn inside a selected activity with it', async () => {
    const controller = await open(fixture('drawn-inside.bpmn'));
    controller.select(['S', 'Phase', 'Z']);
    expect(await controller.layoutSelection()).toBeNull();
    expect(
      nestingProblems(controller, {
        A: 'Phase',
        Inner: 'Phase',
        C: 'Phase',
        B1: 'Inner',
        B2: 'Inner',
      }),
    ).toEqual([]);
  });
});

describe('line styles', () => {
  const flows = (controller: EditorController) =>
    controller
      .getElements()
      .filter(
        (e) => isConnection(e) && /^bpmn:(SequenceFlow|MessageFlow)$/.test(bo(e)?.$type ?? ''),
      ) as Connection[];
  const drawn = (controller: EditorController, c: Connection) => {
    const registry = (
      controller as unknown as { get(n: string): { getGraphics(e: Element): SVGElement } }
    ).get('elementRegistry');
    return registry.getGraphics(c).querySelector('path.bf-connection')!.getAttribute('d')!;
  };
  const rightAngled = (c: Connection) =>
    c.waypoints.every(
      (p, i) => !i || p.x === c.waypoints[i - 1]!.x || p.y === c.waypoints[i - 1]!.y,
    );

  it('straight: flows run shape to shape, stay straight when shapes move, one undo step', async () => {
    const controller = await open(fixture('collaboration-messages.bpmn'));
    const before = await controller.exportXml();
    expect(await controller.autoLayout({ lineStyle: 'straight' })).toBe(true);
    expect(controller.getLineStyle()).toBe('straight');
    const all = flows(controller);
    expect(all.length).toBeGreaterThan(3);
    for (const c of all) expect(c.waypoints, c.id).toHaveLength(2);
    // A diagonal somewhere: not just right angles that happen to be straight.
    expect(all.some((c) => !rightAngled(c))).toBe(true);
    const task = all.find((c) => is(bo(c), 'bpmn:SequenceFlow'))!.target as Shape;
    controller.select([task.id]);
    controller.nudge(0, 40);
    for (const c of [...task.incoming, ...task.outgoing] as Connection[])
      expect(c.waypoints, c.id).toHaveLength(2);
    controller.undo();
    controller.undo();
    expect(await controller.exportXml()).toBe(before);
  });

  it('rounded and curved: right-angle routes in the file, drawn with curves', async () => {
    for (const lineStyle of ['rounded', 'curved'] as const) {
      const controller = await open(fixture('mvp-elements.bpmn'));
      expect(await controller.autoLayout({ lineStyle })).toBe(true);
      const all = flows(controller);
      for (const c of all) expect(rightAngled(c), c.id).toBe(true);
      const bent = all.filter((c) => c.waypoints.length > 2);
      expect(bent.length).toBeGreaterThan(0);
      for (const c of bent) expect(drawn(controller, c), c.id).toContain('Q');
      const xml = await controller.exportXml();
      controller.setLineStyle('orthogonal');
      for (const c of bent) expect(drawn(controller, c), c.id).not.toContain('Q');
      // Only drawn differently: the file does not change.
      expect(await controller.exportXml()).toBe(xml);
    }
  });
});

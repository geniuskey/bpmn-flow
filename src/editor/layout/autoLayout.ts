/**
 * Automatic layout with ELK (layered, left → right).
 *
 * Input is a plain description of the diagram so this module stays independent
 * of diagram-js. Lanes are kept as horizontal bands: ELK decides the order of
 * steps (layers) and their vertical order; each node is then placed in its
 * lane's band, and lane/pool sizes are recomputed to fit.
 */
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { Box, LayoutResult } from './ApplyLayoutHandler';
import type { ElkWorkerSource } from '../types';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  /** Lane id for nodes inside a pool with lanes. */
  lane?: string;
}

export interface LayoutContainer {
  /** Pool id, or undefined for a process diagram without pools. */
  id?: string;
  /** Lanes in top-to-bottom order. */
  lanes: string[];
  nodes: LayoutNode[];
  edges: { source: string; target: string }[];
  /** Current bounds, used to keep the container's position. */
  bounds?: Box;
}

export const LAYOUT = {
  nodeSpacing: 40,
  layerSpacing: 70,
  poolBand: 30,
  padding: 40,
  laneMinHeight: 125,
  poolGap: 50,
  origin: { x: 150, y: 80 },
};

async function runElk(
  elk: ELK,
  container: LayoutContainer,
): Promise<Map<string, { x: number; y: number }>> {
  const ids = new Set(container.nodes.map((n) => n.id));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(LAYOUT.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYOUT.layerSpacing),
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.separateConnectedComponents': 'false',
    },
    children: container.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: container.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  };
  const result = await elk.layout(graph);
  const out = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? [])
    out.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  return out;
}

/** Lays out one container; positions are relative to (0, 0) of its content area. */
async function layoutContainer(
  elk: ELK,
  container: LayoutContainer,
): Promise<{ shapes: Record<string, Box>; width: number; height: number; laneHeights: number[] }> {
  const positions = await runElk(elk, container);
  const shapes: Record<string, Box> = {};

  if (!container.lanes.length) {
    let width = 0;
    let height = 0;
    for (const n of container.nodes) {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      shapes[n.id] = { x: Math.round(p.x), y: Math.round(p.y), width: n.width, height: n.height };
      width = Math.max(width, p.x + n.width);
      height = Math.max(height, p.y + n.height);
    }
    return { shapes, width, height, laneHeights: [] };
  }

  // Columns: ELK x positions define the step order; reuse them as column x.
  // Rows: within a lane, nodes in the same column are stacked in ELK's y order.
  const laneIndex = new Map(container.lanes.map((l, i) => [l, i]));
  const rowsByLane = container.lanes.map(() => new Map<number, LayoutNode[]>());
  for (const n of container.nodes) {
    const lane = laneIndex.get(n.lane ?? '') ?? 0;
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    const colKey = Math.round(p.x);
    const col = rowsByLane[lane]!.get(colKey) ?? [];
    col.push(n);
    rowsByLane[lane]!.set(colKey, col);
  }
  const ROW = 110;
  const laneHeights = rowsByLane.map((cols) => {
    const maxStack = Math.max(1, ...[...cols.values()].map((c) => c.length));
    return Math.max(LAYOUT.laneMinHeight, maxStack * ROW + 20);
  });
  let laneTop = 0;
  let width = 0;
  rowsByLane.forEach((cols, laneI) => {
    const laneHeight = laneHeights[laneI]!;
    for (const [colX, col] of cols) {
      col.sort((a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0));
      const stackHeight = col.length * ROW;
      col.forEach((n, i) => {
        const cy = laneTop + (laneHeight - stackHeight) / 2 + i * ROW + ROW / 2;
        shapes[n.id] = {
          x: colX,
          y: Math.round(cy - n.height / 2),
          width: n.width,
          height: n.height,
        };
        width = Math.max(width, colX + n.width);
      });
    }
    laneTop += laneHeight;
  });
  return { shapes, width, height: laneTop, laneHeights };
}

export async function computeLayout(
  elk: ELK,
  containers: LayoutContainer[],
): Promise<LayoutResult> {
  const shapes: Record<string, Box> = {};
  let nextTop: number | undefined;

  for (const container of containers) {
    const inner = await layoutContainer(elk, container);
    if (!container.id) {
      const ox = LAYOUT.origin.x;
      const oy = LAYOUT.origin.y;
      for (const [id, b] of Object.entries(inner.shapes))
        shapes[id] = { ...b, x: b.x + ox, y: b.y + oy };
      continue;
    }
    const x = container.bounds?.x ?? LAYOUT.origin.x;
    const y = nextTop ?? container.bounds?.y ?? LAYOUT.origin.y;
    const hasLanes = container.lanes.length > 0;
    const padY = hasLanes ? 0 : LAYOUT.padding;
    const contentX = x + LAYOUT.poolBand + LAYOUT.padding;
    const contentY = y + padY;
    const width = Math.max(400, LAYOUT.poolBand + inner.width + 2 * LAYOUT.padding);
    const height = hasLanes
      ? inner.height
      : Math.max(LAYOUT.laneMinHeight, inner.height + 2 * LAYOUT.padding);
    shapes[container.id] = { x, y, width, height };
    let laneY = y;
    container.lanes.forEach((laneId, i) => {
      const h = inner.laneHeights[i]!;
      shapes[laneId] = {
        x: x + LAYOUT.poolBand,
        y: laneY,
        width: width - LAYOUT.poolBand,
        height: h,
      };
      laneY += h;
    });
    for (const [id, b] of Object.entries(inner.shapes))
      shapes[id] = { ...b, x: b.x + contentX, y: b.y + contentY };
    nextTop = y + height + LAYOUT.poolGap;
  }
  return { shapes };
}

/**
 * With a worker source, ELK runs in a Web Worker so large layouts never block
 * the UI. Without one (or without `Worker`, e.g. in Node) the bundled in-thread
 * build is used.
 */
export async function createElk(worker?: ElkWorkerSource): Promise<ELK> {
  if (worker && typeof Worker !== 'undefined') {
    const [{ default: ELKApi }, url] = await Promise.all([
      import('elkjs/lib/elk-api.js'),
      typeof worker === 'function' ? worker() : worker,
    ]);
    return new ELKApi({ workerFactory: () => new Worker(url) });
  }
  const { default: ELKBundled } = await import('elkjs/lib/elk.bundled.js');
  return new ELKBundled();
}

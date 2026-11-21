/**
 * Layout engine: a layered (Sugiyama-style) layout built for BPMN.
 *
 * Every flow node gets a cell in a grid of layers (steps along the flow) and
 * tracks (rows across it). Tracks belong to bands: one per leaf lane, or one
 * per pool / process without lanes. Bands of all pools share the layers, so
 * message flows line up and lanes never need to be squeezed in afterwards.
 *
 * 1. Layers: longest path over sequence flows (loops broken by DFS), with
 *    exception flows leaving from their host and message flows pulling their
 *    target no earlier than their source.
 * 2. Tracks: the main path (the longest start → end path) is a straight
 *    line on the first track of each band; branches stack below it, exception
 *    paths below their host.
 * 3. Artifacts sit in a free cell next to the node they are associated with.
 * 4. Edges are routed through the grid: along free tracks and through the
 *    channels between layers, never through a cell holding a node. Loops run
 *    on a free track below.
 * 5. Sizes: each layer / track is as wide as its largest node including its
 *    external label; channels grow with the edges and edge labels in them.
 *
 * The engine works on abstract axes: "along" the flow (x for left → right)
 * and "across" it (y), then maps them to x / y for the chosen direction.
 * Expanded sub-processes are laid out first and become large nodes.
 */
import type {
  LArtifact,
  LBoundary,
  LContainer,
  LDiagram,
  LEdge,
  LLane,
  LNode,
  LabelMeasure,
  LayoutDensity,
  LayoutDirection,
  LayoutOptions,
} from './graph';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EngineResult {
  shapes: Record<string, Box>;
  connections: Record<string, Point[]>;
  labels: Record<string, Box>;
}

interface Params {
  layerGap: number;
  trackGap: number;
  bandPad: number;
  laneMin: number;
  poolGap: number;
  slot: number;
  alongPad: number;
}

export const DENSITY: Record<LayoutDensity, Params> = {
  compact: {
    layerGap: 30,
    trackGap: 22,
    bandPad: 14,
    laneMin: 90,
    poolGap: 30,
    slot: 8,
    alongPad: 20,
  },
  normal: {
    layerGap: 44,
    trackGap: 32,
    bandPad: 22,
    laneMin: 110,
    poolGap: 44,
    slot: 10,
    alongPad: 32,
  },
  spacious: {
    layerGap: 68,
    trackGap: 50,
    bandPad: 32,
    laneMin: 140,
    poolGap: 64,
    slot: 12,
    alongPad: 48,
  },
};

/** Name band of pools and lanes. */
const HEADER = 30;
/** External labels wrap at this width (as the renderer draws them by default). */
export const LABEL_WIDTH = 90;
const LABEL_GAP = 4;
/** Padding of expanded sub-processes around their content (x / y). */
const SUB = { side: 20, top: 34, bottom: 20, minWidth: 120, minHeight: 80 };

/** Font-independent estimate used when no measuring is available (Node, tests). */
export const estimateLabel: LabelMeasure = (text, maxWidth) => {
  const charWidth = 6.2;
  const lineHeight = 15;
  let lines = 0;
  let widest = 0;
  for (const paragraph of text.split(/\r?\n/)) {
    let line = 0;
    lines++;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const w = word.length * charWidth;
      const next = line ? line + charWidth + w : w;
      if (line && next > maxWidth) {
        widest = Math.max(widest, line);
        lines++;
        line = w;
      } else line = next;
    }
    widest = Math.max(widest, line);
  }
  return { width: Math.ceil(Math.min(maxWidth, widest) + 4), height: lines * lineHeight + 2 };
};

// ---------------------------------------------------------------------------
// Internal model

/** Extent around the shape center, along (before / after) and across. */
interface Ext {
  ab: number;
  aa: number;
  cb: number;
  ca: number;
}

/** A box relative to an item's center, in along / across terms. */
interface Rel {
  a: number;
  c: number;
  sa: number;
  sc: number;
}

interface BoundaryPlace {
  b: LBoundary;
  /** Center relative to the host's center. */
  a: number;
  c: number;
  sa: number;
  sc: number;
  label?: Rel;
}

interface Item {
  id: string;
  order: number;
  container: number;
  node?: LNode;
  artifact?: LArtifact;
  sa: number;
  sc: number;
  ext: Ext;
  label?: Rel;
  boundaries: BoundaryPlace[];
  local?: Local;
  /** Extent across (after) taken by boundary events. */
  bca: number;
  flipped?: boolean;
  band: number;
  layer: number;
  track: number;
  main: boolean;
  /** Final center (set when coordinates are known). */
  ca?: number;
  cc?: number;
}

interface Band {
  container: number;
  lane?: string;
  depth: number;
  minT: number;
  maxT: number;
  strip: Item[];
  start: number;
  end: number;
  centers: Map<number, number>;
  before: Map<number, number>;
  after: Map<number, number>;
}

interface GEdge {
  e: LEdge;
  s: Item;
  t: Item;
  back: boolean;
  exc: boolean;
  order: number;
}

type AExpr = { k: 'item'; id: string; off: number } | { k: 'chan'; l: number; slot: number };

type CExpr =
  | { k: 'item'; id: string; off: number }
  | { k: 'track'; b: number; t: number }
  | { k: 'tgap'; b: number; t: number }
  | { k: 'gap'; g: number; slot: number }
  | { k: 'edge'; container: number; end: boolean };

interface SPoint {
  a: AExpr;
  c: CExpr;
}

interface Route {
  id: string;
  message?: boolean;
  points: SPoint[];
  label?: { sa: number; sc: number };
}

interface Local {
  shapes: Record<string, Box>;
  connections: Record<string, Point[]>;
  labels: Record<string, Box>;
  width: number;
  height: number;
}

interface Ctx {
  dir: LayoutDirection;
  p: Params;
  measure: LabelMeasure;
}

const key = (b: number, l: number, t: number) => `${b}|${l}|${t}`;

/** along/across sizes of an x/y size. */
function abstractSize(ctx: Ctx, width: number, height: number): { sa: number; sc: number } {
  return ctx.dir === 'LR' ? { sa: width, sc: height } : { sa: height, sc: width };
}

/** An along/across box as x/y. */
function toBox(ctx: Ctx, a: number, c: number, sa: number, sc: number): Box {
  const r = (n: number) => Math.round(n);
  return ctx.dir === 'LR'
    ? { x: r(a), y: r(c), width: sa, height: sc }
    : { x: r(c), y: r(a), width: sc, height: sa };
}

function toPoint(ctx: Ctx, a: number, c: number): Point {
  const r = (n: number) => Math.round(n);
  return ctx.dir === 'LR' ? { x: r(a), y: r(c) } : { x: r(c), y: r(a) };
}

function measureRel(ctx: Ctx, text: string | undefined): { sa: number; sc: number } | undefined {
  if (!text?.trim()) return undefined;
  const m = ctx.measure(text, LABEL_WIDTH);
  return abstractSize(ctx, Math.ceil(m.width), Math.ceil(m.height));
}

function leafLanes(lanes: LLane[], depth = 0): { lane: LLane; depth: number }[] {
  return lanes.flatMap((l) =>
    l.children.length ? leafLanes(l.children, depth + 1) : [{ lane: l, depth }],
  );
}

function laneDepth(lanes: LLane[]): number {
  return lanes.length ? 1 + Math.max(0, ...lanes.map((l) => laneDepth(l.children))) : 0;
}

// ---------------------------------------------------------------------------
// Items

function nodeItem(ctx: Ctx, node: LNode, container: number, order: number): Item {
  let width = node.width;
  let height = node.height;
  let local: Local | undefined;
  if (node.content && node.content.nodes.length) {
    local = layoutSet(ctx, [node.content], []);
    width = Math.max(SUB.minWidth, local.width + 2 * SUB.side);
    height = Math.max(SUB.minHeight, local.height + SUB.top + SUB.bottom);
  }
  const { sa, sc } = abstractSize(ctx, width, height);
  const ext: Ext = { ab: sa / 2, aa: sa / 2, cb: sc / 2, ca: sc / 2 };
  const item: Item = {
    id: node.id,
    order,
    container,
    node,
    sa,
    sc,
    ext,
    boundaries: [],
    ...(local ? { local } : {}),
    bca: 0,
    band: 0,
    layer: 0,
    track: 0,
    main: false,
  };

  // External label: below events (right of them top → bottom), above gateways (left).
  const label = measureRel(ctx, node.label);
  if (label) {
    const before = node.kind === 'gateway';
    item.label = {
      a: -label.sa / 2,
      c: before ? -sc / 2 - LABEL_GAP - label.sc : sc / 2 + LABEL_GAP,
      ...label,
    };
    ext.ab = Math.max(ext.ab, label.sa / 2);
    ext.aa = Math.max(ext.aa, label.sa / 2);
    if (before) ext.cb = sc / 2 + LABEL_GAP + label.sc;
    else ext.ca = sc / 2 + LABEL_GAP + label.sc;
  }

  // Boundary events: spread along the far side, where exception paths leave.
  const boundary = [...(node.boundary ?? [])].sort((x, y) => x.order - y.order);
  boundary.forEach((b, i) => {
    const size = abstractSize(ctx, b.width, b.height);
    const a = -sa / 2 + (sa * (i + 1)) / (boundary.length + 1);
    const place: BoundaryPlace = { b, a, c: sc / 2, ...size };
    ext.ca = Math.max(ext.ca, sc / 2 + size.sc / 2);
    const bl = measureRel(ctx, b.label);
    if (bl) {
      place.label = { a: a + size.sa / 2 + 2, c: sc / 2 + 2, ...bl };
      ext.ca = Math.max(ext.ca, sc / 2 + 2 + bl.sc);
      ext.aa = Math.max(ext.aa, a + size.sa / 2 + 2 + bl.sa);
    }
    item.bca = Math.max(item.bca, ext.ca);
    item.boundaries.push(place);
  });
  return item;
}

function artifactItem(ctx: Ctx, art: LArtifact, container: number, order: number): Item {
  const { sa, sc } = abstractSize(ctx, art.width, art.height);
  const ext: Ext = { ab: sa / 2, aa: sa / 2, cb: sc / 2, ca: sc / 2 };
  const item: Item = {
    id: art.id,
    order,
    container,
    artifact: art,
    sa,
    sc,
    ext,
    bca: 0,
    boundaries: [],
    band: 0,
    layer: 0,
    track: 0,
    main: false,
  };
  const label = measureRel(ctx, art.label);
  if (label) {
    item.label = { a: -label.sa / 2, c: sc / 2 + LABEL_GAP, ...label };
    ext.ab = Math.max(ext.ab, label.sa / 2);
    ext.aa = Math.max(ext.aa, label.sa / 2);
    ext.ca = sc / 2 + LABEL_GAP + label.sc;
  }
  return item;
}

// ---------------------------------------------------------------------------
// The layout of one set of containers (the pools of a diagram, a process, or
// the content of a sub-process), in local coordinates.

function layoutSet(ctx: Ctx, containers: LContainer[], messages: LEdge[]): Local {
  const { p } = ctx;
  const bands: Band[] = [];
  const firstBand: number[] = [];
  const laneBand = new Map<string, number>();

  containers.forEach((c, ci) => {
    firstBand.push(bands.length);
    const leaves = leafLanes(c.lanes);
    const make = (lane?: string, depth = 0): Band => ({
      container: ci,
      ...(lane ? { lane } : {}),
      depth,
      minT: 0,
      maxT: -1,
      strip: [],
      start: 0,
      end: 0,
      centers: new Map(),
      before: new Map(),
      after: new Map(),
    });
    if (!leaves.length) bands.push(make());
    for (const { lane, depth } of leaves) {
      laneBand.set(lane.id, bands.length);
      bands.push(make(lane.id, depth));
    }
  });
  const bandsOf = (ci: number) => bands.filter((b) => b.container === ci);
  const lastBand = (ci: number) => firstBand[ci]! + bandsOf(ci).length - 1;

  // Items.
  const items: Item[] = [];
  const byId = new Map<string, Item>();
  const boundaryHost = new Map<string, Item>();
  let order = 0;
  containers.forEach((c, ci) => {
    for (const node of c.nodes) {
      const item = nodeItem(ctx, node, ci, order++);
      item.band = (node.lane ? laneBand.get(node.lane) : undefined) ?? firstBand[ci]!;
      byId.set(item.id, item);
      for (const b of item.boundaries) boundaryHost.set(b.b.id, item);
      if (node.strip) bands[item.band]!.strip.push(item);
      else items.push(item);
    }
  });

  // Sequence flows.
  const gedges: GEdge[] = [];
  containers.forEach((c, ci) => {
    for (const e of c.edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t || s.container !== ci || t.container !== ci) continue;
      if (s.node?.strip || t.node?.strip) continue;
      gedges.push({ e, s, t, back: false, exc: !!e.from, order: gedges.length });
    }
  });
  const out = new Map<Item, GEdge[]>();
  const inc = new Map<Item, GEdge[]>();
  for (const g of gedges) {
    out.set(g.s, [...(out.get(g.s) ?? []), g]);
    inc.set(g.t, [...(inc.get(g.t) ?? []), g]);
  }

  // 1. Break cycles (DFS from the sources, start events first).
  const state = new Map<Item, number>();
  const roots = [
    ...items
      .filter((i) => !inc.get(i)?.length)
      .sort(
        (x, y) =>
          Number(y.node?.kind === 'event') - Number(x.node?.kind === 'event') || x.order - y.order,
      ),
    ...items,
  ];
  for (const root of roots) {
    if (state.has(root)) continue;
    const stack: { item: Item; next: number }[] = [{ item: root, next: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const edges = out.get(top.item) ?? [];
      if (top.next >= edges.length) {
        state.set(top.item, 2);
        stack.pop();
        continue;
      }
      const g = edges[top.next++]!;
      const s = state.get(g.t);
      if (s === 1) g.back = true;
      else if (s === undefined) {
        state.set(g.t, 1);
        stack.push({ item: g.t, next: 0 });
      }
    }
  }
  const fwd = (i: Item) => (out.get(i) ?? []).filter((g) => !g.back);
  const fwdIn = (i: Item) => (inc.get(i) ?? []).filter((g) => !g.back);

  // 2. Layers: longest path; message flows (weight 0) when they keep it acyclic.
  const lsucc = new Map<Item, { t: Item; w: number }[]>();
  const addL = (s: Item, t: Item, w: number) => lsucc.set(s, [...(lsucc.get(s) ?? []), { t, w }]);
  for (const g of gedges) if (!g.back) addL(g.s, g.t, 1);
  const reaches = (from: Item, to: Item) => {
    const seen = new Set<Item>([from]);
    const todo = [from];
    while (todo.length) {
      const n = todo.pop()!;
      if (n === to) return true;
      for (const { t } of lsucc.get(n) ?? []) {
        if (!seen.has(t)) {
          seen.add(t);
          todo.push(t);
        }
      }
    }
    return false;
  };
  const top = (id: string) => byId.get(id) ?? boundaryHost.get(id);
  for (const m of messages) {
    const s = top(m.source);
    const t = top(m.target);
    if (!s || !t || s.container === t.container || s.node?.strip || t.node?.strip) continue;
    if (!reaches(t, s)) addL(s, t, 0);
  }
  const indeg = new Map<Item, number>(items.map((i) => [i, 0]));
  for (const list of lsucc.values())
    for (const { t } of list) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const topo: Item[] = [];
  const queue = items.filter((i) => !indeg.get(i));
  while (queue.length) {
    const n = queue.shift()!;
    topo.push(n);
    for (const { t, w } of lsucc.get(n) ?? []) {
      t.layer = Math.max(t.layer, n.layer + w);
      indeg.set(t, indeg.get(t)! - 1);
      if (!indeg.get(t)) queue.push(t);
    }
  }
  const hasPred = new Set<Item>();
  for (const list of lsucc.values()) for (const { t } of list) hasPred.add(t);
  // Sources sit right before their first successor (e.g. a second start event).
  for (const n of [...topo].reverse()) {
    const succ = lsucc.get(n) ?? [];
    if (hasPred.has(n) || !succ.length) continue;
    n.layer = Math.max(n.layer, Math.min(...succ.map(({ t, w }) => t.layer - w)));
  }
  const usedLayers = [...new Set(items.map((i) => i.layer))].sort((x, y) => x - y);
  const layerIndex = new Map(usedLayers.map((l, i) => [l, i]));
  for (const i of items) i.layer = layerIndex.get(i.layer)!;
  const maxL = usedLayers.length - 1;

  // 3. Main path of each container: the longest path from a source to a sink.
  const dist = new Map<Item, number>();
  for (const n of [...topo].reverse()) {
    const next = fwd(n).filter((g) => !g.exc);
    dist.set(n, next.length ? 1 + Math.max(...next.map((g) => dist.get(g.t) ?? 0)) : 0);
  }
  containers.forEach((_, ci) => {
    const sources = items.filter(
      (i) => i.container === ci && !fwdIn(i).filter((g) => !g.exc).length,
    );
    sources.sort(
      (x, y) =>
        (dist.get(y) ?? 0) - (dist.get(x) ?? 0) ||
        Number(y.node?.kind === 'event') - Number(x.node?.kind === 'event') ||
        x.order - y.order,
    );
    let n: Item | undefined = sources[0];
    while (n && !n.main) {
      n.main = true;
      const next = fwd(n)
        .filter((g) => !g.exc)
        .sort((x, y) => (dist.get(y.t) ?? 0) - (dist.get(x.t) ?? 0) || x.order - y.order);
      n = next[0]?.t;
    }
  });

  // 4. Tracks.
  const occ = new Map<string, Item>();
  const siblings = (s: Item) =>
    fwd(s)
      .filter((g) => g.t.band === s.band)
      .sort(
        (x, y) =>
          Number(x.exc) - Number(y.exc) || Number(y.t.main) - Number(x.t.main) || x.order - y.order,
      );
  const placed = new Set<Item>();
  for (let l = 0; l <= maxL; l++) {
    const layer = items.filter((i) => i.layer === l);
    const bary = (i: Item) => {
      const preds = fwdIn(i).filter((g) => g.s.band === i.band && placed.has(g.s));
      return preds.length ? preds.reduce((sum, g) => sum + g.s.track, 0) / preds.length : 1e9;
    };
    layer.sort((x, y) => Number(y.main) - Number(x.main) || bary(x) - bary(y) || x.order - y.order);
    for (const i of layer) {
      let pref = 0;
      if (!i.main) {
        const preds = fwdIn(i).filter((g) => g.s.band === i.band && placed.has(g.s));
        if (preds.length) {
          pref = Math.min(
            ...preds.map((g) => {
              const t = g.s.track + Math.max(0, siblings(g.s).indexOf(g));
              return g.exc ? Math.max(t, g.s.track + 1) : t;
            }),
          );
        }
      }
      let t = pref;
      while (occ.has(key(i.band, l, t))) t++;
      i.track = t;
      occ.set(key(i.band, l, t), i);
      placed.add(i);
    }
  }
  // Drop unused tracks.
  occ.clear();
  bands.forEach((band, bi) => {
    const used = [...new Set(items.filter((i) => i.band === bi).map((i) => i.track))].sort(
      (x, y) => x - y,
    );
    const map = new Map(used.map((t, i) => [t, i]));
    for (const i of items) if (i.band === bi) i.track = map.get(i.track)!;
    band.minT = 0;
    band.maxT = used.length - 1;
  });
  for (const i of items) occ.set(key(i.band, i.layer, i.track), i);

  // 5. Artifacts next to their anchor; the others below the flow.
  const artifacts: Item[] = [];
  const loose: Item[] = [];
  containers.forEach((c, ci) => {
    for (const art of c.artifacts) {
      const item = artifactItem(ctx, art, ci, order++);
      byId.set(item.id, item);
      const anchor = art.anchor ? byId.get(art.anchor) : undefined;
      if (!anchor || anchor.node?.strip || !items.includes(anchor) || anchor.container !== ci) {
        item.band = lastBand(ci);
        loose.push(item);
        continue;
      }
      const band = bands[anchor.band]!;
      item.band = anchor.band;
      // Above a node on the band's first track, below the others.
      const track = anchor.track === 0 ? -1 : anchor.track + 1;
      let spot: [number, number] | undefined;
      for (const d of [0, 1, -1, 2, -2, 3]) {
        const l = anchor.layer + d;
        if (l < 0 || l > maxL) continue;
        if (!occ.has(key(anchor.band, l, track))) {
          spot = [l, track];
          break;
        }
      }
      if (!spot) spot = [anchor.layer, ++band.maxT];
      [item.layer, item.track] = spot;
      band.minT = Math.min(band.minT, item.track);
      band.maxT = Math.max(band.maxT, item.track);
      occ.set(key(item.band, item.layer, item.track), item);
      artifacts.push(item);
    }
  });
  // Artifacts without an anchor: a row of their own below the flow.
  const looseTrack = new Map<number, { t: number; l: number }>();
  for (const item of loose) {
    const band = bands[item.band]!;
    if (maxL < 0) {
      band.strip.push(item);
      continue;
    }
    let at = looseTrack.get(item.band);
    if (!at || at.l > maxL) at = { t: ++band.maxT, l: 0 };
    item.layer = at.l++;
    item.track = at.t;
    looseTrack.set(item.band, at);
    occ.set(key(item.band, item.layer, item.track), item);
    artifacts.push(item);
  }
  const grid = [...items, ...artifacts];
  const flow = new Set(items);

  // 6. Routing on the grid.
  const runs = new Map<string, string>();
  const chanCount = new Map<number, number>();
  const chanReq = new Map<number, number>();
  const gapCount = new Map<number, number>();
  const routes: Route[] = [];
  const free = (b: number, l: number, t: number) =>
    !occ.has(key(b, l, t)) && !runs.has(key(b, l, t));
  const runFree = (b: number, t: number, l0: number, l1: number) => {
    for (let l = l0; l <= l1; l++) if (!free(b, l, t)) return false;
    return true;
  };
  const reserve = (b: number, t: number, l0: number, l1: number, id: string) => {
    for (let l = l0; l <= l1; l++) runs.set(key(b, l, t), id);
  };
  const cmp = (x: { b: number; t: number }, y: { b: number; t: number }) => x.b - y.b || x.t - y.t;
  /** No node in layer `l` strictly between two positions across the flow. */
  const colFree = (l: number, from: { b: number; t: number }, to: { b: number; t: number }) => {
    const [lo, hi] = cmp(from, to) <= 0 ? [from, to] : [to, from];
    for (let b = lo.b; b <= hi.b; b++) {
      const band = bands[b]!;
      const t0 = b === lo.b ? lo.t + 1 : band.minT;
      const t1 = b === hi.b ? hi.t - 1 : band.maxT;
      for (let t = t0; t <= t1; t++) if (occ.has(key(b, l, t))) return false;
    }
    return true;
  };
  /** No node in layer `l` between a position and the near / far edge of its container. */
  const colFreeToEdge = (l: number, from: { b: number; t: number }, toEnd: boolean) => {
    const ci = bands[from.b]!.container;
    const edgeBand = toEnd ? lastBand(ci) : firstBand[ci]!;
    const band = bands[edgeBand]!;
    const edge = { b: edgeBand, t: toEnd ? band.maxT + 1 : band.minT - 1 };
    return colFree(l, from, edge);
  };
  const chan = (l: number): AExpr => {
    const slot = chanCount.get(l) ?? 0;
    chanCount.set(l, slot + 1);
    return { k: 'chan', l, slot };
  };
  const newTrack = (b: number) => ++bands[b]!.maxT;
  const pos = (i: Item) => ({ b: i.band, t: i.track });
  const center = (i: Item): SPoint => ({
    a: { k: 'item', id: i.id, off: 0 },
    c: { k: 'item', id: i.id, off: 0 },
  });
  const sideA = (i: Item, after: boolean): SPoint => ({
    a: { k: 'item', id: i.id, off: after ? i.sa / 2 : -i.sa / 2 },
    c: { k: 'item', id: i.id, off: 0 },
  });
  const sideC = (i: Item, after: boolean): SPoint => ({
    a: { k: 'item', id: i.id, off: 0 },
    c: { k: 'item', id: i.id, off: after ? i.sc / 2 : -i.sc / 2 },
  });
  const trackC = (i: Item): CExpr => ({ k: 'track', b: i.band, t: i.track });
  const labelOf = (e: LEdge) => measureRel(ctx, e.label);
  const needChan = (l: number, w: number) => chanReq.set(l, Math.max(chanReq.get(l) ?? 0, w));

  /** A free track in band `b` for layers l0..l1, nearest to `near` (a new one if needed). */
  const freeTrack = (b: number, near: number, l0: number, l1: number, below = -Infinity) => {
    const band = bands[b]!;
    const candidates: number[] = [];
    for (let t = band.minT; t <= band.maxT; t++) if (t > below) candidates.push(t);
    candidates.sort((x, y) => Math.abs(x - near) - Math.abs(y - near) || x - y);
    return candidates.find((t) => runFree(b, t, l0, l1)) ?? newTrack(b);
  };

  const sequenceRoute = (g: GEdge): Route => {
    const { s, t, e } = g;
    const i = s.layer;
    const j = t.layer;
    const label = labelOf(e);
    const route: Route = { id: e.id, points: [], ...(label ? { label } : {}) };
    const along = () => label && needChan(i, label.sa + 14);
    const across = () => label && needChan(i, label.sa + 10 - s.ext.aa);
    const sp = pos(s);
    const tp = pos(t);
    const down = cmp(tp, sp) > 0;
    if (s.band === t.band && s.track === t.track && runFree(s.band, s.track, i + 1, j - 1)) {
      reserve(s.band, s.track, i + 1, j - 1, e.id);
      route.points = [sideA(s, true), sideA(t, false)];
      along();
    } else if (
      s.node?.kind === 'gateway' &&
      colFree(i, sp, tp) &&
      runFree(t.band, t.track, i, j - 1)
    ) {
      reserve(t.band, t.track, i, j - 1, e.id);
      route.points = [sideC(s, down), { a: center(s).a, c: trackC(t) }, sideA(t, false)];
      across();
    } else if (
      t.node?.kind === 'gateway' &&
      runFree(s.band, s.track, i + 1, j) &&
      colFree(j, sp, tp)
    ) {
      reserve(s.band, s.track, i + 1, j, e.id);
      route.points = [sideA(s, true), { a: center(t).a, c: trackC(s) }, sideC(t, !down)];
      along();
    } else if (j === i + 1) {
      const ch = chan(i);
      route.points = [
        sideA(s, true),
        { a: ch, c: trackC(s) },
        { a: ch, c: trackC(t) },
        sideA(t, false),
      ];
      along();
    } else if (runFree(s.band, s.track, i + 1, j - 1)) {
      reserve(s.band, s.track, i + 1, j - 1, e.id);
      const ch = chan(j - 1);
      route.points = [
        sideA(s, true),
        { a: ch, c: trackC(s) },
        { a: ch, c: trackC(t) },
        sideA(t, false),
      ];
      along();
    } else if (runFree(t.band, t.track, i + 1, j - 1)) {
      reserve(t.band, t.track, i + 1, j - 1, e.id);
      const ch = chan(i);
      route.points = [
        sideA(s, true),
        { a: ch, c: trackC(s) },
        { a: ch, c: trackC(t) },
        sideA(t, false),
      ];
      along();
    } else {
      const k = freeTrack(t.band, t.track, i + 1, j - 1);
      reserve(t.band, k, i + 1, j - 1, e.id);
      const c1 = chan(i);
      const c2 = chan(j - 1);
      const via: CExpr = { k: 'track', b: t.band, t: k };
      route.points = [
        sideA(s, true),
        { a: c1, c: trackC(s) },
        { a: c1, c: via },
        { a: c2, c: via },
        { a: c2, c: trackC(t) },
        sideA(t, false),
      ];
      along();
    }
    return route;
  };

  /** A loop back to an earlier (or the same) layer, on a free track below both ends. */
  const loopRoute = (g: GEdge, start: SPoint[], from: Item): Route => {
    const { t, e } = g;
    const i = from.layer;
    const j = t.layer;
    const label = labelOf(e);
    const lb = Math.max(from.band, t.band);
    const ends = [from, t].filter((x) => x.band === lb).map((x) => x.track);
    const k = freeTrack(lb, Math.max(...ends) + 1, j, i, Math.max(...ends));
    reserve(lb, k, j, i, e.id);
    const loop: CExpr = { k: 'track', b: lb, t: k };
    // A gateway leaves through its far side when nothing is in the way.
    const exitDown = start.length === 1 && colFree(i, pos(from), { b: lb, t: k });
    const points = start.length === 1 && !exitDown ? [sideA(from, true)] : [...start];
    if (exitDown) points.push({ a: start[0]!.a, c: loop });
    else {
      const ch = chan(i);
      points.push({ a: ch, c: points[points.length - 1]!.c }, { a: ch, c: loop });
    }
    if (t.node?.kind === 'gateway' && colFree(j, { b: lb, t: k }, pos(t))) {
      points.push({ a: center(t).a, c: loop }, sideC(t, true));
    } else {
      const ch = chan(j - 1);
      points.push({ a: ch, c: loop }, { a: ch, c: trackC(t) }, sideA(t, false));
    }
    if (label) needChan(i, label.sa + 10 - from.ext.aa);
    return { id: e.id, points, ...(label ? { label } : {}) };
  };

  const exceptionRoute = (g: GEdge): Route => {
    const { s, t, e } = g;
    const place = s.boundaries.find((b) => b.b.id === e.from);
    if (!place) return g.back ? loopRoute(g, [sideA(s, true)], s) : sequenceRoute(g);
    const i = s.layer;
    const j = t.layer;
    const label = labelOf(e);
    const bottom: SPoint = {
      a: { k: 'item', id: s.id, off: place.a },
      c: { k: 'item', id: s.id, off: place.c + place.sc / 2 },
    };
    if (j <= i) {
      const stub: CExpr = { k: 'tgap', b: s.band, t: s.track };
      return loopRoute(g, [bottom, { a: bottom.a, c: stub }], s);
    }
    if (label) needChan(i, label.sa + 10 - s.ext.aa);
    const route: Route = { id: e.id, points: [], ...(label ? { label } : {}) };
    if (
      t.band === s.band &&
      t.track > s.track &&
      colFree(i, pos(s), pos(t)) &&
      runFree(t.band, t.track, i, j - 1)
    ) {
      reserve(t.band, t.track, i, j - 1, e.id);
      route.points = [bottom, { a: bottom.a, c: trackC(t) }, sideA(t, false)];
      return route;
    }
    const stub: CExpr = { k: 'tgap', b: s.band, t: s.track };
    const c1 = chan(i);
    route.points = [bottom, { a: bottom.a, c: stub }, { a: c1, c: stub }];
    if (j === i + 1 || runFree(t.band, t.track, i + 1, j - 1)) {
      reserve(t.band, t.track, i + 1, j - 1, e.id);
      route.points.push({ a: c1, c: trackC(t) }, sideA(t, false));
    } else {
      const k = freeTrack(t.band, t.track, i + 1, j - 1);
      reserve(t.band, k, i + 1, j - 1, e.id);
      const via: CExpr = { k: 'track', b: t.band, t: k };
      const c2 = chan(j - 1);
      route.points.push(
        { a: c1, c: via },
        { a: c2, c: via },
        { a: c2, c: trackC(t) },
        sideA(t, false),
      );
    }
    return route;
  };

  const sorted = [...gedges].sort(
    (x, y) =>
      x.s.layer - y.s.layer || x.s.track - y.s.track || x.t.track - y.t.track || x.order - y.order,
  );
  for (const g of sorted) {
    if (g.exc) routes.push(exceptionRoute(g));
    else if (g.back) {
      const start = g.s.node?.kind === 'gateway' ? [sideC(g.s, true)] : [sideA(g.s, true)];
      routes.push(loopRoute(g, start, g.s));
    } else routes.push(sequenceRoute(g));
  }

  /** Moves an external label away from the side a message flow attaches to. */
  const flipLabel = (i: Item, side: boolean) => {
    const l = i.label;
    if (!l || i.flipped || !i.node) return;
    const onAfter = l.c > 0;
    if (onAfter !== side) return;
    i.flipped = true;
    if (side) {
      l.c = -i.sc / 2 - LABEL_GAP - l.sc;
      i.ext.cb = Math.max(i.ext.cb, i.sc / 2 + LABEL_GAP + l.sc);
      i.ext.ca = Math.max(i.sc / 2, i.bca);
    } else {
      l.c = i.sc / 2 + LABEL_GAP;
      i.ext.ca = Math.max(i.bca, i.sc / 2 + LABEL_GAP + l.sc);
      i.ext.cb = i.sc / 2;
    }
  };

  // Message flows: straight across when the ends line up, else through the gap
  // between the pools.
  const containerIndex = new Map<string, number>();
  containers.forEach((c, ci) => c.id && containerIndex.set(c.id, ci));
  for (const m of messages) {
    const s = byId.get(m.source);
    const t = byId.get(m.target);
    const sPool = containerIndex.get(m.source);
    const tPool = containerIndex.get(m.target);
    const sItem = s && flow.has(s) ? s : undefined;
    const tItem = t && flow.has(t) ? t : undefined;
    const sc = sItem ? sItem.container : sPool;
    const tc = tItem ? tItem.container : tPool;
    if (sc === undefined || tc === undefined || sc === tc) continue;
    if ((s && !sItem) || (t && !tItem)) continue; // ends inside a sub-process / strip
    if (!sItem && !tItem) continue;
    const down = tc > sc;
    const g = down ? tc - 1 : tc;
    const label = labelOf(m);
    const route: Route = { id: m.id, message: true, points: [], ...(label ? { label } : {}) };
    const exitPoints = (i: Item, toward: boolean): SPoint[] => {
      if (colFreeToEdge(i.layer, pos(i), toward)) {
        flipLabel(i, toward);
        return [sideC(i, toward)];
      }
      // Through the side with fewer sequence flows (a start event's free left side).
      const before = (inc.get(i)?.length ?? 0) <= (out.get(i)?.length ?? 0);
      const ch = chan(before ? i.layer - 1 : i.layer);
      return [sideA(i, !before), { a: ch, c: trackC(i) }];
    };
    if (sItem && tItem) {
      const start = exitPoints(sItem, down);
      const end = exitPoints(tItem, !down).reverse();
      const sa = start[start.length - 1]!.a;
      const ta = end[0]!.a;
      if (start.length === 1 && end.length === 1 && sItem.layer === tItem.layer) {
        route.points = [start[0]!, end[0]!];
      } else {
        const slot = gapCount.get(g) ?? 0;
        gapCount.set(g, slot + 1);
        const gap: CExpr = { k: 'gap', g, slot };
        route.points = [...start, { a: sa, c: gap }, { a: ta, c: gap }, ...end];
      }
    } else if (tItem) {
      const end = exitPoints(tItem, !down).reverse();
      route.points = [{ a: end[0]!.a, c: { k: 'edge', container: sc, end: down } }, ...end];
    } else if (sItem) {
      const start = exitPoints(sItem, down);
      route.points = [
        ...start,
        { a: start[start.length - 1]!.a, c: { k: 'edge', container: tc, end: !down } },
      ];
    }
    routes.push(route);
  }

  // Associations: straight lines (cropped to the outlines when applied).
  for (const art of artifacts) {
    const anchor = byId.get(art.artifact!.anchor!)!;
    for (const id of art.artifact!.links)
      routes.push({ id, points: [center(art), center(anchor)] });
  }

  // 7. Coordinates along the flow.
  const before = new Array<number>(maxL + 1).fill(0);
  const after = new Array<number>(maxL + 1).fill(0);
  for (const i of grid) {
    before[i.layer] = Math.max(before[i.layer]!, i.ext.ab);
    after[i.layer] = Math.max(after[i.layer]!, i.ext.aa);
  }
  const chanW = (l: number) => {
    const n = chanCount.get(l) ?? 0;
    const edge = l < 0 || l >= maxL;
    const base = edge ? (n ? p.layerGap / 2 : 0) : p.layerGap;
    return Math.max(base, n ? (n + 1) * p.slot : 0, chanReq.get(l) ?? 0);
  };
  const framed = containers.map((c) => !!c.id || c.lanes.length > 0);
  const anyFramed = framed.some(Boolean);
  const headers = containers.map((c) => (c.id ? HEADER : 0) + HEADER * laneDepth(c.lanes));
  const contentStart = Math.max(0, ...headers) + (anyFramed ? p.alongPad : 0);
  const layerCenter: number[] = [];
  let cursor = contentStart + chanW(-1);
  for (let l = 0; l <= maxL; l++) {
    cursor += before[l]!;
    layerCenter[l] = cursor;
    cursor += after[l]! + chanW(l);
  }
  let alongEnd = cursor;
  const chanPos = (l: number, slot: number) => {
    const n = chanCount.get(l) ?? 1;
    const start = l < 0 ? contentStart : layerCenter[l]! + after[l]!;
    const end = l >= maxL ? start + chanW(l) : layerCenter[l + 1]! - before[l + 1]!;
    return start + ((end - start) * (slot + 1)) / (n + 1);
  };

  // Strips: event sub-processes and unanchored artifacts, in a row below the flow.
  for (const band of bands) {
    let a = contentStart;
    for (const i of band.strip) {
      i.ca = a + i.ext.ab;
      a = i.ca + i.ext.aa + p.layerGap;
    }
    if (band.strip.length) alongEnd = Math.max(alongEnd, a - p.layerGap);
  }
  alongEnd += anyFramed ? p.alongPad : 0;

  // 8. Coordinates across the flow.
  const gapSize = (g: number) => Math.max(p.poolGap, ((gapCount.get(g) ?? 0) + 1) * p.slot);
  const containerStart: number[] = [];
  const containerEnd: number[] = [];
  let c0 = 0;
  containers.forEach((c, ci) => {
    containerStart[ci] = c0;
    const own = bandsOf(ci);
    const hasContent = c.nodes.length > 0 || c.artifacts.length > 0;
    if (!hasContent && c.id) {
      const size = c.crossSize ?? p.laneMin;
      own.forEach((band) => {
        band.start = c0;
        band.end = c0 + size / own.length;
        c0 = band.end;
      });
    }
    for (const band of hasContent || !c.id ? own : []) {
      const bi = bands.indexOf(band);
      const pad = framed[ci] ? p.bandPad : 0;
      for (const i of grid) {
        if (i.band !== bi) continue;
        band.before.set(i.track, Math.max(band.before.get(i.track) ?? 0, i.ext.cb));
        band.after.set(i.track, Math.max(band.after.get(i.track) ?? 0, i.ext.ca));
      }
      let y = 0;
      let first = true;
      for (let t = band.minT; t <= band.maxT; t++) {
        const b = band.before.get(t) ?? p.slot;
        const a = band.after.get(t) ?? p.slot;
        band.before.set(t, b);
        band.after.set(t, a);
        if (!first) y += p.trackGap;
        first = false;
        y += b;
        band.centers.set(t, y);
        y += a;
      }
      if (band.strip.length) {
        if (!first) y += p.trackGap;
        const cb = Math.max(...band.strip.map((i) => i.ext.cb));
        const ca = Math.max(...band.strip.map((i) => i.ext.ca));
        for (const i of band.strip) i.cc = y + cb;
        y += cb + ca;
      }
      const min = framed[ci] ? p.laneMin : 0;
      const size = Math.max(min, y + 2 * pad);
      const shift = c0 + pad + (size - 2 * pad - y) / 2;
      for (const [t, v] of band.centers) band.centers.set(t, v + shift);
      for (const i of band.strip) i.cc = i.cc! + shift;
      band.start = c0;
      band.end = c0 + size;
      c0 = band.end;
    }
    containerEnd[ci] = c0;
    if (ci < containers.length - 1) c0 += gapSize(ci);
  });
  for (const i of grid) {
    i.ca = layerCenter[i.layer]!;
    i.cc = bands[i.band]!.centers.get(i.track)!;
  }

  // 9. Resolve routes.
  const resolveA = (x: AExpr): number =>
    x.k === 'item' ? byId.get(x.id)!.ca! + x.off : chanPos(x.l, x.slot);
  const resolveC = (x: CExpr): number => {
    switch (x.k) {
      case 'item':
        return byId.get(x.id)!.cc! + x.off;
      case 'track':
        return bands[x.b]!.centers.get(x.t)!;
      case 'tgap': {
        const band = bands[x.b]!;
        const end = band.centers.get(x.t)! + band.after.get(x.t)!;
        const next = band.centers.get(x.t + 1);
        return next !== undefined
          ? (end + next - band.before.get(x.t + 1)!) / 2
          : end + p.trackGap / 2;
      }
      case 'gap': {
        const start = containerEnd[x.g]!;
        const n = gapCount.get(x.g) ?? 1;
        return start + (gapSize(x.g) * (x.slot + 1)) / (n + 1);
      }
      case 'edge':
        return x.end ? containerEnd[x.container]! : containerStart[x.container]!;
    }
  };

  const local: Local = {
    shapes: {},
    connections: {},
    labels: {},
    width: 0,
    height: 0,
  };
  for (const r of routes) {
    const pts = r.points.map((sp) => ({ a: resolveA(sp.a), c: resolveC(sp.c) }));
    const clean = simplify(pts);
    local.connections[r.id] = clean.map((q) => toPoint(ctx, q.a, q.c));
    if (r.label && clean.length > 1) {
      const [q0, q1] = [clean[0]!, clean[1]!];
      let a: number;
      let c: number;
      if (Math.abs(q0.c - q1.c) < 0.5) {
        // Along the flow: above the first segment, from its start.
        a = q1.a >= q0.a ? q0.a + 6 : q0.a - 6 - r.label.sa;
        c = q0.c - 3 - r.label.sc;
      } else {
        // Across: beside the first segment, in its middle (message flows on the
        // other side than the envelope's message name).
        a = r.message ? q0.a - 5 - r.label.sa : q0.a + 5;
        c = (q0.c + q1.c) / 2 - r.label.sc / 2;
      }
      local.labels[r.id] = toBox(ctx, a, c, r.label.sa, r.label.sc);
    }
  }

  // 10. Shapes.
  const place = (i: Item) => {
    const a = i.ca! - i.sa / 2;
    const c = i.cc! - i.sc / 2;
    local.shapes[i.id] = toBox(ctx, a, c, i.sa, i.sc);
    if (i.label)
      local.labels[i.id] = toBox(ctx, i.ca! + i.label.a, i.cc! + i.label.c, i.label.sa, i.label.sc);
    for (const b of i.boundaries) {
      local.shapes[b.b.id] = toBox(ctx, i.ca! + b.a - b.sa / 2, i.cc! + b.c - b.sc / 2, b.sa, b.sc);
      if (b.label)
        local.labels[b.b.id] = toBox(
          ctx,
          i.ca! + b.label.a,
          i.cc! + b.label.c,
          b.label.sa,
          b.label.sc,
        );
    }
    if (i.local) {
      const box = local.shapes[i.id]!;
      const dx = box.x + SUB.side + (box.width - 2 * SUB.side - i.local.width) / 2;
      const dy = box.y + SUB.top;
      mergeLocal(local, i.local, dx, dy);
    }
  };
  for (const i of grid) place(i);
  for (const band of bands) for (const i of band.strip) place(i);

  // 11. Pools and lanes.
  containers.forEach((c, ci) => {
    const start = containerStart[ci]!;
    const end = containerEnd[ci]!;
    if (c.id) local.shapes[c.id] = toBox(ctx, 0, start, alongEnd, end - start);
    const laneStart = c.id ? HEADER : 0;
    const visit = (lanes: LLane[], depth: number): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const lane of lanes) {
        let span: [number, number];
        if (lane.children.length) span = visit(lane.children, depth + 1);
        else {
          const band = bands[laneBand.get(lane.id)!]!;
          span = [band.start, band.end];
        }
        const a = laneStart + HEADER * depth;
        local.shapes[lane.id] = toBox(ctx, a, span[0], alongEnd - a, span[1] - span[0]);
        lo = Math.min(lo, span[0]);
        hi = Math.max(hi, span[1]);
      }
      return [lo, hi];
    };
    visit(c.lanes, 0);
  });

  const size = toBox(ctx, 0, 0, alongEnd, c0);
  local.width = size.width;
  local.height = size.height;
  // Content outside the frame (labels, loops) still counts for a parent's size.
  if (!anyFramed) {
    let maxX = local.width;
    let maxY = local.height;
    for (const b of [...Object.values(local.shapes), ...Object.values(local.labels)]) {
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    for (const pts of Object.values(local.connections))
      for (const q of pts) {
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    local.width = Math.ceil(maxX);
    local.height = Math.ceil(maxY);
  }
  return local;
}

function simplify(points: { a: number; c: number }[]): { a: number; c: number }[] {
  const out: { a: number; c: number }[] = [];
  for (const q of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.a - q.a) < 0.5 && Math.abs(last.c - q.c) < 0.5) continue;
    out.push(q);
  }
  // Drop middle points of straight runs.
  for (let i = out.length - 2; i > 0; i--) {
    const [p0, p1, p2] = [out[i - 1]!, out[i]!, out[i + 1]!];
    const sameA = Math.abs(p0.a - p1.a) < 0.5 && Math.abs(p1.a - p2.a) < 0.5;
    const sameC = Math.abs(p0.c - p1.c) < 0.5 && Math.abs(p1.c - p2.c) < 0.5;
    if (sameA || sameC) out.splice(i, 1);
  }
  return out;
}

function mergeLocal(into: EngineResult, from: EngineResult, dx: number, dy: number): void {
  const move = (b: Box): Box => ({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
  for (const [id, b] of Object.entries(from.shapes)) into.shapes[id] = move(b);
  for (const [id, b] of Object.entries(from.labels)) into.labels[id] = move(b);
  for (const [id, pts] of Object.entries(from.connections))
    into.connections[id] = pts.map((q) => ({ x: Math.round(q.x + dx), y: Math.round(q.y + dy) }));
}

/** Lays out a whole diagram. */
export function layoutDiagram(
  diagram: LDiagram,
  options: LayoutOptions = {},
  measure: LabelMeasure = estimateLabel,
): EngineResult {
  const ctx: Ctx = {
    dir: options.direction ?? 'LR',
    p: DENSITY[options.density ?? 'normal'],
    measure,
  };
  const local = layoutSet(ctx, diagram.containers, diagram.messages);
  const result: EngineResult = { shapes: {}, connections: {}, labels: {} };
  mergeLocal(result, local, diagram.origin.x, diagram.origin.y);

  // Groups wrap the shapes they held before.
  for (const group of diagram.groups) {
    const boxes = group.members.map((id) => result.shapes[id]).filter((b): b is Box => !!b);
    if (!boxes.length) continue;
    const pad = 14;
    const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
    const y0 = Math.min(...boxes.map((b) => b.y)) - pad - 10;
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
    result.shapes[group.id] = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  return result;
}

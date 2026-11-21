/** Builds the layout engine's input from the diagram shown on the canvas. */
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, isConnection, isExpandedShape } from '../model';
import { childLanes, isHorizontal } from '../modeling/laneLayout';
import { dataStateName } from '../renderer/text';
import { hasExternalLabel } from '../renderer/visuals';
import type {
  LBoundary,
  LContainer,
  LDiagram,
  LEdge,
  LGroup,
  LLane,
  LNode,
  LNodeKind,
} from './graph';

const ARTIFACT =
  /^bpmn:(DataObjectReference|DataStoreReference|TextAnnotation|DataInput|DataOutput)$/;
const LINK = /^bpmn:(Association|DataInputAssociation|DataOutputAssociation)$/;

export interface Extracted {
  diagram: LDiagram;
  /** Pools / lanes are vertical: the flow runs top → bottom. */
  vertical: boolean;
}

function labelText(b: ModdleElement): string | undefined {
  if (!hasExternalLabel(b)) return undefined;
  const state = dataStateName(b);
  const text = [b.name as string | undefined, state && `[${state}]`].filter(Boolean).join('\n');
  return text || undefined;
}

function kindOf(b: ModdleElement): LNodeKind {
  if (is(b, 'bpmn:Gateway')) return 'gateway';
  if (is(b, 'bpmn:Event')) return 'event';
  if (is(b, 'bpmn:Activity') || is(b, 'bpmn:ChoreographyActivity')) return 'activity';
  return 'other';
}

function laneTree(container: Shape): LLane[] {
  return childLanes(container).map((l) => ({ id: l.id, children: laneTree(l) }));
}

/** Leaf lane of each flow node (the deepest lane listing it). */
function laneMembership(container: Shape): Map<ModdleElement, string> {
  const out = new Map<ModdleElement, string>();
  const visit = (lane: Shape) => {
    const kids = childLanes(lane);
    for (const ref of getMany(bo(lane), 'flowNodeRef')) {
      if (!kids.length) out.set(ref, lane.id);
      else if (!out.has(ref)) out.set(ref, firstLeaf(kids[0]!).id);
    }
    kids.forEach(visit);
  };
  childLanes(container).forEach(visit);
  return out;
}

function firstLeaf(lane: Shape): Shape {
  const kids = childLanes(lane);
  return kids.length ? firstLeaf(kids[0]!) : lane;
}

/** Box `inner` lies within `outer` (1px tolerance for rounding). */
function encloses(outer: Shape, inner: Shape): boolean {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1 &&
    inner.width * inner.height < outer.width * outer.height
  );
}

/**
 * Shapes drawn inside an activity of the same process level (siblings in the
 * model, nested on the canvas): the innermost enclosing activity of each. The
 * layout keeps such shapes inside it, as it does with sub-process content.
 */
function drawnInside(nodes: Shape[], others: Shape[]): Map<Shape, Shape> {
  const hosts = nodes.filter((n) => is(bo(n), 'bpmn:Activity'));
  const out = new Map<Shape, Shape>();
  for (const s of [...nodes, ...others]) {
    let best: Shape | undefined;
    for (const h of hosts) {
      if (h === s || !encloses(h, s)) continue;
      if (!best || h.width * h.height < best.width * best.height) best = h;
    }
    if (best) out.set(s, best);
  }
  return out;
}

/**
 * Layout input for the content of `parent`. Content drawn inside one of its
 * activities becomes that activity's content (to any depth); a flow between
 * levels counts, for placing, as a flow between the shapes holding its ends
 * at their common level, and is routed afresh once they are placed.
 */
function containerOf(parent: Shape, withLanes: boolean, only?: Set<string>): LContainer {
  const lanes = withLanes ? laneTree(parent) : [];
  const membership = withLanes ? laneMembership(parent) : new Map<ModdleElement, string>();
  const children = childrenOf(parent);
  const nodeShapes = children.filter(
    (c) =>
      is(bo(c), 'bpmn:FlowNode') &&
      !is(bo(c), 'bpmn:BoundaryEvent') &&
      !(c as Shape).host &&
      (!only || only.has(c.id)),
  ) as Shape[];
  const artifactShapes = children.filter(
    (c) => !isConnection(c) && ARTIFACT.test(bo(c)?.$type ?? '') && (!only || only.has(c.id)),
  ) as Shape[];
  const ids = new Set(nodeShapes.map((n) => n.id));
  const byId = new Map(nodeShapes.map((n) => [n.id, n]));
  const hostOf = new Map<string, string>();
  for (const s of nodeShapes)
    for (const a of (s.attachers ?? []) as Shape[]) hostOf.set(a.id, s.id);
  const inside = drawnInside(nodeShapes, artifactShapes);
  /** The levels a shape sits in, innermost first; `undefined` is `parent` itself. */
  const levels = (s: Shape): (Shape | undefined)[] => {
    const out: (Shape | undefined)[] = [];
    for (let h = inside.get(s); h; h = inside.get(h)) out.push(h);
    return [...out, undefined];
  };
  /** The shape holding `s` among the direct content of `level`. */
  const lift = (s: Shape, level: Shape | undefined): Shape => {
    let n = s;
    while (inside.get(n) !== level) n = inside.get(n)!;
    return n;
  };

  const levelOf = new Map<Shape | undefined, LContainer>();
  const level = (host: Shape | undefined): LContainer => {
    let c = levelOf.get(host);
    if (!c) {
      c = { lanes: host ? [] : lanes, nodes: [], edges: [], artifacts: [] };
      levelOf.set(host, c);
    }
    return c;
  };
  level(undefined);

  const nodes = new Map<string, LNode>();
  for (const s of nodeShapes) {
    const b = bo(s)!;
    const attachers = (s.attachers ?? []) as Shape[];
    const label = labelText(b);
    const lane = inside.has(s) ? undefined : membership.get(b);
    const node: LNode = {
      id: s.id,
      kind: kindOf(b),
      width: s.width,
      height: s.height,
      ...(label ? { label } : {}),
      ...(lane ? { lane } : {}),
      ...(b.get?.('triggeredByEvent') ? { strip: true } : {}),
    };
    if (isExpandedShape(s)) node.content = containerOf(s, false);
    if (attachers.length) {
      node.boundary = attachers.map((a): LBoundary => {
        const al = labelText(bo(a)!);
        return {
          id: a.id,
          width: a.width,
          height: a.height,
          ...(al ? { label: al } : {}),
          order: a.x + a.y / 1000,
        };
      });
    }
    nodes.set(s.id, node);
    level(inside.get(s)).nodes.push(node);
  }

  const lifted = new Set<string>();
  const flowsFrom = (s: Shape, from?: string) => {
    for (const c of s.outgoing as Connection[]) {
      if (!is(bo(c), 'bpmn:SequenceFlow') || !c.target || !ids.has(c.target.id)) continue;
      const name = bo(c)!.name as string | undefined;
      const src = from ? byId.get(hostOf.get(from)!)! : s;
      const tgt = byId.get(c.target.id)!;
      const targetLevels = levels(tgt);
      const common = levels(src).find((l) => targetLevels.includes(l));
      const ls = lift(src, common);
      const lt = lift(tgt, common);
      if (ls === src && lt === tgt) {
        level(common).edges.push({
          id: c.id,
          source: src.id,
          target: tgt.id,
          ...(name ? { label: name } : {}),
          ...(from ? { from } : {}),
        });
      } else if (ls !== lt) {
        // Places the holders; the flow itself is routed once they are placed.
        const id = `${c.id}#lifted`;
        lifted.add(id);
        level(common).edges.push({
          id,
          source: ls.id,
          target: lt.id,
          ...(from && ls === src ? { from } : {}),
        });
      }
    }
  };
  for (const s of nodeShapes) {
    flowsFrom(s);
    for (const a of (s.attachers ?? []) as Shape[]) flowsFrom(a, a.id);
  }

  // Artifacts and the flow node they are associated with.
  const anchorOf = (el: Element | undefined): string | undefined => {
    if (!el) return undefined;
    if (isConnection(el)) return anchorOf((el as Connection).source as Element | undefined);
    if (ids.has(el.id)) return el.id;
    return hostOf.get(el.id);
  };
  for (const s of artifactShapes) {
    const links = [...(s.incoming as Connection[]), ...(s.outgoing as Connection[])].filter((l) =>
      LINK.test(bo(l)?.$type ?? ''),
    );
    let anchor: string | undefined;
    const mine: string[] = [];
    for (const l of links) {
      const other = (l.source === s ? l.target : l.source) as Element | undefined;
      const a = anchorOf(other);
      if (!a) continue;
      anchor ??= a;
      if (a === anchor) mine.push(l.id);
    }
    // An artifact goes with its anchor, or stays where it is drawn.
    const at = anchor ? inside.get(byId.get(anchor)!) : inside.get(s);
    const label = labelText(bo(s)!);
    level(at).artifacts.push({
      id: s.id,
      width: s.width,
      height: s.height,
      ...(label ? { label } : {}),
      ...(anchor ? { anchor } : {}),
      links: mine,
    });
  }

  // Hand each drawn-in level to its activity (next to any content of its own).
  for (const [host, c] of levelOf) {
    if (!host) continue;
    const node = nodes.get(host.id)!;
    node.content = node.content
      ? {
          ...node.content,
          nodes: [...node.content.nodes, ...c.nodes],
          edges: [...node.content.edges, ...c.edges],
          artifacts: [...node.content.artifacts, ...c.artifacts],
        }
      : c;
  }
  return level(undefined);
}

function allShapes(el: Element): Shape[] {
  return childrenOf(el).flatMap((c) => (isConnection(c) ? [] : [c as Shape, ...allShapes(c)]));
}

/** Groups and the shapes inside them (by their center). */
function groupsOf(root: Element): LGroup[] {
  const shapes = allShapes(root);
  const members = shapes.filter(
    (s) =>
      !s.host &&
      (is(bo(s), 'bpmn:FlowNode') || ARTIFACT.test(bo(s)?.$type ?? '')) &&
      !is(bo(s), 'bpmn:BoundaryEvent'),
  );
  return shapes
    .filter((s) => is(bo(s), 'bpmn:Group'))
    .map((g) => ({
      id: g.id,
      members: members
        .filter((m) => {
          const cx = m.x + m.width / 2;
          const cy = m.y + m.height / 2;
          return cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height;
        })
        .map((m) => m.id),
    }));
}

export interface ExtractedSelection {
  diagram: LDiagram;
  vertical: boolean;
  /** Shapes laid out (flow nodes and artifacts of the selection). */
  shapes: Shape[];
  /** The area the result must stay inside: the lane, pool, sub-process or nothing. */
  frame?: { x: number; y: number; width: number; height: number };
}

/**
 * Layout input for the selected flow nodes (and selected artifacts) only, or
 * a reason why the selection cannot be laid out on its own.
 */
export function extractSelection(selected: Element[]): ExtractedSelection | string {
  const picked = new Set<Shape>();
  for (const el of selected) {
    if (isConnection(el)) continue;
    const s = el as Shape;
    const b = bo(s);
    if (s.host) picked.add(s.host as Shape);
    else if (is(b, 'bpmn:FlowNode') || ARTIFACT.test(b?.$type ?? '')) picked.add(s);
  }
  const shapes = [...picked];
  const flowNodes = shapes.filter((s) => is(bo(s), 'bpmn:FlowNode'));
  if (flowNodes.length < 2) return 'Select two or more connected shapes to lay out.';
  const parent = shapes[0]!.parent as Shape | undefined;
  if (!parent || shapes.some((s) => s.parent !== parent))
    return 'Select shapes of one pool or sub-process.';

  const lanes = childLanes(parent);
  let frame: ExtractedSelection['frame'];
  let vertical = false;
  if (lanes.length) {
    const membership = laneMembership(parent);
    const laneIds = new Set(flowNodes.map((s) => membership.get(bo(s)!)));
    if (laneIds.size > 1) return 'The selection spans several lanes; select shapes of one lane.';
    const lane = parent.children.find((c) => c.id === [...laneIds][0]) as Shape | undefined;
    vertical = !isHorizontal(lanes[0]!);
    if (lane) {
      const header = 30;
      frame = vertical
        ? { x: lane.x, y: lane.y + header, width: lane.width, height: lane.height - header }
        : { x: lane.x + header, y: lane.y, width: lane.width - header, height: lane.height };
    }
  } else if (is(bo(parent), 'bpmn:Participant')) {
    vertical = !isHorizontal(parent);
    const header = 30;
    frame = vertical
      ? { x: parent.x, y: parent.y + header, width: parent.width, height: parent.height - header }
      : { x: parent.x + header, y: parent.y, width: parent.width - header, height: parent.height };
  } else if (parent.parent && isExpandedShape(parent)) {
    frame = {
      x: parent.x + 10,
      y: parent.y + 24,
      width: parent.width - 20,
      height: parent.height - 34,
    };
  }

  // Shapes drawn inside a selected activity go with it.
  const drawn = drawnInside(
    childrenOf(parent).filter(
      (c) => is(bo(c), 'bpmn:FlowNode') && !is(bo(c), 'bpmn:BoundaryEvent') && !(c as Shape).host,
    ) as Shape[],
    childrenOf(parent).filter(
      (c) => !isConnection(c) && ARTIFACT.test(bo(c)?.$type ?? ''),
    ) as Shape[],
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const [s, host] of drawn) {
      if (picked.has(host) && !picked.has(s)) {
        picked.add(s);
        shapes.push(s);
        grew = true;
      }
    }
  }

  const ids = new Set(shapes.map((s) => s.id));
  const full = containerOf(parent, false, ids);
  const container: LContainer = {
    ...full,
    nodes: full.nodes.map((n) => ({ ...n, strip: false })),
    artifacts: full.artifacts.map((a) => {
      if (a.anchor && ids.has(a.anchor)) return a;
      const rest = { ...a, links: [] };
      delete rest.anchor;
      return rest;
    }),
  };
  return {
    diagram: { containers: [container], messages: [], groups: [], origin: { x: 0, y: 0 } },
    vertical,
    shapes,
    ...(frame ? { frame } : {}),
  };
}

/** Null when the diagram has nothing the layout can arrange. */
export function extractLayout(root: Element): Extracted | null {
  const rootBo = bo(root);
  const groups = groupsOf(root);
  if (
    is(rootBo, 'bpmn:Process') ||
    is(rootBo, 'bpmn:SubProcess') ||
    is(rootBo, 'bpmn:Choreography')
  ) {
    const container = containerOf(root as Shape, true);
    if (!container.nodes.length) return null;
    const placed = childrenOf(root).filter(
      (c) => !isConnection(c) && (is(bo(c), 'bpmn:FlowNode') || is(bo(c), 'bpmn:Lane')),
    ) as Shape[];
    const origin = placed.length
      ? { x: Math.min(...placed.map((s) => s.x)), y: Math.min(...placed.map((s) => s.y)) }
      : { x: 150, y: 80 };
    const lanes = childLanes(root as Shape);
    return {
      diagram: { containers: [container], messages: [], groups, origin },
      vertical: lanes.length > 0 && !isHorizontal(lanes[0]!),
    };
  }

  // A collaboration: its pools, stacked in their current order.
  const children = childrenOf(root);
  if (children.some((c) => is(bo(c), 'bpmn:ConversationNode'))) return null;
  const pools = children.filter((c) => is(bo(c), 'bpmn:Participant')) as Shape[];
  if (!pools.length) return null;
  const vertical = !isHorizontal(pools[0]!);
  pools.sort((a, b) => (vertical ? a.x - b.x : a.y - b.y));
  const containers = pools.map((p) => ({
    ...containerOf(p, true),
    id: p.id,
    crossSize: vertical ? p.width : p.height,
  }));
  if (!containers.some((c) => c.nodes.length)) return null;
  // A message flow ending inside a sub-process places the shape holding that
  // end; the flow itself is routed once the shapes are placed.
  const holder = new Map<string, string>();
  const hold = (n: LNode, top: string) => {
    holder.set(n.id, top);
    for (const b of n.boundary ?? []) holder.set(b.id, top);
    for (const c of n.content?.nodes ?? []) hold(c, top);
  };
  for (const c of containers)
    for (const n of c.nodes) for (const inner of n.content?.nodes ?? []) hold(inner, n.id);
  const messages: LEdge[] = children
    .filter((c) => isConnection(c) && is(bo(c), 'bpmn:MessageFlow'))
    .map((c) => {
      const m = c as Connection;
      const name = bo(m)!.name as string | undefined;
      const source = holder.get(m.source!.id) ?? m.source!.id;
      const target = holder.get(m.target!.id) ?? m.target!.id;
      if (source !== m.source!.id || target !== m.target!.id)
        return { id: `${m.id}#lifted`, source, target };
      return {
        id: m.id,
        source,
        target,
        ...(name ? { label: name } : {}),
      };
    });
  return {
    diagram: {
      containers,
      messages,
      groups,
      origin: { x: Math.min(...pools.map((p) => p.x)), y: Math.min(...pools.map((p) => p.y)) },
    },
    vertical,
  };
}

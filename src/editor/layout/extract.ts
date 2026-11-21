/** Builds the layout engine's input from the diagram shown on the canvas. */
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, isConnection, isExpandedShape } from '../model';
import { childLanes, isHorizontal } from '../modeling/laneLayout';
import { dataStateName } from '../renderer/text';
import { hasExternalLabel } from '../renderer/visuals';
import type {
  LArtifact,
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

function containerOf(parent: Shape, withLanes: boolean): LContainer {
  const lanes = withLanes ? laneTree(parent) : [];
  const membership = withLanes ? laneMembership(parent) : new Map<ModdleElement, string>();
  const children = childrenOf(parent);
  const nodeShapes = children.filter(
    (c) => is(bo(c), 'bpmn:FlowNode') && !is(bo(c), 'bpmn:BoundaryEvent') && !(c as Shape).host,
  ) as Shape[];
  const ids = new Set(nodeShapes.map((n) => n.id));
  const hostOf = new Map<string, string>();

  const nodes: LNode[] = nodeShapes.map((s) => {
    const b = bo(s)!;
    const attachers = (s.attachers ?? []) as Shape[];
    for (const a of attachers) hostOf.set(a.id, s.id);
    const label = labelText(b);
    const lane = membership.get(b);
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
    return node;
  });

  const edges: LEdge[] = [];
  const flowsFrom = (s: Shape, from?: string) => {
    for (const c of s.outgoing as Connection[]) {
      if (!is(bo(c), 'bpmn:SequenceFlow') || !c.target || !ids.has(c.target.id)) continue;
      const name = bo(c)!.name as string | undefined;
      edges.push({
        id: c.id,
        source: from ? hostOf.get(from)! : s.id,
        target: c.target.id,
        ...(name ? { label: name } : {}),
        ...(from ? { from } : {}),
      });
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
  const artifacts: LArtifact[] = children
    .filter((c) => !isConnection(c) && ARTIFACT.test(bo(c)?.$type ?? ''))
    .map((c) => {
      const s = c as Shape;
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
      const label = labelText(bo(s)!);
      return {
        id: s.id,
        width: s.width,
        height: s.height,
        ...(label ? { label } : {}),
        ...(anchor ? { anchor } : {}),
        links: mine,
      };
    });

  return { lanes, nodes, edges, artifacts };
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
  const messages: LEdge[] = children
    .filter((c) => isConnection(c) && is(bo(c), 'bpmn:MessageFlow'))
    .map((c) => {
      const m = c as Connection;
      const name = bo(m)!.name as string | undefined;
      return {
        id: m.id,
        source: m.source!.id,
        target: m.target!.id,
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

/** Builds the auto-layout input from the current diagram. */
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, is } from '@/bpmn/model/moddle';
import { bo, childrenOf } from '../model';
import { isFlowNodeShape, lanesOf } from '../modeling/semantic';
import type { LayoutContainer } from './autoLayout';

function containerOf(parent: Element, lanes: Shape[]): LayoutContainer {
  // Boundary events move with their host; artifacts and data keep their position.
  const nodes = childrenOf(parent).filter(
    (c) => isFlowNodeShape(c) && !(c as Shape).host,
  ) as Shape[];
  const ids = new Set(nodes.map((n) => n.id));
  const laneOf = (n: Shape) =>
    lanes.find((l) => getMany(bo(l), 'flowNodeRef').includes(bo(n)!))?.id ?? lanes[0]?.id;
  return {
    id: parent.parent ? parent.id : undefined,
    lanes: lanes.map((l) => l.id),
    nodes: nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      lane: lanes.length ? laneOf(n) : undefined,
    })),
    edges: nodes
      .flatMap((n) => n.outgoing as Connection[])
      .filter((c) => c.target && ids.has(c.target.id))
      .map((c) => ({ source: c.source!.id, target: c.target!.id })),
    bounds: parent.parent
      ? {
          x: (parent as Shape).x,
          y: (parent as Shape).y,
          width: (parent as Shape).width,
          height: (parent as Shape).height,
        }
      : undefined,
  };
}

export function extractLayoutContainers(root: Element): LayoutContainer[] {
  if (
    is(bo(root), 'bpmn:Process') ||
    is(bo(root), 'bpmn:SubProcess') ||
    is(bo(root), 'bpmn:Choreography')
  ) {
    return [containerOf(root, [])];
  }
  return childrenOf(root)
    .filter((c) => is(bo(c), 'bpmn:Participant'))
    .sort((a, b) => (a as Shape).y - (b as Shape).y)
    .map((p) => containerOf(p, lanesOf(p as Shape)));
}

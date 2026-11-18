/**
 * Directed graph of one process: flow nodes and the sequence flows between
 * them. Built from the BPMN semantic model only (no canvas, no React).
 */
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';

export interface GraphNode {
  id: string;
  element: ModdleElement;
  type: string;
  name?: string;
  lane?: string;
}

export interface GraphEdge {
  id: string;
  element: ModdleElement;
  source?: string;
  target?: string;
}

export interface ProcessGraph {
  process: ModdleElement;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  out: Map<string, string[]>;
  in: Map<string, string[]>;
}

function collectFlowElements(
  container: ModdleElement,
  nodes: ModdleElement[],
  flows: ModdleElement[],
): void {
  for (const el of getMany(container, 'flowElements')) {
    if (is(el, 'bpmn:SequenceFlow')) flows.push(el);
    else if (is(el, 'bpmn:FlowNode')) nodes.push(el);
  }
}

function laneMembership(process: ModdleElement): Map<ModdleElement, string> {
  const map = new Map<ModdleElement, string>();
  const visit = (laneSet: ModdleElement) => {
    for (const lane of getMany(laneSet, 'lanes')) {
      const child = getRef(lane, 'childLaneSet');
      // Deepest lane wins: visit children after assigning the parent.
      for (const node of getMany(lane, 'flowNodeRef')) map.set(node, lane.id ?? '');
      if (child) visit(child);
    }
  };
  for (const ls of getMany(process, 'laneSets')) visit(ls);
  return map;
}

export function buildProcessGraph(process: ModdleElement): ProcessGraph {
  const nodeEls: ModdleElement[] = [];
  const flowEls: ModdleElement[] = [];
  collectFlowElements(process, nodeEls, flowEls);
  const lanes = laneMembership(process);

  const graph: ProcessGraph = {
    process,
    nodes: new Map(),
    edges: [],
    out: new Map(),
    in: new Map(),
  };
  for (const el of nodeEls) {
    if (!el.id) continue;
    graph.nodes.set(el.id, {
      id: el.id,
      element: el,
      type: el.$type,
      name: el.name,
      lane: lanes.get(el),
    });
    graph.out.set(el.id, []);
    graph.in.set(el.id, []);
  }
  for (const flow of flowEls) {
    const source = getRef(flow, 'sourceRef')?.id;
    const target = getRef(flow, 'targetRef')?.id;
    graph.edges.push({ id: flow.id ?? '', element: flow, source, target });
    if (source && target && graph.nodes.has(source) && graph.nodes.has(target)) {
      graph.out.get(source)!.push(target);
      graph.in.get(target)!.push(source);
    }
  }
  return graph;
}

export function processesOf(definitions: ModdleElement): ModdleElement[] {
  return getMany(definitions, 'rootElements').filter(
    (r) => is(r, 'bpmn:Process') || is(r, 'bpmn:Choreography'),
  );
}

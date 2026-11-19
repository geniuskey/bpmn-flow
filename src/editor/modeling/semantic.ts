/**
 * Helpers that resolve BPMN containment for diagram elements.
 */
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, isExpandedShape } from '../model';

/**
 * The flow container (process or sub-process) that owns flow content placed
 * inside `parent` (root, participant, lane or expanded sub-process).
 */
export function processOf(parent: Element | undefined): ModdleElement | undefined {
  for (let p = parent; p; p = p.parent) {
    const b = bo(p);
    if (!b) continue;
    if (
      is(b, 'bpmn:Process') ||
      is(b, 'bpmn:SubProcess') ||
      is(b, 'bpmn:Choreography') ||
      is(b, 'bpmn:SubChoreography')
    ) {
      return b;
    }
    if (is(b, 'bpmn:Participant')) return getRef(b, 'processRef');
    if (is(b, 'bpmn:Collaboration')) return undefined;
  }
  return undefined;
}

export function participantOf(element: Element | undefined): Shape | undefined {
  for (let p = element; p; p = p.parent) if (is(bo(p), 'bpmn:Participant')) return p as Shape;
  return undefined;
}

export function lanesOf(participant: Shape | undefined): Shape[] {
  if (!participant) return [];
  return childrenOf(participant)
    .filter((c) => is(bo(c), 'bpmn:Lane'))
    .sort((a, b) => (a as Shape).y - (b as Shape).y) as Shape[];
}

/** All lanes of a process including nested child lane sets. */
export function allLanes(process: ModdleElement | undefined): ModdleElement[] {
  const out: ModdleElement[] = [];
  const visit = (laneSet: ModdleElement) => {
    for (const lane of getMany(laneSet, 'lanes')) {
      out.push(lane);
      const child = getRef(lane, 'childLaneSet');
      if (child) visit(child);
    }
  };
  for (const ls of getMany(process, 'laneSets')) visit(ls);
  return out;
}

export function isFlowNodeShape(element: Element): boolean {
  return is(bo(element), 'bpmn:FlowNode');
}

export function contains(
  outer: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
): boolean {
  return x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
}

export function center(shape: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** Where artifacts (annotations, groups, associations) placed in `parent` are stored. */
export function artifactContainerOf(
  parent: Element | undefined,
  root: Element,
): ModdleElement | undefined {
  return processOf(parent) ?? bo(root);
}

/** Sub-process shapes that show their content (BPMN DI isExpanded). */
export function isExpandedContainer(el: Element): boolean {
  return isExpandedShape(el);
}

/** Shapes that can hold flow content: pools and expanded sub-processes (and lanes via their pool). */
export function isContainerShape(el: Element): boolean {
  return is(bo(el), 'bpmn:Participant') || isExpandedContainer(el);
}

/**
 * The innermost container whose bounds fully contain `box`: an expanded
 * sub-process, a pool, or the root when the diagram is a plain process.
 */
export function containerAt(
  root: Element,
  box: { x: number; y: number; width: number; height: number },
  exclude: Set<Element> = new Set(),
): Element | undefined {
  const inside = (s: Shape) =>
    contains(s, box.x, box.y) && contains(s, box.x + box.width, box.y + box.height);
  const rootBo = bo(root);
  let best: Element | undefined =
    is(rootBo, 'bpmn:Process') || is(rootBo, 'bpmn:SubProcess') || is(rootBo, 'bpmn:Choreography')
      ? root
      : undefined;
  const visit = (parent: Element) => {
    for (const child of childrenOf(parent)) {
      if (exclude.has(child) || !isContainerShape(child) || !inside(child as Shape)) continue;
      best = child;
      visit(child);
    }
  };
  visit(root);
  return best;
}

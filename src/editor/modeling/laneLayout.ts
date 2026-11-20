/**
 * Geometry of pools and lanes. A pool is horizontal (name band on the left,
 * lanes stacked top to bottom) or vertical (name band on top, lanes side by
 * side), BPMNShape isHorizontal (BPMN 2.0.2 PDF 403, Tables 12.25 / 12.26).
 * Lanes form a tree: the lanes of the process's lane set, and the lanes of
 * each lane's childLaneSet (nested lanes, PDF 334). A lane with sub-lanes has
 * its own name band; its sub-lanes fill the rest of it.
 *
 * "Cross" is the direction lanes are stacked in (y for horizontal pools, x for
 * vertical ones); "main" is the direction a lane runs.
 */
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import { getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, type BpmnData } from '../model';
import { participantOf } from './semantic';

/** Width of the name band of pools and of lanes with sub-lanes. */
export const HEADER = 30;
/** Smallest extent of a lane across its direction. */
export const MIN_LANE = 60;
/** Smallest extent of a pool along its direction. */
export const MIN_POOL_LENGTH = 200;

export type Bounds = { x: number; y: number; width: number; height: number };
export interface Span {
  start: number;
  size: number;
}

export function isLane(el: Element | undefined): el is Shape {
  return !!el && is(bo(el), 'bpmn:Lane');
}

/**
 * Whether the pool (or the pool of a lane) is horizontal. Lanes outside a pool
 * use their own DI. A missing isHorizontal counts as horizontal.
 */
export function isHorizontal(el: Element): boolean {
  const owner = is(bo(el), 'bpmn:Participant') ? el : (participantOf(el) ?? el);
  return (owner as Partial<BpmnData>).di?.get('isHorizontal') !== false;
}

export function cross(b: Bounds, horizontal: boolean): Span {
  return horizontal ? { start: b.y, size: b.height } : { start: b.x, size: b.width };
}

export function along(b: Bounds, horizontal: boolean): Span {
  return horizontal ? { start: b.x, size: b.width } : { start: b.y, size: b.height };
}

export function end(span: Span): number {
  return span.start + span.size;
}

export function boundsOf(main: Span, crossSpan: Span, horizontal: boolean): Bounds {
  return horizontal
    ? { x: main.start, y: crossSpan.start, width: main.size, height: crossSpan.size }
    : { x: crossSpan.start, y: main.start, width: crossSpan.size, height: main.size };
}

/** A move by `d` across the lanes. */
export function crossDelta(d: number, horizontal: boolean): { x: number; y: number } {
  return horizontal ? { x: 0, y: d } : { x: d, y: 0 };
}

/** The area of a pool or lane next to its name band, where its lanes go. */
export function contentBounds(container: Shape): Bounds {
  const h = isHorizontal(container);
  const main = along(container, h);
  return boundsOf({ start: main.start + HEADER, size: main.size - HEADER }, cross(container, h), h);
}

/** The diagram element lane shapes of `container` are children of: the pool, or the root. */
function laneHost(container: Shape): Element | undefined {
  return is(bo(container), 'bpmn:Lane') ? container.parent : container;
}

/**
 * Direct lanes of a pool (the lanes of its process's lane sets) or of a lane
 * (the lanes of its childLaneSet), in stacking order.
 */
export function childLanes(container: Shape): Shape[] {
  const b = bo(container);
  const lanes = childrenOf(laneHost(container)).filter(isLane) as Shape[];
  let kids: Shape[];
  if (is(b, 'bpmn:Lane')) {
    const set = getRef(b!, 'childLaneSet');
    kids = set ? lanes.filter((l) => bo(l)!.$parent === set) : [];
  } else {
    kids = lanes.filter((l) => !is(bo(l)!.$parent?.$parent, 'bpmn:Lane'));
  }
  const h = kids.length ? isHorizontal(kids[0]!) : true;
  return kids.sort((a, z) => cross(a, h).start - cross(z, h).start);
}

/** The lane whose childLaneSet holds `lane`, if any. */
export function parentLane(lane: Shape): Shape | undefined {
  const owner = bo(lane)?.$parent?.$parent;
  if (!owner || !is(owner, 'bpmn:Lane')) return undefined;
  return childrenOf(lane.parent).find((c) => bo(c) === owner) as Shape | undefined;
}

/** Lanes that enclose `lane`, innermost first. */
export function laneAncestors(lane: Shape): Shape[] {
  const out: Shape[] = [];
  for (let p = parentLane(lane); p; p = parentLane(p)) out.push(p);
  return out;
}

/** Sub-lanes of `lane` at any depth. */
export function laneDescendants(lane: Shape): Shape[] {
  return childLanes(lane).flatMap((c) => [c, ...laneDescendants(c)]);
}

/** The lane-tree container of `lane`: its parent lane, its pool, or the process diagram. */
export function laneContainer(lane: Shape): Shape | undefined {
  return parentLane(lane) ?? (lane.parent as Shape | undefined);
}

/**
 * Smallest extent of a lane when its `side` edge moves: a lane without
 * sub-lanes needs MIN_LANE; otherwise the sub-lane at that side absorbs the
 * change and the others keep their size.
 */
export function minLaneExtent(lane: Shape, side: 'start' | 'end'): number {
  const kids = childLanes(lane);
  if (!kids.length) return MIN_LANE;
  const h = isHorizontal(lane);
  const edge = side === 'start' ? kids[0]! : kids[kids.length - 1]!;
  const others = kids.filter((k) => k !== edge).reduce((sum, k) => sum + cross(k, h).size, 0);
  return others + minLaneExtent(edge, side);
}

/**
 * Whether a pool or lane with lanes may take `next` bounds: its first lane
 * absorbs a move of the start edge, its last lane a move of the end edge.
 */
export function lanesFit(container: Shape, next: Bounds): boolean {
  const kids = childLanes(container);
  if (!kids.length) return true;
  const h = isHorizontal(container);
  const before = cross(container, h);
  const after = cross(next, h);
  const dStart = after.start - before.start;
  const dEnd = end(after) - end(before);
  const first = kids[0]!;
  const last = kids[kids.length - 1]!;
  if (first === last) {
    const size = cross(first, h).size - dStart + dEnd;
    return size >= Math.max(minLaneExtent(first, 'start'), minLaneExtent(first, 'end'));
  }
  return (
    cross(first, h).size - dStart >= minLaneExtent(first, 'start') &&
    cross(last, h).size + dEnd >= minLaneExtent(last, 'end')
  );
}

/** Position of `shape` across the lanes: a lane's start edge, another shape's center. */
export function crossPosition(shape: Shape, horizontal: boolean): number {
  const c = cross(shape, horizontal);
  return isLane(shape) ? c.start : c.start + c.size / 2;
}

/** A new lane shape's semantic placement (see shapeSync): parent lane and the lane it follows. */
export interface LanePlacement {
  bfParentLane?: ModdleElement;
  bfAfterLane?: ModdleElement;
}

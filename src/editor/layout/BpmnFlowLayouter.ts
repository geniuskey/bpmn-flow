/**
 * Orthogonal connection layout built on diagram-js' generic Manhattan helpers.
 * Waypoints are cropped to the shape outlines so DI ends on the shape border.
 */
import BaseLayouter from 'diagram-js/lib/layout/BaseLayouter';
import { getElementLineIntersection, getMid } from 'diagram-js/lib/layout/LayoutUtil';
import { repairConnection, withoutRedundantPoints } from 'diagram-js/lib/layout/ManhattanLayout';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import type { Point } from '@/bpmn/di/di';
import { is } from '@/bpmn/model/moddle';
import { bo } from '../model';
import { outlinePath, polylinePath } from '../renderer/geometry';
import { outlineFor } from '../renderer/visuals';

type LayoutHints = NonNullable<Parameters<BaseLayouter['layoutConnection']>[1]>;

function preferredLayouts(source: Element, target: Element): string[] {
  if (is(bo(source), 'bpmn:Gateway')) return ['v:h'];
  if (is(bo(target), 'bpmn:Gateway')) return ['h:v'];
  return ['h:h'];
}

function shapeOutline(shape: Shape): string {
  const b = bo(shape);
  return outlinePath(b ? outlineFor(b) : 'rect', shape);
}

export function cropWaypoints(points: Point[], source: Shape, target: Shape): Point[] {
  if (points.length < 2) return points;
  const line = polylinePath(points);
  const start = getElementLineIntersection(shapeOutline(source), line, true) ?? points[0]!;
  const end =
    getElementLineIntersection(shapeOutline(target), line, false) ?? points[points.length - 1]!;
  return [start, ...points.slice(1, -1), end];
}

export default class BpmnFlowLayouter extends BaseLayouter {
  override layoutConnection(connection: Connection, hints: LayoutHints = {}): Point[] {
    const source = (hints.source ?? connection.source) as Shape | undefined;
    const target = (hints.target ?? connection.target) as Shape | undefined;
    if (!source || !target) return connection.waypoints;

    const start = getMid(source);
    const end = getMid(target);
    const raw = repairConnection(source, target, start, end, connection.waypoints, {
      preferredLayouts: is(bo(connection), 'bpmn:MessageFlow')
        ? ['v:v']
        : preferredLayouts(source, target),
      connectionStart: !!hints.connectionStart,
      connectionEnd: !!hints.connectionEnd,
    }) as Point[];
    return cropWaypoints(withoutRedundantPoints(raw) as Point[], source, target);
  }
}

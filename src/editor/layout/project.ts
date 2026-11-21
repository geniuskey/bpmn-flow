/**
 * Writes a computed layout straight into the DI of a document copy, without
 * commands: used by the read-only reflow view, which shows a re-laid-out copy
 * and never exports it.
 */
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { writeBounds, writeWaypoints, type Point } from '@/bpmn/di/di';
import { getRef, is, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, isConnection, type BpmnData } from '../model';
import type { Box, EngineResult } from './engine';

function allElements(el: Element): Element[] {
  return childrenOf(el).flatMap((c) => [c, ...allElements(c)]);
}

function writeLabel(moddle: BpmnModdleInstance, di: ModdleElement, b: Box): void {
  let label = getRef(di, 'label');
  if (!label) {
    label = moddle.create('bpmndi:BPMNLabel', {});
    label.$parent = di;
    di.set('label', label);
  }
  const bounds = moddle.create('dc:Bounds', { ...b });
  bounds.$parent = label;
  label.set('bounds', bounds);
}

/** Straight line between two boxes, from border to border. */
function straight(a: Box, b: Box): Point[] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const crop = (box: Box, from: Point, to: Point): Point => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (!dx && !dy) return from;
    const tx = dx ? box.width / 2 / Math.abs(dx) : Infinity;
    const ty = dy ? box.height / 2 / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty, 1);
    return { x: Math.round(from.x + dx * t), y: Math.round(from.y + dy * t) };
  };
  return [crop(a, ca, cb), crop(b, cb, ca)];
}

/**
 * Applies `result` to the DI of the elements under `root`. `horizontal` sets
 * the orientation of pools and lanes (the reflow view may turn them).
 */
export function writeLayoutToDi(
  moddle: BpmnModdleInstance,
  root: Element,
  result: EngineResult,
  horizontal: boolean,
): void {
  const elements = allElements(root);
  const boxOf = (el: Element | undefined): Box | undefined => {
    if (!el || isConnection(el)) return undefined;
    const s = el as Shape;
    return result.shapes[s.id] ?? { x: s.x, y: s.y, width: s.width, height: s.height };
  };
  for (const el of elements) {
    const di = (el as Partial<BpmnData>).di;
    if (!di) continue;
    if (isConnection(el)) {
      const c = el as Connection;
      const given = result.connections[c.id];
      const ends = [boxOf(c.source as Element), boxOf(c.target as Element)];
      const moved = [c.source, c.target].some((e) => e && result.shapes[e.id]);
      const straightLine = /^bpmn:(Association|DataInputAssociation|DataOutputAssociation)$/.test(
        bo(c)?.$type ?? '',
      );
      if (given && straightLine && ends[0] && ends[1])
        writeWaypoints(moddle, di, straight(ends[0], ends[1]));
      else if (given) writeWaypoints(moddle, di, given);
      else if (moved && ends[0] && ends[1]) writeWaypoints(moddle, di, straight(ends[0], ends[1]));
    } else {
      const box = result.shapes[el.id];
      if (box) writeBounds(moddle, di, box);
      if (is(bo(el), 'bpmn:Participant') || is(bo(el), 'bpmn:Lane'))
        di.set('isHorizontal', horizontal);
    }
    const label = result.labels[el.id];
    if (label) writeLabel(moddle, di, label);
    else if (!isConnection(el) && result.shapes[el.id]) {
      // A label the layout does not place moves with its shape.
      const old = getRef(getRef(di, 'label'), 'bounds') as
        (ModdleElement & Partial<Box>) | undefined;
      const s = el as Shape;
      const box = result.shapes[el.id]!;
      if (old) {
        old.set('x', (old.x ?? 0) + box.x - s.x);
        old.set('y', (old.y ?? 0) + box.y - s.y);
      }
    }
  }
}

/** Finds a free spot to the right of `source` for an appended shape. */
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type { Shape } from 'diagram-js/lib/model/Types';
import { childrenOf } from '../model';

const GAP_X = 80;
const STEP_Y = 110;

function overlaps(a: { x: number; y: number; width: number; height: number }, b: Shape): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function findFreePosition(
  source: Shape,
  shape: { width: number; height: number },
  registry: ElementRegistry,
): { x: number; y: number } {
  const siblings = childrenOf(source.parent).filter(
    (c) =>
      !(c as { waypoints?: unknown }).waypoints &&
      c !== source &&
      !/Lane$|Participant$/.test(String(c.type)),
  ) as Shape[];
  void registry;
  const cx = source.x + source.width + GAP_X + shape.width / 2;
  const baseY = source.y + source.height / 2;
  for (let i = 0; i < 12; i++) {
    const offset = i === 0 ? 0 : Math.ceil(i / 2) * STEP_Y * (i % 2 ? 1 : -1);
    const cy = baseY + offset;
    const box = {
      x: cx - shape.width / 2 - 10,
      y: cy - shape.height / 2 - 10,
      width: shape.width + 20,
      height: shape.height + 20,
    };
    if (!siblings.some((s) => overlaps(box, s))) return { x: cx, y: cy };
  }
  return { x: cx, y: baseY };
}

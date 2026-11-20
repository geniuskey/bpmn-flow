/**
 * Align and distribute: moves several shapes as one undoable command. Each
 * shape is moved with `elements.move`, so boundary events, lane membership and
 * container changes follow the same behaviors as a mouse drag.
 */
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Shape } from 'diagram-js/lib/model/Types';

export const ARRANGE_ELEMENTS = 'elements.arrange';

import type { Alignment, DistributeAxis } from '../types';

export type { Alignment, DistributeAxis };

export interface ArrangeMove {
  shape: Shape;
  delta: { x: number; y: number };
}

/** Moves that line the shapes up on one edge or center of their common bounds. */
export function alignMoves(shapes: Shape[], type: Alignment): ArrangeMove[] {
  if (shapes.length < 2) return [];
  const vertical = type === 'top' || type === 'middle' || type === 'bottom';
  const pos = (s: Shape) => (vertical ? s.y : s.x);
  const size = (s: Shape) => (vertical ? s.height : s.width);
  const min = Math.min(...shapes.map(pos));
  const max = Math.max(...shapes.map((s) => pos(s) + size(s)));
  const target = (s: Shape) =>
    type === 'left' || type === 'top'
      ? min
      : type === 'right' || type === 'bottom'
        ? max - size(s)
        : Math.round((min + max) / 2 - size(s) / 2);
  return toMoves(shapes, (s) => target(s) - pos(s), vertical);
}

/**
 * Moves that leave equal gaps between the shapes along an axis; the first and
 * the last shape stay where they are.
 */
export function distributeMoves(shapes: Shape[], axis: DistributeAxis): ArrangeMove[] {
  if (shapes.length < 3) return [];
  const vertical = axis === 'vertical';
  const pos = (s: Shape) => (vertical ? s.y : s.x);
  const size = (s: Shape) => (vertical ? s.height : s.width);
  const sorted = [...shapes].sort((a, b) => pos(a) + size(a) / 2 - (pos(b) + size(b) / 2));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sorted.reduce((sum, s) => sum + size(s), 0)) / (sorted.length - 1);
  const targets = new Map<Shape, number>();
  let cursor = pos(first);
  for (const s of sorted) {
    targets.set(s, Math.round(cursor));
    cursor += size(s) + gap;
  }
  return toMoves(shapes, (s) => targets.get(s)! - pos(s), vertical);
}

function toMoves(shapes: Shape[], offset: (s: Shape) => number, vertical: boolean): ArrangeMove[] {
  return shapes
    .map((shape) => {
      const d = offset(shape);
      return { shape, delta: vertical ? { x: 0, y: d } : { x: d, y: 0 } };
    })
    .filter((m) => m.delta.x !== 0 || m.delta.y !== 0);
}

export default class ArrangeHandler {
  static $inject = ['modeling'];

  constructor(private readonly modeling: Modeling) {}

  preExecute(context: { moves: ArrangeMove[] }): void {
    for (const { shape, delta } of context.moves) this.modeling.moveElements([shape], delta);
  }

  execute(): [] {
    return [];
  }

  revert(): [] {
    return [];
  }
}

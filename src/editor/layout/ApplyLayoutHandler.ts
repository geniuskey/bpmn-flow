/**
 * Applies a computed layout as one undoable command: pools and lanes are
 * resized, flow nodes moved with their boundary events (labels follow through
 * DiSync), data and artifacts moved with their pool, and sequence flows
 * re-routed orthogonally.
 */
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Shape } from 'diagram-js/lib/model/Types';
import { is } from '@/bpmn/model/moddle';
import { bo, childrenOf } from '../model';
import type BpmnFlowLayouter from './BpmnFlowLayouter';

export const APPLY_LAYOUT = 'layout.apply';

import type { Box, LayoutResult } from '../types';

export type { Box, LayoutResult };

export class ApplyLayoutHandler {
  static $inject = ['modeling', 'elementRegistry', 'layouter'];

  constructor(
    private readonly modeling: Modeling,
    private readonly registry: ElementRegistry,
    private readonly layouter: BpmnFlowLayouter,
  ) {}

  preExecute(context: { layout: LayoutResult }): void {
    const hints = { lanesHandled: true };
    const entries = Object.entries(context.layout.shapes)
      .map(([id, box]) => ({ shape: this.registry.get(id) as Shape | undefined, box }))
      .filter((e): e is { shape: Shape; box: Box } => !!e.shape);

    const rank = (s: Shape) => (is(bo(s), 'bpmn:Participant') ? 0 : is(bo(s), 'bpmn:Lane') ? 1 : 2);
    entries.sort((a, b) => rank(a.shape) - rank(b.shape));

    const laidOut = new Set(entries.map((e) => e.shape));
    const moveBy = (shape: Shape, delta: { x: number; y: number }) =>
      this.modeling.moveShape(shape, delta, undefined, undefined, hints);

    for (const { shape, box } of entries) {
      const delta = { x: box.x - shape.x, y: box.y - shape.y };
      const moved = delta.x !== 0 || delta.y !== 0;
      if (rank(shape) === 0) {
        // Content the layout does not place (data, annotations, groups) moves with its pool.
        const passengers = childrenOf(shape).filter(
          (c) =>
            !(c as Connection).waypoints && !laidOut.has(c as Shape) && !is(bo(c), 'bpmn:Lane'),
        ) as Shape[];
        this.modeling.resizeShape(shape, box, undefined, hints);
        if (moved) for (const p of passengers.filter((p) => !p.host)) moveBy(p, delta);
      } else if (rank(shape) === 1) {
        this.modeling.resizeShape(shape, box, undefined, hints);
      } else if (moved) {
        moveBy(shape, delta);
        // `shape.move` does not carry boundary events (only `elements.move` does).
        for (const attacher of (shape.attachers ?? []) as Shape[]) moveBy(attacher, delta);
      }
    }

    const connections = new Set<Connection>();
    for (const { shape } of entries) {
      const attached = (shape.attachers ?? []) as Shape[];
      for (const s of [shape, ...attached]) {
        for (const c of [...s.incoming, ...s.outgoing] as Connection[]) connections.add(c);
      }
    }
    for (const c of connections) {
      if (!c.source || !c.target) continue;
      const waypoints = this.layouter.layoutConnection({ ...c, waypoints: [] } as Connection, {
        source: c.source,
        target: c.target,
      });
      this.modeling.updateWaypoints(c, waypoints);
    }
  }

  execute(): [] {
    return [];
  }

  revert(): [] {
    return [];
  }
}

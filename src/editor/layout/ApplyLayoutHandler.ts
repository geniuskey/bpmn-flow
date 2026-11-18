/**
 * Applies a computed layout as one undoable command: pools and lanes are
 * resized, flow nodes moved (labels follow through DiSync), and sequence flows
 * re-routed orthogonally.
 */
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Shape } from 'diagram-js/lib/model/Types';
import { is } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnFlowLayouter from './BpmnFlowLayouter';

export const APPLY_LAYOUT = 'layout.apply';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  /** Target bounds by element id (pools, lanes and flow nodes). */
  shapes: Record<string, Box>;
}

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

    for (const { shape, box } of entries) {
      if (rank(shape) < 2) {
        this.modeling.resizeShape(shape, box, undefined, hints);
      } else if (box.x !== shape.x || box.y !== shape.y) {
        this.modeling.moveShape(
          shape,
          { x: box.x - shape.x, y: box.y - shape.y },
          undefined,
          undefined,
          hints,
        );
      }
    }

    const connections = new Set<Connection>();
    for (const { shape } of entries) {
      for (const c of [...shape.incoming, ...shape.outgoing] as Connection[]) connections.add(c);
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

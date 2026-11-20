/**
 * `pool.setBoundary`: shows the main pool of a collaboration with or without
 * its boundary. "One and only one Pool in a diagram MAY be presented without a
 * boundary" (BPMN 2.0.2 §9.3, PDF 141-143, Fig 9.5): its process content is
 * then drawn directly on the diagram. Hiding removes the pool's BPMNShape and
 * moves its content onto the diagram; showing creates a BPMNShape around that
 * content and moves it back in. The semantic model does not change.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import {
  getMany,
  getRef,
  is,
  type BpmnModdleInstance,
  type ModdleElement,
} from '@/bpmn/model/moddle';
import { bo, childrenOf, rootOf, type BpmnData } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import { HEADER } from '../modeling/laneLayout';
import { boundlessParticipant } from '../modeling/semantic';

export const SET_POOL_BOUNDARY = 'pool.setBoundary';

const PADDING = 50;

/** Why `pool` cannot be shown without its boundary, or null when it can. */
export function hideBoundaryBlocker(pool: Element | undefined): string | null {
  const participant = pool && bo(pool);
  if (!pool || !participant || !is(participant, 'bpmn:Participant')) return 'Not a pool.';
  const root = pool.parent;
  if (!root || root.parent || !is(bo(root), 'bpmn:Collaboration')) return 'Not a pool.';
  if (!getRef(participant, 'processRef')) return 'A black-box pool has no content to show.';
  if (childrenOf(pool).some((c) => is(bo(c), 'bpmn:Lane'))) {
    return 'A pool with lanes keeps its boundary.';
  }
  if ((pool.incoming ?? []).length || (pool.outgoing ?? []).length) {
    return 'Connect the message flows to the pool’s content first.';
  }
  const plane = (root as Partial<BpmnData>).di;
  const drawn = new Set(getMany(plane, 'planeElement').map((di) => getRef(di, 'bpmnElement')));
  const otherShapeless = getMany(bo(root), 'participants').some(
    (p) => p !== participant && getRef(p, 'processRef') && !drawn.has(p),
  );
  if (otherShapeless) return 'Another pool is already shown without its boundary.';
  return null;
}

/** The process that owns a model element (flow content, artifacts, process data inputs / outputs). */
function owningProcess(el: ModdleElement | undefined): ModdleElement | undefined {
  for (let p = el?.$parent; p; p = p.$parent) if (is(p, 'bpmn:Process')) return p;
  return undefined;
}

interface Context {
  /** The pool shape (hide) or, when showing, the participant drawn without boundary. */
  element?: Shape;
  participant?: ModdleElement;
  visible: boolean;
  pool?: Shape;
  index?: number;
  log?: ChangeLog;
}

export default class PoolBoundaryHandler {
  static $inject = ['canvas', 'modeling', 'elementFactory', 'moddle'];
  constructor(
    private readonly canvas: Canvas,
    private readonly modeling: Modeling,
    private readonly factory: BpmnElementFactory,
    private readonly moddle: BpmnModdleInstance,
  ) {}

  preExecute(context: Context): void {
    if (context.visible) return;
    const pool = context.element;
    const blocker = hideBoundaryBlocker(pool);
    if (blocker) throw new Error(blocker);
    const root = pool!.parent!;
    // The content goes onto the diagram where it is.
    for (const child of [...childrenOf(pool)]) {
      if ((child as Connection).waypoints) {
        this.modeling.moveConnection(child as Connection, { x: 0, y: 0 }, root);
      } else {
        this.modeling.moveShape(child as Shape, { x: 0, y: 0 }, root as Shape);
      }
    }
    context.pool = pool;
  }

  execute(context: Context): Element[] {
    const root = rootOf(this.canvas);
    const plane = (root as unknown as BpmnData).di;
    const planeElements = plane.get('planeElement') as ModdleElement[];
    const log = new ChangeLog();
    if (!context.visible) {
      const pool = context.pool!;
      const di = (pool as unknown as BpmnData).di;
      context.index = childrenOf(root).indexOf(pool);
      log.remove(planeElements, di);
      log.apply(
        () => this.canvas.removeShape(pool),
        () => this.canvas.addShape(pool, root as Shape, context.index),
      );
    } else {
      const participant = boundlessParticipant(root);
      if (!participant || (context.participant && participant !== context.participant)) {
        throw new Error('No pool is shown without its boundary.');
      }
      const pool = (context.pool ??= this.createPool(participant, root));
      log.insert(planeElements, (pool as unknown as BpmnData).di, 0);
      log.setParent((pool as unknown as BpmnData).di, plane);
      log.apply(
        () => this.canvas.addShape(pool, root as Shape, 0),
        () => this.canvas.removeShape(pool),
      );
    }
    context.log = log;
    return [];
  }

  postExecute(context: Context): void {
    if (!context.visible) return;
    const pool = context.pool!;
    const process = getRef(bo(pool), 'processRef');
    for (const child of this.contentOf(process, pool.parent!)) {
      if ((child as Connection).waypoints) {
        this.modeling.moveConnection(child as Connection, { x: 0, y: 0 }, pool);
      } else {
        this.modeling.moveShape(child as Shape, { x: 0, y: 0 }, pool);
      }
    }
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [];
  }

  /** Diagram children of the root that belong to `process`: its flow content and artifacts. */
  private contentOf(process: ModdleElement | undefined, root: Element): Element[] {
    return childrenOf(root).filter((c) => {
      const b = bo(c);
      if (!b || is(b, 'bpmn:Participant') || is(b, 'bpmn:ConversationNode')) return false;
      // Message flows, associations and data associations stay on the diagram.
      if ((c as Connection).waypoints && !is(b, 'bpmn:SequenceFlow')) return false;
      return owningProcess(b) === process;
    });
  }

  /** A pool shape (with a new BPMNShape) around the content drawn on the diagram. */
  private createPool(participant: ModdleElement, root: Element): Shape {
    const process = getRef(participant, 'processRef');
    const shapes = this.contentOf(process, root).filter(
      (c) => !(c as Connection).waypoints,
    ) as Shape[];
    let bounds = { x: 100, y: 100, width: 600, height: 250 };
    if (shapes.length) {
      const minX = Math.min(...shapes.map((s) => s.x));
      const minY = Math.min(...shapes.map((s) => s.y));
      const maxX = Math.max(...shapes.map((s) => s.x + s.width));
      const maxY = Math.max(...shapes.map((s) => s.y + s.height));
      bounds = {
        x: minX - PADDING - HEADER,
        y: minY - PADDING,
        width: maxX - minX + 2 * PADDING + HEADER,
        height: maxY - minY + 2 * PADDING,
      };
    }
    const di = this.moddle.create('bpmndi:BPMNShape', {
      id: `${participant.id}_di`,
      bpmnElement: participant,
      isHorizontal: true,
      bounds: this.moddle.create('dc:Bounds', bounds),
    });
    return this.factory.createShape({
      id: participant.id,
      type: participant.$type,
      businessObject: participant,
      di,
      ...bounds,
    }) as Shape;
  }
}

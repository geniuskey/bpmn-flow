/**
 * Modeling behaviors for pools and lanes:
 * - flow content dropped on a lane is parented to the lane's pool
 * - the first pool on a process diagram converts it to a collaboration and wraps
 *   the existing content
 * - resizing a pool keeps its lanes aligned; resizing a lane grows/shrinks the pool
 * - deleting a lane closes the gap
 * - lane membership (`flowNodeRef`) follows node positions after every change
 */
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { is } from '@/bpmn/model/moddle';
import { bo, childrenOf, rootOf } from '../model';
import { POOL_BAND, ROOT_TO_COLLABORATION, UPDATE_LANES } from '../commands/StructureHandlers';
import { center, containerAt, isFlowNodeShape, lanesOf, participantOf } from './semantic';

type Bounds = { x: number; y: number; width: number; height: number };
type Hints = { lanesHandled?: boolean; wrapProcess?: boolean };

const WRAP_PADDING = 50;

export default class StructureBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'canvas', 'modeling', 'commandStack'];

  constructor(
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly modeling: Modeling,
    private readonly commandStack: CommandStack,
  ) {
    super(eventBus);

    // Lanes are not containers in the diagram: flow content lives in the pool.
    const toContainer = (parent: Element | undefined): Element | undefined =>
      parent && is(bo(parent), 'bpmn:Lane') ? participantOf(parent) : parent;

    this.preExecute(
      ['shape.create', 'elements.create'],
      2000,
      (e: { context: { parent?: Element; shape?: Shape } }) => {
        const shape = e.context.shape;
        if (shape && is(bo(shape), 'bpmn:Lane')) return;
        e.context.parent = toContainer(e.context.parent);
      },
    );
    this.preExecute(
      'connection.create',
      2000,
      (e: { context: { parent?: Element; source: Element; connection: Connection } }) => {
        // Only sequence flows belong to a container; message flows, associations and
        // data associations are drawn on the root.
        e.context.parent = is(bo(e.context.connection), 'bpmn:SequenceFlow')
          ? (e.context.source.parent ?? e.context.parent)
          : rootOf(this.canvas);
      },
    );
    this.preExecute(
      'elements.move',
      2000,
      (e: {
        context: { newParent?: Element; shapes: Element[]; delta: { x: number; y: number } };
      }) => {
        const { shapes, delta, hints } = e.context as typeof e.context & {
          hints?: { attach?: boolean };
        };
        // Attaching a boundary event: diagram-js re-parents it to the host's parent itself.
        if (hints?.attach) return;
        // Content that changes container (pool or sub-process) gets it as new parent;
        // the destination is determined by geometry, not by the element under the cursor.
        const moved = new Set(shapes);
        const node = shapes.find(
          (s) => (isFlowNodeShape(s) || is(bo(s), 'bpmn:DataStoreReference')) && !(s as Shape).host,
        ) as Shape | undefined;
        if (node) {
          const dest = containerAt(
            rootOf(this.canvas),
            { x: node.x + delta.x, y: node.y + delta.y, width: node.width, height: node.height },
            moved,
          );
          e.context.newParent = dest && dest !== toContainer(node.parent) ? dest : undefined;
          return;
        }
        // Pools and artifacts keep their parent.
        e.context.newParent = undefined;
      },
    );

    this.preExecute('shape.create', (e: { context: { shape: Shape; hints?: Hints } }) => {
      const shape = e.context.shape;
      const participant = bo(shape);
      if (!participant || !is(participant, 'bpmn:Participant')) return;
      const root = bo(rootOf(this.canvas));
      if (is(root, 'bpmn:Process')) {
        this.commandStack.execute(ROOT_TO_COLLABORATION, {});
        participant.set('processRef', root);
        e.context.hints = { ...e.context.hints, wrapProcess: true };
      }
    });

    this.postExecute('shape.create', (e: { context: { shape: Shape; hints?: Hints } }) => {
      if (e.context.hints?.wrapProcess) this.wrapContent(e.context.shape);
    });

    this.postExecute(
      'shape.resize',
      (e: { context: { shape: Shape; oldBounds: Bounds; hints?: Hints } }) => {
        const { shape, oldBounds, hints } = e.context;
        if (hints?.lanesHandled) return;
        if (is(bo(shape), 'bpmn:Participant')) this.fitLanesToPool(shape, oldBounds);
        else if (is(bo(shape), 'bpmn:Lane')) this.growPoolForLane(shape, oldBounds);
      },
    );

    this.postExecute(
      'shape.delete',
      (e: { context: { shape: Shape; oldParent: Shape; hints?: Hints } }) => {
        const { shape, oldParent, hints } = e.context;
        if (!hints?.lanesHandled && is(bo(shape), 'bpmn:Lane')) this.closeLaneGap(shape, oldParent);
      },
    );

    this.postExecuted(
      [
        'elements.move',
        'shape.create',
        'elements.create',
        'shape.resize',
        'shape.delete',
        'lane.add',
        'layout.apply',
      ],
      500,
      () => this.updateLanes(),
    );
  }

  private updateLanes(): void {
    for (const child of childrenOf(rootOf(this.canvas))) {
      if (is(bo(child), 'bpmn:Participant') && lanesOf(child as Shape).length) {
        this.commandStack.execute(UPDATE_LANES, { participant: child });
      }
    }
  }

  private wrapContent(participant: Shape): void {
    const root = rootOf(this.canvas);
    const others = childrenOf(root).filter(
      (c) => c !== participant && !is(bo(c), 'bpmn:Participant'),
    );
    const shapes = others.filter((c) => !(c as Connection).waypoints) as Shape[];
    if (!shapes.length) return;
    const minX = Math.min(...shapes.map((s) => s.x));
    const minY = Math.min(...shapes.map((s) => s.y));
    const maxX = Math.max(...shapes.map((s) => s.x + s.width));
    const maxY = Math.max(...shapes.map((s) => s.y + s.height + (isFlowNodeShape(s) ? 30 : 0)));
    this.modeling.resizeShape(
      participant,
      {
        x: minX - WRAP_PADDING - POOL_BAND,
        y: minY - WRAP_PADDING,
        width: maxX - minX + 2 * WRAP_PADDING + POOL_BAND,
        height: maxY - minY + 2 * WRAP_PADDING,
      },
      undefined,
      { lanesHandled: true },
    );
    for (const el of others) {
      if ((el as Connection).waypoints)
        this.modeling.moveConnection(el as Connection, { x: 0, y: 0 }, participant);
      else this.modeling.moveShape(el as Shape, { x: 0, y: 0 }, participant);
    }
  }

  private fitLanesToPool(pool: Shape, old: Bounds): void {
    const lanes = lanesOf(pool);
    if (!lanes.length) return;
    const dyTop = pool.y - old.y;
    const dyBottom = pool.y + pool.height - (old.y + old.height);
    lanes.forEach((lane, i) => {
      let y = lane.y;
      let height = lane.height;
      if (i === 0) {
        y += dyTop;
        height -= dyTop;
      }
      if (i === lanes.length - 1) height += dyBottom;
      this.modeling.resizeShape(
        lane,
        { x: pool.x + POOL_BAND, y, width: pool.width - POOL_BAND, height },
        undefined,
        { lanesHandled: true },
      );
    });
  }

  private growPoolForLane(lane: Shape, old: Bounds): void {
    const pool = participantOf(lane.parent);
    if (!pool) return;
    const dy = lane.height - old.height;
    if (!dy) return;
    const line = old.y + old.height;
    for (const child of childrenOf(pool)) {
      if (child === lane || (child as Connection).waypoints) continue;
      const s = child as Shape;
      const top = is(bo(s), 'bpmn:Lane') ? s.y : center(s).y;
      if (top >= line - 1)
        this.modeling.moveShape(s, { x: 0, y: dy }, undefined, undefined, { lanesHandled: true });
    }
    this.modeling.resizeShape(
      pool,
      { x: pool.x, y: pool.y, width: pool.width, height: pool.height + dy },
      undefined,
      {
        lanesHandled: true,
      },
    );
  }

  private closeLaneGap(lane: Shape, pool: Shape): void {
    if (!is(bo(pool), 'bpmn:Participant') || !lanesOf(pool).length) return;
    const line = lane.y + lane.height;
    for (const child of childrenOf(pool)) {
      if ((child as Connection).waypoints) continue;
      const s = child as Shape;
      const top = is(bo(s), 'bpmn:Lane') ? s.y : center(s).y;
      if (top >= line - 1)
        this.modeling.moveShape(s, { x: 0, y: -lane.height }, undefined, undefined, {
          lanesHandled: true,
        });
    }
    this.modeling.resizeShape(
      pool,
      { x: pool.x, y: pool.y, width: pool.width, height: pool.height - lane.height },
      undefined,
      { lanesHandled: true },
    );
  }
}

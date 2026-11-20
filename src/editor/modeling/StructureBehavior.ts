/**
 * Modeling behaviors for pools and lanes:
 * - flow content dropped on a lane is parented to the lane's pool
 * - the first pool on a process diagram converts it to a collaboration and wraps
 *   the existing content
 * - resizing a pool keeps its lanes aligned; resizing a lane grows/shrinks the pool
 *   and the lanes around it (horizontal and vertical pools, nested lanes)
 * - deleting a lane deletes its sub-lanes and closes the gap
 * - a pool or expanded sub-process grows to fit a shape created outside it (append, paste)
 * - lane membership (`flowNodeRef`) follows node positions after every change
 */
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { connectionEnds } from '@/bpmn/di/di';
import { is } from '@/bpmn/model/moddle';
import { bo, childrenOf, rootOf } from '../model';
import { POOL_BAND, ROOT_TO_COLLABORATION, UPDATE_LANES } from '../commands/StructureHandlers';
import {
  along,
  boundsOf,
  childLanes,
  contentBounds,
  cross,
  crossDelta,
  crossPosition,
  end,
  isHorizontal,
  isLane,
  laneAncestors,
  laneContainer,
  laneDescendants,
} from './laneLayout';
import {
  containerAt,
  isExpandedContainer,
  isFlowNodeShape,
  lanesOf,
  participantOf,
} from './semantic';

type Bounds = { x: number; y: number; width: number; height: number };
type Hints = { lanesHandled?: boolean; wrapProcess?: boolean };

const WRAP_PADDING = 50;
/** Space kept between a container's edge and content it grows for. */
const GROW_PADDING = 30;

export default class StructureBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'canvas', 'modeling', 'commandStack', 'elementRegistry'];

  constructor(
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly modeling: Modeling,
    private readonly commandStack: CommandStack,
    private readonly elementRegistry: ElementRegistry,
  ) {
    super(eventBus);

    // Lanes are not containers in the diagram: flow content lives in the pool.
    const toContainer = (parent: Element | undefined): Element | undefined =>
      parent && is(bo(parent), 'bpmn:Lane') ? (participantOf(parent) ?? parent.parent) : parent;

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
    // An association drawn to a sequence or message flow (PDF 92, 95, Fig 8.28) goes with it ...
    this.preExecute('connection.delete', (e: { context: { connection: Connection } }) => {
      const { connection } = e.context;
      for (const attached of [...(connection.incoming ?? []), ...(connection.outgoing ?? [])]) {
        if (attached.parent) this.modeling.removeConnection(attached);
      }
    });
    // ... and follows it when the flow is moved or re-routed.
    this.postExecuted(
      [
        'connection.layout',
        'connection.updateWaypoints',
        'connection.move',
        'connection.reconnect',
      ],
      (e: { context: { connection: Connection } }) => {
        const { connection } = e.context;
        for (const attached of [...(connection.incoming ?? []), ...(connection.outgoing ?? [])]) {
          if (attached.parent) this.modeling.layoutConnection(attached);
        }
      },
    );
    // An edge drawn to another shape than its model end (BPMNEdge sourceElement /
    // targetElement, PDF 405) still goes when that model end is deleted.
    this.preExecute('shape.delete', (e: { context: { shape: Shape } }) => {
      const removed = bo(e.context.shape);
      if (!removed) return;
      const redirected = this.elementRegistry.filter((el) => {
        const c = el as Connection;
        if (!c.waypoints || !c.parent || c.source === e.context.shape) return false;
        if (c.target === e.context.shape) return false;
        const ends = connectionEnds(bo(c)!);
        return ends.source === removed || ends.target === removed;
      });
      for (const c of redirected) this.modeling.removeConnection(c as Connection);
    });
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
      else this.growToFit(e.context.shape);
    });

    this.postExecute(
      'shape.resize',
      (e: { context: { shape: Shape; oldBounds: Bounds; hints?: Hints } }) => {
        const { shape, oldBounds, hints } = e.context;
        if (hints?.lanesHandled) return;
        if (is(bo(shape), 'bpmn:Participant')) this.fitLanes(shape, oldBounds);
        else if (is(bo(shape), 'bpmn:Lane')) this.resizeLaneEnd(shape, oldBounds);
      },
    );

    // A lane goes with its sub-lanes; the lanes around it close the gap.
    this.preExecute('shape.delete', (e: { context: { shape: Shape; laneContainer?: Shape } }) => {
      const { shape } = e.context;
      if (!isLane(shape)) return;
      e.context.laneContainer = laneContainer(shape);
      for (const sub of laneDescendants(shape).reverse()) {
        if (sub.parent) this.modeling.removeShape(sub, { lanesHandled: true } as never);
      }
    });
    this.postExecute(
      'shape.delete',
      (e: { context: { shape: Shape; hints?: Hints; laneContainer?: Shape } }) => {
        const { shape, hints, laneContainer: container } = e.context;
        if (!hints?.lanesHandled && isLane(shape) && container) this.closeLaneGap(shape, container);
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
    const root = rootOf(this.canvas);
    // Lanes of pools, and lanes drawn directly on a process diagram.
    for (const host of [root, ...childrenOf(root)]) {
      const pool = is(bo(host), 'bpmn:Participant');
      if (!pool && (host !== root || !is(bo(host), 'bpmn:Process'))) continue;
      if (lanesOf(host as Shape).length) {
        this.commandStack.execute(UPDATE_LANES, { participant: host });
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
    // The name band is on the left of a horizontal pool, on top of a vertical one.
    const h = isHorizontal(participant);
    const left = WRAP_PADDING + (h ? POOL_BAND : 0);
    const top = WRAP_PADDING + (h ? 0 : POOL_BAND);
    this.modeling.resizeShape(
      participant,
      {
        x: minX - left,
        y: minY - top,
        width: maxX - minX + WRAP_PADDING + left,
        height: maxY - minY + WRAP_PADDING + top,
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

  /**
   * Grows the pool or expanded sub-process that a new shape (appended, pasted)
   * belongs to, and its enclosing containers, so the shape is drawn inside it.
   */
  private growToFit(shape: Shape): void {
    if (is(bo(shape), 'bpmn:Participant') || is(bo(shape), 'bpmn:Lane')) return;
    let inner: Bounds = shape;
    let container = shape.parent as Shape | undefined;
    while (
      container?.parent &&
      (is(bo(container), 'bpmn:Participant') || isExpandedContainer(container))
    ) {
      const pool = is(bo(container), 'bpmn:Participant');
      const h = isHorizontal(container);
      const left = pool && h ? POOL_BAND + GROW_PADDING : GROW_PADDING;
      const top = pool && !h ? POOL_BAND + GROW_PADDING : GROW_PADDING;
      const x = Math.min(container.x, inner.x - left);
      const y = Math.min(container.y, inner.y - top);
      const right = Math.max(container.x + container.width, inner.x + inner.width + GROW_PADDING);
      const bottom = Math.max(
        container.y + container.height,
        inner.y + inner.height + GROW_PADDING,
      );
      const next = { x, y, width: right - x, height: bottom - y };
      if (
        next.x === container.x &&
        next.y === container.y &&
        next.width === container.width &&
        next.height === container.height
      ) {
        return;
      }
      this.modeling.resizeShape(container, next);
      inner = container;
      container = container.parent as Shape | undefined;
    }
  }

  /**
   * After a pool or lane was resized, its lanes follow: they keep running its
   * whole length, the first lane takes a move of its start edge and the last
   * lane a move of its end edge; the same for their sub-lanes.
   */
  private fitLanes(container: Shape, old: Bounds): void {
    const kids = childLanes(container);
    if (!kids.length) return;
    const h = isHorizontal(container);
    const dStart = cross(container, h).start - cross(old, h).start;
    const dEnd = end(cross(container, h)) - end(cross(old, h));
    const main = along(contentBounds(container), h);
    kids.forEach((lane, i) => {
      const c = cross(lane, h);
      let start = c.start;
      let size = c.size;
      if (i === 0) {
        start += dStart;
        size -= dStart;
      }
      if (i === kids.length - 1) size += dEnd;
      const next = boundsOf(main, { start, size }, h);
      if (
        next.x === lane.x &&
        next.y === lane.y &&
        next.width === lane.width &&
        next.height === lane.height
      ) {
        return;
      }
      const before = { x: lane.x, y: lane.y, width: lane.width, height: lane.height };
      this.modeling.resizeShape(lane, next, undefined, { lanesHandled: true });
      this.fitLanes(lane, before);
    });
  }

  /**
   * A lane was resized at its end edge (bottom, or right in a vertical pool):
   * what follows it moves, its sub-lanes follow and the lanes around it and the
   * pool grow or shrink with it.
   */
  private resizeLaneEnd(lane: Shape, old: Bounds): void {
    const host = lane.parent as Shape | undefined;
    const h = isHorizontal(lane);
    const d = cross(lane, h).size - cross(old, h).size;
    if (!d) return;
    this.fitLanes(lane, old);
    if (!host) return;
    const ancestors = laneAncestors(lane);
    this.shiftAfter(
      host,
      h,
      end(cross(old, h)),
      d,
      new Set([lane, ...ancestors, ...laneDescendants(lane)]),
    );
    // The pool grows too; a process diagram without pools has no bounds.
    for (const grown of [...ancestors, ...(host.parent ? [host] : [])]) this.growAcross(grown, d);
  }

  /** A lane was deleted from `container` (pool, parent lane or diagram): the rest closes the gap. */
  private closeLaneGap(lane: Shape, container: Shape): void {
    // The last lane of a pool or lane leaves its area to it.
    const remaining = childLanes(container);
    if (!remaining.length) return;
    const host = remaining[0]!.parent as Shape;
    const h = isHorizontal(remaining[0]!);
    const size = cross(lane, h).size;
    const ancestors = is(bo(container), 'bpmn:Lane')
      ? [container, ...laneAncestors(container)]
      : [];
    this.shiftAfter(host, h, end(cross(lane, h)), -size, new Set([...ancestors]));
    for (const shrunk of [...ancestors, ...(host.parent ? [host] : [])]) {
      this.growAcross(shrunk, -size);
    }
  }

  /** Moves the shapes of a pool or diagram (lanes by their start edge, others by their center) after `line` by `d`. */
  private shiftAfter(host: Shape, h: boolean, line: number, d: number, keep: Set<Shape>): void {
    // A copy: a move re-inserts the shape among its parent's children (at the
    // same index, so lanes stay below the content).
    for (const child of [...childrenOf(host)]) {
      if ((child as Connection).waypoints || keep.has(child as Shape)) continue;
      const s = child as Shape;
      if (crossPosition(s, h) >= line - 1) {
        const index = childrenOf(host).indexOf(s);
        this.modeling.moveShape(s, crossDelta(d, h), host, index, { lanesHandled: true });
      }
    }
  }

  /** Grows (or shrinks) a pool or lane at its end edge across the lanes, leaving its lanes alone. */
  private growAcross(shape: Shape, d: number): void {
    const h = isHorizontal(shape);
    const c = cross(shape, h);
    this.modeling.resizeShape(
      shape,
      boundsOf(along(shape, h), { start: c.start, size: c.size + d }, h),
      undefined,
      { lanesHandled: true },
    );
  }
}

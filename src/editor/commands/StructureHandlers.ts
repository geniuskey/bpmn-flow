/**
 * Commands that change BPMN structure beyond a single element:
 * - `root.toCollaboration`: turns a process diagram into a collaboration
 * - `lanes.updateMembership`: recomputes `flowNodeRef` from node positions
 * - `lane.add`: inserts a lane into a pool or lane (sub-lane), growing the pool
 * - `pool.setBlackBox`: turns an empty pool into a black-box pool (no process) or back
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Shape } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, type BpmnData } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import { center, contains, isFlowNodeShape, lanesOf } from '../modeling/semantic';
import {
  along,
  boundsOf,
  childLanes,
  contentBounds,
  cross,
  crossDelta,
  crossPosition,
  end,
  HEADER,
  isHorizontal,
  laneAncestors,
  laneContainer,
  type LanePlacement,
} from '../modeling/laneLayout';

export const ROOT_TO_COLLABORATION = 'root.toCollaboration';
export const UPDATE_LANES = 'lanes.updateMembership';
export const ADD_LANE = 'lane.add';
export const SET_POOL_BLACK_BOX = 'pool.setBlackBox';

export const POOL_BAND = HEADER;
export const NEW_LANE_HEIGHT = 125;

export class RootToCollaborationHandler {
  static $inject = ['canvas', 'elementFactory', 'bpmnDefinitions'];
  constructor(
    private readonly canvas: Canvas,
    private readonly factory: BpmnElementFactory,
    private readonly definitions: ModdleElement,
  ) {}

  execute(context: {
    collaboration?: ModdleElement;
    process?: ModdleElement;
    log?: ChangeLog;
  }): [] {
    const root = this.canvas.getRootElement() as unknown as BpmnData;
    const process = root.businessObject;
    if (!is(process, 'bpmn:Process')) throw new Error('The diagram is already a collaboration.');
    const collaboration = (context.collaboration ??=
      this.factory.createModdle('bpmn:Collaboration'));
    const log = new ChangeLog();
    log.insert(this.definitions.get('rootElements') as ModdleElement[], collaboration, 0);
    log.setParent(collaboration, this.definitions);
    log.set(root.di, 'bpmnElement', collaboration);
    log.apply(
      () => (root.businessObject = collaboration),
      () => (root.businessObject = process),
    );
    context.process = process;
    context.log = log;
    return [];
  }

  revert(context: { log?: ChangeLog }): [] {
    context.log?.undo();
    return [];
  }
}

/** Every flow node belongs to each lane whose bounds contain its center. */
export class UpdateLanesHandler {
  execute(context: { participant: Shape; log?: ChangeLog }): [] {
    const log = new ChangeLog();
    const lanes = lanesOf(context.participant);
    const nodes = childrenOf(context.participant).filter(isFlowNodeShape) as Shape[];
    for (const lane of lanes) {
      const laneBo = bo(lane)!;
      const refs = laneBo.get('flowNodeRef') as ModdleElement[];
      const wanted = nodes
        .filter((n) => {
          const c = center(n);
          return contains(lane, c.x, c.y);
        })
        .map((n) => bo(n)!);
      const same = refs.length === wanted.length && wanted.every((w) => refs.includes(w));
      if (same) continue;
      // Keep the existing order for nodes that stay; append new members.
      const next = [
        ...refs.filter((r) => wanted.includes(r)),
        ...wanted.filter((w) => !refs.includes(w)),
      ];
      log.replaceAll(refs, next);
    }
    context.log = log;
    return [];
  }

  revert(context: { log?: ChangeLog }): [] {
    context.log?.undo();
    return [];
  }
}

/**
 * Adds a lane (BPMN 2.0.2 PDF 334-337):
 * - `target` a pool: after its last lane;
 * - `target` a lane: after it, in the same lane set;
 * - `target` a lane with `inside`: a sub-lane in its childLaneSet (nested lanes).
 * A pool or lane without lanes first gets one lane covering its area. Everything
 * after the new lane moves to make room; the pool and enclosing lanes grow.
 * Horizontal pools stack lanes downwards, vertical pools to the right.
 */
export class AddLaneHandler {
  static $inject = ['modeling', 'elementFactory'];
  constructor(
    private readonly modeling: Modeling,
    private readonly factory: BpmnElementFactory,
  ) {}

  preExecute(context: { target: Shape; inside?: boolean; newLane?: Shape }): void {
    const { target } = context;
    const isPool = is(bo(target), 'bpmn:Participant');
    const isRoot = !target.parent;
    if (!isPool && !isRoot && !is(bo(target), 'bpmn:Lane')) {
      throw new Error('Lanes go into pools or lanes.');
    }
    // The pool, or the process diagram itself, whose children the lanes are.
    const host = isPool || isRoot ? target : (target.parent as Shape);
    if (is(bo(host), 'bpmn:Participant')) {
      if (!getRef(bo(host), 'processRef')) {
        throw new Error('A black-box pool has no process and therefore no lanes.');
      }
    } else if (host.parent || !is(bo(host), 'bpmn:Process')) {
      throw new Error('Lanes can only be added to pools or to a process diagram.');
    }
    const pool = host.parent ? host : undefined;
    const hints = { lanesHandled: true };
    // The pool, lane or diagram that gets the new lane, and the lane it follows.
    const container = isPool || isRoot || context.inside ? target : laneContainer(target)!;
    let after = isPool || isRoot || context.inside ? undefined : target;
    const parentBo = is(bo(container), 'bpmn:Lane') ? bo(container) : undefined;
    const existing = childLanes(container);
    const h = pool
      ? isHorizontal(pool)
      : existing.length
        ? isHorizontal(existing[0]!)
        : !is(bo(container), 'bpmn:Lane') || isHorizontal(container);

    let siblings = existing;
    if (!siblings.length) {
      const first = this.newLane(h, { bfParentLane: parentBo });
      const area = container === host && !pool ? diagramLaneArea(host) : contentBounds(container);
      this.modeling.createShape(first, area as never, host, this.index(host), hints);
      siblings = [first];
    }
    after ??= siblings[siblings.length - 1]!;
    const line = end(cross(after, h));

    // Move everything after the insertion line to make room.
    const enclosing = new Set<Shape>(
      [pool, container, ...laneAncestors(container)].filter((s): s is Shape => !!s && !!s.parent),
    );
    // (A copy: a move re-inserts the shape among its parent's children.)
    for (const child of [...childrenOf(host)]) {
      if ((child as { waypoints?: unknown }).waypoints || enclosing.has(child as Shape)) continue;
      const shape = child as Shape;
      if (crossPosition(shape, h) >= line - 1) {
        // Same parent, same index: the drawing order (lanes below content) stays.
        const index = childrenOf(host).indexOf(shape);
        this.modeling.moveShape(shape, crossDelta(NEW_LANE_HEIGHT, h), host, index, hints);
      }
    }
    // The pool and the lanes around the new one grow.
    for (const grown of [...enclosing]) {
      const c = cross(grown, h);
      this.modeling.resizeShape(
        grown,
        boundsOf(along(grown, h), { start: c.start, size: c.size + NEW_LANE_HEIGHT }, h),
        undefined,
        hints,
      );
    }
    const lane = this.newLane(h, { bfParentLane: parentBo, bfAfterLane: bo(after) });
    const main =
      is(bo(container), 'bpmn:Participant') || is(bo(container), 'bpmn:Lane')
        ? along(contentBounds(container), h)
        : along(after, h);
    this.modeling.createShape(
      lane,
      boundsOf(main, { start: line, size: NEW_LANE_HEIGHT }, h) as never,
      host,
      this.index(host),
      hints,
    );
    context.newLane = lane;
  }

  /** Lanes are drawn above their pool and parent lanes, below the content. */
  private index(host: Shape): number {
    const children = childrenOf(host);
    let last = -1;
    children.forEach((c, i) => {
      if (is(bo(c), 'bpmn:Lane')) last = i;
    });
    return last + 1;
  }

  private newLane(horizontal: boolean, placement: LanePlacement): Shape {
    const lane = this.factory.createShape({ type: 'bpmn:Lane' }) as Shape & LanePlacement;
    if (!horizontal) (lane as unknown as BpmnData).di.set('isHorizontal', false);
    if (placement.bfParentLane) lane.bfParentLane = placement.bfParentLane;
    if (placement.bfAfterLane) lane.bfAfterLane = placement.bfAfterLane;
    return lane;
  }

  execute(): [] {
    return [];
  }

  revert(): [] {
    return [];
  }
}

/**
 * The first lane of a process diagram without pools ("Lanes are used to
 * organize and categorize activities within a Pool" — often, not always; PDF
 * 334) covers the diagram's content, with room for its name band.
 */
function diagramLaneArea(root: Shape): { x: number; y: number; width: number; height: number } {
  const shapes = childrenOf(root).filter(
    (c) => !(c as { waypoints?: unknown }).waypoints && !is(bo(c), 'bpmn:Lane'),
  ) as Shape[];
  if (!shapes.length) return { x: 100, y: 100, width: 600, height: NEW_LANE_HEIGHT };
  const pad = 30;
  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));
  const maxX = Math.max(...shapes.map((s) => s.x + s.width));
  const maxY = Math.max(...shapes.map((s) => s.y + s.height));
  return {
    x: minX - pad - HEADER,
    y: minY - pad,
    width: maxX - minX + 2 * pad + HEADER,
    height: Math.max(NEW_LANE_HEIGHT, maxY - minY + 2 * pad),
  };
}

export function hasLanes(participant: Shape | undefined): boolean {
  return !!participant && getMany(getRef(bo(participant), 'processRef'), 'laneSets').length > 0;
}

/**
 * Why a pool cannot become a black box, or null when it can: only a pool whose
 * process is empty, used by no other pool and not drawn in another diagram, so
 * nothing is lost.
 */
export function blackBoxBlocker(pool: Shape, definitions: ModdleElement): string | null {
  const participant = bo(pool);
  if (!participant || !is(participant, 'bpmn:Participant')) return 'Not a pool.';
  const process = getRef(participant, 'processRef');
  if (!process) return null;
  if (childrenOf(pool).length) return 'Remove the content of the pool first.';
  const content = ['flowElements', 'artifacts', 'laneSets'].some(
    (key) => getMany(process, key).length > 0,
  );
  if (content || getRef(process, 'ioSpecification')) return 'The pool’s process has content.';
  const sharedBy = (getMany(participant.$parent, 'participants') as ModdleElement[]).some(
    (p) => p !== participant && getRef(p, 'processRef') === process,
  );
  if (sharedBy) return 'Another pool uses the same process.';
  const drawn = getMany(definitions, 'diagrams').some(
    (d) => getRef(getRef(d, 'plane'), 'bpmnElement') === process,
  );
  if (drawn) return 'The process has its own diagram.';
  return null;
}

export class SetPoolBlackBoxHandler {
  static $inject = ['elementFactory', 'bpmnDefinitions'];
  constructor(
    private readonly factory: BpmnElementFactory,
    private readonly definitions: ModdleElement,
  ) {}

  execute(context: {
    element: Shape;
    blackBox: boolean;
    process?: ModdleElement;
    log?: ChangeLog;
  }): Shape[] {
    const participant = bo(context.element);
    if (!participant || !is(participant, 'bpmn:Participant')) throw new Error('Not a pool.');
    const roots = this.definitions.get('rootElements') as ModdleElement[];
    const current = getRef(participant, 'processRef');
    const log = new ChangeLog();
    if (context.blackBox && current) {
      const blocker = blackBoxBlocker(context.element, this.definitions);
      if (blocker) throw new Error(blocker);
      log.set(participant, 'processRef', undefined);
      log.remove(roots, current);
    } else if (!context.blackBox && !current) {
      const process = (context.process ??= this.factory.createModdle('bpmn:Process', {
        isExecutable: false,
      }));
      log.insert(roots, process);
      log.setParent(process, this.definitions);
      log.set(participant, 'processRef', process);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: { element: Shape; log?: ChangeLog }): Shape[] {
    context.log?.undo();
    return [context.element];
  }
}

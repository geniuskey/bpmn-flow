/**
 * Commands that change BPMN structure beyond a single element:
 * - `root.toCollaboration`: turns a process diagram into a collaboration
 * - `lanes.updateMembership`: recomputes `flowNodeRef` from node positions
 * - `lane.add`: inserts a lane into a pool, growing the pool
 * - `pool.setBlackBox`: turns an empty pool into a black-box pool (no process) or back
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Shape } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, type BpmnData } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import { center, contains, isFlowNodeShape, lanesOf, participantOf } from '../modeling/semantic';

export const ROOT_TO_COLLABORATION = 'root.toCollaboration';
export const UPDATE_LANES = 'lanes.updateMembership';
export const ADD_LANE = 'lane.add';
export const SET_POOL_BLACK_BOX = 'pool.setBlackBox';

export const POOL_BAND = 30;
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
 * Adds a lane below `target` (a lane) or at the bottom of `target` (a pool).
 * A pool without lanes first gets one lane covering its current area.
 */
export class AddLaneHandler {
  static $inject = ['modeling', 'elementFactory'];
  constructor(
    private readonly modeling: Modeling,
    private readonly factory: BpmnElementFactory,
  ) {}

  preExecute(context: { target: Shape; newLane?: Shape }): void {
    const participant = is(bo(context.target), 'bpmn:Participant')
      ? context.target
      : participantOf(context.target.parent);
    if (!participant) throw new Error('Lanes can only be added to pools.');
    if (!getRef(bo(participant), 'processRef')) {
      throw new Error('A black-box pool has no process and therefore no lanes.');
    }
    const lanes = lanesOf(participant);
    const laneX = participant.x + POOL_BAND;
    const laneWidth = participant.width - POOL_BAND;
    const hints = { lanesHandled: true };

    if (lanes.length === 0) {
      const first = this.factory.createShape({ type: 'bpmn:Lane' });
      this.modeling.createShape(
        first,
        { x: laneX, y: participant.y, width: laneWidth, height: participant.height } as never,
        participant,
        0,
        hints,
      );
      lanes.push(first);
    }

    const after = is(bo(context.target), 'bpmn:Lane') ? context.target : lanes[lanes.length - 1]!;
    const insertY = after.y + after.height;

    // Shift everything below the insertion line down to make room.
    for (const child of childrenOf(participant)) {
      if ((child as { waypoints?: unknown }).waypoints) continue;
      const shape = child as Shape;
      const top = is(bo(shape), 'bpmn:Lane') ? shape.y : center(shape).y;
      if (top >= insertY - 1)
        this.modeling.moveShape(shape, { x: 0, y: NEW_LANE_HEIGHT }, undefined, undefined, hints);
    }
    this.modeling.resizeShape(
      participant,
      {
        x: participant.x,
        y: participant.y,
        width: participant.width,
        height: participant.height + NEW_LANE_HEIGHT,
      },
      undefined,
      hints,
    );
    const lane = this.factory.createShape({ type: 'bpmn:Lane' });
    this.modeling.createShape(
      lane,
      { x: laneX, y: insertY, width: laneWidth, height: NEW_LANE_HEIGHT } as never,
      participant,
      lanes.length,
      hints,
    );
    context.newLane = lane;
  }

  execute(): [] {
    return [];
  }

  revert(): [] {
    return [];
  }
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

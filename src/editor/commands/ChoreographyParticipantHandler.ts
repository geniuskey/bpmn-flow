/**
 * Edits the participants of a choreography activity and their bands (BPMN
 * 2.0.2 §11.5, Table 12.33), one undo step per edit:
 * - `participant`: the participant of a band (existing or created by name);
 *   the task's message flows follow
 * - `initiator`: the initiating participant; band kinds follow (only the
 *   non-initiating bands are shaded) and a one-way task's message flow is
 *   turned around so it leaves the initiator
 * - `move`: reorder the bands (e.g. the initiating band at the bottom)
 * - `add` / `remove`: a third or further participant of a sub-choreography or
 *   call choreography; added bands alternate between the upper and lower
 *   section (PDF 361, Fig 11.21)
 * - `messageVisible`: the band's message decorator (DI isMessageVisible)
 * - `multiplicity`: a multi-instance participant (participantMultiplicity)
 * - `returnMessage` / `message`: two-way choreography tasks (Fig 11.10) and
 *   the Message each of its message flows carries
 *
 * Band indexes count the bands top to bottom. Band kinds and bounds are
 * rewritten from the resulting order: the first band is `top`, the last one
 * `bottom`, the others `middle`.
 */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, type BpmnShape } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import {
  BAND_HEIGHT,
  bandSections,
  bandsOf,
  layoutSections,
  makeBandKind,
  showsBandMessages,
  type BandPosition,
} from '../modeling/choreography';
import { choreographyOf } from '../modeling/semanticModel';
import type { BandOp } from '../types';

/** A multi-instance band holds the marker under the participant name. */
const MULTI_BAND_HEIGHT = 30;

export const UPDATE_CHOREOGRAPHY_BANDS = 'choreography.updateBands';
/** Former name, still accepted: `{ slot: 0 | 1, participantId?, newName? }`. */
export const SET_CHOREOGRAPHY_PARTICIPANT = 'choreography.setParticipant';

export type { BandOp };

interface Context {
  element: Element;
  op?: BandOp;
  /** Legacy context of SET_CHOREOGRAPHY_PARTICIPANT. */
  slot?: 0 | 1;
  participantId?: string;
  newName?: string;
  created?: Record<string, ModdleElement>;
  affected?: Element[];
  log?: ChangeLog;
}

/** Whether `activity` may have more than two participants (sub- and call choreographies). */
export function takesMoreParticipants(activity: ModdleElement | undefined): boolean {
  return is(activity, 'bpmn:SubChoreography') || is(activity, 'bpmn:CallChoreography');
}

function definitionsOf(el: ModdleElement): ModdleElement {
  let p = el;
  while (p.$parent) p = p.$parent;
  return p;
}

export default class ChoreographyParticipantHandler {
  static $inject = ['elementFactory', 'commandStack', 'elementRegistry'];
  constructor(
    private readonly factory: BpmnElementFactory,
    private readonly commandStack: CommandStack,
    private readonly registry: ElementRegistry,
  ) {}

  private opOf(context: Context): BandOp {
    if (context.op) return context.op;
    // Legacy: slot 0 = initiating participant's band, slot 1 = the other one.
    const activity = bo(context.element)!;
    const initiator = getRef(activity, 'initiatingParticipantRef');
    const order = bandSectionsOf(context.element);
    const all = [...order.upper, ...order.lower];
    const initiating = all.findIndex((b) => getRef(b, 'bpmnElement') === initiator);
    const index =
      context.slot === 0 ? Math.max(0, initiating) : all.findIndex((_, i) => i !== initiating);
    return {
      op: 'participant',
      index,
      ...(context.participantId ? { participantId: context.participantId } : {}),
      ...(context.newName ? { newName: context.newName } : {}),
    };
  }

  /**
   * A new band needs room: the activity grows by one band height; a
   * multi-instance band grows to hold its marker under the name (PDF 357).
   * Both are nested resizes, so the edit stays one undo step.
   */
  preExecute(context: Context): void {
    const op = (context.op = this.opOf(context));
    const shape = context.element as Shape;
    let grow = 0;
    if (op.op === 'add') grow = BAND_HEIGHT;
    if (op.op === 'multiplicity') {
      const band = bandSectionsOf(shape);
      const b = [...band.upper, ...band.lower][op.index];
      const height = (b && getRef(b, 'bounds')?.get('height')) as number | undefined;
      if (b && height !== undefined) grow = (op.value ? MULTI_BAND_HEIGHT : BAND_HEIGHT) - height;
    }
    if (grow) {
      this.commandStack.execute('shape.resize', {
        shape,
        newBounds: { x: shape.x, y: shape.y, width: shape.width, height: shape.height + grow },
      });
    }
  }

  execute(context: Context): Element[] {
    const shape = context.element as BpmnShape;
    const activity = bo(shape);
    const choreography = activity && choreographyOf(activity);
    if (!activity || !choreography || !is(activity, 'bpmn:ChoreographyActivity')) {
      throw new Error('Not a choreography activity.');
    }
    const op = (context.op ??= this.opOf(context));
    const log = new ChangeLog();
    const created = (context.created ??= {});
    const sections = bandSectionsOf(shape);
    let order = [...sections.upper, ...sections.lower];
    let upperCount = sections.upper.length;
    const refs = activity.get('participantRef') as ModdleElement[];
    const participants = choreography.get('participants') as ModdleElement[];
    const band = (i: number) => {
      const b = order[i];
      if (!b) throw new Error('There is no such participant band.');
      return b;
    };
    /** An existing participant of the choreography, or a new one created by name. */
    const choose = (participantId?: string, newName?: string): ModdleElement => {
      if (newName?.trim()) {
        const p = (created.participant ??= this.factory.createModdle('bpmn:Participant', {
          name: newName.trim(),
        }));
        log.insert(participants, p);
        log.setParent(p, choreography);
        return p;
      }
      const found = participants.find((p) => p.id === participantId);
      if (!found) throw new Error('Unknown participant.');
      return found;
    };
    const flows = getMany(activity, 'messageFlowRef');
    let affected: Element[] = [];

    switch (op.op) {
      case 'participant': {
        const b = band(op.index);
        const old = getRef(b, 'bpmnElement');
        const next = choose(op.participantId, op.newName);
        if (next === old) break;
        if (refs.includes(next)) throw new Error('This participant already takes part.');
        const i = old ? refs.indexOf(old) : -1;
        if (i >= 0) {
          const list = refs.slice();
          list[i] = next;
          log.replaceAll(refs, list);
        } else log.insert(refs, next);
        if (getRef(activity, 'initiatingParticipantRef') === old) {
          log.set(activity, 'initiatingParticipantRef', next);
        }
        log.set(b, 'bpmnElement', next);
        // The task's message flows follow the participant change.
        for (const flow of flows) {
          if (getRef(flow, 'sourceRef') === old) log.set(flow, 'sourceRef', next);
          if (getRef(flow, 'targetRef') === old) log.set(flow, 'targetRef', next);
        }
        break;
      }
      case 'initiator': {
        const next = refs.find((p) => p.id === op.participantId);
        if (!next) throw new Error('The initiator must be a participant of the activity.');
        const old = getRef(activity, 'initiatingParticipantRef');
        if (next === old) break;
        log.set(activity, 'initiatingParticipantRef', next);
        // A one-way interaction: its message leaves the initiator (PDF 355).
        if (flows.length === 1) {
          const [flow] = flows as [ModdleElement];
          if (getRef(flow, 'targetRef') === next) {
            const source = getRef(flow, 'sourceRef');
            log.set(flow, 'sourceRef', next);
            log.set(flow, 'targetRef', source);
          }
        }
        break;
      }
      case 'move': {
        const b = band(op.index);
        const to = Math.max(0, Math.min(order.length - 1, op.to));
        order = order.filter((x) => x !== b);
        order.splice(to, 0, b);
        break;
      }
      case 'add': {
        if (!takesMoreParticipants(activity)) {
          throw new Error('A choreography task has two participants.');
        }
        const p = choose(op.participantId, op.newName);
        if (refs.includes(p)) throw new Error('This participant already takes part.');
        log.insert(refs, p);
        const shapeDi = shape.di;
        const b = (created.band ??= this.factory.createModdle('bpmndi:BPMNShape', {
          bpmnElement: p,
          choreographyActivityShape: shapeDi,
          participantBandKind: 'middle_non_initiating',
        }));
        const plane = shapeDi.$parent!;
        const planeElements = plane.get('planeElement') as ModdleElement[];
        const after = Math.max(...bandsOf(shape).map((x) => planeElements.indexOf(x)));
        log.insert(planeElements, b, after + 1);
        log.setParent(b, plane);
        const holder = shape as BpmnShape & { bands?: ModdleElement[] };
        const before = bandsOf(shape);
        log.apply(
          () => (holder.bands = [...before, b]),
          () => (holder.bands = before),
        );
        // Added bands alternate between the upper and lower section (PDF 361).
        const lower = order.length - upperCount;
        order.splice(upperCount, 0, b);
        if (upperCount <= lower) upperCount++;
        break;
      }
      case 'remove': {
        if (order.length <= 2)
          throw new Error('A choreography activity has two or more participants.');
        const b = band(op.index);
        const p = getRef(b, 'bpmnElement');
        if (p && p === getRef(activity, 'initiatingParticipantRef')) {
          throw new Error('Choose another initiating participant first.');
        }
        if (p && flows.some((f) => getRef(f, 'sourceRef') === p || getRef(f, 'targetRef') === p)) {
          throw new Error('This participant sends or receives a message of the task.');
        }
        if (p) log.remove(refs, p);
        const plane = b.$parent;
        if (plane) log.remove(plane.get('planeElement') as ModdleElement[], b);
        const holder = shape as BpmnShape & { bands?: ModdleElement[] };
        const before = bandsOf(shape);
        log.apply(
          () => (holder.bands = before.filter((x) => x !== b)),
          () => (holder.bands = before),
        );
        if (op.index < upperCount) upperCount--;
        order = order.filter((x) => x !== b);
        // Keep at least one band in each section.
        if (upperCount === 0) upperCount = 1;
        if (upperCount === order.length) upperCount = order.length - 1;
        break;
      }
      case 'messageVisible': {
        const b = band(op.index);
        if (op.value && !showsBandMessages(activity)) {
          throw new Error(
            'Only choreography tasks and calls of a global choreography task show band messages.',
          );
        }
        if (op.value && op.index !== 0 && op.index !== order.length - 1) {
          throw new Error('Only the top and the bottom band show a message.');
        }
        log.setExplicit(b, 'isMessageVisible', op.value ? true : undefined);
        break;
      }
      case 'multiplicity': {
        const p = getRef(band(op.index), 'bpmnElement');
        if (!p) throw new Error('The band has no participant.');
        const bounds = getRef(band(op.index), 'bounds');
        if (bounds) log.set(bounds, 'height', op.value ? MULTI_BAND_HEIGHT : BAND_HEIGHT);
        const current = getRef(p, 'participantMultiplicity');
        if (op.value && !current) {
          const m = (created.multiplicity ??= this.factory.createModdle(
            'bpmn:ParticipantMultiplicity',
            { minimum: 2 },
          ));
          log.setParent(m, p);
          log.set(p, 'participantMultiplicity', m);
        } else if (!op.value && current) {
          log.set(p, 'participantMultiplicity', undefined);
        }
        // Every activity showing this participant redraws its band.
        affected = this.registry.filter(
          (el) =>
            el !== shape && bandsOf(el as Element).some((x) => getRef(x, 'bpmnElement') === p),
        ) as Element[];
        break;
      }
      case 'returnMessage': {
        if (!is(activity, 'bpmn:ChoreographyTask')) {
          throw new Error('Only choreography tasks have a return message.');
        }
        const initiator = getRef(activity, 'initiatingParticipantRef') ?? refs[0];
        const other = refs.find((p) => p !== initiator);
        if (!initiator || !other) throw new Error('The task needs two participants.');
        const returns = flows.filter((f) => getRef(f, 'sourceRef') !== initiator);
        const list = activity.get('messageFlowRef') as ModdleElement[];
        const owned = choreography.get('messageFlows') as ModdleElement[];
        if (op.value && !returns.length) {
          const flow = (created.returnFlow ??= this.factory.createModdle('bpmn:MessageFlow', {
            sourceRef: other,
            targetRef: initiator,
          }));
          log.set(flow, 'sourceRef', other);
          log.set(flow, 'targetRef', initiator);
          log.insert(owned, flow);
          log.setParent(flow, choreography);
          log.insert(list, flow);
        } else if (!op.value) {
          if (returns.length === flows.length) {
            throw new Error('A choreography task keeps its initiating message.');
          }
          for (const flow of returns) {
            log.remove(list, flow);
            if (!referencedElsewhere(flow, activity)) log.remove(owned, flow);
          }
        }
        break;
      }
      case 'message': {
        const initiator = getRef(activity, 'initiatingParticipantRef') ?? refs[0];
        const flow = flows.find((f) =>
          op.direction === 'initiating'
            ? getRef(f, 'sourceRef') === initiator
            : getRef(f, 'sourceRef') !== initiator,
        );
        if (!flow) throw new Error(`The task has no ${op.direction} message flow.`);
        const name = op.name.trim();
        if (!name) {
          log.set(flow, 'messageRef', undefined);
          break;
        }
        const definitions = definitionsOf(activity);
        const roots = definitions.get('rootElements') as ModdleElement[];
        let message = roots.find((r) => is(r, 'bpmn:Message') && r.name === name);
        if (!message) {
          message = created.message ??= this.factory.createModdle('bpmn:Message', { name });
          message.set('name', name);
          log.insert(roots, message);
          log.setParent(message, definitions);
        }
        log.set(flow, 'messageRef', message);
        break;
      }
    }

    this.normalize(shape, activity, order, upperCount, log);
    context.log = log;
    context.affected = affected;
    return [shape, ...affected];
  }

  /** Band kinds and bounds from the band order (first top, last bottom, the rest middle). */
  private normalize(
    shape: BpmnShape,
    activity: ModdleElement,
    order: ModdleElement[],
    upperCount: number,
    log: ChangeLog,
  ): void {
    const initiator = getRef(activity, 'initiatingParticipantRef');
    order.forEach((b, i) => {
      const position: BandPosition = i === 0 ? 'top' : i === order.length - 1 ? 'bottom' : 'middle';
      const kind = makeBandKind(position, getRef(b, 'bpmnElement') === initiator);
      if (b.get('participantBandKind') !== kind) log.set(b, 'participantBandKind', kind);
      // Middle bands show no message decorator (Table 12.33).
      if (position === 'middle' && b.get('isMessageVisible') !== undefined) {
        log.setExplicit(b, 'isMessageVisible', undefined);
      }
    });
    const layout = layoutSections(shape, order.slice(0, upperCount), order.slice(upperCount));
    for (const [b, r] of layout) {
      const bounds = getRef(b, 'bounds');
      if (!bounds) {
        const created = this.factory.createModdle('dc:Bounds', { ...r });
        log.setParent(created, b);
        log.set(b, 'bounds', created);
        continue;
      }
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (bounds.get(key) !== r[key]) log.set(bounds, key, r[key]);
      }
    }
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element, ...(context.affected ?? [])];
  }
}

function bandSectionsOf(element: Element): { upper: ModdleElement[]; lower: ModdleElement[] } {
  return bandSections(bandsOf(element));
}

function referencedElsewhere(flow: ModdleElement, except: ModdleElement): boolean {
  let used = false;
  walkContainment(definitionsOf(except), (el) => {
    if (el !== except && getMany(el, 'messageFlowRef').includes(flow)) used = true;
  });
  return used;
}

/** Position of each band, top to bottom (for the inspector). */
export function bandOrder(element: Element): { band: ModdleElement; position: BandPosition }[] {
  const { upper, lower } = bandSectionsOf(element);
  const all = [...upper, ...lower];
  return all.map((band, i) => ({
    band,
    position: i === 0 ? 'top' : i === all.length - 1 ? 'bottom' : 'middle',
  }));
}

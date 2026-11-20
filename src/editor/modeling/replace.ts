/**
 * Rules for turning an element into another notation variant of the same
 * family (replace menu, inspector "Type"): which variants fit the element's
 * position and connections, and why the others do not.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import {
  allowedEventDefinitionsIn,
  definitionCombinationProblem,
  definitionRequiredIn,
  isEventSubProcess,
  withinChoreography,
} from '@/bpmn/model/elements';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import { bandsOf } from './choreography';
import { alternativeTypes, TYPE_FAMILIES } from '../commands/ChangeTypeHandler';
import { SHAPE_LIBRARY, type LibraryEntry, type LibraryGroup } from '../library';
import {
  eventGatewayTriggersFit,
  exceedsEventSubProcessStart,
  validEventGatewayTarget,
} from '../interaction/BpmnFlowRules';
import { presetForType, presetOf, variantKey, type ShapePreset } from './presets';

const CONDITIONAL_GATEWAYS = [
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ComplexGateway',
];

/**
 * Attributes a type change may drop without losing content: they only
 * describe the old type's notation and are replaced by the new preset.
 */
const DROPPABLE = new Set([
  'parallelMultiple',
  'isInterrupting',
  'cancelActivity',
  'instantiate',
  'eventGatewayType',
  'triggeredByEvent',
  'gatewayDirection',
  'default',
  'implementation',
]);

function sequenceFlows(list: unknown): ModdleElement[] {
  return ((list as ModdleElement[] | undefined) ?? []).filter((f) => is(f, 'bpmn:SequenceFlow'));
}

function messageFlows(list: unknown): ModdleElement[] {
  return ((list as ModdleElement[] | undefined) ?? []).filter((f) => is(f, 'bpmn:MessageFlow'));
}

/** Content of `old` that an element of `newType` cannot hold (would be lost). */
export function lostProperties(old: ModdleElement, newType: string): string[] {
  if (old.$type === newType) return [];
  const model = (old as ModdleElement & { $model?: { create(t: string): ModdleElement } }).$model;
  if (!model) return [];
  const next = new Set(model.create(newType).$descriptor.properties.map((p) => p.name));
  const record = old as unknown as Record<string, unknown>;
  // References (message, operation, ...) point at root elements that stay; only own content counts.
  return old.$descriptor.properties
    .filter((p) => !next.has(p.name) && !DROPPABLE.has(p.name) && !p.isReference)
    .filter((p) => Object.prototype.hasOwnProperty.call(record, p.name))
    .filter((p) => {
      const v = record[p.name];
      return Array.isArray(v) ? v.length > 0 : v !== undefined;
    })
    .map((p) => p.name);
}

function hasTrigger(defs: readonly string[] | undefined, type: string): boolean {
  return !!defs?.includes(type);
}

/**
 * Why `element` cannot become `preset`, or null when it can. Checks the
 * family, triggers allowed at the element's position, its sequence and
 * message flows, attached boundary events and content that would be lost.
 */
export function replaceBlocker(element: Element, preset: ShapePreset): string | null {
  const b = bo(element);
  if (!b) return 'Not available.';
  // A drill-down diagram root is drawn by its plane, not a shape: change the
  // type on the collapsed sub-process in the parent diagram instead.
  if (!element.parent) return 'Change the type in the parent diagram.';
  const type = preset.type;
  if (type !== b.$type && !alternativeTypes(b.$type).includes(type)) {
    return `A ${b.$type} cannot become a ${type}.`;
  }
  const lost = lostProperties(b, type);
  if (lost.length) return `This would remove its ${lost.join(', ')}.`;
  const incoming = sequenceFlows(b.get('incoming'));
  const outgoing = sequenceFlows(b.get('outgoing'));
  const defs = preset.eventDefinitions ?? [];

  if (is(b, 'bpmn:Event')) {
    const container = b.$parent;
    const allowed = allowedEventDefinitionsIn(type, {
      container,
      isInterrupting: preset.isInterrupting,
      cancelActivity: preset.cancelActivity,
      host: getRef(b, 'attachedToRef'),
    });
    if (defs.some((d) => !allowed.includes(d))) return 'This trigger is not allowed here.';
    const combination = definitionCombinationProblem(type, defs, container);
    if (combination) return combination;
    if (!defs.length && definitionRequiredIn(type, container)) return 'This event needs a trigger.';
    if (preset.isInterrupting === false && !isEventSubProcess(container)) {
      return 'Only event sub-process start events can be non-interrupting.';
    }
    if (
      type === 'bpmn:StartEvent' &&
      b.$type !== type &&
      exceedsEventSubProcessStart(container, 1, b)
    ) {
      return 'An event sub-process has only one start event.';
    }
    if (type === 'bpmn:StartEvent' && incoming.length) {
      return 'A start event has no incoming sequence flows.';
    }
    if (type === 'bpmn:EndEvent' && outgoing.length) {
      return 'An end event has no outgoing sequence flows.';
    }
    // BPMN 2.0.2 PDF 268/288: link catch: no incoming; link throw, compensation boundary: no outgoing.
    if (
      type === 'bpmn:IntermediateCatchEvent' &&
      hasTrigger(defs, 'bpmn:LinkEventDefinition') &&
      incoming.length
    ) {
      return 'A catching link event has no incoming sequence flows.';
    }
    if (
      type === 'bpmn:IntermediateThrowEvent' &&
      hasTrigger(defs, 'bpmn:LinkEventDefinition') &&
      outgoing.length
    ) {
      return 'A throwing link event has no outgoing sequence flows.';
    }
    if (
      type === 'bpmn:BoundaryEvent' &&
      hasTrigger(defs, 'bpmn:CompensateEventDefinition') &&
      outgoing.length
    ) {
      return 'A compensation boundary event has no outgoing sequence flows.';
    }
    // Message flows (Table 7.4): only message throw / end events send, message catch events receive.
    const message = hasTrigger(defs, 'bpmn:MessageEventDefinition');
    const throwing = type === 'bpmn:IntermediateThrowEvent' || type === 'bpmn:EndEvent';
    if (messageFlows(b.get('outgoing')).length && !(throwing && message)) {
      return 'Its outgoing message flows need a message throw or end event.';
    }
    if (messageFlows(b.get('incoming')).length && (throwing || !message)) {
      return 'Its incoming message flows need a message catch event.';
    }
    // Targets of an event-based gateway (PDF 327; in a choreography PDF 379).
    if (incoming.some((f) => is(getRef(f, 'sourceRef'), 'bpmn:EventBasedGateway'))) {
      const ok = type === 'bpmn:IntermediateCatchEvent' && eventGatewayTriggersFit(defs, container);
      if (!ok)
        return withinChoreography(container)
          ? 'After an event-based gateway in a choreography only signal, timer or conditional catch events may follow.'
          : 'After an event-based gateway only message, signal, timer or conditional catch events may follow.';
    }
    return null;
  }

  if (is(b, 'bpmn:Gateway')) {
    if (preset.instantiate && incoming.length) {
      return 'An instantiating gateway has no incoming sequence flows.';
    }
    if (
      type === 'bpmn:EventBasedGateway' &&
      outgoing.some((f) => {
        const target = getRef(f, 'targetRef');
        return !target || !validEventGatewayTarget(target);
      })
    ) {
      return 'An event-based gateway leads only to catch events or receive tasks.';
    }
    // Conditions only out of exclusive, inclusive and complex gateways (PDF 125).
    if (
      !CONDITIONAL_GATEWAYS.includes(type) &&
      outgoing.some((f) => getRef(f, 'conditionExpression'))
    ) {
      return 'Remove the conditions of its outgoing sequence flows first.';
    }
    return null;
  }

  if (is(b, 'bpmn:ChoreographyActivity')) {
    const bands = bandsOf(element);
    // A choreography task is an interaction between two participants (PDF 353).
    if (type === 'bpmn:ChoreographyTask' && bands.length > 2) {
      return 'A choreography task has two participants; remove the others first.';
    }
    const messageBoundary = getMany(b.$parent, 'flowElements').some(
      (f) =>
        is(f, 'bpmn:BoundaryEvent') &&
        getRef(f, 'attachedToRef') === b &&
        getMany(f, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition')),
    );
    if (type !== 'bpmn:ChoreographyTask' && messageBoundary) {
      return 'Message boundary events are attached only to choreography tasks.';
    }
    return null;
  }

  if (is(b, 'bpmn:Activity')) {
    if (preset.instantiate && incoming.length) {
      return 'An instantiating receive task has no incoming sequence flows.';
    }
    const attached = getMany(b.$parent, 'flowElements').filter(
      (f) => is(f, 'bpmn:BoundaryEvent') && getRef(f, 'attachedToRef') === b,
    );
    if (
      type !== 'bpmn:Transaction' &&
      attached.some((e) =>
        getMany(e, 'eventDefinitions').some((d) => is(d, 'bpmn:CancelEventDefinition')),
      )
    ) {
      return 'Cancel boundary events need a transaction.';
    }
    if (is(b, 'bpmn:SubProcess')) {
      const starts = getMany(b, 'flowElements').filter((f) => is(f, 'bpmn:StartEvent'));
      const ends = getMany(b, 'flowElements').filter((f) => is(f, 'bpmn:EndEvent'));
      // "MUST NOT be used in an Ad-Hoc Sub-Process: Start Event, End Event" (PDF 211).
      if (type === 'bpmn:AdHocSubProcess' && (starts.length || ends.length)) {
        return 'An ad-hoc sub-process has no start or end events.';
      }
      if (preset.triggeredByEvent) {
        // An event sub-process is outside the normal flow (PDF 204).
        if (incoming.length || outgoing.length) {
          return 'An event sub-process has no incoming or outgoing sequence flows.';
        }
        if (attached.length) return 'An event sub-process has no boundary events.';
        if (messageFlows(b.get('incoming')).length || messageFlows(b.get('outgoing')).length) {
          return 'An event sub-process has no message flows.';
        }
      } else if (starts.some((s) => getMany(s, 'eventDefinitions').length)) {
        return 'Its start event has a trigger, which only an event sub-process allows.';
      }
      if (is(b, 'bpmn:Transaction') && type !== 'bpmn:Transaction') {
        let cancel = false;
        walkContainment(b, (el) => {
          if (is(el, 'bpmn:CancelEventDefinition') && is(el.$parent, 'bpmn:EndEvent'))
            cancel = true;
        });
        if (cancel) return 'Cancel end events need a transaction.';
      }
    }
    return null;
  }
  return null;
}

/** Whether `candidate` is the variant `element` already is. */
export function isCurrentVariant(element: Element, candidate: ShapePreset): boolean {
  const b = bo(element);
  if (!b) return false;
  const di = (element as { di?: ModdleElement }).di;
  return variantKey(presetOf(b, di)) === variantKey(candidate);
}

/** The preset for a plain type change of `element` (see presetForType). */
export function typeChangePreset(element: Element, newType: string): ShapePreset | null {
  const b = bo(element);
  if (!b) return null;
  const di = (element as { di?: ModdleElement }).di;
  return presetForType(presetOf(b, di), newType);
}

/** Types `element` may change to (inspector "Type", context menu), with blocked ones left out. */
export function allowedTypeChanges(element: Element): string[] {
  const b = bo(element);
  if (!b || !element.parent) return [];
  return alternativeTypes(b.$type).filter((t) => {
    const preset = typeChangePreset(element, t);
    return !!preset && !replaceBlocker(element, preset);
  });
}

export interface ReplaceOption {
  entry: LibraryEntry;
  group: LibraryGroup;
  /** The preset to apply (a Multiple event keeps its own triggers). */
  preset: ShapePreset;
}

const REPLACE_FAMILIES = [['bpmn:BoundaryEvent'], ...TYPE_FAMILIES];

/**
 * Library variants `element` can be turned into: the same family (events in
 * the flow, boundary events, tasks, sub-processes, gateways, conversations),
 * not the variant it already is, and only those its position and connections
 * allow (see `replaceBlocker`).
 */
export function replaceOptions(element: Element): ReplaceOption[] {
  const b = bo(element);
  if (!b || !element.parent || (element as { unsupported?: boolean }).unsupported) return [];
  const family = REPLACE_FAMILIES.find((f) => f.includes(b.$type));
  if (!family) return [];
  const di = (element as { di?: ModdleElement }).di;
  const current = presetOf(b, di);
  const out: ReplaceOption[] = [];
  for (const group of SHAPE_LIBRARY) {
    for (const entry of group.entries) {
      if (entry.replace === false || !family.includes(entry.preset.type)) continue;
      let preset = entry.preset;
      // Multiple ↔ parallel multiple keeps the triggers the user chose.
      if (
        (preset.eventDefinitions?.length ?? 0) > 1 &&
        (current.eventDefinitions?.length ?? 0) > 1
      ) {
        preset = { ...preset, eventDefinitions: current.eventDefinitions };
      }
      if (variantKey(preset) === variantKey(current)) continue;
      if (replaceBlocker(element, preset)) continue;
      out.push({ entry, group, preset });
    }
  }
  return out;
}

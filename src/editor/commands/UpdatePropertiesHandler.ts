/**
 * Undoable semantic edits on a single element: plain properties, documentation
 * and sequence-flow conditions. Each handler logs its inverse in a ChangeLog.
 */
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type { Element } from 'diagram-js/lib/model/Types';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import { getMany, getRef, is, walkContainment } from '@/bpmn/model/moddle';
import {
  canHaveDefaultFlow,
  conditionBlocker,
  enclosingProcess,
  interruptingIsFixed,
  sequenceFlowsAt,
} from '@/bpmn/model/elements';
import { bo } from '../model';
import { ChangeLog } from '../modeling/ChangeLog';

export const UPDATE_PROPERTIES = 'element.updateProperties';
export const UPDATE_DOCUMENTATION = 'element.updateDocumentation';
export const UPDATE_CONDITION = 'element.updateCondition';

import type { PropertyValue } from '../types';

export type { PropertyValue };

export interface UpdatePropertiesContext {
  element: Element;
  properties: Record<string, PropertyValue>;
  log?: ChangeLog;
  /** Other elements whose drawing changed (references sharing a data object...). */
  affected?: Element[];
}

/** Properties the inspector may change. References are validated per key. */
const EDITABLE: Record<string, (target: ModdleElement, value: PropertyValue) => boolean> = {
  name: (_t, v) => v === undefined || typeof v === 'string',
  text: (t, v) => is(t, 'bpmn:TextAnnotation') && (v === undefined || typeof v === 'string'),
  // Error, cancel and compensation triggers always interrupt (BPMN 2.0.2 PDF 272, 287).
  cancelActivity: (t, v) =>
    is(t, 'bpmn:BoundaryEvent') && typeof v === 'boolean' && (v || !interruptingIsFixed(t)),
  isInterrupting: (t, v) =>
    is(t, 'bpmn:StartEvent') && typeof v === 'boolean' && (v || !interruptingIsFixed(t)),
  // BPMN "Parallel Multiple": only on catching events with several triggers.
  parallelMultiple: (t, v) =>
    (is(t, 'bpmn:StartEvent') ||
      is(t, 'bpmn:IntermediateCatchEvent') ||
      is(t, 'bpmn:BoundaryEvent')) &&
    (v === undefined || (typeof v === 'boolean' && getMany(t, 'eventDefinitions').length > 1)),
  // An instantiating gateway or receive task has no incoming sequence flows (PDF 189, 328).
  instantiate: (t, v) =>
    (is(t, 'bpmn:EventBasedGateway') || is(t, 'bpmn:ReceiveTask')) &&
    (v === undefined || v === false || (v === true && !hasSequenceFlows(t, 'incoming'))),
  eventGatewayType: (t, v) =>
    is(t, 'bpmn:EventBasedGateway') && (v === undefined || v === 'Exclusive' || v === 'Parallel'),
  // Stored on the referenced bpmn:DataObject (collection marker).
  isCollection: (t, v) =>
    ((is(t, 'bpmn:DataObjectReference') && !!getRef(t, 'dataObjectRef')) ||
      is(t, 'bpmn:DataInput') ||
      is(t, 'bpmn:DataOutput')) &&
    (v === undefined || typeof v === 'boolean'),
  // Compensation activities are outside the normal flow (PDF 268): no sequence flows.
  isForCompensation: (t, v) =>
    is(t, 'bpmn:Activity') &&
    (v === undefined ||
      v === false ||
      (v === true && !hasSequenceFlows(t, 'incoming') && !hasSequenceFlows(t, 'outgoing'))),
  // Call activity: the process or global task it calls (QName, BPMN 2.0.2 §10.3.5).
  // An id of another kind of root element (a choreography, collaboration...) is refused.
  calledElement: (t, v) =>
    is(t, 'bpmn:CallActivity') &&
    (v === undefined || (typeof v === 'string' && callableOrUnknown(t, v))),
  // Table 8.46 (PDF 118-119): Converging = at most one outgoing, Diverging = at
  // most one incoming sequence flow; "Unspecified" is the default (stored as absent).
  gatewayDirection: (t, v) =>
    is(t, 'bpmn:Gateway') &&
    (v === undefined ||
      v === 'Mixed' ||
      (v === 'Converging' && sequenceFlowCount(t, 'outgoing') <= 1) ||
      (v === 'Diverging' && sequenceFlowCount(t, 'incoming') <= 1)),
  // "Executable Processes cannot have a false value for the isImmediate attribute" (PDF 339).
  isImmediate: (t, v) =>
    is(t, 'bpmn:SequenceFlow') &&
    (v === undefined || v === true || (v === false && !isExecutable(t))),
  // Text Annotation textFormat: a MIME type, text/plain by default (Table 8.24, PDF 100).
  textFormat: (t, v) =>
    is(t, 'bpmn:TextAnnotation') &&
    (v === undefined || (typeof v === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(v))),
  // Process attributes (Table 10.1, PDF 341); on a pool they go to its process.
  processType: (t, v) =>
    is(t, 'bpmn:Process') && (v === undefined || v === 'Public' || v === 'Private'),
  isClosed: (t, v) => is(t, 'bpmn:Process') && (v === undefined || typeof v === 'boolean'),
  // Executable processes have no isImmediate="false" flows (PDF 339).
  isExecutable: (t, v) =>
    is(t, 'bpmn:Process') &&
    (v === undefined || v === false || (v === true && !hasNonImmediateFlows(t))),
  // Choreography activities: loop marker (Table 11.1 loopType, PDF 352, 355).
  loopType: (t, v) =>
    is(t, 'bpmn:ChoreographyActivity') &&
    (v === undefined ||
      v === 'None' ||
      v === 'Standard' ||
      v === 'MultiInstanceSequential' ||
      v === 'MultiInstanceParallel'),
  // Call choreography: a Choreography or Global Choreography Task (PDF 363).
  calledChoreographyRef: (t, v) =>
    is(t, 'bpmn:CallChoreography') &&
    (v === undefined || (isRootOfType(v, 'bpmn:Choreography') && !encloses(v, t))),
  // Call conversation: a Collaboration or Global Conversation (PDF 163), not a choreography.
  calledCollaborationRef: (t, v) =>
    is(t, 'bpmn:CallConversation') &&
    (v === undefined ||
      (isRootOfType(v, 'bpmn:Collaboration') &&
        !is(v as ModdleElement, 'bpmn:Choreography') &&
        !encloses(v, t))),
  associationDirection: (t, v) =>
    is(t, 'bpmn:Association') && (v === undefined || v === 'None' || v === 'One' || v === 'Both'),
  // A gateway's default flow must be one of its outgoing sequence flows.
  // Activities and exclusive / inclusive / complex gateways (PDF 126).
  default: (t, v) =>
    v === undefined ||
    (typeof v === 'object' && canHaveDefaultFlow(t) && getMany(t, 'outgoing').includes(v)),
};

/** Attributes of a process that a pool edits on its process. */
const PROCESS_KEYS = ['processType', 'isClosed', 'isExecutable'];

function sequenceFlowCount(t: ModdleElement, key: 'incoming' | 'outgoing'): number {
  return sequenceFlowsAt(t, key).length;
}

function isExecutable(el: ModdleElement): boolean {
  return enclosingProcess(el)?.get('isExecutable') === true;
}

function hasNonImmediateFlows(process: ModdleElement): boolean {
  let found = false;
  walkContainment(process, (el) => {
    if (is(el, 'bpmn:SequenceFlow') && el.get('isImmediate') === false) found = true;
  });
  return found;
}

/** Whether `id` names a process or global task of the file, or nothing known (an import). */
function callableOrUnknown(t: ModdleElement, id: string): boolean {
  const root = getMany(definitionsOf(t), 'rootElements').find((r) => r.id === id);
  return !root || is(root, 'bpmn:Process') || is(root, 'bpmn:GlobalTask');
}

/** A root element (child of the definitions) of `type`. */
function isRootOfType(v: PropertyValue, type: string): boolean {
  return typeof v === 'object' && !!v && is(v, type) && is(v.$parent, 'bpmn:Definitions');
}

/** Whether `outer` contains `el` (an element cannot call what it is part of). */
function encloses(outer: PropertyValue, el: ModdleElement): boolean {
  for (let p: ModdleElement | undefined = el; p; p = p.$parent) if (p === outer) return true;
  return false;
}

function hasSequenceFlows(t: ModdleElement, key: 'incoming' | 'outgoing'): boolean {
  return getMany(t, key).some((f) => is(f, 'bpmn:SequenceFlow'));
}

/** The Data Object / Data Store a reference points to. */
function dataOf(target: ModdleElement): ModdleElement | undefined {
  if (is(target, 'bpmn:DataObjectReference')) return getRef(target, 'dataObjectRef');
  if (is(target, 'bpmn:DataStoreReference')) return getRef(target, 'dataStoreRef');
  return undefined;
}

function changed(context: UpdatePropertiesContext): Element[] {
  const { element } = context;
  return [
    element,
    ...(element.incoming ?? []),
    ...(element.outgoing ?? []),
    ...(context.affected ?? []),
  ];
}

function definitionsOf(el: ModdleElement): ModdleElement {
  let p = el;
  while (p.$parent) p = p.$parent;
  return p;
}

/**
 * Sets the collection flag (PDF 233, 243): on the Data Object of a reference,
 * or on the Data Input / Output. "If an itemDefinition is referenced, then this
 * attribute MUST have the same value as the isCollection attribute of the
 * referenced itemDefinition" (Table 10.49), so the Item Definition and every
 * data element using it follow. Returns the model elements that changed.
 */
function setCollection(
  target: ModdleElement,
  value: PropertyValue,
  log: ChangeLog,
): ModdleElement[] {
  const holder = is(target, 'bpmn:DataObjectReference') ? getRef(target, 'dataObjectRef')! : target;
  log.set(holder, 'isCollection', value);
  const item = getRef(holder, 'itemSubjectRef');
  if (!item || !is(item, 'bpmn:ItemDefinition')) return [holder];
  log.set(item, 'isCollection', value);
  const out = [holder];
  walkContainment(definitionsOf(holder), (el) => {
    const dataElement =
      is(el, 'bpmn:DataObject') || is(el, 'bpmn:DataInput') || is(el, 'bpmn:DataOutput');
    if (el === holder || !dataElement || getRef(el, 'itemSubjectRef') !== item) return;
    log.set(el, 'isCollection', value);
    out.push(el);
  });
  return out;
}

export class UpdatePropertiesHandler {
  static $inject = ['elementRegistry'];
  constructor(private readonly registry?: ElementRegistry) {}

  /** Diagram elements drawing one of `changed` (data inputs / outputs, references of data objects). */
  private drawing(changedEls: ModdleElement[], except: Element): Element[] {
    if (!this.registry) return [];
    return this.registry.filter((el) => {
      if (el === except) return false;
      const b = bo(el as Element);
      if (!b) return false;
      return changedEls.includes(b) || changedEls.includes(getRef(b, 'dataObjectRef')!);
    }) as Element[];
  }

  execute(context: UpdatePropertiesContext): Element[] {
    const target = bo(context.element);
    if (!target) return [];
    const log = new ChangeLog();
    for (const [key, raw] of Object.entries(context.properties)) {
      let value = raw === '' ? undefined : raw;
      if (key === 'gatewayDirection' && value === 'Unspecified') value = undefined;
      if (key === 'textFormat' && value === 'text/plain') value = undefined;
      const check = EDITABLE[key];
      // A pool's process attributes are stored on its process.
      const holder: ModdleElement | undefined =
        PROCESS_KEYS.includes(key) && is(target, 'bpmn:Participant')
          ? getRef(target, 'processRef')
          : target;
      if (holder !== target) {
        if (!holder || !check?.(holder, value)) {
          log.undo();
          throw new Error(`Property "${key}" of ${target.$type} cannot be set to this value.`);
        }
        log.set(holder, key, value);
        continue;
      }
      if (!check || !check(target, value)) {
        log.undo();
        throw new Error(`Property "${key}" of ${target.$type} cannot be set to this value.`);
      }
      // Text annotations keep their label in `text`, groups in their category value.
      if (key === 'name' && is(target, 'bpmn:TextAnnotation')) log.set(target, 'text', value);
      else if (key === 'name' && is(target, 'bpmn:Group')) {
        const categoryValue = getRef(target, 'categoryValueRef');
        if (categoryValue) log.set(categoryValue, 'value', value);
      } else if (key === 'name' && (dataOf(target) ?? null)) {
        // The Data Object / Data Store carries the name too (BPMN 2.0.2 Table 2.1):
        // keep it in step while it is unnamed or still has the reference's name.
        const data = dataOf(target)!;
        if (data.name === undefined || data.name === target.name) log.set(data, 'name', value);
        log.set(target, key, value);
      } else if (key === 'isCollection') {
        const affected = this.drawing(setCollection(target, value, log), context.element);
        context.affected = [...(context.affected ?? []), ...affected];
      } else log.set(target, key, value);
    }
    context.log = log;
    return changed(context);
  }

  revert(context: UpdatePropertiesContext): Element[] {
    context.log?.undo();
    return changed(context);
  }
}

export class UpdateDocumentationHandler {
  static $inject = ['moddle'];
  constructor(private readonly moddle: BpmnModdleInstance) {}

  execute(context: { element: Element; text: string; log?: ChangeLog }): Element[] {
    const target = bo(context.element);
    if (!target) return [];
    const log = new ChangeLog();
    const docs = target.get('documentation') as (ModdleElement & { text?: string })[];
    const first = docs[0];
    const text = context.text.trim() ? context.text : '';
    if (text && first) log.set(first, 'text', text);
    else if (text) {
      const doc = this.moddle.create('bpmn:Documentation', { text });
      doc.$parent = target;
      log.insert(docs, doc, 0);
    } else if (first) log.remove(docs, first);
    context.log = log;
    return [context.element];
  }

  revert(context: { element: Element; log?: ChangeLog }): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

export class UpdateConditionHandler {
  static $inject = ['moddle'];
  constructor(private readonly moddle: BpmnModdleInstance) {}

  execute(context: {
    element: Element;
    body: string;
    /** false: a natural-language bpmn:Expression; otherwise a bpmn:FormalExpression. */
    formal?: boolean;
    log?: ChangeLog;
  }): Element[] {
    const flow = bo(context.element);
    if (!flow || !is(flow, 'bpmn:SequenceFlow')) return [];
    const log = new ChangeLog();
    const current = getRef<ModdleElement & { body?: string }>(flow, 'conditionExpression');
    const body = context.body.trim();
    // No conditions out of parallel / event-based gateways or events (PDF 125, 274),
    // nor on the only outgoing flow of an activity (PDF 125).
    const blocker = body && !current ? conditionBlocker(flow) : null;
    if (blocker) throw new Error(blocker);
    if (body && current) log.set(current, 'body', body);
    else if (body) {
      const expr = this.moddle.create(
        context.formal === false ? 'bpmn:Expression' : 'bpmn:FormalExpression',
        { body },
      );
      expr.$parent = flow;
      log.set(flow, 'conditionExpression', expr);
    } else if (current) log.set(flow, 'conditionExpression', undefined);
    context.log = log;
    return [context.element];
  }

  revert(context: { element: Element; log?: ChangeLog }): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

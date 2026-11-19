/**
 * Undoable semantic edits on a single element: plain properties, documentation
 * and sequence-flow conditions. Each handler logs its inverse in a ChangeLog.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import { getMany, getRef, is } from '@/bpmn/model/moddle';
import {
  canHaveDefaultFlow,
  conditionAllowedFrom,
  interruptingIsFixed,
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
  // An instantiating gateway has no incoming sequence flows (PDF 328).
  instantiate: (t, v) =>
    is(t, 'bpmn:EventBasedGateway') &&
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
  calledElement: (t, v) => is(t, 'bpmn:CallActivity') && (v === undefined || typeof v === 'string'),
  associationDirection: (t, v) =>
    is(t, 'bpmn:Association') && (v === undefined || v === 'None' || v === 'One' || v === 'Both'),
  // A gateway's default flow must be one of its outgoing sequence flows.
  // Activities and exclusive / inclusive / complex gateways (PDF 126).
  default: (t, v) =>
    v === undefined ||
    (typeof v === 'object' && canHaveDefaultFlow(t) && getMany(t, 'outgoing').includes(v)),
};

function hasSequenceFlows(t: ModdleElement, key: 'incoming' | 'outgoing'): boolean {
  return getMany(t, key).some((f) => is(f, 'bpmn:SequenceFlow'));
}

/** The Data Object / Data Store a reference points to. */
function dataOf(target: ModdleElement): ModdleElement | undefined {
  if (is(target, 'bpmn:DataObjectReference')) return getRef(target, 'dataObjectRef');
  if (is(target, 'bpmn:DataStoreReference')) return getRef(target, 'dataStoreRef');
  return undefined;
}

function changed(element: Element): Element[] {
  return [element, ...(element.incoming ?? []), ...(element.outgoing ?? [])];
}

export class UpdatePropertiesHandler {
  execute(context: UpdatePropertiesContext): Element[] {
    const target = bo(context.element);
    if (!target) return [];
    const log = new ChangeLog();
    for (const [key, raw] of Object.entries(context.properties)) {
      const value = raw === '' ? undefined : raw;
      const check = EDITABLE[key];
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
      } else if (key === 'isCollection' && is(target, 'bpmn:DataObjectReference')) {
        log.set(getRef(target, 'dataObjectRef')!, 'isCollection', value);
      } else log.set(target, key, value);
    }
    context.log = log;
    return changed(context.element);
  }

  revert(context: UpdatePropertiesContext): Element[] {
    context.log?.undo();
    return changed(context.element);
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

  execute(context: { element: Element; body: string; log?: ChangeLog }): Element[] {
    const flow = bo(context.element);
    if (!flow || !is(flow, 'bpmn:SequenceFlow')) return [];
    const log = new ChangeLog();
    const current = getRef<ModdleElement & { body?: string }>(flow, 'conditionExpression');
    const body = context.body.trim();
    // No conditions out of parallel / event-based gateways or events (PDF 125, 274).
    if (body && !conditionAllowedFrom(getRef(flow, 'sourceRef'))) {
      throw new Error('Sequence flows from this element cannot have a condition.');
    }
    if (body && current) log.set(current, 'body', body);
    else if (body) {
      const expr = this.moddle.create('bpmn:FormalExpression', { body });
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

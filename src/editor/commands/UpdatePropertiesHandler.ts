/**
 * Undoable semantic edits on a single element: plain properties, documentation
 * and sequence-flow conditions. Each handler logs its inverse in a ChangeLog.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import { getMany, getRef, is } from '@/bpmn/model/moddle';
import { bo } from '../model';
import { ChangeLog } from '../modeling/ChangeLog';

export const UPDATE_PROPERTIES = 'element.updateProperties';
export const UPDATE_DOCUMENTATION = 'element.updateDocumentation';
export const UPDATE_CONDITION = 'element.updateCondition';

export type PropertyValue = string | number | boolean | ModdleElement | undefined;

export interface UpdatePropertiesContext {
  element: Element;
  properties: Record<string, PropertyValue>;
  log?: ChangeLog;
}

/** Properties the inspector may change. References are validated per key. */
const EDITABLE: Record<string, (target: ModdleElement, value: PropertyValue) => boolean> = {
  name: (_t, v) => v === undefined || typeof v === 'string',
  text: (t, v) => is(t, 'bpmn:TextAnnotation') && (v === undefined || typeof v === 'string'),
  cancelActivity: (t, v) => is(t, 'bpmn:BoundaryEvent') && typeof v === 'boolean',
  isInterrupting: (t, v) => is(t, 'bpmn:StartEvent') && typeof v === 'boolean',
  // BPMN "Parallel Multiple": only on catching events with several triggers.
  parallelMultiple: (t, v) =>
    (is(t, 'bpmn:StartEvent') ||
      is(t, 'bpmn:IntermediateCatchEvent') ||
      is(t, 'bpmn:BoundaryEvent')) &&
    (v === undefined || (typeof v === 'boolean' && getMany(t, 'eventDefinitions').length > 1)),
  instantiate: (t, v) =>
    is(t, 'bpmn:EventBasedGateway') && (v === undefined || typeof v === 'boolean'),
  eventGatewayType: (t, v) =>
    is(t, 'bpmn:EventBasedGateway') && (v === undefined || v === 'Exclusive' || v === 'Parallel'),
  // Stored on the referenced bpmn:DataObject (collection marker).
  isCollection: (t, v) =>
    ((is(t, 'bpmn:DataObjectReference') && !!getRef(t, 'dataObjectRef')) ||
      is(t, 'bpmn:DataInput') ||
      is(t, 'bpmn:DataOutput')) &&
    (v === undefined || typeof v === 'boolean'),
  isForCompensation: (t, v) =>
    is(t, 'bpmn:Activity') && (v === undefined || typeof v === 'boolean'),
  // A gateway's default flow must be one of its outgoing sequence flows.
  default: (t, v) =>
    v === undefined ||
    (typeof v === 'object' && is(t, 'bpmn:Gateway') && getMany(t, 'outgoing').includes(v)),
};

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

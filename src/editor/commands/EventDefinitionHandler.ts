/**
 * Sets the event definitions (triggers) of an event. One definition gives a
 * typed event, several a BPMN "Multiple" event, none a none event. Existing
 * definitions of a kept type are reused, so referenced messages and timer
 * expressions survive. Dropping below two definitions clears `parallelMultiple`.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { supportedEventDefinitions } from '@/bpmn/model/elements';
import { getMany, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';

export const SET_EVENT_DEFINITION = 'event.setDefinition';

interface Context {
  element: Element;
  /** e.g. 'bpmn:TimerEventDefinition'; undefined for a none event. */
  definitionType?: string;
  /** Full list of definition types (overrides `definitionType`). */
  definitionTypes?: string[];
  created?: ModdleElement[];
  log?: ChangeLog;
}

export default class EventDefinitionHandler {
  static $inject = ['elementFactory'];
  constructor(private readonly factory: BpmnElementFactory) {}

  execute(context: Context): Element[] {
    const event = bo(context.element);
    if (!event) return [];
    const types =
      context.definitionTypes ?? (context.definitionType ? [context.definitionType] : []);
    const allowed = supportedEventDefinitions(event.$type);
    for (const type of types) {
      if (!allowed.includes(type)) throw new Error(`${type} is not supported on ${event.$type}.`);
    }
    if (new Set(types).size !== types.length) {
      throw new Error('An event cannot have the same trigger twice.');
    }
    const current = getMany(event, 'eventDefinitions');
    const created = (context.created ??= []);
    const next = types.map((type) => {
      const existing = current.find((d) => d.$type === type);
      if (existing) return existing;
      let def = created.find((d) => d.$type === type);
      if (!def) {
        def = this.factory.createModdle(type);
        created.push(def);
      }
      def.$parent = event;
      return def;
    });
    const log = new ChangeLog();
    if (next.length !== current.length || next.some((d, i) => d !== current[i])) {
      log.replaceAll(event.get('eventDefinitions') as ModdleElement[], next);
    }
    if (next.length < 2 && event.get('parallelMultiple') === true) {
      log.set(event, 'parallelMultiple', undefined);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

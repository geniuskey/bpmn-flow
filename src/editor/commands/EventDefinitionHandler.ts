/**
 * Sets the event definition of a start/end event: none, message, timer
 * (start only) or terminate (end only). Definitions that already exist are kept
 * when switching back, so referenced messages and timer expressions survive.
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
  created?: ModdleElement;
  log?: ChangeLog;
}

export default class EventDefinitionHandler {
  static $inject = ['elementFactory'];
  constructor(private readonly factory: BpmnElementFactory) {}

  execute(context: Context): Element[] {
    const event = bo(context.element);
    if (!event) return [];
    const type = context.definitionType;
    if (type && !supportedEventDefinitions(event.$type).includes(type)) {
      throw new Error(`${type} is not supported on ${event.$type}.`);
    }
    const defs = event.get('eventDefinitions') as ModdleElement[];
    const log = new ChangeLog();
    if (!type) {
      log.replaceAll(defs, []);
    } else if (getMany(event, 'eventDefinitions')[0]?.$type !== type) {
      const def = (context.created ??= this.factory.createModdle(type));
      def.$parent = event;
      log.replaceAll(defs, [def]);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

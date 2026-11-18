/**
 * Edits the details of an event's definition so events are complete enough to
 * execute in other tools:
 * - timer: one of timeDuration / timeDate / timeCycle (ISO 8601 expression)
 * - message / signal / error / escalation: reference to a root element by name
 *   (an existing one with that name is reused, otherwise one is created)
 * - conditional: the condition expression
 */
import type { Element } from 'diagram-js/lib/model/Types';
import {
  getMany,
  getRef,
  is,
  type BpmnModdleInstance,
  type ModdleElement,
} from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';

export const UPDATE_EVENT_DETAIL = 'event.updateDetail';

export type TimerType = 'timeDuration' | 'timeDate' | 'timeCycle';
export const TIMER_TYPES: TimerType[] = ['timeDuration', 'timeDate', 'timeCycle'];

export type EventDetail =
  | { kind: 'timer'; timerType: TimerType; value: string }
  | { kind: 'reference'; name: string }
  | { kind: 'condition'; value: string };

/** Definition type → [reference property, referenced root element type]. */
export const REFERENCES: Record<string, [string, string]> = {
  'bpmn:MessageEventDefinition': ['messageRef', 'bpmn:Message'],
  'bpmn:SignalEventDefinition': ['signalRef', 'bpmn:Signal'],
  'bpmn:ErrorEventDefinition': ['errorRef', 'bpmn:Error'],
  'bpmn:EscalationEventDefinition': ['escalationRef', 'bpmn:Escalation'],
};

export function timerOf(definition: ModdleElement): { timerType: TimerType; value: string } | null {
  for (const t of TIMER_TYPES) {
    const expr = getRef<ModdleElement & { body?: string }>(definition, t);
    if (expr) return { timerType: t, value: expr.body ?? '' };
  }
  return null;
}

interface Context {
  element: Element;
  detail: EventDetail;
  log?: ChangeLog;
  created?: ModdleElement;
}

export default class EventDetailHandler {
  static $inject = ['moddle', 'elementFactory', 'bpmnDefinitions'];
  constructor(
    private readonly moddle: BpmnModdleInstance,
    private readonly factory: BpmnElementFactory,
    private readonly definitions: ModdleElement,
  ) {}

  private expression(parent: ModdleElement, body: string): ModdleElement {
    const expr = this.moddle.create('bpmn:FormalExpression', { body });
    expr.$parent = parent;
    return expr;
  }

  execute(context: Context): Element[] {
    const event = bo(context.element);
    const definition = event && getMany(event, 'eventDefinitions')[0];
    if (!definition) return [];
    const log = new ChangeLog();
    const { detail } = context;

    if (detail.kind === 'timer' && is(definition, 'bpmn:TimerEventDefinition')) {
      for (const t of TIMER_TYPES) {
        const value =
          t === detail.timerType && detail.value.trim()
            ? this.expression(definition, detail.value.trim())
            : undefined;
        log.set(definition, t, value);
      }
    } else if (detail.kind === 'condition' && is(definition, 'bpmn:ConditionalEventDefinition')) {
      log.set(
        definition,
        'condition',
        detail.value.trim() ? this.expression(definition, detail.value.trim()) : undefined,
      );
    } else if (detail.kind === 'reference' && REFERENCES[definition.$type]) {
      const [property, rootType] = REFERENCES[definition.$type]!;
      const name = detail.name.trim();
      if (!name) {
        log.set(definition, property, undefined);
      } else {
        const roots = this.definitions.get('rootElements') as ModdleElement[];
        let target = roots.find((r) => r.$type === rootType && r.name === name);
        if (!target) {
          target = context.created?.$type === rootType ? context.created : undefined;
          target ??= context.created = this.factory.createModdle(rootType, { name });
          target.set('name', name);
          log.insert(roots, target);
          log.setParent(target, this.definitions);
        }
        log.set(definition, property, target);
      }
    } else {
      throw new Error(`Cannot apply ${detail.kind} to ${definition.$type}.`);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

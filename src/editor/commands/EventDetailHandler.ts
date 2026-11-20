/**
 * Edits the details of an event's definition so events are complete enough to
 * execute in other tools:
 * - timer: one of timeDuration / timeDate / timeCycle (ISO 8601 expression)
 * - message / signal / error / escalation: reference to a root element by name
 *   (an existing one with that name is reused, otherwise one is created)
 * - conditional: the condition expression
 * - link: the name that pairs a throwing and a catching link event (and the
 *   source / target references that follow from it)
 * - error / escalation code of the referenced Error / Escalation
 * - compensation: the activity to compensate and waitForCompletion
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

import type { EventDetail, TimerType } from '../types';

export type { EventDetail, TimerType };
export const TIMER_TYPES: TimerType[] = ['timeDuration', 'timeDate', 'timeCycle'];

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

/**
 * Activities a compensation throw event may name in `activityRef` (Table
 * 10.94, PDF 293): those of its own process level, and for an event in an
 * event sub-process those of the enclosing level too (PDF 312).
 */
export function compensableActivities(event: ModdleElement): ModdleElement[] {
  const scopes = [event.$parent];
  if (event.$parent?.get('triggeredByEvent') === true) scopes.push(event.$parent.$parent);
  return scopes.flatMap((scope) =>
    getMany(scope, 'flowElements').filter(
      (f) =>
        is(f, 'bpmn:Activity') &&
        f.get('isForCompensation') !== true &&
        f.get('triggeredByEvent') !== true,
    ),
  );
}

/**
 * Keeps the explicit link references in step with the names that pair link
 * events at one process level (Table 10.98, PDF 299): a throwing link's
 * `target` is the one catching link of its name, a catching link's `source`
 * lists the throwing links of its name.
 */
export function syncLinkReferences(container: ModdleElement | undefined, log: ChangeLog): void {
  const links = (type: string) =>
    getMany(container, 'flowElements')
      .filter((f) => is(f, type))
      .flatMap((f) => getMany(f, 'eventDefinitions'))
      .filter((d) => is(d, 'bpmn:LinkEventDefinition'));
  const throws = links('bpmn:IntermediateThrowEvent');
  const catches = links('bpmn:IntermediateCatchEvent');
  const named = (d: ModdleElement, name: unknown) => !!name && d.get('name') === name;
  for (const t of throws) {
    const matches = catches.filter((c) => named(c, t.get('name')));
    log.set(t, 'target', matches.length === 1 ? matches[0] : undefined);
  }
  for (const c of catches) {
    const sources = throws.filter((t) => named(t, c.get('name')));
    const current = getMany(c, 'source');
    const same = current.length === sources.length && current.every((s, i) => s === sources[i]);
    if (!same) log.replaceAll(c.get('source') as ModdleElement[], sources);
  }
}

interface Context {
  element: Element;
  detail: EventDetail;
  /** Which definition of a Multiple event to edit (default: the first). */
  definitionIndex?: number;
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
    const definition = event && getMany(event, 'eventDefinitions')[context.definitionIndex ?? 0];
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
      // The condition is required by the XSD: clearing it leaves an empty expression.
      log.set(definition, 'condition', this.expression(definition, detail.value.trim()));
    } else if (detail.kind === 'link' && is(definition, 'bpmn:LinkEventDefinition')) {
      // `name` is a required attribute of a link trigger (XSD): cleared, it stays empty.
      log.set(definition, 'name', detail.name.trim());
      syncLinkReferences(event.$parent, log);
    } else if (
      detail.kind === 'code' &&
      (is(definition, 'bpmn:ErrorEventDefinition') ||
        is(definition, 'bpmn:EscalationEventDefinition'))
    ) {
      const error = is(definition, 'bpmn:ErrorEventDefinition');
      const ref = getRef(definition, error ? 'errorRef' : 'escalationRef');
      if (!ref) throw new Error(`Name the ${error ? 'error' : 'escalation'} first.`);
      log.set(ref, error ? 'errorCode' : 'escalationCode', detail.value.trim() || undefined);
    } else if (
      detail.kind === 'compensateActivity' &&
      is(definition, 'bpmn:CompensateEventDefinition')
    ) {
      if (detail.activityId === null) log.set(definition, 'activityRef', undefined);
      else {
        const activity = compensableActivities(event).find((a) => a.id === detail.activityId);
        if (!activity) throw new Error('That activity is not in the scope of the event.');
        log.set(definition, 'activityRef', activity);
      }
    } else if (
      detail.kind === 'waitForCompletion' &&
      is(definition, 'bpmn:CompensateEventDefinition')
    ) {
      // true is the default (Table 10.94): stored as absent.
      log.set(definition, 'waitForCompletion', detail.value ? undefined : false);
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

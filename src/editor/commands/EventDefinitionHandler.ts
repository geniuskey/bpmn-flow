/**
 * Sets the event definitions (triggers) of an event. One definition gives a
 * typed event, several a BPMN "Multiple" event, none a none event. Existing
 * definitions of a kept type are reused, so referenced messages and timer
 * expressions survive. Dropping below two definitions clears `parallelMultiple`.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { allowedEventDefinitions, definitionCombinationProblem } from '@/bpmn/model/elements';
import { getMany, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';

export const SET_EVENT_DEFINITION = 'event.setDefinition';

const ALWAYS_INTERRUPTING = [
  'bpmn:ErrorEventDefinition',
  'bpmn:CancelEventDefinition',
  'bpmn:CompensateEventDefinition',
];

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}

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
    const allowed = allowedEventDefinitions(event);
    const present = getMany(event, 'eventDefinitions').map((d) => d.$type);
    for (const type of types) {
      // A trigger the file already has may stay even where it is not allowed (the analyzer reports it).
      if (!allowed.includes(type) && !present.includes(type)) {
        throw new Error(`${type} is not allowed on this ${event.$type}.`);
      }
    }
    const shape = context.element as { incoming?: unknown[]; outgoing?: unknown[] };
    const has = (type: string) => types.includes(type) && !present.includes(type);
    // BPMN 2.0.2 PDF 268/288: link catch events have no incoming, link throw events
    // and compensation boundary events no outgoing sequence flows.
    if (has('bpmn:LinkEventDefinition') || has('bpmn:CompensateEventDefinition')) {
      const flows = (list: unknown[] | undefined) =>
        (list ?? []).some((c) =>
          is((c as { businessObject?: ModdleElement }).businessObject, 'bpmn:SequenceFlow'),
        );
      const blocked =
        (has('bpmn:LinkEventDefinition') &&
          (is(event, 'bpmn:IntermediateCatchEvent')
            ? flows(shape.incoming)
            : flows(shape.outgoing))) ||
        (has('bpmn:CompensateEventDefinition') &&
          is(event, 'bpmn:BoundaryEvent') &&
          flows(shape.outgoing));
      if (blocked) {
        throw new Error('Remove the sequence flows that this trigger does not allow first.');
      }
    }
    const combination = definitionCombinationProblem(event.$type, types, event.$parent);
    if (combination && !sameSet(types, present)) throw new Error(combination);
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
    // Error, cancel and compensation triggers always interrupt (PDF 272, 287).
    if (next.some((d) => ALWAYS_INTERRUPTING.includes(d.$type))) {
      if (event.get('cancelActivity') === false) log.set(event, 'cancelActivity', undefined);
      if (event.get('isInterrupting') === false) log.set(event, 'isInterrupting', undefined);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

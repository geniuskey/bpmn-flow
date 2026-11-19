/**
 * Constraints that BPMN 2.0.2 states as MUST / MUST NOT (page numbers are PDF
 * pages of formal/13-12-09). They report models that other tools may reject or
 * execute differently; none of them changes the model.
 */
import { humanizeType, isEventSubProcess } from '@/bpmn/model/elements';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { linkPairs, type ProcessGraph } from '../graph/processGraph';
import type { Finding } from '../types';

const MESSAGE = 'bpmn:MessageEventDefinition';
const TIMER = 'bpmn:TimerEventDefinition';
const SIGNAL = 'bpmn:SignalEventDefinition';
const CONDITIONAL = 'bpmn:ConditionalEventDefinition';
const ERROR = 'bpmn:ErrorEventDefinition';
const ESCALATION = 'bpmn:EscalationEventDefinition';
const COMPENSATE = 'bpmn:CompensateEventDefinition';
const CANCEL = 'bpmn:CancelEventDefinition';
const LINK = 'bpmn:LinkEventDefinition';

export function definitionTypes(el: ModdleElement): string[] {
  return getMany(el, 'eventDefinitions').map((d) => d.$type);
}

export function hasDefinition(el: ModdleElement, type: string): boolean {
  return definitionTypes(el).includes(type);
}

export function isLinkThrow(el: ModdleElement): boolean {
  return is(el, 'bpmn:IntermediateThrowEvent') && hasDefinition(el, LINK);
}

export function isLinkCatch(el: ModdleElement): boolean {
  return is(el, 'bpmn:IntermediateCatchEvent') && hasDefinition(el, LINK);
}

export { isEventSubProcess };

export function isCompensationActivity(el: ModdleElement): boolean {
  return is(el, 'bpmn:Activity') && el.get('isForCompensation') === true;
}

export function isCompensationBoundary(el: ModdleElement): boolean {
  return is(el, 'bpmn:BoundaryEvent') && hasDefinition(el, COMPENSATE);
}

/** Instantiating event-based gateways and receive tasks start a process without a start event. */
export function isInstantiating(el: ModdleElement): boolean {
  return (
    (is(el, 'bpmn:EventBasedGateway') || is(el, 'bpmn:ReceiveTask')) &&
    el.get('instantiate') === true
  );
}

function name(el: ModdleElement | undefined): string {
  if (!el) return 'element';
  return el.name ? `“${el.name}”` : `${humanizeType(el.$type)} ${el.id ?? ''}`.trim();
}

const trigger = (type: string) =>
  humanizeType(type)
    .replace(/ Event Definition$/, '')
    .toLowerCase();

/**
 * Why a sequence flow from `source` to `target` is not allowed (PDF 125, 204,
 * 268, 274, 288), beyond start-event targets and end-event sources.
 */
export function invalidSequenceFlowEnds(source: ModdleElement, target: ModdleElement): string[] {
  const reasons: string[] = [];
  if (is(target, 'bpmn:BoundaryEvent')) reasons.push('enters a boundary event'); // PDF 288
  if (isCompensationBoundary(source)) reasons.push('leaves a compensation boundary event'); // PDF 288
  if (isLinkThrow(source)) reasons.push('leaves a link throw event'); // PDF 288
  if (isLinkCatch(target)) reasons.push('enters a link catch event'); // PDF 268
  if (isEventSubProcess(source) || isEventSubProcess(target)) {
    reasons.push('connects an event sub-process'); // PDF 204
  }
  if (isCompensationActivity(source) || isCompensationActivity(target)) {
    reasons.push('connects a compensation activity'); // PDF 268
  }
  return reasons;
}

/** Start event triggers allowed at the event's position (PDF 271–272). */
function allowedStartTriggers(scope: ModdleElement, start: ModdleElement): string[] {
  if (is(scope, 'bpmn:Process')) return [MESSAGE, TIMER, CONDITIONAL, SIGNAL];
  if (isEventSubProcess(scope)) {
    return start.get('isInterrupting') === false
      ? [MESSAGE, TIMER, CONDITIONAL, SIGNAL, ESCALATION]
      : [MESSAGE, TIMER, CONDITIONAL, SIGNAL, ESCALATION, ERROR, COMPENSATE];
  }
  return []; // embedded sub-process: None only
}

function scopeLabel(scope: ModdleElement, start: ModdleElement): string {
  if (is(scope, 'bpmn:Process')) return 'a top-level process';
  if (isEventSubProcess(scope)) {
    return start.get('isInterrupting') === false
      ? 'a non-interrupting event sub-process'
      : 'an event sub-process';
  }
  return 'an embedded sub-process';
}

export function specProcessRules(graph: ProcessGraph): Finding[] {
  const findings: Finding[] = [];
  const scope = graph.process;
  const nodes = [...graph.nodes.values()].map((n) => n.element);
  const push = (f: Finding) => findings.push(f);

  // Start event triggers by position.
  if (!is(scope, 'bpmn:Choreography')) {
    for (const start of nodes.filter((n) => is(n, 'bpmn:StartEvent'))) {
      const allowed = allowedStartTriggers(scope, start);
      const bad = definitionTypes(start).filter((t) => !allowed.includes(t));
      if (!bad.length) continue;
      const alwaysInterrupting =
        isEventSubProcess(scope) && bad.some((t) => t === ERROR || t === COMPENSATE);
      push({
        severity: 'error',
        ruleId: 'VAL-START-TRIGGER',
        message: `Start event ${name(start)} has a ${bad.map(trigger).join(' / ')} trigger, which is not allowed in ${scopeLabel(scope, start)}.`,
        elementIds: [start.id ?? ''],
        recommendation: alwaysInterrupting
          ? 'Error and compensation event sub-processes always interrupt: make the start event interrupting (BPMN 2.0.2, p. 272).'
          : is(scope, 'bpmn:Process')
            ? 'Top-level start events use none, message, timer, conditional or signal triggers; error, escalation and compensation start only event sub-processes (BPMN 2.0.2, p. 271–272).'
            : 'Start events of embedded sub-processes have no trigger; use an event sub-process to react to a trigger (BPMN 2.0.2, p. 271).',
      });
    }
  }

  // Event sub-process: one start event, with a trigger (PDF 204).
  if (isEventSubProcess(scope)) {
    const starts = nodes.filter((n) => is(n, 'bpmn:StartEvent'));
    if (starts.length !== 1) {
      push({
        severity: 'error',
        ruleId: 'VAL-EVENT-SUBPROCESS',
        message: `Event sub-process ${name(scope)} has ${starts.length} start events.`,
        elementIds: [scope.id ?? '', ...starts.map((s) => s.id ?? '')],
        recommendation: 'An event sub-process has exactly one start event (BPMN 2.0.2, p. 204).',
      });
    }
    for (const s of starts.filter((st) => !definitionTypes(st).length)) {
      push({
        severity: 'error',
        ruleId: 'VAL-EVENT-SUBPROCESS',
        message: `The start event ${name(s)} of event sub-process ${name(scope)} has no trigger.`,
        elementIds: [s.id ?? ''],
        recommendation:
          'Give it the trigger that starts the event sub-process, e.g. a message, timer or error (BPMN 2.0.2, p. 204).',
      });
    }
  }

  // Ad-hoc sub-processes have no start or end events (PDF 211).
  if (is(scope, 'bpmn:AdHocSubProcess')) {
    for (const n of nodes.filter((el) => is(el, 'bpmn:StartEvent') || is(el, 'bpmn:EndEvent'))) {
      push({
        severity: 'error',
        ruleId: 'VAL-ADHOC-START-END',
        message: `${name(n)} is inside ad-hoc sub-process ${name(scope)}.`,
        elementIds: [n.id ?? ''],
        recommendation:
          'Ad-hoc sub-processes must not contain start or end events (BPMN 2.0.2, p. 211); remove it.',
      });
    }
  }

  // Link events: every throw has exactly one catch with the same name (PDF 288).
  for (const [thrower, catches] of linkPairs(graph)) {
    const el = graph.nodes.get(thrower)!.element;
    if (catches.length === 0) {
      push({
        severity: 'error',
        ruleId: 'VAL-LINK-UNPAIRED',
        message: `Link throw event ${name(el)} has no matching link catch event.`,
        elementIds: [thrower],
        recommendation:
          'Add a link catch event with the same link name at the same process level (BPMN 2.0.2, p. 288).',
      });
    } else if (catches.length > 1) {
      push({
        severity: 'error',
        ruleId: 'VAL-LINK-AMBIGUOUS',
        message: `Link throw event ${name(el)} matches ${catches.length} link catch events.`,
        elementIds: [thrower, ...catches],
        recommendation:
          'A link must have exactly one target: give the catch events different names (BPMN 2.0.2, p. 288).',
      });
    }
  }

  // Event-based gateways (PDF 326–328).
  const incomingFlows = (el: ModdleElement) =>
    graph.edges.filter((e) => getRef(e.element, 'targetRef') === el);
  const outgoingFlows = (el: ModdleElement) =>
    graph.edges.filter((e) => getRef(e.element, 'sourceRef') === el);
  const attached = (el: ModdleElement) =>
    nodes.filter((n) => is(n, 'bpmn:BoundaryEvent') && getRef(n, 'attachedToRef') === el);
  const ebgTrigger = [MESSAGE, SIGNAL, TIMER, CONDITIONAL];

  for (const gw of nodes.filter((n) => is(n, 'bpmn:EventBasedGateway'))) {
    const out = outgoingFlows(gw);
    const gwId = gw.id ?? '';
    const ebg = (message: string, ids: string[], recommendation: string) =>
      push({
        severity: 'error',
        ruleId: 'VAL-EVENT-GATEWAY',
        message,
        elementIds: [gwId, ...ids],
        recommendation: `${recommendation} (BPMN 2.0.2, p. 326–327).`,
      });
    if (out.length < 2) {
      ebg(
        `Event-based gateway ${name(gw)} has ${out.length} outgoing flow(s).`,
        [],
        'An event-based gateway chooses between two or more events',
      );
    }
    const targets = out.map((e) => getRef(e.element, 'targetRef')).filter((t) => !!t);
    for (const t of targets) {
      const validEvent =
        is(t, 'bpmn:IntermediateCatchEvent') &&
        definitionTypes(t).length > 0 &&
        definitionTypes(t).every((d) => ebgTrigger.includes(d));
      if (!validEvent && !is(t, 'bpmn:ReceiveTask')) {
        ebg(
          `Event-based gateway ${name(gw)} leads to ${name(t)}.`,
          [t.id ?? ''],
          'Its flows must lead to receive tasks or to intermediate catch events with a message, signal, timer or conditional trigger',
        );
      }
      if (incomingFlows(t).length > 1) {
        ebg(
          `${name(t)} follows event-based gateway ${name(gw)} but has other incoming flows.`,
          [t.id ?? ''],
          'The targets of an event-based gateway have no other incoming sequence flows',
        );
      }
      if (is(t, 'bpmn:ReceiveTask') && attached(t).length) {
        ebg(
          `Receive task ${name(t)} after event-based gateway ${name(gw)} has boundary events.`,
          [t.id ?? '', ...attached(t).map((b) => b.id ?? '')],
          'Receive tasks in an event-based gateway configuration have no attached events',
        );
      }
    }
    const receiveTasks = targets.filter((t) => is(t, 'bpmn:ReceiveTask'));
    const messageEvents = targets.filter(
      (t) => is(t, 'bpmn:IntermediateCatchEvent') && hasDefinition(t, MESSAGE),
    );
    if (receiveTasks.length && messageEvents.length) {
      ebg(
        `Event-based gateway ${name(gw)} mixes receive tasks and message events.`,
        [...receiveTasks, ...messageEvents].map((t) => t.id ?? ''),
        'Use either receive tasks or message intermediate events after one gateway, not both',
      );
    }
  }

  // Instantiating gateways and receive tasks start the process: no incoming flows.
  for (const n of nodes.filter(isInstantiating)) {
    if (!incomingFlows(n).length) continue;
    push({
      severity: 'error',
      ruleId: 'VAL-INSTANTIATE-INCOMING',
      message: `${name(n)} instantiates the process but has incoming sequence flows.`,
      elementIds: [n.id ?? ''],
      recommendation: `An instantiating ${is(n, 'bpmn:ReceiveTask') ? 'receive task' : 'event-based gateway'} has no incoming sequence flows (BPMN 2.0.2, p. ${is(n, 'bpmn:ReceiveTask') ? 189 : 328}).`,
    });
  }

  // Conditions on sequence flows (PDF 125, 274, 322).
  for (const e of graph.edges) {
    const flow = e.element;
    const source = getRef(flow, 'sourceRef');
    if (!source || !getRef(flow, 'conditionExpression')) continue;
    const condition = (severity: Finding['severity'], message: string, rec: string) =>
      push({
        severity,
        ruleId: 'VAL-CONDITION',
        message,
        elementIds: [e.id],
        recommendation: rec,
      });
    if (is(source, 'bpmn:Event')) {
      condition(
        'error',
        `Sequence flow ${e.id} out of ${name(source)} has a condition.`,
        'Only flows out of activities and exclusive, inclusive or complex gateways have conditions; remove it (BPMN 2.0.2, p. 125, 274).',
      );
    } else if (is(source, 'bpmn:ParallelGateway') || is(source, 'bpmn:EventBasedGateway')) {
      condition(
        'error',
        `Sequence flow ${e.id} out of ${is(source, 'bpmn:ParallelGateway') ? 'parallel' : 'event-based'} gateway ${name(source)} has a condition.`,
        'Flows out of parallel and event-based gateways have no conditions; remove it or use an inclusive / exclusive gateway (BPMN 2.0.2, p. 125, 326).',
      );
    } else if (getRef(source, 'default') === flow) {
      condition(
        'warning',
        `Default flow ${e.id} of ${name(source)} has a condition.`,
        'The default flow is taken when no condition holds, so it should not have one (BPMN 2.0.2, p. 322).',
      );
    } else if (is(source, 'bpmn:Activity') && outgoingFlows(source).length < 2) {
      condition(
        'error',
        `Conditional flow ${e.id} is the only outgoing flow of ${name(source)}.`,
        'An activity with a conditional flow needs at least one other outgoing flow (BPMN 2.0.2, p. 125).',
      );
    }
  }

  // Cancel events belong to transactions (PDF 287, 291).
  for (const n of nodes) {
    if (!hasDefinition(n, CANCEL)) continue;
    const host = getRef(n, 'attachedToRef');
    const outside = is(n, 'bpmn:EndEvent')
      ? !is(scope, 'bpmn:Transaction')
      : is(n, 'bpmn:BoundaryEvent') && !is(host, 'bpmn:Transaction');
    if (!outside) continue;
    push({
      severity: 'error',
      ruleId: 'VAL-CANCEL-OUTSIDE-TRANSACTION',
      message: `Cancel event ${name(n)} is ${is(n, 'bpmn:EndEvent') ? 'not inside' : 'not attached to'} a transaction.`,
      elementIds: [n.id ?? ''],
      recommendation:
        'Cancel end events are used inside, and cancel boundary events on, transaction sub-processes (BPMN 2.0.2, p. 287, 291).',
    });
  }

  // Error and cancel boundary events always interrupt (PDF 288).
  for (const n of nodes) {
    if (!is(n, 'bpmn:BoundaryEvent') || n.get('cancelActivity') !== false) continue;
    const bad = definitionTypes(n).filter((t) => t === ERROR || t === CANCEL);
    if (!bad.length) continue;
    push({
      severity: 'error',
      ruleId: 'VAL-NON-INTERRUPTING',
      message: `${name(n)} is a non-interrupting ${bad.map(trigger).join(' / ')} boundary event.`,
      elementIds: [n.id ?? ''],
      recommendation:
        'Error and cancel boundary events always interrupt the activity; make it interrupting (BPMN 2.0.2, p. 288).',
    });
  }

  return findings;
}

/**
 * Message flow endpoints per Table 7.4 (PDF 72) and the event rules on PDF 278
 * and 289: senders are pools, activities and message throw / end events;
 * receivers are pools, activities and message start / catch / boundary events.
 */
export function messageFlowRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  const messageLike = (el: ModdleElement) =>
    hasDefinition(el, MESSAGE) || definitionTypes(el).length > 1; // Multiple
  const check = (
    flow: ModdleElement,
    el: ModdleElement,
    end: 'source' | 'target',
  ): Finding | undefined => {
    if (is(el, 'bpmn:Participant') || is(el, 'bpmn:Activity')) return undefined;
    const eventTypes =
      end === 'source'
        ? ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent']
        : ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];
    const verb = end === 'source' ? 'sends' : 'receives';
    if (eventTypes.some((t) => is(el, t))) {
      if (messageLike(el)) return undefined;
      return {
        severity: 'warning',
        ruleId: 'VAL-MESSAGE-FLOW',
        message: `${name(el)} ${verb} message flow ${flow.id} but has no message trigger.`,
        elementIds: [flow.id ?? '', el.id ?? ''],
        recommendation:
          'Give the event a message trigger (or several triggers, making it a multiple event) (BPMN 2.0.2, p. 72, 278).',
      };
    }
    return {
      severity: 'error',
      ruleId: 'VAL-MESSAGE-FLOW',
      message: `Message flow ${flow.id} ${end === 'source' ? 'starts at' : 'ends at'} ${name(el)}.`,
      elementIds: [flow.id ?? '', el.id ?? ''],
      recommendation:
        end === 'source'
          ? 'Messages are sent by pools, activities and message throw or end events (BPMN 2.0.2, Table 7.4, p. 72).'
          : 'Messages are received by pools, activities and message start, catch or boundary events (BPMN 2.0.2, Table 7.4, p. 72).',
    };
  };
  walkContainment(definitions, (flow) => {
    if (!is(flow, 'bpmn:MessageFlow')) return;
    const source = getRef(flow, 'sourceRef');
    const target = getRef(flow, 'targetRef');
    for (const f of [
      source && check(flow, source, 'source'),
      target && check(flow, target, 'target'),
    ])
      if (f) findings.push(f);
  });
  return findings;
}

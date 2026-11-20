/**
 * Constraints that BPMN 2.0.2 states as MUST / MUST NOT (page numbers are PDF
 * pages of formal/13-12-09). They report models that other tools may reject or
 * execute differently; none of them changes the model.
 */
import {
  allowedEventDefinitions,
  definitionCombinationProblem,
  enclosingProcess,
  humanizeType,
  isEventSubProcess,
  withinChoreography,
} from '@/bpmn/model/elements';
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
  if (!withinChoreography(scope)) {
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
    // In a choreography: choreography activities, timer / signal / conditional events (PDF 379).
    const choreography = withinChoreography(scope);
    const triggers = choreography ? [SIGNAL, TIMER, CONDITIONAL] : ebgTrigger;
    for (const t of targets) {
      const validEvent =
        is(t, 'bpmn:IntermediateCatchEvent') &&
        definitionTypes(t).length > 0 &&
        definitionTypes(t).every((d) => triggers.includes(d));
      const validActivity = choreography
        ? is(t, 'bpmn:ChoreographyActivity')
        : is(t, 'bpmn:ReceiveTask');
      if (!validEvent && !validActivity) {
        if (choreography) {
          ebg(
            `Event-based gateway ${name(gw)} leads to ${name(t)}.`,
            [t.id ?? ''],
            'In a choreography its flows lead to choreography activities or to signal, timer or conditional catch events, never message events (BPMN 2.0.2, p. 371, 379)',
          );
          continue;
        }
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
    } else if (
      (is(source, 'bpmn:Activity') || is(source, 'bpmn:ChoreographyActivity')) &&
      outgoingFlows(source).length < 2
    ) {
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
    // Choreography activities take cancel boundary events too (Table 11.7, PDF 372).
    const outside = is(n, 'bpmn:EndEvent')
      ? !is(scope, 'bpmn:Transaction') && !withinChoreography(scope)
      : is(n, 'bpmn:BoundaryEvent') &&
        !is(host, 'bpmn:Transaction') &&
        !is(host, 'bpmn:ChoreographyActivity');
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

  findings.push(...interruptingHandlerRules(scope, nodes));

  // gatewayDirection (Table 8.46, PDF 118-119).
  for (const gw of nodes.filter((n) => is(n, 'bpmn:Gateway'))) {
    const direction = gw.get('gatewayDirection') as string | undefined;
    if (!direction || direction === 'Unspecified') continue;
    const inCount = incomingFlows(gw).length;
    const outCount = outgoingFlows(gw).length;
    const problem =
      direction === 'Converging' && outCount > 1
        ? `is Converging but has ${outCount} outgoing flows`
        : direction === 'Diverging' && inCount > 1
          ? `is Diverging but has ${inCount} incoming flows`
          : direction === 'Mixed' && (inCount < 2 || outCount < 2)
            ? `is Mixed but has ${inCount} incoming and ${outCount} outgoing flows`
            : null;
    if (!problem) continue;
    push({
      severity: direction === 'Mixed' ? 'warning' : 'error',
      ruleId: 'VAL-GATEWAY-DIRECTION',
      message: `Gateway ${name(gw)} ${problem}.`,
      elementIds: [gw.id ?? ''],
      recommendation:
        'Converging gateways have at most one outgoing flow, Diverging ones at most one incoming flow, Mixed ones several of both; or set the direction to Unspecified (BPMN 2.0.2, Table 8.46, p. 118-119).',
    });
  }

  // Executable processes: error / escalation codes on throws, immediate flows (PDF 110-111, 339).
  const process = is(scope, 'bpmn:Process') ? scope : enclosingProcess(scope);
  if (process?.get('isExecutable') === true) {
    for (const n of nodes) {
      if (!is(n, 'bpmn:EndEvent') && !is(n, 'bpmn:IntermediateThrowEvent')) continue;
      for (const d of getMany(n, 'eventDefinitions')) {
        const error = is(d, ERROR);
        if (!error && !is(d, ESCALATION)) continue;
        const ref = getRef(d, error ? 'errorRef' : 'escalationRef');
        if (ref?.get(error ? 'errorCode' : 'escalationCode')) continue;
        push({
          severity: 'error',
          ruleId: 'VAL-THROW-CODE',
          message: `${name(n)} throws ${error ? 'an error' : 'an escalation'} without ${error ? 'an error' : 'an escalation'} code.`,
          elementIds: [n.id ?? ''],
          recommendation: `In an executable process a throwing ${error ? 'error' : 'escalation'} event names the ${error ? 'errorCode' : 'escalationCode'} it throws (BPMN 2.0.2, Table ${error ? '8.41, p. 110' : '8.42, p. 111'}).`,
        });
      }
    }
    for (const e of graph.edges.filter((x) => x.element.get('isImmediate') === false)) {
      push({
        severity: 'error',
        ruleId: 'VAL-IS-IMMEDIATE',
        message: `Sequence flow ${e.id} of executable process ${name(process)} is not immediate.`,
        elementIds: [e.id],
        recommendation:
          'Executable processes cannot have isImmediate="false" flows; remove the attribute or make the process non-executable (BPMN 2.0.2, p. 339).',
      });
    }
  }

  if (withinChoreography(scope)) findings.push(...choreographyRules(graph));

  return findings;
}

/** The trigger types an interrupting handler is unique for (PDF 308). */
const HANDLER_TRIGGERS = [ERROR, ESCALATION, MESSAGE, SIGNAL, TIMER, CONDITIONAL];

/**
 * The Event Declaration a definition catches: its message, signal, error or
 * escalation. Error and escalation handlers without one catch them all.
 * Timers and conditions are declared per event, so they never collide.
 */
function declarationKey(d: ModdleElement): string | undefined {
  if (!HANDLER_TRIGGERS.includes(d.$type)) return undefined;
  const ref = ['messageRef', 'signalRef', 'errorRef', 'escalationRef']
    .map((k) => getRef(d, k))
    .find(Boolean);
  if (ref) return `${d.$type}:${ref.id ?? ''}`;
  if (is(d, ERROR) || is(d, ESCALATION)) return `${d.$type}:*`;
  return undefined;
}

/**
 * "For an interrupting Event ... only one Event Sub-Process for the same Event
 * Declaration MUST be modeled. This excludes any further non-interrupting
 * handlers for that Event Declaration ... The same restrictions apply for
 * boundary Events" (BPMN 2.0.2 PDF 308). Handlers are grouped per scope: the
 * event sub-processes of a process level, the boundary events of an activity.
 */
function interruptingHandlerRules(scope: ModdleElement, nodes: ModdleElement[]): Finding[] {
  const groups: {
    owner: ModdleElement;
    handlers: { el: ModdleElement; interrupting: boolean }[];
  }[] = [];
  const starts = nodes
    .filter(isEventSubProcess)
    .flatMap((esp) => getMany(esp, 'flowElements').filter((f) => is(f, 'bpmn:StartEvent')));
  groups.push({
    owner: scope,
    handlers: starts.map((el) => ({ el, interrupting: el.get('isInterrupting') !== false })),
  });
  const byHost = new Map<ModdleElement, ModdleElement[]>();
  for (const b of nodes.filter((n) => is(n, 'bpmn:BoundaryEvent'))) {
    const host = getRef(b, 'attachedToRef');
    if (host) byHost.set(host, [...(byHost.get(host) ?? []), b]);
  }
  for (const [host, list] of byHost) {
    groups.push({
      owner: host,
      handlers: list.map((el) => ({ el, interrupting: el.get('cancelActivity') !== false })),
    });
  }
  const findings: Finding[] = [];
  for (const { owner, handlers } of groups) {
    const byKey = new Map<string, typeof handlers>();
    for (const h of handlers) {
      const keys = new Set(getMany(h.el, 'eventDefinitions').map(declarationKey));
      for (const k of keys) if (k) byKey.set(k, [...(byKey.get(k) ?? []), h]);
    }
    for (const [key, list] of byKey) {
      if (list.length < 2 || !list.some((h) => h.interrupting)) continue;
      const what = key.endsWith(':*')
        ? `any ${trigger(key.slice(0, -2))}`
        : `the same ${trigger(key.slice(0, key.indexOf(':', 5)))}`;
      findings.push({
        severity: 'error',
        ruleId: 'VAL-INTERRUPTING-HANDLER',
        message: `${name(owner)} has ${list.length} handlers for ${what}, and one of them interrupts.`,
        elementIds: list.map((h) => h.el.id ?? ''),
        recommendation:
          'An interrupting event sub-process or boundary event is the only handler of its message, signal, error or escalation; give the others different declarations or remove them (BPMN 2.0.2, p. 308).',
      });
    }
  }
  return findings;
}

/**
 * Constraints of choreographies (BPMN 2.0.2 Ch. 11):
 * - event triggers per Tables 11.6-11.8 (PDF 370-374)
 * - "The Initiator of a Choreography Activity MUST have been involved (as
 *   Initiator or Receiver) in the previous Choreography Activity" (§11.4.1,
 *   PDF 366-367), looking back through gateways and events
 */
function choreographyRules(graph: ProcessGraph): Finding[] {
  const findings: Finding[] = [];
  const nodes = [...graph.nodes.values()].map((n) => n.element);
  for (const n of nodes.filter((el) => is(el, 'bpmn:Event'))) {
    const types = definitionTypes(n);
    const allowed = allowedEventDefinitions(n);
    const bad = types.filter((t) => !allowed.includes(t));
    const combination = definitionCombinationProblem(n.$type, types, n.$parent);
    if (!bad.length && !combination) continue;
    findings.push({
      severity: 'error',
      ruleId: 'VAL-CHOREOGRAPHY-EVENT',
      message: bad.length
        ? `${humanizeType(n.$type)} ${name(n)} has a ${bad.map(trigger).join(' / ')} trigger, which a choreography does not use.`
        : `${humanizeType(n.$type)} ${name(n)}: ${combination}`,
      elementIds: [n.id ?? ''],
      recommendation:
        'In a choreography messages are exchanged by choreography tasks; events have no sender or receiver. Start events: none, timer, conditional, signal; intermediate: timer, conditional, signal catch, link; end: none, terminate (BPMN 2.0.2, Tables 11.6-11.8, p. 370-374).',
    });
  }
  const byId = (id: string) => graph.nodes.get(id)?.element;
  /** Choreography activities that immediately precede `el` (through gateways and events). */
  const previous = (el: ModdleElement): ModdleElement[] => {
    const out = new Set<ModdleElement>();
    const seen = new Set<string>();
    const stack = [...(graph.in.get(el.id ?? '') ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const p = byId(id);
      if (!p) continue;
      if (is(p, 'bpmn:ChoreographyActivity')) out.add(p);
      else stack.push(...(graph.in.get(id) ?? []));
    }
    return [...out];
  };
  findings.push(...choreographyGatewayRules(graph, previous));
  for (const a of nodes.filter((el) => is(el, 'bpmn:ChoreographyActivity'))) {
    const initiator = getRef(a, 'initiatingParticipantRef');
    if (!initiator) continue;
    const before = previous(a).filter((p) => !getMany(p, 'participantRef').includes(initiator));
    if (!before.length) continue;
    findings.push({
      severity: 'warning',
      ruleId: 'VAL-CHOREOGRAPHY-INITIATOR',
      message: `${name(initiator)} initiates ${name(a)} but takes no part in ${before.map(name).join(', ')} before it.`,
      elementIds: [a.id ?? '', ...before.map((p) => p.id ?? '')],
      recommendation:
        'The initiator of a choreography activity must have been involved in the previous one, otherwise it cannot know when to start (BPMN 2.0.2 §11.4.1, p. 366-367).',
    });
  }
  return findings;
}

/**
 * Enforceability of gateways in a choreography (BPMN 2.0.2 §11.7, PDF
 * 375-391), checked on the choreography activities right before and after a
 * splitting gateway (through chains of gateways and events):
 * - exclusive / inclusive: the initiators after the gateway took part in a
 *   choreography activity upstream, where the data of the decision was sent
 *   (PDF 375-376, 381)
 * - event-based: the senders or the receivers after the gateway are the same
 *   (PDF 379); with a timer, everyone after it took part in the activity
 *   right before it (PDF 379)
 * - parallel / inclusive: the senders after the gateway take part in all
 *   choreography activities right before it (PDF 381, 384)
 */
function choreographyGatewayRules(
  graph: ProcessGraph,
  previous: (el: ModdleElement) => ModdleElement[],
): Finding[] {
  const findings: Finding[] = [];
  const byId = (id: string) => graph.nodes.get(id)?.element;
  const following = (el: ModdleElement): ModdleElement[] => {
    const out = new Set<ModdleElement>();
    const seen = new Set<string>();
    const stack = [...(graph.out.get(el.id ?? '') ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId(id);
      if (!n) continue;
      if (is(n, 'bpmn:ChoreographyActivity')) out.add(n);
      else stack.push(...(graph.out.get(id) ?? []));
    }
    return [...out];
  };
  const upstream = (el: ModdleElement): Set<ModdleElement> => {
    const out = new Set<ModdleElement>();
    const seen = new Set<string>();
    const stack = [...(graph.in.get(el.id ?? '') ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId(id);
      if (!n) continue;
      if (is(n, 'bpmn:ChoreographyActivity')) out.add(n);
      stack.push(...(graph.in.get(id) ?? []));
    }
    return out;
  };
  const sender = (a: ModdleElement) => getRef(a, 'initiatingParticipantRef');
  const parties = (a: ModdleElement) => getMany(a, 'participantRef');
  const receivers = (a: ModdleElement) =>
    parties(a)
      .filter((p) => p !== sender(a))
      .map((p) => p.id ?? '')
      .sort()
      .join(',');
  const warn = (gw: ModdleElement, message: string, ids: ModdleElement[], rec: string) =>
    findings.push({
      severity: 'warning',
      ruleId: 'VAL-CHOREOGRAPHY-GATEWAY',
      message,
      elementIds: [gw.id ?? '', ...ids.map((a) => a.id ?? '')],
      recommendation: rec,
    });

  for (const gw of [...graph.nodes.values()].map((n) => n.element)) {
    if (!is(gw, 'bpmn:Gateway') || (graph.out.get(gw.id ?? '') ?? []).length < 2) continue;
    const after = following(gw);
    const before = previous(gw);
    if (!after.length) continue;

    if (is(gw, 'bpmn:ExclusiveGateway') || is(gw, 'bpmn:InclusiveGateway')) {
      const involved = new Set([...upstream(gw)].flatMap(parties));
      const uninformed = after.filter((a) => sender(a) && !involved.has(sender(a)!));
      if (uninformed.length) {
        warn(
          gw,
          `${uninformed.map((a) => name(sender(a))).join(', ')} decide(s) at gateway ${name(gw)} without having taken part in the choreography before it.`,
          uninformed,
          'The initiators of the choreography activities after an exclusive or inclusive gateway must have sent or received the message with the data of the decision (BPMN 2.0.2 §11.7.1, p. 375-376).',
        );
      }
    }

    if (is(gw, 'bpmn:EventBasedGateway') && after.length > 1) {
      const senders = new Set(after.map((a) => sender(a)));
      const receiverSets = new Set(after.map(receivers));
      if (senders.size > 1 && receiverSets.size > 1) {
        warn(
          gw,
          `Neither the senders nor the receivers after event-based gateway ${name(gw)} are the same.`,
          after,
          'After an event-based gateway either the senders or the receivers of the choreography activities must be the same (BPMN 2.0.2 §11.7.2, p. 379).',
        );
      }
    }
    if (is(gw, 'bpmn:EventBasedGateway')) {
      const timers = (graph.out.get(gw.id ?? '') ?? [])
        .map(byId)
        .filter((t): t is ModdleElement => !!t && hasDefinition(t, TIMER));
      if (timers.length && before.length) {
        const everyone = new Set(after.flatMap(parties));
        const missing = [...everyone].filter((p) => !before.every((b) => parties(b).includes(p)));
        if (missing.length) {
          warn(
            gw,
            `${missing.map(name).join(', ')} take(s) part after timer gateway ${name(gw)} but not in the activity right before it.`,
            [...timers, ...before],
            'With a timer after an event-based gateway, every participant on its right side must be involved in the choreography activity immediately before the gateway (BPMN 2.0.2 §11.7.2, p. 379).',
          );
        }
      }
    }

    if ((is(gw, 'bpmn:ParallelGateway') || is(gw, 'bpmn:InclusiveGateway')) && before.length) {
      const outsiders = after.filter(
        (a) => sender(a) && !before.every((b) => parties(b).includes(sender(a)!)),
      );
      if (outsiders.length) {
        warn(
          gw,
          `The sender(s) of ${outsiders.map(name).join(', ')} after gateway ${name(gw)} take no part in the choreography activities right before it.`,
          outsiders,
          'The senders of the activities after a parallel or inclusive gateway must be involved in all activities immediately before it (BPMN 2.0.2 §11.7.3-11.7.4, p. 381, 384).',
        );
      }
    }
  }
  return findings;
}

/**
 * "A diagram SHOULD NOT mix the use of Exclusive Gateways with and without
 * the internal indicator" (BPMN 2.0.2 PDF 319): per diagram, the exclusive
 * gateways drawn without the "X" (DI isMarkerVisible) when others show it.
 */
export function exclusiveMarkerRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  for (const diagram of getMany(definitions, 'diagrams')) {
    const shapes: ModdleElement[] = [];
    walkContainment(diagram, (el) => {
      if (is(el, 'bpmndi:BPMNShape') && is(getRef(el, 'bpmnElement'), 'bpmn:ExclusiveGateway')) {
        shapes.push(el);
      }
    });
    const without = shapes.filter((sh) => sh.get('isMarkerVisible') !== true);
    if (!without.length || without.length === shapes.length) continue;
    findings.push({
      severity: 'warning',
      ruleId: 'VAL-EXCLUSIVE-MARKER',
      message: `${without.length} of ${shapes.length} exclusive gateways in diagram ${name(diagram)} are drawn without the “X”.`,
      elementIds: without.map((sh) => getRef(sh, 'bpmnElement')?.id ?? ''),
      recommendation:
        'Use the X marker on all exclusive gateways of a diagram or on none of them (BPMN 2.0.2, p. 319).',
    });
  }
  return findings;
}

/** "[An Ad-Hoc Sub-Process] MUST contain at least one Activity" (BPMN 2.0.2 PDF 211). */
export function adHocContentRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  walkContainment(definitions, (el) => {
    if (!is(el, 'bpmn:AdHocSubProcess')) return;
    if (getMany(el, 'flowElements').some((f) => is(f, 'bpmn:Activity'))) return;
    findings.push({
      severity: 'error',
      ruleId: 'VAL-ADHOC-CONTENT',
      message: `Ad-hoc sub-process ${name(el)} contains no activity.`,
      elementIds: [el.id ?? ''],
      recommendation:
        'An ad-hoc sub-process holds the activities that may be performed; add at least one (BPMN 2.0.2, p. 211).',
    });
  });
  return findings;
}

/**
 * Call activities call a Process or a Global Task (§10.3.5, PDF 212): a
 * calledElement naming another kind of element of the file is an error.
 */
export function calledElementRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  const roots = getMany(definitions, 'rootElements');
  walkContainment(definitions, (el) => {
    if (!is(el, 'bpmn:CallActivity')) return;
    const ref = el.get('calledElement') as string | undefined;
    const called = ref ? roots.find((r) => r.id === ref) : undefined;
    if (!called || is(called, 'bpmn:Process') || is(called, 'bpmn:GlobalTask')) return;
    findings.push({
      severity: 'error',
      ruleId: 'VAL-CALLED-ELEMENT',
      message: `Call activity ${name(el)} calls ${humanizeType(called.$type).toLowerCase()} ${name(called)}.`,
      elementIds: [el.id ?? ''],
      recommendation:
        'A call activity calls a process or a global task; choreographies and collaborations are called by call choreographies and call conversations (BPMN 2.0.2 §10.3.5, p. 212).',
    });
  });
  return findings;
}

/**
 * Conversation nodes connect two or more participants (BPMN 2.0.2 §9.5.2,
 * PDF 159): their participantRefs and the pools their links reach.
 */
export function conversationRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  walkContainment(definitions, (collaboration) => {
    if (!is(collaboration, 'bpmn:Collaboration')) return;
    const participantOf = (el: ModdleElement | undefined): ModdleElement | undefined => {
      if (is(el, 'bpmn:Participant')) return el;
      for (let p = el; p; p = p.$parent) {
        if (is(p, 'bpmn:Process')) {
          return getMany(collaboration, 'participants').find((x) => getRef(x, 'processRef') === p);
        }
      }
      return undefined;
    };
    for (const node of getMany(collaboration, 'conversations')) {
      const parties = new Set(getMany(node, 'participantRef'));
      for (const link of getMany(collaboration, 'conversationLinks')) {
        const a = getRef(link, 'sourceRef');
        const b = getRef(link, 'targetRef');
        if (a !== node && b !== node) continue;
        const p = participantOf(a === node ? b : a);
        if (p) parties.add(p);
      }
      if (parties.size >= 2) continue;
      findings.push({
        severity: 'warning',
        ruleId: 'VAL-CONVERSATION-PARTICIPANTS',
        message: `Conversation ${name(node)} involves ${parties.size} participant(s).`,
        elementIds: [node.id ?? ''],
        recommendation:
          'A conversation groups the messages of two or more participants; link it to at least two pools (BPMN 2.0.2 §9.5.2, p. 159).',
      });
    }
  });
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
  const counts = new Map<ModdleElement, { incoming: ModdleElement[]; outgoing: ModdleElement[] }>();
  const count = (
    el: ModdleElement | undefined,
    key: 'incoming' | 'outgoing',
    flow: ModdleElement,
  ) => {
    if (!el || !is(el, 'bpmn:Event')) return;
    const c = counts.get(el) ?? { incoming: [], outgoing: [] };
    c[key].push(flow);
    counts.set(el, c);
  };
  walkContainment(definitions, (flow) => {
    if (!is(flow, 'bpmn:MessageFlow')) return;
    const source = getRef(flow, 'sourceRef');
    const target = getRef(flow, 'targetRef');
    count(source, 'outgoing', flow);
    count(target, 'incoming', flow);
    for (const f of [
      source && check(flow, source, 'source'),
      target && check(flow, target, 'target'),
    ])
      if (f) findings.push(f);
  });
  // Counts (PDF 278, 289): a Message intermediate event has one incoming or one
  // outgoing message flow, not both; an end event sending several is Multiple.
  for (const [el, { incoming, outgoing }] of counts) {
    const types = definitionTypes(el);
    const intermediate =
      !is(el, 'bpmn:StartEvent') &&
      !is(el, 'bpmn:EndEvent') &&
      types.length === 1 &&
      types[0] === MESSAGE;
    if (intermediate && incoming.length + outgoing.length > 1) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-MESSAGE-FLOW',
        message: `Message intermediate event ${name(el)} has ${incoming.length + outgoing.length} message flows.`,
        elementIds: [el.id ?? '', ...[...incoming, ...outgoing].map((f) => f.id ?? '')],
        recommendation:
          'A message intermediate event has one incoming or one outgoing message flow, not both (BPMN 2.0.2, p. 289).',
      });
    }
    if (is(el, 'bpmn:EndEvent') && outgoing.length > 1 && types.length < 2) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-MESSAGE-FLOW',
        message: `End event ${name(el)} sends ${outgoing.length} message flows but is not a Multiple end event.`,
        elementIds: [el.id ?? '', ...outgoing.map((f) => f.id ?? '')],
        recommendation:
          'An end event with more than one outgoing message flow has the Multiple result: give it several triggers (BPMN 2.0.2, p. 278).',
      });
    }
  }
  return findings;
}

/**
 * ParticipantMultiplicity bounds (Table 9.5, PDF 147): maximum is at least 1
 * and not below minimum; minimum is not negative.
 */
export function participantMultiplicityRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  walkContainment(definitions, (el) => {
    if (!is(el, 'bpmn:ParticipantMultiplicity')) return;
    const own = (key: string) =>
      Object.prototype.hasOwnProperty.call(el, key) ? (el.get(key) as number) : undefined;
    const min = own('minimum') ?? 0;
    const max = own('maximum');
    const participant = el.$parent;
    const problems: string[] = [];
    if (min < 0) problems.push(`minimum ${min} is negative`);
    if (max !== undefined && max < 1) problems.push(`maximum ${max} is below 1`);
    if (max !== undefined && max < min) problems.push(`maximum ${max} is below minimum ${min}`);
    if (!problems.length) return;
    findings.push({
      severity: 'error',
      ruleId: 'VAL-PARTICIPANT-MULTIPLICITY',
      message: `Participant multiplicity of ${name(participant)}: ${problems.join(', ')}.`,
      elementIds: [participant?.id ?? el.id ?? ''],
      recommendation:
        'The maximum must be at least 1 and not below the minimum (BPMN 2.0.2, Table 9.5, p. 147).',
    });
  });
  return findings;
}

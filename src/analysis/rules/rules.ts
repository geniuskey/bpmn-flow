/**
 * Structural analysis and validation rules. Each rule reads the BPMN semantic
 * model (via ProcessGraph) and returns findings; none of them modify the model.
 *
 * These are static checks: they flag candidates for review, they do not claim
 * runtime behavior (execution time, bottlenecks) — see docs/analysis.md.
 */
import { indexDi } from '@/bpmn/di/di';
import { humanizeType } from '@/bpmn/model/elements';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { cycles, reachableFrom } from '../graph/algorithms';
import type { ProcessGraph } from '../graph/processGraph';
import type { Finding } from '../types';
import {
  adHocContentRules,
  invalidSequenceFlowEnds,
  isCompensationActivity,
  isCompensationBoundary,
  isEventSubProcess,
  isInstantiating,
  isLinkThrow,
  calledElementRules,
  conversationRules,
  exclusiveMarkerRules,
  messageFlowRules,
  participantMultiplicityRules,
  specProcessRules,
} from './specRules';

function label(graph: ProcessGraph, id: string): string {
  const n = graph.nodes.get(id);
  return n?.name ? `“${n.name}”` : `${humanizeType(n?.type ?? 'element')} ${id}`;
}

const isStart = (t: string) => t === 'bpmn:StartEvent';
const isEnd = (t: string) => t === 'bpmn:EndEvent';

/**
 * Elements that legitimately start without incoming flows. Inside an event
 * sub-process only its start event is an entry (it is its own scope).
 */
function isEntry(node: ModdleElement): boolean {
  return (
    is(node, 'bpmn:StartEvent') ||
    is(node, 'bpmn:BoundaryEvent') ||
    isInstantiating(node) ||
    isEventSubProcess(node) ||
    isCompensationActivity(node)
  );
}

/** Nodes that are correctly modeled without any sequence flow. */
function standsAlone(node: ModdleElement): boolean {
  return isEventSubProcess(node) || isCompensationActivity(node) || isCompensationBoundary(node);
}

/** Elements that legitimately end without outgoing flows: end events and link throw events. */
function isExit(node: ModdleElement): boolean {
  return is(node, 'bpmn:EndEvent') || isLinkThrow(node);
}

export function processRules(graph: ProcessGraph): Finding[] {
  const findings: Finding[] = [];
  const nodes = [...graph.nodes.values()];
  if (!nodes.length) return findings;
  const pid = graph.process.id ?? '';
  const pname = graph.process.name ? `“${graph.process.name}”` : pid;

  const starts = nodes.filter((n) => isStart(n.type)).map((n) => n.id);
  // An instantiating event-based gateway or receive task starts the process instead (p. 189, 328).
  const instantiating = nodes.some((n) => isInstantiating(n.element));
  const ends = nodes.filter((n) => isEnd(n.type)).map((n) => n.id);

  // Ad-hoc sub-processes run their activities in any order: no flow structure is required.
  const adHoc = is(graph.process, 'bpmn:AdHocSubProcess');
  // Start and end events are optional, but come in pairs (BPMN 2.0.2, p. 268, 276).
  const pairSeverity = starts.length || ends.length || instantiating ? 'error' : 'info';
  if (!adHoc && !starts.length && !instantiating) {
    findings.push({
      severity: pairSeverity,
      ruleId: 'VAL-MISSING-START',
      message: ends.length
        ? `Process ${pname} has an end event but no start event.`
        : `Process ${pname} has no start event.`,
      elementIds: [pid],
      recommendation: ends.length
        ? 'A process level with an end event must have at least one start event (BPMN 2.0.2, p. 268).'
        : 'Start and end events are optional, but they make it clear where the process begins.',
    });
  }
  if (!adHoc && !ends.length) {
    findings.push({
      severity: pairSeverity,
      ruleId: 'VAL-MISSING-END',
      message:
        starts.length || instantiating
          ? `Process ${pname} has a start event but no end event.`
          : `Process ${pname} has no end event.`,
      elementIds: [pid],
      recommendation:
        starts.length || instantiating
          ? 'A process level with a start event must have at least one end event (BPMN 2.0.2, p. 276).'
          : 'Add an end event for every way the process can finish.',
    });
  }

  // Isolated: neither incoming nor outgoing flows.
  for (const n of nodes) {
    if (adHoc || standsAlone(n.element)) continue;
    if (!graph.in.get(n.id)!.length && !graph.out.get(n.id)!.length && nodes.length > 1) {
      findings.push({
        severity: 'warning',
        ruleId: 'GRAPH-ISOLATED',
        message: `${label(graph, n.id)} is not connected to anything.`,
        elementIds: [n.id],
        recommendation: 'Connect it with sequence flows or remove it.',
      });
    }
  }
  const isolated = new Set(
    findings.filter((f) => f.ruleId === 'GRAPH-ISOLATED').map((f) => f.elementIds[0]),
  );

  // Unreachable from any start event (or instantiating gateway / receive task).
  if (!adHoc && (starts.length || instantiating)) {
    const entries = nodes.filter((n) => isEntry(n.element)).map((n) => n.id);
    const reachable = reachableFrom(entries, graph.out);
    for (const n of nodes) {
      if (!reachable.has(n.id) && !isolated.has(n.id)) {
        findings.push({
          severity: 'warning',
          ruleId: 'GRAPH-UNREACHABLE',
          message: `${label(graph, n.id)} cannot be reached from a start event.`,
          elementIds: [n.id],
          recommendation: 'Check the incoming sequence flows; this step may never run.',
        });
      }
    }
  }

  // Dead ends: no outgoing flow although not an end event.
  for (const n of nodes) {
    if (adHoc || standsAlone(n.element)) continue;
    if (!graph.out.get(n.id)!.length && !isExit(n.element) && !isolated.has(n.id)) {
      findings.push({
        severity: 'warning',
        ruleId: 'GRAPH-DEAD-END',
        message: `${label(graph, n.id)} has no outgoing flow and is not an end event.`,
        elementIds: [n.id],
        recommendation: 'Connect it to the next step or end the path with an end event.',
      });
    }
  }

  // Nodes from which no end event can be reached (e.g. trapped in a loop).
  if (!adHoc && ends.length) {
    const canFinish = reachableFrom(ends, graph.in);
    for (const n of nodes) {
      if (!canFinish.has(n.id) && graph.out.get(n.id)!.length) {
        findings.push({
          severity: 'warning',
          ruleId: 'GRAPH-NO-END-PATH',
          message: `No path leads from ${label(graph, n.id)} to an end event.`,
          elementIds: [n.id],
          recommendation: 'The process may never finish from here; add an exit from the loop.',
        });
      }
    }
  }

  for (const cycle of cycles(graph.nodes.keys(), graph.out)) {
    findings.push({
      severity: 'info',
      ruleId: 'GRAPH-CYCLE',
      message: `Loop through ${cycle.length} element(s): ${cycle.map((id) => label(graph, id)).join(' → ')}.`,
      elementIds: cycle,
      recommendation:
        'Make sure the loop has a clear exit condition (rework loops are often worth measuring).',
    });
  }

  // Gateways
  for (const n of nodes) {
    if (!is(n.element, 'bpmn:Gateway')) continue;
    const outCount = graph.out.get(n.id)!.length;
    const inCount = graph.in.get(n.id)!.length;
    if (outCount <= 1 && inCount <= 1 && outCount + inCount > 0) {
      findings.push({
        severity: 'warning',
        ruleId: 'GW-PASS-THROUGH',
        message: `${label(graph, n.id)} neither splits nor merges the flow.`,
        elementIds: [n.id],
        recommendation:
          'A gateway must merge or split the flow (BPMN 2.0.2, p. 319); remove it or add branches.',
      });
    }
    if (outCount > 1 && inCount > 1) {
      findings.push({
        severity: 'info',
        ruleId: 'GW-MIXED',
        message: `${label(graph, n.id)} both merges (${inCount}) and splits (${outCount}).`,
        elementIds: [n.id],
        recommendation: 'Separate merging and splitting into two gateways for readability.',
      });
    }
    const conditional =
      is(n.element, 'bpmn:ExclusiveGateway') ||
      is(n.element, 'bpmn:InclusiveGateway') ||
      is(n.element, 'bpmn:ComplexGateway');
    if (conditional && outCount > 1) {
      const def = getRef(n.element, 'default');
      // The actual sequence flows (not the `outgoing` list, which some files omit).
      const outgoing = graph.edges
        .map((e) => e.element)
        .filter((f) => getRef(f, 'sourceRef') === n.element);
      const unconditioned = outgoing.filter((f) => f !== def && !getRef(f, 'conditionExpression'));
      if (unconditioned.length) {
        findings.push({
          severity: 'warning',
          ruleId: 'GW-MISSING-CONDITION',
          message: `${label(graph, n.id)} has ${unconditioned.length} outgoing flow(s) without a condition and not marked as default.`,
          elementIds: [n.id, ...unconditioned.map((f) => f.id ?? '')],
          recommendation:
            'Give each branch a condition (or a name such as “yes”/“no”) and mark one as the default flow.',
        });
      }
    }
  }

  // Sequence flow validity.
  for (const e of graph.edges) {
    const source = getRef(e.element, 'sourceRef');
    const target = getRef(e.element, 'targetRef');
    if (!source || !target) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-BROKEN-REFERENCE',
        message: `Sequence flow ${e.id} is missing its ${!source ? 'source' : 'target'}.`,
        elementIds: [e.id],
        recommendation: 'Reconnect or delete the sequence flow.',
      });
      continue;
    }
    if (is(target, 'bpmn:StartEvent') || is(source, 'bpmn:EndEvent')) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-INVALID-CONNECTION',
        message: `Sequence flow ${e.id} ${is(target, 'bpmn:StartEvent') ? 'enters a start event' : 'leaves an end event'}.`,
        elementIds: [e.id],
        recommendation: 'Start events have no incoming and end events no outgoing sequence flows.',
      });
    }
    const reasons = invalidSequenceFlowEnds(source, target);
    if (reasons.length) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-INVALID-CONNECTION',
        message: `Sequence flow ${e.id} ${reasons.join(' and ')}.`,
        elementIds: [e.id],
        recommendation:
          'Boundary events and link catch events have no incoming, compensation boundary events and link throw events no outgoing sequence flows; event sub-processes and compensation activities have none (BPMN 2.0.2, p. 204, 268, 288).',
      });
    }
    if (!graph.nodes.has(source.id ?? '') || !graph.nodes.has(target.id ?? '')) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-INVALID-CONNECTION',
        message: `Sequence flow ${e.id} connects elements of different processes or sub-processes.`,
        elementIds: [e.id],
        recommendation: 'Use a message flow between pools; sequence flows stay inside one process.',
      });
    }
    if (
      !getMany(source, 'outgoing').includes(e.element) ||
      !getMany(target, 'incoming').includes(e.element)
    ) {
      findings.push({
        severity: 'warning',
        ruleId: 'VAL-BROKEN-REFERENCE',
        message: `Sequence flow ${e.id} is not listed in the incoming/outgoing references of its endpoints.`,
        elementIds: [e.id],
        recommendation: 'Some tools rely on these references; re-create the flow to repair them.',
      });
    }
  }

  // Event definitions that other tools cannot execute as they are.
  // Every definition: a multiple event can combine e.g. a message and a timer.
  for (const n of nodes)
    for (const def of getMany(n.element, 'eventDefinitions')) {
      const timerSet = ['timeDuration', 'timeDate', 'timeCycle'].some((t) => getRef(def, t));
      if (is(def, 'bpmn:TimerEventDefinition') && !timerSet) {
        findings.push({
          severity: 'warning',
          ruleId: 'VAL-INCOMPLETE-EVENT',
          message: `Timer of ${label(graph, n.id)} has no duration, date or cycle.`,
          elementIds: [n.id],
          recommendation: 'Set a timer expression (ISO 8601, e.g. PT2H) in the properties panel.',
        });
      }
      const condition = getRef<ModdleElement & { body?: string }>(def, 'condition');
      if (is(def, 'bpmn:ConditionalEventDefinition') && !condition?.body?.trim()) {
        findings.push({
          severity: 'warning',
          ruleId: 'VAL-INCOMPLETE-EVENT',
          message: `Conditional event ${label(graph, n.id)} has no condition.`,
          elementIds: [n.id],
          recommendation: 'Enter the condition in the properties panel.',
        });
      }
      const refProperty = (
        {
          'bpmn:MessageEventDefinition': 'messageRef',
          'bpmn:SignalEventDefinition': 'signalRef',
          'bpmn:ErrorEventDefinition': 'errorRef',
          'bpmn:EscalationEventDefinition': 'escalationRef',
        } as Record<string, string>
      )[def.$type];
      if (refProperty && !getRef(def, refProperty)) {
        findings.push({
          severity: 'info',
          ruleId: 'STYLE-UNREFERENCED-EVENT',
          message: `${label(graph, n.id)} does not name its ${humanizeType(def.$type)
            .replace(/ Event Definition$/, '')
            .toLowerCase()}.`,
          elementIds: [n.id],
          recommendation:
            'Name it in the properties panel so throw and catch events can be matched.',
        });
      }
    }

  findings.push(...specProcessRules(graph));

  // Readability
  for (const n of nodes) {
    if (is(n.element, 'bpmn:Activity') && !n.name?.trim()) {
      findings.push({
        severity: 'info',
        ruleId: 'STYLE-UNNAMED-ACTIVITY',
        message: `${humanizeType(n.type)} ${n.id} has no name.`,
        elementIds: [n.id],
        recommendation: 'Name activities with a verb and an object, e.g. “Check invoice”.',
      });
    }
  }

  return findings;
}

/** Document-wide checks: ids and diagram references. */
export function documentRules(definitions: ModdleElement): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  walkContainment(definitions, (el) => {
    if (el.id && !el.$descriptor?.isGeneric) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  });
  for (const [id, n] of seen) {
    if (n > 1) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-DUPLICATE-ID',
        message: `The id “${id}” is used by ${n} elements.`,
        elementIds: [id],
        recommendation: 'Element ids must be unique; rename one of them in the source file.',
      });
    }
  }

  // Message flows must connect different pools.
  const processOfElement = (el: ModdleElement | undefined): ModdleElement | undefined => {
    if (!el) return undefined;
    if (is(el, 'bpmn:Participant')) return getRef(el, 'processRef') ?? el;
    for (let p = el.$parent; p; p = p.$parent) if (is(p, 'bpmn:Process')) return p;
    return undefined;
  };
  walkContainment(definitions, (el) => {
    if (!is(el, 'bpmn:MessageFlow')) return;
    const source = getRef(el, 'sourceRef');
    const target = getRef(el, 'targetRef');
    if (!source || !target) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-BROKEN-REFERENCE',
        message: `Message flow ${el.id} is missing its ${!source ? 'source' : 'target'}.`,
        elementIds: [el.id ?? ''],
        recommendation: 'Reconnect or delete the message flow.',
      });
    } else if (processOfElement(source) && processOfElement(source) === processOfElement(target)) {
      findings.push({
        severity: 'error',
        ruleId: 'VAL-INVALID-CONNECTION',
        message: `Message flow ${el.id} connects elements of the same pool.`,
        elementIds: [el.id ?? ''],
        recommendation: 'Use a sequence flow inside a pool; message flows connect different pools.',
      });
    }
  });

  findings.push(...messageFlowRules(definitions));
  findings.push(...participantMultiplicityRules(definitions));
  findings.push(...conversationRules(definitions));
  findings.push(...exclusiveMarkerRules(definitions));
  findings.push(...calledElementRules(definitions));
  findings.push(...adHocContentRules(definitions));

  const di = indexDi(definitions);
  for (const d of [...di.dangling, ...di.duplicates]) {
    findings.push({
      severity: 'error',
      ruleId: 'VAL-INVALID-DI',
      message: `Diagram element ${d.id ?? '(no id)'} refers to a missing element or duplicates another shape.`,
      elementIds: [d.id ?? ''],
      recommendation: 'Remove the orphaned diagram element from the file.',
    });
  }
  if (di.plane) {
    walkContainment(definitions, (el) => {
      if (!el.id) return;
      // Choreography participants are drawn as bands of their tasks, not as pools.
      const visual =
        is(el, 'bpmn:FlowNode') ||
        (is(el, 'bpmn:Participant') && !is(el.$parent, 'bpmn:Choreography')) ||
        is(el, 'bpmn:Lane');
      if (visual && !di.shapes.has(el.id)) {
        findings.push({
          severity: 'warning',
          ruleId: 'VAL-MISSING-DI',
          message: `${humanizeType(el.$type)} ${el.id} has no diagram shape.`,
          elementIds: [el.id],
          recommendation:
            'Other tools may not display it; run auto layout or add it to the diagram.',
        });
      }
      if (is(el, 'bpmn:SequenceFlow') && !di.edges.has(el.id)) {
        findings.push({
          severity: 'warning',
          ruleId: 'VAL-MISSING-DI',
          message: `Sequence flow ${el.id} has no diagram edge.`,
          elementIds: [el.id],
          recommendation: 'Other tools may not display it.',
        });
      }
    });
  }
  return findings;
}

export function lanesHandoffs(graph: ProcessGraph): { from: string; to: string; flow: string }[] {
  const out: { from: string; to: string; flow: string }[] = [];
  for (const e of graph.edges) {
    const a = e.source && graph.nodes.get(e.source)?.lane;
    const b = e.target && graph.nodes.get(e.target)?.lane;
    if (a && b && a !== b) out.push({ from: a, to: b, flow: e.id });
  }
  return out;
}

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

function label(graph: ProcessGraph, id: string): string {
  const n = graph.nodes.get(id);
  return n?.name ? `“${n.name}”` : `${humanizeType(n?.type ?? 'element')} ${id}`;
}

const isStart = (t: string) => t === 'bpmn:StartEvent';
const isEnd = (t: string) => t === 'bpmn:EndEvent';

/** Elements that legitimately start without incoming flows. */
function isEntry(node: ModdleElement): boolean {
  return (
    is(node, 'bpmn:StartEvent') || is(node, 'bpmn:BoundaryEvent') || isEventSubProcessContent(node)
  );
}

function isEventSubProcessContent(node: ModdleElement): boolean {
  return (
    !!node.$parent &&
    is(node.$parent, 'bpmn:SubProcess') &&
    node.$parent.get('triggeredByEvent') === true
  );
}

/** Elements that legitimately end without outgoing flows. */
function isExit(node: ModdleElement): boolean {
  return (
    is(node, 'bpmn:EndEvent') ||
    (is(node, 'bpmn:Event') &&
      getMany(node, 'eventDefinitions').some((d) => is(d, 'bpmn:LinkEventDefinition')))
  );
}

export function processRules(graph: ProcessGraph): Finding[] {
  const findings: Finding[] = [];
  const nodes = [...graph.nodes.values()];
  if (!nodes.length) return findings;
  const pid = graph.process.id ?? '';
  const pname = graph.process.name ? `“${graph.process.name}”` : pid;

  const starts = nodes.filter((n) => isStart(n.type)).map((n) => n.id);
  const ends = nodes.filter((n) => isEnd(n.type)).map((n) => n.id);

  if (!starts.length) {
    findings.push({
      severity: 'warning',
      ruleId: 'VAL-MISSING-START',
      message: `Process ${pname} has no start event.`,
      elementIds: [pid],
      recommendation: 'Add a start event so it is clear where the process begins.',
    });
  }
  if (!ends.length) {
    findings.push({
      severity: 'warning',
      ruleId: 'VAL-MISSING-END',
      message: `Process ${pname} has no end event.`,
      elementIds: [pid],
      recommendation: 'Add an end event for every way the process can finish.',
    });
  }

  // Isolated: neither incoming nor outgoing flows.
  for (const n of nodes) {
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

  // Unreachable from any start event.
  if (starts.length) {
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
  if (ends.length) {
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
        severity: 'info',
        ruleId: 'GW-PASS-THROUGH',
        message: `${label(graph, n.id)} neither splits nor merges the flow.`,
        elementIds: [n.id],
        recommendation: 'A gateway with one incoming and one outgoing flow can usually be removed.',
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
    if (is(n.element, 'bpmn:ExclusiveGateway') && outCount > 1) {
      const def = getRef(n.element, 'default');
      const unconditioned = getMany(n.element, 'outgoing').filter(
        (f) => f !== def && !getRef(f, 'conditionExpression'),
      );
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
  for (const n of nodes) {
    const def = getMany(n.element, 'eventDefinitions')[0];
    if (!def) continue;
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
    if (is(def, 'bpmn:ConditionalEventDefinition') && !getRef(def, 'condition')) {
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
        recommendation: 'Name it in the properties panel so throw and catch events can be matched.',
      });
    }
  }

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

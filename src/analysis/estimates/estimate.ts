/**
 * Assumption-based time and cost estimates from user-entered metadata.
 *
 * Elapsed time is computed on the process graph, not by summing all steps:
 * - a parallel join waits for its slowest branch (max), so parallel work
 *   overlaps instead of adding up;
 * - alternative paths (exclusive/inclusive joins, multiple incoming flows) give
 *   a best case (fastest alternative) and a worst case (slowest alternative);
 * - loops are counted once (back edges are ignored); repetition must be
 *   modelled by the user through frequency;
 * - a sub-process takes its own time plus the elapsed time of its content
 *   (estimated recursively); an ad-hoc sub-process's activities may run in any
 *   order, so its best case is the longest activity and its worst case their sum;
 * - a boundary event starts with its host: in the worst case it fires when the
 *   host finishes, in the best case right away. The best case only considers
 *   paths that do not leave through a boundary event (the exception paths).
 * Missing durations count as 0 and are reported as missing coverage. Work,
 * waiting and cost totals include sub-process content.
 */
import { getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { buildProcessGraph, processesOf, type ProcessGraph } from '../graph/processGraph';
import { reachableFrom } from '../graph/algorithms';
import type { AnalysisMetadata } from './metadata';

export interface ProcessEstimate {
  processId: string;
  processName?: string;
  /** Elapsed time start → end, best and worst case, in minutes. */
  bestCaseMinutes: number;
  worstCaseMinutes: number;
  /** Sum of hands-on time of all steps (work content, not elapsed time). */
  totalWorkMinutes: number;
  totalWaitingMinutes: number;
  /** Σ cost × frequency (frequency defaults to 1). */
  totalCost: number;
  /** Flow nodes on the worst-case path, in order. */
  criticalPath: string[];
  /** Activities without a duration (counted as 0). */
  missingDuration: string[];
  activities: number;
  ignoredLoopFlows: number;
}

export interface WaitingHotspot {
  elementId: string;
  name?: string;
  waitingMinutes: number;
  share: number;
}

export interface EstimateResult {
  processes: ProcessEstimate[];
  hotspots: WaitingHotspot[];
  hasData: boolean;
}

function elapsed(m: AnalysisMetadata | undefined): number {
  return (m?.durationMinutes ?? 0) + (m?.waitingMinutes ?? 0);
}

/** Removes back edges with an iterative DFS from the entry nodes. */
function acyclicSuccessors(graph: ProcessGraph): { succ: Map<string, string[]>; removed: number } {
  const succ = new Map<string, string[]>();
  const state = new Map<string, 0 | 1 | 2>();
  let removed = 0;
  const entries = [...graph.nodes.keys()].filter((id) => graph.in.get(id)!.length === 0);
  const roots = [...entries, ...graph.nodes.keys()];
  for (const root of roots) {
    if (state.get(root)) continue;
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }];
    state.set(root, 1);
    succ.set(root, []);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = graph.out.get(top.id) ?? [];
      if (top.i < next.length) {
        const w = next[top.i++]!;
        const s = state.get(w) ?? 0;
        if (s === 1) {
          removed++;
          continue; // back edge
        }
        succ.get(top.id)!.push(w);
        if (s === 0) {
          state.set(w, 1);
          succ.set(w, []);
          stack.push({ id: w, i: 0 });
        }
      } else {
        state.set(top.id, 2);
        stack.pop();
      }
    }
  }
  return { succ, removed };
}

export function estimateProcess(
  graph: ProcessGraph,
  meta: Map<string, AnalysisMetadata>,
): ProcessEstimate {
  const nodes = [...graph.nodes.values()];

  // Sub-process content first: it adds to the sub-process's own time.
  const inner = new Map<string, ProcessEstimate>();
  for (const n of nodes) {
    if (!is(n.element, 'bpmn:SubProcess')) continue;
    const g = buildProcessGraph(n.element);
    if (g.nodes.size) inner.set(n.id, estimateProcess(g, meta));
  }
  const own = (id: string) => elapsed(meta.get(id));
  const dBest = (id: string) => own(id) + (inner.get(id)?.bestCaseMinutes ?? 0);
  const dWorst = (id: string) => own(id) + (inner.get(id)?.worstCaseMinutes ?? 0);

  // Totals and coverage include sub-process content.
  let totalWork = 0;
  let totalWaiting = 0;
  let totalCost = 0;
  const missingDuration: string[] = [];
  let activities = 0;
  for (const n of nodes) {
    const m = meta.get(n.id);
    totalWork += m?.durationMinutes ?? 0;
    totalWaiting += m?.waitingMinutes ?? 0;
    totalCost += (m?.cost ?? 0) * (m?.frequency ?? 1);
    const sub = inner.get(n.id);
    if (sub) {
      totalWork += sub.totalWorkMinutes;
      totalWaiting += sub.totalWaitingMinutes;
      totalCost += sub.totalCost;
      missingDuration.push(...sub.missingDuration);
      activities += sub.activities;
    }
    if (is(n.element, 'bpmn:Activity')) {
      activities++;
      // A sub-process with content gets its time from the content.
      if (!sub && m?.durationMinutes === undefined) missingDuration.push(n.id);
    }
  }
  const base = {
    processId: graph.process.id ?? '',
    processName: graph.process.name,
    totalWorkMinutes: totalWork,
    totalWaitingMinutes: totalWaiting,
    totalCost,
    missingDuration,
    activities,
  };

  if (is(graph.process, 'bpmn:AdHocSubProcess')) {
    const ids = nodes.map((n) => n.id);
    return {
      ...base,
      bestCaseMinutes: Math.max(0, ...ids.map(dBest)),
      worstCaseMinutes: ids.reduce((sum, id) => sum + dWorst(id), 0),
      criticalPath: [],
      ignoredLoopFlows: 0,
    };
  }

  const { succ, removed } = acyclicSuccessors(graph);
  const preds = new Map<string, string[]>([...graph.nodes.keys()].map((id) => [id, []]));
  for (const [from, tos] of succ) for (const to of tos) preds.get(to)!.push(from);
  // A boundary event is ordered after its host (it starts with it).
  const hostOf = new Map<string, string>();
  for (const n of nodes) {
    const host = is(n.element, 'bpmn:BoundaryEvent')
      ? getRef(n.element, 'attachedToRef')
      : undefined;
    if (host?.id && graph.nodes.has(host.id)) hostOf.set(n.id, host.id);
  }

  // Topological order (Kahn).
  const indeg = new Map([...preds].map(([id, p]) => [id, p.length + (hostOf.has(id) ? 1 : 0)]));
  const after = new Map<string, string[]>();
  for (const [b, h] of hostOf) after.set(h, [...(after.get(h) ?? []), b]);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const w of [...(succ.get(id) ?? []), ...(after.get(id) ?? [])]) {
      indeg.set(w, indeg.get(w)! - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }

  const best = new Map<string, number>();
  const worst = new Map<string, number>();
  const worstPred = new Map<string, string | undefined>();
  for (const id of order) {
    const node = graph.nodes.get(id)!;
    const p = preds.get(id)!;
    let bestStart = 0;
    let worstStart = 0;
    let wp: string | undefined;
    const host = hostOf.get(id);
    if (host) {
      // Fires at the earliest when the host starts, at the latest when it ends.
      bestStart = (best.get(host) ?? 0) - dBest(host);
      worstStart = worst.get(host) ?? 0;
      wp = host;
    } else if (p.length) {
      const parallelJoin = is(node.element, 'bpmn:ParallelGateway') && p.length > 1;
      const worstValues = p.map((x) => worst.get(x) ?? 0);
      worstStart = Math.max(...worstValues);
      wp = p[worstValues.indexOf(worstStart)];
      // Parallel joins wait for every branch even in the best case.
      bestStart = parallelJoin
        ? Math.max(...p.map((x) => best.get(x) ?? 0))
        : Math.min(...p.map((x) => best.get(x) ?? 0));
    }
    best.set(id, bestStart + dBest(id));
    worst.set(id, worstStart + dWorst(id));
    worstPred.set(id, wp);
  }

  const ends = nodes.filter((n) => is(n.element, 'bpmn:EndEvent')).map((n) => n.id);
  const sinks = ends.length
    ? ends
    : nodes.filter((n) => !(succ.get(n.id) ?? []).length).map((n) => n.id);
  // Best case: the normal paths, i.e. not through a boundary event.
  const normalEntries = [...graph.nodes.keys()].filter(
    (id) => !preds.get(id)!.length && !hostOf.has(id),
  );
  const normal = reachableFrom(normalEntries, succ);
  const bestSinks = sinks.filter((id) => normal.has(id));
  const bestFrom = bestSinks.length ? bestSinks : sinks;
  const bestCase = bestFrom.length ? Math.min(...bestFrom.map((id) => best.get(id) ?? 0)) : 0;
  let worstEnd = sinks[0];
  for (const id of sinks) if ((worst.get(id) ?? 0) > (worst.get(worstEnd!) ?? 0)) worstEnd = id;
  const criticalPath: string[] = [];
  for (let at = worstEnd; at; at = worstPred.get(at)) criticalPath.unshift(at);

  return {
    ...base,
    bestCaseMinutes: bestCase,
    worstCaseMinutes: worstEnd ? (worst.get(worstEnd) ?? 0) : 0,
    criticalPath,
    ignoredLoopFlows: removed,
  };
}

export function estimate(definitions: ModdleElement, metadata: AnalysisMetadata[]): EstimateResult {
  const meta = new Map(metadata.map((m) => [m.elementId, m]));
  const processes = processesOf(definitions)
    .map((p) => buildProcessGraph(p))
    .filter((g) => g.nodes.size > 0)
    .map((g) => estimateProcess(g, meta));

  // Names of every flow node, including sub-process content.
  const names = new Map<string, string | undefined>();
  for (const p of processesOf(definitions)) {
    walkContainment(p, (el) => {
      if (el.id && is(el, 'bpmn:FlowNode')) names.set(el.id, el.name);
    });
  }
  const hotspots = metadata
    .filter((m) => (m.waitingMinutes ?? 0) > 0 && names.has(m.elementId))
    .map((m) => ({
      elementId: m.elementId,
      name: names.get(m.elementId),
      waitingMinutes: m.waitingMinutes ?? 0,
      share: (m.waitingMinutes ?? 0) / Math.max(1, elapsed(m)),
    }))
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes)
    .slice(0, 5);

  return {
    processes,
    hotspots,
    hasData: metadata.some((m) => elapsed(m) > 0 || (m.cost ?? 0) > 0),
  };
}

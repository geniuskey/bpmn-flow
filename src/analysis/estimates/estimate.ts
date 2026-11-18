/**
 * Assumption-based time and cost estimates from user-entered metadata.
 *
 * Elapsed time is computed on the process graph, not by summing all steps:
 * - a parallel join waits for its slowest branch (max), so parallel work
 *   overlaps instead of adding up;
 * - alternative paths (exclusive/inclusive joins, multiple incoming flows) give
 *   a best case (fastest alternative) and a worst case (slowest alternative);
 * - loops are counted once (back edges are ignored); repetition must be
 *   modelled by the user through frequency.
 * Missing durations count as 0 and are reported as missing coverage.
 */
import { getMany, is, type ModdleElement } from '@/bpmn/model/moddle';
import { buildProcessGraph, processesOf, type ProcessGraph } from '../graph/processGraph';
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
  const { succ, removed } = acyclicSuccessors(graph);
  const preds = new Map<string, string[]>([...graph.nodes.keys()].map((id) => [id, []]));
  for (const [from, tos] of succ) for (const to of tos) preds.get(to)!.push(from);

  // Topological order (Kahn).
  const indeg = new Map([...preds].map(([id, p]) => [id, p.length]));
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const w of succ.get(id) ?? []) {
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
    if (p.length) {
      const parallelJoin = is(node.element, 'bpmn:ParallelGateway') && p.length > 1;
      const worstValues = p.map((x) => worst.get(x) ?? 0);
      worstStart = Math.max(...worstValues);
      wp = p[worstValues.indexOf(worstStart)];
      // Parallel joins wait for every branch even in the best case.
      bestStart = parallelJoin
        ? Math.max(...p.map((x) => best.get(x) ?? 0))
        : Math.min(...p.map((x) => best.get(x) ?? 0));
    }
    const d = elapsed(meta.get(id));
    best.set(id, bestStart + d);
    worst.set(id, worstStart + d);
    worstPred.set(id, wp);
  }

  const nodes = [...graph.nodes.values()];
  const ends = nodes.filter((n) => is(n.element, 'bpmn:EndEvent')).map((n) => n.id);
  const sinks = ends.length
    ? ends
    : nodes.filter((n) => !(succ.get(n.id) ?? []).length).map((n) => n.id);
  const bestCase = sinks.length ? Math.min(...sinks.map((id) => best.get(id) ?? 0)) : 0;
  let worstEnd = sinks[0];
  for (const id of sinks) if ((worst.get(id) ?? 0) > (worst.get(worstEnd!) ?? 0)) worstEnd = id;
  const criticalPath: string[] = [];
  for (let at = worstEnd; at; at = worstPred.get(at)) criticalPath.unshift(at);

  const activities = nodes.filter((n) => is(n.element, 'bpmn:Activity'));
  let totalWork = 0;
  let totalWaiting = 0;
  let totalCost = 0;
  for (const n of nodes) {
    const m = meta.get(n.id);
    totalWork += m?.durationMinutes ?? 0;
    totalWaiting += m?.waitingMinutes ?? 0;
    totalCost += (m?.cost ?? 0) * (m?.frequency ?? 1);
  }

  return {
    processId: graph.process.id ?? '',
    processName: graph.process.name,
    bestCaseMinutes: bestCase,
    worstCaseMinutes: worstEnd ? (worst.get(worstEnd) ?? 0) : 0,
    totalWorkMinutes: totalWork,
    totalWaitingMinutes: totalWaiting,
    totalCost,
    criticalPath,
    missingDuration: activities
      .filter((a) => meta.get(a.id)?.durationMinutes === undefined)
      .map((a) => a.id),
    activities: activities.length,
    ignoredLoopFlows: removed,
  };
}

export function estimate(definitions: ModdleElement, metadata: AnalysisMetadata[]): EstimateResult {
  const meta = new Map(metadata.map((m) => [m.elementId, m]));
  const processes = processesOf(definitions)
    .map((p) => buildProcessGraph(p))
    .filter((g) => g.nodes.size > 0)
    .map((g) => estimateProcess(g, meta));

  const names = new Map<string, string | undefined>();
  for (const p of processesOf(definitions)) {
    for (const el of getMany(p, 'flowElements')) if (el.id) names.set(el.id, el.name);
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

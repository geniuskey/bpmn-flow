/**
 * Entry point of the analysis layer: structure metrics, graph analysis and
 * validation findings for a BPMN definitions tree.
 */
import { is, type ModdleElement } from '@/bpmn/model/moddle';
import { cycles } from './graph/algorithms';
import { buildProcessGraph, processesOf } from './graph/processGraph';
import { computeStructureMetrics, type StructureMetrics } from './metrics/structureMetrics';
import { documentRules, lanesHandoffs, processRules } from './rules/rules';
import type { Finding, Severity } from './types';

export interface GatewayBranching {
  id: string;
  name?: string;
  type: string;
  incoming: number;
  outgoing: number;
}

export interface GraphMetrics {
  gateways: GatewayBranching[];
  laneHandoffs: number;
  cycles: number;
  /** McCabe-style complexity: edges − nodes + 2 × processes. */
  cyclomaticComplexity: number;
}

export interface AnalysisResult {
  metrics: StructureMetrics;
  graph: GraphMetrics;
  findings: Finding[];
  counts: Record<Severity, number>;
  durationMs: number;
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function analyze(definitions: ModdleElement): AnalysisResult {
  const t0 = performance.now();
  const findings: Finding[] = [...documentRules(definitions)];
  const graphMetrics: GraphMetrics = {
    gateways: [],
    laneHandoffs: 0,
    cycles: 0,
    cyclomaticComplexity: 0,
  };
  let nodes = 0;
  let edges = 0;
  let processes = 0;

  const visit = (container: ModdleElement) => {
    const graph = buildProcessGraph(container);
    if (!graph.nodes.size) return;
    processes++;
    nodes += graph.nodes.size;
    edges += graph.edges.length;
    findings.push(...processRules(graph));
    graphMetrics.laneHandoffs += lanesHandoffs(graph).length;
    graphMetrics.cycles += cycles(graph.nodes.keys(), graph.out).length;
    for (const n of graph.nodes.values()) {
      if (is(n.element, 'bpmn:Gateway')) {
        graphMetrics.gateways.push({
          id: n.id,
          name: n.name,
          type: n.type,
          incoming: graph.in.get(n.id)!.length,
          outgoing: graph.out.get(n.id)!.length,
        });
      }
      // Sub-processes are analyzed as their own scope.
      if (is(n.element, 'bpmn:SubProcess') || is(n.element, 'bpmn:SubChoreography')) {
        visit(n.element);
      }
    }
  };
  for (const process of processesOf(definitions)) visit(process);
  graphMetrics.cyclomaticComplexity = processes ? edges - nodes + 2 * processes : 0;

  findings.sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  return {
    metrics: computeStructureMetrics(definitions),
    graph: graphMetrics,
    findings,
    counts,
    durationMs: performance.now() - t0,
  };
}

export type { Finding, Severity };

import { describe, expect, it } from 'vitest';
import { analyze } from '@/analysis/analyze';
import { cycles, reachableFrom, stronglyConnectedComponents } from '@/analysis/graph/algorithms';
import { loadBpmnDocument } from '@/bpmn/document';
import { createModdle, type ModdleElement } from '@/bpmn/model/moddle';
import { fixture } from '../helpers';

const rules = (r: ReturnType<typeof analyze>, id: string) =>
  r.findings.filter((f) => f.ruleId === id).flatMap((f) => f.elementIds);

describe('graph algorithms', () => {
  const adj = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a', 'd']],
    ['d', []],
    ['e', ['e']],
  ]);
  it('computes reachability and cycles', () => {
    expect([...reachableFrom(['a'], adj)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(stronglyConnectedComponents(adj.keys(), adj).length).toBe(3);
    expect(cycles(adj.keys(), adj).map((c) => c.sort())).toEqual([['a', 'b', 'c'], ['e']]);
  });
});

describe('analysis rules', () => {
  it('reports no problems for a well-formed process', async () => {
    const doc = await loadBpmnDocument(fixture('mvp-elements.bpmn'));
    const r = analyze(doc.definitions);
    expect(r.counts.error).toBe(0);
    expect(r.findings.filter((f) => f.severity === 'warning').map((f) => f.ruleId)).toEqual([]);
    expect(r.graph.gateways).toEqual([
      {
        id: 'Approved',
        name: 'Approved?',
        type: 'bpmn:ExclusiveGateway',
        incoming: 1,
        outgoing: 2,
      },
      { id: 'Split', name: undefined, type: 'bpmn:ParallelGateway', incoming: 1, outgoing: 2 },
      { id: 'Join', name: undefined, type: 'bpmn:ParallelGateway', incoming: 2, outgoing: 1 },
    ]);
    expect(r.graph.cyclomaticComplexity).toBe(9 - 9 + 2);
  });

  it('finds structural problems', async () => {
    const doc = await loadBpmnDocument(fixture('analysis-issues.bpmn'));
    const r = analyze(doc.definitions);
    expect(rules(r, 'GRAPH-ISOLATED')).toEqual(['D']);
    expect(rules(r, 'GRAPH-UNREACHABLE').sort()).toEqual(['E', 'End']);
    expect(rules(r, 'GRAPH-DEAD-END')).toEqual(['B']);
    expect(rules(r, 'GRAPH-NO-END-PATH').sort()).toEqual(['A', 'C', 'G', 'S']);
    expect(rules(r, 'GRAPH-CYCLE').sort()).toEqual(['A', 'C', 'G']);
    expect(rules(r, 'GW-MISSING-CONDITION')).toEqual(['G', 'f3', 'f4']);
    expect(rules(r, 'STYLE-UNNAMED-ACTIVITY')).toEqual(['E']);
    expect(r.findings.every((f) => f.message && f.recommendation && f.elementIds.length)).toBe(
      true,
    );
  });

  it('counts lane handoffs and flags missing start/end', async () => {
    const lanes = analyze(
      (await loadBpmnDocument(fixture('collaboration-lanes.bpmn'))).definitions,
    );
    expect(lanes.graph.laneHandoffs).toBe(1);
    const nodi = analyze((await loadBpmnDocument(fixture('no-diagram.bpmn'))).definitions);
    expect(nodi.findings.map((f) => f.ruleId)).toContain('VAL-MISSING-END');
  });

  it('detects invalid connections and duplicate ids', async () => {
    const doc = await loadBpmnDocument(fixture('simple-process.bpmn'));
    const moddle = doc.moddle;
    const process = (doc.definitions.get('rootElements') as ModdleElement[])[0]!;
    const flows = process.get('flowElements') as ModdleElement[];
    const end = flows.find((f) => f.id === 'End_1')!;
    const start = flows.find((f) => f.id === 'Start_1')!;
    const bad = moddle.create('bpmn:SequenceFlow', { id: 'Bad', sourceRef: end, targetRef: start });
    flows.push(bad);
    flows.push(moddle.create('bpmn:Task', { id: 'Task_check' }));
    const r = analyze(doc.definitions);
    expect(rules(r, 'VAL-INVALID-CONNECTION')).toContain('Bad');
    expect(rules(r, 'VAL-BROKEN-REFERENCE')).toContain('Bad');
    expect(rules(r, 'VAL-DUPLICATE-ID')).toEqual(['Task_check']);
  });

  it('accepts every supported element family and flags incomplete events', async () => {
    const doc = await loadBpmnDocument(fixture('all-elements.bpmn'));
    const r = analyze(doc.definitions);
    expect(r.counts.error).toBe(0);
    expect(r.findings.filter((f) => f.severity === 'warning')).toEqual([]);
    // Remove the timer duration: the boundary timer is now incomplete.
    const process = (doc.definitions.get('rootElements') as ModdleElement[]).find(
      (e) => e.id === 'Process_all',
    )!;
    const timer = (process.get('flowElements') as ModdleElement[]).find((e) => e.id === 'B_timer')!;
    (timer.get('eventDefinitions') as ModdleElement[])[0]!.set('timeDuration', undefined);
    expect(rules(analyze(doc.definitions), 'VAL-INCOMPLETE-EVENT')).toEqual(['B_timer']);
  });

  it('analyzes a 3000-node process quickly', () => {
    const moddle = createModdle();
    const process = moddle.create('bpmn:Process', { id: 'P' });
    const els: ModdleElement[] = [];
    let prev = moddle.create('bpmn:StartEvent', { id: 'n0' });
    els.push(prev);
    for (let i = 1; i < 3000; i++) {
      const node = moddle.create(i === 2999 ? 'bpmn:EndEvent' : 'bpmn:Task', {
        id: `n${i}`,
        name: `Step ${i}`,
      });
      const flow = moddle.create('bpmn:SequenceFlow', {
        id: `f${i}`,
        sourceRef: prev,
        targetRef: node,
      });
      (prev.get('outgoing') as ModdleElement[]).push(flow);
      (node.get('incoming') as ModdleElement[]).push(flow);
      els.push(node, flow);
      prev = node;
    }
    process.set('flowElements', els);
    const definitions = moddle.create('bpmn:Definitions', { id: 'D', rootElements: [process] });
    const r = analyze(definitions);
    expect(r.metrics.activities).toBe(2998);
    expect(r.counts.error + r.counts.warning).toBe(0);
    expect(r.durationMs).toBeLessThan(500);
  });
});

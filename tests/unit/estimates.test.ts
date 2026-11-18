import { describe, expect, it } from 'vitest';
import { estimate } from '@/analysis/estimates/estimate';
import { parseNumber } from '@/analysis/estimates/metadata';
import { loadBpmnDocument } from '@/bpmn/document';
import { fixture } from '../helpers';

describe('estimates', () => {
  it('uses the slowest branch for parallel paths instead of summing', async () => {
    const doc = await loadBpmnDocument(fixture('mvp-elements.bpmn'));
    const r = estimate(doc.definitions, [
      { elementId: 'Review', durationMinutes: 10, waitingMinutes: 50 },
      { elementId: 'Pay', durationMinutes: 30, cost: 2, frequency: 100 },
      { elementId: 'Notify', durationMinutes: 5, cost: 1 },
    ]);
    const p = r.processes[0]!;
    // Approved: Review (60) → Split → max(Pay 30, Notify 5) → Paid = 90, not 95.
    expect(p.worstCaseMinutes).toBe(90);
    // Rejected path: Review (60) → Rejected.
    expect(p.bestCaseMinutes).toBe(60);
    expect(p.criticalPath).toEqual(['Start', 'Review', 'Approved', 'Split', 'Pay', 'Join', 'Paid']);
    expect(p.totalWorkMinutes).toBe(45);
    expect(p.totalCost).toBe(201);
    expect(p.missingDuration).toEqual([]);
    expect(r.hotspots[0]).toMatchObject({ elementId: 'Review', waitingMinutes: 50 });
  });

  it('ignores loop back edges and reports missing data', async () => {
    const doc = await loadBpmnDocument(fixture('analysis-issues.bpmn'));
    const r = estimate(doc.definitions, [{ elementId: 'A', durationMinutes: 5 }]);
    const p = r.processes[0]!;
    expect(p.ignoredLoopFlows).toBe(1);
    expect(p.missingDuration.sort()).toEqual(['B', 'C', 'D', 'E']);
    expect(r.hasData).toBe(true);
  });

  it('parses user numbers', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('-3')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
  });
});

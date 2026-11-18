import { describe, expect, it } from 'vitest';
import { computeStructureMetrics } from '@/analysis/metrics/structureMetrics';
import { loadBpmnDocument } from '@/bpmn/document';
import { fixture } from '../helpers';

describe('structure metrics', () => {
  it('counts MVP element categories', async () => {
    const doc = await loadBpmnDocument(fixture('mvp-elements.bpmn'));
    expect(computeStructureMetrics(doc.definitions)).toEqual({
      totalElements: 19,
      events: 3,
      activities: 3,
      gateways: 3,
      sequenceFlows: 9,
      messageFlows: 0,
      pools: 0,
      lanes: 0,
      processes: 1,
    });
  });

  it('counts pools and lanes', async () => {
    const doc = await loadBpmnDocument(fixture('collaboration-lanes.bpmn'));
    const m = computeStructureMetrics(doc.definitions);
    expect(m).toMatchObject({ pools: 1, lanes: 2, events: 2, activities: 2, sequenceFlows: 3 });
  });

  it('ignores content inside extension elements', async () => {
    const doc = await loadBpmnDocument(fixture('extensions.bpmn'));
    expect(computeStructureMetrics(doc.definitions).totalElements).toBe(6);
  });
});

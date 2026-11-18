/** Estimates include sub-process content and treat boundary events as starting with their host. */
import { describe, expect, it } from 'vitest';
import { estimate } from '@/analysis/estimates/estimate';
import { createModdle } from '@/bpmn/model/moddle';

async function definitions(body: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <bpmn:process id="P">${body}</bpmn:process>
</bpmn:definitions>`;
  return (await createModdle().fromXML(xml, 'bpmn:Definitions')).rootElement;
}

const flow = (id: string, s: string, t: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}" />`;

describe('estimates over structure', () => {
  it('adds sub-process content to elapsed time, totals and coverage', async () => {
    const defs = await definitions(`
      <bpmn:startEvent id="S" />
      <bpmn:subProcess id="Sub">
        <bpmn:startEvent id="iS" /><bpmn:task id="Inner" /><bpmn:task id="Other" /><bpmn:endEvent id="iE" />
        ${flow('i1', 'iS', 'Inner')}${flow('i2', 'Inner', 'Other')}${flow('i3', 'Other', 'iE')}
      </bpmn:subProcess>
      <bpmn:endEvent id="E" />
      ${flow('f1', 'S', 'Sub')}${flow('f2', 'Sub', 'E')}`);
    const r = estimate(defs, [
      { elementId: 'Inner', durationMinutes: 100, waitingMinutes: 50, cost: 10 },
    ]);
    const p = r.processes[0]!;
    expect(p.worstCaseMinutes).toBe(150);
    expect(p.bestCaseMinutes).toBe(150);
    expect(p.totalWorkMinutes).toBe(100);
    expect(p.totalWaitingMinutes).toBe(50);
    expect(p.totalCost).toBe(10);
    expect(p.missingDuration).toEqual(['Other']); // not the sub-process itself
    expect(p.activities).toBe(3);
    expect(r.hotspots.map((h) => h.elementId)).toEqual(['Inner']);
  });

  it('starts boundary paths with their host and keeps them out of the best case', async () => {
    const defs = await definitions(`
      <bpmn:startEvent id="S" /><bpmn:task id="A" /><bpmn:endEvent id="E" />
      <bpmn:boundaryEvent id="T" attachedToRef="A"><bpmn:timerEventDefinition id="TD" /></bpmn:boundaryEvent>
      <bpmn:task id="Escalate" /><bpmn:endEvent id="E2" />
      ${flow('f1', 'S', 'A')}${flow('f2', 'A', 'E')}${flow('f3', 'T', 'Escalate')}${flow('f4', 'Escalate', 'E2')}`);
    const r = estimate(defs, [
      { elementId: 'A', durationMinutes: 60 },
      { elementId: 'Escalate', durationMinutes: 30 },
    ]);
    const p = r.processes[0]!;
    expect(p.bestCaseMinutes).toBe(60); // the normal path, not "0 via the timer"
    expect(p.worstCaseMinutes).toBe(90); // timer fires as A ends, then escalation
    expect(p.criticalPath).toEqual(['S', 'A', 'T', 'Escalate', 'E2']);
  });

  it('runs ad-hoc activities in parallel at best and in sequence at worst', async () => {
    const defs = await definitions(`
      <bpmn:startEvent id="S" />
      <bpmn:adHocSubProcess id="Ad"><bpmn:task id="X" /><bpmn:task id="Y" /></bpmn:adHocSubProcess>
      <bpmn:endEvent id="E" />
      ${flow('f1', 'S', 'Ad')}${flow('f2', 'Ad', 'E')}`);
    const r = estimate(defs, [
      { elementId: 'X', durationMinutes: 10 },
      { elementId: 'Y', durationMinutes: 20 },
    ]);
    expect(r.processes[0]).toMatchObject({ bestCaseMinutes: 20, worstCaseMinutes: 30 });
  });
});

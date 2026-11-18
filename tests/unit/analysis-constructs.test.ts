/** Valid BPMN constructs that do not use sequence flows are not reported as broken. */
import { describe, expect, it } from 'vitest';
import { analyze } from '@/analysis/analyze';
import { createModdle } from '@/bpmn/model/moddle';

async function analyzeProcess(body: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <bpmn:process id="P">${body}</bpmn:process>
</bpmn:definitions>`;
  const { rootElement } = await createModdle().fromXML(xml, 'bpmn:Definitions');
  return analyze(rootElement);
}

const warnings = (r: Awaited<ReturnType<typeof analyzeProcess>>) =>
  r.findings
    // The compact XML omits <incoming>/<outgoing>, which VAL-BROKEN-REFERENCE checks.
    .filter((f) => f.severity !== 'info' && f.ruleId !== 'VAL-BROKEN-REFERENCE')
    .map((f) => `${f.ruleId}:${f.elementIds.join(',')}`);

const flow = (id: string, s: string, t: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}" />`;

describe('analysis of constructs without sequence flows', () => {
  it('follows link throw events to their catch events', async () => {
    const r = await analyzeProcess(`
      <bpmn:startEvent id="S" /><bpmn:task id="A" />
      <bpmn:intermediateThrowEvent id="LT" name="To B"><bpmn:linkEventDefinition id="L1" name="next" /></bpmn:intermediateThrowEvent>
      <bpmn:intermediateCatchEvent id="LC" name="From A"><bpmn:linkEventDefinition id="L2" name="next" /></bpmn:intermediateCatchEvent>
      <bpmn:task id="B" /><bpmn:endEvent id="E" />
      ${flow('f1', 'S', 'A')}${flow('f2', 'A', 'LT')}${flow('f3', 'LC', 'B')}${flow('f4', 'B', 'E')}`);
    expect(warnings(r)).toEqual([]);
  });

  it('still reports a link catch event without a matching throw', async () => {
    const r = await analyzeProcess(`
      <bpmn:startEvent id="S" /><bpmn:endEvent id="E" />
      <bpmn:intermediateCatchEvent id="LC"><bpmn:linkEventDefinition id="L2" name="orphan" /></bpmn:intermediateCatchEvent>
      <bpmn:task id="B" />
      ${flow('f1', 'S', 'E')}${flow('f3', 'LC', 'B')}${flow('f4', 'B', 'E')}`);
    expect(warnings(r)).toContain('GRAPH-UNREACHABLE:LC');
  });

  it('accepts event sub-processes and compensation wiring', async () => {
    const r = await analyzeProcess(`
      <bpmn:startEvent id="S" /><bpmn:task id="A" /><bpmn:endEvent id="E" />
      <bpmn:boundaryEvent id="Comp" attachedToRef="A"><bpmn:compensateEventDefinition id="C1" /></bpmn:boundaryEvent>
      <bpmn:task id="Undo" isForCompensation="true" />
      <bpmn:association id="As" sourceRef="Comp" targetRef="Undo" />
      <bpmn:subProcess id="Ev" triggeredByEvent="true">
        <bpmn:startEvent id="EvS"><bpmn:messageEventDefinition id="M1" /></bpmn:startEvent>
        <bpmn:endEvent id="EvE" />
        ${flow('e1', 'EvS', 'EvE')}
      </bpmn:subProcess>
      ${flow('f1', 'S', 'A')}${flow('f2', 'A', 'E')}`);
    expect(warnings(r)).toEqual([]);
  });

  it('does not require flow structure inside an ad-hoc sub-process', async () => {
    const r = await analyzeProcess(`
      <bpmn:startEvent id="S" /><bpmn:endEvent id="E" />
      <bpmn:adHocSubProcess id="Ad"><bpmn:task id="X" /><bpmn:task id="Y" /></bpmn:adHocSubProcess>
      ${flow('f1', 'S', 'Ad')}${flow('f2', 'Ad', 'E')}`);
    expect(warnings(r)).toEqual([]);
  });

  it('checks every definition of a multiple event', async () => {
    const r = await analyzeProcess(`
      <bpmn:startEvent id="S"><bpmn:messageEventDefinition id="M" /><bpmn:timerEventDefinition id="T" /></bpmn:startEvent>
      <bpmn:endEvent id="E" />${flow('f1', 'S', 'E')}`);
    expect(warnings(r)).toContain('VAL-INCOMPLETE-EVENT:S');
  });
});

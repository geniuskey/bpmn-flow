/** Analyzer rules for BPMN 2.0.2 constraints added with the rules / attributes work. */
import { describe, expect, it } from 'vitest';
import { analyze } from '@/analysis/analyze';
import { parseBpmnXml } from '@/bpmn/import/parse';

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Defs" targetNamespace="urn:test">
${body}
</bpmn:definitions>`;

async function findings(body: string, ...rules: string[]): Promise<string[]> {
  const { definitions } = await parseBpmnXml(wrap(body));
  return analyze(definitions)
    .findings.filter((f) => rules.includes(f.ruleId))
    .map((f) => `${f.ruleId}:${f.severity}:${f.elementIds.join(',')}`)
    .sort();
}

const flow = (id: string, s: string, t: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}" />`;

describe('process rules', () => {
  it('ad-hoc sub-processes contain an activity (p. 211)', async () => {
    const body = `<bpmn:process id="P"><bpmn:adHocSubProcess id="AH" /><bpmn:adHocSubProcess id="AH2"><bpmn:task id="T" /></bpmn:adHocSubProcess></bpmn:process>`;
    expect(await findings(body, 'VAL-ADHOC-CONTENT')).toEqual(['VAL-ADHOC-CONTENT:error:AH']);
  });

  it('one interrupting handler per event declaration (p. 308)', async () => {
    const body = `<bpmn:message id="M" /><bpmn:message id="M2" /><bpmn:error id="E" />
    <bpmn:process id="P">
      <bpmn:task id="T" />
      <bpmn:boundaryEvent id="B1" attachedToRef="T"><bpmn:messageEventDefinition messageRef="M" /></bpmn:boundaryEvent>
      <bpmn:boundaryEvent id="B2" attachedToRef="T" cancelActivity="false"><bpmn:messageEventDefinition messageRef="M" /></bpmn:boundaryEvent>
      <bpmn:boundaryEvent id="B3" attachedToRef="T"><bpmn:messageEventDefinition messageRef="M2" /></bpmn:boundaryEvent>
      <bpmn:boundaryEvent id="B4" attachedToRef="T" cancelActivity="false"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
      <bpmn:boundaryEvent id="B5" attachedToRef="T" cancelActivity="false"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
      <bpmn:subProcess id="E1" triggeredByEvent="true"><bpmn:startEvent id="S1"><bpmn:errorEventDefinition errorRef="E" /></bpmn:startEvent></bpmn:subProcess>
      <bpmn:subProcess id="E2" triggeredByEvent="true"><bpmn:startEvent id="S2"><bpmn:errorEventDefinition /></bpmn:startEvent></bpmn:subProcess>
      <bpmn:subProcess id="E3" triggeredByEvent="true"><bpmn:startEvent id="S3" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M" /></bpmn:startEvent></bpmn:subProcess>
      <bpmn:subProcess id="E4" triggeredByEvent="true"><bpmn:startEvent id="S4" isInterrupting="false"><bpmn:messageEventDefinition messageRef="M" /></bpmn:startEvent></bpmn:subProcess>
    </bpmn:process>`;
    expect(await findings(body, 'VAL-INTERRUPTING-HANDLER')).toEqual([
      'VAL-INTERRUPTING-HANDLER:error:B1,B2',
    ]);
    // Two interrupting error event sub-processes for the same error.
    const two = body.replace(
      '<bpmn:errorEventDefinition />',
      '<bpmn:errorEventDefinition errorRef="E" />',
    );
    expect(await findings(two, 'VAL-INTERRUPTING-HANDLER')).toEqual([
      'VAL-INTERRUPTING-HANDLER:error:B1,B2',
      'VAL-INTERRUPTING-HANDLER:error:S1,S2',
    ]);
  });

  it('gateway direction, throw codes and isImmediate in executable processes', async () => {
    const body = `<bpmn:error id="E" /><bpmn:escalation id="X" escalationCode="X1" />
    <bpmn:process id="P" isExecutable="true">
      <bpmn:startEvent id="S" />
      <bpmn:exclusiveGateway id="G" gatewayDirection="Converging" />
      <bpmn:task id="A" /><bpmn:task id="B" />
      <bpmn:endEvent id="EE"><bpmn:errorEventDefinition errorRef="E" /></bpmn:endEvent>
      <bpmn:endEvent id="XE"><bpmn:escalationEventDefinition escalationRef="X" /></bpmn:endEvent>
      ${flow('F1', 'S', 'G')}${flow('F2', 'G', 'A')}${flow('F3', 'G', 'B')}
      <bpmn:sequenceFlow id="F4" sourceRef="A" targetRef="EE" isImmediate="false" />
      ${flow('F5', 'B', 'XE')}
    </bpmn:process>`;
    expect(
      await findings(body, 'VAL-GATEWAY-DIRECTION', 'VAL-THROW-CODE', 'VAL-IS-IMMEDIATE'),
    ).toEqual([
      'VAL-GATEWAY-DIRECTION:error:G',
      'VAL-IS-IMMEDIATE:error:F4',
      'VAL-THROW-CODE:error:EE',
    ]);
    // Not executable: codes and isImmediate are free.
    const free = body.replace('isExecutable="true"', 'isExecutable="false"');
    expect(await findings(free, 'VAL-THROW-CODE', 'VAL-IS-IMMEDIATE')).toEqual([]);
  });
});

describe('document rules', () => {
  it('reports exclusive gateways drawn with and without the X in one diagram (p. 319)', async () => {
    const body = `<bpmn:process id="P"><bpmn:exclusiveGateway id="G1" /><bpmn:exclusiveGateway id="G2" /><bpmn:exclusiveGateway id="G3" /></bpmn:process>
    <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
      <bpmndi:BPMNShape id="G1_di" bpmnElement="G1" isMarkerVisible="true"><dc:Bounds x="0" y="0" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="G2_di" bpmnElement="G2" isMarkerVisible="true"><dc:Bounds x="100" y="0" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="G3_di" bpmnElement="G3"><dc:Bounds x="200" y="0" width="50" height="50" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;
    expect(await findings(body, 'VAL-EXCLUSIVE-MARKER')).toEqual([
      'VAL-EXCLUSIVE-MARKER:warning:G3',
    ]);
    expect(
      await findings(
        body.replace(
          '<bpmndi:BPMNShape id="G3_di" bpmnElement="G3">',
          '<bpmndi:BPMNShape id="G3_di" bpmnElement="G3" isMarkerVisible="true">',
        ),
        'VAL-EXCLUSIVE-MARKER',
      ),
    ).toEqual([]);
  });

  it('call activities call processes or global tasks (p. 212)', async () => {
    const body = `<bpmn:collaboration id="C" /><bpmn:globalUserTask id="GT" />
    <bpmn:process id="P"><bpmn:callActivity id="CA1" calledElement="C" /><bpmn:callActivity id="CA2" calledElement="GT" /><bpmn:callActivity id="CA3" calledElement="elsewhere:Proc" /></bpmn:process>`;
    expect(await findings(body, 'VAL-CALLED-ELEMENT')).toEqual(['VAL-CALLED-ELEMENT:error:CA1']);
  });

  it('message flow counts on intermediate and end events (p. 278, 289)', async () => {
    const body = `<bpmn:collaboration id="C">
      <bpmn:participant id="PA" processRef="P" /><bpmn:participant id="PB" /><bpmn:participant id="PC" />
      <bpmn:messageFlow id="M1" sourceRef="ME" targetRef="PB" /><bpmn:messageFlow id="M2" sourceRef="ME" targetRef="PC" />
      <bpmn:messageFlow id="M3" sourceRef="MM" targetRef="PB" /><bpmn:messageFlow id="M4" sourceRef="MM" targetRef="PC" />
      <bpmn:messageFlow id="M5" sourceRef="PB" targetRef="IC" /><bpmn:messageFlow id="M6" sourceRef="PC" targetRef="IC" />
    </bpmn:collaboration>
    <bpmn:process id="P">
      <bpmn:endEvent id="ME"><bpmn:messageEventDefinition /></bpmn:endEvent>
      <bpmn:endEvent id="MM"><bpmn:messageEventDefinition /><bpmn:signalEventDefinition /></bpmn:endEvent>
      <bpmn:intermediateCatchEvent id="IC"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    </bpmn:process>`;
    expect(await findings(body, 'VAL-MESSAGE-FLOW')).toEqual([
      'VAL-MESSAGE-FLOW:error:IC,M6,M5',
      'VAL-MESSAGE-FLOW:error:ME,M2,M1',
    ]);
  });
});

describe('choreography gateways (p. 375-391)', () => {
  const task = (id: string, initiator: string, other: string) =>
    `<bpmn:choreographyTask id="${id}" initiatingParticipantRef="${initiator}"><bpmn:participantRef>${initiator}</bpmn:participantRef><bpmn:participantRef>${other}</bpmn:participantRef></bpmn:choreographyTask>`;
  const choreography = (content: string) => `<bpmn:choreography id="Ch">
      <bpmn:participant id="A" name="A" /><bpmn:participant id="B" name="B" /><bpmn:participant id="C" name="C" />
      <bpmn:startEvent id="S" />${content}</bpmn:choreography>`;

  it('event-based gateway: same senders or same receivers; timers need everyone before', async () => {
    const body = choreography(`${task('T0', 'A', 'B')}<bpmn:eventBasedGateway id="G" />
      ${task('T1', 'A', 'B')}${task('T2', 'C', 'A')}
      ${flow('F0', 'S', 'T0')}${flow('F1', 'T0', 'G')}${flow('F2', 'G', 'T1')}${flow('F3', 'G', 'T2')}`);
    expect(await findings(body, 'VAL-CHOREOGRAPHY-GATEWAY')).toEqual([
      'VAL-CHOREOGRAPHY-GATEWAY:warning:G,T2,T1',
    ]);
    // Same receivers (A → B, C → B): enforceable.
    const ok = body.replace(task('T2', 'C', 'A'), task('T2', 'C', 'B'));
    expect(await findings(ok, 'VAL-CHOREOGRAPHY-GATEWAY')).toEqual([]);
  });

  it('parallel gateway: the senders after it took part in the activity before it', async () => {
    const body = choreography(`${task('T0', 'A', 'B')}<bpmn:parallelGateway id="G" />
      ${task('T1', 'A', 'B')}${task('T2', 'C', 'B')}
      ${flow('F0', 'S', 'T0')}${flow('F1', 'T0', 'G')}${flow('F2', 'G', 'T1')}${flow('F3', 'G', 'T2')}`);
    expect(await findings(body, 'VAL-CHOREOGRAPHY-GATEWAY')).toEqual([
      'VAL-CHOREOGRAPHY-GATEWAY:warning:G,T2',
    ]);
  });

  it('exclusive gateway: the deciding initiators saw the data upstream', async () => {
    const body = choreography(`${task('T0', 'A', 'B')}<bpmn:exclusiveGateway id="G" />
      ${task('T1', 'B', 'A')}${task('T2', 'C', 'A')}
      ${flow('F0', 'S', 'T0')}${flow('F1', 'T0', 'G')}${flow('F2', 'G', 'T1')}${flow('F3', 'G', 'T2')}`);
    expect(await findings(body, 'VAL-CHOREOGRAPHY-GATEWAY')).toEqual([
      'VAL-CHOREOGRAPHY-GATEWAY:warning:G,T2',
    ]);
  });
});

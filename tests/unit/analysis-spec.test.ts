/** BPMN 2.0.2 MUST / MUST NOT constraints reported by the analyzer (PDF pages in specRules.ts). */
import { describe, expect, it } from 'vitest';
import { analyze } from '@/analysis/analyze';
import { parseBpmnXml } from '@/bpmn/import/parse';

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Defs" targetNamespace="urn:test">
${body}
</bpmn:definitions>`;

/** "RULE:severity:ids" for every finding of the given rules. */
async function findings(body: string, ...rules: string[]): Promise<string[]> {
  const { definitions } = await parseBpmnXml(wrap(body));
  return analyze(definitions)
    .findings.filter((f) => !rules.length || rules.includes(f.ruleId))
    .map((f) => `${f.ruleId}:${f.severity}:${f.elementIds.join(',')}`)
    .sort();
}

const flow = (id: string, s: string, t: string, cond?: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}">${
    cond
      ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${cond}</bpmn:conditionExpression>`
      : ''
  }</bpmn:sequenceFlow>`;

describe('link events (p. 288)', () => {
  it('reports unpaired and ambiguous links, and a link catch without outgoing flow', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="S" /><bpmn:intermediateThrowEvent id="T1" name="A"><bpmn:linkEventDefinition name="A" /></bpmn:intermediateThrowEvent>
      <bpmn:intermediateThrowEvent id="T2"><bpmn:linkEventDefinition name="Nowhere" /></bpmn:intermediateThrowEvent>
      <bpmn:intermediateCatchEvent id="C1"><bpmn:linkEventDefinition name="A" /></bpmn:intermediateCatchEvent>
      <bpmn:intermediateCatchEvent id="C2"><bpmn:linkEventDefinition name="A" /></bpmn:intermediateCatchEvent>
      <bpmn:endEvent id="E" />
      ${flow('F1', 'S', 'T1')}${flow('F2', 'S', 'T2')}${flow('F3', 'C1', 'E')}
    </bpmn:process>`;
    const r = await findings(body, 'VAL-LINK-UNPAIRED', 'VAL-LINK-AMBIGUOUS', 'GRAPH-DEAD-END');
    expect(r).toEqual([
      'GRAPH-DEAD-END:warning:C2',
      'VAL-LINK-AMBIGUOUS:error:T1,C1,C2',
      'VAL-LINK-UNPAIRED:error:T2',
    ]);
  });
});

describe('sequence flow connections', () => {
  it('rejects flows into boundary / link catch events and around event sub-processes and compensation', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="S" /><bpmn:task id="A" /><bpmn:task id="Comp" isForCompensation="true" />
      <bpmn:boundaryEvent id="B" attachedToRef="A"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
      <bpmn:intermediateCatchEvent id="LC"><bpmn:linkEventDefinition name="L" /></bpmn:intermediateCatchEvent>
      <bpmn:subProcess id="ESP" triggeredByEvent="true">
        <bpmn:startEvent id="ES"><bpmn:messageEventDefinition /></bpmn:startEvent><bpmn:endEvent id="EE" />
        ${flow('EF', 'ES', 'EE')}
      </bpmn:subProcess>
      <bpmn:endEvent id="E" />
      ${flow('F1', 'S', 'A')}${flow('F2', 'A', 'B')}${flow('F3', 'B', 'E')}${flow('F4', 'A', 'LC')}
      ${flow('F5', 'A', 'ESP')}${flow('F6', 'A', 'Comp')}${flow('F7', 'A', 'E')}
    </bpmn:process>`;
    expect(await findings(body, 'VAL-INVALID-CONNECTION')).toEqual([
      'VAL-INVALID-CONNECTION:error:F2',
      'VAL-INVALID-CONNECTION:error:F3',
      'VAL-INVALID-CONNECTION:error:F4',
      'VAL-INVALID-CONNECTION:error:F5',
      'VAL-INVALID-CONNECTION:error:F6',
    ]);
  });
});

describe('start events by position (p. 204, 271–272)', () => {
  it('checks triggers at the top level, in sub-processes and in event sub-processes', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="TopError"><bpmn:errorEventDefinition /></bpmn:startEvent>
      <bpmn:task id="A" /><bpmn:endEvent id="E" />
      ${flow('F1', 'TopError', 'A')}${flow('F2', 'A', 'E')}
      <bpmn:subProcess id="Sub">
        <bpmn:startEvent id="SubTimer"><bpmn:timerEventDefinition /></bpmn:startEvent><bpmn:endEvent id="SE" />
        ${flow('F3', 'SubTimer', 'SE')}
      </bpmn:subProcess>
      <bpmn:subProcess id="Esp1" triggeredByEvent="true">
        <bpmn:startEvent id="NonIntError" isInterrupting="false"><bpmn:errorEventDefinition /></bpmn:startEvent>
        <bpmn:endEvent id="EE1" />${flow('F4', 'NonIntError', 'EE1')}
      </bpmn:subProcess>
      <bpmn:subProcess id="Esp2" triggeredByEvent="true">
        <bpmn:startEvent id="NoTrigger" /><bpmn:startEvent id="Second"><bpmn:signalEventDefinition /></bpmn:startEvent>
        <bpmn:endEvent id="EE2" />${flow('F5', 'NoTrigger', 'EE2')}${flow('F6', 'Second', 'EE2')}
      </bpmn:subProcess>
      <bpmn:subProcess id="Esp3" triggeredByEvent="true">
        <bpmn:startEvent id="OkError"><bpmn:errorEventDefinition /></bpmn:startEvent>
        <bpmn:endEvent id="EE3" />${flow('F7', 'OkError', 'EE3')}
      </bpmn:subProcess>
    </bpmn:process>`;
    expect(await findings(body, 'VAL-START-TRIGGER', 'VAL-EVENT-SUBPROCESS')).toEqual([
      'VAL-EVENT-SUBPROCESS:error:Esp2,NoTrigger,Second',
      'VAL-EVENT-SUBPROCESS:error:NoTrigger',
      'VAL-START-TRIGGER:error:NonIntError',
      'VAL-START-TRIGGER:error:SubTimer',
      'VAL-START-TRIGGER:error:TopError',
    ]);
  });
});

describe('event-based gateway (p. 326–328)', () => {
  it('checks branches, targets, conditions and instantiation', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="S" />
      <bpmn:eventBasedGateway id="G" />
      <bpmn:intermediateCatchEvent id="Msg"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
      <bpmn:receiveTask id="Rcv" />
      <bpmn:boundaryEvent id="RB" attachedToRef="Rcv"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
      <bpmn:task id="Plain" />
      <bpmn:endEvent id="E" />
      ${flow('F0', 'S', 'G')}${flow('F1', 'G', 'Msg', 'x')}${flow('F2', 'G', 'Rcv')}${flow('F3', 'G', 'Plain')}
      ${flow('F4', 'S', 'Msg')}${flow('F5', 'Msg', 'E')}${flow('F6', 'Rcv', 'E')}${flow('F7', 'Plain', 'E')}${flow('F8', 'RB', 'E')}
      <bpmn:eventBasedGateway id="One" instantiate="true" />
      <bpmn:intermediateCatchEvent id="T"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
      ${flow('F9', 'E2src', 'One')}
      ${flow('F10', 'One', 'T')}${flow('F11', 'T', 'E')}
      <bpmn:task id="E2src" />${flow('F12', 'S', 'E2src')}
    </bpmn:process>`;
    const r = await findings(
      body,
      'VAL-EVENT-GATEWAY',
      'VAL-CONDITION',
      'VAL-INSTANTIATE-INCOMING',
    );
    expect(r).toEqual([
      'VAL-CONDITION:error:F1',
      'VAL-EVENT-GATEWAY:error:G,Msg',
      'VAL-EVENT-GATEWAY:error:G,Plain',
      'VAL-EVENT-GATEWAY:error:G,Rcv,Msg',
      'VAL-EVENT-GATEWAY:error:G,Rcv,RB',
      'VAL-EVENT-GATEWAY:error:One',
      'VAL-INSTANTIATE-INCOMING:error:One',
    ]);
  });

  it('an instantiating gateway is an entry: no missing-start or unreachable findings', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:eventBasedGateway id="G" instantiate="true" />
      <bpmn:intermediateCatchEvent id="M"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
      <bpmn:intermediateCatchEvent id="T"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
      <bpmn:task id="A" /><bpmn:endEvent id="E" />
      ${flow('F1', 'G', 'M')}${flow('F2', 'G', 'T')}${flow('F3', 'M', 'A')}${flow('F4', 'T', 'A')}${flow('F5', 'A', 'E')}
    </bpmn:process>`;
    const r = await findings(body);
    expect(r.filter((f) => f.startsWith('GRAPH-UNREACHABLE'))).toEqual([]);
    const relevant = r.filter((f) => !f.startsWith('VAL-BROKEN-REFERENCE')); // fixture omits incoming/outgoing
    expect(relevant.filter((f) => f.includes(':error:') || f.includes(':warning:'))).toEqual([
      'VAL-INCOMPLETE-EVENT:warning:T',
    ]);
  });
});

describe('conditions and default flows (p. 125, 274, 322)', () => {
  it('reports conditions out of events and parallel gateways, on default flows, and lone conditional flows', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="S" /><bpmn:parallelGateway id="Par" />
      <bpmn:exclusiveGateway id="X" default="D" /><bpmn:task id="A" /><bpmn:task id="B" /><bpmn:endEvent id="E" />
      ${flow('F1', 'S', 'Par', 'x')}${flow('F2', 'Par', 'X', 'y')}${flow('F2b', 'Par', 'X')}
      ${flow('D', 'X', 'A', 'z')}${flow('F3', 'X', 'B', 'w')}
      ${flow('F4', 'A', 'E', 'only')}${flow('F5', 'B', 'E')}
    </bpmn:process>`;
    expect(await findings(body, 'VAL-CONDITION')).toEqual([
      'VAL-CONDITION:error:F1',
      'VAL-CONDITION:error:F2',
      'VAL-CONDITION:error:F4',
      'VAL-CONDITION:warning:D',
    ]);
  });

  it('inclusive and complex splits need conditions too', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="S" /><bpmn:inclusiveGateway id="I" /><bpmn:task id="A" /><bpmn:task id="B" /><bpmn:endEvent id="E" />
      ${flow('F1', 'S', 'I')}${flow('F2', 'I', 'A', 'a')}${flow('F3', 'I', 'B')}${flow('F4', 'A', 'E')}${flow('F5', 'B', 'E')}
    </bpmn:process>`;
    expect(await findings(body, 'GW-MISSING-CONDITION')).toEqual([
      'GW-MISSING-CONDITION:warning:I,F3',
    ]);
  });
});

describe('sub-process kinds and interrupting rules', () => {
  it('reports start/end in ad-hoc sub-processes, cancel outside transactions, non-interrupting error/cancel', async () => {
    const body = `<bpmn:process id="P">
      <bpmn:startEvent id="S" />
      <bpmn:adHocSubProcess id="Adhoc"><bpmn:startEvent id="AS" /><bpmn:task id="AT" /></bpmn:adHocSubProcess>
      <bpmn:subProcess id="Sub"><bpmn:startEvent id="SS" /><bpmn:endEvent id="Cancel"><bpmn:cancelEventDefinition /></bpmn:endEvent>${flow('SF', 'SS', 'Cancel')}</bpmn:subProcess>
      <bpmn:transaction id="Tx"><bpmn:startEvent id="TS" /><bpmn:endEvent id="TxCancel"><bpmn:cancelEventDefinition /></bpmn:endEvent>${flow('TF', 'TS', 'TxCancel')}</bpmn:transaction>
      <bpmn:boundaryEvent id="BC" attachedToRef="Sub"><bpmn:cancelEventDefinition /></bpmn:boundaryEvent>
      <bpmn:boundaryEvent id="BE" attachedToRef="Tx" cancelActivity="false"><bpmn:errorEventDefinition /></bpmn:boundaryEvent>
      <bpmn:endEvent id="E" />
      ${flow('F1', 'S', 'Adhoc')}${flow('F2', 'Adhoc', 'Sub')}${flow('F3', 'Sub', 'Tx')}${flow('F4', 'Tx', 'E')}
      ${flow('F5', 'BC', 'E')}${flow('F6', 'BE', 'E')}
    </bpmn:process>`;
    expect(
      await findings(
        body,
        'VAL-ADHOC-START-END',
        'VAL-CANCEL-OUTSIDE-TRANSACTION',
        'VAL-NON-INTERRUPTING',
      ),
    ).toEqual([
      'VAL-ADHOC-START-END:error:AS',
      'VAL-CANCEL-OUTSIDE-TRANSACTION:error:BC',
      'VAL-CANCEL-OUTSIDE-TRANSACTION:error:Cancel',
      'VAL-NON-INTERRUPTING:error:BE',
    ]);
  });
});

describe('start / end pairing and gateways (p. 268, 276, 319)', () => {
  it('errors when only one of start and end exists, info when neither', async () => {
    const onlyStart = `<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="A" />${flow('F', 'S', 'A')}</bpmn:process>`;
    expect(await findings(onlyStart, 'VAL-MISSING-START', 'VAL-MISSING-END')).toEqual([
      'VAL-MISSING-END:error:P',
    ]);
    const neither = `<bpmn:process id="P"><bpmn:task id="A" /><bpmn:task id="B" />${flow('F', 'A', 'B')}</bpmn:process>`;
    expect(await findings(neither, 'VAL-MISSING-START', 'VAL-MISSING-END')).toEqual([
      'VAL-MISSING-END:info:P',
      'VAL-MISSING-START:info:P',
    ]);
  });

  it('a pass-through gateway is a warning', async () => {
    const body = `<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:exclusiveGateway id="G" /><bpmn:endEvent id="E" />
      ${flow('F1', 'S', 'G')}${flow('F2', 'G', 'E')}</bpmn:process>`;
    expect(await findings(body, 'GW-PASS-THROUGH')).toEqual(['GW-PASS-THROUGH:warning:G']);
  });
});

describe('message flows (Table 7.4, p. 72, 278)', () => {
  it('checks senders and receivers', async () => {
    const body = `<bpmn:collaboration id="C">
        <bpmn:participant id="P1" processRef="Proc1" /><bpmn:participant id="P2" processRef="Proc2" />
        <bpmn:messageFlow id="Ok1" sourceRef="Send" targetRef="P2" />
        <bpmn:messageFlow id="Ok2" sourceRef="MsgEnd" targetRef="MsgStart" />
        <bpmn:messageFlow id="NoTrigger" sourceRef="PlainEnd" targetRef="P2" />
        <bpmn:messageFlow id="FromStart" sourceRef="Start1" targetRef="P2" />
        <bpmn:messageFlow id="ToGateway" sourceRef="P2" targetRef="G" />
      </bpmn:collaboration>
      <bpmn:process id="Proc1">
        <bpmn:startEvent id="Start1" /><bpmn:task id="Send" /><bpmn:exclusiveGateway id="G" />
        <bpmn:endEvent id="MsgEnd"><bpmn:messageEventDefinition /></bpmn:endEvent><bpmn:endEvent id="PlainEnd" />
      </bpmn:process>
      <bpmn:process id="Proc2"><bpmn:startEvent id="MsgStart"><bpmn:messageEventDefinition /></bpmn:startEvent></bpmn:process>`;
    expect(await findings(body, 'VAL-MESSAGE-FLOW')).toEqual([
      'VAL-MESSAGE-FLOW:error:FromStart,Start1',
      'VAL-MESSAGE-FLOW:error:ToGateway,G',
      'VAL-MESSAGE-FLOW:warning:NoTrigger,PlainEnd',
    ]);
  });
});

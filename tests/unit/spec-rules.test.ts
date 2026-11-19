/** Position-aware triggers and flow rules from BPMN 2.0.2 §10 (elements.ts helpers). */
import { describe, expect, it } from 'vitest';
import { loadBpmnDocument, type BpmnDocument } from '@/bpmn/document';
import {
  allowedEventDefinitions,
  canHaveDefaultFlow,
  conditionAllowedFrom,
  definitionRequired,
  interruptingIsFixed,
  isEditableFlowNode,
} from '@/bpmn/model/elements';
import { walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { canReceiveMessage, canSendMessage } from '@/editor/interaction/BpmnFlowRules';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="urn:test">
  <bpmn:process id="Proc">
    <bpmn:startEvent id="TopStart" />
    <bpmn:subProcess id="Embedded"><bpmn:startEvent id="InnerStart" /></bpmn:subProcess>
    <bpmn:subProcess id="Esp" triggeredByEvent="true">
      <bpmn:startEvent id="EspStart"><bpmn:errorEventDefinition id="Err" /></bpmn:startEvent>
    </bpmn:subProcess>
    <bpmn:subProcess id="EspNi" triggeredByEvent="true">
      <bpmn:startEvent id="EspNiStart" isInterrupting="false"><bpmn:escalationEventDefinition id="Esc" /></bpmn:startEvent>
    </bpmn:subProcess>
    <bpmn:transaction id="Tx"><bpmn:endEvent id="TxEnd" /></bpmn:transaction>
    <bpmn:endEvent id="End" />
    <bpmn:endEvent id="MsgEnd"><bpmn:messageEventDefinition id="M1" /></bpmn:endEvent>
    <bpmn:intermediateCatchEvent id="Timer"><bpmn:timerEventDefinition id="T1" /></bpmn:intermediateCatchEvent>
    <bpmn:task id="Task" />
    <bpmn:boundaryEvent id="OnTask" attachedToRef="Task" cancelActivity="false"><bpmn:timerEventDefinition id="T2" /></bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="OnTx" attachedToRef="Tx"><bpmn:cancelEventDefinition id="C1" /></bpmn:boundaryEvent>
    <bpmn:parallelGateway id="Par" />
    <bpmn:exclusiveGateway id="Xor" />
    <bpmn:intermediateThrowEvent id="Shared"><bpmn:eventDefinitionRef>M1</bpmn:eventDefinitionRef></bpmn:intermediateThrowEvent>
  </bpmn:process>
</bpmn:definitions>`;

let doc: BpmnDocument;
const find = (id: string): ModdleElement => {
  let found: ModdleElement | undefined;
  walkContainment(doc.definitions, (el) => {
    if (el.id === id) found = el;
  });
  return found!;
};
const short = (types: readonly string[]) =>
  types.map((t) => t.replace(/^bpmn:|EventDefinition$/g, '')).sort();

describe('allowed triggers depend on where the event is (PDF 271–291)', async () => {
  doc = await loadBpmnDocument(XML);

  it('start events', () => {
    expect(short(allowedEventDefinitions(find('TopStart')))).toEqual([
      'Conditional',
      'Message',
      'Signal',
      'Timer',
    ]);
    expect(allowedEventDefinitions(find('InnerStart'))).toEqual([]);
    expect(short(allowedEventDefinitions(find('EspStart')))).toEqual([
      'Compensate',
      'Conditional',
      'Error',
      'Escalation',
      'Message',
      'Signal',
      'Timer',
    ]);
    expect(short(allowedEventDefinitions(find('EspNiStart')))).not.toContain('Error');
    expect(definitionRequired(find('EspStart'))).toBe(true);
    expect(definitionRequired(find('TopStart'))).toBe(false);
  });

  it('error start events in event sub-processes are editable (no longer read-only)', () => {
    expect(isEditableFlowNode(find('EspStart'))).toBe(true);
    expect(interruptingIsFixed(find('EspStart'))).toBe(true);
    expect(interruptingIsFixed(find('EspNiStart'))).toBe(false);
  });

  it('cancel only in and on transactions; non-interrupting boundaries', () => {
    expect(short(allowedEventDefinitions(find('End')))).not.toContain('Cancel');
    expect(short(allowedEventDefinitions(find('TxEnd')))).toContain('Cancel');
    expect(short(allowedEventDefinitions(find('OnTx')))).toContain('Cancel');
    const nonInterrupting = short(allowedEventDefinitions(find('OnTask')));
    expect(nonInterrupting).not.toContain('Error');
    expect(nonInterrupting).not.toContain('Cancel');
    expect(nonInterrupting).toContain('Escalation');
  });

  it('events using shared definitions (eventDefinitionRefs) are not editable yet', () => {
    expect(isEditableFlowNode(find('Shared'))).toBe(false);
  });
});

describe('flow rules', async () => {
  doc = await loadBpmnDocument(XML);

  it('conditions and default flows only from activities and exclusive/inclusive/complex gateways', () => {
    expect(conditionAllowedFrom(find('Task'))).toBe(true);
    expect(conditionAllowedFrom(find('Xor'))).toBe(true);
    expect(conditionAllowedFrom(find('Par'))).toBe(false);
    expect(conditionAllowedFrom(find('TopStart'))).toBe(false);
    expect(canHaveDefaultFlow(find('Task'))).toBe(true);
    expect(canHaveDefaultFlow(find('Par'))).toBe(false);
  });

  it('message flow ends follow Table 7.4', () => {
    expect(canSendMessage(find('MsgEnd'))).toBe(true);
    expect(canSendMessage(find('End'))).toBe(false);
    expect(canSendMessage(find('Timer'))).toBe(false);
    expect(canReceiveMessage(find('TopStart'))).toBe(false); // none start: needs a message trigger
    expect(canReceiveMessage(find('Task'))).toBe(true);
    expect(canSendMessage(find('Esp'))).toBe(false);
    expect(canSendMessage(find('Par'))).toBe(false);
  });
});

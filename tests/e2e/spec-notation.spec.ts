/** BPMN 2.0.2 notation and DI rules (Ch. 12) on a file written by another tool. */
import { expect, test } from '@playwright/test';
import { el, openXml } from './helpers';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Defs" targetNamespace="urn:test">
  <bpmn:message id="Msg" name="Order" />
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Pool" processRef="Proc" />
    <bpmn:participant id="Many" name="Suppliers"><bpmn:participantMultiplicity id="PM" minimum="1" maximum="5" /></bpmn:participant>
    <bpmn:messageFlow id="MfPlain" sourceRef="Task" targetRef="Many" messageRef="Msg" />
    <bpmn:messageFlow id="MfShown" sourceRef="Many" targetRef="Task" messageRef="Msg" />
  </bpmn:collaboration>
  <bpmn:process id="Proc">
    <bpmn:task id="Task" />
    <bpmn:subProcess id="Folded" />
    <bpmn:subProcess id="Drawn"><bpmn:task id="Inner" /></bpmn:subProcess>
    <bpmn:callActivity id="Call" calledElement="Other" />
    <bpmn:subProcess id="OnError" triggeredByEvent="true">
      <bpmn:startEvent id="ErrStart"><bpmn:errorEventDefinition id="ErrDef" /></bpmn:startEvent>
    </bpmn:subProcess>
    <bpmn:textAnnotation id="Note" />
    <bpmn:association id="Both" sourceRef="Task" targetRef="Note" associationDirection="Both" />
  </bpmn:process>
  <bpmn:process id="Other" />
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="0" y="0" width="1000" height="300" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Many_di" bpmnElement="Many" isHorizontal="true"><dc:Bounds x="0" y="380" width="1000" height="100" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_di" bpmnElement="Task"><dc:Bounds x="60" y="40" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Folded_di" bpmnElement="Folded"><dc:Bounds x="200" y="40" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Drawn_di" bpmnElement="Drawn"><dc:Bounds x="340" y="20" width="220" height="140" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Inner_di" bpmnElement="Inner"><dc:Bounds x="400" y="50" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Call_di" bpmnElement="Call"><dc:Bounds x="600" y="40" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="OnError_di" bpmnElement="OnError" isExpanded="false"><dc:Bounds x="740" y="40" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Note_di" bpmnElement="Note"><dc:Bounds x="60" y="200" width="100" height="30" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Both_di" bpmnElement="Both"><di:waypoint x="110" y="120" /><di:waypoint x="110" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="MfPlain_di" bpmnElement="MfPlain"><di:waypoint x="90" y="120" /><di:waypoint x="90" y="380" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="MfShown_di" bpmnElement="MfShown" messageVisibleKind="non_initiating"><di:waypoint x="140" y="380" /><di:waypoint x="140" y="120" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="D_err">
    <bpmndi:BPMNPlane id="Plane_err" bpmnElement="OnError">
      <bpmndi:BPMNShape id="ErrStart_di" bpmnElement="ErrStart"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('BPMN 2.0.2 notation: isExpanded, envelopes, call activities, event sub-process triggers', async ({
  page,
}) => {
  await page.goto('/');
  await openXml(page, XML, 'spec-notation.bpmn');
  await expect(el(page, 'Task')).toBeVisible();
  // Error start events in event sub-processes are supported: the file stays editable.
  await expect(page.getByText('Read-only')).toHaveCount(0);

  // No isExpanded: collapsed ([+]) unless the content is drawn inside (Table 12.10).
  const plus = 'path[d="M0,0h14v14h-14z"]';
  await expect(el(page, 'Folded').locator(plus)).toHaveCount(1);
  await expect(el(page, 'Drawn').locator(plus)).toHaveCount(0);
  await expect(el(page, 'Inner')).toBeVisible();
  // A call activity calling a process gets the [+] marker (Table 12.19).
  await expect(el(page, 'Call').locator(plus)).toHaveCount(1);
  // Collapsed event sub-process shows its start event top left (PDF 204).
  await expect(el(page, 'OnError').locator('.bf-event-subprocess-trigger')).toHaveCount(1);

  // Envelope only with DI messageVisibleKind (Table 12.35).
  await expect(el(page, 'MfPlain').locator('.bf-message-envelope')).toHaveCount(0);
  await expect(el(page, 'MfShown').locator('.bf-non-initiating')).toHaveCount(1);
  // Multi-instance participant: three vertical lines (PDF 143).
  await expect(el(page, 'Many').locator('path[d^="M"][class="bf-icon-stroke"]')).toHaveCount(1);
  // Bidirectional association: an arrowhead at each end.
  await expect(el(page, 'Both').locator('.bf-open-arrow')).toHaveCount(2);

  // The envelope can be switched on in the properties.
  const flow = (await el(page, 'MfPlain').boundingBox())!; // vertical: zero width
  await page.mouse.click(flow.x + flow.width / 2, flow.y + flow.height / 2);
  await page.getByTestId('inspector').getByLabel('Message envelope').selectOption('initiating');
  await expect(el(page, 'MfPlain').locator('.bf-message-envelope')).toHaveCount(1);
});

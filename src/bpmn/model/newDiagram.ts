/** XML template for a new, empty document (Start → Task → End). */
export function newDiagramXml(id = randomSuffix()): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${id}" targetNamespace="http://bpmn.io/schema/bpmn" exporter="BPMN Flow" exporterVersion="0.1.0">
  <bpmn:process id="Process_${id}" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Do the work">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="EndEvent_1" name="Done">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_${id}">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="160" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="165" y="225" width="26" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="260" y="160" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="432" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="436" y="225" width="28" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="196" y="200" />
        <di:waypoint x="260" y="200" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="360" y="200" />
        <di:waypoint x="432" y="200" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** XML template for a new choreography diagram (two participants, one choreography task). */
export function newChoreographyXml(id = randomSuffix()): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${id}" targetNamespace="http://bpmn.io/schema/bpmn" exporter="BPMN Flow" exporterVersion="0.1.0">
  <bpmn:choreography id="Choreography_${id}">
    <bpmn:participant id="Participant_A_${id}" name="Customer" />
    <bpmn:participant id="Participant_B_${id}" name="Supplier" />
    <bpmn:messageFlow id="MessageFlow_1" name="Order" sourceRef="Participant_A_${id}" targetRef="Participant_B_${id}" />
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:choreographyTask id="ChoreographyTask_1" name="Place order" initiatingParticipantRef="Participant_A_${id}">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
      <bpmn:participantRef>Participant_A_${id}</bpmn:participantRef>
      <bpmn:participantRef>Participant_B_${id}</bpmn:participantRef>
      <bpmn:messageFlowRef>MessageFlow_1</bpmn:messageFlowRef>
    </bpmn:choreographyTask>
    <bpmn:endEvent id="EndEvent_1">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="ChoreographyTask_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="ChoreographyTask_1" targetRef="EndEvent_1" />
  </bpmn:choreography>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Choreography_${id}">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="160" y="182" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ChoreographyTask_1_di" bpmnElement="ChoreographyTask_1"><dc:Bounds x="260" y="150" width="120" height="100" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ChoreographyTask_1_band_a" bpmnElement="Participant_A_${id}" choreographyActivityShape="ChoreographyTask_1_di" participantBandKind="top_initiating"><dc:Bounds x="260" y="150" width="120" height="20" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ChoreographyTask_1_band_b" bpmnElement="Participant_B_${id}" choreographyActivityShape="ChoreographyTask_1_di" participantBandKind="bottom_non_initiating"><dc:Bounds x="260" y="230" width="120" height="20" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="442" y="182" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="196" y="200" /><di:waypoint x="260" y="200" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="380" y="200" /><di:waypoint x="442" y="200" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

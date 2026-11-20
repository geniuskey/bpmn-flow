// @vitest-environment jsdom
/** BPMN 2.0.2 §12.2.1 (PDF 398): the order of the plane's elements is their Z-order. */
import { describe, expect, it } from 'vitest';
import { loadBpmnDocument } from '@/bpmn/document';
import { EditorController } from '@/editor/EditorController';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="urn:test">
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:task id="A"><bpmn:outgoing>F</bpmn:outgoing></bpmn:task>
    <bpmn:task id="B"><bpmn:incoming>F</bpmn:incoming></bpmn:task>
    <bpmn:task id="C" />
    <bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    <bpmndi:BPMNShape id="A_di" bpmnElement="A"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="B_di" bpmnElement="B"><dc:Bounds x="400" y="100" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_di" bpmnElement="F"><di:waypoint x="200" y="140" /><di:waypoint x="400" y="140" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNShape id="C_di" bpmnElement="C"><dc:Bounds x="250" y="100" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('z-order', () => {
  it('draws a shape listed after an edge on top of it', async () => {
    const doc = await loadBpmnDocument(XML);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = new EditorController(host);
    controller.open(doc);
    const order = [...host.querySelectorAll('[data-element-id]')]
      .map((g) => g.getAttribute('data-element-id'))
      .filter((id) => id && ['A', 'B', 'C', 'F'].includes(id));
    expect(order).toEqual(['A', 'B', 'F', 'C']);
  });
});

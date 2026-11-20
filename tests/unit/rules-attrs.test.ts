// @vitest-environment jsdom
/**
 * BPMN 2.0.2 modeling rules enforced while editing (event-based gateway
 * configurations, message flow counts, gateway direction, conditional flows)
 * and notation-relevant attributes edited in the inspector (expressions,
 * error / escalation codes, compensation, links, categories, process and
 * flow attributes, called elements), on a real diagram-js editor.
 */
import { describe, expect, it } from 'vitest';
import type { Shape } from 'diagram-js/lib/model/Types';
import { loadBpmnDocument } from '@/bpmn/document';
import { annotationText, groupLabel } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { canAttach, canConnect, canMessageFlow } from '@/editor/interaction/BpmnFlowRules';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

type Internals = { diagram: { get<T>(name: string): T } };
type Modeling = { connect(a: unknown, b: unknown, attrs: unknown): { id: string } };

const shapeXml = (id: string, x: number, y: number, w: number, h: number) =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
const edgeXml = (id: string, pts: [number, number][]) =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Defs" targetNamespace="urn:test">
  <bpmn:error id="Err" name="Failure" />
  <bpmn:category id="Cat"><bpmn:categoryValue id="CV" /></bpmn:category>
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="P1" processRef="Proc" />
    <bpmn:participant id="P2" />
    <bpmn:messageFlow id="MF1" sourceRef="ME" targetRef="P2" />
  </bpmn:collaboration>
  <bpmn:process id="Proc">
    <bpmn:startEvent id="S" />
    <bpmn:eventBasedGateway id="G" />
    <bpmn:receiveTask id="RT1" />
    <bpmn:intermediateCatchEvent id="TC"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="MC2"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:receiveTask id="RT2" />
    <bpmn:task id="A" name="Book" />
    <bpmn:task id="B" />
    <bpmn:exclusiveGateway id="CG" gatewayDirection="Converging" />
    <bpmn:intermediateThrowEvent id="MT"><bpmn:messageEventDefinition /></bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="ME"><bpmn:messageEventDefinition /></bpmn:endEvent>
    <bpmn:endEvent id="EE"><bpmn:errorEventDefinition errorRef="Err" /></bpmn:endEvent>
    <bpmn:intermediateThrowEvent id="CT"><bpmn:compensateEventDefinition /></bpmn:intermediateThrowEvent>
    <bpmn:intermediateThrowEvent id="LT"><bpmn:linkEventDefinition id="LTD" name="L" /></bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="LC"><bpmn:linkEventDefinition id="LCD" name="M" /></bpmn:intermediateCatchEvent>
    <bpmn:callActivity id="CA" />
    <bpmn:complexGateway id="CX" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G" />
    <bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="RT1" />
    <bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="TC" />
    <bpmn:sequenceFlow id="F4" sourceRef="A" targetRef="B" />
    <bpmn:sequenceFlow id="F5" sourceRef="CG" targetRef="B" />
    <bpmn:textAnnotation id="Note"><bpmn:text>&lt;p&gt;Hello &amp;amp; &lt;b&gt;bye&lt;/b&gt;&lt;/p&gt;</bpmn:text></bpmn:textAnnotation>
    <bpmn:group id="Grp" categoryValueRef="CV" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="P1_di" bpmnElement="P1" isHorizontal="true"><dc:Bounds x="0" y="0" width="1300" height="560" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P2_di" bpmnElement="P2" isHorizontal="true"><dc:Bounds x="0" y="650" width="1300" height="120" /></bpmndi:BPMNShape>
      ${shapeXml('S', 60, 82, 36, 36)}${shapeXml('G', 150, 75, 50, 50)}
      ${shapeXml('RT1', 300, 20, 100, 80)}${shapeXml('TC', 300, 150, 36, 36)}
      ${shapeXml('MC2', 470, 150, 36, 36)}${shapeXml('RT2', 470, 20, 100, 80)}
      ${shapeXml('A', 100, 300, 100, 80)}${shapeXml('B', 300, 300, 100, 80)}
      ${shapeXml('CG', 500, 315, 50, 50)}${shapeXml('MT', 650, 322, 36, 36)}
      ${shapeXml('ME', 750, 322, 36, 36)}${shapeXml('EE', 850, 322, 36, 36)}
      ${shapeXml('CT', 950, 322, 36, 36)}${shapeXml('LT', 650, 450, 36, 36)}
      ${shapeXml('LC', 750, 450, 36, 36)}${shapeXml('CA', 1050, 300, 100, 80)}
      ${shapeXml('CX', 850, 440, 50, 50)}
      ${shapeXml('Note', 650, 150, 120, 50)}${shapeXml('Grp', 80, 270, 350, 140)}
      ${edgeXml('F1', [
        [96, 100],
        [150, 100],
      ])}${edgeXml('F2', [
        [200, 100],
        [300, 60],
      ])}
      ${edgeXml('F3', [
        [175, 125],
        [300, 168],
      ])}${edgeXml('F4', [
        [200, 340],
        [300, 340],
      ])}
      ${edgeXml('F5', [
        [500, 340],
        [400, 340],
      ])}${edgeXml('MF1', [
        [768, 358],
        [768, 650],
      ])}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function open(xml = XML) {
  const doc = await loadBpmnDocument(xml);
  expect(doc.report.mode, JSON.stringify(doc.report.issues)).toBe('editable');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  const el = (id: string) =>
    controller.getElement(id) as unknown as Shape & { businessObject: ModdleElement };
  const modeling = (controller as unknown as Internals).diagram.get<Modeling>('modeling');
  return { controller, doc, el, modeling };
}

const roundTrip = async (controller: EditorController) => {
  const xml = await controller.exportXml();
  const again = await loadBpmnDocument(xml);
  expect(again.report.mode, JSON.stringify(again.report.issues)).toBe('editable');
  return xml;
};

describe('event-based gateway configurations while editing (PDF 327)', () => {
  it('keeps targets single-entry and does not mix receive tasks with message events', async () => {
    const { el, doc } = await open();
    // RT1 already follows G: a message catch event would mix the configuration.
    expect(canConnect(el('G'), el('MC2'))).toBe(false);
    expect(canConnect(el('G'), el('RT2'))).toBe(true);
    // Targets of the gateway take no other incoming flows, from anywhere.
    expect(canConnect(el('A'), el('RT1'))).toBe(false);
    expect(canConnect(el('A'), el('TC'))).toBe(false);
    // Reconnecting the gateway's own flow to another target is fine.
    expect(canConnect(el('G'), el('RT2'), el('F2'))).toBe(true);
    // Receive tasks of the configuration take no boundary events.
    const boundary = doc.moddle.create('bpmn:BoundaryEvent', { id: 'NewB' });
    const def = doc.moddle.create('bpmn:TimerEventDefinition');
    boundary.set('eventDefinitions', [def]);
    const probe = { id: 'NewB', businessObject: boundary } as unknown as Shape;
    expect(canAttach([probe], el('RT1'))).toBe(false);
    expect(canAttach([probe], el('RT2'))).toBe(true);
  });
});

describe('message flow counts (PDF 278, 289)', () => {
  it('one message flow on a message intermediate event, several only from a Multiple end event', async () => {
    const { el, modeling } = await open();
    expect(canMessageFlow(el('ME'), el('P2'))).toBe(false);
    expect(canMessageFlow(el('ME'), el('P2'), el('MF1'))).toBe(true);
    expect(canMessageFlow(el('MT'), el('P2'))).toBe(true);
    modeling.connect(el('MT'), el('P2'), { type: 'bpmn:MessageFlow' });
    expect(canMessageFlow(el('MT'), el('P2'))).toBe(false);
  });
});

describe('gateway direction (Table 8.46)', () => {
  it('limits flows of converging / diverging gateways and validates the setting', async () => {
    const { controller, el } = await open();
    expect(canConnect(el('CG'), el('A'))).toBe(false); // Converging: one outgoing flow
    expect(canConnect(el('A'), el('CG'))).toBe(true);
    controller.updateProperties('CG', { gatewayDirection: 'Unspecified' });
    expect(el('CG').businessObject.get('gatewayDirection')).toBe('Unspecified'); // default
    expect(canConnect(el('CG'), el('A'))).toBe(true);
    controller.updateProperties('G', { gatewayDirection: 'Converging' }); // 2 outgoing: refused
    expect(el('G').businessObject.get('gatewayDirection')).toBe('Unspecified');
    controller.updateProperties('G', { gatewayDirection: 'Diverging' });
    expect(el('G').businessObject.get('gatewayDirection')).toBe('Diverging');
    expect(canConnect(el('B'), el('G'))).toBe(false);
    controller.undo();
    expect(el('G').businessObject.get('gatewayDirection')).toBe('Unspecified');
  });
});

describe('conditional flows and expressions (PDF 112-114, 125)', () => {
  it('needs another outgoing flow from an activity; natural or formal expressions with a language', async () => {
    const { controller, el, modeling } = await open();
    const flow = el('F4').businessObject;
    controller.updateCondition('F4', 'ok');
    expect(getRef(flow, 'conditionExpression')).toBeUndefined();
    modeling.connect(el('A'), el('CG'), { type: 'bpmn:SequenceFlow' });
    controller.updateElementDetail('F4', {
      kind: 'expression',
      property: 'conditionExpression',
      body: 'the order is large',
      formal: false,
    });
    expect(getRef(flow, 'conditionExpression')?.$type).toBe('bpmn:Expression');
    controller.updateElementDetail('F4', {
      kind: 'expression',
      property: 'conditionExpression',
      body: 'amount > 100',
      formal: true,
      language: 'https://www.w3.org/1999/XPath',
    });
    const expr = getRef(flow, 'conditionExpression')!;
    expect(expr.$type).toBe('bpmn:FormalExpression');
    expect(expr.get('language')).toBe('https://www.w3.org/1999/XPath');
    controller.updateElementDetail('CX', {
      kind: 'expression',
      property: 'activationCondition',
      body: '3 of 5',
      formal: false,
    });
    const xml = await roundTrip(controller);
    expect(xml).toContain('language="https://www.w3.org/1999/XPath"');
    expect(xml).toMatch(/<bpmn:activationCondition>3 of 5<\/bpmn:activationCondition>/);
    controller.undo();
    expect(getRef(el('CX').businessObject, 'activationCondition')).toBeUndefined();
    controller.undo();
    expect(getRef(flow, 'conditionExpression')?.$type).toBe('bpmn:Expression');
  });
});

describe('event attributes', () => {
  it('edits error codes, compensation targets and keeps link references in step', async () => {
    const { controller, el } = await open();
    controller.updateEventDetail('EE', { kind: 'code', value: 'E42' });
    const error = getRef(getMany(el('EE').businessObject, 'eventDefinitions')[0], 'errorRef')!;
    expect(error.get('errorCode')).toBe('E42');

    const compensate = getMany(el('CT').businessObject, 'eventDefinitions')[0]!;
    controller.updateEventDetail('CT', { kind: 'compensateActivity', activityId: 'A' });
    expect(getRef(compensate, 'activityRef')?.id).toBe('A');
    controller.updateEventDetail('CT', { kind: 'waitForCompletion', value: false });
    expect(compensate.get('waitForCompletion')).toBe(false);

    controller.updateEventDetail('LC', { kind: 'link', name: 'L' });
    const [throwDef] = getMany(el('LT').businessObject, 'eventDefinitions');
    const [catchDef] = getMany(el('LC').businessObject, 'eventDefinitions');
    expect(getRef(throwDef, 'target')).toBe(catchDef);
    expect(getMany(catchDef, 'source')).toEqual([throwDef]);
    const xml = await roundTrip(controller);
    expect(xml).toContain('errorCode="E42"');
    expect(xml).toMatch(/activityRef="A"/);
    expect(xml).toMatch(/<bpmn:target>LCD<\/bpmn:target>/);
    controller.undo();
    expect(getRef(throwDef, 'target')).toBeUndefined();
    expect(getMany(catchDef, 'source')).toEqual([]);
  });
});

describe('groups and categories (PDF 98-99)', () => {
  it('shows "Category: value", shares categories and categorizes the elements inside', async () => {
    const { controller, el, doc } = await open();
    const group = el('Grp').businessObject;
    controller.updateProperties('Grp', { name: 'Booking' });
    expect(groupLabel(group)).toBe('Booking');
    controller.updateElementDetail('Grp', { kind: 'groupCategory', name: 'Phase' });
    expect(groupLabel(group)).toBe('Phase: Booking');
    const categories = () =>
      getMany(doc.definitions, 'rootElements').filter((r) => is(r, 'bpmn:Category'));
    expect(categories()).toHaveLength(1);

    controller.updateElementDetail('Grp', { kind: 'categorizeContents' });
    const value = getRef(group, 'categoryValueRef')!;
    expect(getMany(el('A').businessObject, 'categoryValueRef')).toEqual([value]);
    expect(getMany(el('F4').businessObject, 'categoryValueRef')).toEqual([value]);
    expect(getMany(el('CA').businessObject, 'categoryValueRef')).toEqual([]);
    controller.updateElementDetail('CA', { kind: 'categoryValue', id: value.id!, assigned: true });
    expect(getMany(el('CA').businessObject, 'categoryValueRef')).toEqual([value]);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:category id="[^"]+" name="Phase">/);
    expect(xml).toContain(`<bpmn:categoryValueRef>${value.id}</bpmn:categoryValueRef>`);
    controller.undo();
    controller.undo();
    expect(getMany(el('A').businessObject, 'categoryValueRef')).toEqual([]);
    controller.undo();
    expect(groupLabel(group)).toBe('Booking');
  });
});

describe('process, flow and annotation attributes', () => {
  it('edits process type / closed on a pool, isImmediate and text format', async () => {
    const { controller, el, doc } = await open();
    const process = getRef(el('P1').businessObject, 'processRef')!;
    controller.updateProperties('P1', { processType: 'Public', isClosed: true });
    expect(process.get('processType')).toBe('Public');
    expect(process.get('isClosed')).toBe(true);
    controller.updateProperties('F4', { isImmediate: false });
    expect(el('F4').businessObject.get('isImmediate')).toBe(false);
    // An executable process has no isImmediate="false" flows (PDF 339).
    controller.updateProperties('P1', { isExecutable: true });
    expect(process.get('isExecutable')).not.toBe(true);
    controller.updateProperties('F4', { isImmediate: undefined });
    controller.updateProperties('P1', { isExecutable: true });
    expect(process.get('isExecutable')).toBe(true);
    controller.updateProperties('F1', { isImmediate: false });
    expect(el('F1').businessObject.get('isImmediate')).not.toBe(false);

    const note = el('Note').businessObject;
    expect(annotationText(note)).toBe('<p>Hello &amp; <b>bye</b></p>');
    controller.updateProperties('Note', { textFormat: 'text/html' });
    expect(annotationText(note)).toBe('Hello & bye');
    const xml = await roundTrip(controller);
    expect(xml).toContain('processType="Public"');
    expect(xml).toContain('isClosed="true"');
    expect(xml).toContain('textFormat="text/html"');
    void doc;
  });

  it('creates a process or global task for a call activity and refuses other root elements', async () => {
    const { controller, el, doc } = await open();
    controller.updateElementDetail('CA', { kind: 'newCalledElement', type: 'bpmn:GlobalUserTask' });
    const called = el('CA').businessObject.get('calledElement') as string;
    const root = getMany(doc.definitions, 'rootElements').find((r) => r.id === called);
    expect(root?.$type).toBe('bpmn:GlobalUserTask');
    controller.updateProperties('CA', { calledElement: 'Collab' }); // a collaboration: refused
    expect(el('CA').businessObject.get('calledElement')).toBe(called);
    controller.updateProperties('CA', { calledElement: 'Proc' });
    expect(el('CA').businessObject.get('calledElement')).toBe('Proc');
    controller.undo();
    controller.undo();
    expect(getMany(doc.definitions, 'rootElements').some((r) => r.id === called)).toBe(false);
  });
});

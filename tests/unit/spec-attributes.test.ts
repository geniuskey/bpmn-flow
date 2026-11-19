/** BPMN 2.0.2 conformance attributes (Tables 2.1/2.2) that the inspector edits. */
import { describe, expect, it } from 'vitest';
import { exportBpmnXml, loadBpmnDocument, type BpmnDocument } from '@/bpmn/document';
import { getMany, getRef, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import ElementDetailHandler from '@/editor/commands/ElementDetailHandler';
import EventDetailHandler from '@/editor/commands/EventDetailHandler';
import { UpdatePropertiesHandler } from '@/editor/commands/UpdatePropertiesHandler';
import type BpmnElementFactory from '@/editor/modeling/BpmnElementFactory';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Defs" targetNamespace="urn:test">
  <bpmn:message id="Existing" name="Order" />
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="P1" processRef="Proc" />
    <bpmn:participant id="P2" />
    <bpmn:messageFlow id="MF" sourceRef="Loop" targetRef="P2" />
  </bpmn:collaboration>
  <bpmn:process id="Proc">
    <bpmn:task id="Loop"><bpmn:standardLoopCharacteristics /></bpmn:task>
    <bpmn:task id="MI"><bpmn:multiInstanceLoopCharacteristics /></bpmn:task>
    <bpmn:callActivity id="Call" />
    <bpmn:intermediateThrowEvent id="Throw"><bpmn:linkEventDefinition id="LinkDef" /></bpmn:intermediateThrowEvent>
    <bpmn:dataObjectReference id="DOR" dataObjectRef="DO" />
    <bpmn:dataObject id="DO" />
    <bpmn:textAnnotation id="Note" />
    <bpmn:association id="A" sourceRef="Loop" targetRef="Note" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="P1_di" bpmnElement="P1" isHorizontal="true"><dc:Bounds x="0" y="0" width="900" height="300" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P2_di" bpmnElement="P2" isHorizontal="true"><dc:Bounds x="0" y="350" width="900" height="100" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Loop_di" bpmnElement="Loop"><dc:Bounds x="100" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="MI_di" bpmnElement="MI"><dc:Bounds x="250" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Call_di" bpmnElement="Call"><dc:Bounds x="400" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Throw_di" bpmnElement="Throw"><dc:Bounds x="550" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="DOR_di" bpmnElement="DOR"><dc:Bounds x="650" y="100" width="36" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Note_di" bpmnElement="Note"><dc:Bounds x="100" y="200" width="100" height="30" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF_di" bpmnElement="MF"><di:waypoint x="150" y="160" /><di:waypoint x="150" y="350" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="A_di" bpmnElement="A"><di:waypoint x="150" y="160" /><di:waypoint x="150" y="200" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function find(doc: BpmnDocument, id: string): ModdleElement {
  let found: ModdleElement | undefined;
  walkContainment(doc.definitions, (el) => {
    if (el.id === id && el.$type.startsWith('bpmn:')) found = el;
  });
  return found!;
}

async function setup() {
  const doc = await loadBpmnDocument(XML, 'test.bpmn');
  expect(doc.report.mode).toBe('editable');
  let n = 0;
  const factory = {
    createModdle: (type: string, attrs: Record<string, unknown> = {}) =>
      doc.moddle.create(type, { id: `New_${++n}`, ...attrs }),
  } as unknown as BpmnElementFactory;
  const shape = (id: string) => ({ id, businessObject: find(doc, id) }) as never;
  return { doc, factory, shape };
}

describe('message flow message (messageRef)', () => {
  it('reuses a message with the same name, creates new ones, and undoes', async () => {
    const { doc, factory, shape } = await setup();
    const handler = new ElementDetailHandler(doc.moddle, factory, doc.definitions);
    const flow = find(doc, 'MF');
    const reuse = { element: shape('MF'), detail: { kind: 'message' as const, name: 'Order' } };
    handler.execute(reuse);
    expect(getRef(flow, 'messageRef')).toBe(find(doc, 'Existing'));

    const roots = () => getMany(doc.definitions, 'rootElements').length;
    const before = roots();
    const create = { element: shape('MF'), detail: { kind: 'message' as const, name: 'Invoice' } };
    handler.execute(create);
    expect(getRef(flow, 'messageRef')?.name).toBe('Invoice');
    expect(roots()).toBe(before + 1);
    expect(await exportBpmnXml(doc)).toMatch(/<bpmn:messageFlow id="MF"[^>]*messageRef="New_1"/);

    handler.revert(create);
    expect(roots()).toBe(before);
    expect(getRef(flow, 'messageRef')).toBe(find(doc, 'Existing'));
  });
});

describe('loop and multi-instance attributes', () => {
  it('sets loop condition, maximum and test before on a standard loop', async () => {
    const { doc, factory, shape } = await setup();
    const handler = new ElementDetailHandler(doc.moddle, factory, doc.definitions);
    const loop = getRef(find(doc, 'Loop'), 'loopCharacteristics')!;
    const run = (field: never, value: string | boolean) =>
      handler.execute({ element: shape('Loop'), detail: { kind: 'loop', field, value } });
    run('loopCondition' as never, '${count < 3}');
    run('loopMaximum' as never, '5');
    run('testBefore' as never, true);
    expect((loop.get('loopCondition') as { body: string }).body).toBe('${count < 3}');
    expect(loop.get('loopMaximum')).toBe(5);
    expect(loop.get('testBefore')).toBe(true);
    expect(() => run('loopMaximum' as never, '2.5')).toThrow();
    expect(() => run('loopCardinality' as never, '3')).toThrow(); // not on a standard loop
    const xml = await exportBpmnXml(doc);
    expect(xml).toMatch(/testBefore="true"/);
    expect(xml).toMatch(/loopMaximum="5"/);
  });

  it('sets cardinality, completion condition and behavior on multi-instance', async () => {
    const { doc, factory, shape } = await setup();
    const handler = new ElementDetailHandler(doc.moddle, factory, doc.definitions);
    const mi = getRef(find(doc, 'MI'), 'loopCharacteristics')!;
    const context = {
      element: shape('MI'),
      detail: { kind: 'loop' as const, field: 'loopCardinality' as const, value: '3' },
    };
    handler.execute(context);
    handler.execute({
      element: shape('MI'),
      detail: { kind: 'loop', field: 'behavior', value: 'One' },
    });
    expect((mi.get('loopCardinality') as { body: string }).body).toBe('3');
    expect(mi.get('behavior')).toBe('One');
    handler.revert(context);
    expect(mi.get('loopCardinality')).toBeUndefined();
    await expect(exportBpmnXml(doc)).resolves.toMatch(/behavior="One"/);
  });
});

describe('attributes from the conformance tables', () => {
  it('edits calledElement, associationDirection and link names', async () => {
    const { doc, factory, shape } = await setup();
    const props = new UpdatePropertiesHandler();
    props.execute({ element: shape('Call'), properties: { calledElement: 'BillingProcess' } });
    props.execute({ element: shape('A'), properties: { associationDirection: 'One' } });
    expect(() =>
      props.execute({ element: shape('A'), properties: { associationDirection: 'Up' } }),
    ).toThrow();

    const events = new EventDetailHandler(doc.moddle, factory, doc.definitions);
    events.execute({ element: shape('Throw'), detail: { kind: 'link', name: 'ToReview' } });
    expect(find(doc, 'LinkDef').get('name')).toBe('ToReview');

    const xml = await exportBpmnXml(doc);
    expect(xml).toMatch(/<bpmn:callActivity id="Call" calledElement="BillingProcess"/);
    expect(xml).toMatch(/associationDirection="One"/);
    expect(xml).toMatch(/<bpmn:linkEventDefinition id="LinkDef" name="ToReview"/);
  });

  it('keeps the data object name in step with its reference', async () => {
    const { doc, shape } = await setup();
    const props = new UpdatePropertiesHandler();
    const context = { element: shape('DOR'), properties: { name: 'Invoice' } };
    props.execute(context);
    expect(find(doc, 'DO').name).toBe('Invoice');
    // A data object with its own, different name keeps it.
    find(doc, 'DO').set('name', 'Billing data');
    props.execute({ element: shape('DOR'), properties: { name: 'Invoice v2' } });
    expect(find(doc, 'DO').name).toBe('Billing data');
    find(doc, 'DO').set('name', 'Invoice');
    find(doc, 'DOR').set('name', 'Invoice');
    props.revert(context);
    expect(find(doc, 'DOR').name).toBeUndefined();
    expect(find(doc, 'DO').name).toBeUndefined();
  });
});

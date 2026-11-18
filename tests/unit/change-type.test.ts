/** ChangeTypeHandler keeps every containment and reference consistent, and undo restores them. */
import { describe, expect, it } from 'vitest';
import type Canvas from 'diagram-js/lib/core/Canvas';
import { indexDi } from '@/bpmn/di/di';
import { exportBpmnXml, loadBpmnDocument, type BpmnDocument } from '@/bpmn/document';
import { getMany, getRef, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import ChangeTypeHandler from '@/editor/commands/ChangeTypeHandler';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Defs" targetNamespace="urn:test">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="P1" processRef="Proc" />
    <bpmn:participant id="P2" />
    <bpmn:messageFlow id="MF" sourceRef="Task" targetRef="P2" />
  </bpmn:collaboration>
  <bpmn:process id="Proc">
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Sub">
      <bpmn:documentation>doc</bpmn:documentation>
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:task id="Inner" />
    </bpmn:subProcess>
    <bpmn:boundaryEvent id="B" attachedToRef="Sub" />
    <bpmn:task id="Task">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:property id="Prop" name="__targetRef_placeholder" />
      <bpmn:dataOutputAssociation id="DOA"><bpmn:targetRef>DOR</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:task>
    <bpmn:dataObjectReference id="DOR" dataObjectRef="DO" />
    <bpmn:dataObject id="DO" />
    <bpmn:textAnnotation id="Note" />
    <bpmn:association id="A" sourceRef="Task" targetRef="Note" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Sub" />
    <bpmn:sequenceFlow id="F2" sourceRef="Sub" targetRef="Task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="P1_di" bpmnElement="P1" isHorizontal="true"><dc:Bounds x="0" y="0" width="900" height="300" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="P2_di" bpmnElement="P2" isHorizontal="true"><dc:Bounds x="0" y="350" width="900" height="100" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="50" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="true"><dc:Bounds x="120" y="40" width="250" height="160" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Inner_di" bpmnElement="Inner"><dc:Bounds x="190" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="B_di" bpmnElement="B"><dc:Bounds x="300" y="182" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_di" bpmnElement="Task"><dc:Bounds x="450" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="DOR_di" bpmnElement="DOR"><dc:Bounds x="600" y="200" width="36" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Note_di" bpmnElement="Note"><dc:Bounds x="650" y="40" width="100" height="30" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="86" y="118" /><di:waypoint x="120" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="370" y="120" /><di:waypoint x="450" y="120" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="MF_di" bpmnElement="MF"><di:waypoint x="500" y="160" /><di:waypoint x="500" y="350" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="DOA_di" bpmnElement="DOA"><di:waypoint x="550" y="140" /><di:waypoint x="600" y="220" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="A_di" bpmnElement="A"><di:waypoint x="550" y="100" /><di:waypoint x="650" y="55" /></bpmndi:BPMNEdge>
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

/** Every element whose reference properties point at `target`. */
function referrers(doc: BpmnDocument, target: ModdleElement): string[] {
  const out: string[] = [];
  walkContainment(doc.definitions, (el) => {
    const record = el as unknown as Record<string, unknown>;
    for (const prop of el.$descriptor?.properties ?? []) {
      if (!prop.isReference) continue;
      const v = record[prop.name];
      if (v === target || (Array.isArray(v) && v.includes(target)))
        out.push(`${el.id}.${prop.name}`);
    }
  });
  return out.sort();
}

async function setup(id: string) {
  const doc = await loadBpmnDocument(XML, 'test.bpmn');
  expect(doc.report.mode).toBe('editable');
  const old = find(doc, id);
  const di = indexDi(doc.definitions).shapes.get(id);
  const shape = { id, type: old.$type, businessObject: old, di, incoming: [], outgoing: [] };
  const canvas = { getRootElements: () => [] } as unknown as Canvas;
  const handler = new ChangeTypeHandler(doc.moddle, doc.definitions, canvas);
  return { doc, old, shape, handler };
}

describe('ChangeTypeHandler', () => {
  it('moves sub-process content and re-points the boundary event and flows', async () => {
    const { doc, old, shape, handler } = await setup('Sub');
    const before = referrers(doc, old);
    const context = { element: shape as never, newType: 'bpmn:Transaction' };
    handler.execute(context);
    const next = shape.businessObject;
    expect(next.$type).toBe('bpmn:Transaction');

    expect(getMany(next, 'flowElements').map((e) => e.id)).toEqual(['Inner']);
    expect(find(doc, 'Inner').$parent).toBe(next);
    expect(getMany(next, 'documentation')[0]!.$parent).toBe(next);
    expect(referrers(doc, old)).toEqual([]);
    expect(referrers(doc, next)).toEqual(before);
    expect(getRef(find(doc, 'B'), 'attachedToRef')).toBe(next);

    // Exported XML is consistent: the inner task appears exactly once.
    const xml = await exportBpmnXml(doc);
    expect(xml.match(/id="Inner"/g)).toHaveLength(1);
    expect(xml).toMatch(/<bpmn:transaction id="Sub"/);

    handler.revert(context);
    expect(shape.businessObject).toBe(old);
    expect(find(doc, 'Inner').$parent).toBe(old);
    expect(referrers(doc, old)).toEqual(before);
    expect(referrers(doc, next)).toEqual([]);
  });

  it('moves data associations and re-points message flows and associations', async () => {
    const { doc, old, shape, handler } = await setup('Task');
    const before = referrers(doc, old);
    expect(before).toEqual(['A.sourceRef', 'F2.targetRef', 'MF.sourceRef', 'Task_di.bpmnElement']);
    const context = { element: shape as never, newType: 'bpmn:UserTask' };
    handler.execute(context);
    const next = shape.businessObject;

    expect(find(doc, 'DOA').$parent).toBe(next);
    expect(find(doc, 'Prop').$parent).toBe(next);
    expect(referrers(doc, next)).toEqual(before);
    expect(referrers(doc, old)).toEqual([]);
    await expect(exportBpmnXml(doc)).resolves.toMatch(/<bpmn:userTask id="Task"/);

    handler.revert(context);
    expect(find(doc, 'DOA').$parent).toBe(old);
    expect(referrers(doc, old)).toEqual(before);

    // Redo reuses the same new object.
    handler.execute(context);
    expect(shape.businessObject).toBe(next);
    expect(referrers(doc, next)).toEqual(before);
  });
});

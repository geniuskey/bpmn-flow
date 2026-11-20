// @vitest-environment jsdom
/**
 * Choreography and conversation notation (BPMN 2.0.2 Ch. 11, §9.4-9.5,
 * Tables 11.6-11.8, 12.31-12.34) on a real diagram-js editor: creating every
 * choreography activity variant, participant bands, band messages, two-way
 * tasks, boundary events on choreography activities, event restrictions and
 * conversation links.
 */
import { describe, expect, it } from 'vitest';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type { Shape } from 'diagram-js/lib/model/Types';
import { loadBpmnDocument } from '@/bpmn/document';
import { allowedEventDefinitionsIn } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { newChoreographyXml } from '@/bpmn/model/newDiagram';
import { analyze } from '@/analysis/analyze';
import { EditorController } from '@/editor/EditorController';
import { LIBRARY_ENTRIES } from '@/editor/library';
import { bandsOf, orderedBands } from '@/editor/modeling/choreography';
import {
  canAttach,
  canConnect,
  canLinkConversation,
  choreographyBoundaryFits,
} from '@/editor/interaction/BpmnFlowRules';
import { allowedTypeChanges } from '@/editor/modeling/replace';
import type { ShapePreset } from '@/editor/types';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

type Internals = { diagram: { get<T>(name: string): T } };

async function open(xml: string) {
  const doc = await loadBpmnDocument(xml);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  return { controller, doc, host };
}

function look(controller: EditorController, cx: number, cy: number) {
  const canvas = (controller as unknown as Internals).diagram.get<Canvas>('canvas');
  canvas.viewbox({ x: cx - 500, y: cy - 300, width: 1000, height: 600 });
}

function entry(id: string): ShapePreset {
  const found = LIBRARY_ENTRIES.find((e) => e.id === id);
  if (!found) throw new Error(`no library entry ${id}`);
  return found.preset;
}

function selected(controller: EditorController): Shape & { businessObject: ModdleElement } {
  const id = controller.getSnapshot().selection[0]!;
  return controller.getElement(id) as unknown as Shape & { businessObject: ModdleElement };
}

function shape(controller: EditorController, id: string) {
  return controller.getElement(id) as unknown as Shape & {
    businessObject: ModdleElement;
    di: ModdleElement;
  };
}

const participantNames = (el: Shape) =>
  orderedBands(bandsOf(el)).map((b) => getRef(b, 'bpmnElement')?.name);
const kinds = (el: Shape) =>
  orderedBands(bandsOf(el)).map((b) => b.get('participantBandKind') as string);

const roundTrip = async (controller: EditorController) => {
  const xml = await controller.exportXml();
  const again = await loadBpmnDocument(xml);
  expect(again.report.mode, JSON.stringify(again.report.issues)).toBe('editable');
  return xml;
};

describe('choreography activities', () => {
  it('creates sub-choreographies and call choreographies from the library', async () => {
    const { controller, doc, host } = await open(newChoreographyXml('c1'));
    look(controller, 300, 500);
    expect(
      controller.createInView('bpmn:SubChoreography', entry('sub-choreography-expanded')),
    ).toBe(true);
    const sub = selected(controller);
    expect(sub.di.get('isExpanded')).toBe(true);
    expect(bandsOf(sub)).toHaveLength(2);
    look(controller, 800, 500);
    expect(
      controller.createInView('bpmn:CallChoreography', entry('call-choreography-global-task')),
    ).toBe(true);
    const callTask = selected(controller).businessObject;
    expect(getRef(callTask, 'calledChoreographyRef')?.$type).toBe('bpmn:GlobalChoreographyTask');
    look(controller, 1100, 500);
    expect(controller.createInView('bpmn:CallChoreography', entry('call-choreography'))).toBe(true);
    const call = selected(controller).businessObject;
    const called = getRef(call, 'calledChoreographyRef')!;
    expect(called.$type).toBe('bpmn:Choreography');
    expect(getMany(doc.definitions, 'rootElements')).toContain(called);
    // The [+] marker is drawn only when a choreography is called (Fig 11.25).
    const gfx = (id: string) => host.querySelector(`[data-element-id="${id}"]`)?.innerHTML ?? '';
    expect(gfx(call.id!)).toContain('h12v12h-12z');
    expect(gfx(callTask.id!)).not.toContain('h12v12h-12z');
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:globalChoreographyTask id="[^"]+" \/>/);
    expect(xml).toMatch(/<bpmn:callChoreography id="[^"]+"[^>]* calledChoreographyRef="/);
    controller.undo();
    expect(getMany(doc.definitions, 'rootElements')).not.toContain(called);
  });

  it('changes type within the choreography family and keeps a task message flow', async () => {
    const { controller, doc } = await open(newChoreographyXml('c2'));
    const task = shape(controller, 'ChoreographyTask_1');
    expect(allowedTypeChanges(task)).toEqual(['bpmn:SubChoreography', 'bpmn:CallChoreography']);
    const choreography = getMany(doc.definitions, 'rootElements')[0]!;
    controller.changeType('ChoreographyTask_1', 'bpmn:SubChoreography');
    expect(shape(controller, 'ChoreographyTask_1').businessObject.$type).toBe(
      'bpmn:SubChoreography',
    );
    // The task's message flow is not referenced any more.
    expect(getMany(choreography, 'messageFlows')).toHaveLength(0);
    controller.changeType('ChoreographyTask_1', 'bpmn:ChoreographyTask');
    const back = shape(controller, 'ChoreographyTask_1').businessObject;
    const [flow] = getMany(back, 'messageFlowRef');
    expect(getRef(flow!, 'sourceRef')).toBe(getRef(back, 'initiatingParticipantRef'));
    controller.undo();
    controller.undo();
    expect(getMany(choreography, 'messageFlows')).toHaveLength(1);
    await roundTrip(controller);
  });

  it('edits the loop type', async () => {
    const { controller } = await open(newChoreographyXml('c3'));
    controller.updateProperties('ChoreographyTask_1', { loopType: 'MultiInstanceParallel' });
    expect(shape(controller, 'ChoreographyTask_1').businessObject.get('loopType')).toBe(
      'MultiInstanceParallel',
    );
    controller.updateProperties('ChoreographyTask_1', { loopType: 'Sometimes' });
    expect(shape(controller, 'ChoreographyTask_1').businessObject.get('loopType')).toBe(
      'MultiInstanceParallel',
    );
    const xml = await roundTrip(controller);
    expect(xml).toContain('loopType="MultiInstanceParallel"');
  });
});

describe('participant bands', () => {
  it('switches the initiator, moves bands and turns a one-way message around', async () => {
    const { controller } = await open(newChoreographyXml('b1'));
    const task = shape(controller, 'ChoreographyTask_1');
    const bo = task.businessObject;
    const [a, b] = getMany(bo, 'participantRef');
    controller.updateChoreographyBands(task.id, { op: 'initiator', participantId: b!.id! });
    expect(getRef(bo, 'initiatingParticipantRef')).toBe(b);
    expect(kinds(task)).toEqual(['top_non_initiating', 'bottom_initiating']);
    const [flow] = getMany(bo, 'messageFlowRef');
    expect(getRef(flow!, 'sourceRef')).toBe(b);
    expect(getRef(flow!, 'targetRef')).toBe(a);
    // The initiating band at the bottom (Table 12.33), then moved to the top.
    controller.updateChoreographyBands(task.id, { op: 'move', index: 1, to: 0 });
    expect(participantNames(task)).toEqual(['Supplier', 'Customer']);
    expect(kinds(task)).toEqual(['top_initiating', 'bottom_non_initiating']);
    controller.undo();
    controller.undo();
    expect(kinds(task)).toEqual(['top_initiating', 'bottom_non_initiating']);
    expect(getRef(flow!, 'sourceRef')).toBe(a);
    await roundTrip(controller);
  });

  it('adds participants to a sub-choreography alternately above and below (Fig 11.21)', async () => {
    const { controller } = await open(newChoreographyXml('b2'));
    look(controller, 300, 600);
    expect(controller.createInView('bpmn:SubChoreography', entry('sub-choreography'))).toBe(true);
    const sub = selected(controller);
    const height = sub.height;
    controller.updateChoreographyBands(sub.id, { op: 'add', newName: 'Shipper' });
    controller.updateChoreographyBands(sub.id, { op: 'add', newName: 'Bank' });
    expect(participantNames(sub)).toEqual(['Customer', 'Shipper', 'Bank', 'Supplier']);
    expect(kinds(sub)).toEqual([
      'top_initiating',
      'middle_non_initiating',
      'middle_non_initiating',
      'bottom_non_initiating',
    ]);
    // The upper section holds the first two bands, the lower one the last two.
    const ys = orderedBands(bandsOf(sub)).map((b) => getRef(b, 'bounds')!.get('y') as number);
    expect(ys[1]).toBe(sub.y + 20);
    expect(ys[2]).toBe(sub.y + sub.height - 40);
    expect(sub.height).toBeGreaterThan(height);
    // A choreography task has two participants.
    controller.updateChoreographyBands('ChoreographyTask_1', { op: 'add', newName: 'X' });
    expect(bandsOf(shape(controller, 'ChoreographyTask_1'))).toHaveLength(2);
    controller.updateChoreographyBands(sub.id, { op: 'remove', index: 1 });
    expect(participantNames(sub)).toEqual(['Customer', 'Bank', 'Supplier']);
    controller.undo();
    expect(participantNames(sub)).toEqual(['Customer', 'Shipper', 'Bank', 'Supplier']);
    const xml = await roundTrip(controller);
    expect(xml).toContain('participantBandKind="middle_non_initiating"');
    // Re-imported, the sections are read back from the band bounds.
    const again = await open(xml);
    expect(participantNames(shape(again.controller, sub.id))).toEqual([
      'Customer',
      'Shipper',
      'Bank',
      'Supplier',
    ]);
  });

  it('shows band messages and makes a two-way task', async () => {
    const { controller, doc, host } = await open(newChoreographyXml('b3'));
    const task = shape(controller, 'ChoreographyTask_1');
    const bo = task.businessObject;
    controller.updateChoreographyBands(task.id, { op: 'returnMessage', value: true });
    expect(getMany(bo, 'messageFlowRef')).toHaveLength(2);
    controller.updateChoreographyBands(task.id, {
      op: 'message',
      direction: 'return',
      name: 'Confirmation',
    });
    controller.updateChoreographyBands(task.id, { op: 'messageVisible', index: 0, value: true });
    controller.updateChoreographyBands(task.id, { op: 'messageVisible', index: 1, value: true });
    const gfx = host.querySelector(`[data-element-id="${task.id}"]`)!;
    expect(gfx.querySelectorAll('.bf-band-message')).toHaveLength(2);
    expect(gfx.querySelectorAll('.bf-band-message.bf-non-initiating')).toHaveLength(1);
    expect(gfx.textContent).toContain('Confirmation');
    const xml = await roundTrip(controller);
    expect(xml.match(/isMessageVisible="true"/g)).toHaveLength(2);
    controller.updateChoreographyBands(task.id, { op: 'returnMessage', value: false });
    expect(getMany(bo, 'messageFlowRef')).toHaveLength(1);
    const choreography = getMany(doc.definitions, 'rootElements').find((r) =>
      is(r, 'bpmn:Choreography'),
    )!;
    expect(getMany(choreography, 'messageFlows')).toHaveLength(1);
    controller.undo();
    expect(getMany(choreography, 'messageFlows')).toHaveLength(2);
  });

  it('marks a multi-instance participant on every band', async () => {
    const { controller } = await open(newChoreographyXml('b4'));
    controller.updateChoreographyBands('ChoreographyTask_1', {
      op: 'multiplicity',
      index: 1,
      value: true,
    });
    const task = shape(controller, 'ChoreographyTask_1');
    const p = getRef(orderedBands(bandsOf(task))[1]!, 'bpmnElement')!;
    expect(getRef(p, 'participantMultiplicity')).toBeDefined();
    controller.undo();
    expect(getRef(p, 'participantMultiplicity')).toBeUndefined();
  });
});

describe('events in choreographies (Tables 11.6-11.8)', () => {
  it('restricts triggers by position', async () => {
    const { doc } = await open(newChoreographyXml('e1'));
    const choreography = getMany(doc.definitions, 'rootElements')[0]!;
    const at = (type: string) => allowedEventDefinitionsIn(type, { container: choreography });
    expect(at('bpmn:StartEvent')).not.toContain('bpmn:MessageEventDefinition');
    expect(at('bpmn:StartEvent')).toContain('bpmn:TimerEventDefinition');
    expect(at('bpmn:IntermediateCatchEvent')).not.toContain('bpmn:MessageEventDefinition');
    expect(at('bpmn:IntermediateThrowEvent')).toEqual(['bpmn:LinkEventDefinition']);
    expect(at('bpmn:EndEvent')).toEqual(['bpmn:TerminateEventDefinition']);
  });

  it('creates only allowed events from the library', async () => {
    const { controller } = await open(newChoreographyXml('e2'));
    look(controller, 300, 500);
    expect(controller.createInView('bpmn:StartEvent', entry('start-message'))).toBe(false);
    expect(controller.createInView('bpmn:StartEvent', entry('start-timer'))).toBe(true);
    look(controller, 500, 500);
    expect(controller.createInView('bpmn:EndEvent', entry('end-message'))).toBe(false);
    expect(controller.createInView('bpmn:EndEvent', entry('end-terminate'))).toBe(true);
    look(controller, 700, 500);
    expect(controller.createInView('bpmn:IntermediateThrowEvent', entry('throw-signal'))).toBe(
      false,
    );
    expect(controller.createInView('bpmn:IntermediateCatchEvent', entry('catch-signal'))).toBe(
      true,
    );
  });

  it('attaches boundary events to choreography activities on the right band', async () => {
    const { controller, doc } = await open(newChoreographyXml('e3'));
    const task = shape(controller, 'ChoreographyTask_1');
    controller.select([task.id], false);
    expect(controller.createInView('bpmn:BoundaryEvent', entry('boundary-error'))).toBe(false);
    expect(controller.createInView('bpmn:BoundaryEvent', entry('boundary-message'))).toBe(true);
    const message = selected(controller);
    expect(getRef(message.businessObject, 'attachedToRef')).toBe(task.businessObject);
    // On the band of the receiving participant (the bottom band here).
    const center = { x: message.x + 18, y: message.y + 18 };
    expect(center.y).toBeGreaterThan(task.y + task.height - 20);
    controller.select([task.id], false);
    expect(controller.createInView('bpmn:BoundaryEvent', entry('boundary-signal'))).toBe(true);
    const signal = selected(controller);
    // Not on a participant band (Table 11.7).
    expect(signal.y + 18).toBeGreaterThan(task.y + 20);
    expect(signal.y + 18).toBeLessThan(task.y + task.height - 20);
    const probe = signal as unknown as Shape;
    expect(
      choreographyBoundaryFits(task, signal.businessObject, { x: task.x, y: task.y + 10 }),
    ).toBe(false);
    expect(canAttach([probe], task, { x: task.x, y: task.y + 50 })).toBe(true);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:boundaryEvent id="[^"]+" attachedToRef="ChoreographyTask_1">/);
    expect(getMany(doc.definitions, 'rootElements')).toHaveLength(1);
  });
});

describe('flows in choreographies', () => {
  it('allows conditions from choreography activities and choreography tasks after an event-based gateway', async () => {
    const { controller } = await open(newChoreographyXml('f1'));
    look(controller, 300, 500);
    controller.createInView('bpmn:EventBasedGateway', { type: 'bpmn:EventBasedGateway' });
    const gateway = selected(controller);
    const task = shape(controller, 'ChoreographyTask_1');
    look(controller, 700, 500);
    controller.createInView('bpmn:IntermediateCatchEvent', entry('catch-timer'));
    const timer = selected(controller);
    expect(canConnect(gateway, timer)).toBe(true);
    const flow = shape(controller, 'Flow_2');
    // The only outgoing flow of an activity cannot be conditional (BPMN 2.0.2 PDF 125).
    controller.updateCondition('Flow_2', 'amount > 100');
    expect(getRef(flow.businessObject, 'conditionExpression')).toBeUndefined();
    const modeling = (controller as unknown as Internals).diagram.get<{
      connect(a: unknown, b: unknown, attrs: unknown): unknown;
    }>('modeling');
    modeling.connect(task, timer, { type: 'bpmn:SequenceFlow' });
    controller.updateCondition('Flow_2', 'amount > 100');
    expect(getRef(flow.businessObject, 'conditionExpression')).toBeDefined();
    const end = shape(controller, 'EndEvent_1');
    expect(canConnect(gateway, end)).toBe(false);
    void task;
  });
});

describe('choreography analysis', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <bpmn:choreography id="C">
    <bpmn:participant id="A" name="A" /><bpmn:participant id="B" name="B" /><bpmn:participant id="X" name="X" />
    <bpmn:messageFlow id="M1" sourceRef="A" targetRef="B" />
    <bpmn:messageFlow id="M2" sourceRef="X" targetRef="B" />
    <bpmn:startEvent id="S"><bpmn:messageEventDefinition /></bpmn:startEvent>
    <bpmn:choreographyTask id="T1" initiatingParticipantRef="A">
      <bpmn:participantRef>A</bpmn:participantRef><bpmn:participantRef>B</bpmn:participantRef>
      <bpmn:messageFlowRef>M1</bpmn:messageFlowRef>
    </bpmn:choreographyTask>
    <bpmn:exclusiveGateway id="G" />
    <bpmn:choreographyTask id="T2" initiatingParticipantRef="X">
      <bpmn:participantRef>X</bpmn:participantRef><bpmn:participantRef>B</bpmn:participantRef>
      <bpmn:messageFlowRef>M2</bpmn:messageFlowRef>
    </bpmn:choreographyTask>
    <bpmn:endEvent id="E"><bpmn:signalEventDefinition /></bpmn:endEvent>
    <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="T1" />
    <bpmn:sequenceFlow id="F1" sourceRef="T1" targetRef="G" />
    <bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="T2" />
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="E" />
  </bpmn:choreography>
</bpmn:definitions>`;

  it('reports events a choreography does not use and initiators that were not involved before', async () => {
    const { definitions } = await loadBpmnDocument(XML);
    const findings = analyze(definitions).findings;
    const events = findings.filter((f) => f.ruleId === 'VAL-CHOREOGRAPHY-EVENT');
    expect(events.map((f) => f.elementIds[0]).sort()).toEqual(['E', 'S']);
    const initiator = findings.filter((f) => f.ruleId === 'VAL-CHOREOGRAPHY-INITIATOR');
    expect(initiator).toHaveLength(1);
    expect(initiator[0]!.elementIds).toEqual(['T2', 'T1']);
  });
});

describe('expanded sub-choreographies', () => {
  it('hold choreography content and draw their name at the top', async () => {
    const { controller, host } = await open(newChoreographyXml('s1'));
    look(controller, 400, 700);
    expect(
      controller.createInView('bpmn:SubChoreography', entry('sub-choreography-expanded')),
    ).toBe(true);
    const sub = selected(controller);
    controller.updateProperties(sub.id, { name: 'Shipping' });
    look(controller, sub.x + sub.width / 2, sub.y + sub.height / 2);
    expect(controller.createInView('bpmn:ChoreographyTask', entry('choreography-task'))).toBe(true);
    const inner = selected(controller);
    expect(inner.businessObject.$parent).toBe(sub.businessObject);
    expect(bandsOf(inner)).toHaveLength(2);
    // The name sits right under the top band (Fig 11.19), not in the middle.
    const label = [...host.querySelectorAll(`[data-element-id="${sub.id}"] text.bf-label`)].find(
      (t) => t.textContent === 'Shipping',
    )!;
    expect(label.getAttribute('transform')).toBe('translate(0, 20)');
    expect(label.querySelector('tspan')!.getAttribute('y')).not.toBe(String(sub.height / 2));
    await roundTrip(controller);
  });
});

describe('conversations', () => {
  const COLLAB = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:test">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="PA" name="Buyer" processRef="ProcA" />
    <bpmn:participant id="PB" name="Seller" />
    <bpmn:conversation id="Conv" name="Order" />
  </bpmn:collaboration>
  <bpmn:process id="ProcA" isExecutable="false">
    <bpmn:task id="TaskA" name="Order" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
    <bpmndi:BPMNShape id="PA_di" bpmnElement="PA" isHorizontal="true"><dc:Bounds x="100" y="100" width="600" height="200" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="TaskA_di" bpmnElement="TaskA"><dc:Bounds x="300" y="160" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="PB_di" bpmnElement="PB" isHorizontal="true"><dc:Bounds x="100" y="500" width="600" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Conv_di" bpmnElement="Conv"><dc:Bounds x="325" y="380" width="50" height="43" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  it('links conversations to activities in pools and keeps participantRefs in sync', async () => {
    const { controller } = await open(COLLAB);
    const conv = shape(controller, 'Conv');
    const taskA = shape(controller, 'TaskA');
    const pb = shape(controller, 'PB');
    expect(canLinkConversation(conv, taskA)).toBe(true);
    const modeling = (controller as unknown as Internals).diagram.get<{
      connect(a: Shape, b: Shape, attrs: { type: string }): Shape;
    }>('modeling');
    modeling.connect(conv, taskA, { type: 'bpmn:ConversationLink' });
    modeling.connect(conv, pb, { type: 'bpmn:ConversationLink' });
    const refs = () => getMany(conv.businessObject, 'participantRef').map((p) => p.id);
    expect(refs()).toEqual(['PA', 'PB']);
    controller.undo();
    expect(refs()).toEqual(['PA']);
    controller.undo();
    expect(refs()).toEqual([]);
    controller.redo();
    controller.redo();
    await roundTrip(controller);
    const findings = analyze((await loadBpmnDocument(COLLAB)).definitions).findings;
    expect(findings.some((f) => f.ruleId === 'VAL-CONVERSATION-PARTICIPANTS')).toBe(true);
  });

  it('draws a call conversation calling a collaboration with the [+] marker', async () => {
    const { controller, host } = await open(COLLAB);
    look(controller, 900, 400);
    expect(
      controller.createInView('bpmn:CallConversation', entry('call-conversation-collaboration')),
    ).toBe(true);
    const call = selected(controller);
    expect(getRef(call.businessObject, 'calledCollaborationRef')?.$type).toBe('bpmn:Collaboration');
    const gfx = host.querySelector(`[data-element-id="${call.id}"]`)!.innerHTML;
    expect(gfx).toContain('h10v10h-10z');
    await roundTrip(controller);
  });
});

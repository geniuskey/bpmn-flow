// @vitest-environment jsdom
/**
 * Data and swimlane modeling (BPMN 2.0.2 §10.4, §10.8, Ch. 12): data
 * associations with their Data Inputs / Outputs, data associations on events,
 * associations to flows, shared data objects, data states, collections,
 * vertical pools, nested lanes, participant multiplicity and lane partitions.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { analyze } from '@/analysis/analyze';
import { loadBpmnDocument } from '@/bpmn/document';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { LIBRARY_ENTRIES } from '@/editor/library';
import { dataAssociationType } from '@/editor/interaction/BpmnFlowRules';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="urn:test">`;

const shape = (id: string, x: number, y: number, w: number, h: number, extra = '') =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
const edge = (id: string, points: [number, number][]) =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${points
    .map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`)
    .join('')}</bpmndi:BPMNEdge>`;

const DATA_XML = `${HEAD}
  <bpmn:itemDefinition id="Item_orders" isCollection="false" />
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing><bpmn:messageEventDefinition id="Start_md" /></bpmn:startEvent>
    <bpmn:task id="A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:intermediateThrowEvent id="Throw"><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing><bpmn:messageEventDefinition id="Throw_md" /></bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    <bpmn:intermediateCatchEvent id="Catch"><bpmn:timerEventDefinition id="Catch_td" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="A" />
    <bpmn:sequenceFlow id="F2" sourceRef="A" targetRef="B" />
    <bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="Throw" />
    <bpmn:sequenceFlow id="F4" sourceRef="Throw" targetRef="End" />
    <bpmn:dataObject id="DO1" name="Order" itemSubjectRef="Item_orders" />
    <bpmn:dataObject id="DO2" name="Invoice" />
    <bpmn:dataObjectReference id="R1" name="Order" dataObjectRef="DO1" />
    <bpmn:dataObjectReference id="R2" name="Invoice" dataObjectRef="DO2" />
    <bpmn:dataStoreReference id="Store" name="DB" />
    <bpmn:subProcess id="Sub">
      <bpmn:task id="Inner" />
      <bpmn:dataObject id="DOS" />
      <bpmn:dataObjectReference id="RS" name="Local" dataObjectRef="DOS" />
    </bpmn:subProcess>
    <bpmn:textAnnotation id="Note"><bpmn:text>Check</bpmn:text></bpmn:textAnnotation>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    ${shape('Start', 100, 100, 36, 36)}
    ${shape('A', 200, 78, 100, 80)}
    ${shape('B', 400, 78, 100, 80)}
    ${shape('Throw', 600, 100, 36, 36)}
    ${shape('End', 700, 100, 36, 36)}
    ${shape('Catch', 100, 300, 36, 36)}
    ${shape('R1', 230, 300, 36, 50)}
    ${shape('R2', 430, 300, 36, 50)}
    ${shape('Store', 600, 300, 50, 50)}
    ${shape('Sub', 100, 450, 400, 200, ' isExpanded="true"')}
    ${shape('Inner', 150, 500, 100, 80)}
    ${shape('RS', 350, 520, 36, 50)}
    ${shape('Note', 300, 0, 100, 40)}
    ${edge('F1', [
      [136, 118],
      [200, 118],
    ])}
    ${edge('F2', [
      [300, 118],
      [400, 118],
    ])}
    ${edge('F3', [
      [500, 118],
      [600, 118],
    ])}
    ${edge('F4', [
      [636, 118],
      [700, 118],
    ])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const POOL_XML = `${HEAD}
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Pool" name="Shop" processRef="Proc" />
    <bpmn:participant id="Other" name="Customer" />
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Sales"><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Billing" />
    </bpmn:laneSet>
    <bpmn:task id="T1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
    ${shape('Pool', 0, 0, 600, 250, ' isHorizontal="true"')}
    ${shape('L1', 30, 0, 570, 125, ' isHorizontal="true"')}
    ${shape('L2', 30, 125, 570, 125, ' isHorizontal="true"')}
    ${shape('T1', 100, 20, 100, 80)}
    ${shape('Other', 0, 300, 600, 80, ' isHorizontal="true"')}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const EMPTY_PROCESS = `${HEAD}
  <bpmn:process id="Proc" isExecutable="false" />
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc" /></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

type Internals = { diagram: { get<T>(name: string): T } };

const open: EditorController[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.destroy();
});

async function setup(xml: string) {
  const doc = await loadBpmnDocument(xml, 'test.bpmn');
  expect(doc.report.mode).toBe('editable');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  const errors: unknown[] = [];
  controller.onCommandError((e) => errors.push(e));
  controller.open(doc);
  open.push(controller);
  const get = <T>(name: string) => (controller as unknown as Internals).diagram.get<T>(name);
  const el = <T extends Element = Shape>(id: string) => {
    const found = get<ElementRegistry>('elementRegistry').get(id);
    if (!found) throw new Error(`no element ${id}`);
    return found as T;
  };
  const bo = (id: string) =>
    (el(id) as unknown as { businessObject: ModdleElement }).businessObject;
  const modeling = get<Modeling>('modeling');
  const rules = get<Rules>('rules');
  const connect = (source: string, target: string) => {
    const allowed = rules.allowed('connection.create', { source: el(source), target: el(target) });
    if (!allowed) throw new Error(`cannot connect ${source} to ${target}`);
    return modeling.connect(el(source), el(target), allowed as never) as Connection;
  };
  return { doc, controller, errors, el, bo, modeling, rules, connect };
}

const SCHEMA = join(process.cwd(), 'tests/schema/BPMN20.xsd');

/** XSD errors of `xml`, or '' when it is valid or xmllint is not available. */
function xsdErrors(xml: string): string {
  if (!existsSync(SCHEMA)) return '';
  const file = join(mkdtempSync(join(tmpdir(), 'bpmn-flow-unit-')), 'out.bpmn');
  writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', SCHEMA, file], { stdio: 'pipe' });
    return '';
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr;
    return stderr ? stderr.toString() : '';
  }
}

/** The exported XML is schema-valid and opens editable again; it is returned. */
async function roundTrip(controller: EditorController): Promise<string> {
  const xml = await controller.exportXml();
  expect(xsdErrors(xml)).toBe('');
  const again = await loadBpmnDocument(xml, 'again.bpmn');
  // The analyzer reads every structure the editor writes.
  expect(() => analyze(again.definitions)).not.toThrow();
  expect(again.report.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  expect(again.report.mode).toBe('editable');
  return xml;
}

describe('data associations and their data inputs / outputs (PDF 251-254)', () => {
  it('targets a Data Input of the activity I/O specification, removed with the association', async () => {
    const { controller, bo, connect, errors, modeling } = await setup(DATA_XML);
    const flow = connect('R1', 'A');
    const assoc = (flow as unknown as { businessObject: ModdleElement }).businessObject;
    expect(assoc.$type).toBe('bpmn:DataInputAssociation');
    const io = getRef(bo('A'), 'ioSpecification')!;
    const input = getRef(assoc, 'targetRef')!;
    expect(input.$type).toBe('bpmn:DataInput');
    expect(input.name).toBe('Order');
    expect(getMany(io, 'dataInputs')).toEqual([input]);
    expect(getMany(getMany(io, 'inputSets')[0], 'dataInputRefs')).toEqual([input]);
    expect(getMany(io, 'outputSets')).toHaveLength(1);
    expect(getMany(assoc, 'sourceRef')).toEqual([bo('R1')]);
    expect(getMany(bo('A'), 'properties')).toHaveLength(0);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(
      /<bpmn:ioSpecification id="[^"]+">\s*<bpmn:dataInput id="([^"]+)" name="Order"/,
    );

    controller.undo();
    expect(getRef(bo('A'), 'ioSpecification')).toBeUndefined();
    controller.redo();
    expect(getRef(bo('A'), 'ioSpecification')).toBe(io);
    expect(getMany(io, 'dataInputs')).toEqual([input]);

    // A second association to the same activity adds a second input; deleting both removes the spec.
    const second = connect('R2', 'A');
    expect(getMany(io, 'dataInputs')).toHaveLength(2);
    modeling.removeElements([flow, second]);
    expect(getRef(bo('A'), 'ioSpecification')).toBeUndefined();
    controller.undo();
    expect(getMany(io, 'dataInputs')).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it('starts an output association at a Data Output of the activity', async () => {
    const { controller, bo, connect } = await setup(DATA_XML);
    const assoc = (connect('B', 'R2') as unknown as { businessObject: ModdleElement })
      .businessObject;
    expect(assoc.$type).toBe('bpmn:DataOutputAssociation');
    const output = getMany(assoc, 'sourceRef')[0]!;
    expect(output.$type).toBe('bpmn:DataOutput');
    const io = getRef(bo('B'), 'ioSpecification')!;
    expect(getMany(getMany(io, 'outputSets')[0], 'dataOutputRefs')).toEqual([output]);
    expect(getRef(assoc, 'targetRef')).toBe(bo('R2'));
    await roundTrip(controller);
  });

  it('connects catch events to data and data to throw events (PDF 254)', async () => {
    const { controller, bo, connect, el } = await setup(DATA_XML);
    const caught = (connect('Catch', 'R1') as unknown as { businessObject: ModdleElement })
      .businessObject;
    expect(caught.$type).toBe('bpmn:DataOutputAssociation');
    expect(getMany(bo('Catch'), 'dataOutputs')).toEqual([getMany(caught, 'sourceRef')[0]]);
    const thrown = (connect('R2', 'Throw') as unknown as { businessObject: ModdleElement })
      .businessObject;
    expect(thrown.$type).toBe('bpmn:DataInputAssociation');
    expect(getMany(bo('Throw'), 'dataInputs')).toEqual([getRef(thrown, 'targetRef')]);
    connect('Start', 'Store');
    connect('Store', 'End');
    // Data never flows into a catch event or out of a throw event.
    expect(dataAssociationType(el('R1'), el('Catch'))).toBeNull();
    expect(dataAssociationType(el('Throw'), el('R1'))).toBeNull();
    expect(dataAssociationType(el('R1'), el('Start'))).toBeNull();
    await roundTrip(controller);
  });

  it('only connects data objects visible from the activity (PDF 233)', async () => {
    const { el } = await setup(DATA_XML);
    // A data object of the sub-process is not visible from a task outside it.
    expect(dataAssociationType(el('RS'), el('A'))).toBeNull();
    expect(dataAssociationType(el('RS'), el('Inner'))).toBe('bpmn:DataInputAssociation');
    // A process data object is visible inside the sub-process.
    expect(dataAssociationType(el('R1'), el('Inner'))).toBe('bpmn:DataInputAssociation');
  });
});

describe('associations to sequence and message flows (PDF 95, 253)', () => {
  it('draws a data object and a text annotation to a sequence flow, editable after import', async () => {
    const { controller, connect, el, bo, modeling, errors } = await setup(DATA_XML);
    const fromData = connect('R1', 'F2');
    const fromNote = connect('Note', 'F2');
    for (const c of [fromData, fromNote]) {
      expect((c as unknown as { businessObject: ModdleElement }).businessObject.$type).toBe(
        'bpmn:Association',
      );
      expect(
        getRef((c as unknown as { businessObject: ModdleElement }).businessObject, 'targetRef'),
      ).toBe(bo('F2'));
      // Ends at the middle of the flow.
      expect(c.waypoints[c.waypoints.length - 1]).toEqual({ x: 350, y: 118 });
    }
    // The association follows the flow when it is re-routed.
    modeling.moveShape(el('B'), { x: 0, y: 100 });
    const end = fromData.waypoints[fromData.waypoints.length - 1]!;
    expect(end).not.toEqual({ x: 350, y: 118 });

    const xml = await roundTrip(controller);
    const again = await setup(xml);
    const imported = again.el<Connection>(
      (fromData as unknown as { businessObject: ModdleElement }).businessObject.id!,
    );
    expect((imported as { unsupported?: boolean }).unsupported).toBe(false);
    expect(imported.target).toBe(again.el('F2'));

    // Deleting the flow deletes the associations drawn to it, in one step.
    modeling.removeElements([el('F2')]);
    expect(fromData.parent).toBeFalsy();
    expect(fromNote.parent).toBeFalsy();
    controller.undo();
    expect(fromData.parent).toBeTruthy();
    expect(errors).toEqual([]);
  });

  it('links a data object to a sequence flow but not to an activity with a plain association', async () => {
    const { el, rules } = await setup(DATA_XML);
    expect(rules.allowed('connection.create', { source: el('Store'), target: el('F1') })).toEqual({
      type: 'bpmn:Association',
    });
    // Data to an activity is a data association, not an association.
    expect(rules.allowed('connection.create', { source: el('R1'), target: el('A') })).toEqual({
      type: 'bpmn:DataInputAssociation',
    });
  });
});

describe('data object references, states and collections', () => {
  it('points a reference at another data object of its scope and back to a new one', async () => {
    const { controller, bo, doc } = await setup(DATA_XML);
    const proc = getMany(doc.definitions, 'rootElements').find((r) => r.id === 'Proc');
    const dataObjects = () =>
      getMany(proc, 'flowElements')
        .filter((f) => is(f, 'bpmn:DataObject'))
        .map((d) => d.id);
    controller.updateElementDetail('R2', { kind: 'dataObject', id: 'DO1' });
    expect(getRef(bo('R2'), 'dataObjectRef')).toBe(bo('R1').get('dataObjectRef'));
    // Invoice is no longer shown by any reference: it goes; the reference takes the name.
    expect(dataObjects()).toEqual(['DO1']);
    expect(bo('R2').name).toBe('Order');
    controller.undo();
    expect(dataObjects()).toEqual(['DO1', 'DO2']);
    expect(bo('R2').name).toBe('Invoice');
    controller.redo();
    controller.updateElementDetail('R2', { kind: 'dataObject', id: null });
    expect(getRef(bo('R2'), 'dataObjectRef')).not.toBe(getRef(bo('R1'), 'dataObjectRef'));
    expect(dataObjects()).toHaveLength(2);
    // Data objects of another scope are not offered.
    const errors: unknown[] = [];
    controller.onCommandError((e) => errors.push(e));
    controller.updateElementDetail('R2', { kind: 'dataObject', id: 'DOS' });
    expect(errors).toHaveLength(1);
    await roundTrip(controller);
  });

  it('sets the data state of references and data inputs and draws it', async () => {
    const { controller, bo, el } = await setup(DATA_XML);
    controller.updateElementDetail('R1', { kind: 'dataState', name: 'approved' });
    expect(getRef(bo('R1'), 'dataState')?.name).toBe('approved');
    const gfx =
      (el('R1') as unknown as { id: string }) && document.querySelector('[data-element-id="R1"]');
    expect(gfx?.textContent).toContain('[approved]');
    controller.updateElementDetail('Store', { kind: 'dataState', name: 'locked' });
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:dataState id="[^"]+" name="approved" \/>/);
    controller.updateElementDetail('R1', { kind: 'dataState', name: '' });
    expect(getRef(bo('R1'), 'dataState')).toBeUndefined();
  });

  it('keeps the collection flag in step with the item definition (Table 10.49)', async () => {
    const { controller, bo, doc } = await setup(DATA_XML);
    const item = getMany(doc.definitions, 'rootElements').find((r) => r.id === 'Item_orders')!;
    controller.updateProperties('R1', { isCollection: true });
    expect(getRef(bo('R1'), 'dataObjectRef')?.get('isCollection')).toBe(true);
    expect(item.get('isCollection')).toBe(true);
    controller.undo();
    expect(item.get('isCollection')).toBe(false);
    // Without an item definition only the data object changes.
    controller.updateProperties('R2', { isCollection: true });
    expect(getRef(bo('R2'), 'dataObjectRef')?.get('isCollection')).toBe(true);
    await roundTrip(controller);
  });
});

describe('pools: multiplicity and vertical orientation (Table 12.26)', () => {
  it('edits the participant multiplicity of a pool', async () => {
    const { controller, bo, errors } = await setup(POOL_XML);
    controller.updateElementDetail('Pool', { kind: 'multiplicity', value: { minimum: 2 } });
    const m = getRef(bo('Pool'), 'participantMultiplicity')!;
    expect(m.get('minimum')).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(m, 'maximum')).toBe(false);
    controller.updateElementDetail('Pool', {
      kind: 'multiplicity',
      value: { minimum: 2, maximum: 5 },
    });
    expect(m.get('maximum')).toBe(5);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:participantMultiplicity minimum="2" maximum="5" \/>/);
    controller.updateElementDetail('Pool', {
      kind: 'multiplicity',
      value: { minimum: 3, maximum: 2 },
    });
    expect(errors).toHaveLength(1);
    controller.updateElementDetail('Pool', { kind: 'multiplicity', value: undefined });
    expect(getRef(bo('Pool'), 'participantMultiplicity')).toBeUndefined();
    controller.undo();
    expect(getRef(bo('Pool'), 'participantMultiplicity')).toBe(m);
  });

  it('creates a vertical pool and adds lanes side by side', async () => {
    const { controller, el, bo, errors } = await setup(EMPTY_PROCESS);
    const preset = LIBRARY_ENTRIES.find((e) => e.id === 'pool-vertical')!.preset;
    expect(controller.createInView(preset.type, preset)).toBe(true);
    const poolId = controller.getSnapshot().selection[0]!;
    const pool = el(poolId) as Shape & { di: ModdleElement };
    expect(pool.di.get('isHorizontal')).toBe(false);
    expect(pool.height).toBeGreaterThan(pool.width);
    const before = { ...pool };
    // A pool without lanes gets a lane over its area plus the new one.
    controller.addLane(poolId);
    const lanes = getMany(getMany(getRef(bo(poolId), 'processRef'), 'laneSets')[0], 'lanes');
    expect(lanes).toHaveLength(2);
    const [a, b] = lanes.map((l) => el(l.id!) as Shape & { di: ModdleElement });
    expect(a!.di.get('isHorizontal')).toBe(false);
    // Name band on top; lanes side by side, running the pool's length.
    expect(a!.y).toBe(pool.y + 30);
    expect(a!.height).toBe(pool.height - 30);
    expect(b!.x).toBe(a!.x + a!.width);
    expect(pool.width).toBe(before.width + 125);
    expect(pool.height).toBe(before.height);
    // A lane resizes at its right edge only.
    const rules = (controller as unknown as Internals).diagram.get<Rules>('rules');
    expect(
      rules.allowed('shape.resize', { shape: a, newBounds: { ...bounds(a!), width: 200 } }),
    ).toBe(true);
    expect(
      rules.allowed('shape.resize', { shape: a, newBounds: { ...bounds(a!), height: 200 } }),
    ).toBe(false);
    const modeling = (controller as unknown as Internals).diagram.get<Modeling>('modeling');
    const widthBefore = pool.width;
    modeling.resizeShape(a!, { ...bounds(a!), width: a!.width + 50 });
    expect(pool.width).toBe(widthBefore + 50);
    expect(b!.x).toBe(a!.x + a!.width);
    expect(errors).toEqual([]);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(
      /<bpmndi:BPMNShape id="[^"]+" bpmnElement="Lane_[^"]+" isHorizontal="false">/,
    );
  });
});

function bounds(s: Shape) {
  return { x: s.x, y: s.y, width: s.width, height: s.height };
}

describe('nested lanes (childLaneSet, PDF 334)', () => {
  it('divides a lane into sub-lanes, in one undo step', async () => {
    const { controller, el, bo, errors } = await setup(POOL_XML);
    const pool = el('Pool');
    controller.addLane('L1', true);
    const set = getRef(bo('L1'), 'childLaneSet')!;
    const subs = getMany(set, 'lanes');
    expect(subs).toHaveLength(2);
    const [s1, s2] = subs.map((l) => el(l.id!));
    // The first sub-lane covers the lane next to its name band; the second is added after it.
    expect(bounds(s1!)).toEqual({ x: 60, y: 0, width: 540, height: 125 });
    expect(bounds(s2!)).toEqual({ x: 60, y: 125, width: 540, height: 125 });
    expect(el('L1').height).toBe(250);
    expect(bounds(el('L2'))).toEqual({ x: 30, y: 250, width: 570, height: 125 });
    expect(pool.height).toBe(375);
    // The task stays in the lane and moves into the first sub-lane.
    expect(getMany(subs[0], 'flowNodeRef').map((n) => n.id)).toEqual(['T1']);
    expect(getMany(bo('L1'), 'flowNodeRef').map((n) => n.id)).toEqual(['T1']);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:lane id="L1" name="Sales">[\s\S]*<bpmn:childLaneSet id="[^"]+">/);

    controller.undo();
    expect(getRef(bo('L1'), 'childLaneSet')).toBeUndefined();
    expect(pool.height).toBe(250);
    expect(el('L1').height).toBe(125);
    controller.redo();
    expect(getMany(getRef(bo('L1'), 'childLaneSet'), 'lanes')).toHaveLength(2);

    // Adding after a sub-lane stays in the child lane set.
    controller.addLane(s2!.id);
    expect(getMany(set, 'lanes')).toHaveLength(3);
    expect(el('L1').height).toBe(375);
    expect(errors).toEqual([]);
  });

  it('resizes and deletes nested lanes keeping the stack closed', async () => {
    const { controller, el, bo, modeling, errors } = await setup(POOL_XML);
    controller.addLane('L1', true);
    const [s1, s2] = getMany(getRef(bo('L1'), 'childLaneSet'), 'lanes').map((l) => el(l.id!));
    // Growing the first sub-lane grows its lane and the pool, and moves what follows.
    modeling.resizeShape(s1!, { ...bounds(s1!), height: 175 });
    expect(s2!.y).toBe(175);
    expect(el('L1').height).toBe(300);
    expect(el('L2').y).toBe(300);
    expect(el('Pool').height).toBe(425);
    // Growing the pool at the bottom grows its last lane only.
    modeling.resizeShape(el('Pool'), { ...bounds(el('Pool')), height: 475 });
    expect(el('L2').height).toBe(175);
    expect(el('L1').height).toBe(300);
    // Deleting the second sub-lane closes the gap.
    modeling.removeElements([s2!]);
    expect(el('L1').height).toBe(175);
    expect(el('L2').y).toBe(175);
    expect(el('Pool').height).toBe(350);
    // Deleting the last sub-lane leaves the lane its area and drops the child lane set.
    modeling.removeElements([s1!]);
    expect(getRef(bo('L1'), 'childLaneSet')).toBeUndefined();
    expect(el('L1').height).toBe(175);
    expect(errors).toEqual([]);
    await roundTrip(controller);
  });

  it('deletes an empty lane together with its sub-lanes', async () => {
    const { controller, el, bo, modeling } = await setup(POOL_XML);
    controller.addLane('L2', true);
    const subs = getMany(getRef(bo('L2'), 'childLaneSet'), 'lanes').map((l) => el(l.id!));
    modeling.removeElements([el('L2')]);
    for (const s of subs) expect(s.parent).toBeFalsy();
    expect(el('Pool').height).toBe(125);
    controller.undo();
    for (const s of subs) expect(s.parent).toBeTruthy();
    expect(el('Pool').height).toBe(375);
  });

  it('sets the partition element of a lane (Table 10.135)', async () => {
    const { controller, bo, doc } = await setup(POOL_XML);
    const resources = () =>
      getMany(doc.definitions, 'rootElements').filter((r) => is(r, 'bpmn:Resource'));
    controller.updateElementDetail('L1', { kind: 'partition', name: 'Sales team' });
    controller.updateElementDetail('L2', { kind: 'partition', name: 'Sales team' });
    expect(resources()).toHaveLength(1);
    expect(getRef(bo('L2'), 'partitionElementRef')).toBe(resources()[0]);
    const xml = await roundTrip(controller);
    expect(xml).toMatch(/<bpmn:resource id="([^"]+)" name="Sales team" \/>/);
    expect(xml).toMatch(/<bpmn:lane id="L1" name="Sales" partitionElementRef="Resource_[^"]+">/);
    controller.updateElementDetail('L2', { kind: 'partition', name: '' });
    expect(getRef(bo('L2'), 'partitionElementRef')).toBeUndefined();
  });
});

const TWO_POOLS = `${HEAD}
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Main" name="Shop" processRef="PMain" />
    <bpmn:participant id="Partner" name="Bank" processRef="PPartner" />
    <bpmn:messageFlow id="M1" sourceRef="TA" targetRef="TB" />
  </bpmn:collaboration>
  <bpmn:process id="PMain" isExecutable="false">
    <bpmn:task id="TA"><bpmn:outgoing>SA</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="EA"><bpmn:incoming>SA</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="SA" sourceRef="TA" targetRef="EA" />
  </bpmn:process>
  <bpmn:process id="PPartner" isExecutable="false">
    <bpmn:task id="TB" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
    MAIN_SHAPE
    ${shape('TA', 100, 50, 100, 80)}
    ${shape('EA', 300, 72, 36, 36)}
    ${shape('Partner', 0, 300, 600, 200, ' isHorizontal="true"')}
    ${shape('TB', 100, 350, 100, 80)}
    ${edge('SA', [
      [200, 90],
      [300, 90],
    ])}
    ${edge('M1', [
      [150, 130],
      [150, 350],
    ])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('main pool without boundary (PDF 141-143, Fig 9.5)', () => {
  it('opens a collaboration whose main pool has no shape editable, its content on the diagram', async () => {
    const xml = TWO_POOLS.replace('MAIN_SHAPE', '');
    const { controller, el, rules, bo, connect, errors } = await setup(xml);
    expect(controller.boundlessPool()?.id).toBe('Main');
    expect(el('TA').parent?.parent).toBeUndefined(); // on the root
    // New content on the diagram goes into the main pool's process.
    expect(controller.createInView('bpmn:Task')).toBe(true);
    const task = bo(controller.getSnapshot().selection[0]!);
    expect(task.$parent?.id).toBe('PMain');
    // Message flows between the boundless pool and another pool, not within it.
    expect(rules.allowed('connection.create', { source: el('EA'), target: el('TB') })).toBe(false);
    expect(rules.allowed('connection.create', { source: el('TA'), target: el('TB') })).toEqual({
      type: 'bpmn:MessageFlow',
    });
    connect('TA', task.id!);
    expect(errors).toEqual([]);
    await roundTrip(controller);
  });

  it('hides and shows the boundary of the main pool in one undo step', async () => {
    const xml = TWO_POOLS.replace(
      'MAIN_SHAPE',
      shape('Main', 0, 0, 600, 250, ' isHorizontal="true"'),
    );
    const { controller, el, doc, errors } = await setup(xml);
    expect(controller.boundlessPool()).toBeUndefined();
    expect(el('TA').parent).toBe(el('Main'));
    controller.setPoolBoundary('Main', false);
    expect(errors).toEqual([]);
    expect(controller.getElement('Main')).toBeUndefined();
    expect(controller.boundlessPool()?.id).toBe('Main');
    expect(el('TA').parent?.parent).toBeUndefined();
    // Only one pool may be shown without boundary.
    expect(controller.poolBoundaryBlocker('Partner')).toMatch(/Another pool/);
    let out = await roundTrip(controller);
    expect(out).not.toContain('bpmnElement="Main"');
    // The semantic model is unchanged.
    expect(getMany(doc.definitions, 'rootElements').find((r) => r.id === 'PMain')).toBeTruthy();

    controller.undo();
    expect(el('TA').parent).toBe(el('Main'));
    controller.redo();
    controller.setPoolBoundary('Main', true);
    expect(el('TA').parent).toBe(el('Main'));
    expect(el('SA').parent).toBe(el('Main'));
    const main = el('Main');
    expect(main.x).toBeLessThan(100);
    expect(main.x + main.width).toBeGreaterThan(336);
    out = await roundTrip(controller);
    expect(out).toMatch(/<bpmndi:BPMNShape id="Main_di" bpmnElement="Main" isHorizontal="true">/);
    controller.undo();
    expect(controller.getElement('Main')).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it('keeps pools with lanes bounded', async () => {
    const { controller } = await setup(POOL_XML);
    expect(controller.poolBoundaryBlocker('Pool')).toMatch(/lanes/);
  });
});

const PROCESS_WITH_TASK = `${HEAD}
  <bpmn:process id="Proc" isExecutable="false"><bpmn:task id="T" /></bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    ${shape('T', 200, 100, 100, 80)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('lanes on a process diagram without pools (PDF 334)', () => {
  it('adds, resizes and deletes lanes directly in the process', async () => {
    const { controller, el, bo, modeling, errors } = await setup(PROCESS_WITH_TASK);
    controller.select([]);
    expect(controller.createInView('bpmn:Lane')).toBe(true);
    const laneSet = getMany(bo('T').$parent, 'laneSets')[0]!;
    const [first, second] = getMany(laneSet, 'lanes').map((l) => el(l.id!));
    expect(first!.parent).toBe(el('T').parent);
    // The first lane covers the content; the second follows it.
    expect(first!.x).toBeLessThan(200);
    expect(first!.y + first!.height).toBe(second!.y);
    expect(getMany(bo(first!.id), 'flowNodeRef').map((n) => n.id)).toEqual(['T']);
    // Moving the task into the second lane changes its lane.
    modeling.moveElements([el('T')], { x: 0, y: second!.y + 20 - el('T').y });
    expect(getMany(bo(second!.id), 'flowNodeRef').map((n) => n.id)).toEqual(['T']);
    // Growing the first lane moves the second one and its content.
    const y = second!.y;
    const taskY = el('T').y;
    modeling.resizeShape(first!, { ...bounds(first!), height: first!.height + 40 });
    expect(second!.y).toBe(y + 40);
    expect(el('T').y).toBe(taskY + 40);
    // No pool may wrap a process whose lanes are drawn on the diagram.
    expect(controller.createInView('bpmn:Participant')).toBe(false);
    await roundTrip(controller);
    controller.select([second!.id]);
    modeling.moveElements([el('T')], { x: 0, y: first!.y + 20 - el('T').y });
    modeling.removeElements([second!]);
    expect(second!.parent).toBeFalsy();
    expect(getMany(laneSet, 'lanes')).toHaveLength(1);
    expect(errors).toEqual([]);
    await roundTrip(controller);
  });
});

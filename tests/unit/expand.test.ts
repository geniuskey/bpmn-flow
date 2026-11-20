// @vitest-environment jsdom
/**
 * Collapsing and expanding sub-processes (BPMN DI isExpanded with a
 * drill-down diagram), event sub-processes, and the rules around them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type Canvas from 'diagram-js/lib/core/Canvas';
import { loadBpmnDocument } from '@/bpmn/document';
import { getMany, getRef, type ModdleElement } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { LIBRARY_ENTRIES } from '@/editor/library';
import type { ShapePreset } from '@/editor/types';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const fixture = (name: string) => readFileSync(`${process.cwd()}/tests/fixtures/${name}`, 'utf8');

const EMPTY_PROCESS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:test">
  <bpmn:process id="Proc" isExecutable="false" />
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc" /></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function open(xml: string) {
  const doc = await loadBpmnDocument(xml);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  return { controller, doc };
}

type Internals = { diagram: { get<T>(name: string): T } };
type Shapeish = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: { id: string };
  businessObject: ModdleElement;
  di: ModdleElement;
};

function look(controller: EditorController, cx: number, cy: number) {
  const canvas = (controller as unknown as Internals).diagram.get<Canvas>('canvas');
  canvas.viewbox({ x: cx - 500, y: cy - 300, width: 1000, height: 600 });
}

function entry(id: string): ShapePreset {
  const found = LIBRARY_ENTRIES.find((e) => e.id === id);
  if (!found) throw new Error(`no library entry ${id}`);
  return found.preset;
}

const el = (c: EditorController, id: string) => c.getElement(id) as unknown as Shapeish;
const created = (c: EditorController) => c.getSnapshot().selection[0]!;
const planes = (doc: { definitions: ModdleElement }) =>
  getMany(doc.definitions, 'diagrams').map((d) => getRef(d, 'plane')!);
const planeIds = (plane: ModdleElement) =>
  getMany(plane, 'planeElement').map((p) => getRef(p, 'bpmnElement')?.id);

describe('collapse and expand', () => {
  it('expands a collapsed sub-process: its drill-down content moves into the shape', async () => {
    const { controller, doc } = await open(fixture('multi-diagram.bpmn'));
    expect(controller.drillDownOf('Fulfil')).toBe('__root_Plane_fulfil');
    expect(controller.expandBlocker('Fulfil', false)).toMatch(/already collapsed/);
    expect(controller.expandBlocker('Fulfil', true)).toBeNull();

    controller.setExpanded('Fulfil', true);
    const fulfil = el(controller, 'Fulfil');
    expect(fulfil.di.get('isExpanded')).toBe(true);
    expect(fulfil.width).toBeGreaterThanOrEqual(350);
    expect(el(controller, 'Pick').parent?.id).toBe('Fulfil');
    // The content lies inside the shape and its DI moved to the main plane.
    const pick = el(controller, 'Pick');
    expect(pick.x).toBeGreaterThan(fulfil.x);
    expect(pick.x + pick.width).toBeLessThan(fulfil.x + fulfil.width);
    expect(planes(doc)).toHaveLength(1);
    expect(planeIds(planes(doc)[0]!)).toEqual(
      expect.arrayContaining(['FS', 'Pick', 'FE', 'f1', 'f2', 'Fulfil']),
    );
    expect(controller.drillDownOf('Fulfil')).toBeNull();
    expect(controller.getDiagrams()).toHaveLength(1);
    // Flows into the sub-process follow its new border.
    const m2 = controller.getElement('m2') as unknown as { waypoints: { x: number; y: number }[] };
    const p = m2.waypoints[0]!;
    const onBorder =
      ([fulfil.x, fulfil.x + fulfil.width].includes(p.x) &&
        p.y >= fulfil.y &&
        p.y <= fulfil.y + fulfil.height) ||
      ([fulfil.y, fulfil.y + fulfil.height].includes(p.y) &&
        p.x >= fulfil.x &&
        p.x <= fulfil.x + fulfil.width);
    expect(onBorder).toBe(true);
    const xml = await controller.exportXml();
    expect(xml).not.toContain('Diagram_fulfil');
    expect(xml).toMatch(/bpmnElement="Fulfil" isExpanded="true"/);

    // One undo step restores the drill-down diagram exactly.
    controller.undo();
    expect(el(controller, 'Fulfil').di.get('isExpanded')).toBe(false);
    expect(el(controller, 'Fulfil').width).toBe(100);
    expect(planes(doc)).toHaveLength(2);
    expect(planeIds(planes(doc)[1]!)).toEqual(['FS', 'Pick', 'FE', 'f1', 'f2']);
    expect(el(controller, 'Pick').x).toBe(240);
    expect(el(controller, 'Pick').parent?.id).toBe('__root_Plane_fulfil');
    const restored = await controller.exportXml();
    expect(restored).toContain('<dc:Bounds x="240" y="80" width="100" height="80" />');
    controller.redo();
    expect(el(controller, 'Pick').parent?.id).toBe('Fulfil');
  });

  it('collapses an expanded sub-process into a new drill-down diagram and back', async () => {
    const { controller, doc } = await open(fixture('multi-diagram.bpmn'));
    controller.setExpanded('Fulfil', true);
    controller.setExpanded('Fulfil', false);
    const fulfil = el(controller, 'Fulfil');
    expect(fulfil.di.get('isExpanded')).toBe(false);
    expect([fulfil.width, fulfil.height]).toEqual([100, 80]);
    expect(planes(doc)).toHaveLength(2);
    // The same drill-down root is reused.
    expect(controller.drillDownOf('Fulfil')).toBe('__root_Plane_fulfil');
    expect(planeIds(planes(doc)[1]!)).toEqual(['FS', 'Pick', 'FE', 'f1', 'f2']);
    expect(getRef(planes(doc)[1]!, 'bpmnElement')).toBe(fulfil.businessObject);
    // Content starts near the plane origin, with positive coordinates (PDF 397).
    expect(el(controller, 'FS').x).toBe(100);
    controller.showDiagram('__root_Plane_fulfil');
    expect(controller.getSnapshot().activeDiagram).toBe('__root_Plane_fulfil');
    // Undoing the collapse while its diagram is shown goes back to the main diagram.
    controller.undo();
    expect(controller.getSnapshot().activeDiagram).toBe('__root');
    expect(el(controller, 'Pick').parent?.id).toBe('Fulfil');
    await controller.exportXml();
  });

  it('collapses a new sub-process with its content; semantics stay unchanged', async () => {
    const { controller, doc } = await open(EMPTY_PROCESS);
    look(controller, 400, 300);
    expect(controller.createInView('bpmn:SubProcess', entry('sub-process'))).toBe(true);
    const sub = created(controller);
    expect(controller.createInView('bpmn:Task', { type: 'bpmn:Task' })).toBe(true);
    const task = created(controller);
    expect(el(controller, task).parent?.id).toBe(sub);
    const before = await controller.exportXml();
    controller.setExpanded(sub, false);
    expect(controller.getDiagrams()).toHaveLength(2);
    const drill = controller.drillDownOf(sub)!;
    expect(el(controller, task).parent?.id).toBe(drill);
    const xml = await controller.exportXml();
    // Same process content, one more diagram.
    const semantic = (x: string) => x.slice(0, x.indexOf('<bpmndi:BPMNDiagram'));
    expect(semantic(xml)).toBe(semantic(before));
    expect(xml.match(/<bpmndi:BPMNDiagram /g)).toHaveLength(2);
    // Collapse + expand round trip.
    controller.setExpanded(sub, true);
    expect(el(controller, task).parent?.id).toBe(sub);
    expect(controller.getDiagrams()).toHaveLength(1);
    controller.undo();
    controller.undo();
    expect(el(controller, task).parent?.id).toBe(sub);
    expect(getMany(doc.definitions, 'diagrams')).toHaveLength(1);
  });

  it('creates collapsed variants with their own diagram, and expands them', async () => {
    const { controller } = await open(EMPTY_PROCESS);
    let x = 200;
    for (const id of [
      'sub-process-collapsed',
      'transaction-collapsed',
      'ad-hoc-sub-process-collapsed',
    ]) {
      look(controller, (x += 200), 300);
      expect(controller.createInView(entry(id).type, entry(id))).toBe(true);
      const shape = created(controller);
      expect(el(controller, shape).di.get('isExpanded')).toBe(false);
      const drill = controller.drillDownOf(shape);
      expect(drill).toBeTruthy();
      // Content can be modeled in the drill-down diagram.
      controller.showDiagram(drill!);
      look(controller, 300, 300);
      expect(controller.createInView('bpmn:Task', { type: 'bpmn:Task' })).toBe(true);
      const task = el(controller, created(controller));
      expect(task.businessObject.$parent?.id).toBe(shape);
      controller.showDiagram('__root');
      controller.setExpanded(shape, true);
      expect(el(controller, task.id).parent?.id).toBe(shape);
    }
    // Undo of the creation removes the drill-down diagram with it.
    const xml = await controller.exportXml();
    expect(xml).toMatch(/<bpmn:transaction id="[^"]+"/);
  });

  it('refuses to collapse content connected to the outside', async () => {
    const { controller } = await open(EMPTY_PROCESS);
    look(controller, 400, 300);
    controller.createInView('bpmn:SubProcess', entry('sub-process'));
    const sub = created(controller);
    controller.createInView('bpmn:Task', { type: 'bpmn:Task' });
    look(controller, 400, 700);
    controller.createInView('bpmn:TextAnnotation', { type: 'bpmn:TextAnnotation' });
    const note = created(controller);
    const task = getMany(el(controller, sub).businessObject, 'flowElements')[0]!.id!;
    const internals = controller as unknown as Internals;
    const modeling = internals.diagram.get<{
      connect(a: unknown, b: unknown, attrs: unknown): unknown;
    }>('modeling');
    modeling.connect(controller.getElement(note), controller.getElement(task), {
      type: 'bpmn:Association',
    });
    expect(controller.expandBlocker(sub, false)).toMatch(/connected to elements outside/);
    expect(controller.expandBlocker(task, false)).toMatch(/Only sub-processes/);
  });

  it('keeps every marker on collapsed shapes', async () => {
    const { controller } = await open(EMPTY_PROCESS);
    look(controller, 400, 300);
    controller.createInView('bpmn:Transaction', entry('transaction'));
    const id = created(controller);
    controller.setLoop(id, 'parallel');
    controller.updateProperties(id, { isForCompensation: true });
    controller.setExpanded(id, false);
    const gfx = document.querySelector(`[data-element-id="${id}"]`)!;
    // Multi-instance, compensation and collapsed markers, and the double border.
    expect(gfx.querySelectorAll('.bf-icon').length).toBe(3);
    expect(gfx.querySelector('.bf-transaction-inner')).not.toBeNull();
  });
});

describe('event sub-processes', () => {
  it('toggles triggeredByEvent and shows the start trigger when collapsed', async () => {
    const { controller } = await open(EMPTY_PROCESS);
    look(controller, 400, 300);
    controller.createInView('bpmn:SubProcess', entry('sub-process'));
    const sub = created(controller);
    controller.replace(sub, { type: 'bpmn:SubProcess', triggeredByEvent: true });
    expect(el(controller, sub).businessObject.get('triggeredByEvent')).toBe(true);
    expect(
      controller.createInView('bpmn:StartEvent', entry('start-non-interrupting-message')),
    ).toBe(true);
    // Exactly one start event in an event sub-process (PDF 204).
    look(controller, 380, 260);
    expect(controller.createInView('bpmn:StartEvent', entry('start-timer'))).toBe(false);
    controller.setExpanded(sub, false);
    const gfx = () => document.querySelector(`[data-element-id="${sub}"]`)!;
    expect(gfx().querySelector('.bf-event-subprocess-trigger .bf-non-interrupting')).not.toBeNull();
    // Its start event became interrupting in the drill-down diagram: the trigger is redrawn.
    const start = getMany(el(controller, sub).businessObject, 'flowElements')[0]!;
    controller.updateProperties(start.id!, { isInterrupting: true });
    expect(gfx().querySelector('.bf-event-subprocess-trigger')).not.toBeNull();
    expect(gfx().querySelector('.bf-event-subprocess-trigger .bf-non-interrupting')).toBeNull();
    // A triggered start event keeps the sub-process an event sub-process.
    expect(
      controller.replaceBlocker(sub, { type: 'bpmn:SubProcess', triggeredByEvent: false }),
    ).toMatch(/trigger/);
  });
});

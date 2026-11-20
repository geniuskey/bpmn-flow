// @vitest-environment jsdom
/** Align and distribute on a real diagram-js editor: geometry, rules, lanes and undo. */
import { describe, expect, it } from 'vitest';
import type { Shape } from 'diagram-js/lib/model/Types';
import { loadBpmnDocument } from '@/bpmn/document';
import { getMany } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const shape = (id: string, x: number, y: number, w = 100, h = 80) =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:test">
  <bpmn:collaboration id="Collab"><bpmn:participant id="Pool" processRef="Proc" /></bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="LaneA"><bpmn:flowNodeRef>A</bpmn:flowNodeRef><bpmn:flowNodeRef>B</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="LaneB"><bpmn:flowNodeRef>C</bpmn:flowNodeRef><bpmn:flowNodeRef>Boundary</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="A" />
    <bpmn:task id="B" />
    <bpmn:task id="C" />
    <bpmn:boundaryEvent id="Boundary" attachedToRef="C" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
    ${shape('Pool', 0, 0, 900, 400)}
    ${shape('LaneA', 30, 0, 870, 200)}
    ${shape('LaneB', 30, 200, 870, 200)}
    ${shape('A', 100, 40)}
    ${shape('B', 300, 70)}
    ${shape('C', 700, 260)}
    ${shape('Boundary', 732, 322, 36, 36)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function open() {
  const doc = await loadBpmnDocument(XML);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  const get = (id: string) => controller.getElement(id) as Shape;
  const laneOf = (id: string) =>
    ['LaneA', 'LaneB'].find((l) =>
      getMany(get(l).businessObject, 'flowNodeRef').some((n) => n.id === id),
    );
  return { controller, get, laneOf };
}

describe('align and distribute', () => {
  it('counts only shapes that can be arranged (no lanes, boundary events, pool content)', async () => {
    const { controller } = await open();
    controller.select(['A', 'LaneA', 'Boundary']);
    expect(controller.arrangeableCount()).toBe(1);
    controller.select(['Pool', 'A']);
    expect(controller.arrangeableCount()).toBe(1); // A moves with its pool
    controller.select(['A', 'B', 'C']);
    expect(controller.arrangeableCount()).toBe(3);
  });

  it('aligns top as one undo step and keeps lanes and boundary events in sync', async () => {
    const { controller, get, laneOf } = await open();
    controller.select(['A', 'B', 'C']);
    expect(controller.alignSelection('top')).toBe(2);
    expect([get('A').y, get('B').y, get('C').y]).toEqual([40, 40, 40]);
    // C moved out of lane B into lane A; its boundary event came along.
    expect(laneOf('C')).toBe('LaneA');
    expect(get('Boundary').y).toBe(102);
    controller.undo();
    expect([get('A').y, get('B').y, get('C').y]).toEqual([40, 70, 260]);
    expect(laneOf('C')).toBe('LaneB');
    expect(get('Boundary').y).toBe(322);
  });

  it('aligns centers on the middle of the common bounds', async () => {
    const { controller, get } = await open();
    controller.select(['A', 'C']);
    controller.alignSelection('center');
    // Range 100..800 → center 450.
    expect(get('A').x + 50).toBe(450);
    expect(get('C').x + 50).toBe(450);
  });

  it('distributes with equal gaps, keeping the outer shapes in place', async () => {
    const { controller, get } = await open();
    controller.select(['A', 'B', 'C']);
    controller.distributeSelection('horizontal');
    // Span 100..800 holds 300 of shapes → two gaps of 200.
    expect([get('A').x, get('B').x, get('C').x]).toEqual([100, 400, 700]);
  });

  it('needs two shapes to align and three to distribute', async () => {
    const { controller } = await open();
    controller.select(['A', 'B']);
    expect(controller.distributeSelection('horizontal')).toBe(0);
    controller.select(['A']);
    expect(controller.alignSelection('left')).toBe(0);
  });
});

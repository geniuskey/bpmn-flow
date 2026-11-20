// @vitest-environment jsdom
/**
 * DI color extensions (`color:*` OMG non-normative, `bioc:*` bpmn.io): read
 * from BPMNShape / BPMNEdge / BPMNLabel and rendered per element.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBpmnDocument } from '@/bpmn/document';
import { indexDi, isCssColor, readDiColors } from '@/bpmn/di/di';
import { EditorController } from '@/editor/EditorController';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const fixture = (name: string) => readFileSync(`${process.cwd()}/tests/fixtures/${name}`, 'utf8');

const xml = (
  nsDecls: string,
  taskDi: string,
  flowDi = '',
  labelDi = '',
) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ${nsDecls} id="Defs" targetNamespace="urn:test">
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:startEvent id="S" name="Start" />
    <bpmn:task id="T" name="Do" />
    <bpmn:sequenceFlow id="F" name="go" sourceRef="S" targetRef="T" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    <bpmndi:BPMNShape id="S_di" bpmnElement="S" ${labelDi}><dc:Bounds x="100" y="100" width="36" height="36" /><bpmndi:BPMNLabel /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T_di" bpmnElement="T" ${taskDi}><dc:Bounds x="200" y="78" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_di" bpmnElement="F" ${flowDi}><di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const COLOR = 'xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"';
const BIOC = 'xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0"';

async function colorsOf(source: string, id: string) {
  const doc = await loadBpmnDocument(source);
  const index = indexDi(doc.definitions);
  return readDiColors(index.shapes.get(id) ?? index.edges.get(id));
}

describe('readDiColors', () => {
  it('reads color:* and bioc:*, preferring the OMG attributes', async () => {
    const both = xml(
      `${COLOR} ${BIOC}`,
      'bioc:fill="#ffcdd2" bioc:stroke="#831311" color:background-color="#bbdefb" color:border-color="#0d4372"',
    );
    expect(await colorsOf(both, 'T')).toEqual({ fill: '#bbdefb', stroke: '#0d4372' });
    const bioc = xml(BIOC, 'bioc:fill="#ffcdd2" bioc:stroke="#831311"');
    expect(await colorsOf(bioc, 'T')).toEqual({ fill: '#ffcdd2', stroke: '#831311' });
  });

  it('resolves any prefix bound to the color namespaces', async () => {
    const custom = xml(
      'xmlns:c="http://www.omg.org/spec/BPMN/non-normative/color/1.0"',
      'c:background-color="rgb(200, 230, 201)"',
    );
    expect(await colorsOf(custom, 'T')).toEqual({ fill: 'rgb(200, 230, 201)' });
    // The same local names in another namespace are not colors.
    const other = xml('xmlns:bioc="urn:something-else"', 'bioc:fill="#ffcdd2"');
    expect(await colorsOf(other, 'T')).toBeUndefined();
    // Edges carry bioc:fill / bioc:stroke and color:border-color.
    const flow = xml(`${COLOR} ${BIOC}`, '', 'bioc:stroke="#831311" color:border-color="#0d4372"');
    expect(await colorsOf(flow, 'F')).toEqual({ stroke: '#0d4372' });
  });

  it('reads the label color from BPMNLabel and ignores non-color values', async () => {
    const label = xml(COLOR, '', '', 'color:border-color="red"').replace(
      '<bpmndi:BPMNLabel />',
      '<bpmndi:BPMNLabel color:color="#205022" />',
    );
    expect(await colorsOf(label, 'S')).toEqual({ stroke: 'red', label: '#205022' });
    const unsafe = xml(COLOR, 'color:background-color="red; background: url(x)"');
    expect(await colorsOf(unsafe, 'T')).toBeUndefined();
    expect(isCssColor('#abc')).toBe(true);
    expect(isCssColor('hsl(120 50% 40% / 0.5)')).toBe(true);
    expect(isCssColor('url(#x)')).toBe(false);
    expect(isCssColor('var(--x)')).toBe(false);
  });
});

describe('rendering DI colors', () => {
  async function render(source: string) {
    const doc = await loadBpmnDocument(source);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = new EditorController(host);
    controller.open(doc);
    const visual = (id: string) =>
      host.querySelector<SVGGElement>(`[data-element-id="${id}"] .djs-visual`)!;
    return { visual };
  }

  it('overrides the theme variables on the colored element only', async () => {
    const { visual } = await render(
      xml(`${COLOR} ${BIOC}`, 'bioc:fill="#ffcdd2" bioc:stroke="#831311"', 'bioc:stroke="#205022"'),
    );
    const task = visual('T');
    expect(task.style.getPropertyValue('--bf-activity-fill')).toBe('#ffcdd2');
    expect(task.style.getPropertyValue('--bf-shape-stroke')).toBe('#831311');
    expect(task.style.getPropertyValue('--bf-di-text')).toBe('#831311');
    expect(task.classList.contains('bf-di-fill')).toBe(true);

    const flow = visual('F');
    expect(flow.style.getPropertyValue('--bf-connection')).toBe('#205022');
    expect(flow.style.getPropertyValue('--bf-di-label')).toBe('');

    const start = visual('S');
    expect(start.getAttribute('style') ?? '').toBe('');
    expect(start.classList.contains('bf-di-fill')).toBe(false);
  });

  it('renders the colors of a Camunda Modeler export', async () => {
    const { visual } = await render(fixture('vendor-camunda-style.bpmn'));
    const start = visual('StartEvent_1');
    expect(start.style.getPropertyValue('--bf-shape-fill')).toBe('#c8e6c9');
    expect(start.style.getPropertyValue('--bf-event-start')).toBe('#205022');
    expect(visual('Flow_yes').style.getPropertyValue('--bf-connection')).toBe('#205022');
  });
});

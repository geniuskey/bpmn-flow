// @vitest-environment jsdom
/**
 * Renderer notation checks against BPMN 2.0.2 figures, plus the DI attributes
 * the renderer honours (labels, label styles, edge ends, marker visibility).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '@/analysis/analyze';
import { loadBpmnDocument } from '@/bpmn/document';
import { allowedEventDefinitions } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { isMultiParticipant } from '@/editor/renderer/shapes';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const NS = `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="urn:test"`;

const shape = (id: string, x: number, y: number, w: number, h: number, extra = '', inner = '') =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" ${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" />${inner}</bpmndi:BPMNShape>`;

const edge = (id: string, pts: [number, number][], extra = '') =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}" ${extra}>${pts
    .map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`)
    .join('')}</bpmndi:BPMNEdge>`;

const processXml = (content: string, di: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:process id="Proc" isExecutable="false">${content}</bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">${di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function open(xml: string) {
  const doc = await loadBpmnDocument(xml);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  return { controller, doc, host };
}

const gfx = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-element-id="${id}"] .djs-visual`)!;

type Internals = { diagram: { get<T>(name: string): T } };

describe('participant multiplicity marker (PDF 147)', () => {
  const participant = async (attrs: string | null) => {
    const multiplicity = attrs === null ? '' : `<bpmn:participantMultiplicity ${attrs} />`;
    const doc = await loadBpmnDocument(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}><bpmn:collaboration id="C"><bpmn:participant id="P">${multiplicity}</bpmn:participant></bpmn:collaboration></bpmn:definitions>`);
    const collaboration = getMany(doc.definitions, 'rootElements')[0]!;
    return getMany(collaboration, 'participants')[0]!;
  };

  it('is shown when the maximum is not set or two or more', async () => {
    expect(isMultiParticipant(await participant(null))).toBe(false);
    expect(isMultiParticipant(await participant(''))).toBe(true);
    expect(isMultiParticipant(await participant('minimum="2"'))).toBe(true);
    expect(isMultiParticipant(await participant('maximum="1"'))).toBe(false);
    expect(isMultiParticipant(await participant('maximum="2"'))).toBe(true);
  });

  it('reports a maximum below the minimum (Table 9.5)', async () => {
    const doc = await loadBpmnDocument(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}><bpmn:collaboration id="C">
  <bpmn:participant id="P" name="Buyers"><bpmn:participantMultiplicity minimum="3" maximum="2" /></bpmn:participant>
  <bpmn:participant id="Q" name="Sellers"><bpmn:participantMultiplicity minimum="1" maximum="4" /></bpmn:participant>
</bpmn:collaboration></bpmn:definitions>`);
    const findings = analyze(doc.definitions).findings.filter(
      (f) => f.ruleId === 'VAL-PARTICIPANT-MULTIPLICITY',
    );
    expect(findings.map((f) => f.elementIds[0])).toEqual(['P']);
    expect(findings[0]!.message).toMatch(/maximum 2 is below minimum 3/);
  });
});

describe('notation', () => {
  it('draws a lane divider only for lanes with sub-lanes (PDF 334)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="Proc" /></bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Plain" />
      <bpmn:lane id="Parent"><bpmn:childLaneSet id="CLS"><bpmn:lane id="Child" /></bpmn:childLaneSet></bpmn:lane>
    </bpmn:laneSet>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">
    ${shape('Pool', 0, 0, 600, 400, 'isHorizontal="true"')}
    ${shape('Plain', 30, 0, 570, 200, 'isHorizontal="true"')}
    ${shape('Parent', 30, 200, 570, 200, 'isHorizontal="true"')}
    ${shape('Child', 60, 200, 540, 200, 'isHorizontal="true"')}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { host } = await open(xml);
    expect(gfx(host, 'Pool').querySelector('.bf-pool-divider')).not.toBeNull();
    expect(gfx(host, 'Plain').querySelector('.bf-pool-divider')).toBeNull();
    expect(gfx(host, 'Parent').querySelector('.bf-pool-divider')).not.toBeNull();
    expect(gfx(host, 'Child').querySelector('.bf-pool-divider')).toBeNull();
  });

  it('draws a timer as a clock face with hour ticks, and the cancel X outlined when caught', async () => {
    const xml = processXml(
      `<bpmn:intermediateCatchEvent id="Timer"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
       <bpmn:transaction id="Tx" />
       <bpmn:boundaryEvent id="Catch" attachedToRef="Tx"><bpmn:cancelEventDefinition /></bpmn:boundaryEvent>`,
      `${shape('Timer', 100, 100, 36, 36)}${shape('Tx', 200, 60, 200, 120, 'isExpanded="true"')}${shape('Catch', 280, 162, 36, 36)}`,
    );
    const { host } = await open(xml);
    const ticks = gfx(host, 'Timer').querySelector('.bf-timer-tick')!.getAttribute('d')!;
    expect(ticks.match(/M/g)).toHaveLength(12);
    const cancel = gfx(host, 'Catch');
    expect(cancel.querySelector('.bf-event-marker-filled')).toBeNull();
    expect(cancel.querySelector('path.bf-event-marker')!.getAttribute('d')).toMatch(/z$/);
  });

  it('shows and edits a catching escalation intermediate event (Table 12.22) without offering it', async () => {
    const xml = processXml(
      `<bpmn:intermediateCatchEvent id="Esc"><bpmn:escalationEventDefinition /></bpmn:intermediateCatchEvent>`,
      shape('Esc', 100, 100, 36, 36),
    );
    const { controller, doc, host } = await open(xml);
    expect(doc.report.mode).toBe('editable');
    expect(gfx(host, 'Esc').querySelector('.bf-unsupported')).toBeNull();
    expect(gfx(host, 'Esc').querySelector('path.bf-event-marker')).not.toBeNull();
    const bo = (controller.getElement('Esc') as { businessObject: ModdleElement }).businessObject;
    expect(allowedEventDefinitions(bo)).not.toContain('bpmn:EscalationEventDefinition');
  });

  it('draws a bpmn:DataObject shape as a data object and a Message shape as an envelope', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:message id="Order" name="Order" />
  <bpmn:message id="Confirmation" name="Confirmation" />
  <bpmn:collaboration id="C">
    <bpmn:participant id="Customer" /><bpmn:participant id="Supplier" />
    <bpmn:messageFlow id="M1" sourceRef="Customer" targetRef="Supplier" messageRef="Order" />
    <bpmn:messageFlow id="M2" sourceRef="Supplier" targetRef="Customer" />
    <bpmn:association id="A" sourceRef="Confirmation" targetRef="M2" />
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false"><bpmn:dataObject id="DO" name="Invoice" /></bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">
    ${shape('Customer', 0, 0, 400, 60)}
    ${shape('Supplier', 0, 300, 400, 60)}
    ${edge('M1', [
      [100, 60],
      [100, 300],
    ])}
    ${edge(
      'M2',
      [
        [250, 300],
        [250, 60],
      ],
      'messageVisibleKind="non_initiating"',
    )}
    ${shape('Order', 60, 150, 30, 20)}
    ${shape('Confirmation', 300, 150, 30, 20)}
    ${edge('A', [
      [300, 160],
      [250, 160],
    ])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="D2"><bpmndi:BPMNPlane id="Plane2" bpmnElement="Proc">
    ${shape('DO', 100, 100, 36, 50)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { controller, doc, host } = await open(xml);
    expect(doc.report.mode).toBe('editable');
    const order = gfx(host, 'Order');
    expect(order.querySelector('.bf-message-shape .bf-envelope-flap')).not.toBeNull();
    expect(order.querySelector('.bf-non-initiating')).toBeNull();
    expect(order.querySelector('.bf-caption')).toBeNull();
    // Associated with a non-initiating message flow: shaded (Fig 8.27 / 8.28).
    expect(gfx(host, 'Confirmation').querySelector('.bf-non-initiating')).not.toBeNull();
    // The association ends at the message flow.
    const association = controller.getElement('A') as { target?: { id: string } };
    expect(association.target?.id).toBe('M2');

    controller.showDiagram(controller.getDiagrams()[1]!.rootId);
    const dataObject = gfx(host, 'DO');
    expect(dataObject.querySelector('.bf-data')).not.toBeNull();
    expect(dataObject.querySelector('.bf-caption')).toBeNull();
  });

  it('removes an association drawn to a message flow with that flow', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:message id="Msg" name="Order" />
  <bpmn:collaboration id="C">
    <bpmn:participant id="P1" /><bpmn:participant id="P2" />
    <bpmn:messageFlow id="M" sourceRef="P1" targetRef="P2" />
    <bpmn:association id="A" sourceRef="Msg" targetRef="M" />
  </bpmn:collaboration>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">
    ${shape('P1', 0, 0, 400, 60)}${shape('P2', 0, 300, 400, 60)}
    ${edge('A', [
      [300, 160],
      [100, 160],
    ])}
    ${edge('M', [
      [100, 60],
      [100, 300],
    ])}
    ${shape('Msg', 300, 150, 30, 20)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { controller, doc } = await open(xml);
    expect(controller.getElement('A')).toBeDefined();
    controller.select(['M']);
    controller.deleteSelection();
    expect(controller.getElement('A')).toBeUndefined();
    const collaboration = getMany(doc.definitions, 'rootElements').find((r) =>
      is(r, 'bpmn:Collaboration'),
    )!;
    expect(getMany(collaboration, 'artifacts')).toHaveLength(0);
    controller.undo();
    expect(getMany(collaboration, 'artifacts')).toHaveLength(1);
    expect((controller.getElement('A') as { target?: { id: string } }).target?.id).toBe('M');
  });

  it('shows the message name beside the envelope of a message flow (Fig 8.28)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:message id="Msg" name="Order" />
  <bpmn:collaboration id="C">
    <bpmn:participant id="P1" /><bpmn:participant id="P2" />
    <bpmn:messageFlow id="M" sourceRef="P1" targetRef="P2" messageRef="Msg" />
  </bpmn:collaboration>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">
    ${shape('P1', 0, 0, 400, 60)}${shape('P2', 0, 300, 400, 60)}
    ${edge(
      'M',
      [
        [100, 60],
        [100, 300],
      ],
      'messageVisibleKind="initiating"',
    )}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { host } = await open(xml);
    expect(gfx(host, 'M').querySelector('.bf-message-name')?.textContent).toBe('Order');
  });

  it('never draws unsupported elements dashed (PDF 38, 70)', async () => {
    const css = readFileSync(`${process.cwd()}/src/styles/canvas.css`, 'utf8');
    const rule = (selector: string) =>
      css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    expect(rule('.bf-unsupported')).not.toMatch(/dasharray/);
    expect(rule('.bf-connection.bf-unsupported')).not.toMatch(/dasharray/);
    const xml = processXml(
      // A trigger a catch event cannot have (Table 10.89): unsupported.
      `<bpmn:intermediateCatchEvent id="Odd"><bpmn:terminateEventDefinition /></bpmn:intermediateCatchEvent>`,
      shape('Odd', 100, 100, 36, 36),
    );
    const { host } = await open(xml);
    expect(gfx(host, 'Odd').querySelector('.bf-unsupported-hatch')).not.toBeNull();
  });
});

describe('DI attributes', () => {
  it('draws internal labels at their BPMNLabel bounds and in their BPMNLabelStyle font', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:process id="Proc" isExecutable="false"><bpmn:task id="T" name="Check" /><bpmn:startEvent id="S" name="Go" /></bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    ${shape('T', 100, 100, 100, 80, '', '<bpmndi:BPMNLabel labelStyle="Big"><dc:Bounds x="110" y="150" width="80" height="20" /></bpmndi:BPMNLabel>')}
    ${shape('S', 300, 120, 36, 36, '', '<bpmndi:BPMNLabel labelStyle="Big"><dc:Bounds x="300" y="160" width="36" height="14" /></bpmndi:BPMNLabel>')}
  </bpmndi:BPMNPlane>
  <bpmndi:BPMNLabelStyle id="Big"><dc:Font name="Georgia" size="16" isBold="true" isItalic="true" isUnderline="true" /></bpmndi:BPMNLabelStyle>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { controller, host } = await open(xml);
    const label = gfx(host, 'T').querySelector('text.bf-label')!;
    // Centered on the bounds (x 10..90), with room for our font's wider metrics.
    const [x, y] = /translate\(([-\d.]+), ([-\d.]+)\)/
      .exec(label.getAttribute('transform')!)!
      .slice(1)
      .map(Number);
    expect(y).toBe(50);
    expect(x).toBeLessThan(10);
    expect(x).toBeGreaterThan(0);
    const style = label.getAttribute('style')!;
    expect(style).toMatch(/font-size:16px/);
    expect(style).toMatch(/font-weight:700/);
    expect(style).toMatch(/font-style:italic/);
    expect(style).toMatch(/text-decoration:underline/);
    expect(style).toMatch(/Georgia/);
    expect(gfx(host, 'S').querySelector('text.bf-external-label')!.getAttribute('style')).toMatch(
      /font-size:16px/,
    );

    // Resizing keeps the label where it was relative to the shape.
    const modeling = (controller as unknown as Internals).diagram.get<{
      resizeShape(s: unknown, b: unknown): void;
    }>('modeling');
    modeling.resizeShape(controller.getElement('T'), { x: 100, y: 100, width: 200, height: 80 });
    const xmlOut = await controller.exportXml();
    expect(xmlOut).toMatch(/<dc:Bounds x="120" y="150" width="160" height="20" \/>/);
    controller.undo();
    expect(await controller.exportXml()).toMatch(
      /<dc:Bounds x="110" y="150" width="80" height="20" \/>/,
    );
  });

  it('draws an edge to its BPMNEdge sourceElement and keeps it on export (PDF 405)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:collaboration id="C">
    <bpmn:participant id="P1" processRef="Proc" /><bpmn:participant id="P2" />
    <bpmn:messageFlow id="M" sourceRef="T" targetRef="P2" />
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false"><bpmn:task id="T" /></bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">
    ${shape('P1', 0, 0, 600, 200, 'isHorizontal="true"')}
    ${shape('T', 100, 60, 100, 80)}
    ${shape('P2', 0, 400, 600, 60, 'isHorizontal="true"')}
    ${edge(
      'M',
      [
        [300, 200],
        [300, 400],
      ],
      'sourceElement="P1_di"',
    )}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { controller, doc } = await open(xml);
    expect(doc.report.mode).toBe('editable');
    const flow = controller.getElement('M') as { source?: { id: string } };
    expect(flow.source?.id).toBe('P1');
    expect(await controller.exportXml()).toMatch(/sourceElement="P1_di"/);
    // Deleting the model end removes the flow although it is drawn to the pool.
    controller.select(['T']);
    controller.deleteSelection();
    expect(controller.getElement('M')).toBeUndefined();
    controller.undo();
    expect(controller.getElement('M')).toBeDefined();
  });

  it('toggles the exclusive gateway marker (DI isMarkerVisible) in one undoable step', async () => {
    const xml = processXml(
      `<bpmn:exclusiveGateway id="G" />`,
      shape('G', 100, 100, 50, 50, 'isMarkerVisible="true"'),
    );
    const { controller, host } = await open(xml);
    expect(gfx(host, 'G').querySelector('.bf-marker')).not.toBeNull();
    controller.updateElementDetail('G', { kind: 'markerVisible', value: false });
    expect(gfx(host, 'G').querySelector('.bf-marker')).toBeNull();
    expect(await controller.exportXml()).toMatch(/isMarkerVisible="false"/);
    controller.undo();
    expect(gfx(host, 'G').querySelector('.bf-marker')).not.toBeNull();
  });

  it('shows and edits the data state of data inputs / outputs and references (PDF 234, 243)', async () => {
    const xml = processXml(
      `<bpmn:ioSpecification id="IO"><bpmn:dataInput id="In" name="Order" /><bpmn:inputSet id="IS"><bpmn:dataInputRefs>In</bpmn:dataInputRefs></bpmn:inputSet><bpmn:outputSet id="OS" /></bpmn:ioSpecification>
       <bpmn:dataObject id="DO" /><bpmn:dataObjectReference id="Ref" name="Invoice" dataObjectRef="DO" />`,
      `${shape('In', 100, 100, 36, 50)}${shape('Ref', 300, 100, 36, 50)}`,
    );
    const { controller, host } = await open(xml);
    controller.updateElementDetail('In', { kind: 'dataState', name: 'checked' });
    expect(gfx(host, 'In').querySelector('.bf-external-label')!.textContent).toBe('Order[checked]');
    const input = (controller.getElement('In') as { businessObject: ModdleElement }).businessObject;
    expect(getRef(input, 'dataState')?.name).toBe('checked');
    controller.updateElementDetail('Ref', { kind: 'dataState', name: 'paid' });
    controller.updateElementDetail('Ref', { kind: 'dataState', name: 'sent' });
    const out = await controller.exportXml();
    expect(out).toMatch(/<bpmn:dataState id="[^"]+" name="checked" \/>/);
    expect(out).toMatch(/name="sent"/);
    controller.undo();
    controller.undo();
    controller.undo();
    expect(getRef(input, 'dataState')).toBeUndefined();
  });

  it('points a new compensation association at the compensation activity (PDF 63)', async () => {
    const xml = processXml(
      `<bpmn:task id="T" /><bpmn:task id="Undo" isForCompensation="true" />
       <bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>`,
      `${shape('T', 100, 100, 100, 80)}${shape('B', 132, 162, 36, 36)}${shape('Undo', 300, 250, 100, 80)}`,
    );
    const { controller } = await open(xml);
    const modeling = (controller as unknown as Internals).diagram.get<{
      connect(a: unknown, b: unknown, attrs: unknown): { businessObject: ModdleElement };
    }>('modeling');
    const c = modeling.connect(controller.getElement('B'), controller.getElement('Undo'), {
      type: 'bpmn:Association',
    });
    expect(c.businessObject.get('associationDirection')).toBe('One');
    expect(await controller.exportXml()).toMatch(/associationDirection="One"/);
  });
});

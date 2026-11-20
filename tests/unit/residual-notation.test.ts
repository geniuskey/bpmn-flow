// @vitest-environment jsdom
/**
 * Notation items finished in the residual sweep: the standalone Message shape
 * (BPMN 2.0.2 §8.4.11, Fig 8.26-8.28) and events with shared event
 * definitions (`eventDefinitionRef`, Tables 10.82-10.83).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import type { Connection, Element } from 'diagram-js/lib/model/Types';
import { loadBpmnDocument } from '@/bpmn/document';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { LIBRARY_ENTRIES } from '@/editor/library';
import { installSvgPolyfill } from './svgPolyfill';

installSvgPolyfill();

const fixture = (name: string) => readFileSync(`${process.cwd()}/tests/fixtures/${name}`, 'utf8');

type Internals = { diagram: { get<T>(name: string): T } };

async function open(xml: string) {
  const doc = await loadBpmnDocument(xml);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new EditorController(host);
  controller.open(doc);
  const get = <T>(name: string) => (controller as unknown as Internals).diagram.get<T>(name);
  return { controller, doc, host, get };
}

const gfx = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-element-id="${id}"] .djs-visual`)!;

const roots = (doc: { definitions: ModdleElement }) => getMany(doc.definitions, 'rootElements');

const messagePreset = () => LIBRARY_ENTRIES.find((e) => e.id === 'message')!.preset;

describe('standalone Message shape (PDF 121-122)', () => {
  it('is created from the library, associated with a message flow and deleted, all undoable', async () => {
    const { controller, doc, host, get } = await open(fixture('collaboration-messages.bpmn'));
    get<Canvas>('canvas').viewbox({ x: 300, y: 200, width: 1000, height: 600 });
    const before = roots(doc).length;
    expect(controller.createInView('bpmn:Message', messagePreset())).toBe(true);
    const id = controller.getSnapshot().selection[0]!;
    const message = (controller.getElement(id) as { businessObject: ModdleElement }).businessObject;
    expect(is(message, 'bpmn:Message')).toBe(true);
    expect(roots(doc)).toContain(message);
    expect(roots(doc)).toHaveLength(before + 1);
    expect(gfx(host, id).querySelector('.bf-message-shape .bf-envelope-flap')).not.toBeNull();
    expect(gfx(host, id).querySelector('.bf-unsupported-hatch')).toBeNull();

    // Associate it with the message flow that names no message yet (Fig 8.28).
    const rules = get<Rules>('rules');
    const modeling = get<Modeling>('modeling');
    const el = (x: string) => get<{ get(id: string): Element }>('elementRegistry').get(x)!;
    const flow = (el('MF_invoice') as { businessObject: ModdleElement }).businessObject;
    expect(
      rules.allowed('connection.create', { source: el(id), target: el('MF_invoice') }),
    ).toEqual({ type: 'bpmn:Association' });
    // Not with tasks, sequence flows or another message.
    expect(rules.allowed('connection.create', { source: el(id), target: el('Ship') })).toBeFalsy();
    expect(rules.allowed('connection.create', { source: el(id), target: el('s1') })).toBeFalsy();
    const association = modeling.connect(el(id), el('MF_invoice'), {
      type: 'bpmn:Association',
    } as never) as Connection;
    expect(getRef(flow, 'messageRef')).toBe(message);
    expect(association.businessObject.$parent).toBe(
      roots(doc).find((r) => is(r, 'bpmn:Collaboration')),
    );
    controller.undo();
    expect(getRef(flow, 'messageRef')).toBeUndefined();
    controller.redo();
    expect(getRef(flow, 'messageRef')).toBe(message);

    // Round trip: the shape is DI only, the message a root element; it reopens editable.
    const xml = await controller.exportXml();
    expect(xml).toMatch(new RegExp(`<bpmndi:BPMNShape [^>]*bpmnElement="${id}"`));
    const reopened = await open(xml);
    expect(reopened.doc.report.mode).toBe('editable');
    expect((reopened.controller.getElement(id) as { unsupported?: boolean }).unsupported).toBe(
      false,
    );
    expect(reopened.doc.report.issues.some((i) => i.elementId === id)).toBe(false);

    // Deleting the shape keeps a Message that a message flow still carries.
    controller.select([id]);
    controller.deleteSelection();
    expect(controller.getElement(id)).toBeUndefined();
    expect(roots(doc)).toContain(message);
    controller.undo();
    expect(controller.getElement(id)).toBeDefined();
  });

  it('removes an unused Message with its shape', async () => {
    const { controller, doc, get } = await open(fixture('collaboration-messages.bpmn'));
    get<Canvas>('canvas').viewbox({ x: 300, y: 200, width: 1000, height: 600 });
    const before = roots(doc).length;
    expect(controller.createInView('bpmn:Message', messagePreset())).toBe(true);
    const id = controller.getSnapshot().selection[0]!;
    controller.select([id]);
    controller.deleteSelection();
    expect(roots(doc)).toHaveLength(before);
    controller.undo();
    expect(roots(doc)).toHaveLength(before + 1);
  });

  it('is only placed on collaboration and choreography diagrams', async () => {
    const { controller } = await open(fixture('simple-process.bpmn'));
    expect(controller.createInView('bpmn:Message', messagePreset())).toBe(false);
  });
});

describe('shared event definitions (Tables 10.82-10.83, PDF 265-266)', () => {
  const NS = `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:test"`;
  const shape = (id: string, x: number) =>
    `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="100" width="36" height="36" /></bpmndi:BPMNShape>`;

  it('draws the marker of referenced definitions, also for Multiple, and keeps them on export', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS}>
  <bpmn:signalEventDefinition id="Sig" />
  <bpmn:timerEventDefinition id="Tim" />
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:intermediateCatchEvent id="One"><bpmn:eventDefinitionRef>Sig</bpmn:eventDefinitionRef></bpmn:intermediateCatchEvent>
    <bpmn:startEvent id="Two"><bpmn:messageEventDefinition id="Own" /><bpmn:eventDefinitionRef>Tim</bpmn:eventDefinitionRef></bpmn:startEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="Proc">
    ${shape('One', 100)}${shape('Two', 200)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { controller, host } = await open(xml);
    const one = gfx(host, 'One');
    expect(one.querySelector('.bf-intermediate-inner')).not.toBeNull();
    expect(one.querySelector('.bf-event-marker')).not.toBeNull();
    expect(one.querySelector('.bf-unsupported-hatch')).toBeNull();
    // An own and a shared definition: a Multiple (pentagon) start event.
    const two = gfx(host, 'Two');
    expect(two.querySelector('.bf-start-event')).not.toBeNull();
    expect(two.querySelector('.bf-unsupported-hatch')).toBeNull();
    const out = await controller.exportXml();
    expect(out).toContain('<bpmn:eventDefinitionRef>Sig</bpmn:eventDefinitionRef>');
    expect(out).toContain('<bpmn:eventDefinitionRef>Tim</bpmn:eventDefinitionRef>');
  });
});

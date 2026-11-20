// @vitest-environment jsdom
/**
 * Creating every notation variant of the shape library (presets), the drop
 * rules, and the "Change type" (replace) command, on a real diagram-js editor.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type Canvas from 'diagram-js/lib/core/Canvas';
import { loadBpmnDocument } from '@/bpmn/document';
import { createModdle, getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { EditorController } from '@/editor/EditorController';
import { LIBRARY_ENTRIES, SHAPE_LIBRARY, searchLibrary } from '@/editor/library';
import { buildFromPreset, presetOf, variantKey } from '@/editor/modeling/presets';
import { renderPreview } from '@/editor/renderer/preview';
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

/** Shows the area around (cx, cy) so `createInView` places shapes there. */
function look(controller: EditorController, cx: number, cy: number) {
  const canvas = (controller as unknown as Internals).diagram.get<Canvas>('canvas');
  canvas.viewbox({ x: cx - 500, y: cy - 300, width: 1000, height: 600 });
}

function byType(doc: { definitions: ModdleElement }, type: string): ModdleElement[] {
  const out: ModdleElement[] = [];
  const visit = (el: ModdleElement) => {
    if (el.$type === type) out.push(el);
    for (const p of el.$descriptor?.properties ?? []) {
      if (p.isReference) continue;
      const v = (el as unknown as Record<string, unknown>)[p.name];
      for (const c of Array.isArray(v) ? v : [v]) {
        if (c && typeof c === 'object' && '$type' in c) visit(c as ModdleElement);
      }
    }
  };
  visit(doc.definitions);
  return out;
}

function created(controller: EditorController): string {
  return controller.getSnapshot().selection[0]!;
}

function entry(id: string): ShapePreset {
  const found = LIBRARY_ENTRIES.find((e) => e.id === id);
  if (!found) throw new Error(`no library entry ${id}`);
  return found.preset;
}

describe('shape library', () => {
  it('has unique ids and keeps the test ids of the former palette', () => {
    const ids = LIBRARY_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const testIds = LIBRARY_ENTRIES.map((e) => e.testId).filter(Boolean);
    for (const t of [
      'StartEvent',
      'EndEvent',
      'Task',
      'ExclusiveGateway',
      'ParallelGateway',
      'IntermediateThrowEvent',
      'BoundaryEvent',
      'SubProcess',
      'DataObjectReference',
      'DataStoreReference',
      'DataInput',
      'DataOutput',
      'TextAnnotation',
      'Group',
      'Participant',
      'Conversation',
      'ChoreographyTask',
    ]) {
      expect(testIds).toContain(t);
    }
  });

  it('lists every event variant of BPMN 2.0.2 Table 10.89', () => {
    const keys = (group: string) =>
      SHAPE_LIBRARY.find((g) => g.id === group)!.entries.map((e) => variantKey(e.preset));
    // 7 top level, 3 more interrupting and 7 non-interrupting event sub-process starts.
    expect(keys('start')).toHaveLength(17);
    // 7 catching + 7 throwing intermediate events.
    expect(keys('intermediate')).toHaveLength(14);
    // 10 interrupting + 7 non-interrupting boundary events.
    expect(keys('boundary')).toHaveLength(17);
    expect(keys('end')).toHaveLength(9);
    // Every variant the replace menu offers is distinct.
    const replaceable = LIBRARY_ENTRIES.filter((e) => e.replace !== false);
    expect(new Set(replaceable.map((e) => variantKey(e.preset))).size).toBe(replaceable.length);
  });

  it('builds the business object of every entry', () => {
    const moddle = createModdle();
    let n = 0;
    for (const e of LIBRARY_ENTRIES) {
      const built = buildFromPreset(
        { moddle, create: (t, a) => moddle.create(t, { id: `X${++n}`, ...a }) },
        e.preset,
      );
      expect(built.businessObject.$type).toBe(e.preset.type);
      expect(getRef(built.di, 'bpmnElement')).toBe(built.businessObject);
      if (e.preset.eventDefinitions) {
        expect(getMany(built.businessObject, 'eventDefinitions').map((d) => d.$type)).toEqual(
          e.preset.eventDefinitions,
        );
      }
      // The preset reads back as the same variant.
      expect(variantKey(presetOf(built.businessObject, built.di))).toBe(variantKey(e.preset));
    }
  });

  it('renders every entry with the canvas renderer', () => {
    for (const e of LIBRARY_ENTRIES) {
      const svg = renderPreview(e.preset);
      expect(svg).toMatch(/^<svg[^>]*class="bf-preview"/);
    }
    // Catching events have the inner ring of intermediate events and an outlined marker.
    const catchMessage = renderPreview(entry('catch-message'));
    expect(catchMessage).toContain('bf-intermediate-inner');
    expect(catchMessage).toContain('bf-event-marker');
    expect(catchMessage).not.toContain('bf-event-marker-filled');
    expect(renderPreview(entry('throw-message'))).toContain('bf-event-marker-filled');
    expect(renderPreview(entry('boundary-non-interrupting-timer'))).toContain(
      'bf-non-interrupting',
    );
    expect(renderPreview(entry('event-sub-process'))).toContain('bf-event-subprocess');
    expect(renderPreview(entry('data-object-collection'))).toContain('bf-collection-marker');
    // A call activity calling a global user task shows the user marker (Table 12.18).
    expect(renderPreview(entry('call-activity-user'))).toContain('circle');
    // Previews are cached.
    expect(renderPreview(entry('catch-message'))).toBe(catchMessage);
  });

  it('searches labels and keywords', () => {
    const hits = searchLibrary('catch link').flatMap((g) => g.entries.map((e) => e.id));
    expect(hits).toEqual(['catch-link']);
    expect(searchLibrary('xor').flatMap((g) => g.entries.map((e) => e.id))).toContain(
      'exclusive-gateway',
    );
    expect(searchLibrary('zzz')).toEqual([]);
  });
});

describe('creating presets', () => {
  let ctx: Awaited<ReturnType<typeof open>>;
  beforeAll(async () => {
    ctx = await open(EMPTY_PROCESS);
  });

  it('creates every intermediate catch event and undoes each in one step', async () => {
    const { controller, doc } = ctx;
    const catches = LIBRARY_ENTRIES.filter((e) => e.id.startsWith('catch-'));
    expect(catches).toHaveLength(7);
    let x = 100;
    for (const e of catches) {
      look(controller, (x += 100), 100);
      expect(controller.createInView(e.preset.type, e.preset)).toBe(true);
      const event = controller.getElement(created(controller)) as unknown as {
        businessObject: ModdleElement;
      };
      expect(event.businessObject.$type).toBe('bpmn:IntermediateCatchEvent');
      expect(event.businessObject.get('parallelMultiple') === true).toBe(
        e.id === 'catch-parallel-multiple',
      );
    }
    expect(byType(doc, 'bpmn:IntermediateCatchEvent')).toHaveLength(7);
    const xml = await controller.exportXml();
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="[^"]+">\s*<bpmn:messageEventDefinition/);
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="[^"]+">\s*<bpmn:linkEventDefinition/);
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="[^"]+" parallelMultiple="true">/);
    controller.undo();
    expect(byType(doc, 'bpmn:IntermediateCatchEvent')).toHaveLength(6);
    controller.redo();
    expect(byType(doc, 'bpmn:IntermediateCatchEvent')).toHaveLength(7);
  });

  it('allows event sub-process triggers only inside an event sub-process', () => {
    const { controller } = ctx;
    look(controller, 400, 600);
    expect(controller.createInView('bpmn:StartEvent', entry('start-error'))).toBe(false);
    expect(
      controller.createInView('bpmn:StartEvent', entry('start-non-interrupting-message')),
    ).toBe(false);
    expect(controller.createInView('bpmn:SubProcess', entry('event-sub-process'))).toBe(true);
    const esp = created(controller);
    expect(
      (
        controller.getElement(esp) as unknown as { businessObject: ModdleElement }
      ).businessObject.get('triggeredByEvent'),
    ).toBe(true);
    // A none start event is not enough there (PDF 204); an error start event is.
    expect(controller.createInView('bpmn:StartEvent', entry('start-none'))).toBe(false);
    expect(controller.createInView('bpmn:StartEvent', entry('start-error'))).toBe(true);
    const start = controller.getElement(created(controller)) as unknown as {
      businessObject: ModdleElement;
    };
    expect(start.businessObject.$parent?.id).toBe(esp);
    // Top-level start triggers stay allowed outside.
    look(controller, 1200, 600);
    expect(controller.createInView('bpmn:StartEvent', entry('start-timer'))).toBe(true);
  });

  it('creates a collection data object and a call activity of a global task', async () => {
    const { controller, doc } = ctx;
    look(controller, 400, 1000);
    expect(
      controller.createInView('bpmn:DataObjectReference', entry('data-object-collection')),
    ).toBe(true);
    const ref = (
      controller.getElement(created(controller)) as unknown as {
        businessObject: ModdleElement;
      }
    ).businessObject;
    const dataObject = getRef(ref, 'dataObjectRef')!;
    expect(dataObject.get('isCollection')).toBe(true);
    expect(getMany(dataObject.$parent, 'flowElements')).toContain(dataObject);
    controller.undo();
    expect(dataObject.$parent).toBeUndefined();
    controller.redo();
    expect(dataObject.$parent?.id).toBe('Proc');

    look(controller, 800, 1000);
    expect(controller.createInView('bpmn:CallActivity', entry('call-activity-script'))).toBe(true);
    const call = (
      controller.getElement(created(controller)) as unknown as {
        businessObject: ModdleElement;
      }
    ).businessObject;
    const global = getMany(doc.definitions, 'rootElements').find(
      (r) => r.id === call.get('calledElement'),
    );
    expect(global?.$type).toBe('bpmn:GlobalScriptTask');
    const xml = await controller.exportXml();
    expect(xml).toMatch(/<bpmn:dataObject id="[^"]+" isCollection="true" \/>/);
    expect(xml).toMatch(/<bpmn:globalScriptTask id="[^"]+" \/>/);
    controller.undo();
    expect(getMany(doc.definitions, 'rootElements')).not.toContain(global);
  });

  it('creates instantiating gateways and receive tasks, and gateways without a marker', async () => {
    const { controller } = ctx;
    look(controller, 400, 1400);
    expect(
      controller.createInView('bpmn:EventBasedGateway', entry('event-based-gateway-parallel')),
    ).toBe(true);
    look(controller, 600, 1400);
    expect(controller.createInView('bpmn:ReceiveTask', entry('receive-task-instantiate'))).toBe(
      true,
    );
    look(controller, 800, 1400);
    expect(
      controller.createInView('bpmn:ExclusiveGateway', entry('exclusive-gateway-no-marker')),
    ).toBe(true);
    look(controller, 1000, 1400);
    expect(controller.createInView('bpmn:SubProcess', entry('sub-process-collapsed'))).toBe(true);
    const xml = await controller.exportXml();
    expect(xml).toMatch(
      /<bpmn:eventBasedGateway id="[^"]+" instantiate="true" eventGatewayType="Parallel"/,
    );
    expect(xml).toMatch(/<bpmn:receiveTask id="[^"]+" instantiate="true"/);
    expect(xml).toMatch(/isMarkerVisible="false"/);
    expect(xml).toMatch(/isExpanded="false"/);
  });
});

describe('boundary events, pools and lanes', () => {
  it('attaches boundary variants the host allows', async () => {
    const { controller, doc } = await open(fixture('advanced-elements.bpmn'));
    controller.select(['Collect'], false);
    expect(controller.createInView('bpmn:BoundaryEvent', entry('boundary-cancel'))).toBe(false);
    expect(
      controller.createInView('bpmn:BoundaryEvent', entry('boundary-non-interrupting-signal')),
    ).toBe(true);
    const signal = byType(doc, 'bpmn:BoundaryEvent').find(
      (b) => b.get('cancelActivity') === false,
    )!;
    expect(getRef(signal, 'attachedToRef')?.id).toBe('Collect');
    controller.select(['Book'], false);
    expect(controller.createInView('bpmn:BoundaryEvent', entry('boundary-cancel'))).toBe(true);
    // Nothing selected: no host.
    controller.select([], false);
    expect(controller.createInView('bpmn:BoundaryEvent', entry('boundary-timer'))).toBe(false);
  });

  it('adds black-box pools to collaborations and lanes to the selected pool', async () => {
    const { controller, doc } = await open(fixture('collaboration-lanes.bpmn'));
    look(controller, 400, 1200);
    expect(controller.createInView('bpmn:Participant', entry('pool-black-box'))).toBe(true);
    const pool = (
      controller.getElement(created(controller)) as unknown as {
        businessObject: ModdleElement;
      }
    ).businessObject;
    expect(getRef(pool, 'processRef')).toBeUndefined();
    const lanes = () => byType(doc, 'bpmn:Lane').length;
    const before = lanes();
    controller.select(['Pool_support'], false);
    expect(controller.createInView('bpmn:Lane', entry('lane'))).toBe(true);
    expect(lanes()).toBe(before + 1);
    // A black-box pool has no lanes.
    controller.select([pool.id!], false);
    expect(controller.createInView('bpmn:Lane', entry('lane'))).toBe(false);
    await controller.exportXml();
  });

  it('does not make the first pool of a process a black box', async () => {
    const { controller } = await open(EMPTY_PROCESS);
    expect(controller.createInView('bpmn:Participant', entry('pool-black-box'))).toBe(false);
    expect(controller.createInView('bpmn:Participant', entry('pool'))).toBe(true);
  });
});

describe('change type (replace)', () => {
  it('switches catch and throw events and keeps the flow valid', async () => {
    const { controller, doc } = await open(fixture('simple-process.bpmn'));
    const options = controller.replaceOptions('Start_1').map((o) => o.entry.id);
    // Start_1 has an outgoing flow: catch and throw variants, but no end events.
    expect(options).toContain('catch-message');
    expect(options).toContain('throw-signal');
    expect(options).toContain('start-timer');
    expect(options).not.toContain('start-none'); // what it already is
    expect(options.some((o) => o.startsWith('end-'))).toBe(false);
    // No event sub-process triggers at the top level.
    expect(options).not.toContain('start-error');
    expect(controller.replaceBlocker('Start_1', entry('end-message'))).toMatch(/no outgoing/);

    const start = () => byType(doc, 'bpmn:Process')[0]!.get('flowElements') as ModdleElement[];
    controller.replace('Start_1', entry('catch-timer'));
    let el = start().find((e) => e.id === 'Start_1')!;
    expect(el.$type).toBe('bpmn:IntermediateCatchEvent');
    expect(getMany(el, 'eventDefinitions').map((d) => d.$type)).toEqual([
      'bpmn:TimerEventDefinition',
    ]);
    // Catch → throw message, then undo restores the timer catch event in one step.
    controller.replace('Start_1', entry('throw-message'));
    el = start().find((e) => e.id === 'Start_1')!;
    expect(el.$type).toBe('bpmn:IntermediateThrowEvent');
    controller.undo();
    el = start().find((e) => e.id === 'Start_1')!;
    expect(el.$type).toBe('bpmn:IntermediateCatchEvent');
    expect(getMany(el, 'eventDefinitions')[0]?.$type).toBe('bpmn:TimerEventDefinition');
    controller.undo();
    el = start().find((e) => e.id === 'Start_1')!;
    expect(el.$type).toBe('bpmn:StartEvent');
    expect(getMany(el, 'eventDefinitions')).toHaveLength(0);
    // The sequence flow still points at the replaced object.
    const flow = start().find((e) => e.id === 'Flow_a')!;
    expect(getRef(flow, 'sourceRef')).toBe(el);
    await controller.exportXml();
  });

  it('changes the type of an event and drops triggers the new type cannot have', async () => {
    const { controller, doc } = await open(fixture('simple-process.bpmn'));
    controller.replace('End_1', entry('end-terminate'));
    // End → intermediate throw: terminate is not a throw trigger, the event becomes a none event.
    expect(controller.typeChangeOptions('End_1')).toEqual([
      'bpmn:IntermediateCatchEvent',
      'bpmn:IntermediateThrowEvent',
    ]);
    controller.changeType('End_1', 'bpmn:IntermediateThrowEvent');
    const el = byType(doc, 'bpmn:IntermediateThrowEvent')[0]!;
    expect(el.id).toBe('End_1');
    expect(getMany(el, 'eventDefinitions')).toHaveLength(0);
    // Intermediate catch events need a trigger: a timer is added.
    controller.changeType('End_1', 'bpmn:IntermediateCatchEvent');
    const caught = byType(doc, 'bpmn:IntermediateCatchEvent')[0]!;
    expect(getMany(caught, 'eventDefinitions')[0]?.$type).toBe('bpmn:TimerEventDefinition');
  });

  it('offers boundary, gateway, task and sub-process variants', async () => {
    const { controller, doc } = await open(fixture('advanced-elements.bpmn'));
    // The cancel boundary event of the transaction: interrupting only for cancel/error/compensation.
    const boundary = controller.replaceOptions('Cancelled').map((o) => o.entry.id);
    expect(boundary).toContain('boundary-error');
    expect(boundary).toContain('boundary-non-interrupting-message');
    expect(boundary).not.toContain('catch-message');
    controller.replace('Cancelled', entry('boundary-non-interrupting-timer'));
    const cancelled = byType(doc, 'bpmn:BoundaryEvent').find((b) => b.id === 'Cancelled')!;
    expect(cancelled.get('cancelActivity')).toBe(false);
    expect(getMany(cancelled, 'eventDefinitions')[0]?.$type).toBe('bpmn:TimerEventDefinition');
    controller.undo();
    expect(cancelled.get('cancelActivity')).not.toBe(false);
    expect(getMany(cancelled, 'eventDefinitions')[0]?.$type).toBe('bpmn:CancelEventDefinition');

    // The transaction has a cancel boundary event: it stays a transaction.
    const book = controller.replaceOptions('Book').map((o) => o.entry.id);
    expect(book).toEqual([]);
    // The ad-hoc sub-process can become a transaction or an event sub-process (no flows? it has some).
    const extras = controller.replaceOptions('Extras').map((o) => o.entry.id);
    expect(extras).toContain('transaction');
    expect(extras).toContain('sub-process');
    expect(extras).not.toContain('event-sub-process');
    expect(controller.replaceBlocker('Extras', entry('event-sub-process'))).toMatch(
      /no incoming or outgoing/,
    );
  });

  it('turns a gateway into its variants', async () => {
    const xml = fixture('simple-process.bpmn')
      .replace(
        '<bpmn:sequenceFlow id="Flow_b"',
        '<bpmn:exclusiveGateway id="G" /><bpmn:sequenceFlow id="Flow_b"',
      )
      .replace(
        '</bpmndi:BPMNPlane>',
        '<bpmndi:BPMNShape id="G_di" bpmnElement="G" isMarkerVisible="true"><dc:Bounds x="500" y="300" width="50" height="50" /></bpmndi:BPMNShape></bpmndi:BPMNPlane>',
      );
    const { controller, doc } = await open(xml);
    const options = controller.replaceOptions('G').map((o) => o.entry.id);
    expect(options).toEqual([
      'exclusive-gateway-no-marker',
      'inclusive-gateway',
      'parallel-gateway',
      'complex-gateway',
      'event-based-gateway',
      'event-based-gateway-instantiate',
      'event-based-gateway-parallel',
    ]);
    controller.replace('G', entry('exclusive-gateway-no-marker'));
    const di = (controller.getElement('G') as unknown as { di: ModdleElement }).di;
    expect(di.get('isMarkerVisible')).toBe(false);
    controller.replace('G', entry('event-based-gateway-parallel'));
    const g = byType(doc, 'bpmn:EventBasedGateway')[0]!;
    expect(g.get('instantiate')).toBe(true);
    expect(g.get('eventGatewayType')).toBe('Parallel');
    expect(is(g, 'bpmn:EventBasedGateway')).toBe(true);
    controller.undo();
    controller.undo();
    expect(di.get('isMarkerVisible')).toBe(true);
    expect(byType(doc, 'bpmn:ExclusiveGateway')).toHaveLength(1);
  });

  it('makes receive tasks instantiating only without incoming flows', async () => {
    const { controller, doc } = await open(fixture('simple-process.bpmn'));
    controller.changeType('Task_check', 'bpmn:ReceiveTask');
    expect(controller.replaceBlocker('Task_check', entry('receive-task-instantiate'))).toMatch(
      /no incoming/,
    );
    // The command is rejected (and rolled back by the command guard).
    controller.updateProperties('Task_check', { instantiate: true });
    const task = byType(doc, 'bpmn:ReceiveTask')[0]!;
    expect(task.get('instantiate')).not.toBe(true);
  });
});

describe('review follow-ups', () => {
  it('creates conditional and link triggers with the content the XSD requires', async () => {
    const { controller } = await open(EMPTY_PROCESS);
    let x = 0;
    for (const id of ['start-conditional', 'catch-conditional', 'catch-link', 'throw-link']) {
      look(controller, (x += 150), 100);
      expect(controller.createInView(entry(id).type, entry(id))).toBe(true);
    }
    const xml = await controller.exportXml();
    expect(
      xml.match(/<bpmn:conditionalEventDefinition id="[^"]+">\s*<bpmn:condition /g),
    ).toHaveLength(2);
    expect(xml.match(/<bpmn:linkEventDefinition id="[^"]+" name=""/g)).toHaveLength(2);
    expect(xml).not.toMatch(/<bpmn:conditionalEventDefinition id="[^"]+" \/>/);
    // Clearing the condition or link name in the inspector keeps them present.
    const link = controller.getSnapshot().selection[0]!;
    controller.updateEventDetail(link, { kind: 'link', name: 'A' });
    controller.updateEventDetail(link, { kind: 'link', name: '' });
    expect(await controller.exportXml()).toMatch(/<bpmn:linkEventDefinition id="[^"]+" name=""/);
  });

  it('keeps event sub-process-only start events from moving out of it', async () => {
    for (const id of ['start-error', 'start-non-interrupting-message']) {
      const { controller } = await open(EMPTY_PROCESS);
      look(controller, 400, 400);
      expect(controller.createInView('bpmn:SubProcess', entry('event-sub-process'))).toBe(true);
      const esp = controller.getElement(created(controller))!;
      expect(controller.createInView('bpmn:StartEvent', entry(id))).toBe(true);
      const start = controller.getElement(created(controller))!;
      expect(start.parent).toBe(esp);
      const diagram = (controller as unknown as Internals).diagram;
      const rules = diagram.get<{ allowed(action: string, ctx: unknown): unknown }>('rules');
      const root = diagram.get<Canvas>('canvas').getRootElement();
      const move = (x: number, target: unknown) =>
        rules.allowed('elements.move', { shapes: [start], delta: { x, y: 0 }, target });
      expect(move(800, root)).toBe(false);
      expect(move(5, esp)).toBe(true); // within the event sub-process it still moves
    }
  });

  it('offers no type change for a drill-down diagram root', async () => {
    const { controller } = await open(fixture('multi-diagram.bpmn'));
    const root = '__root_Plane_fulfil';
    expect(controller.getElement(root)).toBeTruthy();
    expect(controller.typeChangeOptions(root)).toEqual([]);
    expect(controller.replaceOptions(root)).toEqual([]);
    expect(controller.replaceBlocker(root, { type: 'bpmn:Transaction' })).toMatch(/parent diagram/);
    controller.changeType(root, 'bpmn:Transaction');
    await controller.exportXml();
    // The collapsed shape in the parent diagram still changes type.
    expect(controller.typeChangeOptions('Fulfil')).toContain('bpmn:Transaction');
  });
});

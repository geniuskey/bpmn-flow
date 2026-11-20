/**
 * Changes the BPMN type of a flow node in place (e.g. Task → User Task) while
 * keeping its id, name, documentation, extensions and connections. Only types of
 * the same family are interchangeable, so the shape geometry stays valid.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import { containedChildren, getMany, getRef, is, walkContainment } from '@/bpmn/model/moddle';
import { diReferencing } from '@/bpmn/di/di';
import type Canvas from 'diagram-js/lib/core/Canvas';
import { bo, canExpand, type BpmnData, type BpmnShape } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import { choreographyOf } from '../modeling/semanticModel';

export const CHANGE_TYPE = 'element.changeType';

export const TYPE_FAMILIES: string[][] = [
  [
    'bpmn:Task',
    'bpmn:UserTask',
    'bpmn:ServiceTask',
    'bpmn:SendTask',
    'bpmn:ReceiveTask',
    'bpmn:ManualTask',
    'bpmn:BusinessRuleTask',
    'bpmn:ScriptTask',
    'bpmn:CallActivity',
  ],
  ['bpmn:SubProcess', 'bpmn:Transaction', 'bpmn:AdHocSubProcess'],
  // Events in the flow; boundary events stay boundary events (they need a host).
  [
    'bpmn:StartEvent',
    'bpmn:IntermediateCatchEvent',
    'bpmn:IntermediateThrowEvent',
    'bpmn:EndEvent',
  ],
  ['bpmn:Conversation', 'bpmn:SubConversation', 'bpmn:CallConversation'],
  ['bpmn:ChoreographyTask', 'bpmn:SubChoreography', 'bpmn:CallChoreography'],
  [
    'bpmn:ExclusiveGateway',
    'bpmn:ParallelGateway',
    'bpmn:InclusiveGateway',
    'bpmn:EventBasedGateway',
    'bpmn:ComplexGateway',
  ],
];

export function alternativeTypes(type: string): string[] {
  return TYPE_FAMILIES.find((f) => f.includes(type))?.filter((t) => t !== type) ?? [];
}

interface Context {
  element: Element;
  newType: string;
  /** Message flow a new choreography task gets (reused on redo). */
  messageFlow?: ModdleElement;
  /** Reused on redo so later commands keep referring to the same object. */
  next?: ModdleElement;
  log?: ChangeLog;
}

/**
 * Makes every reference to `old` in the definitions point to `next`: sequence
 * flows, boundary attachments, message flows, associations, lane membership,
 * compensation and DI. Generic so that no reference kind can be missed.
 */
function repointReferences(
  definitions: ModdleElement,
  old: ModdleElement,
  next: ModdleElement,
  log: ChangeLog,
): void {
  walkContainment(definitions, (el) => {
    if (el === old || !el.$descriptor) return;
    const record = el as unknown as Record<string, unknown>;
    for (const prop of el.$descriptor.properties) {
      if (!prop.isReference) continue;
      const value = record[prop.name];
      if (Array.isArray(value)) {
        const i = value.indexOf(old);
        if (i >= 0) {
          log.remove(value, old);
          log.insert(value, next, i);
        }
      } else if (value === old) {
        log.set(el, prop.name, next);
      }
    }
  });
}

export default class ChangeTypeHandler {
  static $inject = ['moddle', 'bpmnDefinitions', 'canvas', 'elementFactory'];
  constructor(
    private readonly moddle: BpmnModdleInstance,
    private readonly definitions: ModdleElement,
    private readonly canvas: Canvas,
    private readonly factory?: BpmnElementFactory,
  ) {}

  /**
   * A choreography task refers to one or more message flows (Table 11.2):
   * a task that becomes another choreography activity drops the ones only it
   * used, an activity that becomes a task gets one from its initiator.
   */
  private syncTaskMessageFlows(
    context: Context,
    old: ModdleElement,
    next: ModdleElement,
    log: ChangeLog,
  ): void {
    const choreography = choreographyOf(next);
    if (!choreography) return;
    const owned = choreography.get('messageFlows') as ModdleElement[];
    if (is(old, 'bpmn:ChoreographyTask') && !is(next, 'bpmn:ChoreographyTask')) {
      for (const flow of getMany(old, 'messageFlowRef')) {
        let used = false;
        walkContainment(this.definitions, (el) => {
          if (el !== old && getMany(el, 'messageFlowRef').includes(flow)) used = true;
        });
        if (!used) log.remove(owned, flow);
      }
    }
    if (is(next, 'bpmn:ChoreographyTask') && !getMany(next, 'messageFlowRef').length) {
      const refs = getMany(next, 'participantRef');
      const from = getRef(next, 'initiatingParticipantRef') ?? refs[0];
      const to = refs.find((p) => p !== from);
      if (!from || !to || !this.factory) return;
      const flow = (context.messageFlow ??= this.factory.createModdle('bpmn:MessageFlow', {
        sourceRef: from,
        targetRef: to,
      }));
      log.insert(owned, flow);
      log.setParent(flow, choreography);
      log.set(next, 'messageFlowRef', [flow]);
    }
  }

  execute(context: Context): Element[] {
    const shape = context.element as BpmnShape;
    const old = bo(shape);
    // A drill-down diagram root (drawn by its plane) changes through its collapsed shape.
    const isRoot = is(shape.di as ModdleElement | undefined, 'bpmndi:BPMNPlane');
    if (!old || isRoot || !alternativeTypes(old.$type).includes(context.newType)) {
      throw new Error(`Cannot change ${old?.$type} to ${context.newType}.`);
    }
    const log = new ChangeLog();
    const next: ModdleElement = (context.next ??= this.moddle.create(context.newType, {
      id: old.id,
    }));
    const record = old as unknown as Record<string, unknown>;
    const nextProps = new Set(next.$descriptor.properties.map((p) => p.name));
    for (const prop of old.$descriptor.properties) {
      if (prop.name === 'id' || !nextProps.has(prop.name)) continue;
      if (!Object.prototype.hasOwnProperty.call(record, prop.name)) continue;
      const value = record[prop.name];
      next.set(prop.name, Array.isArray(value) ? value.slice() : value);
    }
    for (const [k, v] of Object.entries(old.$attrs ?? {})) next.$attrs[k] = v;
    // Every contained child (documentation, extensions, sub-process content, data
    // associations, I/O specification, loop characteristics, ...) moves to the new
    // object, so later edits that go through `$parent` find it there.
    for (const child of containedChildren(next)) {
      if (child.$parent === old) log.setParent(child, next);
    }

    const container = old.$parent!;
    const list = container.get(
      is(old, 'bpmn:ConversationNode') ? 'conversations' : 'flowElements',
    ) as ModdleElement[];
    const index = list.indexOf(old);
    log.remove(list, old);
    log.insert(list, next, index);
    log.setParent(next, container);
    repointReferences(this.definitions, old, next, log);
    if (is(old, 'bpmn:ChoreographyActivity')) this.syncTaskMessageFlows(context, old, next, log);
    // Re-point DI in every diagram, including a drill-down plane of a sub-process.
    // (`repointReferences` already updated the DI's `bpmnElement`.)
    for (const diagram of diReferencing(this.definitions, next).diagrams) {
      const plane = getRef(diagram, 'plane')!;
      const root = this.canvas
        .getRootElements()
        .find((r) => (r as { di?: ModdleElement }).di === plane) as
        { businessObject: ModdleElement } | undefined;
      if (root) {
        log.apply(
          () => (root.businessObject = next),
          () => (root.businessObject = old),
        );
      }
    }
    if (is(next, 'bpmn:ExclusiveGateway')) log.set(shape.di, 'isMarkerVisible', true);
    // Write isExpanded explicitly: other tools read a missing value as collapsed
    // (BPMN 2.0.2 Table 12.10). Only sub-process kinds carry it.
    if (canExpand(next)) {
      if (typeof shape.di.get('isExpanded') !== 'boolean') {
        log.set(shape.di, 'isExpanded', (shape as Partial<BpmnData>).expandedByContent === true);
      }
    } else if (shape.di.get('isExpanded') !== undefined) {
      log.set(shape.di, 'isExpanded', undefined);
    }
    const oldType = shape.type;
    log.apply(
      () => {
        shape.businessObject = next;
        shape.type = next.$type;
      },
      () => {
        shape.businessObject = old;
        shape.type = oldType;
      },
    );
    context.log = log;
    return [shape, ...shape.incoming, ...shape.outgoing];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    const shape = context.element;
    return [shape, ...shape.incoming, ...shape.outgoing];
  }
}

/**
 * Changes the BPMN type of a flow node in place (e.g. Task → User Task) while
 * keeping its id, name, documentation, extensions and connections. Only types of
 * the same family are interchangeable, so the shape geometry stays valid.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import { getMany, is } from '@/bpmn/model/moddle';
import { bo, type BpmnShape } from '../model';
import { ChangeLog } from '../modeling/ChangeLog';
import { allLanes } from '../modeling/semantic';

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
  /** Reused on redo so later commands keep referring to the same object. */
  next?: ModdleElement;
  log?: ChangeLog;
}

export default class ChangeTypeHandler {
  static $inject = ['moddle'];
  constructor(private readonly moddle: BpmnModdleInstance) {}

  execute(context: Context): Element[] {
    const shape = context.element as BpmnShape;
    const old = bo(shape);
    if (!old || !alternativeTypes(old.$type).includes(context.newType)) {
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
    // Contained children (documentation, extension elements) move to the new object.
    for (const child of [...getMany(old, 'documentation'), old.get('extensionElements')]) {
      if (child && typeof child === 'object') (child as ModdleElement).$parent = next;
    }

    const container = old.$parent!;
    const list = container.get('flowElements') as ModdleElement[];
    const index = list.indexOf(old);
    log.remove(list, old);
    log.insert(list, next, index);
    log.setParent(next, container);
    for (const flow of getMany(old, 'incoming')) log.set(flow, 'targetRef', next);
    for (const flow of getMany(old, 'outgoing')) log.set(flow, 'sourceRef', next);
    for (const lane of allLanes(container)) {
      const refs = lane.get('flowNodeRef') as ModdleElement[];
      const i = refs.indexOf(old);
      if (i >= 0) {
        log.remove(refs, old);
        log.insert(refs, next, i);
      }
    }
    log.set(shape.di, 'bpmnElement', next);
    if (is(next, 'bpmn:ExclusiveGateway')) log.set(shape.di, 'isMarkerVisible', true);
    const oldType = shape.type;
    log.apply(
      () => {
        shape.businessObject = next;
        shape.type = next.$type;
      },
      () => {
        shape.businessObject = old;
        shape.type = oldType;
        for (const child of [...getMany(old, 'documentation'), old.get('extensionElements')]) {
          if (child && typeof child === 'object') (child as ModdleElement).$parent = old;
        }
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

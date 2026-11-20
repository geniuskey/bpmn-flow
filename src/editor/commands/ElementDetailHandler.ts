/**
 * Undoable edits of element details that are not plain attributes:
 * - message flow: the message it carries (`messageRef`, found or created by name)
 * - loop / multi-instance characteristics: loop condition, maximum, test before,
 *   cardinality, completion condition and behavior (BPMN 2.0.2 §10.3.8)
 * - data state of data objects / stores / inputs / outputs (a contained bpmn:DataState)
 * - exclusive gateway marker visibility (DI isMarkerVisible)
 * - the Data Object a Data Object Reference shows (several references, one object)
 * - participant multiplicity of a pool, partition element of a lane
 * - DI fill / stroke colors (color:* and bioc:* extensions)
 */
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { conditionBlocker } from '@/bpmn/model/elements';
import {
  getMany,
  getRef,
  is,
  walkContainment,
  type BpmnModdleInstance,
  type ModdleElement,
} from '@/bpmn/model/moddle';
import { isCssColor, messageVisibleKind } from '@/bpmn/di/di';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import type { ElementDetail, LoopField } from '../types';

export const UPDATE_ELEMENT_DETAIL = 'element.updateDetail';

export const MI_BEHAVIORS = ['All', 'None', 'One', 'Complex'] as const;

/** What a call activity may call: a Process or a Global Task (§10.3.5, PDF 212). */
export const CALLABLE_TYPES = [
  'bpmn:Process',
  'bpmn:GlobalTask',
  'bpmn:GlobalUserTask',
  'bpmn:GlobalManualTask',
  'bpmn:GlobalScriptTask',
  'bpmn:GlobalBusinessRuleTask',
];

/** Every CategoryValue of the file's Categories (what groups depict, Table 8.22-8.23). */
export function categoryValues(definitions: ModdleElement): ModdleElement[] {
  return getMany(definitions, 'rootElements')
    .filter((r) => is(r, 'bpmn:Category'))
    .flatMap((c) => getMany(c, 'categoryValue'));
}

const STANDARD_FIELDS: LoopField[] = ['loopCondition', 'loopMaximum', 'testBefore'];
const MI_FIELDS: LoopField[] = ['loopCardinality', 'completionCondition', 'behavior'];
const EXPRESSIONS: LoopField[] = ['loopCondition', 'loopCardinality', 'completionCondition'];

/** Body of an expression-valued loop field, or the attribute value. */
export function loopFieldValue(loop: ModdleElement, field: LoopField): string {
  const value = loop.get(field);
  if (EXPRESSIONS.includes(field)) return (value as { body?: string } | undefined)?.body ?? '';
  return value === undefined || value === null ? '' : String(value);
}

/** Item-aware elements drawn with a state label (PDF 234, 237, 243, 245). */
export function hasDataState(el: ModdleElement | undefined): boolean {
  return (
    is(el, 'bpmn:DataObjectReference') ||
    is(el, 'bpmn:DataStoreReference') ||
    is(el, 'bpmn:DataInput') ||
    is(el, 'bpmn:DataOutput')
  );
}

/** Data Objects a reference may show: the ones of its own process or sub-process (PDF 233-234). */
export function dataObjectsFor(reference: ModdleElement): ModdleElement[] {
  return getMany(reference.$parent, 'flowElements').filter((f) => is(f, 'bpmn:DataObject'));
}

/** References that show `dataObject`. */
function referencesOf(definitions: ModdleElement, dataObject: ModdleElement): ModdleElement[] {
  const out: ModdleElement[] = [];
  walkContainment(definitions, (el) => {
    if (is(el, 'bpmn:DataObjectReference') && getRef(el, 'dataObjectRef') === dataObject) {
      out.push(el);
    }
  });
  return out;
}

interface Context {
  element: Element;
  detail: ElementDetail;
  log?: ChangeLog;
  created?: ModdleElement;
  /** Other elements to redraw (references sharing a data object). */
  affected?: Element[];
}

export default class ElementDetailHandler {
  static $inject = ['moddle', 'elementFactory', 'bpmnDefinitions', 'elementRegistry'];
  constructor(
    private readonly moddle: BpmnModdleInstance,
    private readonly factory: BpmnElementFactory,
    private readonly definitions: ModdleElement,
    private readonly registry?: ElementRegistry,
  ) {}

  execute(context: Context): Element[] {
    const target = bo(context.element);
    if (!target) return [];
    const log = new ChangeLog();
    const { detail } = context;

    if (detail.kind === 'message' && is(target, 'bpmn:MessageFlow')) {
      const name = detail.name.trim();
      // The envelope decorator is DI messageVisibleKind (BPMN 2.0.2 Table 12.35).
      const di = (context.element as { di?: ModdleElement }).di;
      if (!name) {
        log.set(target, 'messageRef', undefined);
        if (di?.get('messageVisibleKind') !== undefined)
          log.setExplicit(di, 'messageVisibleKind', undefined);
      } else {
        if (di && !messageVisibleKind(di)) {
          log.setExplicit(di, 'messageVisibleKind', 'initiating');
        }
        const roots = this.definitions.get('rootElements') as ModdleElement[];
        let message = roots.find((r) => is(r, 'bpmn:Message') && r.name === name);
        if (!message) {
          message = context.created ??= this.factory.createModdle('bpmn:Message', { name });
          message.set('name', name);
          log.insert(roots, message);
          log.setParent(message, this.definitions);
        }
        log.set(target, 'messageRef', message);
      }
    } else if (detail.kind === 'messageVisibleKind' && is(target, 'bpmn:MessageFlow')) {
      const di = (context.element as { di?: ModdleElement }).di;
      if (!di) throw new Error('The message flow is not drawn.');
      if (![undefined, 'initiating', 'non_initiating'].includes(detail.value)) {
        throw new Error(`Unknown message visible kind "${String(detail.value)}".`);
      }
      log.setExplicit(di, 'messageVisibleKind', detail.value);
    } else if (detail.kind === 'dataState' && hasDataState(target)) {
      // "<name> [<state>]" under the shape (PDF 234, 243, 245).
      const name = detail.name.trim();
      const current = getRef(target, 'dataState');
      if (!name) {
        if (current) log.set(target, 'dataState', undefined);
      } else if (current) {
        log.set(current, 'name', name);
      } else {
        const state = (context.created ??= this.factory.createModdle('bpmn:DataState', { name }));
        state.set('name', name);
        log.setParent(state, target);
        log.set(target, 'dataState', state);
      }
    } else if (detail.kind === 'markerVisible' && is(target, 'bpmn:ExclusiveGateway')) {
      const di = (context.element as { di?: ModdleElement }).di;
      if (!di) throw new Error('The gateway is not drawn.');
      if (typeof detail.value !== 'boolean')
        throw new Error('Marker visibility must be a boolean.');
      log.set(di, 'isMarkerVisible', detail.value);
    } else if (detail.kind === 'dataObject' && is(target, 'bpmn:DataObjectReference')) {
      this.setDataObject(context, target, detail.id, log);
    } else if (detail.kind === 'multiplicity' && is(target, 'bpmn:Participant')) {
      this.setMultiplicity(context, target, detail.value, log);
    } else if (detail.kind === 'partition' && is(target, 'bpmn:Lane')) {
      const name = detail.name.trim();
      const roots = this.definitions.get('rootElements') as ModdleElement[];
      const current = getRef(target, 'partitionElementRef');
      if (!name) {
        if (current) log.set(target, 'partitionElementRef', undefined);
      } else if (!current || current.name !== name) {
        // A lane partitions by a resource, e.g. a role or department (Table 10.135).
        let resource = roots.find((r) => is(r, 'bpmn:Resource') && r.name === name);
        if (!resource) {
          resource = context.created ??= this.factory.createModdle('bpmn:Resource', { name });
          resource.set('name', name);
          log.insert(roots, resource);
          log.setParent(resource, this.definitions);
        }
        log.set(target, 'partitionElementRef', resource);
      }
    } else if (
      detail.kind === 'newCalledElement' &&
      ((is(target, 'bpmn:CallChoreography') &&
        ['bpmn:GlobalChoreographyTask', 'bpmn:Choreography'].includes(detail.type)) ||
        (is(target, 'bpmn:CallConversation') &&
          ['bpmn:GlobalConversation', 'bpmn:Collaboration'].includes(detail.type)) ||
        (is(target, 'bpmn:CallActivity') && CALLABLE_TYPES.includes(detail.type)))
    ) {
      const roots = this.definitions.get('rootElements') as ModdleElement[];
      const called = (context.created ??= this.factory.createModdle(
        detail.type,
        detail.name?.trim() ? { name: detail.name.trim() } : {},
      ));
      log.insert(roots, called);
      log.setParent(called, this.definitions);
      if (is(target, 'bpmn:CallActivity')) {
        // calledElement is a QName attribute naming the process / global task (PDF 212).
        log.set(target, 'calledElement', called.id);
      } else {
        log.set(
          target,
          is(target, 'bpmn:CallChoreography') ? 'calledChoreographyRef' : 'calledCollaborationRef',
          called,
        );
      }
    } else if (detail.kind === 'colors') {
      this.setColors(context.element, detail, log);
    } else if (detail.kind === 'expression') {
      this.setExpression(target, detail, log);
    } else if (detail.kind === 'groupCategory' && is(target, 'bpmn:Group')) {
      this.setGroupCategory(context, target, detail.name, log);
    } else if (detail.kind === 'categoryValue' && is(target, 'bpmn:FlowElement')) {
      const value = categoryValues(this.definitions).find((v) => v.id === detail.id);
      if (!value) throw new Error(`No category value "${detail.id}".`);
      const list = target.get('categoryValueRef') as ModdleElement[];
      if (detail.assigned && !list.includes(value)) log.insert(list, value);
      if (!detail.assigned) log.remove(list, value);
    } else if (detail.kind === 'categorizeContents' && is(target, 'bpmn:Group')) {
      this.categorizeContents(context.element, target, log);
    } else if (detail.kind === 'loop') {
      const loop = getRef(target, 'loopCharacteristics');
      const standard = loop && is(loop, 'bpmn:StandardLoopCharacteristics');
      const allowed = standard ? STANDARD_FIELDS : MI_FIELDS;
      if (!loop || !allowed.includes(detail.field)) {
        throw new Error(`${detail.field} does not apply to this activity's loop.`);
      }
      log.set(loop, detail.field, this.loopValue(loop, detail.field, detail.value));
    } else {
      throw new Error(`Cannot apply ${detail.kind} to ${target.$type}.`);
    }
    context.log = log;
    return [context.element, ...(context.affected ?? [])];
  }

  /** DI fill / stroke colors, in both extension vocabularies (see readDiColors). */
  private setColors(
    element: Element,
    detail: Extract<ElementDetail, { kind: 'colors' }>,
    log: ChangeLog,
  ): void {
    const di = (element as { di?: ModdleElement }).di;
    const shape = is(di, 'bpmndi:BPMNShape');
    if (!di || !(shape || is(di, 'bpmndi:BPMNEdge'))) throw new Error('The element is not drawn.');
    const attributes = {
      fill: shape ? ['color:background-color', 'bioc:fill'] : [],
      stroke: ['color:border-color', 'bioc:stroke'],
    };
    for (const key of ['fill', 'stroke'] as const) {
      const value = detail[key];
      if (value === undefined) continue;
      if (key === 'fill' && !shape) throw new Error('Connections have no fill color.');
      if (value !== null && !isCssColor(value)) throw new Error(`"${value}" is not a color.`);
      // Through moddle's get/set: it stores `bioc:fill` as `fill`, so ChangeLog.set
      // (which reads the raw key) cannot see the current value.
      for (const name of attributes[key]) {
        const old = di.get(name);
        const next = value ?? undefined;
        if (old !== next)
          log.apply(
            () => di.set(name, next),
            () => di.set(name, old),
          );
      }
    }
  }

  /**
   * Sets an expression attribute: the condition of a sequence flow or the
   * activation condition of a complex gateway, as a natural-language
   * Expression or a FormalExpression with a language (PDF 112-114).
   */
  private setExpression(
    target: ModdleElement,
    detail: Extract<ElementDetail, { kind: 'expression' }>,
    log: ChangeLog,
  ): void {
    const { property } = detail;
    if (property === 'conditionExpression' && !is(target, 'bpmn:SequenceFlow')) {
      throw new Error('Only sequence flows have a condition expression.');
    }
    if (property === 'activationCondition' && !is(target, 'bpmn:ComplexGateway')) {
      throw new Error('Only complex gateways have an activation condition.');
    }
    const current = getRef(target, property);
    const body = detail.body.trim();
    if (!body) {
      if (current) log.set(target, property, undefined);
      return;
    }
    if (property === 'conditionExpression' && !current) {
      const blocker = conditionBlocker(target);
      if (blocker) throw new Error(blocker);
    }
    const language = detail.formal ? detail.language?.trim() || undefined : undefined;
    const type = detail.formal ? 'bpmn:FormalExpression' : 'bpmn:Expression';
    if (current && current.$type === type) {
      log.set(current, 'body', body);
      if (detail.formal) log.set(current, 'language', language);
      return;
    }
    // Another kind of expression: a new element, keeping the result type of a formal one.
    const expr = this.moddle.create(type, { body });
    if (language) expr.set('language', language);
    const typeRef = current && getRef(current, 'evaluatesToTypeRef');
    if (detail.formal && typeRef) expr.set('evaluatesToTypeRef', typeRef);
    expr.$parent = target;
    log.set(target, property, expr);
  }

  /**
   * Moves a group's CategoryValue into the Category named `name` (an existing
   * one is shared, otherwise the group's own category is renamed, or a new one
   * created). A category left without values is removed.
   */
  private setGroupCategory(
    context: Context,
    group: ModdleElement,
    rawName: string,
    log: ChangeLog,
  ): void {
    const name = rawName.trim() || undefined;
    const roots = this.definitions.get('rootElements') as ModdleElement[];
    let value = getRef(group, 'categoryValueRef');
    if (!value) {
      value = this.moddle.create('bpmn:CategoryValue', { id: `${group.id}_value` });
      log.set(group, 'categoryValueRef', value);
    }
    const current = is(value.$parent, 'bpmn:Category') ? value.$parent : undefined;
    if (current && (current.name || undefined) === name) return;
    const existing = name
      ? roots.find((r) => is(r, 'bpmn:Category') && r.name === name && r !== current)
      : undefined;
    if (!existing && current && getMany(current, 'categoryValue').length === 1) {
      log.set(current, 'name', name);
      return;
    }
    let dest = existing;
    if (!dest) {
      dest = context.created ??= this.factory.createModdle('bpmn:Category', name ? { name } : {});
      if (name) dest.set('name', name);
      log.insert(roots, dest);
      log.setParent(dest, this.definitions);
    }
    if (current) {
      log.remove(current.get('categoryValue') as ModdleElement[], value);
      if (!getMany(current, 'categoryValue').length) log.remove(roots, current);
    }
    log.insert(dest.get('categoryValue') as ModdleElement[], value);
    log.setParent(value, dest);
  }

  /** The group's CategoryValue goes to the flow elements within its bounds, and only to them. */
  private categorizeContents(groupShape: Element, group: ModdleElement, log: ChangeLog): void {
    const value = getRef(group, 'categoryValueRef');
    if (!value || !this.registry) throw new Error('The group has no category value.');
    const g = groupShape as Shape;
    const within = (s: Shape) =>
      s.x >= g.x &&
      s.y >= g.y &&
      s.x + s.width <= g.x + g.width &&
      s.y + s.height <= g.y + g.height;
    for (const el of this.registry.getAll() as Element[]) {
      const b = bo(el);
      if (!b || !is(b, 'bpmn:FlowElement') || el === groupShape) continue;
      const list = b.get('categoryValueRef') as ModdleElement[];
      const inside = (el as Connection).waypoints
        ? (el as Connection).waypoints.every(
            (p) => p.x >= g.x && p.y >= g.y && p.x <= g.x + g.width && p.y <= g.y + g.height,
          )
        : within(el as Shape);
      if (inside && !list.includes(value)) log.insert(list, value);
      else if (!inside && list.includes(value)) log.remove(list, value);
    }
  }

  /** Points a reference at another Data Object of its scope, or at a new one (null). */
  private setDataObject(
    context: Context,
    reference: ModdleElement,
    id: string | null,
    log: ChangeLog,
  ): void {
    const current = getRef(reference, 'dataObjectRef');
    const container = reference.$parent;
    if (!container) throw new Error('The data object reference is not in a process.');
    let next: ModdleElement;
    if (id === null) {
      next = context.created ??= this.factory.createModdle('bpmn:DataObject');
      if (!getMany(container, 'flowElements').includes(next)) {
        log.insert(container.get('flowElements') as ModdleElement[], next);
        log.setParent(next, container);
      }
    } else {
      const found = dataObjectsFor(reference).find((d) => d.id === id);
      if (!found) throw new Error('That data object is not visible from this reference.');
      next = found;
    }
    if (next === current) return;
    const before = current ? referencesOf(this.definitions, current) : [];
    log.set(reference, 'dataObjectRef', next);
    // The reference takes the name of a named data object it now shows.
    if (next.name && (!reference.name || reference.name === current?.name)) {
      log.set(reference, 'name', next.name);
    }
    // A data object no reference shows any more is removed with its last reference.
    if (current && before.length === 1 && current.$parent) {
      log.remove(current.$parent.get('flowElements') as ModdleElement[], current);
    }
    const shared = [...before, ...referencesOf(this.definitions, next)];
    context.affected = shared
      .map((r) => (r.id ? this.registry?.get(r.id) : undefined))
      .filter((e): e is Element => !!e && e !== context.element);
  }

  private setMultiplicity(
    context: Context,
    participant: ModdleElement,
    value: { minimum: number; maximum?: number } | undefined,
    log: ChangeLog,
  ): void {
    const current = getRef(participant, 'participantMultiplicity');
    if (!value) {
      if (current) log.set(participant, 'participantMultiplicity', undefined);
      return;
    }
    const { minimum, maximum } = value;
    // Table 9.5 (PDF 147): minimum >= 0, maximum >= 1 and not below the minimum.
    if (!Number.isInteger(minimum) || minimum < 0) {
      throw new Error('The minimum must be a whole number of at least 0.');
    }
    if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < Math.max(1, minimum))) {
      throw new Error('The maximum must be a whole number, at least 1 and not below the minimum.');
    }
    let multiplicity = current;
    if (!multiplicity) {
      multiplicity = context.created ??= this.moddle.create('bpmn:ParticipantMultiplicity');
      log.setParent(multiplicity, participant);
      log.set(participant, 'participantMultiplicity', multiplicity);
    }
    log.setExplicit(multiplicity, 'minimum', minimum);
    const record = multiplicity as unknown as Record<string, unknown>;
    if (maximum !== undefined) log.setExplicit(multiplicity, 'maximum', maximum);
    else if (Object.prototype.hasOwnProperty.call(record, 'maximum')) {
      // No maximum: any number of participants.
      const old = record.maximum;
      log.apply(
        () => delete record.maximum,
        () => multiplicity.set('maximum', old),
      );
    }
  }

  private loopValue(loop: ModdleElement, field: LoopField, raw: string | boolean): unknown {
    if (field === 'testBefore') {
      if (typeof raw !== 'boolean') throw new Error('testBefore must be true or false.');
      return raw || undefined;
    }
    const text = String(raw).trim();
    if (!text) return undefined;
    if (field === 'loopMaximum') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0) throw new Error('Loop maximum must be a whole number.');
      return n;
    }
    if (field === 'behavior') {
      if (!(MI_BEHAVIORS as readonly string[]).includes(text)) {
        throw new Error(`Unknown multi-instance behavior "${text}".`);
      }
      return text === 'All' ? undefined : text; // "All" is the default
    }
    const expr = this.moddle.create('bpmn:FormalExpression', { body: text });
    expr.$parent = loop;
    return expr;
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element, ...(context.affected ?? [])];
  }
}

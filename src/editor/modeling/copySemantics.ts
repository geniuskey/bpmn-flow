/**
 * Copies the BPMN semantics of an element onto a freshly created one (paste):
 * attributes, event definitions, loop characteristics, conditions and
 * documentation. Contained elements are cloned with new ids. References are
 * kept only when they point at root elements (messages, signals, errors,
 * operations, ...): references to flows and nodes belong to the original's
 * context (incoming/outgoing, default flow, boundary host, lanes) and are
 * re-created by the paste itself.
 */
import { isModdleElement, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';

/** Contained properties of a flow node or flow that a copy carries over. */
const COPIED_CHILDREN = new Set([
  'documentation',
  'eventDefinitions',
  'loopCharacteristics',
  'conditionExpression',
  'completionCondition',
]);

export interface CopyContext {
  moddle: BpmnModdleInstance;
  nextId(type: string): string;
}

function isRootElement(value: unknown): boolean {
  return isModdleElement(value) && !!value.$parent && value.$parent.$type === 'bpmn:Definitions';
}

function own(el: ModdleElement, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(el, name);
}

/** Deep clone of a contained element (all of its own properties). */
function cloneElement(el: ModdleElement, parent: ModdleElement, ctx: CopyContext): ModdleElement {
  const copy = ctx.moddle.create(el.$type, el.id ? { id: ctx.nextId(el.$type) } : {});
  copy.$parent = parent;
  const record = el as unknown as Record<string, unknown>;
  for (const prop of el.$descriptor.properties) {
    if (prop.name === 'id' || prop.isVirtual || !own(el, prop.name)) continue;
    const value = record[prop.name];
    if (prop.isReference) copy.set(prop.name, Array.isArray(value) ? value.slice() : value);
    else copy.set(prop.name, cloneValue(value, copy, ctx));
  }
  Object.assign(copy.$attrs, el.$attrs);
  return copy;
}

function cloneValue(value: unknown, parent: ModdleElement, ctx: CopyContext): unknown {
  if (Array.isArray(value)) return value.map((v) => cloneValue(v, parent, ctx));
  return isModdleElement(value) ? cloneElement(value, parent, ctx) : value;
}

export function copySemantics(
  source: ModdleElement,
  target: ModdleElement,
  ctx: CopyContext,
): void {
  const record = source as unknown as Record<string, unknown>;
  const targetProps = new Set(target.$descriptor.properties.map((p) => p.name));
  for (const prop of source.$descriptor.properties) {
    const { name } = prop;
    if (name === 'id' || prop.isVirtual || !own(source, name) || !targetProps.has(name)) continue;
    const value = record[name];
    if (prop.isReference) {
      const values = Array.isArray(value) ? value : [value];
      if (values.length && values.every(isRootElement)) {
        target.set(name, Array.isArray(value) ? value.slice() : value);
      }
    } else if (COPIED_CHILDREN.has(name)) {
      target.set(name, cloneValue(value, target, ctx));
    } else if (!isModdleElement(value) && !(Array.isArray(value) && value.some(isModdleElement))) {
      target.set(name, value); // plain attribute (isInterrupting, isForCompensation, ...)
    }
  }
  Object.assign(target.$attrs, source.$attrs);
}

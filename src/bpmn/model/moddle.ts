/**
 * Thin, typed facade over `bpmn-moddle`.
 *
 * The moddle object tree is the single source of truth (SSoT) for a document.
 * We never convert it to plain JSON and back; every read and write goes through
 * these live objects so unknown attributes (`$attrs`), extension elements and
 * references survive round-trips.
 */
import { BpmnModdle } from 'bpmn-moddle';

/** Minimal structural type for any moddle element. */
export interface ModdleElement {
  readonly $type: string;
  $parent?: ModdleElement;
  $attrs: Record<string, string>;
  id?: string;
  name?: string;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  $instanceOf(type: string): boolean;
  readonly $descriptor: ModdleDescriptor;
}

export interface ModdlePropertyDescriptor {
  name: string;
  ns: { name: string; prefix: string; localName: string };
  isMany?: boolean;
  isReference?: boolean;
  isAttr?: boolean;
  isBody?: boolean;
  isVirtual?: boolean;
  type: string;
}

export interface ModdleDescriptor {
  name: string;
  ns: { name: string; prefix: string; localName: string };
  properties: ModdlePropertyDescriptor[];
  isGeneric?: boolean;
}

/** Generic (unknown-namespace) element, e.g. children of `bpmn:extensionElements`. */
export interface GenericElement extends ModdleElement {
  $children?: GenericElement[];
  $body?: string;
}

export type BpmnModdleInstance = InstanceType<typeof BpmnModdle>;

export function createModdle(): BpmnModdleInstance {
  return new BpmnModdle();
}

export function isModdleElement(value: unknown): value is ModdleElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $type?: unknown }).$type === 'string' &&
    typeof (value as { $instanceOf?: unknown }).$instanceOf === 'function'
  );
}

/** `$instanceOf` check that also works for generic elements (exact type match). */
export function is(element: ModdleElement | undefined | null, type: string): boolean {
  if (!element) return false;
  if (element.$type === type) return true;
  try {
    return element.$instanceOf(type);
  } catch {
    return false;
  }
}

export function isAny(
  element: ModdleElement | undefined | null,
  types: readonly string[],
): boolean {
  return types.some((t) => is(element, t));
}

/** Reads a many-valued property as a typed array without creating it. */
export function getMany<T extends ModdleElement = ModdleElement>(
  element: ModdleElement | undefined,
  property: string,
): T[] {
  if (!element) return [];
  const value = (element as unknown as Record<string, unknown>)[property];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Reads a single-valued property that holds a moddle element (containment or reference). */
export function getRef<T extends ModdleElement = ModdleElement>(
  element: ModdleElement | undefined,
  property: string,
): T | undefined {
  if (!element) return undefined;
  const value = (element as unknown as Record<string, unknown>)[property];
  return isModdleElement(value) ? (value as T) : undefined;
}

/**
 * Walks every element reachable through containment (non-reference) properties,
 * including generic extension children. Visits each element once.
 */
export function walkContainment(root: ModdleElement, visit: (el: ModdleElement) => void): void {
  const seen = new Set<ModdleElement>();
  const stack: ModdleElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    visit(el);
    for (const child of containedChildren(el)) stack.push(child);
  }
}

export function containedChildren(el: ModdleElement): ModdleElement[] {
  const out: ModdleElement[] = [];
  const record = el as unknown as Record<string, unknown>;
  const descriptor = el.$descriptor;
  if (descriptor && !descriptor.isGeneric) {
    for (const prop of descriptor.properties) {
      if (prop.isReference || prop.isVirtual) continue;
      const value = record[prop.name];
      if (Array.isArray(value)) {
        for (const v of value) if (isModdleElement(v)) out.push(v);
      } else if (isModdleElement(value)) {
        out.push(value);
      }
    }
  }
  const children = (el as GenericElement).$children;
  if (Array.isArray(children)) {
    for (const c of children) if (isModdleElement(c)) out.push(c);
  }
  return out;
}

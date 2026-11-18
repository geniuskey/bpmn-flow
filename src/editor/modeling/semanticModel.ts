/** Shared state and helpers of the semantic sync: services, the displayed plane, DI and containment helpers. */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type { Element } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, rootOf, type BpmnData } from '../model';
import type BpmnElementFactory from './BpmnElementFactory';
import type { ChangeLog } from './ChangeLog';

type Cache = { bfCreated?: Record<string, ModdleElement> };

/** Name BPMN tools use for the placeholder target of data input associations. */
export const TARGET_REF_PLACEHOLDER = '__targetRef_placeholder';

export function isProcessDataIoType(type: string): boolean {
  return type === 'bpmn:DataInput' || type === 'bpmn:DataOutput';
}

export function isArtifact(el: ModdleElement): boolean {
  return is(el, 'bpmn:TextAnnotation') || is(el, 'bpmn:Group') || is(el, 'bpmn:Association');
}

export function listProperty(el: ModdleElement): 'artifacts' | 'flowElements' | 'conversations' {
  if (is(el, 'bpmn:ConversationNode')) return 'conversations';
  return isArtifact(el) ? 'artifacts' : 'flowElements';
}

/** The choreography that owns an activity (its participants live there). */
export function choreographyOf(el: ModdleElement): ModdleElement | undefined {
  for (let p = el.$parent; p; p = p.$parent) if (is(p, 'bpmn:Choreography')) return p;
  return undefined;
}

/** The collaboration on the diagram root, required for collaboration-level content. */
export function collaborationOf(root: Element): ModdleElement {
  const b = bo(root);
  if (!b || !is(b, 'bpmn:Collaboration')) {
    throw new Error('This element needs a collaboration (add a pool first).');
  }
  return b;
}

/** Services and model helpers shared by the shape and connection sync functions. */
export class SemanticModel {
  constructor(
    readonly canvas: Canvas,
    readonly factory: BpmnElementFactory,
    readonly definitions: ModdleElement,
  ) {}

  root(): Element {
    return rootOf(this.canvas);
  }

  plane(): ModdleElement {
    return (this.canvas.getRootElement() as unknown as BpmnData).di;
  }

  /** Creates (once per diagram element, reused on redo) a helper model object. */
  created(owner: Element, key: string, make: () => ModdleElement): ModdleElement {
    const cache = ((owner as Element & Cache).bfCreated ??= {});
    return (cache[key] ??= make());
  }

  addDi(element: Element, log: ChangeLog): void {
    const di = (element as Partial<BpmnData>).di;
    if (!di) return;
    const plane = this.plane();
    if (!getMany(plane, 'planeElement').includes(di)) {
      log.insert(plane.get('planeElement') as ModdleElement[], di);
      log.setParent(di, plane);
    }
  }

  removeDi(element: Element, log: ChangeLog): void {
    const di = (element as Partial<BpmnData>).di;
    if (di) log.remove(this.plane().get('planeElement') as ModdleElement[], di);
  }

  /**
   * Removes DI that other diagrams hold for a removed element and its content
   * (e.g. the drill-down diagram of a deleted collapsed sub-process), so no
   * diagram keeps pointing at something that is gone.
   */
  removeForeignDi(removed: ModdleElement[], log: ChangeLog): void {
    const gone = new Set<ModdleElement>();
    for (const element of removed) walkContainment(element, (el) => gone.add(el));
    const diagrams = this.definitions.get('diagrams') as ModdleElement[];
    for (const diagram of [...diagrams]) {
      const plane = getRef(diagram, 'plane');
      if (!plane) continue;
      const target = getRef(plane, 'bpmnElement');
      if (target && gone.has(target)) {
        log.remove(diagrams, diagram);
        continue;
      }
      const planeElements = plane.get('planeElement') as ModdleElement[];
      for (const di of [...planeElements]) {
        const element = getRef(di, 'bpmnElement');
        if (element && gone.has(element)) log.remove(planeElements, di);
      }
    }
  }

  insertInto(
    container: ModdleElement,
    property: string,
    item: ModdleElement,
    log: ChangeLog,
  ): void {
    log.insert(container.get(property) as ModdleElement[], item);
    log.setParent(item, container);
  }

  ensureRootElement(element: ModdleElement, log: ChangeLog): void {
    const roots = this.definitions.get('rootElements') as ModdleElement[];
    if (!roots.includes(element)) {
      log.insert(roots, element);
      log.setParent(element, this.definitions);
    }
  }
}

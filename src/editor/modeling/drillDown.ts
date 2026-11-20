/**
 * Drill-down diagrams: a collapsed sub-process (transaction, ad-hoc
 * sub-process, sub-choreography) draws its content in a BPMNDiagram of its
 * own whose plane references it (BPMN 2.0.2 §12.2.3.2, PDF 397; Table 12.39).
 * Each such diagram is a diagram-js root. A root whose BPMNDiagram was removed
 * from the definitions (undo, expand, delete) stays registered in the canvas
 * but is "dead": it is not listed and is reused when the element is collapsed
 * again.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type { Element } from 'diagram-js/lib/model/Types';
import { getMany, getRef, type ModdleElement } from '@/bpmn/model/moddle';
import { canExpand, type BpmnData, type BpmnRoot } from '../model';

/** Whether the BPMNDiagram of a diagram-js root is part of the document. */
export function isLiveRoot(definitions: ModdleElement, root: Element): boolean {
  const plane = (root as Partial<BpmnData>).di;
  return !!plane && getMany(definitions, 'diagrams').some((d) => getRef(d, 'plane') === plane);
}

/** The canvas root that draws the content of `element` (live or dead), if any. */
export function drillDownRootOf(
  canvas: Canvas,
  element: ModdleElement | undefined,
  definitions?: ModdleElement,
): BpmnRoot | undefined {
  if (!element || !canExpand(element)) return undefined;
  const root = (canvas.getRootElements() as unknown as BpmnRoot[]).find(
    (r) => r.businessObject === element && r.di?.$type === 'bpmndi:BPMNPlane',
  );
  if (!root) return undefined;
  return !definitions || isLiveRoot(definitions, root) ? root : undefined;
}

/** The diagram-js root that holds `el`. */
export function rootElementOf(el: Element): Element {
  let p = el;
  while (p.parent) p = p.parent;
  return p;
}

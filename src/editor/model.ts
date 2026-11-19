/**
 * Types for diagram-js elements that carry BPMN data.
 *
 * Every diagram element references the live moddle objects: `businessObject`
 * (semantic element) and `di` (BPMNShape/BPMNEdge/BPMNPlane). diagram-js keeps
 * geometry for interaction; the DiSync module writes it back to DI.
 */
import type { Connection, Element, Root, Shape } from 'diagram-js/lib/model/Types';
import { is, type ModdleElement } from '@/bpmn/model/moddle';

export interface BpmnData {
  businessObject: ModdleElement;
  di: ModdleElement;
  /** True when the element type is outside the MVP support matrix. */
  unsupported?: boolean;
  /** No DI `isExpanded`, but the file draws the content inside the shape (see isExpandedShape). */
  expandedByContent?: boolean;
}

export type BpmnShape = Shape & BpmnData;
export type BpmnConnection = Connection & BpmnData;
export type BpmnRoot = Root & BpmnData;
export type BpmnElement = BpmnShape | BpmnConnection | BpmnRoot;

export function isConnection(el: Element): el is BpmnConnection {
  return Array.isArray((el as Connection).waypoints);
}

export function isRoot(el: Element): boolean {
  return !el.parent;
}

/** Children of a shape or root (diagram-js types leave them untyped). */
export function childrenOf(el: Element | undefined): Element[] {
  return ((el as Shape | undefined)?.children ?? []) as Element[];
}

/** The canvas root as a regular element. */
export function rootOf(canvas: { getRootElement(): unknown }): Element {
  return canvas.getRootElement() as Element;
}

export function bo(el: Element): ModdleElement | undefined {
  return (el as Partial<BpmnData>).businessObject;
}

/** Element kinds whose BPMN DI `isExpanded` chooses between expanded and collapsed. */
export function canExpand(b: ModdleElement | undefined): boolean {
  return !!b && /^bpmn:(SubProcess|Transaction|AdHocSubProcess|SubChoreography)$/.test(b.$type);
}

/**
 * Expanded (content shown) or collapsed ([+] marker). BPMN 2.0.2 Table 12.10:
 * a missing `isExpanded` means collapsed. Files that omit it but draw the
 * content inside the shape are shown expanded, as their author drew them
 * (`expandedByContent`, set on import).
 */
export function isExpandedShape(el: Element): boolean {
  const b = bo(el);
  if (!b || !(is(b, 'bpmn:SubProcess') || is(b, 'bpmn:SubChoreography'))) return false;
  // The root of a sub-process's own diagram (a collapsed sub-process drilled into).
  if (!el.parent && (el as Partial<BpmnData>).di?.$type === 'bpmndi:BPMNPlane') return true;
  const value = (el as Partial<BpmnData>).di?.get('isExpanded');
  if (typeof value === 'boolean') return value;
  return (el as Partial<BpmnData>).expandedByContent === true;
}

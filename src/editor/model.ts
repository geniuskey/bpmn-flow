/**
 * Types for diagram-js elements that carry BPMN data.
 *
 * Every diagram element references the live moddle objects: `businessObject`
 * (semantic element) and `di` (BPMNShape/BPMNEdge/BPMNPlane). diagram-js keeps
 * geometry for interaction; the DiSync module writes it back to DI.
 */
import type { Connection, Element, Root, Shape } from 'diagram-js/lib/model/Types';
import type { ModdleElement } from '@/bpmn/model/moddle';

export interface BpmnData {
  businessObject: ModdleElement;
  di: ModdleElement;
  /** True when the element type is outside the MVP support matrix. */
  unsupported?: boolean;
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

/**
 * A structured, human-readable view of the data that round-trips must preserve:
 * ids, types, names, references, parent/child relations, DI geometry,
 * namespaces and extension content. Used by round-trip verification and tests.
 */
import { canonicalize, type Canonical } from './canonical';
import { getMany, getRef, is, walkContainment, type ModdleElement } from './moddle';
import { readBounds, readLabelBounds, readWaypoints, type Bounds, type Point } from '../di/di';

export interface ElementSnapshot {
  type: string;
  name?: string;
  parent?: string;
  source?: string;
  target?: string;
  attrs?: Record<string, string>;
  extensions?: Canonical;
  documentation?: string[];
}

export interface ShapeSnapshot {
  diId?: string;
  bounds?: Bounds;
  label?: Bounds;
  isHorizontal?: boolean;
  isExpanded?: boolean;
}

export interface EdgeSnapshot {
  diId?: string;
  waypoints: Point[];
  label?: Bounds;
}

export interface ModelSnapshot {
  namespaces: Record<string, string>;
  elements: Record<string, ElementSnapshot>;
  shapes: Record<string, ShapeSnapshot>;
  edges: Record<string, EdgeSnapshot>;
  laneMembership: Record<string, string[]>;
}

const DI_TYPES = ['bpmndi:BPMNDiagram', 'bpmndi:BPMNPlane', 'bpmndi:BPMNShape', 'bpmndi:BPMNEdge'];

function nearestIdentifiedParent(el: ModdleElement): string | undefined {
  let p = el.$parent;
  while (p && !p.id) p = p.$parent;
  return p?.id;
}

function isInsideExtension(el: ModdleElement): boolean {
  for (let p = el.$parent; p; p = p.$parent) if (is(p, 'bpmn:ExtensionElements')) return true;
  return false;
}

export function snapshotModel(definitions: ModdleElement): ModelSnapshot {
  const snap: ModelSnapshot = {
    namespaces: {},
    elements: {},
    shapes: {},
    edges: {},
    laneMembership: {},
  };

  for (const [key, value] of Object.entries(definitions.$attrs ?? {})) {
    if (key === 'xmlns' || key.startsWith('xmlns:')) snap.namespaces[value] = key;
  }

  walkContainment(definitions, (el) => {
    if (is(el, 'bpmndi:BPMNShape') || is(el, 'bpmndi:BPMNEdge')) {
      const target = getRef(el, 'bpmnElement')?.id ?? `<missing:${el.id}>`;
      if (is(el, 'bpmndi:BPMNEdge')) {
        snap.edges[target] = {
          diId: el.id,
          waypoints: readWaypoints(el),
          label: readLabelBounds(el),
        };
      } else {
        const shape: ShapeSnapshot = {
          diId: el.id,
          bounds: readBounds(el),
          label: readLabelBounds(el),
        };
        const isHorizontal = el.get('isHorizontal');
        if (typeof isHorizontal === 'boolean') shape.isHorizontal = isHorizontal;
        const isExpanded = el.get('isExpanded');
        if (typeof isExpanded === 'boolean') shape.isExpanded = isExpanded;
        snap.shapes[target] = shape;
      }
      return;
    }
    if (!el.id || DI_TYPES.includes(el.$type) || isInsideExtension(el)) return;

    const entry: ElementSnapshot = { type: el.$type };
    if (el.name !== undefined) entry.name = el.name;
    const parent = nearestIdentifiedParent(el);
    if (parent) entry.parent = parent;
    const source = getRef(el, 'sourceRef')?.id;
    if (source) entry.source = source;
    const target = getRef(el, 'targetRef')?.id;
    if (target) entry.target = target;
    if (el.$attrs && Object.keys(el.$attrs).length) entry.attrs = { ...el.$attrs };
    const ext = getRef(el, 'extensionElements');
    if (ext) entry.extensions = canonicalize(ext);
    const docs = getMany<ModdleElement & { text?: string }>(el, 'documentation');
    if (docs.length) entry.documentation = docs.map((d) => d.text ?? '');
    snap.elements[el.id] = entry;

    if (is(el, 'bpmn:Lane')) {
      snap.laneMembership[el.id] = getMany(el, 'flowNodeRef')
        .map((n) => n.id ?? '')
        .sort();
    }
  });

  return snap;
}

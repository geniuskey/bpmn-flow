/**
 * BPMN DI (Diagram Interchange) helpers: indexing DI by semantic element and
 * the few mutations the editor needs. All functions mutate live moddle objects.
 */
import { getMany, getRef, is, type BpmnModdleInstance, type ModdleElement } from '../model/moddle';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DiIndex {
  /** The diagram the editor displays (the first one). */
  diagram?: ModdleElement;
  plane?: ModdleElement;
  diagramCount: number;
  /** semantic element id -> BPMNShape */
  shapes: Map<string, ModdleElement>;
  /** semantic element id -> BPMNEdge */
  edges: Map<string, ModdleElement>;
  /** DI elements that point to the same semantic element as an earlier DI element. */
  duplicates: ModdleElement[];
  /** DI elements whose `bpmnElement` reference is missing. */
  dangling: ModdleElement[];
}

export function indexDi(definitions: ModdleElement): DiIndex {
  const diagrams = getMany(definitions, 'diagrams');
  const diagram = diagrams[0];
  const plane = getRef(diagram, 'plane');
  const index: DiIndex = {
    diagram,
    plane,
    diagramCount: diagrams.length,
    shapes: new Map(),
    edges: new Map(),
    duplicates: [],
    dangling: [],
  };
  for (const di of getMany(plane, 'planeElement')) {
    const target = getRef(di, 'bpmnElement');
    if (!target?.id) {
      index.dangling.push(di);
      continue;
    }
    const map = is(di, 'bpmndi:BPMNEdge') ? index.edges : index.shapes;
    if (map.has(target.id)) index.duplicates.push(di);
    else map.set(target.id, di);
  }
  return index;
}

export function readBounds(diShape: ModdleElement | undefined): Bounds | undefined {
  const b = getRef(diShape, 'bounds') as (ModdleElement & Partial<Bounds>) | undefined;
  if (!b) return undefined;
  return { x: b.x ?? 0, y: b.y ?? 0, width: b.width ?? 0, height: b.height ?? 0 };
}

export function readWaypoints(diEdge: ModdleElement | undefined): Point[] {
  return getMany<ModdleElement & Partial<Point>>(diEdge, 'waypoint').map((p) => ({
    x: p.x ?? 0,
    y: p.y ?? 0,
  }));
}

export function readLabelBounds(di: ModdleElement | undefined): Bounds | undefined {
  return readBounds(getRef(di, 'label'));
}

function sameBounds(a: Bounds | undefined, b: Bounds): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Writes bounds to a BPMNShape. Returns false if nothing changed. */
export function writeBounds(
  moddle: BpmnModdleInstance,
  diShape: ModdleElement,
  next: Bounds,
): boolean {
  const current = getRef(diShape, 'bounds');
  if (sameBounds(readBounds(diShape), next)) return false;
  if (current) {
    current.set('x', next.x);
    current.set('y', next.y);
    current.set('width', next.width);
    current.set('height', next.height);
  } else {
    const created = moddle.create('dc:Bounds', { ...next });
    created.$parent = diShape;
    diShape.set('bounds', created);
  }
  return true;
}

/** Shifts the BPMNLabel bounds of a DI element, if present. */
export function translateLabel(di: ModdleElement, dx: number, dy: number): boolean {
  if (!dx && !dy) return false;
  const bounds = getRef(getRef(di, 'label'), 'bounds') as
    (ModdleElement & Partial<Bounds>) | undefined;
  if (!bounds) return false;
  bounds.set('x', (bounds.x ?? 0) + dx);
  bounds.set('y', (bounds.y ?? 0) + dy);
  return true;
}

/** Replaces the waypoints of a BPMNEdge. Returns false if nothing changed. */
export function writeWaypoints(
  moddle: BpmnModdleInstance,
  diEdge: ModdleElement,
  next: Point[],
): boolean {
  const current = readWaypoints(diEdge);
  if (
    current.length === next.length &&
    current.every((p, i) => p.x === next[i]!.x && p.y === next[i]!.y)
  ) {
    return false;
  }
  const points = next.map((p) => {
    const point = moddle.create('dc:Point', { x: p.x, y: p.y });
    point.$parent = diEdge;
    return point;
  });
  diEdge.set('waypoint', points);
  return true;
}

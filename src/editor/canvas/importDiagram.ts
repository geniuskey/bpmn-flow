/**
 * Builds diagram-js elements from the moddle tree and its BPMN DI.
 *
 * Structure follows BPMN: a Collaboration root contains Participant shapes; the
 * participant's process content (lanes, flow nodes, flows) is parented to that
 * participant. A Process root contains its flow content directly.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementFactory from 'diagram-js/lib/core/ElementFactory';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type GraphicsFactory from 'diagram-js/lib/core/GraphicsFactory';
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import { connectionEnds, drawnEdgeEnds, indexDi, readBounds, readWaypoints } from '@/bpmn/di/di';
import { isEditableConnection, isEditableShapeElement } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { canExpand, isConnection, type BpmnRoot, type BpmnShape } from '../model';

import type { CanvasImportResult } from '../types';

export type { CanvasImportResult };

interface Services {
  canvas: Canvas;
  elementFactory: ElementFactory;
  elementRegistry: ElementRegistry;
  /** Redraws pools and lanes once their lanes are in (their header band follows them). */
  graphicsFactory?: GraphicsFactory;
}

function shapeOrder(bo: ModdleElement): number {
  if (is(bo, 'bpmn:Participant')) return 0;
  if (is(bo, 'bpmn:Lane')) {
    let depth = 1;
    for (let p = bo.$parent; p && !is(p, 'bpmn:Process'); p = p.$parent) depth++;
    return depth;
  }
  // Containers before their content; boundary events after their host.
  let depth = 0;
  for (let p = bo.$parent; p; p = p.$parent) if (is(p, 'bpmn:SubProcess')) depth++;
  return (is(bo, 'bpmn:BoundaryEvent') ? 300 : 100) + depth;
}

function owningProcess(bo: ModdleElement): ModdleElement | undefined {
  for (let p = bo.$parent; p; p = p.$parent) if (is(p, 'bpmn:Process')) return p;
  return undefined;
}

/** Shapes drawn below other content: pools, lanes, sub-processes, groups. */
function isContainerElement(el: Element): boolean {
  const b = (el as Partial<BpmnShape>).businessObject;
  return (
    !!b &&
    (is(b, 'bpmn:Participant') ||
      is(b, 'bpmn:Lane') ||
      is(b, 'bpmn:Group') ||
      is(b, 'bpmn:SubProcess') ||
      is(b, 'bpmn:SubChoreography'))
  );
}

const isEdge = (el: Element | undefined): boolean => !!el && isConnection(el);

function isSupportedShape(bo: ModdleElement): boolean {
  return isEditableShapeElement(bo) || is(bo, 'bpmn:Participant') || is(bo, 'bpmn:Lane');
}

export function importDiagram(
  { canvas, elementFactory, elementRegistry, graphicsFactory }: Services,
  definitions: ModdleElement,
): CanvasImportResult {
  const result: CanvasImportResult = { shapes: 0, connections: 0, warnings: [] };
  const di = indexDi(definitions);
  if (!di.plane || !getRef(di.plane, 'bpmnElement')) {
    result.warnings.push('No diagram to display.');
    return result;
  }

  // Every BPMN diagram becomes its own diagram-js root; the first one is shown.
  let first: BpmnRoot | undefined;
  di.planes.forEach((plane, index) => {
    const planeElement = getRef(plane, 'bpmnElement');
    if (!planeElement) {
      result.warnings.push(`Skipped diagram ${plane.id ?? index}: it has no BPMN element.`);
      return;
    }
    const root = elementFactory.createRoot({
      // Generic id: the root's business object changes when a process becomes a collaboration.
      id: index === 0 ? '__root' : `__root_${plane.id ?? index}`,
      businessObject: planeElement,
      di: plane,
    }) as BpmnRoot;
    if (index === 0) {
      canvas.setRootElement(root);
      first = root;
    } else {
      canvas.addRootElement(root);
    }
    importPlane(root, plane);
  });
  if (first) canvas.setRootElement(first);

  function rootOfElement(el: Element | undefined): Element | undefined {
    let p = el;
    while (p?.parent) p = p.parent;
    return p;
  }

  function importPlane(root: BpmnRoot, plane: ModdleElement): void {
    const participantByProcess = new Map<ModdleElement, Element>();

    const parentFor = (bo: ModdleElement): Element => {
      if (is(bo, 'bpmn:Participant')) return root;
      // Content of an expanded sub-process drawn in this diagram is parented to it.
      for (let p = bo.$parent; p; p = p.$parent) {
        if (p === root.businessObject) return root;
        if (is(p, 'bpmn:SubProcess') && p.id) {
          const container = elementRegistry.get(p.id) as Element | undefined;
          if (container && rootOfElement(container) === root) return container;
        }
        if (is(p, 'bpmn:Process')) break;
      }
      const process = owningProcess(bo);
      return (process && participantByProcess.get(process)) || root;
    };

    const planeElements = getMany(plane, 'planeElement');
    const isBand = (p: ModdleElement) => !!getRef(p, 'choreographyActivityShape');
    // Participant bands belong to their choreography activity (attached before drawing).
    const bandsByActivity = new Map<ModdleElement, ModdleElement[]>();
    for (const band of planeElements.filter(isBand)) {
      const activityDi = getRef(band, 'choreographyActivityShape')!;
      bandsByActivity.set(activityDi, [...(bandsByActivity.get(activityDi) ?? []), band]);
    }
    const shapes = planeElements
      .filter((p) => is(p, 'bpmndi:BPMNShape') && !isBand(p))
      .map((diShape, index) => ({ diShape, index, bo: getRef(diShape, 'bpmnElement') }))
      .filter((s): s is { diShape: ModdleElement; index: number; bo: ModdleElement } => !!s.bo)
      .sort((a, b) => shapeOrder(a.bo) - shapeOrder(b.bo) || a.index - b.index);

    // No DI isExpanded: collapsed per the spec (Table 12.10), unless this diagram
    // draws the content inside the shape.
    const drawnHere = new Set(shapes.map((s) => s.bo));
    const expandedByContent = (bo: ModdleElement, diShape: ModdleElement) =>
      canExpand(bo) &&
      typeof diShape.get('isExpanded') !== 'boolean' &&
      [...getMany(bo, 'flowElements'), ...getMany(bo, 'artifacts')].some((c) => drawnHere.has(c));

    for (const { diShape, bo } of shapes) {
      const id = bo.id;
      if (!id || elementRegistry.get(id)) {
        result.warnings.push(`Skipped duplicate diagram shape for ${id ?? '(no id)'}.`);
        continue;
      }
      const bounds = readBounds(diShape) ?? { x: 0, y: 0, width: 100, height: 80 };
      const shape = elementFactory.createShape({
        id,
        type: bo.$type,
        businessObject: bo,
        di: diShape,
        unsupported: !isSupportedShape(bo),
        ...(expandedByContent(bo, diShape) ? { expandedByContent: true } : {}),
        ...(bandsByActivity.has(diShape) ? { bands: bandsByActivity.get(diShape) } : {}),
        ...bounds,
      }) as BpmnShape;
      const host = is(bo, 'bpmn:BoundaryEvent')
        ? (elementRegistry.get(getRef(bo, 'attachedToRef')?.id ?? '') as BpmnShape | undefined)
        : undefined;
      // `host` is a bidirectional reference: setting it also adds to `host.attachers`.
      if (host) shape.host = host;
      canvas.addShape(shape, host?.parent ?? parentFor(bo));
      result.shapes++;

      if (is(bo, 'bpmn:Participant')) {
        const process = getRef(bo, 'processRef');
        if (process) participantByProcess.set(process, shape);
      }
    }

    // Pools and lanes are drawn before their lanes: draw those with lanes again.
    if (graphicsFactory) {
      for (const { bo } of shapes) {
        const hasLanes = is(bo, 'bpmn:Lane')
          ? getMany(getRef(bo, 'childLaneSet'), 'lanes').length > 0
          : is(bo, 'bpmn:Participant') &&
            getMany(getRef(bo, 'processRef'), 'laneSets').some((s) => getMany(s, 'lanes').length);
        const shape = hasLanes ? elementRegistry.get(bo.id!) : undefined;
        if (shape) graphicsFactory.update('shape', shape, elementRegistry.getGraphics(shape));
      }
    }

    // Plane order is the Z-order (BPMN 2.0.2 §12.2.1, PDF 398). Shapes keep the
    // order containers need (pools, lanes, sub-processes below their content,
    // boundary events above their host); edges go back to their place in the
    // file among their siblings, but never below a container they would vanish under.
    const fileIndex = new Map(planeElements.map((p, i) => [p, i]));
    const edgeIndexIn = (parent: Element, diEdge: ModdleElement): number | undefined => {
      const index = fileIndex.get(diEdge)!;
      const siblings = (parent as Shape).children ?? [];
      let lastContainer = -1;
      siblings.forEach((c, i) => {
        if (isContainerElement(c)) lastContainer = i;
      });
      const after = siblings.findIndex(
        (c, i) => i > lastContainer && (fileIndex.get((c as BpmnShape).di) ?? -1) > index,
      );
      return after < 0 ? undefined : after;
    };

    // Edges that end at another edge (an association to a message flow, PDF 92)
    // come after the edges they end at.
    const edges = planeElements.filter((p) => is(p, 'bpmndi:BPMNEdge'));
    const edgeTargets = new Set(edges.map((e) => getRef(e, 'bpmnElement')));
    const endsAtEdge = (diEdge: ModdleElement): boolean => {
      const bo = getRef(diEdge, 'bpmnElement');
      if (!bo) return false;
      const ends = drawnEdgeEnds(bo, diEdge);
      return edgeTargets.has(ends.source) || edgeTargets.has(ends.target);
    };
    const orderedEdges = [
      ...edges.filter((e) => !endsAtEdge(e)),
      ...edges.filter((e) => endsAtEdge(e)),
    ];

    for (const diEdge of orderedEdges) {
      const bo = getRef(diEdge, 'bpmnElement');
      const id = bo?.id;
      if (!bo || !id || elementRegistry.get(id)) {
        result.warnings.push(`Skipped diagram edge ${diEdge.id ?? ''}.`);
        continue;
      }
      // Drawn ends (BPMNEdge sourceElement / targetElement) when they are shown
      // here, otherwise the model ends.
      const drawn = drawnEdgeEnds(bo, diEdge);
      const model = connectionEnds(bo);
      const find = (a?: ModdleElement, b?: ModdleElement) =>
        (elementRegistry.get(a?.id ?? '') ?? elementRegistry.get(b?.id ?? '')) as
          Element | undefined;
      const source = find(drawn.source, model.source);
      const target = find(drawn.target, model.target);
      const connection = elementFactory.createConnection({
        id,
        type: bo.$type,
        businessObject: bo,
        di: diEdge,
        // An association may end at an editable sequence / message flow (PDF 95,
        // Fig 10.68); any other edge ending at an edge is shown read-only.
        unsupported:
          !isEditableConnection(bo) ||
          [source, target].some(
            (end) =>
              isEdge(end) &&
              (!is(bo, 'bpmn:Association') || !!(end as { unsupported?: boolean }).unsupported),
          ),
        waypoints: readWaypoints(diEdge),
        source,
        target,
      });
      const parent = is(bo, 'bpmn:SequenceFlow') ? (source?.parent ?? root) : root;
      canvas.addConnection(connection, parent, edgeIndexIn(parent, diEdge));
      result.connections++;
    }
  }

  return result;
}

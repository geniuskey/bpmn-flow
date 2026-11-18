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
import type { Element } from 'diagram-js/lib/model/Types';
import { indexDi, readBounds, readWaypoints } from '@/bpmn/di/di';
import { isEditableConnection, isEditableShapeElement } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import type { BpmnRoot, BpmnShape } from '../model';

export interface CanvasImportResult {
  shapes: number;
  connections: number;
  warnings: string[];
}

interface Services {
  canvas: Canvas;
  elementFactory: ElementFactory;
  elementRegistry: ElementRegistry;
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

function isSupportedShape(bo: ModdleElement): boolean {
  return isEditableShapeElement(bo) || is(bo, 'bpmn:Participant') || is(bo, 'bpmn:Lane');
}

/** Ends of a connection; data associations keep one end implicitly in their parent activity. */
function connectionEnds(bo: ModdleElement): { source?: ModdleElement; target?: ModdleElement } {
  if (is(bo, 'bpmn:DataInputAssociation')) {
    return { source: getMany(bo, 'sourceRef')[0], target: bo.$parent };
  }
  if (is(bo, 'bpmn:DataOutputAssociation')) {
    return { source: bo.$parent, target: getRef(bo, 'targetRef') };
  }
  return { source: getRef(bo, 'sourceRef'), target: getRef(bo, 'targetRef') };
}

export function importDiagram(
  { canvas, elementFactory, elementRegistry }: Services,
  definitions: ModdleElement,
): CanvasImportResult {
  const result: CanvasImportResult = { shapes: 0, connections: 0, warnings: [] };
  const di = indexDi(definitions);
  const planeElement = getRef(di.plane, 'bpmnElement');

  if (!di.plane || !planeElement) {
    result.warnings.push('No diagram to display.');
    return result;
  }

  const root = elementFactory.createRoot({
    // Generic id: the root's business object changes when a process becomes a collaboration.
    id: '__root',
    businessObject: planeElement,
    di: di.plane,
  }) as BpmnRoot;
  canvas.setRootElement(root);

  const participantByProcess = new Map<ModdleElement, Element>();

  const parentFor = (bo: ModdleElement): Element => {
    if (is(bo, 'bpmn:Participant')) return root;
    // Content of an expanded sub-process is parented to the sub-process shape.
    for (let p = bo.$parent; p; p = p.$parent) {
      if (is(p, 'bpmn:SubProcess') && p.id) {
        const container = elementRegistry.get(p.id) as Element | undefined;
        if (container) return container;
      }
      if (is(p, 'bpmn:Process')) break;
    }
    const process = owningProcess(bo);
    return (process && participantByProcess.get(process)) || root;
  };

  const planeElements = getMany(di.plane, 'planeElement');
  const shapes = planeElements
    .filter((p) => is(p, 'bpmndi:BPMNShape'))
    .map((diShape, index) => ({ diShape, index, bo: getRef(diShape, 'bpmnElement') }))
    .filter((s): s is { diShape: ModdleElement; index: number; bo: ModdleElement } => !!s.bo)
    .sort((a, b) => shapeOrder(a.bo) - shapeOrder(b.bo) || a.index - b.index);

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
      ...bounds,
    }) as BpmnShape;
    const host = is(bo, 'bpmn:BoundaryEvent')
      ? (elementRegistry.get(getRef(bo, 'attachedToRef')?.id ?? '') as BpmnShape | undefined)
      : undefined;
    if (host) {
      shape.host = host;
      host.attachers.push(shape);
    }
    canvas.addShape(shape, host?.parent ?? parentFor(bo));
    result.shapes++;

    if (is(bo, 'bpmn:Participant')) {
      const process = getRef(bo, 'processRef');
      if (process) participantByProcess.set(process, shape);
    }
  }

  for (const diEdge of planeElements.filter((p) => is(p, 'bpmndi:BPMNEdge'))) {
    const bo = getRef(diEdge, 'bpmnElement');
    const id = bo?.id;
    if (!bo || !id || elementRegistry.get(id)) {
      result.warnings.push(`Skipped diagram edge ${diEdge.id ?? ''}.`);
      continue;
    }
    const ends = connectionEnds(bo);
    const source = elementRegistry.get(ends.source?.id ?? '') as Element | undefined;
    const target = elementRegistry.get(ends.target?.id ?? '') as Element | undefined;
    const connection = elementFactory.createConnection({
      id,
      type: bo.$type,
      businessObject: bo,
      di: diEdge,
      unsupported: !isEditableConnection(bo),
      waypoints: readWaypoints(diEdge),
      source,
      target,
    });
    const parent = is(bo, 'bpmn:SequenceFlow') ? (source?.parent ?? root) : root;
    canvas.addConnection(connection, parent);
    result.connections++;
  }

  return result;
}

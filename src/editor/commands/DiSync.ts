/**
 * Writes diagram-js geometry back to BPMN DI after every command (execute,
 * undo and redo all emit `elements.changed`). Runs before graphics are
 * redrawn so the renderer sees updated label bounds.
 */
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Element } from 'diagram-js/lib/model/Types';
import { readBounds, scaleLabel, translateLabel, writeBounds, writeWaypoints } from '@/bpmn/di/di';
import type { BpmnModdleInstance } from '@/bpmn/model/moddle';
import { isConnection, type BpmnData, type BpmnShape } from '../model';
import { bandsOf, layoutBands } from '../modeling/choreography';
import { hasExternalLabel } from '../renderer/visuals';

export default class DiSync {
  static $inject = ['eventBus', 'moddle'];

  constructor(eventBus: EventBus, moddle: BpmnModdleInstance) {
    eventBus.on('elements.changed', 2000, (event: { elements: Element[] }) => {
      for (const element of event.elements) syncElement(moddle, element);
    });
  }
}

export function syncElement(moddle: BpmnModdleInstance, element: Element): void {
  const di = (element as Partial<BpmnData>).di;
  if (!di || !element.parent) return; // root / plane has no geometry
  if (isConnection(element)) {
    writeWaypoints(
      moddle,
      di,
      element.waypoints.map((p) => ({ x: p.x, y: p.y })),
    );
    return;
  }
  const shape = element as BpmnShape;
  const previous = readBounds(di);
  const changed = writeBounds(moddle, di, {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  });
  if (changed && previous) {
    const resized = previous.width !== shape.width || previous.height !== shape.height;
    if (resized && !hasExternalLabel(shape.businessObject)) scaleLabel(di, previous, shape);
    else translateLabel(di, shape.x - previous.x, shape.y - previous.y);
  }
  // Choreography activities: participant bands follow the activity.
  for (const [band, bounds] of layoutBands(shape, bandsOf(shape)))
    writeBounds(moddle, band, bounds);
}

/**
 * Connect tool: while active, pressing on a flow node and dragging to another
 * creates a sequence flow (instead of moving the node). Stays active until
 * another tool is chosen.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type Connect from 'diagram-js/lib/features/connect/Connect';
import type { Element } from 'diagram-js/lib/model/Types';
import { isEditableShapeElement } from '@/bpmn/model/elements';
import { is } from '@/bpmn/model/moddle';
import { bo } from '../model';

export default class ConnectTool {
  static $inject = ['eventBus', 'connect', 'canvas'];
  private active = false;

  constructor(
    eventBus: EventBus,
    connect: Connect,
    private readonly canvas: Canvas,
  ) {
    eventBus.on('element.mousedown', 2000, (e: { element: Element; originalEvent: MouseEvent }) => {
      if (!this.active || e.originalEvent.button !== 0) return;
      const b = bo(e.element);
      // Any editable shape can start a connection; the rules pick its type
      // (sequence, message, association or data association).
      if (!e.element.parent || !(isEditableShapeElement(b) || is(b, 'bpmn:Participant'))) return;
      connect.start(e.originalEvent, e.element);
      return true; // handled: do not start a move
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    const container = this.canvas.getContainer();
    container.classList.toggle('bf-connect-tool', active);
  }

  isActive(): boolean {
    return this.active;
  }
}

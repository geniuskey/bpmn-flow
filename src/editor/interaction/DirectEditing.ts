/**
 * Inline renaming: double-click (or F2 / Enter) opens a text box over the
 * element; Enter commits through the undoable `element.updateProperties`
 * command, Escape cancels, Shift+Enter inserts a line break.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { isEditableShapeElement, labelOf } from '@/bpmn/model/elements';
import { is } from '@/bpmn/model/moddle';
import { bo, type BpmnData } from '../model';
import { polylineMid } from '../renderer/geometry';
import { hasExternalLabel } from '../renderer/visuals';
import { UPDATE_PROPERTIES } from '../commands/UpdatePropertiesHandler';

export default class DirectEditing {
  static $inject = ['eventBus', 'canvas', 'commandStack'];
  private box: HTMLTextAreaElement | null = null;

  constructor(
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly commandStack: CommandStack,
  ) {
    eventBus.on('element.dblclick', (e: { element: Element }) => {
      if (this.canEdit(e.element)) this.activate(e.element);
    });
    eventBus.on(
      ['canvas.viewbox.changing', 'diagram.destroy', 'drag.init', 'commandStack.changed'],
      () => this.cancel(),
    );
  }

  canEdit(element: Element): boolean {
    const b = bo(element);
    if (!b || !element.parent || (element as Partial<BpmnData>).unsupported) return false;
    return (
      isEditableShapeElement(b) ||
      is(b, 'bpmn:SequenceFlow') ||
      is(b, 'bpmn:MessageFlow') ||
      is(b, 'bpmn:Participant') ||
      is(b, 'bpmn:Lane')
    );
  }

  isActive(): boolean {
    return !!this.box;
  }

  activate(element: Element): void {
    this.cancel();
    const b = bo(element)!;
    const vb = this.canvas.viewbox();
    const scale = vb.scale;
    let rect: { x: number; y: number; width: number; height: number };
    if ((element as Connection).waypoints) {
      const mid = polylineMid((element as Connection).waypoints);
      rect = { x: mid.x - 60, y: mid.y - 16, width: 120, height: 32 };
    } else {
      const s = element as Shape;
      if (is(b, 'bpmn:TextAnnotation')) rect = s;
      else if (hasExternalLabel(b))
        rect = { x: s.x + s.width / 2 - 60, y: s.y + s.height + 4, width: 120, height: 36 };
      else if (is(b, 'bpmn:Participant') || is(b, 'bpmn:Lane'))
        rect = { x: s.x, y: s.y, width: 160, height: 32 };
      else rect = s;
    }
    const box = document.createElement('textarea');
    box.className = 'bf-direct-editing';
    box.value = labelOf(b) ?? '';
    box.setAttribute('aria-label', 'Element name');
    Object.assign(box.style, {
      left: `${(rect.x - vb.x) * scale}px`,
      top: `${(rect.y - vb.y) * scale}px`,
      width: `${rect.width * scale}px`,
      height: `${rect.height * scale}px`,
      fontSize: `${12 * scale}px`,
    });
    const container = this.canvas.getContainer();
    container.appendChild(box);
    this.box = box;
    box.focus();
    box.select();

    const commit = () => {
      if (this.box !== box) return;
      const value = box.value.trim();
      this.close();
      if (value !== (labelOf(b) ?? '')) {
        this.commandStack.execute(UPDATE_PROPERTIES, {
          element,
          properties: { name: value || undefined },
        });
      }
    };
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    });
    box.addEventListener('blur', commit);
  }

  cancel(): void {
    this.close();
  }

  private close(): void {
    const box = this.box;
    this.box = null;
    box?.remove();
  }
}

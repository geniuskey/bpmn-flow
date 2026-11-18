/**
 * Click selects (design-tool convention). diagram-js toggles selection when a
 * selected element is clicked again, which also deselects on double-click.
 * Shift/Ctrl/Cmd-click still toggles via diagram-js' own handler.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Element } from 'diagram-js/lib/model/Types';

export default class ClickSelectsBehavior {
  static $inject = ['eventBus', 'selection', 'canvas'];

  constructor(eventBus: EventBus, selection: Selection, canvas: Canvas) {
    eventBus.on(
      'element.click',
      1500,
      (event: { element: Element; originalEvent?: MouseEvent }) => {
        const e = event.originalEvent;
        if (!e || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
        const element = event.element === canvas.getRootElement() ? null : event.element;
        if (element && selection.isSelected(element) && selection.get().length === 1) return false;
        return undefined;
      },
    );
  }
}

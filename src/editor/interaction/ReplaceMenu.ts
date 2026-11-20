/**
 * "Change type" popup menu (context pad): the same-family notation variants an
 * element can become, each shown with its real BPMN shape. Choosing one runs
 * `element.replace` (a single undo step).
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type PopupMenu from 'diagram-js/lib/features/popup-menu/PopupMenu';
import type { PopupMenuEntries } from 'diagram-js/lib/features/popup-menu/PopupMenuProvider';
import type { Element } from 'diagram-js/lib/model/Types';
import { REPLACE_ELEMENT } from '../commands/ReplaceHandler';
import { replaceOptions } from '../modeling/replace';
import { renderPreview } from '../renderer/preview';

export const REPLACE_MENU = 'bpmn-replace';

export default class ReplaceMenu {
  static $inject = ['popupMenu', 'commandStack', 'canvas'];

  constructor(
    private readonly popupMenu: PopupMenu,
    private readonly commandStack: CommandStack,
    private readonly canvas: Canvas,
  ) {
    popupMenu.registerProvider(REPLACE_MENU, this);
  }

  getPopupMenuEntries(target: Element): PopupMenuEntries {
    const entries: PopupMenuEntries = {};
    for (const { entry, group, preset } of replaceOptions(target)) {
      entries[`replace-${entry.id}`] = {
        label: entry.label,
        imageHtml: renderPreview(entry.preset, 22),
        group: { id: group.id, name: group.label },
        search: [entry.keywords ?? '', preset.type],
        action: () => this.commandStack.execute(REPLACE_ELEMENT, { element: target, preset }),
      };
    }
    return entries;
  }

  /** Opens the menu below the pointer, or below the element when opened from the keyboard. */
  open(element: Element, event?: Event): void {
    const mouse = event as MouseEvent | undefined;
    let x = mouse?.clientX ?? 0;
    let y = mouse?.clientY ?? 0;
    if (!x && !y) {
      const rect = this.canvas.getGraphics(element as never).getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    this.popupMenu.open(element, REPLACE_MENU, { x, y: y + 8, cursor: { x, y } } as never, {
      title: 'Change type',
      search: true,
      width: 320,
    });
  }
}

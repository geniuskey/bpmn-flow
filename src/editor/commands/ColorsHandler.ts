/**
 * DI colors of several elements as one undoable command (the properties panel
 * of a multi-selection). Each element goes through `element.updateDetail`, so
 * the single-element rules apply: connections only take a stroke color.
 */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type { Element } from 'diagram-js/lib/model/Types';
import { UPDATE_ELEMENT_DETAIL } from './ElementDetailHandler';

export const SET_COLORS = 'elements.colors';

export interface ColorChange {
  element: Element;
  fill?: string | null;
  stroke?: string | null;
}

export default class ColorsHandler {
  static $inject = ['commandStack'];

  constructor(private readonly commandStack: CommandStack) {}

  preExecute(context: { changes: ColorChange[] }): void {
    for (const { element, fill, stroke } of context.changes) {
      this.commandStack.execute(UPDATE_ELEMENT_DETAIL, {
        element,
        detail: { kind: 'colors', fill, stroke },
      });
    }
  }

  execute(): [] {
    return [];
  }

  revert(): [] {
    return [];
  }
}

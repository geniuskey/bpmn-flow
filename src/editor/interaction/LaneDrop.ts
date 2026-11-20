/**
 * A lane dragged from the palette is not created as a free shape: dropped on a
 * pool or lane, it runs the regular "add lane" command there (one undo step),
 * which keeps the pool's lanes stacked and its content in place.
 */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import { ADD_LANE } from '../commands/StructureHandlers';

const HIGH_PRIORITY = 2000;

export default class LaneDrop {
  static $inject = ['eventBus', 'commandStack'];

  constructor(eventBus: EventBus, commandStack: CommandStack) {
    eventBus.on(
      'create.end',
      HIGH_PRIORITY,
      (event: { context: { shape?: Shape; target?: Element; canExecute?: unknown } }) => {
        const { shape, target, canExecute } = event.context;
        if (!(shape as { bfAddLane?: boolean } | undefined)?.bfAddLane) return;
        if (canExecute && target) commandStack.execute(ADD_LANE, { target });
        return false; // never create the dragged lane shape itself
      },
    );
  }
}

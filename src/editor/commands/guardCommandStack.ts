/**
 * Makes a failing command recoverable.
 *
 * diagram-js' CommandStack has no error handling: when a handler or hook throws,
 * the half-done command stays on its in-progress list. From then on every edit
 * is treated as nested inside it: no `elements.changed` / `commandStack.changed`
 * events fire (the UI and DI sync stop updating) and all later edits merge into
 * one undo step.
 *
 * This wrapper catches errors at the top level, reverts the steps that the
 * failed command had already completed (newest first), clears the in-progress
 * state and reports the error. Changes the throwing handler made before it threw
 * cannot be reverted generically; handlers validate before they mutate.
 */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type EventBus from 'diagram-js/lib/core/EventBus';

interface Action {
  command: string;
  context: Record<string, unknown>;
}

interface Internals {
  _stack: Action[];
  _stackIdx: number;
  _currentExecution: {
    actions: Action[];
    dirty: unknown[];
    trigger: string | null;
    atomic?: boolean;
  };
  _getHandler(command: string): { revert?(context: unknown): unknown } | undefined;
}

export function guardCommandStack(
  commandStack: CommandStack,
  eventBus: EventBus,
  onError: (error: unknown) => void,
): void {
  const stack = commandStack as unknown as CommandStack & Internals;
  const execute = stack.execute.bind(stack);

  stack.execute = (command: string, context: Record<string, unknown>) => {
    // Nested calls (from handlers and hooks) are handled by the outermost one.
    if (stack._currentExecution.actions.length) return execute(command, context);
    const startIdx = stack._stackIdx;
    try {
      return execute(command, context);
    } catch (error) {
      const dirty: unknown[] = [...stack._currentExecution.dirty];
      for (let i = stack._stackIdx; i > startIdx; i--) {
        const action = stack._stack[i]!;
        try {
          const changed = stack._getHandler(action.command)?.revert?.(action.context);
          if (changed) dirty.push(...(Array.isArray(changed) ? changed : [changed]));
        } catch {
          // Keep reverting the remaining steps.
        }
      }
      // Only steps of the failed command are dropped; if none was logged, the redo
      // history above `startIdx` is still intact.
      if (stack._stackIdx > startIdx) stack._stack.length = startIdx + 1;
      stack._stackIdx = startIdx;
      stack._currentExecution = { actions: [], dirty: [], trigger: null, atomic: false };
      eventBus.fire('elements.changed', { elements: [...new Set(dirty)] });
      eventBus.fire('commandStack.changed', { trigger: 'clear' });
      onError(error);
      return undefined;
    }
  };
}

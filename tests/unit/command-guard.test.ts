/** A command that throws is rolled back and leaves the command stack usable. */
import { describe, expect, it, vi } from 'vitest';
import CommandStack from 'diagram-js/lib/command/CommandStack';
import EventBus from 'diagram-js/lib/core/EventBus';
import { guardCommandStack } from '@/editor/commands/guardCommandStack';

function setup() {
  const eventBus = new EventBus();
  const stack = new CommandStack(eventBus, {} as never);
  const log: string[] = [];
  const counter = { value: 0 };
  stack.register('inc', {
    execute: () => {
      counter.value++;
      return [];
    },
    revert: () => {
      counter.value--;
      return [];
    },
  });
  // Executes one nested `inc`, then fails in its own post-execute step.
  stack.register('incThenFail', {
    preExecute: () => stack.execute('inc', {}),
    execute: () => [],
    revert: () => [],
    postExecute: () => {
      throw new Error('boom');
    },
  });
  const onError = vi.fn();
  guardCommandStack(stack, eventBus, onError);
  eventBus.on('commandStack.changed', () => log.push('changed'));
  return { stack, counter, onError, log };
}

describe('guardCommandStack', () => {
  it('reverts the completed steps of a failing command and reports the error', () => {
    const { stack, counter, onError } = setup();
    stack.execute('inc', {});
    expect(counter.value).toBe(1);

    stack.execute('incThenFail', {});
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]![0] as Error).message).toBe('boom');
    expect(counter.value).toBe(1); // the nested inc was reverted

    // The stack still works: new edits are separate undo steps and fire events.
    stack.execute('inc', {});
    stack.execute('inc', {});
    expect(counter.value).toBe(3);
    stack.undo();
    expect(counter.value).toBe(2);
    stack.undo();
    stack.undo();
    expect(counter.value).toBe(0);
    expect(stack.canUndo()).toBe(false);
  });

  it('keeps change events flowing after a failure', () => {
    const { stack, log } = setup();
    stack.execute('incThenFail', {});
    log.length = 0;
    stack.execute('inc', {});
    expect(log).toEqual(['changed']);
  });

  it('keeps redo history when the failed command logged nothing', () => {
    const { stack, counter } = setup();
    stack.register('failFirst', {
      preExecute: () => {
        throw new Error('rejected');
      },
      execute: () => [],
    });
    stack.execute('inc', {});
    stack.undo();
    stack.execute('failFirst', {});
    expect(stack.canRedo()).toBe(true);
    stack.redo();
    expect(counter.value).toBe(1);
  });
});

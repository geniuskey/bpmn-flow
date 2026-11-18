import { describe, expect, it } from 'vitest';
import { createModdle } from '@/bpmn/model/moddle';
import { ChangeLog } from '@/editor/modeling/ChangeLog';

describe('ChangeLog', () => {
  it('reverts list and property mutations exactly, in reverse order', () => {
    const moddle = createModdle();
    const task = moddle.create('bpmn:Task', { id: 'T', name: 'Before' });
    const list = ['a', 'b', 'c'];
    const log = new ChangeLog();
    log.insert(list, 'x', 1);
    log.remove(list, 'a');
    log.replaceAll(list, ['z']);
    log.set(task, 'name', 'After');
    log.set(task, 'default', undefined);
    expect(list).toEqual(['z']);
    expect(task.name).toBe('After');
    log.undo();
    expect(list).toEqual(['a', 'b', 'c']);
    expect(task.name).toBe('Before');
    expect(Object.prototype.hasOwnProperty.call(task, 'default')).toBe(false);
  });

  it('restores removed items at their original position', () => {
    const list = [1, 2, 3, 4];
    const log = new ChangeLog();
    log.remove(list, 2);
    log.remove(list, 4);
    expect(list).toEqual([1, 3]);
    log.undo();
    expect(list).toEqual([1, 2, 3, 4]);
  });
});

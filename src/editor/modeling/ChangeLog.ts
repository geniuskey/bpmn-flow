/**
 * Records reversible mutations of the moddle tree. Semantic sync hooks run on
 * every execute/redo and log their inverse operations into the command context;
 * on undo the log is replayed backwards. This keeps undo exact without
 * snapshotting the model.
 */
import type { ModdleElement } from '@/bpmn/model/moddle';

export class ChangeLog {
  private ops: (() => void)[] = [];

  insert<T>(list: T[], item: T, index = list.length): void {
    const at = Math.max(0, Math.min(index, list.length));
    list.splice(at, 0, item);
    this.ops.push(() => {
      const i = list.indexOf(item);
      if (i >= 0) list.splice(i, 1);
    });
  }

  remove<T>(list: T[], item: T): number {
    const i = list.indexOf(item);
    if (i < 0) return -1;
    list.splice(i, 1);
    this.ops.push(() => list.splice(i, 0, item));
    return i;
  }

  /** Replaces the whole content of a list in place. */
  replaceAll<T>(list: T[], items: T[]): void {
    const old = list.slice();
    list.splice(0, list.length, ...items);
    this.ops.push(() => list.splice(0, list.length, ...old));
  }

  set(element: ModdleElement, key: string, value: unknown): void {
    const record = element as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(record, key);
    const old = record[key];
    if (old === value) return;
    element.set(key, value);
    this.ops.push(() => {
      if (had) element.set(key, old);
      else delete record[key];
    });
  }

  setParent(element: ModdleElement, parent: ModdleElement | undefined): void {
    const old = element.$parent;
    if (old === parent) return;
    element.$parent = parent;
    this.ops.push(() => {
      element.$parent = old;
    });
  }

  /** Runs an arbitrary action now and registers its inverse. */
  apply(action: () => void, inverse: () => void): void {
    action();
    this.ops.push(inverse);
  }

  undo(): void {
    for (let i = this.ops.length - 1; i >= 0; i--) this.ops[i]!();
    this.ops = [];
  }

  get size(): number {
    return this.ops.length;
  }
}

/**
 * Sets the loop behavior of an activity: none, standard loop, or
 * multi-instance (parallel / sequential). Switching between the two
 * multi-instance variants keeps the existing characteristics (cardinality,
 * collections, completion condition) and only flips `isSequential`.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';

export const SET_LOOP = 'activity.setLoop';

export type LoopKind = 'none' | 'standard' | 'parallel' | 'sequential';

export function loopKindOf(activity: ModdleElement): LoopKind {
  const loop = getRef(activity, 'loopCharacteristics');
  if (!loop) return 'none';
  if (is(loop, 'bpmn:StandardLoopCharacteristics')) return 'standard';
  return loop.get('isSequential') === true ? 'sequential' : 'parallel';
}

interface Context {
  element: Element;
  loop: LoopKind;
  created?: Record<string, ModdleElement>;
  log?: ChangeLog;
}

export default class LoopHandler {
  static $inject = ['elementFactory'];
  constructor(private readonly factory: BpmnElementFactory) {}

  execute(context: Context): Element[] {
    const activity = bo(context.element);
    if (!activity || !is(activity, 'bpmn:Activity')) return [];
    const log = new ChangeLog();
    const current = getRef(activity, 'loopCharacteristics');
    const create = (type: string) => {
      const cache = (context.created ??= {});
      const loop = (cache[type] ??= this.factory.createModdle(type));
      loop.$parent = activity;
      return loop;
    };
    if (context.loop === 'none') {
      log.set(activity, 'loopCharacteristics', undefined);
    } else if (context.loop === 'standard') {
      if (!current || !is(current, 'bpmn:StandardLoopCharacteristics')) {
        log.set(activity, 'loopCharacteristics', create('bpmn:StandardLoopCharacteristics'));
      }
    } else {
      let mi =
        current && is(current, 'bpmn:MultiInstanceLoopCharacteristics') ? current : undefined;
      if (!mi) {
        mi = create('bpmn:MultiInstanceLoopCharacteristics');
        log.set(activity, 'loopCharacteristics', mi);
      }
      log.set(mi, 'isSequential', context.loop === 'sequential' ? true : undefined);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

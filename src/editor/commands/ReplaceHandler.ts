/**
 * Turns an element into another notation variant (replace menu, inspector
 * "Type"): type, triggers and notation flags change in one undo step. Built
 * from the type and trigger commands (nested, so undo reverts them too) plus
 * the flags, which are logged here.
 */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type { Element } from 'diagram-js/lib/model/Types';
import { getMany, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, type BpmnShape } from '../model';
import { ChangeLog } from '../modeling/ChangeLog';
import { replaceBlocker } from '../modeling/replace';
import type { ShapePreset } from '../types';
import { CHANGE_TYPE } from './ChangeTypeHandler';
import { SET_EVENT_DEFINITION } from './EventDefinitionHandler';

export const REPLACE_ELEMENT = 'element.replace';

interface Context {
  element: Element;
  preset: ShapePreset;
  log?: ChangeLog;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

export default class ReplaceHandler {
  static $inject = ['commandStack'];
  constructor(private readonly commandStack: CommandStack) {}

  preExecute(context: Context): void {
    const { element, preset } = context;
    const blocker = replaceBlocker(element, preset);
    if (blocker) throw new Error(blocker);
    if (bo(element)!.$type !== preset.type) {
      this.commandStack.execute(CHANGE_TYPE, { element, newType: preset.type });
    }
  }

  /** Notation flags; set before the triggers so the trigger check sees the new position. */
  execute(context: Context): Element[] {
    const { preset } = context;
    const shape = context.element as BpmnShape;
    const target = bo(shape)!;
    const log = new ChangeLog();
    // Defaults (interrupting, not parallel, not instantiating) are written as "unset".
    const flag = (name: string, value: unknown) => log.setExplicit(target, name, value);
    if (is(target, 'bpmn:BoundaryEvent')) {
      flag('cancelActivity', preset.cancelActivity === false ? false : undefined);
    }
    if (is(target, 'bpmn:StartEvent')) {
      flag('isInterrupting', preset.isInterrupting === false ? false : undefined);
    }
    if (is(target, 'bpmn:CatchEvent')) {
      flag('parallelMultiple', preset.parallelMultiple ? true : undefined);
    }
    if (is(target, 'bpmn:ReceiveTask') || is(target, 'bpmn:EventBasedGateway')) {
      flag('instantiate', preset.instantiate ? true : undefined);
    }
    if (is(target, 'bpmn:EventBasedGateway')) {
      const parallel = preset.instantiate && preset.eventGatewayType === 'Parallel';
      flag('eventGatewayType', parallel ? 'Parallel' : undefined);
    }
    if (is(target, 'bpmn:SubProcess')) {
      flag('triggeredByEvent', preset.triggeredByEvent ? true : undefined);
    }
    if (is(target, 'bpmn:ExclusiveGateway')) {
      const visible = preset.isMarkerVisible !== false;
      if (shape.di.get('isMarkerVisible') !== visible)
        log.set(shape.di, 'isMarkerVisible', visible);
    }
    context.log = log;
    return [shape, ...shape.incoming, ...shape.outgoing];
  }

  postExecute(context: Context): void {
    const { element, preset } = context;
    const target = bo(element)!;
    if (!is(target, 'bpmn:Event')) return;
    const current = getMany(target, 'eventDefinitions').map((d: ModdleElement) => d.$type);
    const next = preset.eventDefinitions ?? [];
    if (!sameList(current, next)) {
      this.commandStack.execute(SET_EVENT_DEFINITION, { element, definitionTypes: [...next] });
    }
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    const shape = context.element;
    return [shape, ...shape.incoming, ...shape.outgoing];
  }
}

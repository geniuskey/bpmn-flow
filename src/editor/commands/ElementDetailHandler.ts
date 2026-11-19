/**
 * Undoable edits of element details that are not plain attributes:
 * - message flow: the message it carries (`messageRef`, found or created by name)
 * - loop / multi-instance characteristics: loop condition, maximum, test before,
 *   cardinality, completion condition and behavior (BPMN 2.0.2 §10.3.8)
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { getRef, is, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';
import { messageVisibleKind } from '@/bpmn/di/di';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import type { ElementDetail, LoopField } from '../types';

export const UPDATE_ELEMENT_DETAIL = 'element.updateDetail';

export const MI_BEHAVIORS = ['All', 'None', 'One', 'Complex'] as const;

const STANDARD_FIELDS: LoopField[] = ['loopCondition', 'loopMaximum', 'testBefore'];
const MI_FIELDS: LoopField[] = ['loopCardinality', 'completionCondition', 'behavior'];
const EXPRESSIONS: LoopField[] = ['loopCondition', 'loopCardinality', 'completionCondition'];

/** Body of an expression-valued loop field, or the attribute value. */
export function loopFieldValue(loop: ModdleElement, field: LoopField): string {
  const value = loop.get(field);
  if (EXPRESSIONS.includes(field)) return (value as { body?: string } | undefined)?.body ?? '';
  return value === undefined || value === null ? '' : String(value);
}

interface Context {
  element: Element;
  detail: ElementDetail;
  log?: ChangeLog;
  created?: ModdleElement;
}

export default class ElementDetailHandler {
  static $inject = ['moddle', 'elementFactory', 'bpmnDefinitions'];
  constructor(
    private readonly moddle: BpmnModdleInstance,
    private readonly factory: BpmnElementFactory,
    private readonly definitions: ModdleElement,
  ) {}

  execute(context: Context): Element[] {
    const target = bo(context.element);
    if (!target) return [];
    const log = new ChangeLog();
    const { detail } = context;

    if (detail.kind === 'message' && is(target, 'bpmn:MessageFlow')) {
      const name = detail.name.trim();
      // The envelope decorator is DI messageVisibleKind (BPMN 2.0.2 Table 12.35).
      const di = (context.element as { di?: ModdleElement }).di;
      if (!name) {
        log.set(target, 'messageRef', undefined);
        if (di?.get('messageVisibleKind') !== undefined)
          log.setExplicit(di, 'messageVisibleKind', undefined);
      } else {
        if (di && !messageVisibleKind(di)) {
          log.setExplicit(di, 'messageVisibleKind', 'initiating');
        }
        const roots = this.definitions.get('rootElements') as ModdleElement[];
        let message = roots.find((r) => is(r, 'bpmn:Message') && r.name === name);
        if (!message) {
          message = context.created ??= this.factory.createModdle('bpmn:Message', { name });
          message.set('name', name);
          log.insert(roots, message);
          log.setParent(message, this.definitions);
        }
        log.set(target, 'messageRef', message);
      }
    } else if (detail.kind === 'messageVisibleKind' && is(target, 'bpmn:MessageFlow')) {
      const di = (context.element as { di?: ModdleElement }).di;
      if (!di) throw new Error('The message flow is not drawn.');
      if (![undefined, 'initiating', 'non_initiating'].includes(detail.value)) {
        throw new Error(`Unknown message visible kind "${String(detail.value)}".`);
      }
      log.setExplicit(di, 'messageVisibleKind', detail.value);
    } else if (detail.kind === 'loop') {
      const loop = getRef(target, 'loopCharacteristics');
      const standard = loop && is(loop, 'bpmn:StandardLoopCharacteristics');
      const allowed = standard ? STANDARD_FIELDS : MI_FIELDS;
      if (!loop || !allowed.includes(detail.field)) {
        throw new Error(`${detail.field} does not apply to this activity's loop.`);
      }
      log.set(loop, detail.field, this.loopValue(loop, detail.field, detail.value));
    } else {
      throw new Error(`Cannot apply ${detail.kind} to ${target.$type}.`);
    }
    context.log = log;
    return [context.element];
  }

  private loopValue(loop: ModdleElement, field: LoopField, raw: string | boolean): unknown {
    if (field === 'testBefore') {
      if (typeof raw !== 'boolean') throw new Error('testBefore must be true or false.');
      return raw || undefined;
    }
    const text = String(raw).trim();
    if (!text) return undefined;
    if (field === 'loopMaximum') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0) throw new Error('Loop maximum must be a whole number.');
      return n;
    }
    if (field === 'behavior') {
      if (!(MI_BEHAVIORS as readonly string[]).includes(text)) {
        throw new Error(`Unknown multi-instance behavior "${text}".`);
      }
      return text === 'All' ? undefined : text; // "All" is the default
    }
    const expr = this.moddle.create('bpmn:FormalExpression', { body: text });
    expr.$parent = loop;
    return expr;
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}

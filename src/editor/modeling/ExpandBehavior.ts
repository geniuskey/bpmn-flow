/**
 * Behaviors around collapsed sub-processes:
 * - a collapsed sub-process created from the palette gets its own (empty)
 *   drill-down diagram, so its content can be modeled there
 * - a collapsed event sub-process shows the trigger of its start event
 *   (BPMN 2.0.2 PDF 204, Table 12.16): it is redrawn when that start event
 *   changes in the drill-down diagram
 */
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import { isEventSubProcess } from '@/bpmn/model/elements';
import { is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, canExpand, isExpandedShape, type BpmnData } from '../model';
import { SET_EXPANDED } from '../commands/ExpandHandler';
import { drillDownRootOf } from './drillDown';

export default class ExpandBehavior extends CommandInterceptor {
  static override $inject = [
    'eventBus',
    'canvas',
    'commandStack',
    'bpmnDefinitions',
    'elementRegistry',
  ];

  constructor(
    eventBus: EventBus,
    canvas: Canvas,
    commandStack: CommandStack,
    definitions: ModdleElement,
    elementRegistry: ElementRegistry,
  ) {
    super(eventBus);

    this.postExecute('shape.create', (e: { context: { shape: Shape } }) => {
      const shape = e.context.shape;
      const element = bo(shape);
      if (
        !element ||
        !canExpand(element) ||
        (shape as Partial<BpmnData>).di?.get('isExpanded') !== false ||
        drillDownRootOf(canvas, element, definitions)
      ) {
        return;
      }
      commandStack.execute(SET_EXPANDED, { shape, expanded: false });
    });

    eventBus.on('elements.changed', 1500, (event: { elements: Element[] }) => {
      const extra = new Set<Element>();
      for (const el of event.elements) {
        const b = bo(el);
        const sub = b && is(b, 'bpmn:StartEvent') ? b.$parent : undefined;
        if (!sub?.id || !isEventSubProcess(sub)) continue;
        const shape = elementRegistry.get(sub.id) as Element | undefined;
        if (shape?.parent && !isExpandedShape(shape) && !event.elements.includes(shape)) {
          extra.add(shape);
        }
      }
      if (extra.size) event.elements.push(...extra);
    });
  }
}

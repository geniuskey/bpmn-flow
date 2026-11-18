/**
 * Contextual toolbar next to the selected element: append the next step,
 * connect, rename, add lane, delete. Entries only appear when the action is
 * allowed for that element.
 */
import type ContextPad from 'diagram-js/lib/features/context-pad/ContextPad';
import type { ContextPadEntries } from 'diagram-js/lib/features/context-pad/ContextPadProvider';
import type Connect from 'diagram-js/lib/features/connect/Connect';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import type { Element, Shape } from 'diagram-js/lib/model/Types';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import { isEditableFlowNode } from '@/bpmn/model/elements';
import { getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ADD_LANE } from '../commands/StructureHandlers';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import { canAppend, deletable } from './BpmnFlowRules';
import type DirectEditing from './DirectEditing';
import { ICONS } from './icons';
import { findFreePosition } from './placement';

/** The extra diagram (drill-down plane) that draws a collapsed sub-process, if any. */
function canvasRootFor(canvas: Canvas, element: ModdleElement): string | null {
  if (!is(element, 'bpmn:SubProcess')) return null;
  const root = canvas
    .getRootElements()
    .find(
      (r) =>
        r.id !== '__root' && (r as { businessObject?: ModdleElement }).businessObject === element,
    );
  return root?.id ?? null;
}

function entry(icon: string, title: string, action: (event: Event) => void, group: string) {
  return {
    group,
    title,
    html: `<div class="entry" role="button" aria-label="${title}">${icon}</div>`,
    action: { click: action, dragstart: action },
  };
}

export default class BpmnContextPadProvider {
  static $inject = [
    'contextPad',
    'modeling',
    'elementFactory',
    'connect',
    'rules',
    'elementRegistry',
    'commandStack',
    'directEditing',
    'canvas',
    'eventBus',
  ];

  constructor(
    contextPad: ContextPad,
    private readonly modeling: Modeling,
    private readonly factory: BpmnElementFactory,
    private readonly connect: Connect,
    private readonly rules: Rules,
    private readonly registry: ElementRegistry,
    private readonly commandStack: CommandStack,
    private readonly directEditing: DirectEditing,
    private readonly canvas: Canvas,
    private readonly eventBus: EventBus,
  ) {
    contextPad.registerProvider(this);
  }

  private append(source: Shape, type: string): void {
    const shape = this.factory.createShape({ type });
    const position = findFreePosition(source, shape, this.registry);
    this.modeling.appendShape(source, shape, position, source.parent!);
  }

  getContextPadEntries(element: Element): ContextPadEntries {
    const entries: ContextPadEntries = {};
    const b = bo(element);
    if (!b) return entries;
    const shape = element as Shape;

    const unsupported = !!(element as { unsupported?: boolean }).unsupported;
    const appendable: [string, string, string][] = [
      ['append.task', 'bpmn:Task', 'Append task'],
      ['append.gateway', 'bpmn:ExclusiveGateway', 'Append exclusive gateway'],
      ['append.end', 'bpmn:EndEvent', 'Append end event'],
    ];
    const ICON_FOR: Record<string, string> = {
      'bpmn:Task': ICONS.task,
      'bpmn:ExclusiveGateway': ICONS.gateway,
      'bpmn:EndEvent': ICONS.endEvent,
    };
    // Only what the modeling rules allow: e.g. no task inside a choreography, no
    // sequence flow out of a link throw or compensation event.
    for (const [key, type, title] of appendable) {
      if (canAppend(element, type)) {
        entries[key] = entry(ICON_FOR[type]!, title, () => this.append(shape, type), 'append');
      }
    }
    if (isEditableFlowNode(b) && !is(b, 'bpmn:EndEvent') && !unsupported) {
      entries.connect = entry(
        ICONS.connect,
        'Connect to… (drag to target)',
        (event) => this.connect.start(event as MouseEvent, element, undefined, true),
        'connect',
      );
    }
    const drillDown = canvasRootFor(this.canvas, b);
    if (drillDown) {
      entries['drill-down'] = entry(
        ICONS.open,
        'Open sub-process diagram',
        () => this.eventBus.fire('bpmnflow.showDiagram', { rootId: drillDown }),
        'edit',
      );
    }
    if (this.directEditing.canEdit(element)) {
      entries.rename = entry(
        ICONS.edit,
        'Rename (F2)',
        () => this.directEditing.activate(element),
        'edit',
      );
    }
    if ((is(b, 'bpmn:Participant') && getRef(b, 'processRef')) || is(b, 'bpmn:Lane')) {
      entries['lane.add'] = entry(
        ICONS.laneBelow,
        'Add lane below',
        () => this.commandStack.execute(ADD_LANE, { target: element }),
        'edit',
      );
    }
    if (
      deletable([element]).length &&
      this.rules.allowed('elements.delete', { elements: [element] }) !== false
    ) {
      entries.delete = entry(
        ICONS.trash,
        'Delete (Del)',
        () => this.modeling.removeElements([element]),
        'delete',
      );
    }
    return entries;
  }
}

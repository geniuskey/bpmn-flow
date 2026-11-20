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
import { is, type ModdleElement } from '@/bpmn/model/moddle';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ADD_LANE } from '../commands/StructureHandlers';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import { canAddLaneTo, canAppend, deletable } from './BpmnFlowRules';
import { isHorizontal } from '../modeling/laneLayout';
import type DirectEditing from './DirectEditing';
import { ICONS } from './icons';
import { findFreePosition } from './placement';
import type ReplaceMenu from './ReplaceMenu';
import { replaceOptions } from '../modeling/replace';
import { drillDownRootOf } from '../modeling/drillDown';
import { expandBlocker, SET_EXPANDED } from '../commands/ExpandHandler';
import { isExpandedShape } from '../model';

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
    'replaceMenu',
    'bpmnDefinitions',
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
    private readonly replaceMenu: ReplaceMenu,
    private readonly definitions: ModdleElement,
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
    // Flow nodes start sequence and message flows (end events: message flows, data
    // associations); data and annotations start (data) associations.
    const connectable =
      isEditableFlowNode(b) ||
      is(b, 'bpmn:DataObjectReference') ||
      is(b, 'bpmn:DataStoreReference') ||
      is(b, 'bpmn:DataInput') ||
      is(b, 'bpmn:DataOutput') ||
      is(b, 'bpmn:TextAnnotation') ||
      is(b, 'bpmn:Group') ||
      is(b, 'bpmn:Message');
    if (connectable && !unsupported && element.parent) {
      entries.connect = entry(
        ICONS.connect,
        'Connect to… (drag to target)',
        (event) => this.connect.start(event as MouseEvent, element, undefined, true),
        'connect',
      );
    }
    const drillDown = element.parent
      ? drillDownRootOf(this.canvas, b, this.definitions)?.id
      : undefined;
    if (drillDown && !isExpandedShape(element)) {
      entries['drill-down'] = entry(
        ICONS.open,
        'Open sub-process diagram',
        () => this.eventBus.fire('bpmnflow.showDiagram', { rootId: drillDown }),
        'edit',
      );
    }
    const expand = !isExpandedShape(element);
    if (!expandBlocker(element, expand)) {
      entries[expand ? 'expand' : 'collapse'] = entry(
        expand ? ICONS.expand : ICONS.collapse,
        expand ? 'Expand (show content here)' : 'Collapse (content in its own diagram)',
        () => this.commandStack.execute(SET_EXPANDED, { shape: element, expanded: expand }),
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
    if (replaceOptions(element).length) {
      entries.replace = entry(
        ICONS.replace,
        'Change type',
        (event) => this.replaceMenu.open(element, event),
        'edit',
      );
    }
    if (!unsupported && canAddLaneTo(element)) {
      const horizontal = isHorizontal(element);
      entries['lane.add'] = entry(
        horizontal ? ICONS.laneBelow : ICONS.laneRight,
        horizontal ? 'Add lane below' : 'Add lane to the right',
        () => this.commandStack.execute(ADD_LANE, { target: element }),
        'edit',
      );
      // Nested lanes: a lane divided into sub-lanes (childLaneSet, PDF 334).
      if (is(b, 'bpmn:Lane')) {
        entries['lane.addSub'] = entry(
          ICONS.subLane,
          'Add sub-lane',
          () => this.commandStack.execute(ADD_LANE, { target: element, inside: true }),
          'edit',
        );
      }
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

/**
 * The BPMN support matrix for BPMN Flow. Keep in sync with docs/bpmn-support.md.
 */
import { getMany, getRef, is, type ModdleElement } from './moddle';

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
export const DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
export const DI_NS = 'http://www.omg.org/spec/DD/20100524/DI';

export const TASK_TYPES = [
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask',
  'bpmn:CallActivity',
] as const;

export const GATEWAY_TYPES = [
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway',
] as const;

export const EVENT_TYPES = [
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
] as const;

/** Flow nodes that can be displayed and edited. */
export const EDITABLE_FLOW_NODE_TYPES = [
  ...EVENT_TYPES,
  ...TASK_TYPES,
  ...GATEWAY_TYPES,
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess',
  'bpmn:ChoreographyTask',
  'bpmn:SubChoreography',
  'bpmn:CallChoreography',
] as const;

export const CHOREOGRAPHY_ACTIVITY_TYPES = [
  'bpmn:ChoreographyTask',
  'bpmn:SubChoreography',
  'bpmn:CallChoreography',
] as const;

export type EditableFlowNodeType = (typeof EDITABLE_FLOW_NODE_TYPES)[number];

export const EDITABLE_CONNECTION_TYPES = [
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
  'bpmn:ConversationLink',
] as const;

/** Conversation diagram nodes (drawn in a collaboration, linked to pools). */
export const CONVERSATION_TYPES = [
  'bpmn:Conversation',
  'bpmn:SubConversation',
  'bpmn:CallConversation',
] as const;

/** Artifacts and data elements that are shown and edited as shapes. */
export const EDITABLE_ARTIFACT_TYPES = [
  'bpmn:TextAnnotation',
  'bpmn:Group',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
] as const;

/**
 * Event definitions allowed per event type. An event with more than one is a
 * BPMN "Multiple" event (or "Parallel Multiple" when `parallelMultiple` is set).
 */
const TOP_LEVEL_START = [
  'bpmn:MessageEventDefinition',
  'bpmn:TimerEventDefinition',
  'bpmn:SignalEventDefinition',
  'bpmn:ConditionalEventDefinition',
] as const;

/** Every trigger a start event may have somewhere (see allowedEventDefinitions). */
export const EVENT_DEFINITIONS: Record<string, readonly string[]> = {
  'bpmn:StartEvent': [
    ...TOP_LEVEL_START,
    // Event sub-process triggers (BPMN 2.0.2 §10.5.2, PDF 271–272).
    'bpmn:ErrorEventDefinition',
    'bpmn:EscalationEventDefinition',
    'bpmn:CompensateEventDefinition',
  ],
  'bpmn:EndEvent': [
    'bpmn:MessageEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:ErrorEventDefinition',
    'bpmn:EscalationEventDefinition',
    'bpmn:CompensateEventDefinition',
    'bpmn:CancelEventDefinition',
    'bpmn:TerminateEventDefinition',
  ],
  'bpmn:IntermediateCatchEvent': [
    'bpmn:MessageEventDefinition',
    'bpmn:TimerEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:LinkEventDefinition',
    // Notation only (see NOTATION_ONLY_DEFINITIONS).
    'bpmn:EscalationEventDefinition',
  ],
  'bpmn:IntermediateThrowEvent': [
    'bpmn:MessageEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:EscalationEventDefinition',
    'bpmn:CompensateEventDefinition',
    'bpmn:LinkEventDefinition',
  ],
  'bpmn:BoundaryEvent': [
    'bpmn:MessageEventDefinition',
    'bpmn:TimerEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:ErrorEventDefinition',
    'bpmn:EscalationEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:CompensateEventDefinition',
    'bpmn:CancelEventDefinition',
  ],
};

/**
 * Triggers BPMN 2.0.2 draws but does not let one model: Table 12.22 (PDF 428)
 * shows a catching escalation intermediate event, while Table 10.89 has
 * escalation caught only by boundary events and event sub-process starts.
 * Files that have one are shown and editable; it is not offered when editing.
 */
export const NOTATION_ONLY_DEFINITIONS: Record<string, readonly string[]> = {
  'bpmn:IntermediateCatchEvent': ['bpmn:EscalationEventDefinition'],
};

export function isNotationOnlyDefinition(eventType: string, definitionType: string): boolean {
  return NOTATION_ONLY_DEFINITIONS[eventType]?.includes(definitionType) ?? false;
}

/** Event types that require a definition (a "none" variant does not exist). */
export const DEFINITION_REQUIRED = ['bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];

export const START_EVENT_DEFINITIONS = TOP_LEVEL_START;
export const END_EVENT_DEFINITIONS = EVENT_DEFINITIONS['bpmn:EndEvent']!;

/**
 * Every trigger an event type may have in some position. Files are editable when
 * their events stay within these; `allowedEventDefinitions` narrows the list to
 * what the event's position allows, for editing.
 */
export function supportedEventDefinitions(eventType: string): readonly string[] {
  return EVENT_DEFINITIONS[eventType] ?? [];
}

export function isEventSubProcess(el: ModdleElement | undefined): boolean {
  return is(el, 'bpmn:SubProcess') && el!.get('triggeredByEvent') === true;
}

/** Whether `container` (a process or sub-process) is, or lies inside, a transaction. */
function withinTransaction(container: ModdleElement | undefined): boolean {
  for (let p = container; p; p = p.$parent) {
    if (is(p, 'bpmn:Transaction')) return true;
    if (is(p, 'bpmn:Process')) return false;
  }
  return false;
}

/** Triggers that always interrupt (BPMN 2.0.2 Table 10.92 / PDF 272): error, cancel, compensation. */
const ALWAYS_INTERRUPTING = [
  'bpmn:ErrorEventDefinition',
  'bpmn:CancelEventDefinition',
  'bpmn:CompensateEventDefinition',
];

/** Whether `container` is, or lies inside, a choreography (or sub-choreography). */
export function withinChoreography(container: ModdleElement | undefined): boolean {
  for (let p = container; p; p = p.$parent) {
    if (is(p, 'bpmn:Choreography') || is(p, 'bpmn:SubChoreography')) return true;
    if (is(p, 'bpmn:Process') || is(p, 'bpmn:Definitions')) return false;
  }
  return false;
}

/**
 * Triggers events may have in a choreography (BPMN 2.0.2 Tables 11.6-11.8,
 * PDF 370-374): no message, error, escalation or compensation start, no
 * message, escalation, cancel, compensation or signal throw, only terminate
 * at the end. Boundary events on choreography activities: message (only on a
 * choreography task), timer, cancel, compensation, conditional and signal.
 */
const CHOREOGRAPHY_DEFINITIONS: Record<string, readonly string[]> = {
  'bpmn:StartEvent': [
    'bpmn:TimerEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:SignalEventDefinition',
  ],
  'bpmn:IntermediateCatchEvent': [
    'bpmn:TimerEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:LinkEventDefinition',
  ],
  'bpmn:IntermediateThrowEvent': ['bpmn:LinkEventDefinition'],
  'bpmn:EndEvent': ['bpmn:TerminateEventDefinition'],
  'bpmn:BoundaryEvent': [
    'bpmn:MessageEventDefinition',
    'bpmn:TimerEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:CompensateEventDefinition',
    'bpmn:CancelEventDefinition',
  ],
};

/** "Multiple" start events of a choreography combine only signals and timers (Table 11.6). */
const CHOREOGRAPHY_MULTIPLE_START = ['bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition'];

/**
 * Why the combination of `types` is not allowed on an event of `eventType` in
 * `container` (beyond the single triggers), or null.
 */
export function definitionCombinationProblem(
  eventType: string,
  types: readonly string[],
  container: ModdleElement | undefined,
): string | null {
  if (
    eventType === 'bpmn:StartEvent' &&
    types.length > 1 &&
    withinChoreography(container) &&
    !types.every((t) => CHOREOGRAPHY_MULTIPLE_START.includes(t))
  ) {
    return 'A multiple start event of a choreography combines only signal and timer triggers.';
  }
  return null;
}

/** Where an event is (or is about to be) placed, for `allowedEventDefinitionsIn`. */
export interface EventPlacement {
  /** The process or sub-process holding the event. */
  container?: ModdleElement;
  /** Start events: false for a non-interrupting event sub-process start. */
  isInterrupting?: boolean;
  /** Boundary events: false for a non-interrupting boundary event. */
  cancelActivity?: boolean;
  /** Boundary events: the activity they are attached to. */
  host?: ModdleElement;
}

/**
 * Triggers an event of `eventType` may have at `placement` (BPMN 2.0.2 §10.5):
 * - start events: top level message/timer/signal/conditional; event sub-process
 *   additionally error/escalation/compensation (non-interrupting: escalation
 *   only); embedded sub-process: none only (PDF 271)
 * - non-interrupting boundary events: no error, cancel or compensation (PDF 287)
 * - cancel end / boundary events only in / on a transaction (PDF 287, 291)
 */
export function allowedEventDefinitionsIn(
  eventType: string,
  placement: EventPlacement,
): readonly string[] {
  const all = supportedEventDefinitions(eventType);
  const { container } = placement;
  const choreographyHost = is(placement.host, 'bpmn:ChoreographyActivity');
  if (choreographyHost || (eventType !== 'bpmn:BoundaryEvent' && withinChoreography(container))) {
    let list = CHOREOGRAPHY_DEFINITIONS[eventType] ?? [];
    // A sub-choreography's start event has no trigger, like an embedded sub-process.
    if (eventType === 'bpmn:StartEvent' && is(container, 'bpmn:SubChoreography')) list = [];
    if (eventType === 'bpmn:BoundaryEvent') {
      // A message boundary event sits on a choreography task's receiving band (Table 11.7).
      if (!is(placement.host, 'bpmn:ChoreographyTask')) {
        list = list.filter((t) => t !== 'bpmn:MessageEventDefinition');
      }
      if (placement.cancelActivity === false) {
        list = list.filter((t) => !ALWAYS_INTERRUPTING.includes(t));
      }
    }
    return list;
  }
  if (eventType === 'bpmn:StartEvent') {
    if (isEventSubProcess(container)) {
      return placement.isInterrupting === false
        ? all.filter((t) => !ALWAYS_INTERRUPTING.includes(t))
        : all;
    }
    if (is(container, 'bpmn:SubProcess')) return [];
    return TOP_LEVEL_START;
  }
  if (eventType === 'bpmn:BoundaryEvent') {
    let list = all;
    if (placement.cancelActivity === false) {
      list = list.filter((t) => !ALWAYS_INTERRUPTING.includes(t));
    }
    if (!is(placement.host, 'bpmn:Transaction')) {
      list = list.filter((t) => t !== 'bpmn:CancelEventDefinition');
    }
    return list;
  }
  if (eventType === 'bpmn:EndEvent' && !withinTransaction(container)) {
    return all.filter((t) => t !== 'bpmn:CancelEventDefinition');
  }
  return all.filter((t) => !isNotationOnlyDefinition(eventType, t));
}

/** Triggers the event may have where it is (see `allowedEventDefinitionsIn`). */
export function allowedEventDefinitions(event: ModdleElement): readonly string[] {
  return allowedEventDefinitionsIn(event.$type, {
    container: event.$parent,
    isInterrupting: event.get('isInterrupting') as boolean | undefined,
    cancelActivity: event.get('cancelActivity') as boolean | undefined,
    host: event.get('attachedToRef') as ModdleElement | undefined,
  });
}

/** Whether an event of `eventType` in `container` needs a trigger (catch / boundary events, event sub-process starts). */
export function definitionRequiredIn(
  eventType: string,
  container: ModdleElement | undefined,
): boolean {
  return (
    DEFINITION_REQUIRED.includes(eventType) ||
    (eventType === 'bpmn:StartEvent' && isEventSubProcess(container))
  );
}

/** Whether the event needs a trigger: catch / boundary events, and event sub-process starts (PDF 204). */
export function definitionRequired(event: ModdleElement): boolean {
  return definitionRequiredIn(event.$type, event.$parent);
}

/** Error, cancel and compensation triggers always interrupt: the toggle does not apply. */
export function interruptingIsFixed(event: ModdleElement): boolean {
  return getMany(event, 'eventDefinitions').some((d) => ALWAYS_INTERRUPTING.includes(d.$type));
}

/**
 * Whether a sequence flow condition is allowed from `source` (BPMN 2.0.2
 * §10.5.1, PDF 125): activities, choreography activities (PDF 350) and
 * exclusive / inclusive / complex gateways.
 */
export function conditionAllowedFrom(source: ModdleElement | undefined): boolean {
  return (
    is(source, 'bpmn:Activity') ||
    is(source, 'bpmn:ChoreographyActivity') ||
    is(source, 'bpmn:ExclusiveGateway') ||
    is(source, 'bpmn:InclusiveGateway') ||
    is(source, 'bpmn:ComplexGateway')
  );
}

/**
 * The sequence flows entering (`incoming`) or leaving (`outgoing`) a flow
 * node: its own list and the flows of its container that name it (imported
 * files need not list a node's incoming / outgoing flows).
 */
export function sequenceFlowsAt(
  node: ModdleElement | undefined,
  key: 'incoming' | 'outgoing',
): ModdleElement[] {
  if (!node) return [];
  const end = key === 'incoming' ? 'targetRef' : 'sourceRef';
  const flows = new Set(getMany(node, key).filter((f) => is(f, 'bpmn:SequenceFlow')));
  for (const f of getMany(node.$parent, 'flowElements')) {
    if (is(f, 'bpmn:SequenceFlow') && getRef(f, end) === node) flows.add(f);
  }
  return [...flows];
}

/**
 * Why sequence flow `flow` cannot get a condition, or null when it can: only
 * flows out of activities and exclusive / inclusive / complex gateways are
 * conditional (PDF 125, 274), and a conditional flow out of an activity needs
 * at least one other outgoing sequence flow (PDF 125).
 */
export function conditionBlocker(flow: ModdleElement): string | null {
  const source = getRef(flow, 'sourceRef');
  if (!conditionAllowedFrom(source)) {
    return 'Only flows out of activities and exclusive, inclusive or complex gateways have conditions.';
  }
  const activity = is(source, 'bpmn:Activity') || is(source, 'bpmn:ChoreographyActivity');
  if (activity && sequenceFlowsAt(source, 'outgoing').length < 2) {
    return 'A conditional flow out of an activity needs another outgoing sequence flow.';
  }
  return null;
}

/** The process a flow element belongs to (through sub-processes). */
export function enclosingProcess(el: ModdleElement | undefined): ModdleElement | undefined {
  for (let p = el?.$parent; p; p = p.$parent) if (is(p, 'bpmn:Process')) return p;
  return undefined;
}

/**
 * Elements that may have a default flow (PDF 126): activities, exclusive /
 * inclusive / complex gateways. Choreography activities have no `default`
 * attribute in the BPMN 2.0.2 metamodel, although PDF 350 draws one.
 */
export function canHaveDefaultFlow(el: ModdleElement | undefined): boolean {
  return conditionAllowedFrom(el) && !is(el, 'bpmn:ChoreographyActivity');
}

export const CONTAINER_TYPES = [
  'bpmn:Process',
  'bpmn:Choreography',
  'bpmn:Collaboration',
  'bpmn:Participant',
  'bpmn:LaneSet',
  'bpmn:Lane',
] as const;

/**
 * Non-visual model elements that may appear inside supported elements and are
 * preserved untouched by the editor.
 */
export const PASSIVE_TYPES = [
  // Multi-instance pools / bands (marker drawn, values preserved).
  'bpmn:ParticipantMultiplicity',
  'bpmn:Definitions',
  'bpmn:Documentation',
  'bpmn:MessageEventDefinition',
  'bpmn:TimerEventDefinition',
  'bpmn:TerminateEventDefinition',
  'bpmn:SignalEventDefinition',
  'bpmn:ErrorEventDefinition',
  'bpmn:EscalationEventDefinition',
  'bpmn:ConditionalEventDefinition',
  'bpmn:LinkEventDefinition',
  'bpmn:CompensateEventDefinition',
  'bpmn:CancelEventDefinition',
  'bpmn:StandardLoopCharacteristics',
  'bpmn:MultiInstanceLoopCharacteristics',
  'bpmn:ComplexBehaviorDefinition',
  'bpmn:InputOutputSpecification',
  'bpmn:DataInput',
  'bpmn:DataOutput',
  'bpmn:InputSet',
  'bpmn:OutputSet',
  'bpmn:Assignment',
  'bpmn:Performer',
  'bpmn:HumanPerformer',
  'bpmn:PotentialOwner',
  'bpmn:ResourceRole',
  'bpmn:ResourceAssignmentExpression',
  'bpmn:ResourceParameterBinding',
  'bpmn:DataState',
  'bpmn:DataObject',
  'bpmn:CategoryValue',
  'bpmn:Property',
  'bpmn:ExtensionElements',
  'bpmn:FormalExpression',
  'bpmn:Expression',
  'bpmndi:BPMNDiagram',
  'bpmndi:BPMNPlane',
  'bpmndi:BPMNShape',
  'bpmndi:BPMNEdge',
  'bpmndi:BPMNLabel',
  'bpmndi:BPMNLabelStyle',
  'dc:Bounds',
  'dc:Point',
  'dc:Font',
] as const;

/**
 * Root elements (children of `bpmn:Definitions`) that the editor does not show
 * but which cannot be affected by MVP edits. They are preserved verbatim.
 */
export const PRESERVED_ROOT_TYPES = [
  'bpmn:Message',
  'bpmn:Signal',
  'bpmn:Error',
  'bpmn:Escalation',
  'bpmn:ItemDefinition',
  'bpmn:Category',
  'bpmn:Interface',
  'bpmn:DataStore',
  'bpmn:Resource',
  'bpmn:GlobalTask',
  'bpmn:GlobalUserTask',
  'bpmn:GlobalManualTask',
  'bpmn:GlobalScriptTask',
  'bpmn:GlobalBusinessRuleTask',
  'bpmn:GlobalChoreographyTask',
  'bpmn:GlobalConversation',
  'bpmn:PartnerEntity',
  'bpmn:PartnerRole',
  'bpmn:CorrelationProperty',
  'bpmn:EndPoint',
] as const;

export type ElementCategory = 'event' | 'activity' | 'gateway' | 'flow' | 'container' | 'other';

export function isEditableFlowNode(el: ModdleElement | undefined): boolean {
  if (!el) return false;
  if (!(EDITABLE_FLOW_NODE_TYPES as readonly string[]).includes(el.$type)) return false;
  // Events support none, one, or several ("Multiple") definitions from the supported list.
  if (is(el, 'bpmn:Event')) {
    // Shared definitions (eventDefinitionRef) are not shown or edited yet.
    if (getMany(el, 'eventDefinitionRef').length) return false;
    const allowed = supportedEventDefinitions(el.$type);
    if (getMany(el, 'eventDefinitions').some((d) => !allowed.includes(d.$type))) return false;
  }
  return true;
}

/**
 * The triggers of an event: its own definitions and the shared ones it
 * references (`eventDefinitionRef`, BPMN 2.0.2 Tables 10.82-10.83, PDF
 * 265-266). Both count for the marker (single, Multiple, Parallel Multiple).
 */
export function eventTriggers(el: ModdleElement | undefined): ModdleElement[] {
  return [...getMany(el, 'eventDefinitions'), ...getMany(el, 'eventDefinitionRef')];
}

/**
 * An event that uses shared definitions (`eventDefinitionRef`) whose triggers
 * the editor knows: drawn with its BPMN notation, but not edited.
 */
export function isSharedDefinitionEvent(el: ModdleElement | undefined): boolean {
  if (!el || !is(el, 'bpmn:Event') || !getMany(el, 'eventDefinitionRef').length) return false;
  if (!(EDITABLE_FLOW_NODE_TYPES as readonly string[]).includes(el.$type)) return false;
  const allowed = supportedEventDefinitions(el.$type);
  return eventTriggers(el).every((d) => allowed.includes(d.$type));
}

/** Process data inputs / outputs (drawn as data objects with an arrow). */
export const PROCESS_DATA_IO_TYPES = ['bpmn:DataInput', 'bpmn:DataOutput'] as const;

/**
 * A data input / output of a process (not of a task). Only these are drawn; the
 * ones of activities stay invisible in their I/O specification.
 */
export function isProcessDataIo(el: ModdleElement | undefined): boolean {
  if (!el || !(PROCESS_DATA_IO_TYPES as readonly string[]).includes(el.$type)) return false;
  // Not placed yet (palette preview): it will be added to a process.
  if (!el.$parent) return true;
  return is(el.$parent, 'bpmn:InputOutputSpecification') && is(el.$parent.$parent, 'bpmn:Process');
}

/**
 * A Message drawn as its own envelope shape (BPMN 2.0.2 §8.4.11, PDF 121-122,
 * Fig 8.26-8.28): a root element of the definitions (or not placed yet).
 */
export function isMessageShapeElement(el: ModdleElement | undefined): boolean {
  return !!el && el.$type === 'bpmn:Message' && (!el.$parent || is(el.$parent, 'bpmn:Definitions'));
}

export function isEditableArtifact(el: ModdleElement | undefined): boolean {
  return (
    !!el &&
    ((EDITABLE_ARTIFACT_TYPES as readonly string[]).includes(el.$type) ||
      isProcessDataIo(el) ||
      isMessageShapeElement(el))
  );
}

/** Any element the editor can show and edit as a shape (besides pools and lanes). */
export function isChoreographyActivity(el: ModdleElement | undefined): boolean {
  return !!el && (CHOREOGRAPHY_ACTIVITY_TYPES as readonly string[]).includes(el.$type);
}

export function isConversationNode(el: ModdleElement | undefined): boolean {
  return !!el && (CONVERSATION_TYPES as readonly string[]).includes(el.$type);
}

export function isEditableShapeElement(el: ModdleElement | undefined): boolean {
  return isEditableFlowNode(el) || isEditableArtifact(el) || isConversationNode(el);
}

export function isEditableConnection(el: ModdleElement | undefined): boolean {
  return !!el && (EDITABLE_CONNECTION_TYPES as readonly string[]).includes(el.$type);
}

export function categoryOf(el: ModdleElement): ElementCategory {
  if (is(el, 'bpmn:Event')) return 'event';
  if (is(el, 'bpmn:Activity')) return 'activity';
  if (is(el, 'bpmn:Gateway')) return 'gateway';
  if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association'))
    return 'flow';
  if ((CONTAINER_TYPES as readonly string[]).includes(el.$type)) return 'container';
  return 'other';
}

/** The user-visible label of an element (name, annotation text or group category value). */
export function labelOf(el: ModdleElement): string | undefined {
  if (is(el, 'bpmn:TextAnnotation')) return (el as ModdleElement & { text?: string }).text;
  if (is(el, 'bpmn:Group')) {
    const value = el.get('categoryValueRef') as (ModdleElement & { value?: string }) | undefined;
    return value?.value;
  }
  return el.name;
}

/**
 * A group's label: "the value of the CategoryValue, optionally prepended by
 * the Category name and delineator ':'" (BPMN 2.0.2 PDF 98). The Category
 * name is shown when the category has one.
 */
export function groupLabel(group: ModdleElement): string | undefined {
  const value = getRef(group, 'categoryValueRef');
  const text = value?.get('value') as string | undefined;
  if (!text) return undefined;
  const category = is(value!.$parent, 'bpmn:Category') ? value!.$parent!.name : undefined;
  return category ? `${category}: ${text}` : text;
}

/**
 * The text a Text Annotation shows. Its textFormat is a MIME type, text/plain
 * by default (Table 8.24, PDF 100); HTML / XML text is shown without markup.
 */
export function annotationText(annotation: ModdleElement): string | undefined {
  const text = (annotation as ModdleElement & { text?: string }).text;
  const format = (annotation.get('textFormat') as string | undefined) ?? 'text/plain';
  if (!text || !/html|xml/i.test(format)) return text;
  return text
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "bpmn:UserTask" -> "User Task" */
export function humanizeType(type: string): string {
  const local = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type;
  return local.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** BPMN "Multiple" trigger: the event has more than one event definition. */
export function isMultipleEvent(el: ModdleElement): boolean {
  return is(el, 'bpmn:Event') && getMany(el, 'eventDefinitions').length > 1;
}

/** Catching events may be "Parallel Multiple" (all triggers required). */
export function canBeParallelMultiple(el: ModdleElement): boolean {
  return (
    is(el, 'bpmn:StartEvent') ||
    is(el, 'bpmn:IntermediateCatchEvent') ||
    is(el, 'bpmn:BoundaryEvent')
  );
}

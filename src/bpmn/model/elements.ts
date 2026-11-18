/**
 * The BPMN support matrix for BPMN Flow. Keep in sync with docs/bpmn-support.md.
 */
import { getMany, is, type ModdleElement } from './moddle';

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
export const EVENT_DEFINITIONS: Record<string, readonly string[]> = {
  'bpmn:StartEvent': [
    'bpmn:MessageEventDefinition',
    'bpmn:TimerEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:ConditionalEventDefinition',
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

/** Event types that require a definition (a "none" variant does not exist). */
export const DEFINITION_REQUIRED = ['bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];

export const START_EVENT_DEFINITIONS = EVENT_DEFINITIONS['bpmn:StartEvent']!;
export const END_EVENT_DEFINITIONS = EVENT_DEFINITIONS['bpmn:EndEvent']!;

export function supportedEventDefinitions(eventType: string): readonly string[] {
  return EVENT_DEFINITIONS[eventType] ?? [];
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
    const allowed = supportedEventDefinitions(el.$type);
    if (getMany(el, 'eventDefinitions').some((d) => !allowed.includes(d.$type))) return false;
  }
  return true;
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

export function isEditableArtifact(el: ModdleElement | undefined): boolean {
  return (
    !!el &&
    ((EDITABLE_ARTIFACT_TYPES as readonly string[]).includes(el.$type) || isProcessDataIo(el))
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

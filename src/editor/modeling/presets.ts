/**
 * Shape presets: a BPMN type plus the attributes that select one notation
 * variant (trigger, interrupting, instantiate, collection, ...). The palette
 * creates elements from presets, the replace menu turns an element into one,
 * and `presetOf` reads the preset an element currently matches.
 */
import {
  getMany,
  getRef,
  is,
  type BpmnModdleInstance,
  type ModdleElement,
} from '@/bpmn/model/moddle';
import { supportedEventDefinitions } from '@/bpmn/model/elements';
import type { LoopKind, ShapePreset } from '../types';

export type { ShapePreset };

/** Event types that need a definition get this one when the preset has none. */
const DEFAULT_DEFINITION: Record<string, string> = {
  'bpmn:IntermediateCatchEvent': 'bpmn:TimerEventDefinition',
  'bpmn:BoundaryEvent': 'bpmn:TimerEventDefinition',
};

export interface PresetServices {
  moddle: BpmnModdleInstance;
  /** Creates a model element with a fresh id (where the type has ids). */
  create(type: string, attrs?: Record<string, unknown>): ModdleElement;
}

export interface BuiltElement {
  businessObject: ModdleElement;
  di: ModdleElement;
  /** Helper objects created with the element, added to the model on create (see shapeSync). */
  created: Record<string, ModdleElement>;
}

/**
 * Creates the business object and DI shape for a preset. Helper objects that
 * live elsewhere in the model (the data object of a reference, the global task
 * a call activity calls) are returned in `created`; the create command adds
 * them to the model, so undo removes them again.
 */
export function buildFromPreset(services: PresetServices, preset: ShapePreset): BuiltElement {
  const { type } = preset;
  const bo = services.create(type);
  const di = services.moddle.create('bpmndi:BPMNShape', { id: `${bo.id}_di`, bpmnElement: bo });
  const created: Record<string, ModdleElement> = {};
  if (type === 'bpmn:Participant' || type === 'bpmn:Lane') {
    di.set('isHorizontal', preset.isHorizontal !== false);
  }
  if (type === 'bpmn:ExclusiveGateway') di.set('isMarkerVisible', preset.isMarkerVisible !== false);
  if (/^bpmn:(SubProcess|Transaction|AdHocSubProcess|SubChoreography)$/.test(type)) {
    di.set('isExpanded', preset.isExpanded !== false);
  }
  if (is(bo, 'bpmn:Event')) {
    const types =
      preset.eventDefinitions ?? (DEFAULT_DEFINITION[type] ? [DEFAULT_DEFINITION[type]] : []);
    const definitions = types.map((t) => {
      const definition = services.create(t);
      definition.$parent = bo;
      return definition;
    });
    if (definitions.length) bo.set('eventDefinitions', definitions);
    if (preset.parallelMultiple && definitions.length > 1) bo.set('parallelMultiple', true);
    if (preset.cancelActivity === false && type === 'bpmn:BoundaryEvent') {
      bo.set('cancelActivity', false);
    }
    if (preset.isInterrupting === false && type === 'bpmn:StartEvent') {
      bo.set('isInterrupting', false);
    }
  }
  if (preset.triggeredByEvent && is(bo, 'bpmn:SubProcess')) bo.set('triggeredByEvent', true);
  if (preset.isForCompensation && is(bo, 'bpmn:Activity')) bo.set('isForCompensation', true);
  if (preset.loop && preset.loop !== 'none' && is(bo, 'bpmn:Activity')) {
    const loop = services.create(
      preset.loop === 'standard'
        ? 'bpmn:StandardLoopCharacteristics'
        : 'bpmn:MultiInstanceLoopCharacteristics',
    );
    if (preset.loop === 'sequential') loop.set('isSequential', true);
    loop.$parent = bo;
    bo.set('loopCharacteristics', loop);
  }
  if (preset.instantiate && (is(bo, 'bpmn:ReceiveTask') || is(bo, 'bpmn:EventBasedGateway'))) {
    bo.set('instantiate', true);
    if (preset.eventGatewayType === 'Parallel' && is(bo, 'bpmn:EventBasedGateway')) {
      bo.set('eventGatewayType', 'Parallel');
    }
  }
  if (type === 'bpmn:DataObjectReference' && preset.isCollection) {
    // The collection flag lives on the data object (BPMN 2.0.2 PDF 205).
    const dataObject = services.create('bpmn:DataObject', { isCollection: true });
    bo.set('dataObjectRef', dataObject);
    created.dataObject = dataObject;
  } else if ((type === 'bpmn:DataInput' || type === 'bpmn:DataOutput') && preset.isCollection) {
    bo.set('isCollection', true);
  }
  if (type === 'bpmn:CallActivity' && preset.calledGlobalTask) {
    // A call activity calling a global task shows that task's marker (Table 12.18).
    const global = services.create(preset.calledGlobalTask);
    bo.set('calledElement', global.id);
    created.calledElement = global;
  }
  if (type === 'bpmn:CallChoreography' && preset.calledChoreography) {
    // Thick border; [+] when it calls a choreography (Fig 11.24, 11.25).
    const called = services.create(preset.calledChoreography);
    bo.set('calledChoreographyRef', called);
    created.calledElement = called;
  }
  if (type === 'bpmn:CallConversation' && preset.calledCollaboration) {
    // [+] when it calls a collaboration (Table 12.34).
    const called = services.create(preset.calledCollaboration);
    bo.set('calledCollaborationRef', called);
    created.calledElement = called;
  }
  return { businessObject: bo, di, created };
}

/** The preset an element matches (type plus notation-relevant attributes). */
export function presetOf(bo: ModdleElement, di?: ModdleElement): ShapePreset {
  const preset: ShapePreset = { type: bo.$type };
  if (is(bo, 'bpmn:Event')) {
    preset.eventDefinitions = getMany(bo, 'eventDefinitions').map((d) => d.$type);
    if (bo.get('parallelMultiple') === true) preset.parallelMultiple = true;
    if (is(bo, 'bpmn:BoundaryEvent') && bo.get('cancelActivity') === false) {
      preset.cancelActivity = false;
    }
    if (is(bo, 'bpmn:StartEvent') && bo.get('isInterrupting') === false) {
      preset.isInterrupting = false;
    }
  }
  if (is(bo, 'bpmn:SubProcess') && bo.get('triggeredByEvent') === true) {
    preset.triggeredByEvent = true;
  }
  if (is(bo, 'bpmn:Activity') && bo.get('isForCompensation') === true) {
    preset.isForCompensation = true;
  }
  if ((is(bo, 'bpmn:ReceiveTask') || is(bo, 'bpmn:EventBasedGateway')) && bo.get('instantiate')) {
    preset.instantiate = true;
    if (is(bo, 'bpmn:EventBasedGateway') && bo.get('eventGatewayType') === 'Parallel') {
      preset.eventGatewayType = 'Parallel';
    }
  }
  if (is(bo, 'bpmn:Participant')) {
    if (!getRef(bo, 'processRef')) preset.blackBox = true;
    if (di?.get('isHorizontal') === false) preset.isHorizontal = false;
  }
  if (is(bo, 'bpmn:ExclusiveGateway') && di && di.get('isMarkerVisible') !== true) {
    preset.isMarkerVisible = false;
  }
  const called = getRef(bo, 'calledChoreographyRef') ?? getRef(bo, 'calledCollaborationRef');
  if (is(bo, 'bpmn:CallChoreography') && called) {
    preset.calledChoreography = is(called, 'bpmn:GlobalChoreographyTask')
      ? 'bpmn:GlobalChoreographyTask'
      : 'bpmn:Choreography';
  }
  if (is(bo, 'bpmn:CallConversation') && called) {
    preset.calledCollaboration = is(called, 'bpmn:GlobalConversation')
      ? 'bpmn:GlobalConversation'
      : 'bpmn:Collaboration';
  }
  if (is(bo, 'bpmn:Activity')) {
    const loop = getRef(bo, 'loopCharacteristics');
    if (loop) {
      preset.loop = is(loop, 'bpmn:StandardLoopCharacteristics')
        ? 'standard'
        : loop.get('isSequential') === true
          ? 'sequential'
          : 'parallel';
    }
  }
  return preset;
}

/**
 * Identity of the notation variant a preset stands for, used to find the menu
 * entry of an element. Only the attributes the replace menu switches count.
 */
export function variantKey(preset: ShapePreset): string {
  const parts = [preset.type];
  if (preset.eventDefinitions?.length) {
    const defs = preset.eventDefinitions;
    parts.push(defs.length > 1 ? 'multiple' : defs[0]!);
  }
  if (preset.parallelMultiple) parts.push('parallel');
  if (preset.cancelActivity === false || preset.isInterrupting === false) {
    parts.push('non-interrupting');
  }
  if (preset.triggeredByEvent) parts.push('event');
  if (preset.instantiate) parts.push(`instantiate:${preset.eventGatewayType ?? 'Exclusive'}`);
  if (preset.isMarkerVisible === false) parts.push('no-marker');
  return parts.join('|');
}

/** Event types the BPMN "change type" may switch between (boundary events stay boundary events). */
const FLOW_EVENTS = [
  'bpmn:StartEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:EndEvent',
];

const CATCHING = ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];

/**
 * The preset an element becomes when only its type changes (inspector "Type",
 * context menu): triggers the new type cannot have are dropped, a catch event
 * without one gets a timer, and type-specific flags are cleared.
 */
export function presetForType(current: ShapePreset, newType: string): ShapePreset {
  const next: ShapePreset = { type: newType };
  if (FLOW_EVENTS.includes(newType) || newType === 'bpmn:BoundaryEvent') {
    const supported = supportedEventDefinitions(newType);
    let defs = (current.eventDefinitions ?? []).filter((d) => supported.includes(d));
    if (!defs.length && DEFAULT_DEFINITION[newType]) defs = [DEFAULT_DEFINITION[newType]];
    next.eventDefinitions = defs;
    if (current.parallelMultiple && defs.length > 1 && CATCHING.includes(newType)) {
      next.parallelMultiple = true;
    }
    if (newType === 'bpmn:StartEvent' && current.isInterrupting === false) {
      next.isInterrupting = false;
    }
    if (newType === 'bpmn:BoundaryEvent' && current.cancelActivity === false) {
      next.cancelActivity = false;
    }
  }
  if (newType === 'bpmn:SubProcess' && current.triggeredByEvent) next.triggeredByEvent = true;
  if (newType === 'bpmn:ReceiveTask' && current.instantiate) next.instantiate = true;
  if (newType === 'bpmn:EventBasedGateway' && current.instantiate) {
    next.instantiate = true;
    if (current.eventGatewayType) next.eventGatewayType = current.eventGatewayType;
  }
  return next;
}

export function isFlowEventType(type: string): boolean {
  return FLOW_EVENTS.includes(type);
}

export type { LoopKind };

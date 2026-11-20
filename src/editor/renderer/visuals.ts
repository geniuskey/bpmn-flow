/**
 * Maps BPMN elements to visual kinds. Pure; shared by the renderer and tests.
 */
import {
  humanizeType,
  isEditableConnection,
  isEditableShapeElement,
  isSharedDefinitionEvent,
} from '@/bpmn/model/elements';
import { messageVisibleKind } from '@/bpmn/di/di';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import type { Outline } from './geometry';

export type VisualKind =
  | 'event'
  | 'activity'
  | 'subProcess'
  | 'gateway'
  | 'participant'
  | 'lane'
  | 'textAnnotation'
  | 'group'
  | 'dataObject'
  | 'dataStore'
  | 'conversation'
  | 'choreography'
  | 'message'
  | 'conversationLink'
  | 'sequenceFlow'
  | 'messageFlow'
  | 'association'
  | 'dataAssociation'
  | 'unsupportedShape'
  | 'unsupportedConnection';

export interface Visual {
  kind: VisualKind;
  outline: Outline;
  /** Shown on unsupported elements so they are never mistaken for editable ones. */
  caption?: string;
}

export function outlineFor(el: ModdleElement): Outline {
  if (is(el, 'bpmn:Event')) return 'circle';
  if (is(el, 'bpmn:Gateway')) return 'diamond';
  if (is(el, 'bpmn:Activity') || is(el, 'bpmn:Group') || is(el, 'bpmn:ChoreographyActivity')) {
    return 'roundRect';
  }
  if (is(el, 'bpmn:ConversationNode')) return 'hexagon';
  return 'rect';
}

function shapeKind(el: ModdleElement): VisualKind {
  if (is(el, 'bpmn:Event')) return 'event';
  if (is(el, 'bpmn:ChoreographyActivity')) return 'choreography';
  if (is(el, 'bpmn:SubProcess')) return 'subProcess';
  if (is(el, 'bpmn:Activity')) return 'activity';
  if (is(el, 'bpmn:Gateway')) return 'gateway';
  if (is(el, 'bpmn:TextAnnotation')) return 'textAnnotation';
  if (is(el, 'bpmn:Group')) return 'group';
  if (is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataInput') || is(el, 'bpmn:DataOutput')) {
    return 'dataObject';
  }
  if (is(el, 'bpmn:ConversationNode')) return 'conversation';
  if (is(el, 'bpmn:Message')) return 'message';
  return 'dataStore';
}

export function visualFor(el: ModdleElement, isEdge: boolean): Visual {
  if (isEdge) {
    if (!isEditableConnection(el)) {
      return { kind: 'unsupportedConnection', outline: 'rect', caption: humanizeType(el.$type) };
    }
    if (is(el, 'bpmn:MessageFlow')) return { kind: 'messageFlow', outline: 'rect' };
    if (is(el, 'bpmn:Association')) return { kind: 'association', outline: 'rect' };
    if (is(el, 'bpmn:DataAssociation')) return { kind: 'dataAssociation', outline: 'rect' };
    if (is(el, 'bpmn:ConversationLink')) return { kind: 'conversationLink', outline: 'rect' };
    return { kind: 'sequenceFlow', outline: 'rect' };
  }
  if (is(el, 'bpmn:Participant')) return { kind: 'participant', outline: 'rect' };
  if (is(el, 'bpmn:Lane')) return { kind: 'lane', outline: 'rect' };
  if (isEditableShapeElement(el)) {
    return { kind: shapeKind(el), outline: outlineFor(el) };
  }
  // Shown with their notation although they are not edited as shapes: a Data
  // Object drawn directly (PDF 234) and a Message (envelope, PDF 91).
  if (is(el, 'bpmn:DataObject')) return { kind: 'dataObject', outline: 'rect' };
  if (is(el, 'bpmn:Message')) return { kind: 'message', outline: 'rect' };
  // Shared event definitions (PDF 265-266) give the same marker as own ones.
  if (isSharedDefinitionEvent(el)) return { kind: 'event', outline: 'circle' };
  const eventDefs = getMany(el, 'eventDefinitions').map((d) =>
    humanizeType(d.$type).replace(/ Event Definition$/, ''),
  );
  const caption = [humanizeType(el.$type), ...eventDefs].join(' · ');
  return { kind: 'unsupportedShape', outline: outlineFor(el), caption };
}

/** Shapes whose name is drawn outside the shape (below it), per BPMN convention. */
export function hasExternalLabel(el: ModdleElement): boolean {
  return (
    is(el, 'bpmn:Event') ||
    is(el, 'bpmn:Gateway') ||
    is(el, 'bpmn:DataObjectReference') ||
    is(el, 'bpmn:DataObject') ||
    is(el, 'bpmn:Message') ||
    is(el, 'bpmn:DataStoreReference') ||
    is(el, 'bpmn:DataInput') ||
    is(el, 'bpmn:DataOutput') ||
    is(el, 'bpmn:ConversationNode')
  );
}

/** Collection flag: on the referenced data object, or on a data input / output itself. */
export function isCollection(el: ModdleElement): boolean {
  const target = is(el, 'bpmn:DataObjectReference')
    ? (el.get('dataObjectRef') as ModdleElement | undefined)
    : el;
  return target?.get('isCollection') === true;
}

/** Thrown events show filled markers; caught events show outlined markers. */
export function isThrowing(el: ModdleElement): boolean {
  return is(el, 'bpmn:EndEvent') || is(el, 'bpmn:IntermediateThrowEvent');
}

/** Expanded sub-processes show their content; collapsed ones show a [+] marker. */
export { isExpandedShape as isExpanded } from '../model';

/**
 * A Message sent by the non-initiating participant is shaded (PDF 91, Fig
 * 8.27): one carried by a choreography task's message flow that does not come
 * from the initiating participant, or by (or associated with) a message flow
 * whose envelope is DI non_initiating.
 */
export function isNonInitiatingMessage(message: ModdleElement): boolean {
  let definitions: ModdleElement | undefined = message;
  while (definitions?.$parent) definitions = definitions.$parent;
  if (!definitions) return false;
  const flows = new Set<ModdleElement>();
  const nonInitiating = new Set<ModdleElement>();
  walkContainment(definitions, (el) => {
    if (is(el, 'bpmn:MessageFlow') && getRef(el, 'messageRef') === message) flows.add(el);
    if (is(el, 'bpmn:Association')) {
      const [a, b] = [getRef(el, 'sourceRef'), getRef(el, 'targetRef')];
      if (a === message && is(b, 'bpmn:MessageFlow')) flows.add(b!);
      if (b === message && is(a, 'bpmn:MessageFlow')) flows.add(a!);
    }
    if (is(el, 'bpmn:ChoreographyTask')) {
      const initiator = getRef(el, 'initiatingParticipantRef');
      for (const flow of getMany(el, 'messageFlowRef')) {
        if (initiator && getRef(flow, 'sourceRef') !== initiator) nonInitiating.add(flow);
      }
    }
  });
  if ([...flows].some((f) => nonInitiating.has(f))) return true;
  for (const diagram of getMany(definitions, 'diagrams')) {
    for (const di of getMany(getRef(diagram, 'plane'), 'planeElement')) {
      const flow = getRef(di, 'bpmnElement');
      if (flow && flows.has(flow) && messageVisibleKind(di) === 'non_initiating') return true;
    }
  }
  return false;
}

/**
 * Maps BPMN elements to visual kinds. Pure; shared by the renderer and tests.
 */
import {
  humanizeType,
  isEditableArtifact,
  isEditableConnection,
  isEditableFlowNode,
} from '@/bpmn/model/elements';
import { getMany, is, type ModdleElement } from '@/bpmn/model/moddle';
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
  if (is(el, 'bpmn:Activity') || is(el, 'bpmn:Group')) return 'roundRect';
  return 'rect';
}

function shapeKind(el: ModdleElement): VisualKind {
  if (is(el, 'bpmn:Event')) return 'event';
  if (is(el, 'bpmn:SubProcess')) return 'subProcess';
  if (is(el, 'bpmn:Activity')) return 'activity';
  if (is(el, 'bpmn:Gateway')) return 'gateway';
  if (is(el, 'bpmn:TextAnnotation')) return 'textAnnotation';
  if (is(el, 'bpmn:Group')) return 'group';
  if (is(el, 'bpmn:DataObjectReference')) return 'dataObject';
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
    return { kind: 'sequenceFlow', outline: 'rect' };
  }
  if (is(el, 'bpmn:Participant')) return { kind: 'participant', outline: 'rect' };
  if (is(el, 'bpmn:Lane')) return { kind: 'lane', outline: 'rect' };
  if (isEditableFlowNode(el) || isEditableArtifact(el)) {
    return { kind: shapeKind(el), outline: outlineFor(el) };
  }
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
    is(el, 'bpmn:DataStoreReference')
  );
}

/** Thrown events show filled markers; caught events show outlined markers. */
export function isThrowing(el: ModdleElement): boolean {
  return is(el, 'bpmn:EndEvent') || is(el, 'bpmn:IntermediateThrowEvent');
}

/** Expanded sub-processes show their content; collapsed ones show a [+] marker. */
export function isExpanded(el: ModdleElement, di: ModdleElement | undefined): boolean {
  return is(el, 'bpmn:SubProcess') && di?.get('isExpanded') !== false;
}

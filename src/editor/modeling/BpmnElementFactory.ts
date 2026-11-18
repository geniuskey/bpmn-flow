/**
 * Creates diagram elements together with their BPMN business object and DI.
 * diagram-js features (create, connect, paste, append) call `create` without a
 * business object; we add one so every element on the canvas is backed by BPMN.
 */
import ElementFactory from 'diagram-js/lib/core/ElementFactory';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import type BpmnIds from './BpmnIds';

export const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  activity: { width: 100, height: 80 },
  'bpmn:Participant': { width: 600, height: 250 },
  'bpmn:Lane': { width: 570, height: 125 },
  'bpmn:SubProcess': { width: 350, height: 200 },
  'bpmn:TextAnnotation': { width: 120, height: 40 },
  'bpmn:Group': { width: 300, height: 200 },
  'bpmn:DataObjectReference': { width: 36, height: 50 },
  'bpmn:DataStoreReference': { width: 50, height: 50 },
  'bpmn:DataInput': { width: 36, height: 50 },
  'bpmn:DataOutput': { width: 36, height: 50 },
  'bpmn:Conversation': { width: 50, height: 43 },
  'bpmn:SubConversation': { width: 50, height: 43 },
  'bpmn:CallConversation': { width: 50, height: 43 },
};

/** Event types that need a definition get this one by default. */
const DEFAULT_DEFINITION: Record<string, string> = {
  'bpmn:IntermediateCatchEvent': 'bpmn:TimerEventDefinition',
  'bpmn:BoundaryEvent': 'bpmn:TimerEventDefinition',
};

export function defaultSize(type: string): { width: number; height: number } {
  if (DEFAULT_SIZE[type]) return DEFAULT_SIZE[type];
  if (/Event$/.test(type)) return DEFAULT_SIZE.event!;
  if (/Gateway$/.test(type)) return DEFAULT_SIZE.gateway!;
  return DEFAULT_SIZE.activity!;
}

const baseCreate = ElementFactory.prototype.create as (
  this: ElementFactory,
  type: string,
  attrs: object,
) => unknown;

type Attrs = Record<string, unknown> & {
  type?: string;
  businessObject?: ModdleElement;
  name?: string;
  eventDefinitionType?: string;
};

export default class BpmnElementFactory extends ElementFactory {
  static $inject = ['moddle', 'bpmnIds'];

  constructor(
    private readonly moddle: BpmnModdleInstance,
    private readonly ids: BpmnIds,
  ) {
    super();
  }

  override create(
    elementType: 'root' | 'shape' | 'connection' | 'label',
    attrs: Attrs = {},
  ): never {
    if (elementType === 'root' || elementType === 'label' || attrs.businessObject) {
      return baseCreate.call(this, elementType, attrs) as never;
    }
    const isConnection = elementType === 'connection';
    const type = attrs.type ?? (isConnection ? 'bpmn:SequenceFlow' : 'bpmn:Task');
    const bo = this.createBusinessObject(type, attrs.name);
    const di = this.moddle.create(isConnection ? 'bpmndi:BPMNEdge' : 'bpmndi:BPMNShape', {
      id: `${bo.id}_di`,
      bpmnElement: bo,
    });
    if (type === 'bpmn:Participant' || type === 'bpmn:Lane') di.set('isHorizontal', true);
    if (type === 'bpmn:ExclusiveGateway') di.set('isMarkerVisible', true);
    if (type === 'bpmn:SubProcess') di.set('isExpanded', true);
    const definitionType = attrs.eventDefinitionType ?? DEFAULT_DEFINITION[type];
    if (definitionType) {
      const definition = this.createModdle(definitionType);
      definition.$parent = bo;
      bo.set('eventDefinitions', [definition]);
    }
    if (type === 'bpmn:TextAnnotation' && attrs.name) {
      bo.set('name', undefined);
      bo.set('text', attrs.name);
    }
    const size = isConnection ? {} : { ...defaultSize(type), ...pickSize(attrs) };
    const { name: _name, eventDefinitionType: _def, ...rest } = attrs;
    void _name;
    void _def;
    return baseCreate.call(this, elementType, {
      ...rest,
      ...size,
      id: bo.id,
      type,
      businessObject: bo,
      di,
    }) as never;
  }

  createBusinessObject(type: string, name?: string): ModdleElement {
    const bo = this.moddle.create(type, { id: this.ids.next(type) });
    if (name) bo.set('name', name);
    return bo;
  }

  createModdle(type: string, attrs: Record<string, unknown> = {}): ModdleElement {
    const withId = 'id' in attrs || !needsId(type) ? attrs : { id: this.ids.next(type), ...attrs };
    return this.moddle.create(type, withId);
  }
}

function pickSize(attrs: Attrs): { width?: number; height?: number } {
  const out: { width?: number; height?: number } = {};
  if (typeof attrs.width === 'number') out.width = attrs.width;
  if (typeof attrs.height === 'number') out.height = attrs.height;
  return out;
}

function needsId(type: string): boolean {
  return !['bpmn:FormalExpression', 'dc:Bounds', 'dc:Point'].includes(type);
}

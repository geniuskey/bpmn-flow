/**
 * Creates diagram elements together with their BPMN business object and DI.
 * diagram-js features (create, connect, paste, append) call `create` without a
 * business object; we add one so every element on the canvas is backed by BPMN.
 */
import ElementFactory from 'diagram-js/lib/core/ElementFactory';
import type { BpmnModdleInstance, ModdleElement } from '@/bpmn/model/moddle';
import type BpmnIds from './BpmnIds';
import { buildFromPreset, type ShapePreset } from './presets';

export const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  activity: { width: 100, height: 80 },
  'bpmn:Participant': { width: 600, height: 250 },
  'bpmn:Lane': { width: 570, height: 125 },
  'bpmn:SubProcess': { width: 350, height: 200 },
  'bpmn:Transaction': { width: 350, height: 200 },
  'bpmn:AdHocSubProcess': { width: 350, height: 200 },
  'bpmn:SubChoreography': { width: 350, height: 200 },
  // Two participant bands and the name band between them.
  'bpmn:ChoreographyTask': { width: 120, height: 100 },
  'bpmn:CallChoreography': { width: 120, height: 100 },
  'bpmn:TextAnnotation': { width: 120, height: 40 },
  'bpmn:Group': { width: 300, height: 200 },
  'bpmn:DataObjectReference': { width: 36, height: 50 },
  'bpmn:DataStoreReference': { width: 50, height: 50 },
  'bpmn:Message': { width: 36, height: 26 },
  'bpmn:DataInput': { width: 36, height: 50 },
  'bpmn:DataOutput': { width: 36, height: 50 },
  'bpmn:Conversation': { width: 50, height: 43 },
  'bpmn:SubConversation': { width: 50, height: 43 },
  'bpmn:CallConversation': { width: 50, height: 43 },
};

export function defaultSize(
  type: string,
  preset?: Pick<ShapePreset, 'isExpanded' | 'blackBox' | 'isHorizontal'>,
): { width: number; height: number } {
  // A collapsed sub-process is drawn like a task (BPMN 2.0.2 PDF 173).
  if (preset?.isExpanded === false) {
    return type === 'bpmn:SubChoreography'
      ? DEFAULT_SIZE['bpmn:ChoreographyTask']!
      : DEFAULT_SIZE.activity!;
  }
  if (type === 'bpmn:Participant') {
    const size = preset?.blackBox ? { width: 600, height: 80 } : DEFAULT_SIZE[type]!;
    // A vertical pool runs top to bottom (Table 12.26).
    return preset?.isHorizontal === false ? { width: size.height, height: size.width } : size;
  }
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
  /** Notation variant to create (trigger, flags...); defaults to the plain `type`. */
  preset?: ShapePreset;
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
    const type =
      attrs.preset?.type ?? attrs.type ?? (isConnection ? 'bpmn:SequenceFlow' : 'bpmn:Task');
    const { name, preset: _preset, ...rest } = attrs;
    void _preset;
    if (isConnection) {
      const bo = this.createBusinessObject(type, name);
      const di = this.moddle.create('bpmndi:BPMNEdge', { id: `${bo.id}_di`, bpmnElement: bo });
      return baseCreate.call(this, elementType, {
        ...rest,
        id: bo.id,
        type,
        businessObject: bo,
        di,
      }) as never;
    }
    const preset: ShapePreset = { ...attrs.preset, type };
    const built = buildFromPreset(
      { moddle: this.moddle, create: (t, a) => this.createModdle(t, a) },
      preset,
    );
    const bo = built.businessObject;
    if (name) {
      if (type === 'bpmn:TextAnnotation') bo.set('text', name);
      else bo.set('name', name);
    }
    const extra: Record<string, unknown> = {};
    // Helper objects (data object, called global task) are added on create (shapeSync).
    if (Object.keys(built.created).length) extra.bfCreated = { ...built.created };
    if (preset.blackBox && type === 'bpmn:Participant') extra.blackBox = true;
    // A lane from the palette is added to the pool it is dropped on (ADD_LANE).
    if (attrs.preset && type === 'bpmn:Lane') extra.bfAddLane = true;
    return baseCreate.call(this, elementType, {
      ...rest,
      ...extra,
      ...defaultSize(type, preset),
      ...pickSize(attrs),
      id: bo.id,
      type,
      businessObject: bo,
      di: built.di,
    }) as never;
  }

  createBusinessObject(type: string, name?: string): ModdleElement {
    const bo = this.moddle.create(type, { id: this.ids.next(type) });
    if (name) bo.set('name', name);
    return bo;
  }

  createModdle(type: string, attrs: Record<string, unknown> = {}): ModdleElement {
    const withId = 'id' in attrs || !needsId(type) ? attrs : { id: this.ids.next(type), ...attrs };
    const element = this.moddle.create(type, withId);
    // The BPMN XSD requires a condition on a conditional trigger and a name on a
    // link trigger (BPMN 2.0.2 Table 10.95, 10.98): new ones start with an empty
    // expression / name, which the inspector fills in.
    if (type === 'bpmn:ConditionalEventDefinition' && !element.get('condition')) {
      const condition = this.moddle.create('bpmn:FormalExpression', {});
      condition.$parent = element;
      element.set('condition', condition);
    }
    if (type === 'bpmn:LinkEventDefinition' && element.get('name') === undefined) {
      element.set('name', '');
    }
    return element;
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

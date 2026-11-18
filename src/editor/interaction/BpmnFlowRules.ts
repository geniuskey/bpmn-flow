/**
 * Editing rules: what may be created, connected, attached, moved, resized and
 * deleted. Every allowed operation has a matching semantic update
 * (SemanticSync, StructureBehavior); anything else is rejected so the canvas
 * cannot drift away from the BPMN model.
 */
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import {
  isEditableArtifact,
  isEditableConnection,
  isEditableFlowNode,
  isEditableShapeElement,
} from '@/bpmn/model/elements';
import { getMany, is } from '@/bpmn/model/moddle';
import { bo, childrenOf, type BpmnData } from '../model';
import {
  containerAt,
  contains,
  isExpandedContainer,
  isFlowNodeShape,
  lanesOf,
  participantOf,
  processOf,
} from '../modeling/semantic';

interface Delta {
  x: number;
  y: number;
}
type Bounds = { x: number; y: number; width: number; height: number };

export const MIN_ACTIVITY = { width: 60, height: 40 };
export const MIN_LANE_HEIGHT = 60;

/** Shapes that stay on their diagram parent and never change process. */
const ARTIFACT_SHAPES = [
  'bpmn:TextAnnotation',
  'bpmn:Group',
  'bpmn:Conversation',
  'bpmn:SubConversation',
  'bpmn:CallConversation',
];
const CONVERSATION_SHAPES = ['bpmn:Conversation', 'bpmn:SubConversation', 'bpmn:CallConversation'];
const DATA_SHAPES = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference'];

function isUnsupported(el: Element): boolean {
  return !!(el as Partial<BpmnData>).unsupported;
}

function editableNode(el: Element | undefined): el is Shape {
  return !!el && !isUnsupported(el) && isEditableFlowNode(bo(el));
}

function editableShape(el: Element | undefined): el is Shape {
  return (
    !!el && !isUnsupported(el) && (isEditableShapeElement(bo(el)) || is(bo(el), 'bpmn:Participant'))
  );
}

function isActivity(el: Element | undefined): boolean {
  return editableNode(el) && is(bo(el!), 'bpmn:Activity');
}

function isData(el: Element | undefined): boolean {
  return !!el && !isUnsupported(el) && DATA_SHAPES.includes(bo(el)?.$type ?? '');
}

function rootFrom(el: Element): Element {
  let p: Element = el;
  while (p.parent) p = p.parent;
  return p;
}

/** Can a shape of `type` be placed into `target` (root, pool, lane or expanded sub-process)? */
export function canContain(target: Element | undefined, type: string): boolean {
  if (!target) return false;
  const targetBo = bo(target);
  // Pools live on the root of a process or collaboration diagram (not of a sub-process diagram).
  if (type === 'bpmn:Participant') {
    return !target.parent && (is(targetBo, 'bpmn:Process') || is(targetBo, 'bpmn:Collaboration'));
  }
  if (type === 'bpmn:Lane') return false; // lanes are added through `lane.add`
  if (type === 'bpmn:BoundaryEvent') return false; // attached to an activity instead
  if (CONVERSATION_SHAPES.includes(type))
    return !target.parent && is(targetBo, 'bpmn:Collaboration');
  if (ARTIFACT_SHAPES.includes(type)) {
    return (
      !target.parent ||
      is(targetBo, 'bpmn:Participant') ||
      is(targetBo, 'bpmn:Lane') ||
      isExpandedContainer(target)
    );
  }
  if (is(targetBo, 'bpmn:Process')) return !target.parent;
  if (is(targetBo, 'bpmn:Participant') || is(targetBo, 'bpmn:Lane')) return !!processOf(target);
  return isExpandedContainer(target) && !isUnsupported(target);
}

/** Boundary events attach to activities (tasks, call activities, sub-processes). */
export function canAttach(shapes: Element[], target: Element | undefined): boolean {
  return shapes.length === 1 && is(bo(shapes[0]!), 'bpmn:BoundaryEvent') && isActivity(target);
}

export function canConnect(source: Element | undefined, target: Element | undefined): boolean {
  if (!editableNode(source) || !editableNode(target) || source === target) return false;
  const s = bo(source)!;
  const t = bo(target)!;
  if (is(s, 'bpmn:EndEvent') || is(t, 'bpmn:StartEvent') || is(t, 'bpmn:BoundaryEvent')) {
    return false;
  }
  const sourceDef = getMany(s, 'eventDefinitions')[0];
  if (
    is(s, 'bpmn:IntermediateThrowEvent') &&
    sourceDef &&
    is(sourceDef, 'bpmn:LinkEventDefinition')
  ) {
    return false; // a link throw event jumps to its catch event
  }
  return !!processOf(source.parent) && processOf(source.parent) === processOf(target.parent);
}

/** Message flows connect different pools (or nodes in them); gateways do not send messages. */
export function canMessageFlow(source: Element | undefined, target: Element | undefined): boolean {
  if (!source || !target || source === target) return false;
  const ok = (el: Element) =>
    !isUnsupported(el) &&
    (is(bo(el), 'bpmn:Participant') || (isEditableFlowNode(bo(el)) && !is(bo(el), 'bpmn:Gateway')));
  if (!ok(source) || !ok(target)) return false;
  if (is(bo(source), 'bpmn:StartEvent') || is(bo(target), 'bpmn:EndEvent')) return false;
  const a = participantOf(source);
  const b = participantOf(target);
  return !!a && !!b && a !== b;
}

/** Associations link a text annotation with any other element. */
export function canAssociate(source: Element | undefined, target: Element | undefined): boolean {
  if (!source || !target || source === target) return false;
  if (!editableShape(source) || !editableShape(target)) return false;
  // Compensation: a compensation boundary event is associated with its compensation activity.
  const s = bo(source)!;
  if (
    is(s, 'bpmn:BoundaryEvent') &&
    getMany(s, 'eventDefinitions')[0]?.$type === 'bpmn:CompensateEventDefinition' &&
    isActivity(target)
  ) {
    return true;
  }
  return is(s, 'bpmn:TextAnnotation') !== is(bo(target), 'bpmn:TextAnnotation');
}

/** Data associations: data → activity (input) or activity → data (output). */
export function dataAssociationType(
  source: Element | undefined,
  target: Element | undefined,
): string | null {
  if (isData(source) && isActivity(target)) return 'bpmn:DataInputAssociation';
  if (isActivity(source) && isData(target)) return 'bpmn:DataOutputAssociation';
  return null;
}

/** Conversation links connect a pool with a conversation node. */
export function canLinkConversation(
  source: Element | undefined,
  target: Element | undefined,
): boolean {
  if (!source || !target || isUnsupported(source) || isUnsupported(target)) return false;
  const conv = (el: Element) => CONVERSATION_SHAPES.includes(bo(el)?.$type ?? '');
  const pool = (el: Element) => is(bo(el), 'bpmn:Participant');
  return (conv(source) && pool(target)) || (pool(source) && conv(target));
}

export function connectionType(
  source: Element | undefined,
  target: Element | undefined,
): string | null {
  if (canConnect(source, target)) return 'bpmn:SequenceFlow';
  if (canMessageFlow(source, target)) return 'bpmn:MessageFlow';
  if (canLinkConversation(source, target)) return 'bpmn:ConversationLink';
  if (canAssociate(source, target)) return 'bpmn:Association';
  return dataAssociationType(source, target);
}

/** The pool whose bounds contain the given box, if any. */
export function poolAt(root: Element | undefined, box: Bounds): Shape | undefined {
  return childrenOf(root).find(
    (c) =>
      is(bo(c), 'bpmn:Participant') &&
      contains(c as Shape, box.x, box.y) &&
      contains(c as Shape, box.x + box.width, box.y + box.height),
  ) as Shape | undefined;
}

function containerOf(el: Element): Element | undefined {
  const parent = el.parent;
  return parent && is(bo(parent), 'bpmn:Lane') ? participantOf(parent) : parent;
}

/** Boundary events follow their host when it moves. */
function movesWithHost(shape: Element, moved: Set<Element>): boolean {
  const host = (shape as Shape).host;
  return !!host && moved.has(host);
}

/**
 * Moving content into another container (pool or sub-process) changes its
 * process. Sequence flows cannot cross containers, so this is only allowed when
 * every sequence flow of the moved nodes stays inside the moved set, and no
 * message flow would end up inside a single pool.
 */
export function canMoveToContainer(shapes: Element[], delta: Delta): boolean {
  const moved = new Set(shapes);
  const nodes = shapes.filter(
    (s) =>
      !(s as Connection).waypoints &&
      !is(bo(s), 'bpmn:Participant') &&
      !ARTIFACT_SHAPES.includes(bo(s)?.$type ?? '') &&
      !movesWithHost(s, moved),
  ) as Shape[];
  if (!nodes.length) return true;
  const root = rootFrom(nodes[0]!);
  const targets = new Set<Element | undefined>();
  for (const n of nodes) {
    const box = { x: n.x + delta.x, y: n.y + delta.y, width: n.width, height: n.height };
    targets.add(containerAt(root, box, moved));
  }
  if (targets.size !== 1) return false; // all nodes must land in the same container
  const dest = [...targets][0];
  if (!dest) return false;
  const leaving = nodes.filter((n) => containerOf(n) !== dest);
  if (!leaving.length) return true;
  const destPool = participantOf(dest);
  for (const n of leaving) {
    if (is(bo(n), 'bpmn:DataObjectReference')) return false; // its data object stays in its scope
    const attached = (n.attachers ?? []) as Shape[];
    const connections = [
      ...n.incoming,
      ...n.outgoing,
      ...attached.flatMap((a) => [...a.incoming, ...a.outgoing]),
    ] as Connection[];
    for (const c of connections) {
      const fromHere = c.source === n || attached.includes(c.source as Shape);
      const other = fromHere ? c.target : c.source;
      if (!other || moved.has(other)) continue;
      if (is(bo(c), 'bpmn:SequenceFlow')) return false;
      if (is(bo(c), 'bpmn:MessageFlow') && participantOf(other) === destPool) return false;
    }
  }
  return true;
}

export function canMoveShape(shape: Element, delta: Delta): boolean {
  if (isUnsupported(shape)) return false;
  const b = bo(shape);
  if (is(b, 'bpmn:Participant')) return true;
  if (!editableShape(shape)) return false;
  if (ARTIFACT_SHAPES.includes(b?.$type ?? '')) return true;
  const s = shape as Shape;
  const box = { x: s.x + delta.x, y: s.y + delta.y, width: s.width, height: s.height };
  return !!containerAt(rootFrom(shape), box, new Set([shape]));
}

function childBounds(container: Shape): Bounds | null {
  const nodes = childrenOf(container).filter(
    (c) => isFlowNodeShape(c) || isData(c) || ARTIFACT_SHAPES.includes(bo(c)?.$type ?? ''),
  ) as Shape[];
  if (!nodes.length) return null;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(...nodes.map((n) => n.x + n.width)) - minX,
    height: Math.max(...nodes.map((n) => n.y + n.height)) - minY,
  };
}

function inside(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function canResize(shape: Shape, newBounds?: Bounds): boolean {
  const b = bo(shape);
  if (isUnsupported(shape) || !b) return false;
  if (is(b, 'bpmn:Activity') && isEditableFlowNode(b)) {
    if (!newBounds) return true;
    if (newBounds.width < MIN_ACTIVITY.width || newBounds.height < MIN_ACTIVITY.height) {
      return false;
    }
    const content = isExpandedContainer(shape) ? childBounds(shape) : null;
    return !content || inside(newBounds, content);
  }
  if (is(b, 'bpmn:TextAnnotation') || is(b, 'bpmn:Group')) {
    return !newBounds || (newBounds.width >= 40 && newBounds.height >= 24);
  }
  if (is(b, 'bpmn:Participant')) {
    if (!newBounds) return true;
    const content = childBounds(shape);
    const minHeight = Math.max(MIN_LANE_HEIGHT, lanesOf(shape).length * MIN_LANE_HEIGHT);
    return (
      newBounds.width >= 200 &&
      newBounds.height >= minHeight &&
      (!content || inside(newBounds, content))
    );
  }
  if (is(b, 'bpmn:Lane')) {
    if (!newBounds) return true;
    // Lanes resize from their bottom edge only; the pool grows or shrinks with them.
    return (
      newBounds.x === shape.x &&
      newBounds.y === shape.y &&
      newBounds.width === shape.width &&
      newBounds.height >= MIN_LANE_HEIGHT
    );
  }
  return false;
}

/** Deletable subset of a selection. Lanes must be empty; unsupported content stays. */
export function deletable(elements: Element[]): Element[] {
  return elements.filter((el) => {
    if (isUnsupported(el) || !el.parent) return false;
    const b = bo(el);
    if (is(b, 'bpmn:Lane')) return getMany(b, 'flowNodeRef').length === 0;
    return (
      isEditableFlowNode(b) ||
      isEditableArtifact(b) ||
      isEditableConnection(b) ||
      is(b, 'bpmn:Participant')
    );
  });
}

export default class BpmnFlowRules extends RuleProvider {
  static override $inject = ['eventBus'];

  constructor(eventBus: EventBus) {
    super(eventBus);
  }

  override init(): void {
    this.addRule(
      'shape.create',
      (ctx: { shape: Shape; target?: Element; position?: { x: number; y: number } }) => {
        if (!canContain(ctx.target, ctx.shape.type as string)) return false;
        // Content dropped into a pool or sub-process must lie completely inside it.
        const container =
          ctx.target && is(bo(ctx.target), 'bpmn:Lane') ? participantOf(ctx.target) : ctx.target;
        if (!container?.parent || !ctx.position || ctx.shape.type === 'bpmn:Participant') {
          return true;
        }
        const { width, height } = ctx.shape;
        const x = ctx.position.x - width / 2;
        const y = ctx.position.y - height / 2;
        const c = container as Shape;
        return contains(c, x, y) && contains(c, x + width, y + height);
      },
    );
    this.addRule('shape.attach', (ctx: { shape: Shape; target?: Element }) =>
      canAttach([ctx.shape], ctx.target) ? 'attach' : false,
    );
    this.addRule('elements.create', (ctx: { elements: Element[]; target?: Element }) =>
      ctx.elements.every((el) =>
        (el as Connection).waypoints ? true : canContain(ctx.target, (el as Shape).type as string),
      ),
    );
    this.addRule('elements.move', (ctx: { shapes: Element[]; delta?: Delta; target?: Element }) => {
      // `delta` is absent when diagram-js checks whether a move may start at all.
      const delta = ctx.delta ?? { x: 0, y: 0 };
      const moved = new Set(ctx.shapes);
      // A boundary event moved on its own must land on (another) activity.
      if (ctx.shapes.length === 1 && is(bo(ctx.shapes[0]!), 'bpmn:BoundaryEvent')) {
        if (!ctx.delta) return true;
        return canAttach(ctx.shapes, ctx.target) ? 'attach' : false;
      }
      const ok = ctx.shapes.every((s) => {
        if ((s as Connection).waypoints) {
          const c = s as Connection;
          return (
            isEditableConnection(bo(c)) &&
            (!c.source || moved.has(c.source)) &&
            (!c.target || moved.has(c.target))
          );
        }
        if (is(bo(s), 'bpmn:Lane')) return false;
        if (movesWithHost(s, moved)) return true;
        return canMoveShape(s, delta);
      });
      return ok && canMoveToContainer(ctx.shapes, delta);
    });
    this.addRule('shape.resize', (ctx: { shape: Shape; newBounds?: Bounds }) =>
      canResize(ctx.shape, ctx.newBounds),
    );
    this.addRule('connection.create', (ctx: { source?: Element; target?: Element }) => {
      const type = connectionType(ctx.source, ctx.target);
      return type ? { type } : false;
    });
    this.addRule(
      'connection.reconnect',
      (ctx: { connection: Connection; source?: Element; target?: Element }) => {
        const type = bo(ctx.connection)?.$type;
        if (!isEditableConnection(bo(ctx.connection))) return false;
        if (type === 'bpmn:MessageFlow') return canMessageFlow(ctx.source, ctx.target);
        if (type === 'bpmn:Association') return canAssociate(ctx.source, ctx.target);
        if (type === 'bpmn:ConversationLink') return canLinkConversation(ctx.source, ctx.target);
        if (type === 'bpmn:SequenceFlow') return canConnect(ctx.source, ctx.target);
        return false; // data associations: delete and re-create
      },
    );
    this.addRule('connection.updateWaypoints', (ctx: { connection: Connection }) =>
      isEditableConnection(bo(ctx.connection)),
    );
    this.addRule('elements.delete', (ctx: { elements: Element[] }) => deletable(ctx.elements));
    this.addRule(['shape.replace'], () => false);
  }
}

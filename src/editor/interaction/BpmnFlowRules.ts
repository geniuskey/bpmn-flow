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
  allowedEventDefinitionsIn,
  definitionCombinationProblem,
  isNotationOnlyDefinition,
  definitionRequiredIn,
  isEditableArtifact,
  isEditableConnection,
  isEditableFlowNode,
  isEditableShapeElement,
  isEventSubProcess,
  withinChoreography,
} from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, type BpmnData } from '../model';
import {
  bandsHeight,
  bandsOf,
  isInitiatingBand,
  layoutBands,
  MIN_NAME_BAND,
  nameBand,
} from '../modeling/choreography';
import {
  along,
  cross,
  isHorizontal,
  lanesFit,
  minLaneExtent,
  MIN_LANE,
  MIN_POOL_LENGTH,
} from '../modeling/laneLayout';
import {
  containerAt,
  contains,
  isExpandedContainer,
  isFlowNodeShape,
  participantBoOf,
  participantOf,
  processOf,
} from '../modeling/semantic';

interface Delta {
  x: number;
  y: number;
}
type Bounds = { x: number; y: number; width: number; height: number };

export const MIN_ACTIVITY = { width: 60, height: 40 };
export const MIN_LANE_HEIGHT = MIN_LANE;

/** Shapes that stay on their diagram parent and never change process. */
const ARTIFACT_SHAPES = [
  'bpmn:TextAnnotation',
  'bpmn:Message',
  'bpmn:Group',
  'bpmn:Conversation',
  'bpmn:SubConversation',
  'bpmn:CallConversation',
];
const CHOREOGRAPHY_SHAPES = [
  'bpmn:ChoreographyTask',
  'bpmn:SubChoreography',
  'bpmn:CallChoreography',
];
const CONVERSATION_SHAPES = ['bpmn:Conversation', 'bpmn:SubConversation', 'bpmn:CallConversation'];
const DATA_SHAPES = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference'];
const DATA_IO_SHAPES = ['bpmn:DataInput', 'bpmn:DataOutput'];

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

/** Data that can feed an activity: data objects, stores and process data inputs. */
function isDataSource(el: Element | undefined): boolean {
  return isData(el) || (!!el && !isUnsupported(el) && is(bo(el), 'bpmn:DataInput'));
}

/** Data an activity can write: data objects, stores and process data outputs. */
function isDataTarget(el: Element | undefined): boolean {
  return isData(el) || (!!el && !isUnsupported(el) && is(bo(el), 'bpmn:DataOutput'));
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
    return (
      !target.parent &&
      (is(targetBo, 'bpmn:Process') || is(targetBo, 'bpmn:Collaboration')) &&
      !is(targetBo, 'bpmn:Choreography') &&
      // The first pool wraps the process content; lanes drawn on the diagram stay unwrapped.
      !(is(targetBo, 'bpmn:Process') && childrenOf(target).some((c) => is(bo(c), 'bpmn:Lane')))
    );
  }
  // A Message envelope (PDF 121-122) is shown on a collaboration or choreography
  // diagram, next to the message flows it may be associated with.
  if (type === 'bpmn:Message') {
    const root = rootFrom(target);
    return (
      is(bo(root), 'bpmn:Collaboration') &&
      (target === root || is(targetBo, 'bpmn:Participant') || is(targetBo, 'bpmn:Lane'))
    );
  }
  if (type === 'bpmn:Lane') return false; // lanes are added through `lane.add`
  if (type === 'bpmn:BoundaryEvent') return false; // attached to an activity instead
  if (CONVERSATION_SHAPES.includes(type)) {
    return (
      !target.parent && is(targetBo, 'bpmn:Collaboration') && !is(targetBo, 'bpmn:Choreography')
    );
  }
  // Choreographies hold events, gateways and choreography activities — no tasks or data.
  const container = processOf(target);
  // Data inputs / outputs belong to a process: its diagram root or a pool / lane.
  if (DATA_IO_SHAPES.includes(type)) {
    return (
      !!container &&
      is(container, 'bpmn:Process') &&
      !is(container, 'bpmn:Choreography') &&
      (!target.parent || is(targetBo, 'bpmn:Participant') || is(targetBo, 'bpmn:Lane'))
    );
  }
  const inChoreography =
    !!container && (is(container, 'bpmn:Choreography') || is(container, 'bpmn:SubChoreography'));
  if (CHOREOGRAPHY_SHAPES.includes(type) && !inChoreography) return false;
  if (
    inChoreography &&
    !ARTIFACT_SHAPES.includes(type) &&
    !CHOREOGRAPHY_SHAPES.includes(type) &&
    !/Event$/.test(type) &&
    !/Gateway$/.test(type)
  ) {
    return false;
  }
  if (is(targetBo, 'bpmn:Choreography')) return !target.parent;
  // "MUST NOT be used in an Ad-Hoc Sub-Process: Start Event, End Event" (BPMN 2.0.2 PDF 211).
  if (
    is(targetBo, 'bpmn:AdHocSubProcess') &&
    (type === 'bpmn:StartEvent' || type === 'bpmn:EndEvent')
  ) {
    return false;
  }
  if (ARTIFACT_SHAPES.includes(type)) {
    return (
      !target.parent ||
      is(targetBo, 'bpmn:Participant') ||
      is(targetBo, 'bpmn:Lane') ||
      isExpandedContainer(target)
    );
  }
  if (is(targetBo, 'bpmn:Process')) return !target.parent;
  // A collaboration diagram holds the content of the pool drawn without boundary.
  if (is(targetBo, 'bpmn:Collaboration')) return !target.parent && !!container;
  if (is(targetBo, 'bpmn:Participant') || is(targetBo, 'bpmn:Lane')) return !!processOf(target);
  return isExpandedContainer(target) && !isUnsupported(target);
}

/** Choreography activities take boundary events too (BPMN 2.0.2 Table 11.7, PDF 371-373). */
function isChoreographyActivityShape(el: Element | undefined): boolean {
  return editableNode(el) && is(bo(el!), 'bpmn:ChoreographyActivity');
}

/**
 * Where on a choreography activity a boundary event may sit (Table 11.7, PDF
 * 371-372): a message event on the band of a participant that receives one of
 * the task's messages, cancel and compensation events on a participant band,
 * a signal event never on a band (on the name band's part of the border).
 * `center` is the event's center; without one any place is accepted.
 */
export function choreographyBoundaryFits(
  host: Shape,
  event: ModdleElement,
  center: { x: number; y: number } | undefined,
): boolean {
  if (!center) return true;
  const defs = getMany(event, 'eventDefinitions').map((d) => d.$type);
  if (defs.length !== 1) return true;
  const [def] = defs;
  let band: ModdleElement | undefined;
  for (const [b, r] of layoutBands(host, bandsOf(host))) {
    if (center.y >= r.y && center.y <= r.y + r.height) band = b;
  }
  if (def === 'bpmn:SignalEventDefinition') return !band;
  if (def === 'bpmn:CancelEventDefinition' || def === 'bpmn:CompensateEventDefinition') {
    return !!band;
  }
  if (def === 'bpmn:MessageEventDefinition') {
    if (!band) return false;
    const activity = bo(host)!;
    const receivers = getMany(activity, 'messageFlowRef')
      .map((f) => getRef(f, 'targetRef'))
      .filter(Boolean);
    const participant = getRef(band, 'bpmnElement');
    return receivers.length ? receivers.includes(participant) : !isInitiatingBand(band);
  }
  return true;
}

/**
 * A spot on a choreography activity's border where a boundary event of these
 * triggers may sit (keyboard placement): the receiving band for message,
 * cancel and compensation events, the name band for the others.
 */
export function choreographyBoundarySpot(
  host: Shape,
  event: ModdleElement,
): { x: number; y: number } {
  const bands = bandsOf(host);
  const name = nameBand(host, bands);
  // The left border, clear of band message decorators above and below.
  const candidates = [
    ...[...layoutBands(host, bands).values()].map((r) => ({ x: host.x, y: r.y + r.height / 2 })),
    { x: host.x, y: name.y + name.height / 2 },
  ];
  return candidates.find((c) => choreographyBoundaryFits(host, event, c)) ?? candidates.at(-1)!;
}

/**
 * Boundary events attach to activities (tasks, call activities, sub-processes)
 * and choreography activities; cancel boundary events only to transactions
 * (PDF 287) or choreography activities (Table 11.7). Event sub-processes have
 * no boundary events: they are not part of the normal flow.
 */
export function canAttach(
  shapes: Element[],
  target: Element | undefined,
  center?: { x: number; y: number },
): boolean {
  if (
    shapes.length !== 1 ||
    !is(bo(shapes[0]!), 'bpmn:BoundaryEvent') ||
    !(isActivity(target) || isChoreographyActivityShape(target))
  ) {
    return false;
  }
  const host = bo(target!)!;
  if (isEventSubProcess(host)) return false;
  // "Receive Tasks used in an Event-Based Gateway configuration MUST NOT have
  // any attached Intermediate Events" (BPMN 2.0.2 PDF 327).
  if (is(host, 'bpmn:ReceiveTask') && followsEventGateway(target!)) return false;
  const event = bo(shapes[0]!)!;
  const choreography = is(host, 'bpmn:ChoreographyActivity');
  // A new boundary event (palette) must have triggers its host allows (BPMN 2.0.2 PDF 287).
  if (!shapes[0]!.parent || choreography) {
    const allowed = allowedEventDefinitionsIn('bpmn:BoundaryEvent', {
      host,
      cancelActivity: event.get('cancelActivity') as boolean | undefined,
    });
    const defs = getMany(event, 'eventDefinitions');
    const fits = defs.length > 0 && defs.every((d) => allowed.includes(d.$type));
    if (!fits) return false;
    return !choreography || choreographyBoundaryFits(target as Shape, event, center);
  }
  return !hasTrigger(event, 'bpmn:CancelEventDefinition') || is(host, 'bpmn:Transaction');
}

/**
 * Whether a new event fits where it is dropped: its triggers must be allowed
 * in that container (e.g. error / escalation / compensation start events and
 * non-interrupting start events only in an event sub-process, cancel end
 * events only in a transaction, no triggers on a sub-process start; BPMN
 * 2.0.2 §10.5.2, PDF 271), and catching events need one.
 */
export function eventFitsIn(event: ModdleElement, target: Element | undefined): boolean {
  if (!is(event, 'bpmn:Event') || is(event, 'bpmn:BoundaryEvent')) return true;
  const container = processOf(target);
  const defs = getMany(event, 'eventDefinitions').map((d) => d.$type);
  if (is(event, 'bpmn:StartEvent') && event.get('isInterrupting') === false) {
    if (!isEventSubProcess(container)) return false;
  }
  if (!defs.length) return !definitionRequiredIn(event.$type, container);
  const allowed = allowedEventDefinitionsIn(event.$type, {
    container,
    isInterrupting: event.get('isInterrupting') as boolean | undefined,
  });
  return (
    defs.every((d) => allowed.includes(d) || isNotationOnlyDefinition(event.$type, d)) &&
    !definitionCombinationProblem(event.$type, defs, container)
  );
}

/**
 * "An Event Sub-Process MUST have one and only one Start Event" (BPMN 2.0.2
 * PDF 204): whether adding `count` start events (other than `except`) to
 * `container` would break that.
 */
export function exceedsEventSubProcessStart(
  container: ModdleElement | undefined,
  count = 1,
  except?: ModdleElement,
): boolean {
  if (!count || !isEventSubProcess(container)) return false;
  const existing = getMany(container, 'flowElements').filter(
    (f) => is(f, 'bpmn:StartEvent') && f !== except,
  ).length;
  return existing + count > 1;
}

/**
 * A lane from the palette is added to a pool with a process, after a lane, or
 * to a process diagram without pools (lanes are "often", not always, within a
 * pool; PDF 334).
 */
export function canAddLaneTo(target: Element | undefined): boolean {
  if (!target || isUnsupported(target)) return false;
  const pool = participantOf(target);
  if (pool) {
    if (!(is(bo(target), 'bpmn:Participant') || is(bo(target), 'bpmn:Lane'))) return false;
    return !!bo(pool)?.get('processRef');
  }
  const root = target.parent ? rootFrom(target) : target;
  if (target !== root && !is(bo(target), 'bpmn:Lane')) return false;
  // A process diagram without pools (not a collaboration, not a sub-process diagram).
  return (
    is(bo(root), 'bpmn:Process') && !childrenOf(root).some((c) => is(bo(c), 'bpmn:Participant'))
  );
}

function hasTrigger(el: ModdleElement, type: string): boolean {
  return getMany(el, 'eventDefinitions').some((d) => is(d, type));
}

/** Only these triggers may follow an event-based gateway (PDF 327), alone or combined. */
const EVENT_GATEWAY_TRIGGERS = [
  'bpmn:MessageEventDefinition',
  'bpmn:SignalEventDefinition',
  'bpmn:TimerEventDefinition',
  'bpmn:ConditionalEventDefinition',
];

/**
 * In a choreography an event-based gateway leads to choreography activities
 * or to timer, signal or conditional catch events, never message events
 * (BPMN 2.0.2 §11.7.2, Table 11.7, Fig 11.38; PDF 371-372, 379).
 */
const CHOREOGRAPHY_EVENT_GATEWAY_TRIGGERS = [
  'bpmn:SignalEventDefinition',
  'bpmn:TimerEventDefinition',
  'bpmn:ConditionalEventDefinition',
];

/** Whether a catch event with `defs` may follow an event-based gateway in `container`. */
export function eventGatewayTriggersFit(
  defs: readonly string[],
  container: ModdleElement | undefined,
): boolean {
  const triggers = withinChoreography(container)
    ? CHOREOGRAPHY_EVENT_GATEWAY_TRIGGERS
    : EVENT_GATEWAY_TRIGGERS;
  return defs.length > 0 && defs.every((d) => triggers.includes(d));
}

export function validEventGatewayTarget(t: ModdleElement): boolean {
  const choreography = withinChoreography(t.$parent);
  if (choreography && is(t, 'bpmn:ChoreographyActivity')) return true;
  if (!choreography && is(t, 'bpmn:ReceiveTask')) return true;
  return (
    is(t, 'bpmn:IntermediateCatchEvent') &&
    eventGatewayTriggersFit(
      getMany(t, 'eventDefinitions').map((d) => d.$type),
      t.$parent,
    )
  );
}

/**
 * Whether a sequence flow may start at `source`. End events, link throw events
 * (they jump to their catch event), compensation boundary events and
 * compensation activities (both reached through associations) have no outgoing
 * sequence flows.
 */
export function canBeFlowSource(source: Element | undefined): source is Shape {
  if (!editableNode(source)) return false;
  const s = bo(source)!;
  if (is(s, 'bpmn:EndEvent')) return false;
  if (is(s, 'bpmn:Activity') && s.get('isForCompensation')) return false;
  // "An Event Sub-Process MUST NOT have any incoming or outgoing Sequence Flows" (PDF 204).
  if (isEventSubProcess(s)) return false;
  if (is(s, 'bpmn:IntermediateThrowEvent') && hasTrigger(s, 'bpmn:LinkEventDefinition')) {
    return false;
  }
  if (is(s, 'bpmn:BoundaryEvent') && hasTrigger(s, 'bpmn:CompensateEventDefinition')) return false;
  return !!processOf(source.parent);
}

/** Sequence flows into `el`, leaving out `except` (the flow being reconnected). */
function incomingFlows(el: Element, except?: Element): Connection[] {
  return ((el.incoming ?? []) as Connection[]).filter(
    (c) => c !== except && is(bo(c), 'bpmn:SequenceFlow'),
  );
}

function outgoingFlows(el: Element, except?: Element): Connection[] {
  return ((el.outgoing ?? []) as Connection[]).filter(
    (c) => c !== except && is(bo(c), 'bpmn:SequenceFlow'),
  );
}

/** Whether `el` is a target of an event-based gateway (part of its configuration). */
export function followsEventGateway(el: Element, except?: Element): boolean {
  return incomingFlows(el, except).some(
    (c) => !!c.source && is(bo(c.source), 'bpmn:EventBasedGateway'),
  );
}

const isMessageCatch = (b: ModdleElement | undefined) =>
  is(b, 'bpmn:IntermediateCatchEvent') && hasTrigger(b!, 'bpmn:MessageEventDefinition');

/**
 * The configuration of an event-based gateway (BPMN 2.0.2 PDF 327): its
 * targets have no other incoming sequence flows, receive tasks among them
 * have no attached events, and receive tasks are not mixed with message
 * intermediate events.
 */
function eventGatewayConfigurationFits(
  gateway: Element,
  target: Element,
  except?: Element,
): boolean {
  const t = bo(target)!;
  if (incomingFlows(target, except).length) return false;
  if (is(t, 'bpmn:ReceiveTask') && ((target as Shape).attachers ?? []).length) return false;
  const siblings = outgoingFlows(gateway, except).map((c) => (c.target ? bo(c.target) : undefined));
  if (is(t, 'bpmn:ReceiveTask') && siblings.some(isMessageCatch)) return false;
  if (isMessageCatch(t) && siblings.some((s) => is(s, 'bpmn:ReceiveTask'))) return false;
  return true;
}

/**
 * gatewayDirection (BPMN 2.0.2 Table 8.46, PDF 118-119): a Converging gateway
 * has at most one outgoing, a Diverging gateway at most one incoming sequence flow.
 */
function gatewayDirectionFits(source: Element, target: Element, except?: Element): boolean {
  const s = bo(source)!;
  const t = bo(target)!;
  if (is(s, 'bpmn:Gateway') && s.get('gatewayDirection') === 'Converging') {
    if (outgoingFlows(source, except).length) return false;
  }
  if (is(t, 'bpmn:Gateway') && t.get('gatewayDirection') === 'Diverging') {
    if (incomingFlows(target, except).length) return false;
  }
  return true;
}

/**
 * Whether a sequence flow may connect `source` to `target`; `connection` is
 * the flow being reconnected (its current ends do not count).
 */
export function canConnect(
  source: Element | undefined,
  target: Element | undefined,
  connection?: Element,
): boolean {
  if (!canBeFlowSource(source) || !editableNode(target) || source === target) return false;
  const t = bo(target)!;
  if (is(t, 'bpmn:StartEvent') || is(t, 'bpmn:BoundaryEvent')) return false;
  // Outside the normal flow: event sub-processes, compensation activities (PDF 204, 268).
  if (isEventSubProcess(t) || (is(t, 'bpmn:Activity') && t.get('isForCompensation'))) return false;
  // A catching link event has no incoming sequence flows (PDF 268).
  if (is(t, 'bpmn:IntermediateCatchEvent') && hasTrigger(t, 'bpmn:LinkEventDefinition')) {
    return false;
  }
  // An instantiating event-based gateway or receive task has no incoming sequence flows (PDF 189, 328).
  if (
    (is(t, 'bpmn:EventBasedGateway') || is(t, 'bpmn:ReceiveTask')) &&
    t.get('instantiate') === true
  ) {
    return false;
  }
  // Event-based gateway targets: catch events with message/signal/timer/conditional, or receive tasks (PDF 327).
  if (is(bo(source)!, 'bpmn:EventBasedGateway')) {
    if (!validEventGatewayTarget(t)) return false;
    if (!eventGatewayConfigurationFits(source, target, connection)) return false;
  } else if (followsEventGateway(target, connection)) {
    // The target of an event-based gateway has no other incoming flows (PDF 327).
    return false;
  }
  if (!gatewayDirectionFits(source, target, connection)) return false;
  return processOf(source.parent) === processOf(target.parent);
}

/** Whether "append <type>" may add a node after `source` in its container. */
export function canAppend(source: Element | undefined, type: string): boolean {
  return canBeFlowSource(source) && canContain(source.parent, type);
}

/**
 * Message flow ends (BPMN 2.0.2 Table 7.4, PDF 72): pools and activities on both
 * ends; message throw / end events send, message start / catch / boundary events
 * receive. Gateways never take part.
 */
export function canSendMessage(el: ModdleElement): boolean {
  if (is(el, 'bpmn:Participant')) return true;
  if (is(el, 'bpmn:Activity')) return !isEventSubProcess(el);
  return (
    (is(el, 'bpmn:IntermediateThrowEvent') || is(el, 'bpmn:EndEvent')) &&
    hasTrigger(el, 'bpmn:MessageEventDefinition')
  );
}

export function canReceiveMessage(el: ModdleElement): boolean {
  if (is(el, 'bpmn:Participant')) return true;
  if (is(el, 'bpmn:Activity')) return !isEventSubProcess(el);
  return (
    (is(el, 'bpmn:StartEvent') ||
      is(el, 'bpmn:IntermediateCatchEvent') ||
      is(el, 'bpmn:BoundaryEvent')) &&
    hasTrigger(el, 'bpmn:MessageEventDefinition')
  );
}

function messageFlowsOf(el: Element, key: 'incoming' | 'outgoing', except?: Element): number {
  return ((el[key] ?? []) as Connection[]).filter(
    (c) => c !== except && is(bo(c), 'bpmn:MessageFlow'),
  ).length;
}

/**
 * Message flow counts on events (BPMN 2.0.2 PDF 278, 289): a Message
 * intermediate event has one incoming or one outgoing message flow, not both;
 * an End Event with more than one outgoing message flow is a Multiple end event.
 */
function messageFlowCountFits(source: Element, target: Element, except?: Element): boolean {
  const intermediateMessage = (el: Element) => {
    const b = bo(el)!;
    const defs = getMany(b, 'eventDefinitions');
    return (
      (is(b, 'bpmn:IntermediateCatchEvent') ||
        is(b, 'bpmn:IntermediateThrowEvent') ||
        is(b, 'bpmn:BoundaryEvent')) &&
      defs.length === 1 &&
      is(defs[0], 'bpmn:MessageEventDefinition')
    );
  };
  for (const el of [source, target]) {
    if (!intermediateMessage(el)) continue;
    if (messageFlowsOf(el, 'incoming', except) + messageFlowsOf(el, 'outgoing', except)) {
      return false;
    }
  }
  const s = bo(source)!;
  if (is(s, 'bpmn:EndEvent') && getMany(s, 'eventDefinitions').length < 2) {
    return messageFlowsOf(source, 'outgoing', except) === 0;
  }
  return true;
}

/**
 * Message flows connect different pools (or nodes in them); `connection` is
 * the flow being reconnected.
 */
export function canMessageFlow(
  source: Element | undefined,
  target: Element | undefined,
  connection?: Element,
): boolean {
  if (!source || !target || source === target) return false;
  const ok = (el: Element) =>
    !isUnsupported(el) && (is(bo(el), 'bpmn:Participant') || isEditableFlowNode(bo(el)));
  if (!ok(source) || !ok(target)) return false;
  if (!canSendMessage(bo(source)!) || !canReceiveMessage(bo(target)!)) return false;
  if (!messageFlowCountFits(source, target, connection)) return false;
  const a = participantBoOf(source);
  const b = participantBoOf(target);
  return !!a && !!b && a !== b;
}

/** A sequence or message flow that an association may end at (PDF 95: "Flow Objects and Flow"). */
function editableFlow(el: Element | undefined): el is Connection {
  return (
    !!el &&
    !!(el as Connection).waypoints &&
    !isUnsupported(el) &&
    (is(bo(el), 'bpmn:SequenceFlow') || is(bo(el), 'bpmn:MessageFlow'))
  );
}

/**
 * Associations (BPMN 2.0.2 PDF 95): "Text and graphical non-Flow Objects can be
 * associated with the Flow Objects and Flow". A text annotation or group links
 * with any other element or with a sequence / message flow; a data object or
 * data store links with a sequence flow (the visual shortcut of PDF 253, Fig
 * 10.68); a compensation boundary event with its compensation activity.
 */
export function canAssociate(source: Element | undefined, target: Element | undefined): boolean {
  if (!source || !target || source === target) return false;
  const end = (el: Element) => editableShape(el) || editableFlow(el);
  if (!end(source) || !end(target)) return false;
  if (editableFlow(source) && editableFlow(target)) return false;
  const s = bo(source)!;
  const t = bo(target)!;
  // Compensation: the target is the compensation activity (marked "for
  // compensation", PDF 332) of the same process.
  if (is(s, 'bpmn:BoundaryEvent') && hasTrigger(s, 'bpmn:CompensateEventDefinition')) {
    return (
      isActivity(target) &&
      t.get('isForCompensation') === true &&
      processOf(source.parent) === processOf(target.parent)
    );
  }
  const annotation = (b: ModdleElement) => is(b, 'bpmn:TextAnnotation');
  if (annotation(s) || annotation(t)) return annotation(s) !== annotation(t);
  const group = (b: ModdleElement) => is(b, 'bpmn:Group');
  if (group(s) || group(t)) return group(s) !== group(t);
  // A Message with a message flow (Fig 8.28, PDF 122).
  const message = (b: ModdleElement) => is(b, 'bpmn:Message');
  const messageFlow = (el: Element) => editableFlow(el) && is(bo(el), 'bpmn:MessageFlow');
  if (message(s) || message(t)) {
    return (message(s) && messageFlow(target)) || (messageFlow(source) && message(t));
  }
  const sequenceFlow = (el: Element) => editableFlow(el) && is(bo(el), 'bpmn:SequenceFlow');
  return (isData(source) && sequenceFlow(target)) || (sequenceFlow(source) && isData(target));
}

/** Containers (process, sub-process) enclosing an element, innermost first. */
function scopesOf(el: ModdleElement | undefined): ModdleElement[] {
  const out: ModdleElement[] = [];
  for (let p = el?.$parent; p; p = p.$parent) {
    if (is(p, 'bpmn:Process') || is(p, 'bpmn:SubProcess')) out.push(p);
  }
  return out;
}

/**
 * Whether data is visible from a flow node: a Data Object only within the
 * process or sub-process that contains it and the sub-processes nested in it
 * (BPMN 2.0.2 §10.4.1, PDF 233); a process Data Input / Output only within its
 * process; data stores are global.
 */
export function dataVisibleFrom(data: Element, node: Element): boolean {
  const d = bo(data)!;
  let scope: ModdleElement | undefined;
  if (is(d, 'bpmn:DataObjectReference')) scope = getRef(d, 'dataObjectRef')?.$parent;
  else if (is(d, 'bpmn:DataInput') || is(d, 'bpmn:DataOutput')) scope = d.$parent?.$parent;
  else return true;
  if (!scope) scope = processOf(data.parent);
  return !!scope && scopesOf(bo(node)).includes(scope);
}

const CATCH_EVENTS = ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];
const THROW_EVENTS = ['bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'];

function isEventOf(el: Element | undefined, types: string[]): boolean {
  return (
    editableNode(el) &&
    types.some((t) => is(bo(el), t)) &&
    !!processOf(el.parent) &&
    !is(processOf(el.parent), 'bpmn:Choreography') &&
    !is(processOf(el.parent), 'bpmn:SubChoreography')
  );
}

function isProcessIo(el: Element | undefined, type: string): boolean {
  return !!el && !isUnsupported(el) && is(bo(el), type);
}

/**
 * Data associations (BPMN 2.0.2 §10.4.1, PDF 247-254): data → activity
 * (input) or activity → data (output); a catch event writes the data it
 * received into data (a Start Event also into the process Data Inputs), a
 * throw event is filled from data (an End Event also from the process Data
 * Outputs). The data must be visible from the activity or event.
 */
export function dataAssociationType(
  source: Element | undefined,
  target: Element | undefined,
): string | null {
  if (!source || !target) return null;
  if (isDataSource(source) && isActivity(target)) {
    return dataVisibleFrom(source, target) ? 'bpmn:DataInputAssociation' : null;
  }
  if (isActivity(source) && isDataTarget(target)) {
    return dataVisibleFrom(target, source) ? 'bpmn:DataOutputAssociation' : null;
  }
  if (isEventOf(source, CATCH_EVENTS)) {
    const ok =
      isData(target) ||
      (is(bo(source), 'bpmn:StartEvent') && isProcessIo(target, 'bpmn:DataInput'));
    return ok && dataVisibleFrom(target, source) ? 'bpmn:DataOutputAssociation' : null;
  }
  if (isEventOf(target, THROW_EVENTS)) {
    const ok =
      isData(source) || (is(bo(target), 'bpmn:EndEvent') && isProcessIo(source, 'bpmn:DataOutput'));
    return ok && dataVisibleFrom(source, target) ? 'bpmn:DataInputAssociation' : null;
  }
  return null;
}

/**
 * Conversation links connect a conversation node with a pool, or with an
 * activity or event inside a pool (Fig 9.28, PDF 162: InteractionNodes).
 */
export function canLinkConversation(
  source: Element | undefined,
  target: Element | undefined,
): boolean {
  if (!source || !target || isUnsupported(source) || isUnsupported(target)) return false;
  const conv = (el: Element) => CONVERSATION_SHAPES.includes(bo(el)?.$type ?? '');
  const party = (el: Element) => {
    const b = bo(el);
    if (is(b, 'bpmn:Participant')) return true;
    // Tasks, sub-processes, call activities and events of a pool's process.
    const interaction =
      is(b, 'bpmn:Task') ||
      is(b, 'bpmn:SubProcess') ||
      is(b, 'bpmn:CallActivity') ||
      is(b, 'bpmn:Event');
    return interaction && editableNode(el) && !!participantBoOf(el);
  };
  return (conv(source) && party(target)) || (party(source) && conv(target));
}

export function connectionType(
  source: Element | undefined,
  target: Element | undefined,
): string | null {
  if (canConnect(source, target)) return 'bpmn:SequenceFlow';
  if (canMessageFlow(source, target)) return 'bpmn:MessageFlow';
  if (canLinkConversation(source, target)) return 'bpmn:ConversationLink';
  return (
    dataAssociationType(source, target) ??
    (canAssociate(source, target) ? 'bpmn:Association' : null)
  );
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
  return parent && is(bo(parent), 'bpmn:Lane') ? (participantOf(parent) ?? parent.parent) : parent;
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
  const destPool = participantBoOf(dest);
  const startsIn = leaving.filter((n) => is(bo(n), 'bpmn:StartEvent')).length;
  if (exceedsEventSubProcessStart(processOf(dest), startsIn)) return false;
  // Triggers only valid where the event is (e.g. an error start event in an
  // event sub-process) keep it from moving out of there.
  if (leaving.some((n) => !eventFitsIn(bo(n)!, dest))) return false;
  for (const n of leaving) {
    if (is(bo(n), 'bpmn:DataObjectReference')) return false; // its data object stays in its scope
    if (DATA_IO_SHAPES.includes(bo(n)?.$type ?? '')) return false; // belongs to its process
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
      if (is(bo(c), 'bpmn:MessageFlow') && participantBoOf(other) === destPool) return false;
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
    (c) =>
      isFlowNodeShape(c) ||
      isData(c) ||
      DATA_IO_SHAPES.includes(bo(c)?.$type ?? '') ||
      ARTIFACT_SHAPES.includes(bo(c)?.$type ?? ''),
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
  if ((is(b, 'bpmn:Activity') || is(b, 'bpmn:ChoreographyActivity')) && isEditableFlowNode(b)) {
    if (!newBounds) return true;
    if (newBounds.width < MIN_ACTIVITY.width || newBounds.height < MIN_ACTIVITY.height) {
      return false;
    }
    // Participant bands and the name band between them keep their room.
    const bands = bandsOf(shape);
    if (bands.length && newBounds.height < bandsHeight(bands) + MIN_NAME_BAND) return false;
    const content = isExpandedContainer(shape) ? childBounds(shape) : null;
    return !content || inside(newBounds, content);
  }
  if (is(b, 'bpmn:TextAnnotation') || is(b, 'bpmn:Group')) {
    return !newBounds || (newBounds.width >= 40 && newBounds.height >= 24);
  }
  if (is(b, 'bpmn:Participant')) {
    if (!newBounds) return true;
    const content = childBounds(shape);
    const h = isHorizontal(shape);
    return (
      along(newBounds, h).size >= MIN_POOL_LENGTH &&
      cross(newBounds, h).size >= MIN_LANE_HEIGHT &&
      lanesFit(shape, newBounds) &&
      (!content || inside(newBounds, content))
    );
  }
  if (is(b, 'bpmn:Lane')) {
    if (!newBounds) return true;
    // Lanes resize from their end edge only (bottom, or right in a vertical pool);
    // the pool and enclosing lanes grow or shrink with them.
    const h = isHorizontal(shape);
    const before = cross(shape, h);
    const after = cross(newBounds, h);
    const mainBefore = along(shape, h);
    const mainAfter = along(newBounds, h);
    return (
      mainAfter.start === mainBefore.start &&
      mainAfter.size === mainBefore.size &&
      after.start === before.start &&
      after.size >= minLaneExtent(shape, 'end')
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
        const shape = ctx.shape as Shape & { bfAddLane?: boolean; blackBox?: boolean };
        if (shape.bfAddLane) return canAddLaneTo(ctx.target);
        if (!canContain(ctx.target, ctx.shape.type as string)) return false;
        const created = bo(ctx.shape);
        if (created && !eventFitsIn(created, ctx.target)) return false;
        if (
          ctx.shape.type === 'bpmn:StartEvent' &&
          exceedsEventSubProcessStart(processOf(ctx.target))
        )
          return false;
        // The first pool on a process diagram takes over its process: it cannot be a black box.
        if (shape.blackBox && is(bo(ctx.target!), 'bpmn:Process')) return false;
        // Content dropped into a pool or sub-process must lie completely inside it.
        const container =
          ctx.target && is(bo(ctx.target), 'bpmn:Lane')
            ? (participantOf(ctx.target) ?? ctx.target.parent)
            : ctx.target;
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
    this.addRule(
      'shape.attach',
      (ctx: { shape: Shape; target?: Element; position?: { x: number; y: number } }) =>
        canAttach([ctx.shape], ctx.target, ctx.position) ? 'attach' : false,
    );
    this.addRule(
      'elements.create',
      (ctx: { elements: Element[]; target?: Element }) =>
        ctx.elements.every((el) => {
          if ((el as Connection).waypoints) return true;
          if (!canContain(ctx.target, (el as Shape).type as string)) return false;
          // Pasted top-level events must suit the container (nested ones go into pasted parents).
          const created = bo(el);
          return !!el.parent || !created || eventFitsIn(created, ctx.target);
        }) &&
        !exceedsEventSubProcessStart(
          processOf(ctx.target),
          ctx.elements.filter(
            (el) => (el as Shape).type === 'bpmn:StartEvent' && !(el as Shape).parent,
          ).length,
        ),
    );
    this.addRule('elements.move', (ctx: { shapes: Element[]; delta?: Delta; target?: Element }) => {
      // `delta` is absent when diagram-js checks whether a move may start at all.
      const delta = ctx.delta ?? { x: 0, y: 0 };
      const moved = new Set(ctx.shapes);
      // A boundary event moved on its own must land on (another) activity.
      if (ctx.shapes.length === 1 && is(bo(ctx.shapes[0]!), 'bpmn:BoundaryEvent')) {
        if (!ctx.delta) return true;
        const s = ctx.shapes[0] as Shape;
        const center = { x: s.x + s.width / 2 + delta.x, y: s.y + s.height / 2 + delta.y };
        return canAttach(ctx.shapes, ctx.target, center) ? 'attach' : false;
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
        if (type === 'bpmn:MessageFlow') {
          return canMessageFlow(ctx.source, ctx.target, ctx.connection);
        }
        if (type === 'bpmn:Association') return canAssociate(ctx.source, ctx.target);
        if (type === 'bpmn:ConversationLink') return canLinkConversation(ctx.source, ctx.target);
        if (type === 'bpmn:SequenceFlow') return canConnect(ctx.source, ctx.target, ctx.connection);
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

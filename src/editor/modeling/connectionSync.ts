/** BPMN side of creating, deleting, reconnecting and moving connections (sequence/message flows, associations, data associations) and of moving elements between containers. */
import type { Connection, Element } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type { ChangeLog } from './ChangeLog';
import { allLanes, artifactContainerOf, processOf } from './semantic';
import type { SemanticModel } from './semanticModel';
import { addAssociationIo, removeAssociationIo } from './dataIo';
import { TARGET_REF_PLACEHOLDER, collaborationOf, isArtifact, listProperty } from './semanticModel';

/** The pool an interaction node belongs to: itself, or the participant of its process. */
function participantOfNode(
  el: ModdleElement | undefined,
  collaboration: ModdleElement | undefined,
): ModdleElement | undefined {
  if (is(el, 'bpmn:Participant')) return el;
  for (let p = el; p; p = p.$parent) {
    if (is(p, 'bpmn:Process')) {
      return getMany(collaboration, 'participants').find((x) => getRef(x, 'processRef') === p);
    }
  }
  return undefined;
}

/** The conversation node and the participant (pool) a conversation link connects. */
function conversationEnds(
  source: ModdleElement | undefined,
  target: ModdleElement | undefined,
  collaboration: ModdleElement | undefined,
): { node: ModdleElement; participant: ModdleElement } | undefined {
  const node = is(source, 'bpmn:ConversationNode') ? source : target;
  const other = node === source ? target : source;
  const participant = participantOfNode(other, collaboration);
  return node && is(node, 'bpmn:ConversationNode') && participant
    ? { node, participant }
    : undefined;
}

/**
 * A conversation node's participantRefs are the pools its links reach (BPMN
 * 2.0.2 §9.5.2, Table 9.10): a new link adds the pool, removing the last link
 * to a pool removes it.
 */
function linkParticipant(flow: ModdleElement, log: ChangeLog): void {
  const collaboration = flow.$parent;
  const ends = conversationEnds(
    getRef(flow, 'sourceRef'),
    getRef(flow, 'targetRef'),
    collaboration,
  );
  if (!ends) return;
  const refs = ends.node.get('participantRef') as ModdleElement[];
  if (!refs.includes(ends.participant)) log.insert(refs, ends.participant);
}

function unlinkParticipant(
  flow: ModdleElement,
  source: ModdleElement | undefined,
  target: ModdleElement | undefined,
  log: ChangeLog,
): void {
  const collaboration = flow.$parent;
  const ends = conversationEnds(source, target, collaboration);
  if (!ends) return;
  const stillLinked = getMany(collaboration, 'conversationLinks').some((l) => {
    if (l === flow) return false;
    const other = conversationEnds(getRef(l, 'sourceRef'), getRef(l, 'targetRef'), collaboration);
    return other?.node === ends.node && other.participant === ends.participant;
  });
  if (!stillLinked)
    log.remove(ends.node.get('participantRef') as ModdleElement[], ends.participant);
}

export function addConnection(m: SemanticModel, connection: Connection, log: ChangeLog): void {
  const flow = bo(connection);
  const source = connection.source && bo(connection.source);
  const target = connection.target && bo(connection.target);
  if (!flow || !source || !target) return;

  if (is(flow, 'bpmn:ConversationLink')) {
    m.insertInto(collaborationOf(m.root()), 'conversationLinks', flow, log);
    log.set(flow, 'sourceRef', source);
    log.set(flow, 'targetRef', target);
    linkParticipant(flow, log);
  } else if (is(flow, 'bpmn:MessageFlow')) {
    // Message flows live in the collaboration and have no incoming/outgoing refs.
    const collaboration = bo(m.root());
    if (!collaboration || !is(collaboration, 'bpmn:Collaboration')) {
      throw new Error('Message flows need a collaboration.');
    }
    m.insertInto(collaboration, 'messageFlows', flow, log);
    log.set(flow, 'sourceRef', source);
    log.set(flow, 'targetRef', target);
  } else if (is(flow, 'bpmn:Association')) {
    const container = artifactContainerOf(connection.parent, m.root());
    if (!container) throw new Error('No container for the association.');
    m.insertInto(container, 'artifacts', flow, log);
    log.set(flow, 'sourceRef', source);
    log.set(flow, 'targetRef', target);
    // A compensation association points at the compensation activity (PDF 32, 63).
    const isCompensation =
      is(source, 'bpmn:BoundaryEvent') &&
      getMany(source, 'eventDefinitions').some((d) => is(d, 'bpmn:CompensateEventDefinition')) &&
      target.get('isForCompensation') === true;
    if (isCompensation && !Object.prototype.hasOwnProperty.call(flow, 'associationDirection')) {
      log.set(flow, 'associationDirection', 'One');
    }
    // A Message associated with a message flow is the message it carries
    // (PDF 122, Fig 8.28), unless the flow already names one.
    const [message, messageFlow] = is(source, 'bpmn:Message') ? [source, target] : [target, source];
    if (
      is(message, 'bpmn:Message') &&
      is(messageFlow, 'bpmn:MessageFlow') &&
      !getRef(messageFlow, 'messageRef')
    ) {
      log.set(messageFlow, 'messageRef', message);
    }
  } else if (is(flow, 'bpmn:DataInputAssociation')) {
    // data → activity or throw event: the target is a Data Input of the activity's
    // I/O specification, or of the event (BPMN 2.0.2 PDF 253-254).
    m.insertInto(target, 'dataInputAssociations', flow, log);
    log.set(flow, 'sourceRef', [source]);
    log.set(flow, 'targetRef', addAssociationIo(m, connection, target, source, 'input', log));
  } else if (is(flow, 'bpmn:DataOutputAssociation')) {
    // activity or catch event → data, from a Data Output of the activity / event.
    m.insertInto(source, 'dataOutputAssociations', flow, log);
    log.set(flow, 'sourceRef', [addAssociationIo(m, connection, source, target, 'output', log)]);
    log.set(flow, 'targetRef', target);
  } else {
    const process = processOf(connection.parent) ?? source.$parent;
    if (!process) throw new Error('Sequence flows must be inside a process.');
    m.insertInto(process, 'flowElements', flow, log);
    log.set(flow, 'sourceRef', source);
    log.set(flow, 'targetRef', target);
    log.insert(source.get('outgoing') as ModdleElement[], flow);
    log.insert(target.get('incoming') as ModdleElement[], flow);
  }
  m.addDi(connection, log);
}

export function removeConnection(m: SemanticModel, connection: Connection, log: ChangeLog): void {
  const flow = bo(connection);
  if (!flow) return;
  m.removeDi(connection, log);
  const owner = flow.$parent;
  m.removeForeignDi([flow], log);

  if (is(flow, 'bpmn:MessageFlow')) {
    if (owner) log.remove(owner.get('messageFlows') as ModdleElement[], flow);
    return;
  }
  if (is(flow, 'bpmn:ConversationLink')) {
    unlinkParticipant(flow, getRef(flow, 'sourceRef'), getRef(flow, 'targetRef'), log);
    if (owner) log.remove(owner.get('conversationLinks') as ModdleElement[], flow);
    return;
  }
  if (is(flow, 'bpmn:Association')) {
    if (owner) log.remove(owner.get('artifacts') as ModdleElement[], flow);
    return;
  }
  if (is(flow, 'bpmn:DataInputAssociation')) {
    if (!owner) return;
    log.remove(owner.get('dataInputAssociations') as ModdleElement[], flow);
    const property = getRef(flow, 'targetRef');
    const stillUsed = getMany(owner, 'dataInputAssociations').some(
      (a) => getRef(a, 'targetRef') === property,
    );
    // Files from other tools may target a placeholder property instead of a Data Input.
    if (property && property.name === TARGET_REF_PLACEHOLDER && !stillUsed) {
      log.remove(owner.get('properties') as ModdleElement[], property);
    }
    removeAssociationIo(m, flow, owner, 'input', log);
    return;
  }
  if (is(flow, 'bpmn:DataOutputAssociation')) {
    if (!owner) return;
    log.remove(owner.get('dataOutputAssociations') as ModdleElement[], flow);
    removeAssociationIo(m, flow, owner, 'output', log);
    return;
  }
  if (owner) log.remove(owner.get('flowElements') as ModdleElement[], flow);
  const source = getRef(flow, 'sourceRef');
  const target = getRef(flow, 'targetRef');
  if (source) {
    log.remove(source.get('outgoing') as ModdleElement[], flow);
    if (getRef(source, 'default') === flow) log.set(source, 'default', undefined);
  }
  if (target) log.remove(target.get('incoming') as ModdleElement[], flow);
}

export function reconnect(connection: Connection, log: ChangeLog): void {
  const flow = bo(connection);
  const newSource = connection.source && bo(connection.source);
  const newTarget = connection.target && bo(connection.target);
  if (!flow || !newSource || !newTarget) return;
  const oldSource = getRef(flow, 'sourceRef');
  const oldTarget = getRef(flow, 'targetRef');
  if (is(flow, 'bpmn:ConversationLink')) {
    unlinkParticipant(flow, oldSource, oldTarget, log);
    log.set(flow, 'sourceRef', newSource);
    log.set(flow, 'targetRef', newTarget);
    linkParticipant(flow, log);
    syncDrawnEnds(connection, log);
    return;
  }
  if (is(flow, 'bpmn:MessageFlow') || is(flow, 'bpmn:Association')) {
    log.set(flow, 'sourceRef', newSource);
    log.set(flow, 'targetRef', newTarget);
    syncDrawnEnds(connection, log);
    return;
  }
  if (oldSource !== newSource) {
    if (oldSource) {
      log.remove(oldSource.get('outgoing') as ModdleElement[], flow);
      if (getRef(oldSource, 'default') === flow) log.set(oldSource, 'default', undefined);
    }
    log.insert(newSource.get('outgoing') as ModdleElement[], flow);
    log.set(flow, 'sourceRef', newSource);
  }
  if (oldTarget !== newTarget) {
    if (oldTarget) log.remove(oldTarget.get('incoming') as ModdleElement[], flow);
    log.insert(newTarget.get('incoming') as ModdleElement[], flow);
    log.set(flow, 'targetRef', newTarget);
  }
  syncDrawnEnds(connection, log);
}

/**
 * BPMNEdge sourceElement / targetElement (PDF 405, 440) name the shapes an edge
 * is drawn between. After a reconnect the edge is drawn between its model ends,
 * so a value the file had follows the new end's shape.
 */
function syncDrawnEnds(connection: Connection, log: ChangeLog): void {
  const di = (connection as { di?: ModdleElement }).di;
  if (!di) return;
  const ends = [
    ['sourceElement', connection.source],
    ['targetElement', connection.target],
  ] as const;
  for (const [key, end] of ends) {
    if (!getRef(di, key)) continue;
    const endDi = (end as { di?: ModdleElement } | undefined)?.di;
    if (endDi && getRef(di, key) !== endDi) log.set(di, key, endDi);
  }
}

/** Moves content to the container (process / sub-process / collaboration) of its new diagram parent. */
export function syncContainer(m: SemanticModel, element: Element, log: ChangeLog): void {
  const b = bo(element);
  if (!b) return;
  const isFlow =
    is(b, 'bpmn:FlowNode') || is(b, 'bpmn:SequenceFlow') || is(b, 'bpmn:DataStoreReference');
  if (!isFlow && !isArtifact(b)) return;
  const desired = isFlow
    ? processOf(element.parent)
    : artifactContainerOf(element.parent, m.root());
  const current = b.$parent;
  if (!desired || !current || desired === current) return;
  const property = listProperty(b);
  log.remove(current.get(property) as ModdleElement[], b);
  if (is(b, 'bpmn:FlowNode')) {
    for (const lane of allLanes(current)) {
      log.remove(lane.get('flowNodeRef') as ModdleElement[], b);
    }
  }
  m.insertInto(desired, property, b, log);
}

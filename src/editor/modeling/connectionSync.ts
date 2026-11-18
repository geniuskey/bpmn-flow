/** BPMN side of creating, deleting, reconnecting and moving connections (sequence/message flows, associations, data associations) and of moving elements between containers. */
import type { Connection, Element } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type { ChangeLog } from './ChangeLog';
import { allLanes, artifactContainerOf, processOf } from './semantic';
import type { SemanticModel } from './semanticModel';
import { TARGET_REF_PLACEHOLDER, collaborationOf, isArtifact, listProperty } from './semanticModel';

export function addConnection(m: SemanticModel, connection: Connection, log: ChangeLog): void {
  const flow = bo(connection);
  const source = connection.source && bo(connection.source);
  const target = connection.target && bo(connection.target);
  if (!flow || !source || !target) return;

  if (is(flow, 'bpmn:ConversationLink')) {
    m.insertInto(collaborationOf(m.root()), 'conversationLinks', flow, log);
    log.set(flow, 'sourceRef', source);
    log.set(flow, 'targetRef', target);
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
  } else if (is(flow, 'bpmn:DataInputAssociation')) {
    // data → activity. BPMN requires a target; use a placeholder property of the activity.
    m.insertInto(target, 'dataInputAssociations', flow, log);
    log.set(flow, 'sourceRef', [source]);
    let property = getMany(target, 'properties').find((p) => p.name === TARGET_REF_PLACEHOLDER);
    if (!property) {
      property = m.created(connection, 'property', () =>
        m.factory.createModdle('bpmn:Property', { name: TARGET_REF_PLACEHOLDER }),
      );
      m.insertInto(target, 'properties', property, log);
    }
    log.set(flow, 'targetRef', property);
  } else if (is(flow, 'bpmn:DataOutputAssociation')) {
    // activity → data
    m.insertInto(source, 'dataOutputAssociations', flow, log);
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
    if (property && property.name === TARGET_REF_PLACEHOLDER && !stillUsed) {
      log.remove(owner.get('properties') as ModdleElement[], property);
    }
    return;
  }
  if (is(flow, 'bpmn:DataOutputAssociation')) {
    if (owner) log.remove(owner.get('dataOutputAssociations') as ModdleElement[], flow);
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
  if (
    is(flow, 'bpmn:MessageFlow') ||
    is(flow, 'bpmn:Association') ||
    is(flow, 'bpmn:ConversationLink')
  ) {
    log.set(flow, 'sourceRef', newSource);
    log.set(flow, 'targetRef', newTarget);
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

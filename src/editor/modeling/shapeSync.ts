/** BPMN side of creating and deleting shapes: containment, DI, data inputs/outputs, choreography bands, and clean-up of objects that become unused. */
import type { Shape } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, type BpmnData } from '../model';
import type { ChangeLog } from './ChangeLog';
import { allLanes, artifactContainerOf, processOf } from './semantic';
import { bandsOf } from './choreography';
import type { SemanticModel } from './semanticModel';
import {
  choreographyOf,
  collaborationOf,
  isProcessDataIoType,
  listProperty,
} from './semanticModel';

export function addShape(m: SemanticModel, shape: Shape, log: ChangeLog): void {
  const element = bo(shape);
  if (!element) return;

  if (is(element, 'bpmn:Participant')) {
    const collaboration = bo(m.root());
    if (!collaboration || !is(collaboration, 'bpmn:Collaboration')) {
      throw new Error('A pool can only be created in a collaboration.');
    }
    m.insertInto(collaboration, 'participants', element, log);
    let process = getRef(element, 'processRef');
    if (!process) {
      process = m.created(shape, 'process', () =>
        m.factory.createModdle('bpmn:Process', { isExecutable: false }),
      );
      log.set(element, 'processRef', process);
    }
    m.ensureRootElement(process, log);
  } else if (is(element, 'bpmn:Lane')) {
    const process = processOf(shape.parent);
    if (!process) throw new Error('A lane needs a pool.');
    let laneSet = getMany(process, 'laneSets')[0];
    if (!laneSet) {
      laneSet = m.created(shape, 'laneSet', () => m.factory.createModdle('bpmn:LaneSet'));
      m.insertInto(process, 'laneSets', laneSet, log);
    }
    m.insertInto(laneSet, 'lanes', element, log);
  } else if (is(element, 'bpmn:ConversationNode')) {
    m.insertInto(collaborationOf(m.root()), 'conversations', element, log);
  } else if (is(element, 'bpmn:TextAnnotation') || is(element, 'bpmn:Group')) {
    const container = artifactContainerOf(shape.parent, m.root());
    if (!container) throw new Error('No container for the artifact.');
    m.insertInto(container, 'artifacts', element, log);
    if (is(element, 'bpmn:Group') && !getRef(element, 'categoryValueRef')) {
      const value = m.created(shape, 'categoryValue', () =>
        m.factory.createModdle('bpmn:CategoryValue'),
      );
      const category = m.created(shape, 'category', () => m.factory.createModdle('bpmn:Category'));
      if (!getMany(category, 'categoryValue').includes(value)) {
        m.insertInto(category, 'categoryValue', value, log);
      }
      m.ensureRootElement(category, log);
      log.set(element, 'categoryValueRef', value);
    }
  } else if (isProcessDataIoType(element.$type)) {
    addDataIo(m, shape, element, log);
  } else {
    const container = processOf(shape.parent);
    if (!container) {
      throw new Error('Flow elements must be placed inside a process, pool or sub-process.');
    }
    if (is(element, 'bpmn:DataObjectReference') && !getRef(element, 'dataObjectRef')) {
      const dataObject = m.created(shape, 'dataObject', () =>
        m.factory.createModdle('bpmn:DataObject'),
      );
      m.insertInto(container, 'flowElements', dataObject, log);
      log.set(element, 'dataObjectRef', dataObject);
    }
    if (is(element, 'bpmn:DataStoreReference') && !getRef(element, 'dataStoreRef')) {
      const dataStore = m.created(shape, 'dataStore', () =>
        m.factory.createModdle('bpmn:DataStore', element.name ? { name: element.name } : {}),
      );
      m.ensureRootElement(dataStore, log);
      log.set(element, 'dataStoreRef', dataStore);
    }
    m.insertInto(container, 'flowElements', element, log);
    if (is(element, 'bpmn:ChoreographyActivity')) addBands(m, shape, element, log);
    if (is(element, 'bpmn:BoundaryEvent')) {
      log.set(element, 'attachedToRef', shape.host ? bo(shape.host) : undefined);
    }
  }
  m.addDi(shape, log);
}

export function removeShape(m: SemanticModel, shape: Shape, log: ChangeLog): void {
  const element = bo(shape);
  if (!element) return;
  m.removeDi(shape, log);
  const parent = element.$parent;

  if (is(element, 'bpmn:Participant')) {
    if (parent) log.remove(parent.get('participants') as ModdleElement[], element);
    const process = getRef(element, 'processRef');
    const sharedByOther = getMany(parent, 'participants').some(
      (p) => getRef(p, 'processRef') === process,
    );
    if (process && !sharedByOther) {
      log.remove(m.definitions.get('rootElements') as ModdleElement[], process);
      m.removeForeignDi([element, process], log);
    } else {
      m.removeForeignDi([element], log);
    }
    return;
  }
  if (is(element, 'bpmn:Lane')) {
    if (!parent) return;
    log.remove(parent.get('lanes') as ModdleElement[], element);
    if (getMany(parent, 'lanes').length === 0 && parent.$parent) {
      const owner = parent.$parent;
      if (is(owner, 'bpmn:Process')) log.remove(owner.get('laneSets') as ModdleElement[], parent);
      else if (is(owner, 'bpmn:Lane')) log.set(owner, 'childLaneSet', undefined);
    }
    return;
  }
  if (isProcessDataIoType(element.$type)) {
    removeDataIo(element, log);
    m.removeForeignDi([element], log);
    return;
  }
  if (parent) log.remove(parent.get(listProperty(element)) as ModdleElement[], element);
  const planeElements = m.plane().get('planeElement') as ModdleElement[];
  for (const band of bandsOf(shape)) log.remove(planeElements, band);
  if (is(element, 'bpmn:ChoreographyTask')) removeUnusedMessageFlows(m, element, log);
  if (is(element, 'bpmn:Group')) removeUnusedCategory(m, element, log);
  if (is(element, 'bpmn:DataObjectReference')) removeUnusedDataObject(m, element, log);
  if (is(element, 'bpmn:DataStoreReference')) removeUnusedDataStore(m, element, log);
  if (is(element, 'bpmn:FlowNode')) {
    for (const lane of allLanes(parent)) {
      log.remove(lane.get('flowNodeRef') as ModdleElement[], element);
    }
  }
  m.removeForeignDi([element], log);
}

/**
 * A process data input / output lives in the process's I/O specification and
 * is listed in its first input / output set (both created when missing, as
 * BPMN requires at least one of each).
 */
export function addDataIo(
  m: SemanticModel,
  shape: Shape,
  element: ModdleElement,
  log: ChangeLog,
): void {
  const process = processOf(shape.parent);
  if (!process || !is(process, 'bpmn:Process')) {
    throw new Error('Data inputs and outputs belong to a process (a pool), not a sub-process.');
  }
  let io = getRef(process, 'ioSpecification');
  if (!io) {
    io = m.created(shape, 'ioSpecification', () =>
      m.factory.createModdle('bpmn:InputOutputSpecification'),
    );
    log.setParent(io, process);
    log.set(process, 'ioSpecification', io);
  }
  const input = is(element, 'bpmn:DataInput');
  const setKey = input ? 'inputSets' : 'outputSets';
  let set = getMany(io, setKey)[0];
  if (!set) {
    set = m.created(shape, setKey, () =>
      m.factory.createModdle(input ? 'bpmn:InputSet' : 'bpmn:OutputSet'),
    );
    m.insertInto(io, setKey, set, log);
  }
  // The other set is required too.
  const otherKey = input ? 'outputSets' : 'inputSets';
  if (!getMany(io, otherKey).length) {
    const other = m.created(shape, otherKey, () =>
      m.factory.createModdle(input ? 'bpmn:OutputSet' : 'bpmn:InputSet'),
    );
    m.insertInto(io, otherKey, other, log);
  }
  m.insertInto(io, input ? 'dataInputs' : 'dataOutputs', element, log);
  log.insert(set.get(input ? 'dataInputRefs' : 'dataOutputRefs') as ModdleElement[], element);
}

export function removeDataIo(element: ModdleElement, log: ChangeLog): void {
  const io = element.$parent;
  if (!io) return;
  const input = is(element, 'bpmn:DataInput');
  log.remove(io.get(input ? 'dataInputs' : 'dataOutputs') as ModdleElement[], element);
  const refsKey = input ? 'dataInputRefs' : 'dataOutputRefs';
  for (const set of getMany(io, input ? 'inputSets' : 'outputSets')) {
    log.remove(set.get(refsKey) as ModdleElement[], element);
    // Optional/while-executing refs may also point at it.
    for (const key of input
      ? ['optionalInputRefs', 'whileExecutingInputRefs']
      : ['optionalOutputRefs', 'whileExecutingOutputRefs']) {
      log.remove(set.get(key) as ModdleElement[], element);
    }
  }
}

/**
 * A new choreography activity gets two participants (the first two of the
 * choreography, created if missing) and a top (initiating) and bottom band.
 */
export function addBands(
  m: SemanticModel,
  shape: Shape,
  activity: ModdleElement,
  log: ChangeLog,
): void {
  const choreography = choreographyOf(activity);
  if (!choreography) throw new Error('Choreography activities belong in a choreography.');
  if (getMany(activity, 'participantRef').length < 2) {
    const participants = choreography.get('participants') as ModdleElement[];
    const chosen = participants.slice(0, 2);
    ['Participant A', 'Participant B'].slice(chosen.length).forEach((name, i) => {
      const p = m.created(shape, `participant${i}`, () =>
        m.factory.createModdle('bpmn:Participant', { name }),
      );
      m.insertInto(choreography, 'participants', p, log);
      chosen.push(p);
    });
    log.set(activity, 'participantRef', chosen);
    log.set(activity, 'initiatingParticipantRef', chosen[0]);
  }
  // BPMN requires a choreography task to refer to at least one message flow.
  if (is(activity, 'bpmn:ChoreographyTask') && !getMany(activity, 'messageFlowRef').length) {
    const [from, to] = getMany(activity, 'participantRef');
    const flow = m.created(shape, 'messageFlow', () =>
      m.factory.createModdle('bpmn:MessageFlow', { sourceRef: from, targetRef: to }),
    );
    m.insertInto(choreography, 'messageFlows', flow, log);
    log.set(activity, 'messageFlowRef', [flow]);
  }
  let bands = bandsOf(shape);
  if (!bands.length) {
    const [a, b] = getMany(activity, 'participantRef');
    bands = [
      m.created(shape, 'bandTop', () =>
        m.factory.createModdle('bpmndi:BPMNShape', {
          id: `${activity.id}_band_top`,
          bpmnElement: a,
          choreographyActivityShape: (shape as unknown as BpmnData).di,
          participantBandKind: 'top_initiating',
        }),
      ),
      m.created(shape, 'bandBottom', () =>
        m.factory.createModdle('bpmndi:BPMNShape', {
          id: `${activity.id}_band_bottom`,
          bpmnElement: b,
          choreographyActivityShape: (shape as unknown as BpmnData).di,
          participantBandKind: 'bottom_non_initiating',
        }),
      ),
    ];
    const holder = shape as Shape & { bands?: ModdleElement[] };
    log.apply(
      () => (holder.bands = bands),
      () => (holder.bands = []),
    );
  }
  const plane = m.plane();
  for (const band of bands) {
    if (!getMany(plane, 'planeElement').includes(band)) {
      log.insert(plane.get('planeElement') as ModdleElement[], band);
      log.setParent(band, plane);
    }
  }
}

/** Message flows only referenced by a deleted choreography task go with it. */
export function removeUnusedMessageFlows(
  m: SemanticModel,
  task: ModdleElement,
  log: ChangeLog,
): void {
  const choreography = choreographyOf(task) ?? task.$parent;
  const flows = choreography?.get('messageFlows') as ModdleElement[] | undefined;
  if (!flows) return;
  for (const flow of getMany(task, 'messageFlowRef')) {
    let used = false;
    walkContainment(m.definitions, (el) => {
      if (el !== task && getMany(el, 'messageFlowRef').includes(flow)) used = true;
    });
    if (!used) log.remove(flows, flow);
  }
}

export function removeUnusedDataObject(
  m: SemanticModel,
  reference: ModdleElement,
  log: ChangeLog,
): void {
  const dataObject = getRef(reference, 'dataObjectRef');
  const container = dataObject?.$parent;
  if (!dataObject || !container) return;
  let used = false;
  walkContainment(m.definitions, (el) => {
    if (
      el !== reference &&
      is(el, 'bpmn:DataObjectReference') &&
      getRef(el, 'dataObjectRef') === dataObject
    ) {
      used = true;
    }
  });
  if (!used) log.remove(container.get('flowElements') as ModdleElement[], dataObject);
}

/** A data store no other reference points to is removed with its last reference. */
export function removeUnusedDataStore(
  m: SemanticModel,
  reference: ModdleElement,
  log: ChangeLog,
): void {
  const dataStore = getRef(reference, 'dataStoreRef');
  if (!dataStore || dataStore.$parent !== m.definitions) return;
  let used = false;
  walkContainment(m.definitions, (el) => {
    if (el !== reference && getRef(el, 'dataStoreRef') === dataStore) used = true;
  });
  if (!used) log.remove(m.definitions.get('rootElements') as ModdleElement[], dataStore);
}

export function removeUnusedCategory(m: SemanticModel, group: ModdleElement, log: ChangeLog): void {
  const value = getRef(group, 'categoryValueRef');
  const category = value?.$parent;
  if (!value || !category || getMany(category, 'categoryValue').length !== 1) return;
  let used = false;
  walkContainment(m.definitions, (el) => {
    if (el !== group && is(el, 'bpmn:Group') && getRef(el, 'categoryValueRef') === value) {
      used = true;
    }
  });
  if (!used) log.remove(m.definitions.get('rootElements') as ModdleElement[], category);
}

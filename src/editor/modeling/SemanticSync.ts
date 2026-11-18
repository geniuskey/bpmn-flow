/**
 * Keeps the BPMN semantic model in sync with diagram-js modeling commands.
 *
 * diagram-js only changes the diagram graph. For each command that adds,
 * removes, reconnects, re-parents or (re-)attaches elements, this interceptor
 * applies the matching change to the moddle tree (containment, references, DI
 * plane) on `executed` (also fired on redo) and reverts it exactly on
 * `reverted`, using a ChangeLog stored in the command context.
 */
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, rootOf, type BpmnData } from '../model';
import type BpmnElementFactory from './BpmnElementFactory';
import { ChangeLog } from './ChangeLog';
import { allLanes, artifactContainerOf, processOf } from './semantic';

type Ctx = Record<string, unknown>;
type Hook = (context: Ctx, log: ChangeLog) => void;
type Cache = { bfCreated?: Record<string, ModdleElement> };

/** Name BPMN tools use for the placeholder target of data input associations. */
export const TARGET_REF_PLACEHOLDER = '__targetRef_placeholder';

function isArtifact(el: ModdleElement): boolean {
  return is(el, 'bpmn:TextAnnotation') || is(el, 'bpmn:Group') || is(el, 'bpmn:Association');
}

function listProperty(el: ModdleElement): 'artifacts' | 'flowElements' | 'conversations' {
  if (is(el, 'bpmn:ConversationNode')) return 'conversations';
  return isArtifact(el) ? 'artifacts' : 'flowElements';
}

/** The collaboration on the diagram root, required for collaboration-level content. */
function collaborationOf(root: Element): ModdleElement {
  const b = bo(root);
  if (!b || !is(b, 'bpmn:Collaboration')) {
    throw new Error('This element needs a collaboration (add a pool first).');
  }
  return b;
}

export default class SemanticSync extends CommandInterceptor {
  static override $inject = ['eventBus', 'canvas', 'elementFactory', 'bpmnDefinitions'];

  constructor(
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly factory: BpmnElementFactory,
    private readonly definitions: ModdleElement,
  ) {
    super(eventBus);

    this.track('shape.create', 'semanticCreate', (ctx, log) =>
      this.addShape(ctx.shape as Shape, log),
    );
    this.track('shape.delete', 'semanticDelete', (ctx, log) =>
      this.removeShape(ctx.shape as Shape, log),
    );
    this.track('connection.create', 'semanticCreate', (ctx, log) =>
      this.addConnection(ctx.connection as Connection, log),
    );
    this.track('connection.delete', 'semanticDelete', (ctx, log) =>
      this.removeConnection(ctx.connection as Connection, log),
    );
    this.track('connection.reconnect', 'semanticReconnect', (ctx, log) =>
      this.reconnect(ctx.connection as Connection, log),
    );
    this.track(['shape.move', 'connection.move'], 'semanticMove', (ctx, log) =>
      this.syncContainer((ctx.shape ?? ctx.connection) as Element, log),
    );
    this.track('element.updateAttachment', 'semanticAttach', (ctx, log) => {
      const shape = ctx.shape as Shape;
      const b = bo(shape);
      if (b && is(b, 'bpmn:BoundaryEvent')) {
        log.set(b, 'attachedToRef', shape.host ? bo(shape.host) : undefined);
      }
    });
  }

  private track(commands: string | string[], key: string, hook: Hook): void {
    this.executed(commands, (event: { context: Ctx }) => {
      const log = new ChangeLog();
      hook(event.context, log);
      event.context[key] = log;
    });
    this.reverted(commands, (event: { context: Ctx }) => {
      (event.context[key] as ChangeLog | undefined)?.undo();
    });
  }

  private root(): Element {
    return rootOf(this.canvas);
  }

  private plane(): ModdleElement {
    return (this.canvas.getRootElement() as unknown as BpmnData).di;
  }

  /** Creates (once per diagram element, reused on redo) a helper model object. */
  private created(owner: Element, key: string, make: () => ModdleElement): ModdleElement {
    const cache = ((owner as Element & Cache).bfCreated ??= {});
    return (cache[key] ??= make());
  }

  private addDi(element: Element, log: ChangeLog): void {
    const di = (element as Partial<BpmnData>).di;
    if (!di) return;
    const plane = this.plane();
    if (!getMany(plane, 'planeElement').includes(di)) {
      log.insert(plane.get('planeElement') as ModdleElement[], di);
      log.setParent(di, plane);
    }
  }

  private removeDi(element: Element, log: ChangeLog): void {
    const di = (element as Partial<BpmnData>).di;
    if (di) log.remove(this.plane().get('planeElement') as ModdleElement[], di);
  }

  /**
   * Removes DI that other diagrams hold for a removed element and its content
   * (e.g. the drill-down diagram of a deleted collapsed sub-process), so no
   * diagram keeps pointing at something that is gone.
   */
  private removeForeignDi(removed: ModdleElement[], log: ChangeLog): void {
    const gone = new Set<ModdleElement>();
    for (const element of removed) walkContainment(element, (el) => gone.add(el));
    const diagrams = this.definitions.get('diagrams') as ModdleElement[];
    for (const diagram of [...diagrams]) {
      const plane = getRef(diagram, 'plane');
      if (!plane) continue;
      const target = getRef(plane, 'bpmnElement');
      if (target && gone.has(target)) {
        log.remove(diagrams, diagram);
        continue;
      }
      const planeElements = plane.get('planeElement') as ModdleElement[];
      for (const di of [...planeElements]) {
        const element = getRef(di, 'bpmnElement');
        if (element && gone.has(element)) log.remove(planeElements, di);
      }
    }
  }

  private insertInto(
    container: ModdleElement,
    property: string,
    item: ModdleElement,
    log: ChangeLog,
  ): void {
    log.insert(container.get(property) as ModdleElement[], item);
    log.setParent(item, container);
  }

  private ensureRootElement(element: ModdleElement, log: ChangeLog): void {
    const roots = this.definitions.get('rootElements') as ModdleElement[];
    if (!roots.includes(element)) {
      log.insert(roots, element);
      log.setParent(element, this.definitions);
    }
  }

  // ---------------------------------------------------------------- shapes

  private addShape(shape: Shape, log: ChangeLog): void {
    const element = bo(shape);
    if (!element) return;

    if (is(element, 'bpmn:Participant')) {
      const collaboration = bo(this.root());
      if (!collaboration || !is(collaboration, 'bpmn:Collaboration')) {
        throw new Error('A pool can only be created in a collaboration.');
      }
      this.insertInto(collaboration, 'participants', element, log);
      let process = getRef(element, 'processRef');
      if (!process) {
        process = this.created(shape, 'process', () =>
          this.factory.createModdle('bpmn:Process', { isExecutable: false }),
        );
        log.set(element, 'processRef', process);
      }
      this.ensureRootElement(process, log);
    } else if (is(element, 'bpmn:Lane')) {
      const process = processOf(shape.parent);
      if (!process) throw new Error('A lane needs a pool.');
      let laneSet = getMany(process, 'laneSets')[0];
      if (!laneSet) {
        laneSet = this.created(shape, 'laneSet', () => this.factory.createModdle('bpmn:LaneSet'));
        this.insertInto(process, 'laneSets', laneSet, log);
      }
      this.insertInto(laneSet, 'lanes', element, log);
    } else if (is(element, 'bpmn:ConversationNode')) {
      this.insertInto(collaborationOf(this.root()), 'conversations', element, log);
    } else if (is(element, 'bpmn:TextAnnotation') || is(element, 'bpmn:Group')) {
      const container = artifactContainerOf(shape.parent, this.root());
      if (!container) throw new Error('No container for the artifact.');
      this.insertInto(container, 'artifacts', element, log);
      if (is(element, 'bpmn:Group') && !getRef(element, 'categoryValueRef')) {
        const value = this.created(shape, 'categoryValue', () =>
          this.factory.createModdle('bpmn:CategoryValue'),
        );
        const category = this.created(shape, 'category', () =>
          this.factory.createModdle('bpmn:Category'),
        );
        if (!getMany(category, 'categoryValue').includes(value)) {
          this.insertInto(category, 'categoryValue', value, log);
        }
        this.ensureRootElement(category, log);
        log.set(element, 'categoryValueRef', value);
      }
    } else {
      const container = processOf(shape.parent);
      if (!container) {
        throw new Error('Flow elements must be placed inside a process, pool or sub-process.');
      }
      if (is(element, 'bpmn:DataObjectReference') && !getRef(element, 'dataObjectRef')) {
        const dataObject = this.created(shape, 'dataObject', () =>
          this.factory.createModdle('bpmn:DataObject'),
        );
        this.insertInto(container, 'flowElements', dataObject, log);
        log.set(element, 'dataObjectRef', dataObject);
      }
      this.insertInto(container, 'flowElements', element, log);
      if (is(element, 'bpmn:BoundaryEvent')) {
        log.set(element, 'attachedToRef', shape.host ? bo(shape.host) : undefined);
      }
    }
    this.addDi(shape, log);
  }

  private removeShape(shape: Shape, log: ChangeLog): void {
    const element = bo(shape);
    if (!element) return;
    this.removeDi(shape, log);
    const parent = element.$parent;

    if (is(element, 'bpmn:Participant')) {
      if (parent) log.remove(parent.get('participants') as ModdleElement[], element);
      const process = getRef(element, 'processRef');
      const sharedByOther = getMany(parent, 'participants').some(
        (p) => getRef(p, 'processRef') === process,
      );
      if (process && !sharedByOther) {
        log.remove(this.definitions.get('rootElements') as ModdleElement[], process);
        this.removeForeignDi([element, process], log);
      } else {
        this.removeForeignDi([element], log);
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
    if (parent) log.remove(parent.get(listProperty(element)) as ModdleElement[], element);
    if (is(element, 'bpmn:Group')) this.removeUnusedCategory(element, log);
    if (is(element, 'bpmn:DataObjectReference')) this.removeUnusedDataObject(element, log);
    if (is(element, 'bpmn:FlowNode')) {
      for (const lane of allLanes(parent)) {
        log.remove(lane.get('flowNodeRef') as ModdleElement[], element);
      }
    }
    this.removeForeignDi([element], log);
  }

  private removeUnusedDataObject(reference: ModdleElement, log: ChangeLog): void {
    const dataObject = getRef(reference, 'dataObjectRef');
    const container = dataObject?.$parent;
    if (!dataObject || !container) return;
    let used = false;
    walkContainment(this.definitions, (el) => {
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

  private removeUnusedCategory(group: ModdleElement, log: ChangeLog): void {
    const value = getRef(group, 'categoryValueRef');
    const category = value?.$parent;
    if (!value || !category || getMany(category, 'categoryValue').length !== 1) return;
    let used = false;
    walkContainment(this.definitions, (el) => {
      if (el !== group && is(el, 'bpmn:Group') && getRef(el, 'categoryValueRef') === value) {
        used = true;
      }
    });
    if (!used) log.remove(this.definitions.get('rootElements') as ModdleElement[], category);
  }

  // ----------------------------------------------------------- connections

  private addConnection(connection: Connection, log: ChangeLog): void {
    const flow = bo(connection);
    const source = connection.source && bo(connection.source);
    const target = connection.target && bo(connection.target);
    if (!flow || !source || !target) return;

    if (is(flow, 'bpmn:ConversationLink')) {
      this.insertInto(collaborationOf(this.root()), 'conversationLinks', flow, log);
      log.set(flow, 'sourceRef', source);
      log.set(flow, 'targetRef', target);
    } else if (is(flow, 'bpmn:MessageFlow')) {
      // Message flows live in the collaboration and have no incoming/outgoing refs.
      const collaboration = bo(this.root());
      if (!collaboration || !is(collaboration, 'bpmn:Collaboration')) {
        throw new Error('Message flows need a collaboration.');
      }
      this.insertInto(collaboration, 'messageFlows', flow, log);
      log.set(flow, 'sourceRef', source);
      log.set(flow, 'targetRef', target);
    } else if (is(flow, 'bpmn:Association')) {
      const container = artifactContainerOf(connection.parent, this.root());
      if (!container) throw new Error('No container for the association.');
      this.insertInto(container, 'artifacts', flow, log);
      log.set(flow, 'sourceRef', source);
      log.set(flow, 'targetRef', target);
    } else if (is(flow, 'bpmn:DataInputAssociation')) {
      // data → activity. BPMN requires a target; use a placeholder property of the activity.
      this.insertInto(target, 'dataInputAssociations', flow, log);
      log.set(flow, 'sourceRef', [source]);
      let property = getMany(target, 'properties').find((p) => p.name === TARGET_REF_PLACEHOLDER);
      if (!property) {
        property = this.created(connection, 'property', () =>
          this.factory.createModdle('bpmn:Property', { name: TARGET_REF_PLACEHOLDER }),
        );
        this.insertInto(target, 'properties', property, log);
      }
      log.set(flow, 'targetRef', property);
    } else if (is(flow, 'bpmn:DataOutputAssociation')) {
      // activity → data
      this.insertInto(source, 'dataOutputAssociations', flow, log);
      log.set(flow, 'targetRef', target);
    } else {
      const process = processOf(connection.parent) ?? source.$parent;
      if (!process) throw new Error('Sequence flows must be inside a process.');
      this.insertInto(process, 'flowElements', flow, log);
      log.set(flow, 'sourceRef', source);
      log.set(flow, 'targetRef', target);
      log.insert(source.get('outgoing') as ModdleElement[], flow);
      log.insert(target.get('incoming') as ModdleElement[], flow);
    }
    this.addDi(connection, log);
  }

  private removeConnection(connection: Connection, log: ChangeLog): void {
    const flow = bo(connection);
    if (!flow) return;
    this.removeDi(connection, log);
    const owner = flow.$parent;
    this.removeForeignDi([flow], log);

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

  private reconnect(connection: Connection, log: ChangeLog): void {
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
  private syncContainer(element: Element, log: ChangeLog): void {
    const b = bo(element);
    if (!b) return;
    const isFlow =
      is(b, 'bpmn:FlowNode') || is(b, 'bpmn:SequenceFlow') || is(b, 'bpmn:DataStoreReference');
    if (!isFlow && !isArtifact(b)) return;
    const desired = isFlow
      ? processOf(element.parent)
      : artifactContainerOf(element.parent, this.root());
    const current = b.$parent;
    if (!desired || !current || desired === current) return;
    const property = listProperty(b);
    log.remove(current.get(property) as ModdleElement[], b);
    if (is(b, 'bpmn:FlowNode')) {
      for (const lane of allLanes(current)) {
        log.remove(lane.get('flowNodeRef') as ModdleElement[], b);
      }
    }
    this.insertInto(desired, property, b, log);
  }
}

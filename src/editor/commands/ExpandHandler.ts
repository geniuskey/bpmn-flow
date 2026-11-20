/**
 * Collapses or expands a sub-process, transaction, ad-hoc sub-process or
 * sub-choreography (BPMN DI `isExpanded`, BPMN 2.0.2 Tables 12.10-12.15).
 *
 * BPMN DI cannot hide content inside a collapsed shape of the same plane, so
 * collapsing moves the content's shapes and edges to a drill-down diagram
 * whose plane references the element (as Table 12.39 shows; created when
 * missing), and expanding moves them back into the shape and removes that
 * diagram. The semantic model does not change. Content keeps its layout; the
 * shape is resized (nested `shape.resize`, so boundary events and flows
 * follow). One undo step.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementFactory from 'diagram-js/lib/core/ElementFactory';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { getMany, is, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';
import {
  bo,
  canExpand,
  childrenOf,
  isConnection,
  isExpandedShape,
  type BpmnData,
  type BpmnRoot,
  type BpmnShape,
} from '../model';
import { ChangeLog } from '../modeling/ChangeLog';
import type BpmnIds from '../modeling/BpmnIds';
import { drillDownRootOf, isLiveRoot, rootElementOf } from '../modeling/drillDown';

export const SET_EXPANDED = 'element.setExpanded';

type Bounds = { x: number; y: number; width: number; height: number };

interface Context {
  shape: BpmnShape;
  expanded: boolean;
  log?: ChangeLog;
  /** Bounds the shape is resized to (postExecute). */
  newBounds?: Bounds;
  moved?: Element[];
}

/** Size of a collapsed sub-process: drawn like a task (PDF 173). */
const COLLAPSED = { width: 100, height: 80 };
const EXPANDED_MIN = { width: 350, height: 200 };
/** Space between an expanded shape's border and its content (room for the label on top). */
const PAD = { x: 40, top: 50, bottom: 40 };
/** Where moved content starts in a new drill-down diagram (positive coordinates, PDF 397). */
const PLANE_ORIGIN = { x: 100, y: 100 };

interface Content {
  shapes: Shape[];
  connections: Connection[];
}

/** Shapes below `parent` (parents before children) and the connections between them. */
function contentOf(parent: Element): Content {
  const shapes: Shape[] = [];
  const connections = new Set<Connection>();
  const visit = (p: Element) => {
    for (const child of childrenOf(p)) {
      if (isConnection(child)) connections.add(child);
      else {
        shapes.push(child as Shape);
        visit(child);
      }
    }
  };
  visit(parent);
  const inside = new Set<Element>(shapes);
  // Associations, data associations... of the content are drawn on the root.
  for (const s of shapes) {
    for (const c of [...s.incoming, ...s.outgoing]) {
      if (inside.has(c.source!) && inside.has(c.target!)) connections.add(c);
    }
  }
  return { shapes, connections: [...connections] };
}

function boundsOf(shapes: Shape[]): Bounds | null {
  if (!shapes.length) return null;
  const x = Math.min(...shapes.map((s) => s.x));
  const y = Math.min(...shapes.map((s) => s.y));
  return {
    x,
    y,
    width: Math.max(...shapes.map((s) => s.x + s.width)) - x,
    height: Math.max(...shapes.map((s) => s.y + s.height)) - y,
  };
}

/**
 * Why `shape` cannot be collapsed (`expanded` false) or expanded (true), or
 * null when it can.
 */
export function expandBlocker(shape: Element | undefined, expanded: boolean): string | null {
  const b = shape && bo(shape);
  if (!shape || !b || !shape.parent) return 'Not available.';
  if (!canExpand(b)) {
    return 'Only sub-processes, transactions, ad-hoc sub-processes and sub-choreographies expand or collapse.';
  }
  if ((shape as Partial<BpmnData>).unsupported) return 'This element is not editable.';
  if (isExpandedShape(shape) === expanded) {
    return expanded ? 'It is already expanded.' : 'It is already collapsed.';
  }
  if (!expanded) {
    // The drill-down diagram must hold both ends of every edge it draws.
    const { shapes } = contentOf(shape);
    const inside = new Set<Element>(shapes);
    for (const s of shapes) {
      for (const c of [...s.incoming, ...s.outgoing]) {
        if (!inside.has(c.source!) || !inside.has(c.target!)) {
          return 'Its content is connected to elements outside it; remove those connections first.';
        }
      }
    }
  }
  return null;
}

export default class ExpandHandler {
  static $inject = ['canvas', 'elementFactory', 'moddle', 'bpmnDefinitions', 'bpmnIds', 'modeling'];

  constructor(
    private readonly canvas: Canvas,
    private readonly elementFactory: ElementFactory,
    private readonly moddle: BpmnModdleInstance,
    private readonly definitions: ModdleElement,
    private readonly ids: BpmnIds,
    private readonly modeling: Modeling,
  ) {}

  execute(context: Context): Element[] {
    const { shape, expanded } = context;
    const current = isExpandedShape(shape);
    // Collapsing an already collapsed shape only adds its (empty) drill-down diagram.
    if (expanded || current) {
      const blocker = expandBlocker(shape, expanded);
      if (blocker) throw new Error(blocker);
    }
    const log = new ChangeLog();
    const moved: Element[] = [];
    const element = bo(shape)!;
    const diagrams = this.definitions.get('diagrams') as ModdleElement[];

    if (!expanded) {
      const drill = drillDownRootOf(this.canvas, element) ?? this.createDrillDownRoot(element);
      const diagram = drill.di.$parent!;
      if (!diagrams.includes(diagram)) {
        log.insert(diagrams, diagram);
        log.setParent(diagram, this.definitions);
      }
      if (current) {
        const content = contentOf(shape);
        const box = boundsOf(content.shapes);
        const delta = box
          ? { x: PLANE_ORIGIN.x - box.x, y: PLANE_ORIGIN.y - box.y }
          : { x: 0, y: 0 };
        moved.push(...this.relocate(content, shape, drill, delta, log));
      }
      context.newBounds = current
        ? {
            x: shape.x,
            y: Math.round(shape.y + shape.height / 2 - COLLAPSED.height / 2),
            ...COLLAPSED,
          }
        : undefined;
    } else {
      const drill = drillDownRootOf(this.canvas, element, this.definitions);
      let size = { ...EXPANDED_MIN };
      if (drill) {
        const content = contentOf(drill);
        const box = boundsOf(content.shapes);
        if (box) {
          size = {
            width: Math.max(EXPANDED_MIN.width, box.width + 2 * PAD.x),
            height: Math.max(EXPANDED_MIN.height, box.height + PAD.top + PAD.bottom),
          };
        }
        const y = Math.round(shape.y + shape.height / 2 - size.height / 2);
        const delta = box ? { x: shape.x + PAD.x - box.x, y: y + PAD.top - box.y } : { x: 0, y: 0 };
        moved.push(...this.relocate(content, drill, shape, delta, log));
        log.remove(diagrams, drill.di.$parent!);
      }
      context.newBounds = {
        x: shape.x,
        y: Math.round(shape.y + shape.height / 2 - size.height / 2),
        ...size,
      };
    }

    log.setExplicit(shape.di, 'isExpanded', expanded);
    if ((shape as Partial<BpmnData>).expandedByContent) {
      log.apply(
        () => delete (shape as Partial<BpmnData>).expandedByContent,
        () => ((shape as Partial<BpmnData>).expandedByContent = true),
      );
    }
    this.showLiveRoot(shape);
    context.log = log;
    context.moved = moved;
    return [shape, ...moved];
  }

  postExecute(context: Context): void {
    const { shape, newBounds } = context;
    if (!newBounds) return;
    if (
      newBounds.x === shape.x &&
      newBounds.y === shape.y &&
      newBounds.width === shape.width &&
      newBounds.height === shape.height
    ) {
      return;
    }
    this.modeling.resizeShape(shape, newBounds);
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    this.showLiveRoot(context.shape);
    return [context.shape, ...(context.moved ?? [])];
  }

  /** If the displayed diagram was just removed, show the one with the shape. */
  private showLiveRoot(shape: Element): void {
    const active = this.canvas.getRootElement() as unknown as Element;
    if (!isLiveRoot(this.definitions, active)) {
      this.canvas.setRootElement(rootElementOf(shape) as never);
    }
  }

  /** A new BPMNDiagram / BPMNPlane for `element` and its canvas root (kept for redo). */
  private createDrillDownRoot(element: ModdleElement): BpmnRoot {
    let planeId = this.ids.next('bpmndi:BPMNPlane');
    while (this.canvas.getRootElements().some((r) => r.id === `__root_${planeId}`)) {
      planeId = this.ids.next('bpmndi:BPMNPlane');
    }
    const plane = this.moddle.create('bpmndi:BPMNPlane', { id: planeId, bpmnElement: element });
    const diagram = this.moddle.create('bpmndi:BPMNDiagram', {
      id: this.ids.next('bpmndi:BPMNDiagram'),
      plane,
    });
    plane.$parent = diagram;
    const root = this.elementFactory.createRoot({
      id: `__root_${planeId}`,
      businessObject: element,
      di: plane,
    }) as BpmnRoot;
    this.canvas.addRootElement(root as never);
    return root;
  }

  /**
   * Moves `content` from below `from` to below `to` (another diagram or the
   * expanded shape), shifted by `delta`, together with its DI. Logged, so
   * undo moves it back to the exact parents it had.
   */
  private relocate(
    content: Content,
    from: Element,
    to: Element,
    delta: { x: number; y: number },
    log: ChangeLog,
  ): Element[] {
    const { shapes, connections } = content;
    const parents = new Map<Element, Element>();
    for (const el of [...shapes, ...connections]) parents.set(el, el.parent!);
    const toRoot = rootElementOf(to);
    const forward = (el: Element): Element => {
      const old = parents.get(el)!;
      if (!isConnection(el)) return old === from ? to : old;
      // Sequence flows live in their container, other connections on the diagram.
      return is(bo(el), 'bpmn:SequenceFlow') ? el.source!.parent! : toRoot;
    };
    const move = (parentOf: (el: Element) => Element, dx: number, dy: number) => {
      for (const c of connections) this.canvas.removeConnection(c as never);
      for (const s of [...shapes].reverse()) this.canvas.removeShape(s as never);
      for (const s of shapes) {
        s.x += dx;
        s.y += dy;
        this.canvas.addShape(s as never, parentOf(s) as never);
      }
      for (const c of connections) {
        c.waypoints = c.waypoints.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
        this.canvas.addConnection(c as never, parentOf(c) as never);
      }
    };
    log.apply(
      () => move(forward, delta.x, delta.y),
      () => move((el) => parents.get(el)!, -delta.x, -delta.y),
    );

    // DI follows: same relative order (z-order, PDF 398), in the target plane.
    const targetPlane = (rootElementOf(to) as unknown as BpmnData).di;
    const dis: ModdleElement[] = [];
    for (const el of [...shapes, ...connections]) {
      const di = (el as Partial<BpmnData>).di;
      if (di) dis.push(di);
      for (const band of (el as { bands?: ModdleElement[] }).bands ?? []) dis.push(band);
    }
    const order = (di: ModdleElement) => getMany(di.$parent, 'planeElement').indexOf(di);
    dis.sort((a, b) => order(a) - order(b));
    const targetList = targetPlane.get('planeElement') as ModdleElement[];
    for (const di of dis) {
      const source = di.$parent;
      if (source && is(source, 'bpmndi:BPMNPlane')) {
        log.remove(source.get('planeElement') as ModdleElement[], di);
      }
      log.insert(targetList, di);
      log.setParent(di, targetPlane);
    }
    return [...shapes, ...connections];
  }
}

/**
 * Applies a computed layout as one undoable command: pools, lanes, expanded
 * sub-processes and groups are resized, flow nodes and artifacts moved
 * (boundary events to their own place, or with their host), content the
 * layout does not place moves with its container, connections get the
 * computed waypoints (or are re-routed), and labels their computed bounds.
 */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { readBounds, readLabelBounds, type Bounds } from '@/bpmn/di/di';
import { getRef, is, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, childrenOf, isConnection, isExpandedShape, type BpmnData } from '../model';
import type BpmnFlowLayouter from './BpmnFlowLayouter';
import { cropWaypoints } from './BpmnFlowLayouter';
import type { Box, LayoutResult } from '../types';

export type { Box, LayoutResult };

export const APPLY_LAYOUT = 'layout.apply';
export const SET_LAYOUT_LABELS = 'layout.labels';

const STRAIGHT = /^bpmn:(Association|DataInputAssociation|DataOutputAssociation)$/;

function depth(el: Element): number {
  let d = 0;
  for (let p = el.parent; p; p = p.parent) d++;
  return d;
}

function isContainer(shape: Shape): boolean {
  return is(bo(shape), 'bpmn:Participant') || isExpandedShape(shape);
}

export class ApplyLayoutHandler {
  static $inject = ['modeling', 'elementRegistry', 'layouter', 'commandStack'];

  constructor(
    private readonly modeling: Modeling,
    private readonly registry: ElementRegistry,
    private readonly layouter: BpmnFlowLayouter,
    private readonly commandStack: CommandStack,
  ) {}

  preExecute(context: { layout: LayoutResult }): void {
    const { layout } = context;
    const hints = { lanesHandled: true };
    const entries = Object.entries(layout.shapes)
      .map(([id, box]) => ({ shape: this.registry.get(id) as Shape | undefined, box }))
      .filter((e): e is { shape: Shape; box: Box } => !!e.shape && !isConnection(e.shape));

    // Containers before their content; lanes after their pool; boundary events
    // after their host; groups last (they only frame what is placed).
    const rank = (s: Shape) => {
      const b = bo(s);
      if (is(b, 'bpmn:Group')) return 1e6;
      if (is(b, 'bpmn:Lane')) return depth(s) * 10 + 1;
      return depth(s) * 10 + (s.host ? 2 : 0);
    };
    entries.sort((a, b) => rank(a.shape) - rank(b.shape));

    const placed = new Set(entries.map((e) => e.shape));
    const moveBy = (shape: Shape, delta: { x: number; y: number }) =>
      (delta.x || delta.y) && this.modeling.moveShape(shape, delta, undefined, undefined, hints);

    for (const { shape, box } of entries) {
      const delta = { x: box.x - shape.x, y: box.y - shape.y };
      const resized = box.width !== shape.width || box.height !== shape.height;
      if (isContainer(shape)) {
        // Content the layout does not place (artifacts, groups) moves with its container.
        const passengers = childrenOf(shape).filter(
          (c) =>
            !isConnection(c) &&
            !placed.has(c as Shape) &&
            !(c as Shape).host &&
            !is(bo(c), 'bpmn:Lane'),
        ) as Shape[];
        this.modeling.resizeShape(shape, box, undefined, hints);
        for (const p of passengers) moveBy(p, delta);
      } else if (is(bo(shape), 'bpmn:Lane') || is(bo(shape), 'bpmn:Group') || resized) {
        this.modeling.resizeShape(shape, box, undefined, hints);
      } else {
        moveBy(shape, delta);
      }
      // `shape.move` does not carry boundary events (only `elements.move` does).
      for (const attacher of (shape.attachers ?? []) as Shape[])
        if (!placed.has(attacher)) moveBy(attacher, delta);
    }

    const connections = new Set<Connection>();
    for (const { shape } of entries) {
      for (const s of [shape, ...((shape.attachers ?? []) as Shape[])]) {
        for (const c of [...s.incoming, ...s.outgoing] as Connection[]) connections.add(c);
      }
    }
    for (const id of Object.keys(layout.connections ?? {})) {
      const c = this.registry.get(id) as Connection | undefined;
      if (c && isConnection(c)) connections.add(c);
    }
    for (const c of connections) {
      if (!c.source || !c.target) continue;
      const given = layout.connections?.[c.id];
      let waypoints = given;
      if (
        given &&
        STRAIGHT.test(bo(c)?.$type ?? '') &&
        !isConnection(c.source) &&
        !isConnection(c.target)
      )
        waypoints = cropWaypoints(given, c.source as Shape, c.target as Shape);
      waypoints ??= this.layouter.layoutConnection({ ...c, waypoints: [] } as Connection, {
        source: c.source,
        target: c.target,
      });
      this.modeling.updateWaypoints(c, waypoints);
    }
  }

  postExecute(context: { layout: LayoutResult }): void {
    const labels = Object.entries(context.layout.labels ?? {})
      .map(([id, bounds]) => ({ element: this.registry.get(id) as Element | undefined, bounds }))
      .filter((l): l is { element: Element; bounds: Box } => !!l.element);
    if (labels.length) this.commandStack.execute(SET_LAYOUT_LABELS, { labels });
  }

  execute(): [] {
    return [];
  }

  revert(): [] {
    return [];
  }
}

interface LabelChange {
  element: Element;
  bounds: Box;
}

interface SavedLabel {
  element: Element;
  hadLabel: boolean;
  old?: Bounds;
  /** DI bounds of the shape when the labels were set (not yet synced to a move). */
  pre?: Bounds;
}

/**
 * BPMNLabel bounds after a layout. DiSync shifts the label of a moved shape by
 * the move when the command finishes (and back on undo), so shape labels are
 * written relative to the DI bounds that are about to be synced.
 */
export class LayoutLabelsHandler {
  static $inject = ['moddle'];

  constructor(private readonly moddle: BpmnModdleInstance) {}

  execute(context: { labels: LabelChange[]; saved?: SavedLabel[] }): Element[] {
    context.saved = [];
    for (const { element, bounds } of context.labels) {
      const di = (element as Partial<BpmnData>).di;
      if (!di) continue;
      const pre = isConnection(element) ? undefined : readBounds(di);
      const old = readLabelBounds(di);
      context.saved.push({
        element,
        hadLabel: !!getRef(di, 'label'),
        ...(old ? { old } : {}),
        ...(pre ? { pre } : {}),
      });
      const shape = element as Shape;
      const dx = pre ? shape.x - pre.x : 0;
      const dy = pre ? shape.y - pre.y : 0;
      this.write(di, { ...bounds, x: bounds.x - dx, y: bounds.y - dy });
    }
    return context.labels.map((l) => l.element);
  }

  revert(context: { saved?: SavedLabel[] }): Element[] {
    const saved = context.saved ?? [];
    for (const { element, hadLabel, old, pre } of [...saved].reverse()) {
      const di = (element as Partial<BpmnData>).di!;
      if (!old) {
        if (!hadLabel) di.set('label', undefined);
        else getRef(di, 'label')?.set('bounds', undefined);
        continue;
      }
      const now = pre ? readBounds(di) : undefined;
      const dx = now && pre ? now.x - pre.x : 0;
      const dy = now && pre ? now.y - pre.y : 0;
      this.write(di, { ...old, x: old.x + dx, y: old.y + dy });
    }
    return saved.map((s) => s.element);
  }

  private write(di: ModdleElement, b: Box): void {
    let label = getRef(di, 'label');
    if (!label) {
      label = this.moddle.create('bpmndi:BPMNLabel', {});
      label.$parent = di;
      di.set('label', label);
    }
    const r = (n: number) => Math.round(n);
    const bounds = getRef(label, 'bounds');
    if (bounds) {
      bounds.set('x', r(b.x));
      bounds.set('y', r(b.y));
      bounds.set('width', r(b.width));
      bounds.set('height', r(b.height));
    } else {
      const created = this.moddle.create('dc:Bounds', {
        x: r(b.x),
        y: r(b.y),
        width: r(b.width),
        height: r(b.height),
      });
      created.$parent = label;
      label.set('bounds', created);
    }
  }
}

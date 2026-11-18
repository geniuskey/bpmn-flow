/**
 * Copy / cut / paste / duplicate of supported flow nodes and the sequence flows
 * between them. Pasting creates new BPMN elements (new ids) in one undoable
 * `elements.create` command, with the originals' semantics (event definitions,
 * loop markers, conditions, default flows, documentation; see copySemantics)
 * and DI geometry. Boundary events are not copied: they cannot exist without
 * their host's attachment, which a paste does not re-create.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import type { Point } from '@/bpmn/di/di';
import { isEditableConnection, isEditableFlowNode } from '@/bpmn/model/elements';
import { getRef, is, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';
import { bo, type BpmnData } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import type BpmnIds from '../modeling/BpmnIds';
import { copySemantics, type CopyContext } from '../modeling/copySemantics';
import { deletable } from './BpmnFlowRules';

interface CopiedShape {
  key: string;
  type: string;
  name?: string;
  /** The original business object; its semantics are cloned on paste. */
  source: ModdleElement;
  isExpanded?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CopiedConnection {
  key: string;
  type: string;
  name?: string;
  source: ModdleElement;
  sourceKey: string;
  targetKey: string;
  waypoints: Point[];
}

export interface ClipboardContent {
  shapes: CopiedShape[];
  connections: CopiedConnection[];
  parentId?: string;
}

const OFFSET = 30;

export default class Clipboard {
  static $inject = [
    'elementFactory',
    'modeling',
    'selection',
    'elementRegistry',
    'canvas',
    'rules',
    'moddle',
    'bpmnIds',
  ];
  private content: ClipboardContent | null = null;
  private pasteCount = 0;

  constructor(
    private readonly factory: BpmnElementFactory,
    private readonly modeling: Modeling,
    private readonly selection: Selection,
    private readonly registry: ElementRegistry,
    private readonly canvas: Canvas,
    private readonly rules: Rules,
    moddle: BpmnModdleInstance,
    ids: BpmnIds,
  ) {
    this.copyContext = { moddle, nextId: (type) => ids.next(type) };
  }

  private readonly copyContext: CopyContext;

  isEmpty(): boolean {
    return !this.content?.shapes.length;
  }

  /** The selected elements that can be copied (supported flow nodes, no boundary events). */
  private copyable(elements: Element[]): Shape[] {
    return elements.filter(
      (e) =>
        !(e as Connection).waypoints &&
        isEditableFlowNode(bo(e)) &&
        !is(bo(e), 'bpmn:BoundaryEvent') &&
        !(e as Partial<BpmnData>).unsupported,
    ) as Shape[];
  }

  copy(elements: Element[] = this.selection.get() as Element[]): number {
    const shapes = this.copyable(elements);
    if (!shapes.length) return 0;
    const set = new Set<Element>(shapes);
    const connections = shapes
      .flatMap((s) => s.outgoing as Connection[])
      .filter((c) => c.target && set.has(c.target) && isEditableConnection(bo(c)));
    this.content = {
      parentId: shapes[0]!.parent?.id,
      shapes: shapes.map((s) => ({
        key: s.id,
        type: String(s.type),
        name: bo(s)?.name,
        source: bo(s)!,
        isExpanded: (s as Partial<BpmnData>).di?.get('isExpanded') as boolean | undefined,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
      })),
      connections: connections.map((c) => ({
        key: c.id,
        type: String(c.type),
        name: bo(c)?.name,
        source: bo(c)!,
        sourceKey: c.source!.id,
        targetKey: c.target!.id,
        waypoints: c.waypoints.map((p) => ({ x: p.x, y: p.y })),
      })),
    };
    this.pasteCount = 0;
    return shapes.length;
  }

  /** Copies, then deletes exactly what was copied (and the flows attached to it). */
  cut(elements: Element[] = this.selection.get() as Element[]): number {
    const shapes = this.copyable(elements);
    const n = this.copy(shapes);
    const removable = deletable(shapes);
    if (n && removable.length && this.rules.allowed('elements.delete', { elements: removable })) {
      this.modeling.removeElements(removable);
    }
    return n;
  }

  paste(): Element[] {
    const content = this.content;
    if (!content?.shapes.length) return [];
    this.pasteCount++;
    const byKey = new Map<string, Element>();
    const elements: Element[] = content.shapes.map((s) => {
      const shape = this.factory.createShape({
        type: s.type,
        name: s.name,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
      } as never);
      copySemantics(s.source, bo(shape)!, this.copyContext);
      if (s.isExpanded !== undefined)
        (shape as Partial<BpmnData>).di?.set('isExpanded', s.isExpanded);
      byKey.set(s.key, shape);
      return shape;
    });
    for (const c of content.connections) {
      const connection = this.factory.createConnection({
        type: c.type,
        name: c.name,
        source: byKey.get(c.sourceKey),
        target: byKey.get(c.targetKey),
        waypoints: c.waypoints.map((p) => ({ ...p })),
      } as never);
      copySemantics(c.source, bo(connection)!, this.copyContext);
      byKey.set(c.key, connection);
      elements.push(connection);
    }
    // Default flows point at the pasted copy of the original default flow.
    for (const s of content.shapes) {
      const original = getRef(s.source, 'default');
      const copy = original?.id ? byKey.get(original.id) : undefined;
      if (copy) bo(byKey.get(s.key)!)!.set('default', bo(copy));
    }
    const minX = Math.min(...content.shapes.map((s) => s.x));
    const minY = Math.min(...content.shapes.map((s) => s.y));
    const maxX = Math.max(...content.shapes.map((s) => s.x + s.width));
    const maxY = Math.max(...content.shapes.map((s) => s.y + s.height));
    const offset = OFFSET * this.pasteCount;
    const position = { x: (minX + maxX) / 2 + offset, y: (minY + maxY) / 2 + offset };
    const parent =
      (content.parentId && this.registry.get(content.parentId)) || this.canvas.getRootElement();
    if (this.rules.allowed('elements.create', { elements, position, target: parent }) === false)
      return [];
    const created = this.modeling.createElements(elements, position, parent as Element);
    this.selection.select(created.filter((e) => !(e as Connection).waypoints));
    return created;
  }

  duplicate(): Element[] {
    if (!this.copy()) return [];
    return this.paste();
  }
}

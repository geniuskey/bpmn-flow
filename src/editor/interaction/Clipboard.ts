/**
 * Copy / paste / duplicate of supported flow nodes and the sequence flows
 * between them. Pasting creates new BPMN elements (new ids) in one undoable
 * `elements.create` command; names, types and DI geometry are copied.
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import type { Point } from '@/bpmn/di/di';
import { isEditableConnection, isEditableFlowNode } from '@/bpmn/model/elements';
import { bo, type BpmnData } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';

interface CopiedShape {
  key: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CopiedConnection {
  type: string;
  name?: string;
  source: string;
  target: string;
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
  ) {}

  isEmpty(): boolean {
    return !this.content?.shapes.length;
  }

  copy(elements: Element[] = this.selection.get() as Element[]): number {
    const shapes = elements.filter(
      (e) =>
        !(e as Connection).waypoints &&
        isEditableFlowNode(bo(e)) &&
        !(e as Partial<BpmnData>).unsupported,
    ) as Shape[];
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
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
      })),
      connections: connections.map((c) => ({
        type: String(c.type),
        name: bo(c)?.name,
        source: c.source!.id,
        target: c.target!.id,
        waypoints: c.waypoints.map((p) => ({ x: p.x, y: p.y })),
      })),
    };
    this.pasteCount = 0;
    return shapes.length;
  }

  paste(): Element[] {
    const content = this.content;
    if (!content?.shapes.length) return [];
    this.pasteCount++;
    const byKey = new Map<string, Shape>();
    const elements: Element[] = content.shapes.map((s) => {
      const shape = this.factory.createShape({
        type: s.type,
        name: s.name,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
      } as never);
      byKey.set(s.key, shape);
      return shape;
    });
    for (const c of content.connections) {
      elements.push(
        this.factory.createConnection({
          type: c.type,
          name: c.name,
          source: byKey.get(c.source),
          target: byKey.get(c.target),
          waypoints: c.waypoints.map((p) => ({ ...p })),
        } as never),
      );
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

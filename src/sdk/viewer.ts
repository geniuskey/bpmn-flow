/**
 * A read-only viewer that re-lays out the diagram to fit its container: in a
 * narrow container the flow runs top → bottom, in a wide one left → right,
 * and it reflows when the container is resized. The layout is applied to a
 * private copy of the document; the file's own diagram (DI) is never changed.
 *
 * ```ts
 * const viewer = new BpmnFlowViewer(document.querySelector('#side-panel')!);
 * await viewer.importXml(xml);
 * ```
 */
import { loadBpmnDocument, serializeDocument, type BpmnDocument } from '@/bpmn/document';
import { parseBpmnXml } from '@/bpmn/import/parse';
import { EditorController } from '@/editor/EditorController';
import { layoutDiagram, type EngineResult } from '@/editor/layout/engine';
import { extractLayout } from '@/editor/layout/extract';
import type { LayoutDensity, LayoutDirection, LDiagram, LineStyle } from '@/editor/layout/graph';
import { writeLayoutToDi } from '@/editor/layout/project';
import { measureLabel } from '@/editor/renderer/text';
import type { CanvasImportResult } from '@/editor/types';

export interface BpmnFlowViewerOptions {
  /**
   * 'auto' (default) picks the direction that shows the diagram largest in the
   * container; 'LR' / 'TB' fix it; false shows the diagram as drawn.
   */
  reflow?: 'auto' | LayoutDirection | false;
  /** Spacing of the reflowed layout (default 'compact'). */
  density?: LayoutDensity;
  /** How flows are drawn (default 'orthogonal'). */
  lineStyle?: LineStyle;
}

export interface ViewerImportResult extends CanvasImportResult {
  document: BpmnDocument;
  /** Direction the diagram is shown in, or null when shown as drawn. */
  direction: LayoutDirection | null;
}

function extent(result: EngineResult): { width: number; height: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of [...Object.values(result.shapes), ...Object.values(result.labels)]) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return x0 < x1 ? { width: x1 - x0, height: y1 - y0 } : { width: 1, height: 1 };
}

export class BpmnFlowViewer extends EditorController {
  private readonly viewOptions: Required<Omit<BpmnFlowViewerOptions, 'lineStyle'>>;
  private source: BpmnDocument | null = null;
  private projection: BpmnDocument | null = null;
  private graph: LDiagram | null = null;
  private direction: LayoutDirection | null = null;
  private observer: ResizeObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, options: BpmnFlowViewerOptions = {}) {
    super(container, {
      readOnly: true,
      ...(options.lineStyle ? { lineStyle: options.lineStyle } : {}),
    });
    this.viewOptions = { reflow: options.reflow ?? 'auto', density: options.density ?? 'compact' };
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onResize(), 120);
      });
      this.observer.observe(container);
    }
  }

  /** Parses and shows a BPMN 2.0 XML document, reflowed for the container. */
  async importXml(xml: string, fileName = 'diagram.bpmn'): Promise<ViewerImportResult> {
    const document = await loadBpmnDocument(xml, fileName);
    return this.showDocument(document);
  }

  /** Shows (a reflowed copy of) a loaded document; the document itself is not changed. */
  async showDocument(document: BpmnDocument): Promise<ViewerImportResult> {
    const xml = await serializeDocument(document);
    const parsed = await parseBpmnXml(xml);
    this.source = document;
    this.projection = { ...document, moddle: parsed.moddle, definitions: parsed.definitions };
    this.direction = null;
    const result = this.open(this.projection);
    const root = this.shownRoot();
    this.graph =
      this.viewOptions.reflow === false || !root ? null : (extractLayout(root)?.diagram ?? null);
    this.relayout();
    return { ...result, document, direction: this.direction };
  }

  /** Direction the diagram is shown in, or null when it is shown as drawn. */
  getDirection(): LayoutDirection | null {
    return this.direction;
  }

  /** The XML of the document as given (the reflowed copy is never exported). */
  override async exportXml(): Promise<string> {
    if (!this.source) throw new Error('No document is open.');
    return serializeDocument(this.source);
  }

  override destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) clearTimeout(this.timer);
    super.destroy();
  }

  private layout(direction: LayoutDirection): EngineResult {
    return layoutDiagram(
      this.graph!,
      { direction, density: this.viewOptions.density, lineStyle: this.getLineStyle() },
      measureLabel,
    );
  }

  /** The layout and direction for the container's current size. */
  private choose(): { direction: LayoutDirection; result: EngineResult } {
    const { reflow } = this.viewOptions;
    if (reflow === 'LR' || reflow === 'TB')
      return { direction: reflow, result: this.layout(reflow) };
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const options = (['LR', 'TB'] as const).map((direction) => {
      const result = this.layout(direction);
      const size = extent(result);
      // Left → right reads more naturally: it wins unless top → bottom is clearly larger.
      const scale = Math.min(w / size.width, h / size.height) * (direction === 'LR' ? 1.15 : 1);
      return { direction, result, scale };
    });
    return options[0]!.scale >= options[1]!.scale ? options[0]! : options[1]!;
  }

  private relayout(): void {
    const root = this.shownRoot();
    if (!this.graph || !this.projection || !root) return;
    const { direction, result } = this.choose();
    writeLayoutToDi(this.projection.moddle, root, result, direction === 'LR');
    this.direction = direction;
    this.open(this.projection);
  }

  private onResize(): void {
    if (!this.graph || this.viewOptions.reflow !== 'auto') {
      this.fit();
      return;
    }
    if (this.choose().direction !== this.direction) this.relayout();
    else this.fit();
  }
}

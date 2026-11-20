/**
 * `@geniuskey/bpmn-flow/editor` — framework-agnostic BPMN editor.
 *
 * ```ts
 * import { BpmnFlowEditor } from '@geniuskey/bpmn-flow/editor';
 * import '@geniuskey/bpmn-flow/style.css';
 *
 * const editor = new BpmnFlowEditor(document.querySelector('#canvas')!, { keyboard: true });
 * await editor.importXml(xml);
 * editor.subscribe((snapshot) => console.log(snapshot.selection, snapshot.dirty));
 * const out = await editor.exportXml();
 * ```
 */
import { loadBpmnDocument, type BpmnDocument } from '@/bpmn/document';
import { newChoreographyXml, newDiagramXml } from '@/bpmn/model/newDiagram';
import { EditorController } from '@/editor/EditorController';
import type { CanvasImportResult, EditorOptions } from '@/editor/types';
import { bindKeyboard, type KeyboardOptions } from './keyboard';

export type {
  BandOp,
  CanvasImportResult,
  DiagramInfo,
  EditorOptions,
  EditorSnapshot,
  EditorTool,
  ElementDetail,
  ElkWorkerSource,
  LoopField,
  EventDetail,
  LayoutResult,
  LoopKind,
  PropertyValue,
  ShapePreset,
  TimerType,
} from '@/editor/types';
/** The BPMN 2.0.2 shape library (palette entries) and their previews. */
export {
  SHAPE_LIBRARY,
  LIBRARY_ENTRIES,
  searchLibrary,
  type LibraryEntry,
  type LibraryGroup,
} from '@/editor/library';
export { renderPreview } from '@/editor/renderer/preview';
export type { ReplaceOption } from '@/editor/modeling/replace';
export type { BpmnDocument } from '@/bpmn/document';
export type { CompatibilityReport } from '@/bpmn/validation/compatibility';
export { bindKeyboard, type KeyboardOptions } from './keyboard';
/** The lower-level controller `BpmnFlowEditor` extends (takes a loaded `BpmnDocument`). */
export { EditorController };

export interface BpmnFlowEditorOptions extends EditorOptions {
  /**
   * Bind the default keyboard shortcuts (undo/redo, delete, copy/paste, arrows,
   * tools, zoom) to the container. Pass an object to customize. Default: false.
   */
  keyboard?: boolean | KeyboardOptions;
}

export interface ImportResult extends CanvasImportResult {
  document: BpmnDocument;
}

export class BpmnFlowEditor extends EditorController {
  private unbindKeyboard: (() => void) | null = null;

  constructor(container: HTMLElement, options: BpmnFlowEditorOptions = {}) {
    super(container, options);
    if (options.keyboard) {
      this.unbindKeyboard = bindKeyboard(
        this,
        container,
        options.keyboard === true ? {} : options.keyboard,
      );
    }
  }

  /**
   * Parses, verifies and shows a BPMN 2.0 XML document. Files that cannot be
   * round-tripped losslessly open read-only (see `document.report`). Throws
   * `BpmnImportError` for files that cannot be parsed; the previous document
   * stays open in that case.
   */
  async importXml(xml: string, fileName = 'diagram.bpmn'): Promise<ImportResult> {
    const document = await loadBpmnDocument(xml, fileName);
    return { ...this.open(document), document };
  }

  /** Opens a new, empty diagram. */
  async createNew(kind: 'process' | 'choreography' = 'process'): Promise<ImportResult> {
    return this.importXml(kind === 'choreography' ? newChoreographyXml() : newDiagramXml());
  }

  override destroy(): void {
    this.unbindKeyboard?.();
    this.unbindKeyboard = null;
    super.destroy();
  }
}

/**
 * `@geniuskey/bpmn-flow/react` — React wrapper around `BpmnFlowEditor`.
 *
 * ```tsx
 * import { BpmnFlowCanvas } from '@geniuskey/bpmn-flow/react';
 * import '@geniuskey/bpmn-flow/style.css';
 *
 * <BpmnFlowCanvas xml={xml} keyboard onSnapshot={(s) => setDirty(s.dirty)} ref={editorRef} />
 * ```
 *
 * The component never re-renders the canvas: `xml` is imported when it changes,
 * everything else goes through the editor instance (`ref` / `onReady`).
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { loadBpmnDocument } from '@/bpmn/document';
import { newDiagramXml } from '@/bpmn/model/newDiagram';
import type { EditorSnapshot, ElkWorkerSource } from '@/editor/types';
import { BpmnFlowEditor, type ImportResult, type KeyboardOptions } from './editor';
import { BpmnFlowViewer, type BpmnFlowViewerOptions, type ViewerImportResult } from './viewer';

export interface BpmnFlowCanvasProps {
  /** BPMN 2.0 XML to show. Re-imported whenever the string changes. Omit for a new diagram. */
  xml?: string;
  fileName?: string;
  /** Default keyboard shortcuts on the canvas (see `bindKeyboard`). Read once, on mount. */
  keyboard?: boolean | KeyboardOptions;
  /** @deprecated Ignored: auto layout no longer uses ELK. */
  elkWorker?: ElkWorkerSource;
  /** Called once with the editor instance after it is created. */
  onReady?: (editor: BpmnFlowEditor) => void;
  /** Called after each successful import. */
  onImport?: (result: ImportResult) => void;
  /** Called when the XML cannot be imported (the previous diagram stays open). */
  onImportError?: (error: unknown) => void;
  /** Selection, undo state, dirty flag, zoom… on every change. */
  onSnapshot?: (snapshot: EditorSnapshot) => void;
  /** A modeling command failed and was rolled back. */
  onCommandError?: (error: unknown) => void;
  className?: string;
  style?: CSSProperties;
}

export const BpmnFlowCanvas = forwardRef<BpmnFlowEditor | null, BpmnFlowCanvasProps>(
  function BpmnFlowCanvas(props, ref) {
    const { xml, fileName, className, style } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const [editor, setEditor] = useState<BpmnFlowEditor | null>(null);
    // Latest callbacks without re-creating the editor.
    const callbacks = useRef(props);
    callbacks.current = props;

    const reportImportError = (error: unknown) => {
      if (callbacks.current.onImportError) callbacks.current.onImportError(error);
      else console.error(error);
    };

    useImperativeHandle(ref, () => editor as BpmnFlowEditor, [editor]);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const { keyboard, elkWorker } = callbacks.current;
      const instance = new BpmnFlowEditor(host, {
        ...(keyboard !== undefined ? { keyboard } : {}),
        ...(elkWorker !== undefined ? { elkWorker } : {}),
      });
      const offSnapshot = instance.subscribe((s) => callbacks.current.onSnapshot?.(s));
      const offError = instance.onCommandError((e) => callbacks.current.onCommandError?.(e));
      setEditor(instance);
      callbacks.current.onReady?.(instance);
      return () => {
        offSnapshot();
        offError();
        instance.destroy();
        setEditor(null);
      };
    }, []);

    useEffect(() => {
      if (!editor) return;
      let cancelled = false;
      // Load first, open only if this is still the latest `xml` (a slower, older
      // load must not replace a newer document).
      const source = xml ?? newDiagramXml();
      loadBpmnDocument(source, fileName).then(
        (document) => {
          if (cancelled) return;
          let result: ImportResult;
          try {
            result = { ...editor.open(document), document };
          } catch (error) {
            reportImportError(error);
            return;
          }
          callbacks.current.onImport?.(result);
        },
        (error: unknown) => {
          if (!cancelled) reportImportError(error);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [editor, xml, fileName]);

    return (
      <div
        ref={hostRef}
        className={className}
        style={{ position: 'relative', overflow: 'hidden', ...style }}
        data-bpmn-flow=""
      />
    );
  },
);

export interface BpmnFlowViewProps extends BpmnFlowViewerOptions {
  /** BPMN 2.0 XML to show, reflowed to fit. Re-imported whenever the string changes. */
  xml: string;
  fileName?: string;
  /** Called once with the viewer instance after it is created. */
  onReady?: (viewer: BpmnFlowViewer) => void;
  onImport?: (result: ViewerImportResult) => void;
  onImportError?: (error: unknown) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Read-only view that re-lays out the diagram to fit its box (top → bottom
 * when narrow) and reflows on resize; the XML is never changed.
 * `reflow`, `density` and `lineStyle` are read once, on mount.
 */
export const BpmnFlowView = forwardRef<BpmnFlowViewer | null, BpmnFlowViewProps>(
  function BpmnFlowView(props, ref) {
    const { xml, fileName, className, style } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const [viewer, setViewer] = useState<BpmnFlowViewer | null>(null);
    const callbacks = useRef(props);
    callbacks.current = props;

    useImperativeHandle(ref, () => viewer as BpmnFlowViewer, [viewer]);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const { reflow, density, lineStyle } = callbacks.current;
      const instance = new BpmnFlowViewer(host, {
        ...(reflow !== undefined ? { reflow } : {}),
        ...(density !== undefined ? { density } : {}),
        ...(lineStyle !== undefined ? { lineStyle } : {}),
      });
      setViewer(instance);
      callbacks.current.onReady?.(instance);
      return () => {
        instance.destroy();
        setViewer(null);
      };
    }, []);

    useEffect(() => {
      if (!viewer) return;
      let cancelled = false;
      viewer.importXml(xml, fileName).then(
        (result) => {
          if (!cancelled) callbacks.current.onImport?.(result);
        },
        (error: unknown) => {
          if (cancelled) return;
          if (callbacks.current.onImportError) callbacks.current.onImportError(error);
          else console.error(error);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [viewer, xml, fileName]);

    return (
      <div
        ref={hostRef}
        className={className}
        style={{ position: 'relative', overflow: 'hidden', ...style }}
        data-bpmn-flow=""
      />
    );
  },
);

export { BpmnFlowEditor, BpmnFlowViewer };
export type { BpmnFlowEditorOptions, ImportResult, KeyboardOptions } from './editor';
export type { BpmnFlowViewerOptions, ViewerImportResult } from './viewer';
export type { EditorSnapshot } from '@/editor/types';

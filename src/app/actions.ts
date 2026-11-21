/**
 * Application commands shared by the header, keyboard shortcuts and drag & drop.
 * They coordinate the pure BPMN layer, the editor controller and the stores.
 */
import { BpmnExportError, loadBpmnDocument } from '@/bpmn/document';
import { BpmnImportError } from '@/bpmn/import/parse';
import type { CompatibilityCode, CompatibilityReport } from '@/bpmn/validation/compatibility';
import { newChoreographyXml, newDiagramXml } from '@/bpmn/model/newDiagram';
import { downloadBlob, downloadBytes, downloadText } from '@/lib/download';
import { decodeXmlBytes } from '@/bpmn/import/encoding';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { useMetadataStore } from '@/stores/metadataStore';
import { persistence, type SavedSession } from '@/persistence/db';
import type { BpmnDocument } from '@/bpmn/document';
import { exportBpmnXml } from '@/bpmn/document';

/** Stable id used to key local data (metadata) for a document. */
/** Why a file opened read-only, from the most severe kind of issue. */
function readOnlyTitle(report: CompatibilityReport): string {
  const has = (code: CompatibilityCode) => report.issues.some((i) => i.code === code);
  if (!report.exportAllowed)
    return 'Opened read-only: some content of this file cannot be preserved, so re-export is disabled.';
  if (has('UNSUPPORTED_ELEMENT'))
    return 'Opened read-only: this file uses BPMN elements the editor does not support yet.';
  if (has('NO_DIAGRAM')) return 'Opened read-only: this file has no diagram layout.';
  if (has('MISSING_DI') || has('INVALID_DI'))
    return 'Opened read-only: the diagram layout of this file is incomplete or inconsistent.';
  return 'Opened read-only.';
}

export function documentIdOf(doc: BpmnDocument): string {
  return doc.definitions.id || doc.fileName;
}

function controller() {
  return useEditorStore.getState().controller;
}

/**
 * Imports XML. On any failure the currently open document stays untouched.
 * The autosave of the document being replaced is kept in the `previous` slot
 * (see `restorePreviousSession`) unless `keepPrevious` is false.
 */
export async function openXml(
  xml: string,
  fileName: string,
  options: {
    confirmDiscard?: boolean;
    keepPrevious?: boolean;
    /** The file as first opened, when `xml` is a later state of it (see loadBpmnDocument). */
    original?: { xml?: string; bytes?: Uint8Array };
  } = {},
): Promise<boolean> {
  const docs = useDocumentStore.getState();
  const ctrl = controller();
  if (!ctrl) return false;
  if (
    options.confirmDiscard !== false &&
    useEditorStore.getState().snapshot.dirty &&
    !window.confirm('Discard unsaved changes?')
  ) {
    return false;
  }

  docs.setLoading(true);
  try {
    // Persist the outgoing document's latest edits before it is replaced.
    await flushAutosave();
    const doc = await loadBpmnDocument(xml, fileName, options.original);
    const result = ctrl.open(doc);
    docs.setDocument(doc);
    void useMetadataStore.getState().load(documentIdOf(doc));
    if (options.keepPrevious !== false) {
      const incoming = { documentId: documentIdOf(doc), fileName: doc.fileName };
      void enqueueSave(() => persistence.backupSession(incoming));
    }
    void saveSession();

    const { report } = doc;
    if (report.mode === 'readonly') {
      docs.notify({
        kind: 'warning',
        title: readOnlyTitle(report),
        details: ['See Analysis → Compatibility for details.'],
      });
      useUiStore.getState().toggleAnalysis(true);
      useUiStore.getState().setAnalysisTab('compatibility');
    }
    if (result.warnings.length) {
      docs.notify({
        kind: 'warning',
        title: 'Some diagram elements could not be displayed.',
        details: result.warnings,
      });
    }
    return true;
  } catch (err) {
    const title = err instanceof Error ? err.message : 'Could not open the file.';
    const details = err instanceof BpmnImportError && err.details ? [err.details] : undefined;
    docs.notify({ kind: 'error', title: `Could not open “${fileName}”: ${title}`, details });
    return false;
  } finally {
    docs.setLoading(false);
  }
}

export async function openFile(file: File): Promise<boolean> {
  let bytes: Uint8Array;
  let text: string;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    useDocumentStore.getState().notify({ kind: 'error', title: `Could not read “${file.name}”.` });
    return false;
  }
  try {
    text = decodeXmlBytes(bytes);
  } catch (err) {
    const title = err instanceof Error ? err.message : 'Could not decode the file.';
    const details = err instanceof BpmnImportError && err.details ? [err.details] : undefined;
    useDocumentStore
      .getState()
      .notify({ kind: 'error', title: `Could not open “${file.name}”: ${title}`, details });
    return false;
  }
  return openXml(text, file.name, { original: { bytes } });
}

export function pickFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bpmn,.xml,application/xml,text/xml';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void openFile(file);
  };
  input.click();
}

export function newChoreographyDocument(): Promise<boolean> {
  return openXml(newChoreographyXml(), 'untitled-choreography.bpmn');
}

export function newDocument(): Promise<boolean> {
  return openXml(newDiagramXml(), 'untitled.bpmn');
}

function exportName(fileName: string): string {
  return /\.(bpmn|xml)$/i.test(fileName) ? fileName : `${fileName}.bpmn`;
}

export async function exportXml(): Promise<void> {
  const ctrl = controller();
  const doc = useDocumentStore.getState().doc;
  if (!ctrl || !doc) return;
  try {
    const xml = await ctrl.exportXml();
    downloadText(xml, exportName(doc.fileName));
    useDocumentStore
      .getState()
      .notify({ kind: 'success', title: 'Exported BPMN 2.0 XML (verified by re-import).' });
  } catch (err) {
    const details = err instanceof BpmnExportError ? err.details : undefined;
    useDocumentStore.getState().notify({
      kind: 'error',
      title: err instanceof Error ? err.message : 'Export failed.',
      details,
    });
  }
}

/** PNG pixel ratio, reduced for very large diagrams to stay within canvas limits. */
const PNG_SCALE = 2;
const PNG_MAX_PIXELS = 40_000_000;
const PNG_MAX_SIDE = 16_000;

/** Downloads the visible diagram as an SVG or PNG image (light theme). */
export async function exportImage(format: 'svg' | 'png'): Promise<void> {
  const ctrl = controller();
  const doc = useDocumentStore.getState().doc;
  const notify = useDocumentStore.getState().notify;
  const image = ctrl?.toSvg();
  if (!doc || !image) {
    notify({ kind: 'info', title: 'Nothing to export: the diagram is empty.' });
    return;
  }
  const name = `${doc.fileName.replace(/\.(bpmn|xml)$/i, '')}.${format}`;
  if (format === 'svg') {
    downloadText(image.svg, name, 'image/svg+xml');
    return;
  }
  try {
    const scale = Math.min(
      PNG_SCALE,
      Math.sqrt(PNG_MAX_PIXELS / (image.width * image.height)),
      PNG_MAX_SIDE / Math.max(image.width, image.height),
    );
    const url = URL.createObjectURL(new Blob([image.svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The image is too large.');
    downloadBlob(blob, name);
  } catch (err) {
    notify({
      kind: 'error',
      title: `PNG export failed${err instanceof Error ? `: ${err.message}` : '.'}`,
    });
  }
}

export function downloadOriginal(): void {
  const doc = useDocumentStore.getState().doc;
  if (!doc) return;
  if (doc.originalBytes) downloadBytes(doc.originalBytes, exportName(doc.fileName));
  else downloadText(doc.originalXml, exportName(doc.fileName));
}

export async function runAutoLayout(): Promise<void> {
  const ctrl = controller();
  if (!ctrl) return;
  try {
    const { layoutDirection: direction, layoutDensity: density } = useUiStore.getState();
    const applied = await ctrl.autoLayout({ direction, density });
    if (!applied)
      useDocumentStore.getState().notify({ kind: 'info', title: 'Nothing to lay out.' });
  } catch (err) {
    useDocumentStore.getState().notify({
      kind: 'error',
      title: 'Auto layout failed.',
      details: [err instanceof Error ? err.message : String(err)],
    });
  }
}

// Saves run one at a time, in order, so a slow export can never overwrite a
// newer one. Each job reads the document when it runs, not when it was queued.
let saveQueue: Promise<unknown> = Promise.resolve();
let queuedSaves = 0;

function enqueueSave<T>(job: () => Promise<T>): Promise<T> {
  queuedSaves++;
  const run = saveQueue.then(job).finally(() => queuedSaves--);
  saveQueue = run.catch(() => undefined);
  return run;
}

/** Writes the current document to IndexedDB (verified export, or the original for lossy files). */
export function saveSession(): Promise<boolean> {
  return enqueueSave(async () => {
    const doc = useDocumentStore.getState().doc;
    if (!doc) return false;
    let xml = doc.originalXml;
    if (doc.report.exportAllowed) {
      try {
        xml = await exportBpmnXml(doc);
      } catch {
        return false; // keep the previous autosave rather than storing something unverified
      }
    }
    const saved = await persistence.saveSession({
      xml,
      fileName: doc.fileName,
      documentId: documentIdOf(doc),
      savedAt: Date.now(),
      originalXml: doc.originalXml,
      ...(doc.originalBytes ? { originalBytes: doc.originalBytes } : {}),
    });
    reportAutosave(saved);
    return saved;
  });
}

let autosaveFailing = false;

/** Tells the user once when local saving stops working, and when it works again. */
function reportAutosave(ok: boolean): void {
  if (ok === !autosaveFailing) return;
  autosaveFailing = !ok;
  useDocumentStore.getState().notify(
    ok
      ? { kind: 'success', title: 'Autosave works again.' }
      : {
          kind: 'warning',
          title: 'Autosave is not working: changes are not stored in this browser.',
          details: ['Export the diagram to keep your work (storage may be full or disabled).'],
        },
  );
}

const AUTOSAVE_DELAY_MS = 1000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Saves the session shortly after the latest change (debounced). */
export function scheduleAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void saveSession();
  }, AUTOSAVE_DELAY_MS);
}

/** Runs a scheduled autosave now and resolves once every queued save finished. */
export async function flushAutosave(): Promise<void> {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    void saveSession();
  }
  await saveQueue;
}

/** True while a change has not reached IndexedDB yet. */
export function hasUnsavedSession(): boolean {
  return autosaveTimer !== null || queuedSaves > 0;
}

function originalOf(session: SavedSession): { xml?: string; bytes?: Uint8Array } {
  return { xml: session.originalXml, bytes: session.originalBytes };
}

/**
 * Re-opens the autosaved document from a previous visit, if any. 'failed'
 * means a session exists but could not be opened; it is left in place.
 */
export async function restoreSession(): Promise<'restored' | 'none' | 'failed'> {
  const session = await persistence.loadSession();
  if (!session) return 'none';
  const ok = await openXml(session.xml, session.fileName, {
    confirmDiscard: false,
    keepPrevious: false,
    original: originalOf(session),
  });
  if (!ok) return 'failed';
  useDocumentStore.getState().notify({
    kind: 'info',
    title: `Restored “${session.fileName}” from your last session (saved ${new Date(session.savedAt).toLocaleString()}).`,
  });
  return 'restored';
}

/** Re-opens the autosave that the current document replaced (the two swap places). */
export async function restorePreviousSession(): Promise<boolean> {
  const previous = await persistence.loadPreviousSession();
  if (!previous) {
    useDocumentStore.getState().notify({ kind: 'info', title: 'There is no previous autosave.' });
    return false;
  }
  const ok = await openXml(previous.xml, previous.fileName, { original: originalOf(previous) });
  if (ok) {
    useDocumentStore.getState().notify({
      kind: 'info',
      title: `Restored “${previous.fileName}” (autosaved ${new Date(previous.savedAt).toLocaleString()}).`,
    });
  }
  return ok;
}

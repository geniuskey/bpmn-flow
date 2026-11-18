/**
 * Application commands shared by the header, keyboard shortcuts and drag & drop.
 * They coordinate the pure BPMN layer, the editor controller and the stores.
 */
import { BpmnExportError, loadBpmnDocument } from '@/bpmn/document';
import { BpmnImportError } from '@/bpmn/import/parse';
import { newDiagramXml } from '@/bpmn/model/newDiagram';
import { downloadText } from '@/lib/download';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { useMetadataStore } from '@/stores/metadataStore';
import { persistence } from '@/persistence/db';
import type { BpmnDocument } from '@/bpmn/document';
import { exportBpmnXml } from '@/bpmn/document';

/** Stable id used to key local data (metadata) for a document. */
export function documentIdOf(doc: BpmnDocument): string {
  return doc.definitions.id || doc.fileName;
}

function controller() {
  return useEditorStore.getState().controller;
}

/** Imports XML. On any failure the currently open document stays untouched. */
export async function openXml(
  xml: string,
  fileName: string,
  options: { confirmDiscard?: boolean } = {},
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
    const doc = await loadBpmnDocument(xml, fileName);
    const result = ctrl.open(doc);
    docs.setDocument(doc);
    void useMetadataStore.getState().load(documentIdOf(doc));
    void saveSession();

    const { report } = doc;
    if (report.mode === 'readonly') {
      docs.notify({
        kind: 'warning',
        title: report.exportAllowed
          ? 'Opened read-only: this file uses BPMN elements the editor does not support yet.'
          : 'Opened read-only: some content of this file cannot be preserved, so re-export is disabled.',
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
  let text: string;
  try {
    text = await file.text();
  } catch {
    useDocumentStore.getState().notify({ kind: 'error', title: `Could not read “${file.name}”.` });
    return false;
  }
  return openXml(text, file.name);
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

export function downloadOriginal(): void {
  const doc = useDocumentStore.getState().doc;
  if (doc) downloadText(doc.originalXml, exportName(doc.fileName));
}

export async function runAutoLayout(): Promise<void> {
  const ctrl = controller();
  if (!ctrl) return;
  try {
    const applied = await ctrl.autoLayout();
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

/** Writes the current document to IndexedDB (verified export, or the original for lossy files). */
export async function saveSession(): Promise<boolean> {
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
  return persistence.saveSession({
    xml,
    fileName: doc.fileName,
    documentId: documentIdOf(doc),
    savedAt: Date.now(),
  });
}

/** Re-opens the autosaved document from a previous visit, if any. */
export async function restoreSession(): Promise<boolean> {
  const session = await persistence.loadSession();
  if (!session) return false;
  const ok = await openXml(session.xml, session.fileName, { confirmDiscard: false });
  if (ok) {
    useDocumentStore.getState().notify({
      kind: 'info',
      title: `Restored “${session.fileName}” from your last session (saved ${new Date(session.savedAt).toLocaleString()}).`,
    });
  }
  return ok;
}

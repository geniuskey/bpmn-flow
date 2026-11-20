import { useCallback, useRef } from 'react';
import { AnalysisPanel } from '@/components/AnalysisPanel';
import { CanvasView } from '@/components/CanvasView';
import { Header } from '@/components/Header';
import { Inspector } from '@/components/Inspector';
import { Notices } from '@/components/Notices';
import { CommandPalette } from '@/components/CommandPalette';
import { Palette } from '@/components/Palette';
import { ResizeHandle } from '@/components/ResizeHandle';
import { DEFAULT_ANALYSIS_HEIGHT, DEFAULT_INSPECTOR_WIDTH, useUiStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { persistence } from '@/persistence/db';
import { newDocument, openXml, restoreSession } from './actions';
import { useAutosave } from './useAutosave';
import { useKeyboardShortcuts } from './shortcuts';
import { useTheme } from './useTheme';
import { useCompactLayout } from './useCompactLayout';

const KEPT_HINT =
  'Run “Restore previous autosave” from the command palette (Ctrl/⌘+K) to go back to it.';

async function openInitialDocument(): Promise<void> {
  // `?sample=<name>` opens a bundled example (used by docs and E2E tests).
  // Opening it keeps the stored session in the `previous` slot.
  const sample = new URLSearchParams(window.location.search).get('sample');
  if (sample && /^[a-z0-9-]+$/.test(sample)) {
    const fileName = `${sample}.bpmn`;
    const stored = await persistence.loadSession();
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${fileName}`).catch(() => null);
    if (res?.ok && (await openXml(await res.text(), fileName, { confirmDiscard: false }))) {
      if (stored && stored.fileName !== fileName) {
        useDocumentStore.getState().notify({
          kind: 'info',
          title: `Opened the “${sample}” sample. Your autosaved “${stored.fileName}” was kept.`,
          details: [KEPT_HINT],
        });
      }
      return;
    }
  }
  const restored = await restoreSession();
  if (restored === 'restored') return;
  // A session that cannot be opened (for example after an app update) is kept, not overwritten.
  if ((await newDocument()) && restored === 'failed') {
    useDocumentStore.getState().notify({
      kind: 'warning',
      title:
        'Your last session could not be restored, so a new diagram was opened. The session was kept.',
      details: [KEPT_HINT],
    });
  }
}

export function App() {
  useTheme();
  useKeyboardShortcuts();
  useAutosave();
  const {
    inspectorOpen,
    analysisOpen,
    inspectorWidth,
    analysisHeight,
    setInspectorWidth,
    setAnalysisHeight,
  } = useUiStore();
  const startSize = useRef(0);
  useCompactLayout();
  const opened = useRef(false);
  const onReady = useCallback(() => {
    // StrictMode mounts the canvas twice in development; open the first document only once.
    if (opened.current) return;
    opened.current = true;
    void openInitialDocument();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="flex min-w-0 flex-1 flex-col">
          <CanvasView onReady={onReady} />
          {analysisOpen && (
            <>
              <ResizeHandle
                direction="vertical"
                label="Resize analysis panel"
                onReset={() => setAnalysisHeight(DEFAULT_ANALYSIS_HEIGHT)}
                onResize={(delta, start) => {
                  if (start) startSize.current = analysisHeight;
                  else setAnalysisHeight(startSize.current - delta);
                }}
              />
              <div style={{ height: analysisHeight }} className="max-h-[55%] shrink-0 border-t">
                <AnalysisPanel />
              </div>
            </>
          )}
        </main>
        {inspectorOpen && (
          <>
            <ResizeHandle
              direction="horizontal"
              label="Resize properties panel"
              onReset={() => setInspectorWidth(DEFAULT_INSPECTOR_WIDTH)}
              onResize={(delta, start) => {
                if (start) startSize.current = inspectorWidth;
                else setInspectorWidth(startSize.current - delta);
              }}
            />
            <div style={{ width: inspectorWidth }} className="max-w-[45vw] shrink-0 border-l">
              <Inspector />
            </div>
          </>
        )}
      </div>
      <Notices />
      <CommandPalette />
    </div>
  );
}

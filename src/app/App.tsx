import { useCallback, useRef } from 'react';
import { AnalysisPanel } from '@/components/AnalysisPanel';
import { CanvasView } from '@/components/CanvasView';
import { Header } from '@/components/Header';
import { Inspector } from '@/components/Inspector';
import { Notices } from '@/components/Notices';
import { CommandPalette } from '@/components/CommandPalette';
import { Palette } from '@/components/Palette';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useUiStore } from '@/stores/uiStore';
import { newDocument, openXml, restoreSession } from './actions';
import { useAutosave } from './useAutosave';
import { useKeyboardShortcuts } from './shortcuts';
import { useTheme } from './useTheme';
import { useCompactLayout } from './useCompactLayout';

async function openInitialDocument(): Promise<void> {
  // `?sample=<name>` opens a bundled example (used by docs and E2E tests).
  const sample = new URLSearchParams(window.location.search).get('sample');
  if (sample && /^[a-z0-9-]+$/.test(sample)) {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${sample}.bpmn`).catch(() => null);
    if (res?.ok && (await openXml(await res.text(), `${sample}.bpmn`, { confirmDiscard: false })))
      return;
  }
  if (await restoreSession()) return;
  await newDocument();
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
                onResize={(delta, start) => {
                  if (start) startSize.current = analysisHeight;
                  else setAnalysisHeight(startSize.current - delta);
                }}
              />
              <div style={{ height: analysisHeight }} className="shrink-0 border-t">
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
              onResize={(delta, start) => {
                if (start) startSize.current = inspectorWidth;
                else setInspectorWidth(startSize.current - delta);
              }}
            />
            <div style={{ width: inspectorWidth }} className="shrink-0 border-l">
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

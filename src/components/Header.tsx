import {
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  Lock,
  Maximize,
  Monitor,
  Moon,
  PanelBottom,
  PanelRight,
  Redo2,
  Sun,
  Undo2,
  Workflow,
  LayoutDashboard,
  Command,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState } from 'react';
import { downloadOriginal, exportXml, newDocument, pickFile, runAutoLayout } from '@/app/actions';
import { formatKeys, SHORTCUTS } from '@/app/shortcuts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore, type ThemePreference } from '@/stores/uiStore';

function tip(label: string, shortcut?: keyof typeof SHORTCUTS): string {
  return shortcut ? `${label} (${formatKeys(SHORTCUTS[shortcut]!.keys)})` : label;
}

const THEME_NEXT: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

export function Header() {
  const doc = useDocumentStore((s) => s.doc);
  const loading = useDocumentStore((s) => s.loading);
  const controller = useEditorStore((s) => s.controller);
  const { canUndo, canRedo, dirty, zoom, readOnly } = useEditorStore((s) => s.snapshot);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { inspectorOpen, analysisOpen, toggleInspector, toggleAnalysis } = useUiStore();

  const setPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const exportAllowed = !!doc?.report.exportAllowed;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b bg-card px-2 [&>*]:shrink-0">
      <div className="flex items-center gap-2 pr-2 pl-1">
        <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Workflow className="size-4" />
        </div>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">BPMN Flow</span>
      </div>
      <Separator vertical />
      <div
        className="flex max-w-[30vw] min-w-0 items-center gap-2 px-2"
        data-testid="document-title"
      >
        <span className="truncate font-medium" title={doc?.fileName}>
          {doc?.fileName ?? (loading ? 'Loading…' : 'No document')}
        </span>
        {dirty && (
          <span
            className="size-1.5 rounded-full bg-primary"
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
        <DiagramSelector />
        {doc && readOnly && (
          <Badge variant="warning" title="Editing is disabled to protect data in this file">
            <Lock className="size-3" /> Read-only
          </Badge>
        )}
      </div>

      <div className="ml-2 flex items-center gap-0.5">
        <Button
          size="icon"
          title={tip('New diagram', 'newDoc')}
          aria-label="New diagram"
          onClick={() => void newDocument()}
        >
          <FilePlus2 />
        </Button>
        <Button
          size="icon"
          title={tip('Open BPMN file', 'open')}
          aria-label="Open"
          onClick={pickFile}
        >
          <FolderOpen />
        </Button>
        <Separator vertical />
        <Button
          size="icon"
          title={tip('Undo', 'undo')}
          aria-label="Undo"
          disabled={!canUndo}
          onClick={() => controller?.undo()}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon"
          title={tip('Redo', 'redo')}
          aria-label="Redo"
          disabled={!canRedo}
          onClick={() => controller?.redo()}
        >
          <Redo2 />
        </Button>
        <Separator vertical />
        <Button
          size="icon"
          title={tip('Auto layout', 'layout')}
          aria-label="Auto layout"
          disabled={readOnly || !doc}
          onClick={() => void runAutoLayout()}
        >
          <LayoutDashboard />
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          size="icon"
          title={tip('Zoom out', 'zoomOut')}
          aria-label="Zoom out"
          onClick={() => controller?.zoomBy(1 / 1.2)}
        >
          <ZoomOut />
        </Button>
        <button
          className="h-7 w-12 rounded-md text-center text-xs tabular-nums text-muted-foreground hover:bg-accent"
          title={tip('Reset zoom', 'zoomReset')}
          onClick={() => controller?.resetZoom()}
          data-testid="zoom-level"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          size="icon"
          title={tip('Zoom in', 'zoomIn')}
          aria-label="Zoom in"
          onClick={() => controller?.zoomBy(1.2)}
        >
          <ZoomIn />
        </Button>
        <Button
          size="icon"
          title={tip('Fit to view', 'fit')}
          aria-label="Fit to view"
          onClick={() => controller?.fit()}
        >
          <Maximize />
        </Button>
        <Separator vertical />
        <Button
          size="icon"
          variant={inspectorOpen ? 'active' : 'ghost'}
          title="Toggle properties panel"
          aria-label="Toggle properties panel"
          onClick={toggleInspector}
        >
          <PanelRight />
        </Button>
        <Button
          size="icon"
          variant={analysisOpen ? 'active' : 'ghost'}
          title="Toggle analysis panel"
          aria-label="Toggle analysis panel"
          onClick={() => toggleAnalysis()}
        >
          <PanelBottom />
        </Button>
        <Button
          size="icon"
          title={tip('Command palette', 'palette')}
          aria-label="Command palette"
          onClick={() => setPaletteOpen(true)}
        >
          <Command />
        </Button>
        <SettingsMenu />
        <Button
          size="icon"
          title={`Theme: ${theme} (click to switch)`}
          aria-label="Switch theme"
          onClick={() => setTheme(THEME_NEXT[theme])}
        >
          <ThemeIcon />
        </Button>
        <Separator vertical />
        {doc && !exportAllowed ? (
          <Button
            variant="outline"
            title="Download the unmodified original file"
            onClick={downloadOriginal}
          >
            <FileDown /> Original
          </Button>
        ) : (
          <Button
            variant="default"
            disabled={!doc}
            title={tip('Export BPMN 2.0 XML', 'export')}
            onClick={() => void exportXml()}
            data-testid="export-button"
          >
            <Download /> Export
          </Button>
        )}
      </div>
    </header>
  );
}

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const setSnapToGrid = useUiStore((s) => s.setSnapToGrid);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <div className="relative">
      <Button
        size="icon"
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        variant={open ? 'active' : 'ghost'}
        onClick={() => setOpen((o) => !o)}
      >
        <Settings />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Settings"
            className="absolute right-0 z-50 mt-1 w-60 space-y-3 rounded-lg border bg-card p-3 shadow-xl"
          >
            <label className="flex items-center justify-between gap-2">
              <span>Snap to grid</span>
              <input
                type="checkbox"
                aria-label="Snap to grid"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>Theme</span>
              <select
                aria-label="Theme"
                className="h-7 rounded-md border bg-background px-1.5"
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemePreference)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <div className="border-t pt-2 text-[11px] text-muted-foreground">
              <a
                className="text-primary hover:underline"
                href={`${import.meta.env.BASE_URL}third-party-notices.txt`}
                target="_blank"
                rel="noreferrer"
              >
                Open-source licenses
              </a>
              <span> · BPMN Flow {__APP_VERSION__}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Switches between the BPMN diagrams of a document (e.g. collapsed sub-process content). */
function DiagramSelector() {
  const controller = useEditorStore((s) => s.controller);
  // Re-read on model changes and diagram switches.
  useEditorStore((s) => s.snapshot.revision);
  const active = useEditorStore((s) => s.snapshot.activeDiagram);
  const diagrams = controller?.getDiagrams() ?? [];
  if (diagrams.length < 2) return null;
  return (
    <select
      aria-label="Diagram"
      title="Diagram"
      className="h-7 max-w-48 rounded-md border bg-background px-1.5 text-xs"
      value={active}
      onChange={(e) => controller?.showDiagram(e.target.value)}
    >
      {diagrams.map((d) => (
        <option key={d.rootId} value={d.rootId}>
          {d.rootId === '__root' ? d.name : `↳ ${d.name}`}
        </option>
      ))}
    </select>
  );
}

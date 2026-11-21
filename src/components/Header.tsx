import {
  AlignStartVertical,
  BetweenHorizontalEnd,
  ClipboardPaste,
  Command,
  Copy,
  CopyPlus,
  Crosshair,
  MonitorSmartphone,
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  Grid3x3,
  Image,
  LayoutDashboard,
  Lock,
  Maximize,
  MoreHorizontal,
  Scan,
  PanelBottom,
  PanelRight,
  Redo2,
  Scissors,
  Settings,
  Trash,
  Undo2,
  Workflow,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { COMMANDS, isEnabled, runCommand } from '@/app/commands';
import {
  downloadOriginal,
  exportXml,
  newChoreographyDocument,
  newDocument,
  pickFile,
} from '@/app/actions';
import { formatKeys, SHORTCUTS } from '@/app/shortcuts';
import { ARRANGE_ITEMS } from './arrangeItems';
import { ToolbarMenu, type ToolbarMenuItem } from '@/components/ToolbarMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore, type ThemePreference } from '@/stores/uiStore';

function tip(label: string, shortcut?: keyof typeof SHORTCUTS): string {
  return shortcut ? `${label} (${formatKeys(SHORTCUTS[shortcut]!.keys)})` : label;
}

function commandTip(id: string): string {
  const cmd = COMMANDS.find((c) => c.id === id)!;
  return cmd.keys ? `${cmd.label} (${formatKeys(cmd.keys)})` : cmd.label;
}

/** An icon button for a registry command; disabled when the command is. */
function CommandButton({ id, icon: Icon }: { id: string; icon: LucideIcon }) {
  const cmd = COMMANDS.find((c) => c.id === id)!;
  return (
    <Button
      size="icon"
      title={commandTip(id)}
      aria-label={cmd.label}
      disabled={!isEnabled(cmd)}
      onClick={() => runCommand(id)}
    >
      <Icon />
    </Button>
  );
}

function commandItem(id: string, icon?: LucideIcon, separated?: boolean): ToolbarMenuItem {
  const cmd = COMMANDS.find((c) => c.id === id)!;
  return {
    label: cmd.label,
    icon,
    keys: cmd.keys,
    separated,
    disabled: !isEnabled(cmd),
    onSelect: () => runCommand(id),
  };
}

/** Tailwind `lg` and `xl`: below them, toolbar groups move into the overflow menu. */
const LG = '(min-width: 1024px)';
const XL = '(min-width: 1280px)';

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

const EDIT_ITEMS: [string, LucideIcon][] = [
  ['edit.cut', Scissors],
  ['edit.copy', Copy],
  ['edit.paste', ClipboardPaste],
  ['edit.duplicate', CopyPlus],
  ['edit.delete', Trash],
];

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2];

export function Header() {
  const doc = useDocumentStore((s) => s.doc);
  const loading = useDocumentStore((s) => s.loading);
  const controller = useEditorStore((s) => s.controller);
  const { canUndo, canRedo, dirty, zoom, readOnly } = useEditorStore((s) => s.snapshot);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const setSnapToGrid = useUiStore((s) => s.setSnapToGrid);
  const { inspectorOpen, analysisOpen, toggleInspector, toggleAnalysis } = useUiStore();

  const setPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const { reflowView, setReflowView, focusMode, setFocusMode } = useUiStore();
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const layoutDensity = useUiStore((s) => s.layoutDensity);
  const setLayoutOptions = useUiStore((s) => s.setLayoutOptions);
  const directionLocked = !!controller?.layoutDirectionLocked();
  const layoutAllowed = isEnabled(COMMANDS.find((c) => c.id === 'arrange.layout')!);
  // Picking an option applies it right away.
  const layoutWith = (options: Parameters<typeof setLayoutOptions>[0]) => {
    setLayoutOptions(options);
    runCommand('arrange.layout');
  };
  const layoutItems: ToolbarMenuItem[] = [
    {
      label: 'Left to right',
      checked: directionLocked ? undefined : layoutDirection === 'LR',
      disabled: directionLocked,
      onSelect: () => layoutWith({ direction: 'LR' }),
    },
    {
      label: directionLocked ? 'Top to bottom (pools keep their direction)' : 'Top to bottom',
      checked: directionLocked ? undefined : layoutDirection === 'TB',
      disabled: directionLocked,
      onSelect: () => layoutWith({ direction: 'TB' }),
    },
    ...(['compact', 'normal', 'spacious'] as const).map((density, i): ToolbarMenuItem => ({
      label: `${density[0]!.toUpperCase()}${density.slice(1)} spacing`,
      checked: layoutDensity === density,
      separated: i === 0,
      onSelect: () => layoutWith({ density }),
    })),
  ];
  const exportAllowed = !!doc?.report.exportAllowed;
  // Re-evaluated on every snapshot change (selection, read-only, ...).
  const arrangeItems = ARRANGE_ITEMS.map(({ id, icon, separated }) =>
    commandItem(id, icon, separated),
  );
  const canArrange = arrangeItems.some((i) => !i.disabled);
  const wide = useMedia(XL);
  const medium = useMedia(LG);
  // Groups that do not fit move into the "More" menu (edit below xl, arrange below lg).
  const overflowItems: ToolbarMenuItem[] = [
    ...(wide ? [] : EDIT_ITEMS.map(([id, icon]) => commandItem(id, icon))),
    ...(medium
      ? []
      : [
          ...arrangeItems.map((item, i) => (i === 0 ? { ...item, separated: !wide } : item)),
          commandItem('arrange.addLane', BetweenHorizontalEnd, true),
          commandItem('arrange.layout', LayoutDashboard),
          {
            label: `Snap to grid: ${snapToGrid ? 'on' : 'off'}`,
            icon: Grid3x3,
            onSelect: () => setSnapToGrid(!snapToGrid),
          },
        ]),
  ];
  const zoomItems: ToolbarMenuItem[] = [
    ...ZOOM_PRESETS.map((z) => ({
      label: `${z * 100}%`,
      keys: z === 1 ? SHORTCUTS.zoomReset!.keys : undefined,
      onSelect: () => controller?.setZoom(z),
    })),
    { ...commandItem('view.fit', Maximize), separated: true },
    commandItem('view.zoomSelection', Scan),
  ];
  const imageItems: ToolbarMenuItem[] = [
    commandItem('file.exportSvg', Image),
    commandItem('file.exportPng', Image),
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b bg-card px-2 [&>*]:shrink-0">
      <div className="flex items-center gap-2 pr-2 pl-1">
        <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Workflow className="size-4" />
        </div>
        <span className="hidden text-sm font-semibold tracking-tight xl:inline">BPMN Flow</span>
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
        <ToolbarMenu
          label="More ways to start a diagram"
          className="-ml-1 w-4 px-0"
          trigger={null}
          items={[
            {
              label: 'New diagram',
              icon: FilePlus2,
              keys: SHORTCUTS.newDoc!.keys,
              onSelect: () => void newDocument(),
            },
            {
              label: 'New choreography diagram',
              icon: FilePlus2,
              onSelect: () => void newChoreographyDocument(),
            },
          ]}
        />
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
        {wide && (
          <div className="flex items-center gap-0.5" role="group" aria-label="Edit">
            {EDIT_ITEMS.map(([id, icon]) => (
              <CommandButton key={id} id={id} icon={icon} />
            ))}
            <Separator vertical />
          </div>
        )}
        {medium && (
          <div className="flex items-center gap-0.5" role="group" aria-label="Arrange">
            <ToolbarMenu
              label="Align and distribute"
              title={
                canArrange
                  ? 'Align and distribute'
                  : 'Align and distribute — select two or more shapes'
              }
              disabled={readOnly || !doc || !canArrange}
              trigger={<AlignStartVertical />}
              items={arrangeItems}
            />
            <CommandButton id="arrange.addLane" icon={BetweenHorizontalEnd} />
            <div className="flex items-center">
              <CommandButton id="arrange.layout" icon={LayoutDashboard} />
              <ToolbarMenu
                label="Layout options"
                title="Auto layout direction and spacing"
                className="w-4 px-0"
                disabled={!layoutAllowed}
                trigger={null}
                items={layoutItems}
                testId="layout-options"
              />
            </div>
            <Button
              size="icon"
              variant={snapToGrid ? 'active' : 'ghost'}
              title={`Snap to grid: ${snapToGrid ? 'on' : 'off'}`}
              aria-label="Snap to grid"
              aria-pressed={snapToGrid}
              onClick={() => setSnapToGrid(!snapToGrid)}
            >
              <Grid3x3 />
            </Button>
          </div>
        )}
        {overflowItems.length > 0 && (
          <ToolbarMenu
            label="More actions"
            chevron={false}
            className="w-8 px-0"
            trigger={<MoreHorizontal />}
            items={overflowItems}
          />
        )}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          size="icon"
          variant={focusMode ? 'active' : 'ghost'}
          title={`Focus: ${focusMode ? 'on' : 'off'} — selecting a shape dims everything outside the paths through it`}
          aria-label="Focus mode"
          aria-pressed={focusMode}
          disabled={!doc}
          onClick={() => setFocusMode(!focusMode)}
        >
          <Crosshair />
        </Button>
        <Button
          size="icon"
          variant={reflowView ? 'active' : 'ghost'}
          title="Reflow view: re-lay out the diagram to fit this window, read-only (the file keeps its layout)"
          aria-label="Reflow view"
          aria-pressed={reflowView}
          disabled={!doc}
          onClick={() => setReflowView(!reflowView)}
          data-testid="reflow-toggle"
        >
          <MonitorSmartphone />
        </Button>
        <Separator vertical />
        {medium && (
          <Button
            size="icon"
            title={tip('Zoom out', 'zoomOut')}
            aria-label="Zoom out"
            onClick={() => controller?.zoomBy(1 / 1.2)}
          >
            <ZoomOut />
          </Button>
        )}
        <ToolbarMenu
          label="Zoom level"
          title="Zoom level and presets"
          testId="zoom-level"
          className="h-7 w-16 text-xs tabular-nums text-muted-foreground"
          trigger={`${Math.round(zoom * 100)}%`}
          items={zoomItems}
        />
        {medium && (
          <>
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
          </>
        )}
        <Separator vertical />
        <Button
          size="icon"
          variant={inspectorOpen ? 'active' : 'ghost'}
          title={tip('Toggle properties panel', 'inspector')}
          aria-label="Toggle properties panel"
          aria-pressed={inspectorOpen}
          onClick={() => toggleInspector()}
        >
          <PanelRight />
        </Button>
        <Button
          size="icon"
          variant={analysisOpen ? 'active' : 'ghost'}
          title="Toggle analysis panel"
          aria-label="Toggle analysis panel"
          aria-pressed={analysisOpen}
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
        <Separator vertical />
        <div className="flex items-center">
          {doc && !exportAllowed ? (
            <Button
              variant="outline"
              className="rounded-r-none border-r-0"
              title="Download the unmodified original file"
              onClick={downloadOriginal}
            >
              <FileDown /> Original
            </Button>
          ) : (
            <Button
              variant="default"
              className="rounded-r-none"
              disabled={!doc}
              title={tip('Export BPMN 2.0 XML', 'export')}
              onClick={() => void exportXml()}
              data-testid="export-button"
            >
              <Download /> Export
            </Button>
          )}
          <ToolbarMenu
            label="Export as image"
            title="Export as SVG or PNG image"
            variant={doc && !exportAllowed ? 'outline' : 'default'}
            className={
              doc && !exportAllowed
                ? 'w-6 rounded-l-none px-0'
                : 'w-6 rounded-l-none border-l border-l-primary-foreground/25 px-0'
            }
            disabled={!doc}
            trigger={null}
            items={imageItems}
          />
        </div>
      </div>
    </header>
  );
}

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  // The header scrolls horizontally (overflow clips), so the popover is portaled to
  // <body> and anchored to the button with fixed coordinates.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <>
      <Button
        ref={buttonRef}
        size="icon"
        title="Settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        variant={open ? 'active' : 'ghost'}
        onClick={() => setOpen((o) => !o)}
      >
        <Settings />
      </Button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
            <div
              role="dialog"
              aria-label="Settings"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-50 max-h-[calc(100vh-4rem)] w-60 max-w-[calc(100vw-1rem)] space-y-3 overflow-y-auto rounded-lg border bg-card p-3 shadow-xl"
            >
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
          </>,
          document.body,
        )}
    </>
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

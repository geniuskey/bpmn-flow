import { ChevronRight, Hand, Lasso, MousePointer2, Search, Shapes, Spline, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { formatKeys, SHORTCUTS } from '@/app/shortcuts';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { EditorTool } from '@/editor/EditorController';
import { COMMON_GROUP, searchLibrary, type LibraryEntry } from '@/editor/library';
import { renderPreview } from '@/editor/renderer/preview';
import { cn } from '@/lib/utils';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { DEFAULT_LIBRARY_WIDTH, useUiStore } from '@/stores/uiStore';
import { ResizeHandle } from './ResizeHandle';

const TOOLS: {
  id: EditorTool;
  label: string;
  icon: ComponentType;
  shortcut: keyof typeof SHORTCUTS;
}[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, shortcut: 'select' },
  { id: 'pan', label: 'Pan', icon: Hand, shortcut: 'pan' },
  { id: 'lasso', label: 'Lasso select', icon: Lasso, shortcut: 'lasso' },
  { id: 'connect', label: 'Connect (sequence flow)', icon: Spline, shortcut: 'connect' },
];

const DRAG_THRESHOLD = 4;
/** Hover delay before the preview card opens (focus shows it at once). */
const PREVIEW_DELAY = 350;

/** The entry the preview card describes, and the button it sits next to. */
interface PreviewTarget {
  entry: LibraryEntry;
  anchor: HTMLElement;
}

/**
 * One library entry: click then click on the canvas, or drag onto the canvas.
 * From the keyboard (Enter / Space) the element is placed in the middle of the
 * visible area (boundary events on the selected activity, lanes in the
 * selected pool).
 */
function LibraryButton({
  entry,
  testId,
  onPreview,
}: {
  entry: LibraryEntry;
  testId: string;
  /** Shows (anchor set) or hides (null) the preview card; `delay` for hover. */
  onPreview: (target: PreviewTarget | null, delay?: boolean) => void;
}) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  const notify = useDocumentStore((s) => s.notify);
  const dragged = useRef(false);
  const { preset } = entry;
  const icon = useMemo(() => renderPreview(preset), [preset]);

  const onMouseDown = (e: ReactMouseEvent) => {
    onPreview(null);
    if (e.button !== 0 || !controller) return;
    dragged.current = false;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: MouseEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      dragged.current = true;
      cleanup();
      controller.startCreate(ev, preset.type, preset);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', cleanup);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', cleanup);
  };

  const disabled = readOnly || !controller;
  const where = entry.hint ? ` (${entry.hint})` : '';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Create ${entry.label}${where}`}
      data-testid={testId}
      data-library-entry=""
      className="flex h-9 w-full items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      onMouseEnter={(e) => onPreview({ entry, anchor: e.currentTarget }, true)}
      onMouseLeave={() => onPreview(null)}
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible'))
          onPreview({ entry, anchor: e.currentTarget });
      }}
      onBlur={() => onPreview(null)}
      onMouseDown={onMouseDown}
      onClick={(e) => {
        if (dragged.current || !controller) return;
        // detail 0: activated from the keyboard, there is no pointer to follow.
        if (e.detail === 0) {
          if (!controller.createInView(preset.type, preset)) {
            notify({
              kind: 'info',
              title: `${entry.label} does not fit here`,
              details: [
                entry.hint
                  ? `Place it with the mouse: ${entry.hint}.`
                  : 'Scroll the diagram so that the middle of the view is a place it may go.',
              ],
            });
          }
          return;
        }
        controller.startCreate(e.nativeEvent, preset.type, preset);
      }}
    >
      <span
        className="flex items-center justify-center"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    </button>
  );
}

/** Entries per row of a group, as laid out (the grid fills the library width). */
function columnsOf(group: HTMLElement[]): number {
  const top = group[0]?.offsetTop;
  return Math.max(1, group.filter((b) => b.offsetTop === top).length);
}

/**
 * Arrow keys move between entries in the grid, Home / End to the first / last.
 * Up and down keep the column across groups (whose last row may be short); up
 * from the first row goes back to the search field.
 */
function onGridKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
  const groups = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="group"]')]
    .map((g) => [...g.querySelectorAll<HTMLButtonElement>('[data-library-entry]')])
    .filter((g) => g.length > 0);
  const flat = groups.flat();
  const active = document.activeElement as HTMLButtonElement;
  const at = flat.indexOf(active);
  if (at < 0) return;
  const gi = groups.findIndex((g) => g.includes(active));
  const group = groups[gi]!;
  const columns = columnsOf(group);
  const i = group.indexOf(active);
  const col = i % columns;
  const lastRowStart = (g: HTMLButtonElement[]) =>
    Math.floor((g.length - 1) / columnsOf(g)) * columnsOf(g);
  let next: HTMLElement | null | undefined;
  switch (e.key) {
    case 'ArrowRight':
      next = flat[at + 1];
      break;
    case 'ArrowLeft':
      next = flat[at - 1];
      break;
    case 'Home':
      next = flat[0];
      break;
    case 'End':
      next = flat[flat.length - 1];
      break;
    case 'ArrowDown':
      if (i + columns < group.length) next = group[i + columns];
      else if (i < lastRowStart(group)) next = group[group.length - 1];
      else if (groups[gi + 1]) next = groups[gi + 1]![Math.min(col, groups[gi + 1]!.length - 1)];
      break;
    case 'ArrowUp':
      if (i >= columns) next = group[i - columns];
      else if (gi > 0) {
        const prev = groups[gi - 1]!;
        next = prev[Math.min(lastRowStart(prev) + col, prev.length - 1)];
      } else {
        next = e.currentTarget
          .closest('aside')
          ?.querySelector<HTMLInputElement>('input[type="search"]');
      }
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (next && !(next as HTMLButtonElement).disabled) next.focus();
}

/**
 * A card next to the library with the entry drawn larger, its name and where
 * it may be dropped (the icons alone do not tell similar variants apart).
 */
function PreviewCard({ target }: { target: PreviewTarget }) {
  const { entry, anchor } = target;
  const icon = useMemo(() => renderPreview(entry.preset, 56), [entry]);
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const aside = anchor.closest('aside')!.getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 8)));
  }, [r.top, r.height, entry]);
  return (
    <div
      ref={ref}
      role="tooltip"
      data-testid="library-preview"
      style={{
        left: aside.right + 8,
        top: top ?? r.top,
        visibility: top === null ? 'hidden' : undefined,
      }}
      className="pointer-events-none fixed z-50 flex w-60 items-center gap-3 rounded-lg border bg-card p-3 shadow-xl"
    >
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-md bg-background text-foreground"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <div className="min-w-0 text-xs">
        <p className="text-[13px] leading-snug font-semibold">{entry.label}</p>
        {entry.hint && <p className="mt-0.5 text-muted-foreground">Place it {entry.hint}.</p>}
        <p className="mt-1 text-muted-foreground">Click, or drag onto the canvas.</p>
      </div>
    </div>
  );
}

/**
 * BPMN 2.0.2 shape library: the common shapes first, then every notation
 * variant the editor can create, in collapsible groups, with a search field.
 * Icons are the shapes as the canvas draws them.
 */
function ShapeLibrary() {
  const [query, setQuery] = useState('');
  const collapsed = useUiStore((s) => s.libraryCollapsed);
  const toggleGroup = useUiStore((s) => s.toggleLibraryGroup);
  const width = useUiStore((s) => s.libraryWidth);
  const setWidth = useUiStore((s) => s.setLibraryWidth);
  const searching = query.trim().length > 0;
  const groups = useMemo(
    () => (searching ? searchLibrary(query) : [COMMON_GROUP, ...searchLibrary('')]),
    [query, searching],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const startWidth = useRef(0);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onPreview = (target: PreviewTarget | null, delay = false) => {
    clearTimeout(timer.current);
    // Moving between entries while a card is open switches it at once.
    if (!target || !delay || preview) setPreview(target);
    else timer.current = setTimeout(() => setPreview(target), PREVIEW_DELAY);
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      const first = listRef.current?.querySelector<HTMLButtonElement>(
        '[data-library-entry]:not(:disabled)',
      );
      if (!first) return;
      e.preventDefault();
      if (e.key === 'Enter') first.click();
      else first.focus();
    }
  };

  return (
    <>
      <aside
        aria-label="Shape library"
        data-testid="shape-library"
        style={{ width }}
        className="flex max-w-[40vw] shrink-0 flex-col border-r bg-card"
      >
        <div className="relative flex h-12 shrink-0 items-center border-b px-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            role="searchbox"
            aria-label="Search shapes"
            aria-controls="shape-library-list"
            placeholder="Search shapes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            className="h-8 w-full rounded-md border bg-background pr-7 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div
          id="shape-library-list"
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-3"
          onKeyDown={onGridKeyDown}
          onScroll={() => onPreview(null)}
        >
          {groups.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground" role="status">
              No shapes match “{query}”.
            </p>
          )}
          {groups.map((g) => {
            const open = searching || !collapsed.includes(g.id);
            const common = g.id === COMMON_GROUP.id;
            return (
              <section key={g.id} className="mb-1">
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`shape-group-${g.id}`}
                    disabled={searching}
                    className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
                    onClick={() => toggleGroup(g.id)}
                  >
                    <ChevronRight
                      className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
                    />
                    <span className="flex-1">{g.label}</span>
                    {(searching || !open) && (
                      <span className="font-normal tabular-nums">{g.entries.length}</span>
                    )}
                  </button>
                </h3>
                {open && (
                  <div
                    id={`shape-group-${g.id}`}
                    role="group"
                    aria-label={g.label}
                    className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-px"
                  >
                    {g.entries.map((entry) => (
                      <LibraryButton
                        key={entry.id}
                        entry={entry}
                        testId={
                          common ? `common-${entry.id}` : `create-${entry.testId ?? entry.id}`
                        }
                        onPreview={onPreview}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
      <ResizeHandle
        direction="horizontal"
        label="Resize shape library"
        onResize={(delta, start) => {
          if (start) startWidth.current = width;
          else setWidth(startWidth.current + delta);
        }}
        onReset={() => setWidth(DEFAULT_LIBRARY_WIDTH)}
      />
      {preview && preview.anchor.isConnected && <PreviewCard target={preview} />}
    </>
  );
}

export function Palette() {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const libraryOpen = useUiStore((s) => s.libraryOpen);
  const toggleLibrary = useUiStore((s) => s.toggleLibrary);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  return (
    <>
      <nav
        aria-label="Tools"
        className="flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r bg-card py-2"
      >
        {TOOLS.map(({ id, label, icon: Icon, shortcut }) => (
          <Button
            key={id}
            size="icon"
            variant={tool === id ? 'active' : 'ghost'}
            title={`${label} (${formatKeys(SHORTCUTS[shortcut]!.keys)})`}
            aria-label={label}
            aria-pressed={tool === id}
            disabled={id === 'connect' && readOnly}
            onClick={() => setTool(id)}
          >
            <Icon />
          </Button>
        ))}
        <Separator className="mx-2 w-6" />
        <Button
          size="icon"
          variant={libraryOpen ? 'active' : 'ghost'}
          title={`${libraryOpen ? 'Hide' : 'Show'} shape library (${formatKeys(SHORTCUTS.library!.keys)})`}
          aria-label="Shape library"
          aria-pressed={libraryOpen}
          aria-controls={libraryOpen ? 'shape-library-list' : undefined}
          data-testid="toggle-shape-library"
          onClick={() => toggleLibrary()}
        >
          <Shapes />
        </Button>
      </nav>
      {libraryOpen && <ShapeLibrary />}
    </>
  );
}

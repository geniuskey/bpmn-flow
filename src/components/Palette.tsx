import { ChevronRight, Hand, Lasso, MousePointer2, Search, Shapes, Spline, X } from 'lucide-react';
import {
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
import { searchLibrary, type LibraryEntry } from '@/editor/library';
import { renderPreview } from '@/editor/renderer/preview';
import { cn } from '@/lib/utils';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';

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
const COLUMNS = 6;

/**
 * One library entry: click then click on the canvas, or drag onto the canvas.
 * From the keyboard (Enter / Space) the element is placed in the middle of the
 * visible area (boundary events on the selected activity, lanes in the
 * selected pool).
 */
function LibraryButton({ entry }: { entry: LibraryEntry }) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  const notify = useDocumentStore((s) => s.notify);
  const dragged = useRef(false);
  const { preset } = entry;
  const icon = useMemo(() => renderPreview(preset), [preset]);

  const onMouseDown = (e: ReactMouseEvent) => {
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
      title={
        disabled
          ? `${entry.label} — not available for read-only documents`
          : `${entry.label}${where} — click or drag`
      }
      disabled={disabled}
      aria-label={`Create ${entry.label}${where}`}
      data-testid={`create-${entry.testId ?? entry.id}`}
      data-library-entry=""
      className="flex size-8 items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
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

/**
 * Arrow keys move between entries in the grid (6 per row), Home / End to the
 * first / last. Up and down keep the column across groups (whose last row may
 * be short); up from the first row goes back to the search field.
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
  const i = group.indexOf(active);
  const col = i % COLUMNS;
  const lastRowStart = (g: HTMLButtonElement[]) => Math.floor((g.length - 1) / COLUMNS) * COLUMNS;
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
      if (i + COLUMNS < group.length) next = group[i + COLUMNS];
      else if (i < lastRowStart(group)) next = group[group.length - 1];
      else if (groups[gi + 1]) next = groups[gi + 1]![Math.min(col, groups[gi + 1]!.length - 1)];
      break;
    case 'ArrowUp':
      if (i >= COLUMNS) next = group[i - COLUMNS];
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
 * BPMN 2.0.2 shape library: every notation variant the editor can create, in
 * collapsible groups, with a search field. Icons are the shapes as the canvas
 * draws them.
 */
function ShapeLibrary() {
  const [query, setQuery] = useState('');
  const collapsed = useUiStore((s) => s.libraryCollapsed);
  const toggleGroup = useUiStore((s) => s.toggleLibraryGroup);
  const groups = useMemo(() => searchLibrary(query), [query]);
  const listRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;

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
    <aside
      aria-label="Shape library"
      data-testid="shape-library"
      className="flex w-[214px] shrink-0 flex-col border-r bg-card"
    >
      <div className="relative p-2">
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
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        onKeyDown={onGridKeyDown}
      >
        {groups.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground" role="status">
            No shapes match “{query}”.
          </p>
        )}
        {groups.map((g) => {
          const open = searching || !collapsed.includes(g.id);
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
                  <span className="font-normal tabular-nums">{g.entries.length}</span>
                </button>
              </h3>
              {open && (
                <div
                  id={`shape-group-${g.id}`}
                  role="group"
                  aria-label={g.label}
                  className="grid grid-cols-6 gap-px"
                >
                  {g.entries.map((entry) => (
                    <LibraryButton key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
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
          title={libraryOpen ? 'Hide shape library' : 'Show shape library'}
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

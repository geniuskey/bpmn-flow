import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS, isEnabled, runCommand } from '@/app/commands';
import { formatKeys } from '@/app/shortcuts';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  // Re-evaluate enablement whenever the editor state changes.
  const snapshot = useEditorStore((s) => s.snapshot);

  const items = useMemo(() => {
    void snapshot;
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((c) => isEnabled(c)).filter(
      (c) => !q || `${c.group} ${c.label}`.toLowerCase().includes(q),
    );
  }, [query, snapshot]);
  const activeId = items[active] ? `command-${items[active].id}` : undefined;

  // Keep the highlighted option visible while moving with the arrow keys.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const execute = (id: string) => {
    onClose();
    runCommand(id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search commands"
            className="h-11 flex-1 bg-transparent text-sm outline-none"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && items[active]) {
                e.preventDefault();
                execute(items[active].id);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <ul
          ref={listRef}
          id="command-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto p-1"
        >
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-muted-foreground">No matching commands</li>
          )}
          {items.map((c, i) => (
            <li
              key={c.id}
              id={`command-${c.id}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                'flex h-9 cursor-default items-center gap-3 rounded-md px-3',
                i === active ? 'bg-accent text-accent-foreground' : '',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => execute(c.id)}
            >
              <span className="w-16 text-[11px] text-muted-foreground">{c.group}</span>
              <span className="flex-1">{c.label}</span>
              {c.keys && <Kbd>{formatKeys(c.keys)}</Kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COMMANDS, isEnabled, runCommand } from '@/app/commands';
import { formatKeys, keyBelongsToFocus } from '@/app/shortcuts';
import { humanizeType } from '@/bpmn/model/elements';
import { useEditorStore } from '@/stores/editorStore';
import { cn } from '@/lib/utils';

interface MenuState {
  x: number;
  y: number;
}

const ELEMENT_ITEMS = [
  'edit.rename',
  'edit.copy',
  'edit.cut',
  'edit.duplicate',
  'edit.delete',
  'arrange.addLane',
  'arrange.addSubLane',
];
const CANVAS_ITEMS = ['edit.paste', 'edit.selectAll', 'arrange.layout', 'view.fit'];

/**
 * Right-click menu for the canvas. Opens on `contextmenu` within the canvas
 * host, or from the keyboard with Shift+F10 / the context-menu key (at the
 * selection). Actions come from the shared command registry. The menu takes
 * focus: ↑/↓/Home/End move between items, Enter runs one, Escape closes it and
 * returns focus to where it was.
 */
export function ContextMenu({ host }: { host: HTMLElement | null }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const selection = useEditorStore((s) => s.snapshot.selection);
  const controller = useEditorStore((s) => s.controller);
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const open = (x: number, y: number) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setMenu({ x, y });
  };
  const close = (restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) returnFocus.current?.focus?.();
  };

  // Keep the menu inside the viewport using its real size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const m = 8;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(m, Math.min(menu.x, window.innerWidth - width - m))}px`;
    el.style.top = `${Math.max(m, Math.min(menu.y, window.innerHeight - height - m))}px`;
  }, [menu, selection]);

  useEffect(() => {
    if (!host) return;
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      // Select the element under the cursor if it is not selected yet.
      const gfx = (e.target as Element).closest('[data-element-id]');
      const id = gfx?.getAttribute('data-element-id');
      const ctrl = useEditorStore.getState().controller;
      if (
        id &&
        ctrl &&
        ctrl.getElement(id)?.parent &&
        !useEditorStore.getState().snapshot.selection.includes(id)
      ) {
        ctrl.select([id], false);
      } else if (!id || !ctrl?.getElement(id)?.parent) {
        ctrl?.select([], false);
      }
      open(e.clientX, e.clientY);
    };
    // Keyboard: Shift+F10 or the context-menu key opens the menu at the selection.
    const onKey = (e: KeyboardEvent) => {
      if (!((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (keyBelongsToFocus(target, 'Escape')) return; // inside a dialog or menu
      e.preventDefault();
      const [id] = useEditorStore.getState().snapshot.selection;
      const gfx = id ? host.querySelector(`[data-element-id="${CSS.escape(id)}"]`) : null;
      const r = (gfx ?? host).getBoundingClientRect();
      open(r.left + r.width / 2, r.top + r.height / 2);
    };
    host.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
    };
  }, [host]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    // Keys typed elsewhere close the menu; keys inside it navigate (see onKeyDown).
    const onKey = (e: KeyboardEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) dismiss();
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', dismiss);
    };
  }, [menu]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') focus(at + 1);
    else if (e.key === 'ArrowUp') focus(at - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(items.length - 1);
    else if (e.key === 'Escape') close(true);
    else if (e.key === 'Tab') close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (!menu) return null;
  const ids = selection.length ? ELEMENT_ITEMS : CANVAS_ITEMS;
  const commands = ids
    .map((id) => COMMANDS.find((c) => c.id === id)!)
    .filter((c) => isEnabled(c))
    .filter((c) => c.id !== 'arrange.addLane' || isPoolOrLane(selection[0]))
    .filter(
      (c) =>
        c.id !== 'arrange.addSubLane' ||
        controller?.getElement(selection[0] ?? '')?.type === 'bpmn:Lane',
    );
  const single = selection.length === 1 ? controller?.getElement(selection[0]!) : undefined;
  const type = (single as { type?: string } | undefined)?.type;
  const alternatives =
    type && single && !useEditorStore.getState().snapshot.readOnly
      ? (controller?.typeChangeOptions(single.id) ?? [])
      : [];

  return (
    <div
      role="menu"
      aria-label="Context menu"
      ref={menuRef}
      className="fixed z-50 max-h-[calc(100vh-1rem)] min-w-52 overflow-y-auto rounded-lg border bg-card p-1 shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {commands.map((c) => (
        <MenuItem
          key={c.id}
          label={c.label}
          keys={c.keys}
          onClick={() => (close(true), runCommand(c.id))}
        />
      ))}
      {alternatives.length > 0 && (
        <>
          <div className="my-1 h-px bg-border" />
          {alternatives.map((t) => (
            <MenuItem
              key={t}
              label={`Change to ${humanizeType(t)}`}
              onClick={() => {
                close(true);
                controller?.changeType(selection[0]!, t);
              }}
            />
          ))}
        </>
      )}
      {commands.length === 0 && alternatives.length === 0 && (
        <div className="px-3 py-2 text-muted-foreground">No actions available</div>
      )}
    </div>
  );
}

/** Lanes can be added to a pool with a process (not a black box) or to a lane. */
function isPoolOrLane(id: string | undefined): boolean {
  const element = id
    ? (useEditorStore.getState().controller?.getElement(id) as
        { type?: string; businessObject?: { get(key: string): unknown } } | undefined)
    : undefined;
  if (element?.type === 'bpmn:Lane') return true;
  return element?.type === 'bpmn:Participant' && !!element.businessObject?.get('processRef');
}

function MenuItem({ label, keys, onClick }: { label: string; keys?: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      className={cn('flex h-8 w-full items-center gap-4 rounded-md px-3 text-left hover:bg-accent')}
      onClick={onClick}
    >
      <span className="flex-1">{label}</span>
      {keys && <span className="text-[11px] text-muted-foreground">{formatKeys(keys)}</span>}
    </button>
  );
}

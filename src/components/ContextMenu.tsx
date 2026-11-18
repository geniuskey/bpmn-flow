import { useEffect, useState } from 'react';
import { COMMANDS, isEnabled, runCommand } from '@/app/commands';
import { formatKeys } from '@/app/shortcuts';
import { alternativeTypes } from '@/editor/commands/ChangeTypeHandler';
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
];
const CANVAS_ITEMS = ['edit.paste', 'edit.selectAll', 'arrange.layout', 'view.fit'];

/**
 * Right-click menu for the canvas. Opens on `contextmenu` within the canvas
 * host; actions come from the shared command registry.
 */
export function ContextMenu({ host }: { host: HTMLElement | null }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const selection = useEditorStore((s) => s.snapshot.selection);
  const controller = useEditorStore((s) => s.controller);

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
      setMenu({ x: e.clientX, y: e.clientY });
    };
    host.addEventListener('contextmenu', onContext);
    return () => host.removeEventListener('contextmenu', onContext);
  }, [host]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('wheel', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  if (!menu) return null;
  const ids = selection.length ? ELEMENT_ITEMS : CANVAS_ITEMS;
  const commands = ids
    .map((id) => COMMANDS.find((c) => c.id === id)!)
    .filter((c) => isEnabled(c))
    .filter((c) => c.id !== 'arrange.addLane' || isPoolOrLane(selection[0]));
  const single = selection.length === 1 ? controller?.getElement(selection[0]!) : undefined;
  const type = (single as { type?: string } | undefined)?.type;
  const alternatives =
    type && !useEditorStore.getState().snapshot.readOnly ? alternativeTypes(type) : [];

  return (
    <div
      role="menu"
      aria-label="Context menu"
      className="fixed z-50 min-w-52 rounded-lg border bg-card p-1 shadow-xl"
      style={{
        left: Math.min(menu.x, window.innerWidth - 230),
        top: Math.min(menu.y, window.innerHeight - 320),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {commands.map((c) => (
        <MenuItem
          key={c.id}
          label={c.label}
          keys={c.keys}
          onClick={() => (setMenu(null), runCommand(c.id))}
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
                setMenu(null);
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

function isPoolOrLane(id: string | undefined): boolean {
  const type = id
    ? (useEditorStore.getState().controller?.getElement(id) as { type?: string } | undefined)?.type
    : '';
  return type === 'bpmn:Participant' || type === 'bpmn:Lane';
}

function MenuItem({ label, keys, onClick }: { label: string; keys?: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      className={cn('flex h-8 w-full items-center gap-4 rounded-md px-3 text-left hover:bg-accent')}
      onClick={onClick}
    >
      <span className="flex-1">{label}</span>
      {keys && <span className="text-[11px] text-muted-foreground">{formatKeys(keys)}</span>}
    </button>
  );
}

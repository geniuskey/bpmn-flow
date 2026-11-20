import { useEffect } from 'react';
import { runCommand } from './commands';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';

export interface Shortcut {
  keys: string;
  label: string;
}

/** Displayed in tooltips; the full list lives in src/app/commands.ts. */
export const SHORTCUTS: Record<string, Shortcut> = {
  open: { keys: 'Mod+O', label: 'Open' },
  export: { keys: 'Mod+S', label: 'Export BPMN' },
  newDoc: { keys: 'Mod+Alt+N', label: 'New diagram' },
  undo: { keys: 'Mod+Z', label: 'Undo' },
  redo: { keys: 'Mod+Shift+Z', label: 'Redo' },
  selectAll: { keys: 'Mod+A', label: 'Select all' },
  select: { keys: 'V', label: 'Select tool' },
  pan: { keys: 'H', label: 'Pan tool' },
  lasso: { keys: 'L', label: 'Lasso tool' },
  connect: { keys: 'C', label: 'Connect tool' },
  zoomIn: { keys: '+', label: 'Zoom in' },
  zoomOut: { keys: '-', label: 'Zoom out' },
  zoomReset: { keys: '0', label: 'Reset zoom' },
  fit: { keys: 'Shift+1', label: 'Fit to view' },
  layout: { keys: 'Mod+Shift+L', label: 'Auto layout' },
  palette: { keys: 'Mod+K', label: 'Command palette' },
  library: { keys: 'Mod+B', label: 'Toggle shape library' },
  inspector: { keys: 'Mod+Alt+B', label: 'Toggle properties panel' },
};

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatKeys(keys: string): string {
  if (keys === '+') return '+';
  const parts = keys
    .split('+')
    .map((k) =>
      k === 'Mod'
        ? isMac
          ? '⌘'
          : 'Ctrl'
        : k === 'Shift'
          ? isMac
            ? '⇧'
            : 'Shift'
          : k === 'Alt'
            ? isMac
              ? '⌥'
              : 'Alt'
            : k,
    );
  return parts.join(isMac ? '' : '+');
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Keys that a focused control (button, tab, menu item, …) handles itself. */
const CONTROL_KEYS = new Set([
  'Enter',
  ' ',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Escape',
]);

const CONTROL_SELECTOR =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="slider"], [role="radio"]';

/**
 * Whether a key belongs to the focused UI rather than to the diagram: inside a
 * dialog or menu no single-key shortcut applies, and a focused control keeps
 * the keys it uses (Enter activates a button, arrows move between tabs, …).
 */
export function keyBelongsToFocus(target: EventTarget | null, key: string): boolean {
  const el = target instanceof Element ? target : null;
  if (!el || el.closest('.djs-container')) return false;
  if (el.closest('[role="dialog"], [role="menu"]')) return true;
  return CONTROL_KEYS.has(key) && !!el.closest(CONTROL_SELECTOR);
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const ctrl = useEditorStore.getState().controller;
      const key = e.key.toLowerCase();
      const run = (id: string) => {
        e.preventDefault();
        runCommand(id);
      };

      if (mod && key === 'k') {
        e.preventDefault();
        useUiStore.getState().setCommandPaletteOpen(true);
        return;
      }
      // File commands also work while typing: commit the field first (fields
      // commit on blur), so exports include it and "discard changes?" sees it.
      const fileCmd = !mod
        ? null
        : key === 'o'
          ? 'file.open'
          : key === 's'
            ? 'file.export'
            : e.altKey && key === 'n'
              ? 'file.new'
              : null;
      if (fileCmd) {
        if (isTyping(e.target)) (e.target as HTMLElement).blur();
        return run(fileCmd);
      }
      if (isTyping(e.target) || !ctrl || ctrl.isEditingText()) return;

      // e.code: with Alt held, macOS reports a different character in e.key.
      if (mod && e.code === 'KeyB') return run(e.altKey ? 'view.inspector' : 'view.library');
      if (mod && key === 'z') return run(e.shiftKey ? 'edit.redo' : 'edit.undo');
      if (mod && key === 'y') return run('edit.redo');
      if (mod && key === 'a') return run('edit.selectAll');
      if (mod && key === 'c') return run('edit.copy');
      if (mod && key === 'x') return run('edit.cut');
      if (mod && key === 'v') return run('edit.paste');
      if (mod && key === 'd') return run('edit.duplicate');
      if (mod && e.shiftKey && key === 'l') return run('arrange.layout');
      if (mod || e.altKey) return;
      if (keyBelongsToFocus(e.target, e.key)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') return run('edit.delete');
      if (
        e.key === 'F2' ||
        (e.key === 'Enter' && useEditorStore.getState().snapshot.selection.length === 1)
      ) {
        return run('edit.rename');
      }
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const arrow = arrows[e.key];
      if (arrow && useEditorStore.getState().snapshot.selection.length) {
        e.preventDefault();
        ctrl.nudge(arrow[0], arrow[1]);
        return;
      }
      if (key === 'v') return run('tools.select');
      if (key === 'h') return run('tools.pan');
      if (key === 'l') return run('tools.lasso');
      if (key === 'c') return run('tools.connect');
      if (e.key === '+' || e.key === '=') return run('view.zoomIn');
      if (e.key === '-') return run('view.zoomOut');
      if (e.key === '0') return run('view.zoomReset');
      if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) return run('view.fit');
      if (e.key === 'Escape') return useUiStore.getState().setTool('select');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

import type { EditorController } from '@/editor/EditorController';

export interface KeyboardOptions {
  /**
   * Element that receives `keydown`. Defaults to the editor container, so the
   * shortcuts only apply while the canvas (or something inside it) has focus.
   */
  target?: HTMLElement | Window;
  /** Called for Mod+S; omit to leave the key to the browser. */
  onSave?: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName ?? ''))
  );
}

/**
 * Binds the standard BPMN Flow editing shortcuts. Returns a function that
 * removes them. `Mod` is ⌘ on macOS and Ctrl elsewhere.
 *
 * Mod+Z / Mod+Shift+Z / Mod+Y undo/redo · Mod+A select all · Mod+C/X/V/D copy,
 * cut, paste, duplicate · Mod+Shift+L auto layout · Delete/Backspace delete ·
 * F2/Enter rename · arrows nudge (Shift: 10px) · V/H/L/C tools · +/-/0 zoom ·
 * Shift+1 fit · Escape select tool.
 */
export function bindKeyboard(
  editor: EditorController,
  container: HTMLElement,
  options: KeyboardOptions = {},
): () => void {
  const target = options.target ?? container;
  if (target instanceof HTMLElement && target.tabIndex < 0 && !target.hasAttribute('tabindex')) {
    target.tabIndex = 0;
  }

  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const run = (action: () => unknown) => {
      e.preventDefault();
      action();
    };

    if (mod && key === 's' && options.onSave) {
      const { onSave } = options;
      return run(() => {
        // Commit a field being typed in first (fields commit on blur).
        if (isTyping(e.target)) (e.target as HTMLElement).blur();
        onSave();
      });
    }
    if (isTyping(e.target) || editor.isEditingText()) return;
    const { readOnly, selection } = editor.getSnapshot();

    if (mod) {
      if (key === 'z') return run(() => (e.shiftKey ? editor.redo() : editor.undo()));
      if (key === 'y') return run(() => editor.redo());
      if (key === 'a') return run(() => editor.selectAll());
      if (key === 'c') return run(() => editor.copy());
      if (readOnly) return;
      if (key === 'x') return run(() => editor.cut());
      if (key === 'v') return run(() => editor.paste());
      if (key === 'd') return run(() => editor.duplicate());
      if (e.shiftKey && key === 'l')
        return run(() => editor.autoLayout().catch((err: unknown) => console.error(err)));
      return;
    }
    if (e.altKey) return;

    if (!readOnly && (e.key === 'Delete' || e.key === 'Backspace')) {
      return run(() => editor.deleteSelection());
    }
    if (!readOnly && (e.key === 'F2' || (e.key === 'Enter' && selection.length === 1))) {
      if (editor.renameSelection()) e.preventDefault();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const arrow = arrows[e.key];
    if (arrow && selection.length && !readOnly) {
      return run(() => editor.nudge(arrow[0], arrow[1]));
    }
    if (key === 'v') return editor.setTool('select');
    if (key === 'h') return editor.setTool('pan');
    if (key === 'l') return editor.setTool('lasso');
    if (key === 'c' && !readOnly) return editor.setTool('connect');
    if (e.key === '+' || e.key === '=') return run(() => editor.zoomBy(1.2));
    if (e.key === '-') return run(() => editor.zoomBy(1 / 1.2));
    if (e.key === '0') return run(() => editor.resetZoom());
    if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) return run(() => editor.fit());
    if (e.key === 'Escape') return editor.setTool('select');
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

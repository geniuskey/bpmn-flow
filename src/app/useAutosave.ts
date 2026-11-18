import { useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { flushAutosave, hasUnsavedSession, scheduleAutosave } from './actions';

/**
 * Saves the document to IndexedDB shortly after each change.
 *
 * Every change is saved, including ones that make the document match its last
 * export again (undo after export): `dirty` tracks "differs from the export",
 * not "differs from the autosave". Pending saves are flushed when the page is
 * hidden, and leaving while one is still running asks for confirmation.
 */
export function useAutosave(): void {
  const revision = useEditorStore((s) => s.snapshot.revision);
  useEffect(() => {
    if (revision > 0) scheduleAutosave();
  }, [revision]);

  useEffect(() => {
    const flush = () => void flushAutosave();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedSession()) return;
      flush();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}

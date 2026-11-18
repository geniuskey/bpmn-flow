import { useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { saveSession } from './actions';

const DELAY_MS = 1000;

/** Saves the document to IndexedDB shortly after each change. */
export function useAutosave(): void {
  const revision = useEditorStore((s) => s.snapshot.revision);
  const dirty = useEditorStore((s) => s.snapshot.dirty);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void saveSession(), DELAY_MS);
    return () => clearTimeout(t);
  }, [revision, dirty]);
}

import { useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';

const COMPACT_WIDTH = 960;

/** On narrow screens, start with side panels collapsed so the canvas stays usable. */
export function useCompactLayout(): void {
  useEffect(() => {
    if (window.innerWidth >= COMPACT_WIDTH) return;
    const ui = useUiStore.getState();
    if (ui.inspectorOpen) ui.toggleInspector();
    if (ui.analysisOpen) ui.toggleAnalysis(false);
  }, []);
}

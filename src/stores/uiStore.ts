import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { EditorTool } from '@/editor/EditorController';

export type ThemePreference = 'light' | 'dark' | 'system';
export type AnalysisTab =
  'overview' | 'metrics' | 'validation' | 'findings' | 'compatibility' | 'estimates';

interface UiState {
  theme: ThemePreference;
  tool: EditorTool;
  inspectorOpen: boolean;
  analysisOpen: boolean;
  inspectorWidth: number;
  analysisHeight: number;
  analysisTab: AnalysisTab;
  commandPaletteOpen: boolean;
  snapToGrid: boolean;
  /** Shape library panel next to the tools. */
  libraryOpen: boolean;
  /** Library groups the user collapsed. */
  libraryCollapsed: string[];
  toggleLibrary(open?: boolean): void;
  toggleLibraryGroup(id: string): void;
  setCommandPaletteOpen(open: boolean): void;
  setSnapToGrid(on: boolean): void;
  setTheme(theme: ThemePreference): void;
  setTool(tool: EditorTool): void;
  toggleInspector(): void;
  toggleAnalysis(open?: boolean): void;
  setInspectorWidth(width: number): void;
  setAnalysisHeight(height: number): void;
  setAnalysisTab(tab: AnalysisTab): void;
}

/** Storage that never throws (private mode, blocked storage). */
const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
}));

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      tool: 'select',
      inspectorOpen: true,
      analysisOpen: true,
      inspectorWidth: 300,
      analysisHeight: 220,
      analysisTab: 'overview',
      commandPaletteOpen: false,
      snapToGrid: true,
      libraryOpen: true,
      libraryCollapsed: [],
      toggleLibrary: (open) => set((s) => ({ libraryOpen: open ?? !s.libraryOpen })),
      toggleLibraryGroup: (id) =>
        set((s) => ({
          libraryCollapsed: s.libraryCollapsed.includes(id)
            ? s.libraryCollapsed.filter((g) => g !== id)
            : [...s.libraryCollapsed, id],
        })),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setTheme: (theme) => set({ theme }),
      setTool: (tool) => set({ tool }),
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      toggleAnalysis: (open) => set((s) => ({ analysisOpen: open ?? !s.analysisOpen })),
      setInspectorWidth: (inspectorWidth) =>
        set({ inspectorWidth: Math.round(Math.min(520, Math.max(240, inspectorWidth))) }),
      setAnalysisHeight: (analysisHeight) =>
        set({ analysisHeight: Math.round(Math.min(520, Math.max(120, analysisHeight))) }),
      setAnalysisTab: (analysisTab) => set({ analysisTab }),
    }),
    {
      name: 'bpmn-flow.ui',
      storage: safeStorage,
      partialize: ({
        theme,
        inspectorOpen,
        analysisOpen,
        inspectorWidth,
        analysisHeight,
        analysisTab,
        libraryOpen,
        libraryCollapsed,
      }) => ({
        libraryOpen,
        libraryCollapsed,
        theme,
        inspectorOpen,
        analysisOpen,
        inspectorWidth,
        analysisHeight,
        analysisTab,
      }),
    },
  ),
);

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
  libraryWidth: number;
  /** Properties panel sections the user collapsed. */
  inspectorCollapsed: string[];
  toggleLibrary(open?: boolean): void;
  toggleLibraryGroup(id: string): void;
  setLibraryWidth(width: number): void;
  toggleInspectorSection(id: string): void;
  setCommandPaletteOpen(open: boolean): void;
  setSnapToGrid(on: boolean): void;
  setTheme(theme: ThemePreference): void;
  setTool(tool: EditorTool): void;
  toggleInspector(open?: boolean): void;
  toggleAnalysis(open?: boolean): void;
  setInspectorWidth(width: number): void;
  setAnalysisHeight(height: number): void;
  setAnalysisTab(tab: AnalysisTab): void;
}

export const DEFAULT_INSPECTOR_WIDTH = 300;
export const DEFAULT_ANALYSIS_HEIGHT = 220;
export const DEFAULT_LIBRARY_WIDTH = 220;

const toggled = (list: string[], id: string) =>
  list.includes(id) ? list.filter((g) => g !== id) : [...list, id];

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
      inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
      analysisHeight: DEFAULT_ANALYSIS_HEIGHT,
      analysisTab: 'overview',
      commandPaletteOpen: false,
      snapToGrid: true,
      libraryOpen: true,
      // Rarely used notation starts collapsed.
      libraryCollapsed: ['conversations', 'choreography'],
      libraryWidth: DEFAULT_LIBRARY_WIDTH,
      inspectorCollapsed: [],
      toggleLibrary: (open) => set((s) => ({ libraryOpen: open ?? !s.libraryOpen })),
      toggleLibraryGroup: (id) =>
        set((s) => ({ libraryCollapsed: toggled(s.libraryCollapsed, id) })),
      setLibraryWidth: (libraryWidth) =>
        set({ libraryWidth: Math.round(Math.min(400, Math.max(180, libraryWidth))) }),
      toggleInspectorSection: (id) =>
        set((s) => ({ inspectorCollapsed: toggled(s.inspectorCollapsed, id) })),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setTheme: (theme) => set({ theme }),
      setTool: (tool) => set({ tool }),
      toggleInspector: (open) => set((s) => ({ inspectorOpen: open ?? !s.inspectorOpen })),
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
        libraryWidth,
        inspectorCollapsed,
      }) => ({
        libraryOpen,
        libraryCollapsed,
        libraryWidth,
        inspectorCollapsed,
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

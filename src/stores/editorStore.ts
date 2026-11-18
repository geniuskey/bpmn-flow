import { create } from 'zustand';
import type { EditorController, EditorSnapshot } from '@/editor/EditorController';

interface EditorState {
  controller: EditorController | null;
  snapshot: EditorSnapshot;
  setController(controller: EditorController | null): void;
  setSnapshot(snapshot: EditorSnapshot): void;
}

export const useEditorStore = create<EditorState>((set) => ({
  controller: null,
  snapshot: {
    selection: [],
    canUndo: false,
    canRedo: false,
    revision: 0,
    dirty: false,
    zoom: 1,
    readOnly: true,
    activeTool: 'select',
  },
  setController: (controller) => set({ controller }),
  setSnapshot: (snapshot) => set({ snapshot }),
}));

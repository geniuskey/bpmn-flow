import { create } from 'zustand';
import type { BpmnDocument } from '@/bpmn/document';

export type NoticeKind = 'error' | 'warning' | 'info' | 'success';

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  details?: string[];
}

interface DocumentState {
  /** The open document. Its moddle tree is mutated by editor commands, not by React. */
  doc: BpmnDocument | null;
  loading: boolean;
  notices: Notice[];
  setDocument(doc: BpmnDocument): void;
  setLoading(loading: boolean): void;
  notify(notice: Omit<Notice, 'id'>): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useDocumentStore = create<DocumentState>((set) => ({
  doc: null,
  loading: false,
  notices: [],
  setDocument: (doc) => set({ doc }),
  setLoading: (loading) => set({ loading }),
  notify: (notice) =>
    set((s) => ({ notices: [...s.notices.slice(-3), { ...notice, id: nextId++ }] })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));

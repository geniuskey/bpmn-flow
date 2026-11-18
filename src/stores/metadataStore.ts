/**
 * Analysis metadata for the open document, mirrored to IndexedDB.
 */
import { create } from 'zustand';
import { isEmptyMetadata, type AnalysisMetadata } from '@/analysis/estimates/metadata';
import { persistence } from '@/persistence/db';

interface MetadataState {
  documentId: string | null;
  byElement: Record<string, AnalysisMetadata>;
  load(documentId: string): Promise<void>;
  update(elementId: string, patch: Partial<AnalysisMetadata>): void;
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
  documentId: null,
  byElement: {},
  load: async (documentId) => {
    set({ documentId, byElement: {} });
    const rows = await persistence.loadMetadata(documentId);
    if (get().documentId !== documentId) return; // another document was opened meanwhile
    set({ byElement: Object.fromEntries(rows.map((r) => [r.elementId, r])) });
  },
  update: (elementId, patch) => {
    const { documentId, byElement } = get();
    if (!documentId) return;
    const next: AnalysisMetadata = { ...byElement[elementId], ...patch, elementId };
    const copy = { ...byElement };
    if (isEmptyMetadata(next)) {
      delete copy[elementId];
      void persistence.deleteMetadata(documentId, elementId);
    } else {
      copy[elementId] = next;
      void persistence.saveMetadata(documentId, next);
    }
    set({ byElement: copy });
  },
}));

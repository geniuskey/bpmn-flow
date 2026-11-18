/**
 * Local persistence in IndexedDB (no server):
 * - `session`: the last open document for autosave/restore
 * - `metadata`: analysis metadata keyed by [documentId, elementId]
 *
 * Every call is defensive: storage can be unavailable (private mode, quota),
 * and the editor must keep working without it.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AnalysisMetadata } from '@/analysis/estimates/metadata';

export interface SavedSession {
  id: 'current';
  xml: string;
  fileName: string;
  documentId: string;
  savedAt: number;
}

interface FlowDB extends DBSchema {
  session: { key: string; value: SavedSession };
  metadata: {
    key: [string, string];
    value: AnalysisMetadata & { documentId: string };
    indexes: { byDocument: string };
  };
}

let dbPromise: Promise<IDBPDatabase<FlowDB>> | null = null;

function db(): Promise<IDBPDatabase<FlowDB>> {
  dbPromise ??= openDB<FlowDB>('bpmn-flow', 1, {
    upgrade(database) {
      database.createObjectStore('session', { keyPath: 'id' });
      const meta = database.createObjectStore('metadata', { keyPath: ['documentId', 'elementId'] });
      meta.createIndex('byDocument', 'documentId');
    },
  });
  return dbPromise;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const persistence = {
  saveSession: (session: Omit<SavedSession, 'id'>) =>
    safe(async () => {
      await (await db()).put('session', { id: 'current', ...session });
      return true;
    }, false),
  loadSession: () => safe(async () => (await (await db()).get('session', 'current')) ?? null, null),
  clearSession: () => safe(async () => (await db()).delete('session', 'current'), undefined),

  loadMetadata: (documentId: string) =>
    safe(async () => {
      const rows = await (await db()).getAllFromIndex('metadata', 'byDocument', documentId);
      return rows.map(({ documentId: _d, ...m }) => (void _d, m as AnalysisMetadata));
    }, [] as AnalysisMetadata[]),
  saveMetadata: (documentId: string, metadata: AnalysisMetadata) =>
    safe(async () => {
      await (await db()).put('metadata', { ...metadata, documentId });
      return true;
    }, false),
  deleteMetadata: (documentId: string, elementId: string) =>
    safe(async () => (await db()).delete('metadata', [documentId, elementId]), undefined),

  /** For tests. */
  reset: () => {
    dbPromise = null;
  },
};

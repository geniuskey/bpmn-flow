/**
 * Local persistence in IndexedDB (no server):
 * - `session`: the last open document for autosave/restore (`current`), and the
 *   one it replaced (`previous`), so opening another document never destroys
 *   the only copy of unexported work
 * - `metadata`: analysis metadata keyed by [documentId, elementId]
 *
 * Every call is defensive: storage can be unavailable (private mode, quota),
 * and the editor must keep working without it.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AnalysisMetadata } from '@/analysis/estimates/metadata';

export interface SavedSession {
  id: 'current' | 'previous';
  xml: string;
  fileName: string;
  documentId: string;
  savedAt: number;
  /** The file as first opened, so "Download original" still works after a restore. */
  originalXml?: string;
  originalBytes?: Uint8Array;
}

interface FlowDB extends DBSchema {
  session: { key: string; value: SavedSession };
  metadata: {
    key: [string, string];
    value: AnalysisMetadata & { documentId: string };
    indexes: { byDocument: string };
  };
}

const DB_VERSION = 1;
/** Storage calls that take longer (e.g. an upgrade blocked by another tab) fail soft. */
const TIMEOUT_MS = 5000;

let dbPromise: Promise<IDBPDatabase<FlowDB>> | null = null;

function db(): Promise<IDBPDatabase<FlowDB>> {
  dbPromise ??= openDB<FlowDB>('bpmn-flow', DB_VERSION, {
    upgrade(database, oldVersion) {
      // Each step creates what its version added, so later versions can extend this.
      if (oldVersion < 1) {
        database.createObjectStore('session', { keyPath: 'id' });
        const meta = database.createObjectStore('metadata', {
          keyPath: ['documentId', 'elementId'],
        });
        meta.createIndex('byDocument', 'documentId');
      }
    },
    // A newer version of the app opened in another tab: let it upgrade.
    blocking() {
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
    // The browser closed the connection (e.g. storage cleared): reopen on next use.
    terminated() {
      dbPromise = null;
    },
  });
  // A failed open is not cached, so a transient error does not disable storage for good.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
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
  /**
   * Copies the current session to the `previous` slot, unless there is none or
   * it is the same document as `incoming` (re-opening a document, for example a
   * reloaded sample link, must not push older work out of the backup).
   */
  backupSession: (incoming: Pick<SavedSession, 'documentId' | 'fileName'>) =>
    safe(async () => {
      const database = await db();
      const current = await database.get('session', 'current');
      if (!current) return false;
      if (current.documentId === incoming.documentId && current.fileName === incoming.fileName)
        return false;
      await database.put('session', { ...current, id: 'previous' });
      return true;
    }, false),
  loadPreviousSession: () =>
    safe(async () => (await (await db()).get('session', 'previous')) ?? null, null),

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

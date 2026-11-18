import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { persistence } from '@/persistence/db';

describe('IndexedDB persistence', () => {
  it('stores and restores the session', async () => {
    expect(await persistence.loadSession()).toBeNull();
    await persistence.saveSession({
      xml: '<x/>',
      fileName: 'a.bpmn',
      documentId: 'D1',
      savedAt: 1,
    });
    expect(await persistence.loadSession()).toMatchObject({ xml: '<x/>', fileName: 'a.bpmn' });
    await persistence.clearSession();
    expect(await persistence.loadSession()).toBeNull();
  });

  it('keys metadata by document and element', async () => {
    await persistence.saveMetadata('D1', { elementId: 'T1', durationMinutes: 5 });
    await persistence.saveMetadata('D1', { elementId: 'T2', owner: 'Ops' });
    await persistence.saveMetadata('D2', { elementId: 'T1', cost: 3 });
    expect((await persistence.loadMetadata('D1')).map((m) => m.elementId).sort()).toEqual([
      'T1',
      'T2',
    ]);
    expect(await persistence.loadMetadata('D2')).toEqual([{ elementId: 'T1', cost: 3 }]);
    await persistence.deleteMetadata('D1', 'T1');
    expect((await persistence.loadMetadata('D1')).map((m) => m.elementId)).toEqual(['T2']);
  });
});

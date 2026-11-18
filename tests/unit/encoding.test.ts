/** Files are decoded with their declared encoding; invalid text is rejected, not garbled. */
import { describe, expect, it } from 'vitest';
import { decodeXmlBytes } from '@/bpmn/import/encoding';
import { BpmnImportError } from '@/bpmn/import/parse';
import { loadBpmnDocument } from '@/bpmn/document';
import { getMany } from '@/bpmn/model/moddle';
import { fixture } from '../helpers';

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe('decodeXmlBytes', () => {
  it('uses the encoding from the XML declaration', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><a name="Prüfung"/>';
    // The decoded text declares UTF-8 (it is Unicode now), so the parser accepts it.
    expect(decodeXmlBytes(latin1(xml))).toBe(xml.replace('ISO-8859-1', 'UTF-8'));
  });

  it('defaults to UTF-8 and handles byte-order marks', () => {
    const xml = '<?xml version="1.0"?><a name="Prüfung ✓"/>';
    expect(decodeXmlBytes(new TextEncoder().encode(xml))).toBe(xml);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(xml)]);
    expect(decodeXmlBytes(withBom)).toBe(xml);
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...latin1(xml.replace('✓', ''))].flatMap((b) => [b, 0]),
    ]);
    expect(decodeXmlBytes(utf16)).toBe(xml.replace('✓', ''));
  });

  it('rejects bytes that are not valid in the declared encoding', () => {
    // Latin-1 "ü" without a declaration is invalid UTF-8.
    expect(() => decodeXmlBytes(latin1('<a name="Prüfung"/>'))).toThrow(BpmnImportError);
    expect(() => decodeXmlBytes(latin1('<?xml version="1.0" encoding="x-unknown"?><a/>'))).toThrow(
      /unsupported text encoding/,
    );
  });
});

describe('original file', () => {
  it('keeps the original text and bytes when loading a later state', async () => {
    const xml = fixture('simple-process.bpmn');
    const bytes = new TextEncoder().encode(xml);
    const later = xml.replace('Check order', 'Edited');
    const doc = await loadBpmnDocument(later, 'a.bpmn', { xml, bytes });
    expect(doc.originalXml).toBe(xml);
    expect(doc.originalBytes).toBe(bytes);
    const process = getMany(doc.definitions, 'rootElements')[0];
    expect(getMany(process, 'flowElements').find((e) => e.id === 'Task_check')?.name).toBe(
      'Edited',
    );
  });
});

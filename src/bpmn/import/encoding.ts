/**
 * Decodes the bytes of an XML file using its byte-order mark or XML declaration
 * (`<?xml version="1.0" encoding="ISO-8859-1"?>`), defaulting to UTF-8 as XML
 * does. Invalid text is an error rather than silently replaced characters.
 */
import { BpmnImportError } from './parse';

function sniffEncoding(bytes: Uint8Array): string {
  const [a, b, c] = bytes;
  if (a === 0xef && b === 0xbb && c === 0xbf) return 'utf-8';
  if (a === 0xff && b === 0xfe) return 'utf-16le';
  if (a === 0xfe && b === 0xff) return 'utf-16be';
  if (a === 0x3c && b === 0x00) return 'utf-16le'; // "<" without BOM
  if (a === 0x00 && b === 0x3c) return 'utf-16be';
  // The declaration is ASCII in every ASCII-compatible encoding.
  let head = '';
  for (let i = 0; i < Math.min(bytes.length, 256); i++) head += String.fromCharCode(bytes[i]!);
  const m = /^<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  return m ? m[1]!.toLowerCase() : 'utf-8';
}

export function decodeXmlBytes(bytes: Uint8Array): string {
  const encoding = sniffEncoding(bytes);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    throw new BpmnImportError(`The file uses an unsupported text encoding (“${encoding}”).`);
  }
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new BpmnImportError(
      `The file is not valid ${encoding.toUpperCase()} text.`,
      encoding === 'utf-8'
        ? 'If it uses another encoding, declare it in the XML declaration, e.g. <?xml version="1.0" encoding="ISO-8859-1"?>.'
        : undefined,
    );
  }
  // The decoded text is Unicode: its declaration must no longer name the byte
  // encoding, or the XML parser falls back with a warning. (The original bytes
  // are kept separately for "Download original".)
  return encoding === 'utf-8'
    ? text
    : text.replace(/^(<\?xml[^>]*?\sencoding\s*=\s*["'])[^"']*(["'])/, '$1UTF-8$2');
}

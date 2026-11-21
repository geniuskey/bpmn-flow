/**
 * Document lifecycle: load (parse → prove round-trip → assess) and export
 * (serialize → verify by re-parsing). Pure TypeScript, no UI dependencies.
 */
import { canonicalize, diffCanonical } from './model/canonical';
import { createModdle, type BpmnModdleInstance, type ModdleElement } from './model/moddle';
import { parseBpmnXml } from './import/parse';
import { findDroppedMarkup } from './import/markup';
import { assessCompatibility, type CompatibilityReport } from './validation/compatibility';

export interface BpmnDocument {
  moddle: BpmnModdleInstance;
  /** Live `bpmn:Definitions` — the single source of truth. */
  definitions: ModdleElement;
  report: CompatibilityReport;
  /** The text of the file as it was opened (before any edit or autosave). */
  originalXml: string;
  /** The exact bytes of the file as it was opened, when it came from a file. */
  originalBytes?: Uint8Array;
  fileName: string;
}

export class BpmnExportError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'BpmnExportError';
  }
}

async function serialize(moddle: BpmnModdleInstance, definitions: ModdleElement): Promise<string> {
  const { xml } = await moddle.toXML(definitions, { format: true, preamble: true });
  return xml;
}

/** The document's current XML, without verification (for views of a copy). */
export function serializeDocument(doc: BpmnDocument): Promise<string> {
  return serialize(doc.moddle, doc.definitions);
}

/** Serializes and re-parses; returns differences (empty = lossless). */
export async function verifyRoundTrip(
  moddle: BpmnModdleInstance,
  definitions: ModdleElement,
): Promise<{ xml: string; diffs: string[] }> {
  const xml = await serialize(moddle, definitions);
  const reparsed = await parseBpmnXml(xml, createModdle());
  const diffs = reparsed.warnings.map((w) => `re-import warning: ${w}`);
  diffs.push(...diffCanonical(canonicalize(definitions), canonicalize(reparsed.definitions)));
  return { xml, diffs };
}

/**
 * `original` describes the file as the user first opened it, when `xml` is a
 * later state of it (a restored autosave); "Download original" returns it.
 */
export async function loadBpmnDocument(
  xml: string,
  fileName = 'diagram.bpmn',
  original: { xml?: string; bytes?: Uint8Array } = {},
): Promise<BpmnDocument> {
  const parsed = await parseBpmnXml(xml);
  let roundTripDiffs: string[];
  try {
    roundTripDiffs = (await verifyRoundTrip(parsed.moddle, parsed.definitions)).diffs;
  } catch (err) {
    roundTripDiffs = [`serialization failed: ${err instanceof Error ? err.message : String(err)}`];
  }
  const report = assessCompatibility(
    parsed.definitions,
    parsed.warnings,
    roundTripDiffs,
    findDroppedMarkup(xml),
  );
  return {
    moddle: parsed.moddle,
    definitions: parsed.definitions,
    report,
    originalXml: original.xml ?? xml,
    ...(original.bytes ? { originalBytes: original.bytes } : {}),
    fileName,
  };
}

/**
 * Serializes the current model. Refuses when the document is known to be lossy,
 * and verifies the produced XML re-imports to the identical model.
 */
export async function exportBpmnXml(doc: BpmnDocument): Promise<string> {
  if (!doc.report.exportAllowed) {
    throw new BpmnExportError(
      'Export is blocked because this file contains content that would be lost. Use “Download original” instead.',
    );
  }
  let result: { xml: string; diffs: string[] };
  try {
    result = await verifyRoundTrip(doc.moddle, doc.definitions);
  } catch (err) {
    throw new BpmnExportError('Serialization failed.', [
      err instanceof Error ? err.message : String(err),
    ]);
  }
  if (result.diffs.length) {
    throw new BpmnExportError(
      'Export verification failed: the output would not re-import identically.',
      result.diffs,
    );
  }
  return result.xml;
}

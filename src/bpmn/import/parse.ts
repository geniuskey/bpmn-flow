import { createModdle, is, type BpmnModdleInstance, type ModdleElement } from '../model/moddle';

/** Hard upper bound to keep the UI responsive; larger files are rejected with a clear message. */
export const MAX_XML_BYTES = 25 * 1024 * 1024;

export class BpmnImportError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'BpmnImportError';
  }
}

export interface ParsedBpmn {
  moddle: BpmnModdleInstance;
  definitions: ModdleElement;
  /** Parser warnings. Each one indicates content that moddle could not keep. */
  warnings: string[];
}

export async function parseBpmnXml(
  xml: string,
  moddle: BpmnModdleInstance = createModdle(),
): Promise<ParsedBpmn> {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new BpmnImportError('The file is empty.');
  }
  if (xml.length > MAX_XML_BYTES) {
    throw new BpmnImportError(
      `The file is too large (${(xml.length / 1024 / 1024).toFixed(1)} MB). The limit is ${
        MAX_XML_BYTES / 1024 / 1024
      } MB.`,
    );
  }
  let result;
  try {
    result = await moddle.fromXML(xml, 'bpmn:Definitions');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BpmnImportError('The file is not valid BPMN 2.0 XML.', message);
  }
  const definitions = result.rootElement;
  if (!is(definitions, 'bpmn:Definitions')) {
    throw new BpmnImportError('The XML root element is not <bpmn:definitions>.');
  }
  return {
    moddle,
    definitions,
    warnings: result.warnings.map((w) => w.message.split('\n')[0] ?? w.message),
  };
}

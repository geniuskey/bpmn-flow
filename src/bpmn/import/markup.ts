/**
 * XML content that bpmn-moddle drops while parsing and that the canonical
 * round-trip check therefore cannot see: comments and processing instructions
 * (other than the XML declaration). CDATA sections are skipped.
 */
export interface DroppedMarkup {
  comments: number;
  processingInstructions: number;
}

export function findDroppedMarkup(xml: string): DroppedMarkup {
  const text = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const comments = (text.match(/<!--/g) ?? []).length;
  const processingInstructions = (text.match(/<\?(?!xml[\s?])[^?]/g) ?? []).length;
  return { comments, processingInstructions };
}

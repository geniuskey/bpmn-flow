import { useMemo } from 'react';
import { analyze, type AnalysisResult } from '@/analysis/analyze';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';

/** Analysis of the open document, recomputed after every model change. */
export function useAnalysis(): AnalysisResult | null {
  const doc = useDocumentStore((s) => s.doc);
  const revision = useEditorStore((s) => s.snapshot.revision);
  return useMemo(
    () => (doc ? analyze(doc.definitions) : null),
    // `revision` invalidates the result: the moddle tree is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, revision],
  );
}

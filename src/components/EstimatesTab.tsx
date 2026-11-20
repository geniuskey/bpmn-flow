import { useMemo } from 'react';
import { estimate } from '@/analysis/estimates/estimate';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useMetadataStore } from '@/stores/metadataStore';
import { formatMinutes } from '@/lib/format';
import { Stat, StatList } from '@/components/ui/stat';

export function EstimatesTab() {
  const doc = useDocumentStore((s) => s.doc);
  const revision = useEditorStore((s) => s.snapshot.revision);
  const controller = useEditorStore((s) => s.controller);
  const byElement = useMetadataStore((s) => s.byElement);
  const result = useMemo(
    () => (doc ? estimate(doc.definitions, Object.values(byElement)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision tracks in-place model edits
    [doc, byElement, revision],
  );
  if (!result) return null;
  if (!result.hasData) {
    return (
      <div className="max-w-2xl space-y-2 p-3 text-muted-foreground">
        <p>
          No time or cost data yet. Select a step and fill in <strong>Analysis metadata</strong> in
          the properties panel (duration, waiting time, cost, frequency).
        </p>
        <p>The data stays in this browser (IndexedDB) and is not written into the BPMN file.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 p-3" data-testid="estimates">
      {result.processes.map((p) => (
        <div key={p.processId} className="space-y-2">
          <div className="font-medium">{p.processName || p.processId}</div>
          <StatList className="px-1">
            <Stat label="Elapsed — best case" value={formatMinutes(p.bestCaseMinutes)} />
            <Stat label="Elapsed — worst case" value={formatMinutes(p.worstCaseMinutes)} />
            <Stat label="Hands-on work (sum)" value={formatMinutes(p.totalWorkMinutes)} />
            <Stat label="Waiting (sum)" value={formatMinutes(p.totalWaitingMinutes)} />
            <Stat label="Cost (Σ cost × frequency)" value={p.totalCost.toLocaleString()} />
            <Stat
              label="Activities with duration"
              value={`${p.activities - p.missingDuration.length} / ${p.activities}`}
            />
          </StatList>
          {p.criticalPath.length > 1 && (
            <button
              className="text-left text-xs text-primary hover:underline"
              onClick={() => controller?.reveal(p.criticalPath)}
            >
              Show worst-case path ({p.criticalPath.length} elements)
            </button>
          )}
        </div>
      ))}
      {result.hotspots.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Longest waiting times (from your data)
          </div>
          <ul className="space-y-1">
            {result.hotspots.map((h) => (
              <li key={h.elementId}>
                <button
                  className="hover:underline"
                  onClick={() => controller?.reveal([h.elementId])}
                >
                  {h.name || h.elementId}: {formatMinutes(h.waitingMinutes)} waiting (
                  {Math.round(h.share * 100)}% of its elapsed time)
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Assumptions: elapsed time = duration + waiting per step; parallel branches overlap (the
        slowest branch counts); alternative paths give best/worst case; loops are counted once;
        missing durations count as 0. These are estimates from entered data, not measurements.
      </p>
    </div>
  );
}

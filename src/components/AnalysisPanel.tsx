import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Finding, Severity } from '@/analysis/analyze';
import { useAnalysis } from '@/app/useAnalysis';
import { humanizeType } from '@/bpmn/model/elements';
import type { CompatibilityIssue } from '@/bpmn/validation/compatibility';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore, type AnalysisTab } from '@/stores/uiStore';
import { EstimatesTab } from './EstimatesTab';

const SEVERITY = {
  error: { icon: XCircle, className: 'text-destructive', label: 'Errors' },
  warning: { icon: AlertTriangle, className: 'text-warning', label: 'Warnings' },
  info: { icon: Info, className: 'text-info', label: 'Info' },
};

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Overview() {
  const result = useAnalysis();
  const doc = useDocumentStore((s) => s.doc);
  const setTab = useUiStore((s) => s.setAnalysisTab);
  if (!result || !doc) return null;
  const { metrics, counts } = result;
  const validation = result.findings.filter(isValidation);
  return (
    <div className="space-y-3 p-3" data-testid="metrics">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
        <Tile label="Elements" value={metrics.totalElements} />
        <Tile label="Events" value={metrics.events} />
        <Tile label="Activities" value={metrics.activities} />
        <Tile label="Gateways" value={metrics.gateways} />
        <Tile label="Sequence flows" value={metrics.sequenceFlows} />
        <Tile label="Message flows" value={metrics.messageFlows} />
        <Tile label="Pools" value={metrics.pools} />
        <Tile label="Lanes" value={metrics.lanes} />
      </div>
      <div className="flex flex-wrap gap-2">
        <SummaryButton
          label="Validation"
          detail={validation.length ? `${validation.length} issue(s)` : 'valid'}
          tone={
            validation.some((f) => f.severity === 'error')
              ? 'error'
              : validation.length
                ? 'warning'
                : 'success'
          }
          onClick={() => setTab('validation')}
        />
        <SummaryButton
          label="Findings"
          detail={`${counts.warning} warning(s), ${counts.info} info`}
          tone={counts.warning ? 'warning' : 'success'}
          onClick={() => setTab('findings')}
        />
        <SummaryButton
          label="Compatibility"
          detail={doc.report.mode === 'editable' ? 'editable, lossless' : 'read-only'}
          tone={doc.report.mode === 'editable' ? 'success' : 'warning'}
          onClick={() => setTab('compatibility')}
        />
      </div>
    </div>
  );
}

function SummaryButton({
  label,
  detail,
  tone,
  onClick,
}: {
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'error';
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 hover:bg-accent"
      onClick={onClick}
    >
      <span className="font-medium">{label}</span>
      <Badge variant={tone}>{detail}</Badge>
    </button>
  );
}

function Metrics() {
  const result = useAnalysis();
  if (!result) return null;
  const { graph } = result;
  const tiles: [string, number, string][] = [
    ['Lane handoffs', graph.laneHandoffs, 'Sequence flows that cross from one lane to another'],
    ['Loops', graph.cycles, 'Cyclic paths (strongly connected components)'],
    [
      'Complexity',
      graph.cyclomaticComplexity,
      'Cyclomatic complexity: flows − nodes + 2 × processes',
    ],
    [
      'Split gateways',
      graph.gateways.filter((g) => g.outgoing > 1).length,
      'Gateways with more than one outgoing flow',
    ],
    [
      'Join gateways',
      graph.gateways.filter((g) => g.incoming > 1).length,
      'Gateways with more than one incoming flow',
    ],
  ];
  return (
    <div className="space-y-3 p-3" data-testid="graph-metrics">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
        {tiles.map(([label, value, hint]) => (
          <Tile key={label} label={label} value={value} hint={hint} />
        ))}
      </div>
      {graph.gateways.length > 0 && (
        <table className="w-full max-w-xl text-left">
          <caption className="pb-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Gateway branches
          </caption>
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Gateway</th>
              <th className="font-medium">Type</th>
              <th className="text-right font-medium">In</th>
              <th className="text-right font-medium">Out</th>
            </tr>
          </thead>
          <tbody>
            {graph.gateways.map((g) => (
              <GatewayRow key={g.id} {...g} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const isValidation = (f: Finding) => f.ruleId.startsWith('VAL-');

function GatewayRow({
  id,
  name,
  type,
  incoming,
  outgoing,
}: {
  id: string;
  name?: string;
  type: string;
  incoming: number;
  outgoing: number;
}) {
  const controller = useEditorStore((s) => s.controller);
  return (
    <tr
      className="cursor-default border-t hover:bg-accent"
      onClick={() => controller?.reveal([id])}
    >
      <td className="py-1">{name || <code className="font-mono text-xs">{id}</code>}</td>
      <td>{humanizeType(type)}</td>
      <td className="text-right tabular-nums">{incoming}</td>
      <td className="text-right tabular-nums">{outgoing}</td>
    </tr>
  );
}

function FindingRow({
  finding,
  active,
  onSelect,
}: {
  finding: Finding;
  active: boolean;
  onSelect: () => void;
}) {
  const { icon: Icon, className } = SEVERITY[finding.severity];
  return (
    <li>
      <button
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent',
          active && 'bg-accent',
        )}
        onClick={onSelect}
        data-rule={finding.ruleId}
      >
        <Icon className={cn('mt-0.5 size-4 shrink-0', className)} />
        <span className="min-w-0 flex-1">
          <span className="block">{finding.message}</span>
          <span className="block text-muted-foreground">{finding.recommendation}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {finding.ruleId} · {finding.elementIds.slice(0, 4).join(', ')}
            {finding.elementIds.length > 4 ? ', …' : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

function Findings({ select, testId }: { select: (f: Finding) => boolean; testId: string }) {
  const all = useAnalysis();
  const controller = useEditorStore((s) => s.controller);
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const [active, setActive] = useState<number | null>(null);
  if (!all) return null;
  const findings = all.findings.filter(select);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const result = { findings, counts, durationMs: all.durationMs };
  const list = findings.filter((f) => filter === 'all' || f.severity === filter);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
        {(['all', 'error', 'warning', 'info'] as const).map((s) => (
          <button
            key={s}
            className={cn(
              'h-6 rounded-md px-2 text-xs',
              filter === s
                ? 'bg-accent font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setFilter(s)}
          >
            {s === 'all'
              ? `All (${result.findings.length})`
              : `${SEVERITY[s].label} (${result.counts[s]})`}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          analyzed in {result.durationMs.toFixed(1)} ms
        </span>
      </div>
      {list.length === 0 ? (
        <p className="p-3 text-muted-foreground">
          No findings. The process structure looks consistent.
        </p>
      ) : (
        <ul className="divide-y" data-testid={testId}>
          {list.map((f, i) => (
            <FindingRow
              key={`${f.ruleId}:${f.elementIds.join(',')}:${i}`}
              finding={f}
              active={active === i}
              onSelect={() => {
                setActive(i);
                controller?.reveal(f.elementIds);
              }}
            />
          ))}
        </ul>
      )}
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        Static structure checks only — they point to candidates for review and do not predict
        execution time or bottlenecks.
      </p>
    </div>
  );
}

function IssueRow({ issue }: { issue: CompatibilityIssue }) {
  const controller = useEditorStore((s) => s.controller);
  const { icon: Icon, className } = SEVERITY[issue.severity];
  const target =
    issue.elementId && controller?.resolveIds([issue.elementId]).length
      ? issue.elementId
      : undefined;
  return (
    <li>
      <button
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2 text-left',
          target ? 'hover:bg-accent' : 'cursor-default',
        )}
        onClick={() => target && controller?.reveal([target])}
        disabled={!target}
      >
        <Icon className={cn('mt-0.5 size-4 shrink-0', className)} />
        <span className="min-w-0 flex-1">
          <span className="block">{issue.message}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {issue.code}
            {issue.elementId ? ` · ${issue.elementId}` : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

function Compatibility() {
  const doc = useDocumentStore((s) => s.doc);
  if (!doc) return null;
  const { report } = doc;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {report.mode === 'editable' ? (
          <Badge variant="success">Editable</Badge>
        ) : (
          <Badge variant="warning">Read-only</Badge>
        )}
        {report.exportAllowed ? (
          <Badge variant="success">Lossless export verified</Badge>
        ) : (
          <Badge variant="error">Export blocked — data would be lost</Badge>
        )}
      </div>
      {report.issues.length === 0 ? (
        <p className="p-3 text-muted-foreground">
          No compatibility issues. All elements are supported.
        </p>
      ) : (
        <ul className="divide-y" data-testid="compatibility-issues">
          {report.issues.map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </ul>
      )}
    </div>
  );
}

const TABS: { id: AnalysisTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'validation', label: 'Validation' },
  { id: 'findings', label: 'Findings' },
  { id: 'estimates', label: 'Estimates' },
  { id: 'compatibility', label: 'Compatibility' },
];

export function AnalysisPanel() {
  const tab = useUiStore((s) => s.analysisTab);
  const setTab = useUiStore((s) => s.setAnalysisTab);
  const result = useAnalysis();
  const issueCount = useDocumentStore(
    (s) => s.doc?.report.issues.filter((i) => i.severity !== 'info').length ?? 0,
  );
  const validation = result?.findings.filter(isValidation) ?? [];
  const graphProblems =
    result?.findings.filter((f) => !isValidation(f) && f.severity !== 'info') ?? [];
  return (
    <section
      aria-label="Analysis"
      className="flex h-full min-h-0 flex-col bg-card"
      data-testid="analysis-panel"
    >
      <div role="tablist" className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium',
              tab === t.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'validation' && validation.length > 0 && (
              <Badge variant={validation.some((f) => f.severity === 'error') ? 'error' : 'warning'}>
                {validation.length}
              </Badge>
            )}
            {t.id === 'findings' && graphProblems.length > 0 && (
              <Badge variant="warning">{graphProblems.length}</Badge>
            )}
            {t.id === 'compatibility' && issueCount > 0 && (
              <Badge variant="warning">{issueCount}</Badge>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && <Overview />}
        {tab === 'metrics' && <Metrics />}
        {tab === 'validation' && <Findings select={isValidation} testId="validation" />}
        {tab === 'findings' && <Findings select={(f) => !isValidation(f)} testId="findings" />}
        {tab === 'estimates' && <EstimatesTab />}
        {tab === 'compatibility' && <Compatibility />}
      </div>
    </section>
  );
}

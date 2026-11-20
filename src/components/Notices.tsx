import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useDocumentStore, type Notice } from '@/stores/documentStore';
import { useUiStore } from '@/stores/uiStore';

const ICON = { error: XCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 };
const COLOR = {
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
  success: 'text-success',
};

function NoticeItem({ notice }: { notice: Notice }) {
  const dismiss = useDocumentStore((s) => s.dismiss);
  const Icon = ICON[notice.kind];
  useEffect(() => {
    if (notice.kind === 'error') return;
    const t = setTimeout(() => dismiss(notice.id), notice.kind === 'success' ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-96 max-w-[calc(100vw-2rem)] gap-2.5 rounded-lg border bg-card p-3 shadow-lg"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', COLOR[notice.kind])} />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">{notice.title}</p>
        {notice.details?.map((d, i) => (
          <p key={i} className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
            {d}
          </p>
        ))}
      </div>
      <button
        className="h-fit rounded p-0.5 text-muted-foreground hover:bg-accent"
        aria-label="Dismiss"
        onClick={() => dismiss(notice.id)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Notices() {
  const notices = useDocumentStore((s) => s.notices);
  // Over the canvas, not the properties panel (its fields stay reachable).
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const inspectorWidth = useUiStore((s) => s.inspectorWidth);
  const right = inspectorOpen ? `calc(min(${inspectorWidth}px, 45vw) + 1rem)` : '1rem';
  return (
    <div
      className="pointer-events-none fixed bottom-4 z-50 flex flex-col items-end gap-2"
      style={{ right, maxWidth: `calc(100vw - ${right} - 1rem)` }}
    >
      {notices.map((n) => (
        <NoticeItem key={n.id} notice={n} />
      ))}
    </div>
  );
}

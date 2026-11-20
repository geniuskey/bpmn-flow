import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row of label/value pairs. Plain text rather than cards, so a block of
 * mostly-zero counts reads like a summary line instead of a dashboard.
 */
export function StatList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('flex flex-wrap items-stretch gap-x-6 gap-y-3', className)}>{children}</dl>
  );
}

export function Stat({
  label,
  value,
  hint,
  dim,
  divider,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Mute the value, e.g. for a zero count. */
  dim?: boolean;
  /** Start a new group: draws a rule on the left. */
  divider?: boolean;
}) {
  return (
    <div className={cn('min-w-0', divider && 'border-l pl-6')} title={hint}>
      <dt className="text-[11px] whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-base leading-tight font-semibold tabular-nums',
          dim && 'text-muted-foreground/60',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

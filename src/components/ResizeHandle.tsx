import { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Pointer-driven splitter. `onResize` receives the delta since drag start;
 * a double click calls `onReset` (back to the default size).
 */
export function ResizeHandle({
  direction,
  onResize,
  onReset,
  label,
}: {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number, start: boolean) => void;
  onReset?: () => void;
  label: string;
}) {
  const origin = useRef<number | null>(null);
  const horizontal = direction === 'horizontal';
  return (
    <div
      role="separator"
      aria-label={label}
      title={onReset ? `${label} (double-click to reset)` : undefined}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      className={cn(
        'group relative z-10 shrink-0 touch-none',
        horizontal ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize',
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = horizontal ? e.clientX : e.clientY;
        onResize(0, true);
      }}
      onPointerMove={(e) => {
        if (origin.current === null) return;
        onResize((horizontal ? e.clientX : e.clientY) - origin.current, false);
      }}
      onPointerUp={() => (origin.current = null)}
      onDoubleClick={onReset}
    >
      <div
        className={cn(
          'absolute bg-primary opacity-0 transition-opacity group-hover:opacity-60',
          horizontal
            ? 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2',
        )}
      />
    </div>
  );
}

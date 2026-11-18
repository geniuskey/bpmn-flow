import { cn } from '@/lib/utils';

export function Separator({
  vertical = false,
  className,
}: {
  vertical?: boolean;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(
        'shrink-0 bg-border',
        vertical ? 'mx-1 h-5 w-px' : 'my-1 h-px w-full',
        className,
      )}
    />
  );
}

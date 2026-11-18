// Adapted from shadcn/ui (MIT) — https://ui.shadcn.com
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-muted text-muted-foreground',
        error: 'border-destructive/30 bg-destructive/10 text-destructive',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        info: 'border-info/30 bg-info/10 text-info',
        success: 'border-success/30 bg-success/10 text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

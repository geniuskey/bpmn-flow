// Adapted from shadcn/ui (MIT) — https://ui.shadcn.com
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 cursor-default',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        outline: 'border bg-card hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        active: 'bg-accent text-accent-foreground ring-1 ring-border',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2 text-xs',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

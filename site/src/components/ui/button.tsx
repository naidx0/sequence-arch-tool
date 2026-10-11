import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        accent:
          'rounded-[var(--radius-pill)] bg-[color:var(--accent)] px-5 py-2.5 text-[15px] text-[color:var(--accent-ink)] hover:bg-[color:var(--accent-hover)]',
        dark: 'rounded-[var(--radius-pill)] bg-[color:var(--ink)] px-5 py-2.5 text-[15px] text-white hover:bg-black',
        ghost: 'rounded-sm px-1 py-1 text-[15px] text-[color:var(--accent)] hover:underline',
        outline:
          'rounded-[var(--radius-pill)] border border-[color:var(--hairline)] bg-transparent px-5 py-2.5 text-[15px] text-[color:var(--ink)] hover:bg-[color:var(--canvas-muted)]',
      },
      size: {
        default: '',
        sm: 'px-4 py-2 text-[14px]',
        lg: 'px-6 py-3 text-[17px]',
      },
    },
    defaultVariants: {
      variant: 'accent',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

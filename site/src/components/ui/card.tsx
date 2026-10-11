import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-[color:var(--hairline)] bg-white p-8 shadow-[0_2px_16px_rgba(0,0,0,0.04)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-[21px] font-semibold tracking-tight text-[color:var(--ink)]', className)} {...props} />
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-3 text-[17px] leading-snug text-[color:var(--ink-muted)]', className)} {...props} />;
}

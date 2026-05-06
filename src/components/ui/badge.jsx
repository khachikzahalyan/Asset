import { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

const VARIANTS = {
  default: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-input text-foreground',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  muted: 'bg-muted text-muted-foreground',
};

export const Badge = forwardRef(function Badge(
  { className, variant = 'default', ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
});

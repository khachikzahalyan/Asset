import { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

const VARIANTS = {
  default:
    'bg-primary text-primary-foreground shadow hover:bg-primary/90 focus-visible:ring-ring',
  destructive:
    'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive',
  outline:
    'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
  secondary:
    'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 focus-visible:ring-ring',
  ghost: 'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
  link: 'text-primary underline-offset-4 hover:underline focus-visible:ring-ring',
};

const SIZES = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3 text-sm',
  lg: 'h-11 rounded-md px-6 text-base',
  icon: 'h-10 w-10',
};

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:pointer-events-none disabled:opacity-50';

export const Button = forwardRef(function Button(
  { className, variant = 'default', size = 'default', type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    />
  );
});

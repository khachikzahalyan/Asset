import { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

const VARIANTS = {
  default: 'bg-background text-foreground',
  destructive:
    'border-destructive/50 text-destructive [&>svg]:text-destructive bg-destructive/5',
  success: 'border-emerald-500/40 text-emerald-700 [&>svg]:text-emerald-600 bg-emerald-50',
  info: 'border-sky-500/40 text-sky-800 [&>svg]:text-sky-600 bg-sky-50',
};

export const Alert = forwardRef(function Alert(
  { className, variant = 'default', role = 'alert', ...props },
  ref
) {
  return (
    <div
      ref={ref}
      role={role}
      className={cn(
        'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
});

export const AlertTitle = forwardRef(function AlertTitle({ className, ...props }, ref) {
  return (
    <h5
      ref={ref}
      className={cn('mb-1 font-medium leading-none tracking-tight', className)}
      {...props}
    />
  );
});

export const AlertDescription = forwardRef(function AlertDescription({ className, ...props }, ref) {
  return <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
});

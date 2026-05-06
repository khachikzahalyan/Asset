import { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

export const Table = forwardRef(function Table({ className, ...props }, ref) {
  return (
    <div className="w-full overflow-auto rounded-md border">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
});

export const TableHeader = forwardRef(function TableHeader({ className, ...props }, ref) {
  return <thead ref={ref} className={cn('[&_tr]:border-b bg-muted/40', className)} {...props} />;
});

export const TableBody = forwardRef(function TableBody({ className, ...props }, ref) {
  return (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  );
});

export const TableRow = forwardRef(function TableRow({ className, ...props }, ref) {
  return (
    <tr
      ref={ref}
      className={cn('border-b transition-colors hover:bg-muted/40', className)}
      {...props}
    />
  );
});

export const TableHead = forwardRef(function TableHead({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground',
        className
      )}
      {...props}
    />
  );
});

export const TableCell = forwardRef(function TableCell({ className, ...props }, ref) {
  return (
    <td ref={ref} className={cn('px-3 py-2.5 align-middle', className)} {...props} />
  );
});

import { cn } from '@/lib/utils.js';

export default function PageHeader({ title, description, actions, className }) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

import { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils.js';

const TabsContext = createContext(null);

export function Tabs({ defaultValue, value: valueProp, onValueChange, children, className }) {
  const [internal, setInternal] = useState(defaultValue);
  const value = valueProp ?? internal;
  const setValue = useCallback(
    (next) => {
      if (valueProp === undefined) setInternal(next);
      onValueChange?.(next);
    },
    [valueProp, onValueChange]
  );
  const groupId = useId();
  const ctx = useMemo(() => ({ value, setValue, groupId }), [value, setValue, groupId]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ value, className, children, ...props }) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabsTrigger must be used within <Tabs>');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`${ctx.groupId}-panel-${value}`}
      id={`${ctx.groupId}-tab-${value}`}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium',
        'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        active ? 'bg-background text-foreground shadow' : 'hover:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children, ...props }) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabsContent must be used within <Tabs>');
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.groupId}-panel-${value}`}
      aria-labelledby={`${ctx.groupId}-tab-${value}`}
      className={cn('mt-4 focus-visible:outline-none', className)}
      {...props}
    >
      {children}
    </div>
  );
}

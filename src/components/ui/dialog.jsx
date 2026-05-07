import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';

/**
 * Lightweight modal dialog. Native overlay (no Radix dependency).
 * Renders nothing when `open` is false.
 *
 * - Closes on Escape and on backdrop click.
 * - Focus is moved to the dialog on open; focus trap is intentionally
 *   minimal for MVP — the form's first input handles initial focus.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} [props.onClose]
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {string} [props.title]
 * @param {string} [props.description]
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 * @param {string} [props.closeLabel]
 */
export function Dialog({
  open,
  onClose,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
}) {
  const panelRef = useRef(null);
  const handleClose = onClose ?? (() => onOpenChange?.(false));

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  if (!open) return null;

  // If title/description/footer are passed as flat props (legacy API), render them directly.
  // When using sub-components, children contains DialogHeader / DialogFooter etc.
  const hasLegacyTitle = Boolean(title);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <button
        type="button"
        aria-label={closeLabel}
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full max-w-lg rounded-xl border bg-background p-6 shadow-xl outline-none'
        )}
      >
        {hasLegacyTitle ? (
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              aria-label={closeLabel}
              className="-mr-2 -mt-1 text-muted-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <div className="space-y-4">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components for Radix-style composition used by feature dialogs.
// These are lightweight wrappers — no extra logic, just semantic grouping.
// ---------------------------------------------------------------------------

/**
 * Inner panel that receives content. Used as the direct child of <Dialog>
 * when composing with sub-components.
 */
export function DialogContent({ children, className }) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

export function DialogHeader({ children, className }) {
  return <div className={cn('mb-4 space-y-1', className)}>{children}</div>;
}

export function DialogTitle({ children, className }) {
  return (
    <h2 id="dialog-title" className={cn('text-lg font-semibold tracking-tight', className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({ children, className }) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>
  );
}

export function DialogFooter({ children, className }) {
  return (
    <div className={cn('mt-6 flex justify-end gap-2', className)}>{children}</div>
  );
}

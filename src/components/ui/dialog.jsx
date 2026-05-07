import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';

/**
 * Lightweight modal dialog rendered via a portal.
 * Renders nothing when `open` is false.
 *
 * - Closes on Escape and on backdrop click.
 * - Focus is moved to the dialog on open.
 * - Adds aria-hidden to body siblings while open (matches Radix behavior,
 *   required for @testing-library/dom to scope queries to the modal).
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
  const containerRef = useRef(null);
  const handleClose = useCallback(
    () => (onClose ? onClose() : onOpenChange?.(false)),
    [onClose, onOpenChange]
  );

  // Create a dedicated DOM node for the portal
  useEffect(() => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    containerRef.current = el;
    return () => {
      document.body.removeChild(el);
      containerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    // defer focus so the portal node is rendered
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    };
  }, [open, handleClose]);

  // Hide background body children from AT/testing-library while open.
  useEffect(() => {
    if (!open) return undefined;
    const siblings = Array.from(document.body.children).filter(
      (el) => el !== containerRef.current
    );
    const hidden = [];
    siblings.forEach((el) => {
      if (!el.hasAttribute('aria-hidden')) {
        el.setAttribute('aria-hidden', 'true');
        hidden.push(el);
      }
    });
    return () => {
      hidden.forEach((el) => el.removeAttribute('aria-hidden'));
    };
  }, [open]);

  if (!containerRef.current) return null;
  if (!open) return null;

  const hasLegacyTitle = Boolean(title);

  const modal = (
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

  return createPortal(modal, containerRef.current);
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
    <h2 id="dialog-title" className={cn('text-lg font-semibold leading-none tracking-tight', className)}>
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

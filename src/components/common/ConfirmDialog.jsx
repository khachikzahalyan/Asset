import { useState } from 'react';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';

/**
 * Reusable confirmation modal for destructive (or otherwise irreversible)
 * actions.
 *
 * The component is i18n-agnostic: every visible string is supplied by the
 * caller via props. That keeps the component reusable across pages with
 * different translation namespaces (`categories`, `assets`, `branches`,
 * etc.) and avoids hard-wiring this primitive to one namespace.
 *
 * The confirm button manages its own busy state. While `onConfirm` is
 * resolving, both buttons are disabled and the confirm button renders a
 * spinner. If `onConfirm` throws (e.g. server-side `permission-denied` or
 * a referential-integrity error), the busy flag is cleared and the dialog
 * stays open so the caller's `actionError` alert can surface the message
 * — the caller decides when to close.
 *
 * Optionally renders an `errorMessage` inline above the action buttons,
 * inside the dialog panel. This matters because the dialog applies
 * `aria-hidden` to background body content while open — so a page-level
 * alert outside the dialog would be both invisible to AT and unreliable
 * for testing-library queries while the modal is mounted. Surfacing the
 * error inside the panel keeps it in the active accessibility scope.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose                     Called on cancel / Esc / backdrop / X.
 * @param {() => Promise<void> | void} props.onConfirm   May throw — the dialog stays open on throw.
 * @param {string} props.title
 * @param {string} props.description
 * @param {string} props.confirmLabel
 * @param {string} props.cancelLabel
 * @param {boolean} [props.destructive=false]            Use the `destructive` Button variant.
 * @param {string} [props.errorMessage]                  Inline error rendered inside the panel.
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  errorMessage = null,
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      // Swallow: the caller's onConfirm is expected to translate
      // the error into its own UI state (e.g. an actionError alert)
      // before re-throwing or — more commonly — instead of throwing.
      // We catch here to keep the click-handler promise resolved so
      // React does not surface an unhandled rejection.
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (busy) return; // ignore close attempts mid-confirm
    onClose?.();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size={14} />
                {confirmLabel}
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </>
      }
    >
      {errorMessage ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : (
        // No body — the description prop renders inside the Dialog header.
        <div aria-hidden="true" />
      )}
    </Dialog>
  );
}

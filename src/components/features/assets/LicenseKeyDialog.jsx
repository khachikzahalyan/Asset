// src/components/features/assets/LicenseKeyDialog.jsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useLicenseSecret } from '@/hooks/useLicenseSecret.js';
import { LicenseKeyField } from './LicenseKeyField.jsx';

/**
 * @param {Object} props
 * @param {string} props.assetId
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 */
export function LicenseKeyDialog({ assetId, open, onOpenChange }) {
  const { t } = useTranslation('licenses');
  const { getKey, setKey } = useLicenseSecret({ assetId });
  const [initial, setInitial] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!open) {
      setInitial(null);
      setPending(null);
      return;
    }
    let cancelled = false;
    getKey()
      .then((value) => {
        if (cancelled) return;
        setInitial(value ?? '');
        setPending(value ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setInitial('');
        setPending('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, getKey]);

  async function handleSave() {
    if (pending === null || pending === initial) {
      onOpenChange(false);
      return;
    }
    await setKey(pending);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manageKeyDialogTitle')}</DialogTitle>
        </DialogHeader>
        {initial !== null ? (
          <LicenseKeyField
            defaultValue={initial}
            onValueChange={(v) => setPending(v)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">…</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('manageKeyDialogCancel')}
          </Button>
          <Button onClick={handleSave}>{t('manageKeyDialogSave')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// src/components/features/assets/AssetCreatePreviewDialog.jsx
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-2 gap-2 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children ?? '—'}</span>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Object} props.preview
 * @param {() => void} props.onBack
 * @param {() => void} props.onConfirm
 * @param {(open: boolean) => void} props.onOpenChange
 */
export function AssetCreatePreviewDialog({ open, preview, onBack, onConfirm, onOpenChange }) {
  const { t } = useTranslation('assets');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('previewTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">{preview.composedTitle}</p>
          <Row label={t('previewInventoryCodeRow')}>
            {preview.inventoryCode ?? '—'}
          </Row>
          {preview.subtypeName ? (
            <Row label={t('previewSubtypeRow')}>{preview.subtypeName}</Row>
          ) : null}
          {preview.brandName ? (
            <Row label={t('previewBrandRow')}>{preview.brandName}</Row>
          ) : null}
          {preview.modelName ? (
            <Row label={t('previewModelRow')}>{preview.modelName}</Row>
          ) : null}
          {preview.licenseSummary ? (
            <>
              <Row label={t('previewLicenseTypeRow')}>
                {preview.licenseSummary.licenseTypeLabel}
              </Row>
              <Row label={t('previewSubscribedAtRow')}>
                {preview.licenseSummary.subscribedAtFormatted}
              </Row>
              <Row label={t('previewExpiresAtRow')}>
                {preview.licenseSummary.expiresAtFormatted}
              </Row>
              <Row label={t('previewLicenseKeyRow')}>
                {preview.licenseSummary.licenseKeySetLabel}
              </Row>
            </>
          ) : null}
          <Row label={t('previewHolderRow')}>{preview.holderSummary}</Row>
          <Row label={t('previewBranchRow')}>{preview.branchName}</Row>
          <Row label={t('previewConditionRow')}>{preview.conditionLabel}</Row>
          <Row label={t('previewWarrantyRow')}>{preview.warrantyWindow}</Row>
          <Row label={t('previewPurchasePriceRow')}>{preview.purchasePriceFormatted}</Row>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onBack}>
            {t('previewBackButton')}
          </Button>
          <Button onClick={onConfirm}>{t('previewCreateButton')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

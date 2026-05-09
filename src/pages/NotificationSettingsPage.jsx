import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useNotificationSettings } from '@/hooks/useNotificationSettings.js';
import { setNotificationSettings } from '@/infra/repositories/firestoreNotificationSettingsRepository.js';
import {
  validateNotificationSettingsInput,
  sanitizeNotificationSettingsInput,
} from '@/domain/notificationSettings.js';

/**
 * Notification settings page (Super Admin only) at /settings/notifications.
 *
 * Single editable field: licenseExpiryWarningDays.
 * Reads through useNotificationSettings hook.
 * Writes through setNotificationSettings repository function.
 */
export default function NotificationSettingsPage() {
  const { t } = useTranslation('settings');
  const { user, role } = useAuth();
  const { data, loading, error } = useNotificationSettings();

  const [days, setDays] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync form value from hook data once loaded
  useEffect(() => {
    if (!loading && data) {
      setDays(String(data.licenseExpiryWarningDays));
    }
  }, [loading, data]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFieldError(null);
    setSubmitError(null);
    setSaved(false);

    const input = { licenseExpiryWarningDays: days };
    const errs = validateNotificationSettingsInput(
      sanitizeNotificationSettingsInput(input)
    );

    if (Object.keys(errs).length > 0) {
      setFieldError(t(errs.licenseExpiryWarningDays));
      return;
    }

    if (!user) return;
    setSaving(true);
    try {
      await setNotificationSettings(
        sanitizeNotificationSettingsInput(input),
        { uid: user.uid, role }
      );
      setSaved(true);
    } catch (err) {
      setSubmitError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('notificationSettingsTitle')}
        description={t('notificationSettingsSubtitle')}
      />

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message ?? String(error)}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Spinner size={18} />
          <span className="text-sm">{t('loading', { ns: 'common' })}</span>
        </div>
      ) : null}

      {!loading ? (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} noValidate className="max-w-sm space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="license-expiry-days">
                  {t('licenseExpiryWarningDaysLabel')}
                </Label>
                <Input
                  id="license-expiry-days"
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                    setFieldError(null);
                    setSaved(false);
                  }}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={
                    fieldError
                      ? 'license-expiry-days-error'
                      : 'license-expiry-days-hint'
                  }
                />
                {fieldError ? (
                  <p
                    id="license-expiry-days-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {fieldError}
                  </p>
                ) : (
                  <p
                    id="license-expiry-days-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {t('licenseExpiryWarningDaysHint')}
                  </p>
                )}
              </div>

              {submitError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}

              {saved ? (
                <Alert role="status">
                  <AlertDescription>{t('savedSuccessfully', { defaultValue: 'Saved' })}</AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" disabled={saving}>
                {saving ? <Spinner size={16} className="mr-2" /> : null}
                {t('saveButton')}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

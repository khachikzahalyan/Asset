import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import HistoryTab from '@/components/features/audit/HistoryTab.jsx';
import i18n from '@/i18n/index.js';

// Drive HistoryTab via the hook mock, not Firestore.
const auditState = {
  data: [],
  loading: false,
  error: null,
};

vi.mock('@/hooks/useAuditLogs.js', () => ({
  useAuditLogs: () => auditState,
}));

function renderTab(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <HistoryTab entityType="employee" entityId="emp_42" {...props} />
    </I18nextProvider>
  );
}

beforeEach(async () => {
  auditState.data = [];
  auditState.loading = false;
  auditState.error = null;
  await i18n.changeLanguage('ru');
});

describe('HistoryTab', () => {
  it('shows the loading state while the hook is pending', () => {
    auditState.loading = true;
    renderTab();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows an alert with the error message when the hook errors out', () => {
    auditState.error = new Error('permission-denied');
    renderTab();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('permission-denied');
  });

  it('shows the empty placeholder when the hook returns no rows', () => {
    auditState.data = [];
    renderTab();
    expect(
      screen.getByText(i18n.t('common:audit.historyEmpty'))
    ).toBeInTheDocument();
  });

  it('renders one table row per audit entry with localized action label', () => {
    auditState.data = [
      {
        auditId: 'a1',
        entity: 'employee',
        entityId: 'emp_42',
        action: 'create',
        actorUid: 'u_1',
        actorRole: 'super_admin',
        before: null,
        after: { firstName: 'Andranik' },
        at: new Date('2026-01-15T10:30:00Z'),
      },
      {
        auditId: 'a2',
        entity: 'employee',
        entityId: 'emp_42',
        action: 'update',
        actorUid: 'u_2',
        actorRole: 'asset_admin',
        before: { firstName: 'Andranik' },
        after: { firstName: 'A.' },
        changedKeys: ['firstName'],
        at: new Date('2026-02-01T08:00:00Z'),
      },
      {
        auditId: 'a3',
        entity: 'employee',
        entityId: 'emp_42',
        action: 'deactivate',
        actorUid: 'u_3',
        actorRole: 'super_admin',
        before: { isActive: true },
        after: { isActive: false },
        changedKeys: ['isActive'],
        at: new Date('2026-03-01T12:00:00Z'),
      },
    ];

    renderTab();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // 1 header row + 2 data rows. The "create" row is intentionally hidden
    // here — it is presented as structured "Created at" / "Created by" rows
    // on the parent detail page's Details card, so listing it again would
    // duplicate that information.
    expect(rows).toHaveLength(3);

    // Action labels are pulled from the `common:audit.action*` keys.
    expect(
      screen.queryByText(i18n.t('common:audit.actionCreate'))
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('common:audit.actionUpdate'))
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('common:audit.actionDeactivate'))
    ).toBeInTheDocument();

    // Header columns rendered.
    expect(
      within(table).getByText(i18n.t('common:audit.at'))
    ).toBeInTheDocument();
    expect(
      within(table).getByText(i18n.t('common:audit.action'))
    ).toBeInTheDocument();
    expect(
      within(table).getByText(i18n.t('common:audit.changedFields'))
    ).toBeInTheDocument();
    expect(
      within(table).getByText(i18n.t('common:audit.actor'))
    ).toBeInTheDocument();

    // Changed-keys diff surface.
    expect(within(table).getByText('firstName')).toBeInTheDocument();
    expect(within(table).getByText('isActive')).toBeInTheDocument();

    // Actor role surfaces (fallback when display name absent).
    expect(within(table).getAllByText('super_admin').length).toBeGreaterThan(0);
    expect(within(table).getByText('asset_admin')).toBeInTheDocument();
  });

  it('falls back to the raw action token when no i18n key is registered', () => {
    auditState.data = [
      {
        auditId: 'a_phase2',
        entity: 'asset',
        entityId: 'a_1',
        action: 'phase2_repair_logged', // not in audit.* yet
        actorUid: 'u_1',
        actorRole: 'tech_admin',
        before: null,
        after: null,
        at: new Date('2026-04-01T00:00:00Z'),
      },
    ];

    renderTab({ entityType: 'asset', entityId: 'a_1' });
    expect(screen.getByText('phase2_repair_logged')).toBeInTheDocument();
  });
});

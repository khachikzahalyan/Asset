/**
 * EmployeeSelfServicePage — unit tests (Wave A, Fix 2).
 *
 * Covers all five render states:
 *   1. loading  — employee lookup or asset query in flight
 *   2. error    — any query fails
 *   3. notLinked — user authenticated but no employee record exists
 *   4. empty    — employee found, zero assigned assets
 *   5. data     — employee has assigned assets; table is rendered
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import EmployeeSelfServicePage from '@/pages/EmployeeSelfServicePage.jsx';

// ---------------------------------------------------------------------------
// Mutable hook states — mutated per test in beforeEach.
// ---------------------------------------------------------------------------

const authState = {
  user: { uid: 'u_emp1', email: 'alice@example.com', displayName: 'Alice' },
  role: 'employee',
  employeeId: 'e1',
  loading: false,
};
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

const currentEmployeeState = { data: null, loading: true, error: null };
vi.mock('@/hooks/useCurrentEmployee.js', () => ({
  useCurrentEmployee: () => currentEmployeeState,
}));

const assetsByEmployeeState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useAssetsByEmployee.js', () => ({
  useAssetsByEmployee: () => assetsByEmployeeState,
}));

// Reference-data hooks — stable across all tests.
vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => ({
    data: [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Sarq' },
        isActive: true,
      },
    ],
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useAssetStatuses.js', () => ({
  useAssetStatuses: () => ({
    data: [
      {
        statusId: 'in_use',
        name: { ru: 'В использовании', en: 'In Use', hy: 'Ogtag' },
        color: '#16a34a',
        isActive: true,
        isAssignable: true,
      },
    ],
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useModels.js', () => ({
  useModels: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => ({ data: [], all: [], loading: false, error: null }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <EmployeeSelfServicePage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  // Reset to safe defaults before each test.
  authState.user = { uid: 'u_emp1', email: 'alice@example.com', displayName: 'Alice' };
  authState.loading = false;

  currentEmployeeState.data = null;
  currentEmployeeState.loading = true;
  currentEmployeeState.error = null;

  assetsByEmployeeState.data = [];
  assetsByEmployeeState.loading = false;
  assetsByEmployeeState.error = null;

  await i18n.changeLanguage('ru');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeSelfServicePage — loading state', () => {
  it('shows a loading spinner while the employee record is being fetched', () => {
    currentEmployeeState.loading = true;
    currentEmployeeState.data = null;

    renderPage();

    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows a loading spinner while assets are being fetched (employee found)', () => {
    currentEmployeeState.loading = false;
    currentEmployeeState.data = { employeeId: 'e1', firstName: 'Alice', lastName: 'A', email: 'alice@example.com' };
    assetsByEmployeeState.loading = true;

    renderPage();

    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });
});

describe('EmployeeSelfServicePage — error state', () => {
  it('shows an error alert when the employee lookup fails', () => {
    currentEmployeeState.loading = false;
    currentEmployeeState.data = null;
    currentEmployeeState.error = new Error('permission-denied');

    renderPage();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('me:errorLoading'));
  });

  it('shows an error alert when the assets query fails', () => {
    currentEmployeeState.loading = false;
    currentEmployeeState.data = { employeeId: 'e1', firstName: 'Alice', lastName: 'A', email: 'alice@example.com' };
    assetsByEmployeeState.error = new Error('quota-exceeded');

    renderPage();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('me:errorLoading'));
  });
});

describe('EmployeeSelfServicePage — not linked state', () => {
  it('shows the not-linked message when no employee record is found', () => {
    currentEmployeeState.loading = false;
    currentEmployeeState.data = null;
    currentEmployeeState.error = null;

    renderPage();

    expect(screen.getByText(i18n.t('me:notLinkedToEmployee'))).toBeInTheDocument();
    // Must NOT show an error alert for this state — it is a normal data state.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('EmployeeSelfServicePage — empty state', () => {
  it('shows the no-assignments message when the employee has no assets', () => {
    currentEmployeeState.loading = false;
    currentEmployeeState.data = {
      employeeId: 'e1',
      firstName: 'Alice',
      lastName: 'A',
      email: 'alice@example.com',
    };
    assetsByEmployeeState.data = [];
    assetsByEmployeeState.loading = false;

    renderPage();

    expect(screen.getByText(i18n.t('me:noAssignments'))).toBeInTheDocument();
  });
});

describe('EmployeeSelfServicePage — data state', () => {
  const sampleAsset = {
    assetId: 'asset_1',
    inventoryCode: '400/1',
    categoryId: 'device',
    statusId: 'in_use',
    name: null,
    brandId: null,
    modelId: null,
    subtypeId: null,
    assignedTo: { kind: 'employee', id: 'e1' },
    updatedAt: null,
  };

  beforeEach(() => {
    currentEmployeeState.loading = false;
    currentEmployeeState.data = {
      employeeId: 'e1',
      firstName: 'Alice',
      lastName: 'A',
      email: 'alice@example.com',
    };
    assetsByEmployeeState.data = [sampleAsset];
    assetsByEmployeeState.loading = false;
  });

  it('renders the asset table with inventory code', () => {
    renderPage();
    expect(screen.getByText('400/1')).toBeInTheDocument();
  });

  it('renders the category column', () => {
    renderPage();
    // Category name in Russian for 'device' is 'Устройство'
    expect(screen.getByText('Устройство')).toBeInTheDocument();
  });

  it('renders a status badge for the assigned asset', () => {
    renderPage();
    // Status name for 'in_use' in Russian is 'В использовании'
    expect(screen.getByText('В использовании')).toBeInTheDocument();
  });

  it('renders the table header columns', () => {
    renderPage();
    // Column headers come from assets namespace (inventoryCode, name, category, status)
    // and colSince from me namespace.
    expect(screen.getByText(i18n.t('assets:inventoryCode'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('assets:category'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('assets:status'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('me:colSince'))).toBeInTheDocument();
  });

  it('does NOT show the not-linked or no-assignments message when data is present', () => {
    renderPage();
    expect(screen.queryByText(i18n.t('me:notLinkedToEmployee'))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t('me:noAssignments'))).not.toBeInTheDocument();
  });
});

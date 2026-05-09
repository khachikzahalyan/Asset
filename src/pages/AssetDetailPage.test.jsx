import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import AssetDetailPage from '@/pages/AssetDetailPage.jsx';

// --- Auth mock (default: super_admin) ------------------------------------------

const authState = {
  user: { uid: 'u_test' },
  role: 'super_admin',
  employeeId: null,
  loading: false,
  signOut: vi.fn(),
};
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

// --- Data hook mocks -----------------------------------------------------------

const assetState = { data: null, loading: false, error: null };
vi.mock('@/hooks/useAsset.js', () => ({
  useAsset: () => assetState,
}));

vi.mock('@/hooks/useAssets.js', () => ({
  useAssets: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => ({
    data: [
      {
        categoryId: 'license',
        name: { ru: 'Лицензия', en: 'License', hy: 'Լիcenzia' },
        isActive: true,
      },
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Sark' },
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
        statusId: 'warehouse',
        name: { ru: 'Склад', en: 'Warehouse', hy: 'Pahest' },
        colorHex: '#9CA3AF',
        isAssignable: false,
        isActive: true,
      },
    ],
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useBranches.js', () => ({
  useBranches: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useEmployees.js', () => ({
  useEmployees: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => ({ data: [], all: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useModels.js', () => ({
  useModels: () => ({ data: [], loading: false, error: null }),
}));

// --- Component stub mocks -----------------------------------------------------

vi.mock('@/components/features/assets/AssetFormDialog.jsx', () => ({
  default: () => null,
}));

vi.mock('@/components/features/assignments/AssignDialog.jsx', () => ({
  default: () => null,
}));

vi.mock('@/components/features/assignments/AssignmentHistoryList.jsx', () => ({
  default: () => null,
}));

vi.mock('@/components/features/audit/HistoryTab.jsx', () => ({
  default: () => null,
}));

// LicenseKeyDialog: stub to avoid useLicenseSecret / Firestore.
vi.mock('@/components/features/assets/LicenseKeyDialog.jsx', () => ({
  LicenseKeyDialog: ({ open }) =>
    open ? <div data-testid="license-key-dialog" /> : null,
}));

// LicenseExpiryBadge: stub to keep tests deterministic (no timer dependency).
vi.mock('@/components/features/assets/LicenseExpiryBadge.jsx', () => ({
  LicenseExpiryBadge: ({ expiresAt }) =>
    expiresAt ? <span data-testid="license-expiry-badge">{String(expiresAt)}</span> : null,
}));

// Block repository calls from render paths.
vi.mock('@/infra/repositories/firestoreAssetRepository.js', () => ({
  firestoreAssetRepository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock('@/infra/repositories/firestoreAssignmentEventRepository.js', () => ({
  firestoreAssignmentEventRepository: {
    create: vi.fn(),
  },
}));

// --- Helpers -------------------------------------------------------------------

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/assets/asset1']}>
        <Routes>
          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  assetState.data = null;
  assetState.loading = false;
  assetState.error = null;
  authState.role = 'super_admin';
  await i18n.changeLanguage('ru');
});

// --- Base tests ----------------------------------------------------------------

describe('AssetDetailPage', () => {
  it('shows loading spinner while asset is being fetched', () => {
    assetState.loading = true;
    renderPage();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows not-found state when asset is null after loading', () => {
    assetState.loading = false;
    assetState.data = null;
    renderPage();
    expect(screen.getByText(i18n.t('assets:notFound'))).toBeInTheDocument();
  });

  it('renders asset inventoryCode at least once in the page', () => {
    assetState.data = {
      assetId: 'asset1',
      inventoryCode: '400/1',
      categoryId: 'device',
      statusId: 'warehouse',
      condition: 'new',
      assignedTo: { kind: 'warehouse' },
    };
    renderPage();
    // inventoryCode appears in both the PageHeader description and the details field
    expect(screen.getAllByText('400/1').length).toBeGreaterThanOrEqual(1);
  });
});

// --- License-only UI tests -----------------------------------------------------

describe('AssetDetailPage — license-only UI', () => {
  const licenseAsset = {
    assetId: 'lic1',
    inventoryCode: '300/1',
    categoryId: 'license',
    statusId: 'warehouse',
    condition: 'new',
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    assignedTo: { kind: 'warehouse' },
  };

  it('renders LicenseExpiryBadge for a license asset with a future expiresAt', () => {
    assetState.data = licenseAsset;
    renderPage();
    expect(screen.getByTestId('license-expiry-badge')).toBeInTheDocument();
  });

  it('shows "Manage key" button for super_admin role', () => {
    authState.role = 'super_admin';
    assetState.data = licenseAsset;
    renderPage();
    expect(
      screen.getByRole('button', { name: i18n.t('licenses:manageKey') })
    ).toBeInTheDocument();
  });

  it('does NOT show "Manage key" button for asset_admin role', () => {
    authState.role = 'asset_admin';
    assetState.data = licenseAsset;
    renderPage();
    expect(
      screen.queryByRole('button', { name: i18n.t('licenses:manageKey') })
    ).not.toBeInTheDocument();
  });
});

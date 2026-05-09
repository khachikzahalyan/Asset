import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import AssetListPage from '@/pages/AssetListPage.jsx';

// --- Hook mocks ----------------------------------------------------------------

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_test' },
    role: 'super_admin',
    employeeId: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

const assetsState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useAssets.js', () => ({
  useAssets: () => assetsState,
}));

const categoriesState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => categoriesState,
}));

const statusesState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useAssetStatuses.js', () => ({
  useAssetStatuses: () => statusesState,
}));

const branchesState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useBranches.js', () => ({
  useBranches: () => branchesState,
}));

const employeesState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useEmployees.js', () => ({
  useEmployees: () => employeesState,
}));

const brandsState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => brandsState,
}));

const modelsState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useModels.js', () => ({
  useModels: () => modelsState,
}));

const subtypesState = { data: [], all: [], loading: false, error: null };
vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => subtypesState,
}));

// Block repository calls that should never be triggered from render paths.
vi.mock('@/infra/repositories/firestoreAssetRepository.js', () => ({
  firestoreAssetRepository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// AssetFormDialog + AssetImportDialog + AssetExportButton contain heavy deps;
// stub them so these tests remain focused on AssetListPage itself.
vi.mock('@/components/features/assets/AssetFormDialog.jsx', () => ({
  default: () => null,
}));
vi.mock('@/components/features/assets/AssetImportDialog.jsx', () => ({
  default: () => null,
}));
vi.mock('@/components/features/assets/AssetExportButton.jsx', () => ({
  default: () => null,
}));

// --- Helpers -------------------------------------------------------------------

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/assets']}>
        <AssetListPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  assetsState.data = [];
  assetsState.loading = false;
  assetsState.error = null;
  categoriesState.data = [];
  statusesState.data = [];
  branchesState.data = [];
  employeesState.data = [];
  brandsState.data = [];
  modelsState.data = [];
  subtypesState.all = [];
  subtypesState.data = [];
  await i18n.changeLanguage('ru');
});

// --- Tests ---------------------------------------------------------------------

describe('AssetListPage', () => {
  it('shows loading spinner while assets are being fetched', () => {
    assetsState.loading = true;
    renderPage();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows empty state when assets array is empty', () => {
    renderPage();
    expect(screen.getByText(i18n.t('assets:emptyState'))).toBeInTheDocument();
  });

  it('shows error alert when the hook reports an error', () => {
    assetsState.error = new Error('permission-denied');
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('permission-denied');
  });
});

describe('AssetListPage — composed title', () => {
  it('renders the composed title (subtype · brand · model) in the asset row', () => {
    brandsState.data = [{ brandId: 'b1', name: 'Apple' }];
    modelsState.data = [{ modelId: 'm1', brandId: 'b1', name: 'MacBook Pro' }];
    subtypesState.all = [
      {
        subtypeId: 's1',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութ' },
        isActive: true,
      },
    ];
    assetsState.data = [
      {
        assetId: 'asset1',
        inventoryCode: '400/1',
        categoryId: 'device',
        statusId: 'warehouse',
        brandId: 'b1',
        modelId: 'm1',
        subtypeId: 's1',
      },
    ];
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սарք' },
        isActive: true,
      },
    ];
    statusesState.data = [
      {
        statusId: 'warehouse',
        name: { ru: 'Склад', en: 'Warehouse', hy: 'Պахест' },
        colorHex: '#9CA3AF',
        isActive: true,
      },
    ];

    renderPage();

    // The composed title "Ноутбук · Apple · MacBook Pro" should appear in the row.
    expect(screen.getByText('Ноутбук · Apple · MacBook Pro')).toBeInTheDocument();
  });
});

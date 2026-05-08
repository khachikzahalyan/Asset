import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import SubtypeManagementPage from '@/pages/SubtypeManagementPage.jsx';
import { AssetSubtypeReferencedError } from '@/domain/assetSubtypes.js';
import i18n from '@/i18n/index.js';

// Stub auth — Super Admin (server-side rules also enforce; this is the UX layer).
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_super' },
    role: 'super_admin',
    employeeId: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

// Hoisted shared state for mock factories. vi.mock calls are hoisted to the top
// of the file before any module-level `const` runs, so anything referenced by a
// factory has to come from vi.hoisted().
const { categoriesState, subtypesState, repoMock, categoryRepoMock } = vi.hoisted(() => ({
  categoriesState: {
    data: [
      {
        categoryId: 'device',
        name: { ru: 'Техника', en: 'Device', hy: 'Տեխնիկա' },
        requiresMultilang: false,
        isActive: true,
      },
      {
        categoryId: 'license',
        name: { ru: 'Лицензии', en: 'License', hy: 'Լիցենզիա' },
        requiresMultilang: false,
        isActive: true,
      },
      {
        categoryId: 'furniture',
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        requiresMultilang: true,
        isActive: true,
      },
    ],
    loading: false,
    error: null,
  },
  subtypesState: {
    data: [],
    all: [],
    loading: false,
    error: null,
  },
  repoMock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  // Wave A.7: SubtypeManagementPage.handleSubmit calls
  // firestoreCategoryRepository.create() when the operator typed a brand-
  // new category name in the typeahead. Mocked here so the module import
  // doesn't pull in firebase, and so the new-category submit-shape test
  // can assert on the call.
  categoryRepoMock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => categoriesState,
}));

vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => subtypesState,
}));

vi.mock('@/infra/repositories/firestoreAssetSubtypeRepository.js', () => ({
  firestoreAssetSubtypeRepository: repoMock,
}));

vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: categoryRepoMock,
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/settings/asset-subtypes']}>
        <SubtypeManagementPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  subtypesState.all = [];
  subtypesState.data = [];
  subtypesState.loading = false;
  subtypesState.error = null;
  repoMock.create.mockClear();
  repoMock.update.mockClear();
  repoMock.setActive.mockClear();
  repoMock.delete.mockClear();
  repoMock.delete.mockResolvedValue(undefined);
  categoryRepoMock.create.mockClear();
  categoryRepoMock.create.mockResolvedValue(undefined);
});

describe('SubtypeManagementPage', () => {
  it('renders the page header with localized title and "Add category" button (Wave A.7)', () => {
    renderPage();
    expect(screen.getByText(i18n.t('assets:subtypeAdminTitle'))).toBeInTheDocument();
    // Wave A.7: the page-level create button now reads "Add category" so the
    // operator can both pick an existing category and create a brand-new one
    // inline through the typeahead inside SubtypeFormDialog.
    expect(
      screen.getByRole('button', { name: i18n.t('assets:addCategory') })
    ).toBeInTheDocument();
  });

  it('does NOT render the raw subtypeId mono line under each row name (Wave A.7)', () => {
    subtypesState.all = [
      {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1, 12, 0, 0)) },
      },
    ];
    subtypesState.data = subtypesState.all;
    renderPage();

    // The localized name still renders.
    expect(screen.getByText('Ноутбук')).toBeInTheDocument();
    // The raw doc id no longer appears anywhere in the table — internal
    // technical noise per the user's "зачем нам ID?" feedback.
    expect(screen.queryByText('device_laptop')).not.toBeInTheDocument();
  });

  it('groups subtypes by category and shows the empty-group label when a category has none', () => {
    subtypesState.all = [
      {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1, 12, 0, 0)) },
      },
      {
        subtypeId: 'license_os',
        categoryId: 'license',
        name: { ru: 'ОС', en: 'OS', hy: 'ՕՀ' },
        attachableTo: 'device-only',
        sortOrder: 2,
        isActive: false,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 7, 9, 30, 0)) },
      },
    ];
    subtypesState.data = subtypesState.all;

    renderPage();

    // Category-named card titles render via subtypeAdminGroupHeader.
    expect(screen.getByText('Техника')).toBeInTheDocument();
    expect(screen.getByText('Лицензии')).toBeInTheDocument();
    expect(screen.getByText('Мебель')).toBeInTheDocument();

    // Subtype rows
    expect(screen.getByText('Ноутбук')).toBeInTheDocument();
    expect(screen.getByText('ОС')).toBeInTheDocument();

    // Inactive license shows the deactivated status badge label.
    expect(
      screen.getAllByText(i18n.t('assets:subtypeAdminStatusInactive')).length
    ).toBeGreaterThan(0);

    // Furniture has no subtypes -> empty-group caption visible.
    expect(
      screen.getAllByText(i18n.t('assets:subtypeAdminEmptyGroup')).length
    ).toBeGreaterThan(0);
  });

  it('renders the createdAt column header (and not the sortOrder one) and formats createdAt as yyyy-mm-dd UTC', () => {
    subtypesState.all = [
      {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1, 12, 0, 0)) },
      },
    ];
    subtypesState.data = subtypesState.all;

    renderPage();

    // New createdAt column header rendered.
    expect(
      screen.getByText(i18n.t('assets:subtypeAdminColumnCreatedAt'))
    ).toBeInTheDocument();
    // Old sortOrder column header removed.
    expect(
      screen.queryByText(i18n.t('assets:subtypeAdminColumnSortOrder'))
    ).not.toBeInTheDocument();
    // Date rendered in yyyy-mm-dd UTC form (matches Excel-export's isoDateUTC).
    expect(screen.getByText('2026-05-01')).toBeInTheDocument();
  });

  it('shows the asset-only attachable label for OS license subtypes restricted to devices', () => {
    subtypesState.all = [
      {
        subtypeId: 'license_os',
        categoryId: 'license',
        name: { ru: 'ОС', en: 'OS', hy: 'ՕՀ' },
        attachableTo: ['asset'],
        sortOrder: 1,
        isActive: true,
      },
    ];
    subtypesState.data = subtypesState.all;

    renderPage();

    expect(
      screen.getByText(i18n.t('assets:assignmentKindAsset'))
    ).toBeInTheDocument();
  });

  it('opens the create dialog when "Add category" is clicked (Wave A.7)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:addCategory') })
    );

    expect(
      screen.getByText(i18n.t('assets:subtypeAdminDialogCreateTitle'))
    ).toBeInTheDocument();
  });

  it('toggles active state via the repository when Deactivate is clicked', async () => {
    subtypesState.all = [
      {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      },
    ];
    subtypesState.data = subtypesState.all;

    const user = userEvent.setup();
    renderPage();

    // Find the row with the active subtype, then its Deactivate button.
    const row = screen.getByText('Ноутбук').closest('tr');
    expect(row).toBeTruthy();
    const deactivate = within(row).getByRole('button', {
      name: i18n.t('assets:subtypeAdminDeactivate'),
    });
    await user.click(deactivate);

    expect(repoMock.setActive).toHaveBeenCalledTimes(1);
    const [id, nextActive, before, actor] = repoMock.setActive.mock.calls[0];
    expect(id).toBe('device_laptop');
    expect(nextActive).toBe(false);
    expect(before.subtypeId).toBe('device_laptop');
    expect(actor.uid).toBe('u_super');
    expect(actor.role).toBe('super_admin');
  });

  it('shows an error alert when the subtypes hook reports an error', () => {
    subtypesState.error = new Error('permission-denied');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('permission-denied');
  });

  it('clicking the Delete icon opens the confirm modal and confirming calls repository.delete', async () => {
    subtypesState.all = [
      {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      },
    ];
    subtypesState.data = subtypesState.all;

    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText('Ноутбук').closest('tr');
    expect(row).toBeTruthy();
    await user.click(
      within(row).getByRole('button', {
        name: i18n.t('assets:subtypeAdminDelete'),
      })
    );

    expect(
      await screen.findByText(i18n.t('assets:subtypeAdminConfirmDeleteTitle'))
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: i18n.t('assets:subtypeAdminConfirmDelete'),
      })
    );

    await waitFor(() => {
      expect(repoMock.delete).toHaveBeenCalledTimes(1);
    });
    const [id, before, actor] = repoMock.delete.mock.calls[0];
    expect(id).toBe('device_laptop');
    expect(before.subtypeId).toBe('device_laptop');
    expect(actor.uid).toBe('u_super');
    expect(actor.role).toBe('super_admin');
  });

  it('shows the referenced-by-assets error when subtype delete is blocked', async () => {
    subtypesState.all = [
      {
        subtypeId: 'device_laptop',
        categoryId: 'device',
        name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
        attachableTo: null,
        sortOrder: 1,
        isActive: true,
      },
    ];
    subtypesState.data = subtypesState.all;
    repoMock.delete.mockRejectedValueOnce(
      new AssetSubtypeReferencedError('device_laptop', { assetCount: 5 })
    );
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText('Ноутбук').closest('tr');
    await user.click(
      within(row).getByRole('button', {
        name: i18n.t('assets:subtypeAdminDelete'),
      })
    );
    await user.click(
      await screen.findByRole('button', {
        name: i18n.t('assets:subtypeAdminConfirmDelete'),
      })
    );

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      const text = alerts.map((a) => a.textContent).join(' ');
      expect(text).toMatch(/5/);
    });
    expect(
      screen.getByText(i18n.t('assets:subtypeAdminConfirmDeleteTitle'))
    ).toBeInTheDocument();
  });
});

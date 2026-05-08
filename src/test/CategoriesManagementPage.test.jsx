import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import CategoriesManagementPage from '@/pages/CategoriesManagementPage.jsx';
import { CategoryReferencedError } from '@/domain/categories.js';
import i18n from '@/i18n/index.js';

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_super' },
    role: 'super_admin',
    employeeId: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

const { categoriesState, repoMock } = vi.hoisted(() => ({
  categoriesState: {
    data: [],
    loading: false,
    error: null,
  },
  repoMock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue('newcat'),
    update: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => categoriesState,
}));

vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: repoMock,
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/settings/categories']}>
        <CategoriesManagementPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  categoriesState.data = [];
  categoriesState.loading = false;
  categoriesState.error = null;
  repoMock.create.mockClear();
  repoMock.create.mockResolvedValue('newcat');
  repoMock.update.mockClear();
  repoMock.setActive.mockClear();
  repoMock.delete.mockClear();
  repoMock.delete.mockResolvedValue(undefined);
});

describe('CategoriesManagementPage', () => {
  it('renders the title and Add button', () => {
    renderPage();
    expect(screen.getByText(i18n.t('categories:title'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('categories:addCategory') })
    ).toBeInTheDocument();
  });

  it('renders rows with name, prefix, multilang, status, and createdAt columns', () => {
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1)) },
      },
      {
        categoryId: 'furniture',
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        inventoryCodePrefix: '500',
        requiresMultilang: true,
        isActive: false,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 7)) },
      },
    ];
    renderPage();

    // Headers — colCreatedAt is required (sortOrder is gone in Wave A.5).
    expect(
      screen.getByText(i18n.t('categories:colCreatedAt'))
    ).toBeInTheDocument();
    // Name renders via localize() — RU is the test locale.
    expect(screen.getByText('Устройство')).toBeInTheDocument();
    expect(screen.getByText('Мебель')).toBeInTheDocument();
    // Prefix renders verbatim.
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    // createdAt formatted as yyyy-mm-dd UTC.
    expect(screen.getByText('2026-05-01')).toBeInTheDocument();
    expect(screen.getByText('2026-05-07')).toBeInTheDocument();
  });

  it('opens the create dialog when Add is clicked, and submits to repository.create', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:addCategory') })
    );

    expect(
      screen.getByText(i18n.t('categories:dialogCreateTitle'))
    ).toBeInTheDocument();

    // Fill out the multi-lang form (default).
    await user.type(screen.getByLabelText(/RU/i), 'Server Rack');
    await user.type(screen.getByLabelText(/EN/i), 'Server Rack');
    await user.type(screen.getByLabelText(/HY/i), 'Server Rack');
    await user.type(
      screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
      '700'
    );
    await user.click(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch'))
    );

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:save') })
    );

    await waitFor(() => {
      expect(repoMock.create).toHaveBeenCalledTimes(1);
    });
    const [input, actor, options] = repoMock.create.mock.calls[0];
    expect(input.name).toEqual({
      ru: 'Server Rack',
      en: 'Server Rack',
      hy: 'Server Rack',
    });
    expect(input.inventoryCodePrefix).toBe('700');
    expect(input.requiresMultilang).toBe(true);
    expect(actor.uid).toBe('u_super');
    expect(actor.role).toBe('super_admin');
    expect(options.id).toBe('server_rack');
  });

  it('appends a numeric suffix to the derived id when the chosen slug is already taken', async () => {
    categoriesState.data = [
      {
        categoryId: 'server_rack',
        name: { ru: 'Server Rack', en: 'Server Rack', hy: 'Server Rack' },
        inventoryCodePrefix: '700',
        requiresMultilang: false,
        isActive: true,
      },
    ];
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:addCategory') })
    );

    await user.type(screen.getByLabelText(/RU/i), 'Server Rack');
    await user.type(screen.getByLabelText(/EN/i), 'Server Rack');
    await user.type(screen.getByLabelText(/HY/i), 'Server Rack');
    await user.type(
      screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
      '701'
    );
    await user.click(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch'))
    );

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:save') })
    );

    await waitFor(() => {
      expect(repoMock.create).toHaveBeenCalledTimes(1);
    });
    const options = repoMock.create.mock.calls[0][2];
    expect(options.id).toBe('server_rack_2');
  });

  it('clicking Deactivate calls repository.setActive(false, ...)', async () => {
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1)) },
      },
    ];
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText('Устройство').closest('tr');
    expect(row).toBeTruthy();
    const deactivate = within(row).getByRole('button', {
      name: i18n.t('categories:deactivate'),
    });
    await user.click(deactivate);

    expect(repoMock.setActive).toHaveBeenCalledTimes(1);
    const [id, nextActive, before, actor] = repoMock.setActive.mock.calls[0];
    expect(id).toBe('device');
    expect(nextActive).toBe(false);
    expect(before.categoryId).toBe('device');
    expect(actor.uid).toBe('u_super');
  });

  it('shows an error alert when the categories hook reports an error', () => {
    categoriesState.error = new Error('permission-denied');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('permission-denied');
  });

  it('clicking the Delete icon opens the confirm modal with the localized title and body', async () => {
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1)) },
      },
    ];
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText('Устройство').closest('tr');
    expect(row).toBeTruthy();
    const deleteBtn = within(row).getByRole('button', {
      name: i18n.t('categories:actionDelete'),
    });
    await user.click(deleteBtn);

    expect(
      await screen.findByText(i18n.t('categories:confirmDeleteTitleCategory'))
    ).toBeInTheDocument();
    // Description includes the localized category name. The name also
    // appears in the underlying table row, so we expect ≥ 2 occurrences.
    expect(screen.getAllByText(/Устройство/).length).toBeGreaterThanOrEqual(2);
  });

  it('confirming the delete dialog calls repository.delete and closes the modal', async () => {
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1)) },
      },
    ];
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText('Устройство').closest('tr');
    await user.click(
      within(row).getByRole('button', {
        name: i18n.t('categories:actionDelete'),
      })
    );

    const confirmBtn = await screen.findByRole('button', {
      name: i18n.t('categories:confirmDelete'),
    });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(repoMock.delete).toHaveBeenCalledTimes(1);
    });
    const [id, before, actor] = repoMock.delete.mock.calls[0];
    expect(id).toBe('device');
    expect(before.categoryId).toBe('device');
    expect(actor.uid).toBe('u_super');
    expect(actor.role).toBe('super_admin');

    // Modal closes on success — title disappears.
    await waitFor(() => {
      expect(
        screen.queryByText(i18n.t('categories:confirmDeleteTitleCategory'))
      ).not.toBeInTheDocument();
    });
  });

  it('shows the referenced-by-other-records error when delete is blocked', async () => {
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1)) },
      },
    ];
    repoMock.delete.mockRejectedValueOnce(
      new CategoryReferencedError('device', { assetCount: 3 })
    );
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText('Устройство').closest('tr');
    await user.click(
      within(row).getByRole('button', {
        name: i18n.t('categories:actionDelete'),
      })
    );
    await user.click(
      await screen.findByRole('button', {
        name: i18n.t('categories:confirmDelete'),
      })
    );

    // The page-level alert surfaces the localized referenced-by message.
    // Sub-types now cascade-delete with their parent category, so the
    // message only carries the asset count.
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/3/);
    });
    // Modal stays open so the operator can dismiss explicitly.
    expect(
      screen.getByText(i18n.t('categories:confirmDeleteTitleCategory'))
    ).toBeInTheDocument();
  });

  it('does NOT render the raw categoryId mono line under each row name (Wave A.7)', () => {
    categoriesState.data = [
      {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 1)) },
      },
      {
        categoryId: 'furniture',
        name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
        inventoryCodePrefix: '500',
        requiresMultilang: true,
        isActive: false,
        createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 7)) },
      },
    ];
    renderPage();

    // Localized names are still displayed.
    expect(screen.getByText('Устройство')).toBeInTheDocument();
    expect(screen.getByText('Мебель')).toBeInTheDocument();
    // The raw slug ids must no longer surface as a separate text node
    // beneath the localized name (the mono ".text-xs.font-mono" line is gone).
    expect(screen.queryByText('device')).not.toBeInTheDocument();
    expect(screen.queryByText('furniture')).not.toBeInTheDocument();
  });
});

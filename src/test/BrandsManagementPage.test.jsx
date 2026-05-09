import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import BrandsManagementPage from '@/pages/BrandsManagementPage.jsx';
import i18n from '@/i18n/index.js';

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_super' },
    role: 'super_admin',
    loading: false,
    signOut: vi.fn(),
  }),
}));

const { brandsState, createBrandMock, updateBrandMock, setBrandActiveMock } =
  vi.hoisted(() => ({
    brandsState: { data: [], loading: false, error: null },
    createBrandMock: vi.fn().mockResolvedValue('hp'),
    updateBrandMock: vi.fn().mockResolvedValue(undefined),
    setBrandActiveMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => brandsState,
}));

vi.mock('@/infra/repositories/firestoreBrandRepository.js', () => ({
  createBrand: createBrandMock,
  updateBrand: updateBrandMock,
  setBrandActive: setBrandActiveMock,
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/settings/brands']}>
        <BrandsManagementPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  brandsState.data = [];
  brandsState.loading = false;
  brandsState.error = null;
  createBrandMock.mockClear();
  createBrandMock.mockResolvedValue('hp');
  updateBrandMock.mockClear();
  setBrandActiveMock.mockClear();
});

describe('BrandsManagementPage', () => {
  it('renders the title and Add button', () => {
    renderPage();
    expect(screen.getByText(i18n.t('brands:title'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('brands:addBrand') })
    ).toBeInTheDocument();
  });

  it('renders empty state when no brands', () => {
    renderPage();
    expect(
      screen.getByText(i18n.t('brands:emptyState'))
    ).toBeInTheDocument();
  });

  it('renders brand rows with name and status', () => {
    brandsState.data = [
      { brandId: 'hp', name: 'HP', isActive: true },
      { brandId: 'lenovo', name: 'Lenovo', isActive: false },
    ];
    renderPage();
    expect(screen.getByText('HP')).toBeInTheDocument();
    expect(screen.getByText('Lenovo')).toBeInTheDocument();
    expect(
      screen.getAllByText(i18n.t('brands:statusActive'))
    ).toHaveLength(1);
    expect(
      screen.getAllByText(i18n.t('brands:statusInactive'))
    ).toHaveLength(1);
  });

  it('opens create dialog on Add click and submits', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:addBrand') })
    );

    const nameInput = screen.getByLabelText(i18n.t('brands:fieldName'));
    await user.type(nameInput, 'HP');

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:save') })
    );

    await waitFor(() => expect(createBrandMock).toHaveBeenCalledTimes(1));
    const [input] = createBrandMock.mock.calls[0];
    expect(input.name).toBe('HP');
    expect(input.isActive).toBe(true);
  });

  it('opens edit dialog prefilled and calls updateBrand', async () => {
    brandsState.data = [{ brandId: 'hp', name: 'HP', isActive: true }];
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:editBrand') })
    );

    const nameInput = screen.getByLabelText(i18n.t('brands:fieldName'));
    expect(nameInput).toHaveValue('HP');

    await user.clear(nameInput);
    await user.type(nameInput, 'HP Inc.');

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:save') })
    );

    await waitFor(() => expect(updateBrandMock).toHaveBeenCalledTimes(1));
    const [id, input] = updateBrandMock.mock.calls[0];
    expect(id).toBe('hp');
    expect(input.name).toBe('HP Inc.');
  });

  it('calls setBrandActive when toggling active state', async () => {
    brandsState.data = [{ brandId: 'hp', name: 'HP', isActive: true }];
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:deactivate') })
    );

    await waitFor(() => expect(setBrandActiveMock).toHaveBeenCalledTimes(1));
    const [id, isActive] = setBrandActiveMock.mock.calls[0];
    expect(id).toBe('hp');
    expect(isActive).toBe(false);
  });

  it('shows loading state', () => {
    brandsState.loading = true;
    renderPage();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows error from hook', () => {
    brandsState.error = new Error('fetch failed');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('fetch failed');
  });
});

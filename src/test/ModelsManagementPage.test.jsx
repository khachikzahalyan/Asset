import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import ModelsManagementPage from '@/pages/ModelsManagementPage.jsx';
import i18n from '@/i18n/index.js';

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_super' },
    role: 'super_admin',
    loading: false,
    signOut: vi.fn(),
  }),
}));

const { brandsState, modelsState, createModelMock, updateModelMock, setModelActiveMock } =
  vi.hoisted(() => ({
    brandsState: {
      data: [
        { brandId: 'hp', name: 'HP', isActive: true },
        { brandId: 'lenovo', name: 'Lenovo', isActive: true },
      ],
      loading: false,
      error: null,
    },
    modelsState: { data: [], loading: false, error: null },
    createModelMock: vi.fn().mockResolvedValue('hp_elitebook'),
    updateModelMock: vi.fn().mockResolvedValue(undefined),
    setModelActiveMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => brandsState,
}));

vi.mock('@/hooks/useModels.js', () => ({
  useModels: () => modelsState,
}));

vi.mock('@/infra/repositories/firestoreModelRepository.js', () => ({
  createModel: createModelMock,
  updateModel: updateModelMock,
  setModelActive: setModelActiveMock,
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/settings/models']}>
        <ModelsManagementPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
  modelsState.data = [];
  modelsState.loading = false;
  modelsState.error = null;
  createModelMock.mockClear();
  createModelMock.mockResolvedValue('hp_elitebook');
  updateModelMock.mockClear();
  setModelActiveMock.mockClear();
});

describe('ModelsManagementPage', () => {
  it('renders the title and Add button', () => {
    renderPage();
    expect(screen.getByText(i18n.t('models:title'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('models:addModel') })
    ).toBeInTheDocument();
  });

  it('renders empty state when no models', () => {
    renderPage();
    expect(
      screen.getByText(i18n.t('models:emptyState'))
    ).toBeInTheDocument();
  });

  it('renders brand filter select', () => {
    renderPage();
    expect(
      screen.getByLabelText(i18n.t('models:filterByBrand'))
    ).toBeInTheDocument();
  });

  it('renders model rows with brand, name, status', () => {
    modelsState.data = [
      { modelId: 'hp_elitebook', brandId: 'hp', name: 'EliteBook 840', isActive: true },
      { modelId: 'lenovo_thinkpad', brandId: 'lenovo', name: 'ThinkPad X1', isActive: false },
    ];
    renderPage();
    expect(screen.getByText('EliteBook 840')).toBeInTheDocument();
    expect(screen.getByText('ThinkPad X1')).toBeInTheDocument();
    // Brand names appear in both the filter <select> options and the table cells
    expect(screen.getAllByText('HP').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Lenovo').length).toBeGreaterThanOrEqual(1);
  });

  it('opens create dialog on Add click and submits', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('models:addModel') })
    );

    // Dialog is portal-mounted; query within the dialog form
    const form = document.querySelector('form');
    const dialog = within(form);

    // The dialog renders the brand combobox for create mode
    const brandSelect = dialog.getByRole('combobox');
    await user.selectOptions(brandSelect, 'hp');

    await user.type(
      dialog.getByLabelText(i18n.t('models:fieldName')),
      'ProBook 450'
    );

    await user.click(
      dialog.getByRole('button', { name: i18n.t('models:save') })
    );

    await waitFor(() => expect(createModelMock).toHaveBeenCalledTimes(1));
    const [input] = createModelMock.mock.calls[0];
    expect(input.brandId).toBe('hp');
    expect(input.name).toBe('ProBook 450');
  });

  it('opens edit dialog and calls updateModel', async () => {
    modelsState.data = [
      { modelId: 'hp_elitebook', brandId: 'hp', name: 'EliteBook 840', isActive: true },
    ];
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('models:editModel') })
    );

    const nameInput = screen.getByLabelText(i18n.t('models:fieldName'));
    expect(nameInput).toHaveValue('EliteBook 840');

    await user.clear(nameInput);
    await user.type(nameInput, 'EliteBook 850');

    await user.click(
      screen.getByRole('button', { name: i18n.t('models:save') })
    );

    await waitFor(() => expect(updateModelMock).toHaveBeenCalledTimes(1));
    const [id, input] = updateModelMock.mock.calls[0];
    expect(id).toBe('hp_elitebook');
    expect(input.name).toBe('EliteBook 850');
  });

  it('calls setModelActive when toggling active state', async () => {
    modelsState.data = [
      { modelId: 'hp_elitebook', brandId: 'hp', name: 'EliteBook 840', isActive: true },
    ];
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: i18n.t('models:deactivate') })
    );

    await waitFor(() => expect(setModelActiveMock).toHaveBeenCalledTimes(1));
    const [id, isActive] = setModelActiveMock.mock.calls[0];
    expect(id).toBe('hp_elitebook');
    expect(isActive).toBe(false);
  });

  it('shows loading state', () => {
    modelsState.loading = true;
    renderPage();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows error from hook', () => {
    modelsState.error = new Error('fetch failed');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('fetch failed');
  });
});

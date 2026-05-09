import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import ModelFormDialog from '@/components/features/models/ModelFormDialog.jsx';
import i18n from '@/i18n/index.js';

const BRANDS = [
  { brandId: 'hp', name: 'HP', isActive: true },
  { brandId: 'lenovo', name: 'Lenovo', isActive: true },
];

function renderDialog(props = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    model: null,
    brands: BRANDS,
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <ModelFormDialog {...defaults} {...props} />
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
});

describe('ModelFormDialog', () => {
  it('renders the create-mode title', () => {
    renderDialog();
    expect(screen.getByText(i18n.t('models:addModel'))).toBeInTheDocument();
  });

  it('renders the edit-mode title and prefills name', () => {
    renderDialog({
      model: { modelId: 'hp_elitebook', brandId: 'hp', name: 'EliteBook 840', isActive: true },
    });
    expect(screen.getByText(i18n.t('models:editModel'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('models:fieldName'))).toHaveValue('EliteBook 840');
  });

  it('shows brand select in create mode, static text in edit mode', () => {
    const { rerender } = renderDialog();
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <ModelFormDialog
          open={true}
          onClose={vi.fn()}
          brands={BRANDS}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          model={{ modelId: 'hp_elitebook', brandId: 'hp', name: 'EliteBook 840', isActive: true }}
        />
      </I18nextProvider>
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('HP')).toBeInTheDocument();
  });

  it('shows isActive checkbox only in edit mode', () => {
    const { rerender } = renderDialog();
    expect(
      screen.queryByLabelText(i18n.t('models:fieldIsActive'))
    ).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <ModelFormDialog
          open={true}
          onClose={vi.fn()}
          brands={BRANDS}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          model={{ modelId: 'hp_elitebook', brandId: 'hp', name: 'EliteBook 840', isActive: true }}
        />
      </I18nextProvider>
    );
    expect(
      screen.getByLabelText(i18n.t('models:fieldIsActive'))
    ).toBeInTheDocument();
  });

  it('blocks submit when name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    // Pick a brand
    await user.selectOptions(screen.getByRole('combobox'), 'hp');

    await user.click(
      screen.getByRole('button', { name: i18n.t('models:save') })
    );

    expect(onSubmit).not.toHaveBeenCalled();
    // The name error alert should appear
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('blocks submit when no brand is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(
      screen.getByLabelText(i18n.t('models:fieldName')),
      'EliteBook'
    );
    await user.click(
      screen.getByRole('button', { name: i18n.t('models:save') })
    );

    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('emits sanitized payload on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.selectOptions(screen.getByRole('combobox'), 'hp');
    await user.type(
      screen.getByLabelText(i18n.t('models:fieldName')),
      '  EliteBook 840  '
    );
    await user.click(
      screen.getByRole('button', { name: i18n.t('models:save') })
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload] = onSubmit.mock.calls[0];
    expect(payload.brandId).toBe('hp');
    expect(payload.name).toBe('EliteBook 840');
    expect(payload.isActive).toBe(true);
  });

  it('shows submit error from rejected onSubmit', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('conflict!'));
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.selectOptions(screen.getByRole('combobox'), 'lenovo');
    await user.type(
      screen.getByLabelText(i18n.t('models:fieldName')),
      'ThinkPad'
    );
    await user.click(
      screen.getByRole('button', { name: i18n.t('models:save') })
    );

    const alerts = await screen.findAllByRole('alert');
    const submitAlert = alerts.find((a) => a.textContent.includes('conflict!'));
    expect(submitAlert).toBeTruthy();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onClose });

    await user.click(
      screen.getByRole('button', { name: i18n.t('models:cancel') })
    );
    expect(onClose).toHaveBeenCalled();
  });
});

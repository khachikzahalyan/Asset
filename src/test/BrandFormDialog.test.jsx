import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import BrandFormDialog from '@/components/features/brands/BrandFormDialog.jsx';
import i18n from '@/i18n/index.js';

function renderDialog(props = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    brand: null,
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <BrandFormDialog {...defaults} {...props} />
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
});

describe('BrandFormDialog', () => {
  it('renders the create-mode title', () => {
    renderDialog();
    expect(screen.getByText(i18n.t('brands:addBrand'))).toBeInTheDocument();
  });

  it('renders the edit-mode title and prefills name', () => {
    renderDialog({
      brand: { brandId: 'hp', name: 'HP', isActive: true },
    });
    expect(screen.getByText(i18n.t('brands:editBrand'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('brands:fieldName'))).toHaveValue('HP');
  });

  it('shows isActive checkbox only in edit mode', () => {
    const { rerender } = renderDialog();
    expect(
      screen.queryByLabelText(i18n.t('brands:fieldIsActive'))
    ).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <BrandFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          brand={{ brandId: 'hp', name: 'HP', isActive: true }}
        />
      </I18nextProvider>
    );
    expect(
      screen.getByLabelText(i18n.t('brands:fieldIsActive'))
    ).toBeInTheDocument();
  });

  it('blocks submit when name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:save') })
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('emits sanitized payload on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(
      screen.getByLabelText(i18n.t('brands:fieldName')),
      '  HP  '
    );
    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:save') })
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload] = onSubmit.mock.calls[0];
    expect(payload.name).toBe('HP');
    expect(payload.isActive).toBe(true);
  });

  it('shows submit error from rejected onSubmit', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('conflict!'));
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(
      screen.getByLabelText(i18n.t('brands:fieldName')),
      'HP'
    );
    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:save') })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('conflict!');
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onClose });

    await user.click(
      screen.getByRole('button', { name: i18n.t('brands:cancel') })
    );
    expect(onClose).toHaveBeenCalled();
  });
});

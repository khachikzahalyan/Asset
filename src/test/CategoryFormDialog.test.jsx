import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import CategoryFormDialog from '@/components/features/categories/CategoryFormDialog.jsx';
import i18n from '@/i18n/index.js';

function renderDialog(props = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    category: null,
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <CategoryFormDialog {...defaults} {...props} />
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
});

describe('CategoryFormDialog', () => {
  it('renders the create-mode title and does NOT render the derived id field (Wave A.7)', () => {
    renderDialog();
    expect(
      screen.getByText(i18n.t('categories:dialogCreateTitle'))
    ).toBeInTheDocument();
    // Wave A.7: derived id is internal-only; no read-only display field.
    expect(
      screen.queryByLabelText(i18n.t('categories:fieldDerivedId'))
    ).not.toBeInTheDocument();
  });

  it('shows MultiLangInput when requiresMultilang is checked', async () => {
    const user = userEvent.setup();
    renderDialog();

    // requiresMultilang defaults to true -> MultiLangInput renders
    // 3 inputs (one per locale).
    const ru = screen.getByLabelText(/RU/i);
    const en = screen.getByLabelText(/EN/i);
    const hy = screen.getByLabelText(/HY/i);
    expect(ru).toBeInTheDocument();
    expect(en).toBeInTheDocument();
    expect(hy).toBeInTheDocument();

    // Untoggle requiresMultilang -> single Input replaces the 3-locale group.
    const toggle = screen.getByLabelText(i18n.t('categories:fieldRequiresMultilang'));
    await user.click(toggle);

    expect(screen.queryByLabelText(/EN/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/HY/i)).not.toBeInTheDocument();
    // The single name input remains.
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    expect(nameInput).toBeTruthy();
  });

  it('shows isActive checkbox only in edit mode', () => {
    const { rerender } = renderDialog();
    expect(
      screen.queryByLabelText(i18n.t('categories:fieldIsActive'))
    ).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <CategoryFormDialog
          open={true}
          onClose={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          category={{
            categoryId: 'device',
            name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
            inventoryCodePrefix: '400',
            requiresMultilang: false,
            isActive: true,
          }}
        />
      </I18nextProvider>
    );

    expect(
      screen.getByLabelText(i18n.t('categories:fieldIsActive'))
    ).toBeInTheDocument();
  });

  it('submits sanitized input with derived id on create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    // Switch off requiresMultilang to simplify the test.
    await user.click(
      screen.getByLabelText(i18n.t('categories:fieldRequiresMultilang'))
    );

    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    await user.type(nameInput, 'Consumables');

    await user.type(
      screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
      '600'
    );

    // attachableTo is now mandatory — pick at least one holder kind.
    await user.click(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch'))
    );
    await user.click(
      screen.getByLabelText(i18n.t('assets:assignmentKindWarehouse'))
    );

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:save') })
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [sanitized, opts] = onSubmit.mock.calls[0];
    expect(sanitized.name.ru).toBe('Consumables');
    expect(sanitized.name.en).toBe('Consumables');
    expect(sanitized.name.hy).toBe('Consumables');
    expect(sanitized.inventoryCodePrefix).toBe('600');
    expect(sanitized.requiresMultilang).toBe(false);
    expect(sanitized.attachableTo).toEqual(['warehouse', 'branch']);
    expect(opts.id).toBe('consumables');
  });

  it('blocks submit when no attachableTo kind is picked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(screen.getByLabelText(/RU/i), 'Тест');
    await user.type(screen.getByLabelText(/EN/i), 'Test');
    await user.type(screen.getByLabelText(/HY/i), 'Թեստ');
    await user.type(
      screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
      '700'
    );

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:save') })
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(i18n.t('categories:errorAttachableEmpty'))
    ).toBeInTheDocument();
  });

  it('pre-fills attachableTo from category.attachableTo in edit mode', () => {
    renderDialog({
      category: {
        categoryId: 'device',
        name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
        inventoryCodePrefix: '400',
        requiresMultilang: true,
        attachableTo: ['branch', 'employee'],
        isActive: true,
      },
    });
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch')).checked
    ).toBe(true);
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindEmployee')).checked
    ).toBe(true);
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindWarehouse')).checked
    ).toBe(false);
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindAsset')).checked
    ).toBe(false);
  });

  it('shows an error when prefix has invalid format', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Fill RU name (multi-lang form by default).
    await user.type(screen.getByLabelText(/RU/i), 'Тест');
    // Invalid prefix (lowercase + slash).
    await user.type(
      screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
      'ab/'
    );

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:save') })
    );

    // Sanitizer uppercases; "AB/" still violates ^[A-Z0-9]+$.
    expect(
      screen.getByText(i18n.t('categories:errorPrefixFormat'))
    ).toBeInTheDocument();
  });

  it('renders the edit-mode title and does NOT render the derived id field (Wave A.7)', () => {
    renderDialog({
      category: {
        categoryId: 'device',
        name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
        inventoryCodePrefix: '400',
        requiresMultilang: false,
        isActive: true,
      },
    });
    expect(
      screen.getByText(i18n.t('categories:dialogEditTitle'))
    ).toBeInTheDocument();
    // Wave A.7: the read-only derived-id field is gone. The slug is still
    // computed internally and exposed via data-derived-id for devtools only.
    expect(
      screen.queryByLabelText(i18n.t('categories:fieldDerivedId'))
    ).not.toBeInTheDocument();
    // Dialog portals into a body-appended <div>, so query against the
    // document — not the renderer's container root.
    const form = document.querySelector('form[data-derived-id]');
    expect(form).toBeTruthy();
    expect(form.getAttribute('data-derived-id')).toBe('device');
  });

  it('shows the id-conflict error when the parent rejects with CategoryIdConflictError', async () => {
    const { CategoryIdConflictError } = await import('@/domain/categories.js');
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new CategoryIdConflictError('device'));
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    // Fill name + prefix
    await user.type(screen.getByLabelText(/RU/i), 'Устройство');
    await user.type(screen.getByLabelText(/EN/i), 'Device');
    await user.type(screen.getByLabelText(/HY/i), 'Սարք');
    await user.type(
      screen.getByLabelText(i18n.t('categories:inventoryCodePrefix')),
      '400'
    );
    await user.click(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch'))
    );

    await user.click(
      screen.getByRole('button', { name: i18n.t('categories:save') })
    );

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(i18n.t('categories:errorIdConflict')))
      .toBeInTheDocument();
  });
});

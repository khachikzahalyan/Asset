import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import SubtypeFormDialog from '@/components/features/assets/SubtypeFormDialog.jsx';
import i18n from '@/i18n/index.js';

const CATEGORIES = [
  {
    categoryId: 'device',
    name: { ru: 'Техника', en: 'Device', hy: 'Տեխնիկա' },
    inventoryCodePrefix: '400',
    requiresMultilang: false,
    attachableTo: ['branch', 'warehouse', 'employee', 'department'],
    isActive: true,
  },
  {
    categoryId: 'license',
    name: { ru: 'Лицензии', en: 'License', hy: 'Լիցենզիա' },
    inventoryCodePrefix: '300',
    requiresMultilang: false,
    attachableTo: ['asset', 'employee'],
    isActive: true,
  },
  {
    categoryId: 'furniture',
    name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
    inventoryCodePrefix: '500',
    requiresMultilang: true,
    attachableTo: ['branch', 'warehouse', 'employee', 'department'],
    isActive: true,
  },
];

async function pickAttachableKind(user, kind) {
  const labelKey = `assets:assignmentKind${kind.charAt(0).toUpperCase() + kind.slice(1)}`;
  await user.click(screen.getByLabelText(i18n.t(labelKey)));
}

function renderDialog(props = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    subtype: null,
    categories: CATEGORIES,
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <SubtypeFormDialog {...defaults} {...props} />
    </I18nextProvider>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('ru');
});

// Wave A.7: the category field is a typeahead <input>, not a <select>.
// Tests below pick categories by typing the localized name (RU is the
// active locale in beforeEach) — same UX an operator would get.
function getCategoryInput() {
  return screen.getByLabelText(i18n.t('assets:subtypeAdminFieldCategory'));
}

async function pickCategoryByName(user, name) {
  const input = getCategoryInput();
  await user.clear(input);
  await user.type(input, name);
  return input;
}

describe('SubtypeFormDialog', () => {
  it('shows the create-mode title and an empty category typeahead by default (Wave A.7)', () => {
    renderDialog();
    expect(
      screen.getByText(i18n.t('assets:subtypeAdminDialogCreateTitle'))
    ).toBeInTheDocument();
    // Typeahead replaces the <select>; it starts empty.
    expect(getCategoryInput()).toHaveValue('');
  });

  it('does NOT render the read-only derivedId display field (Wave A.7)', () => {
    renderDialog();
    // The derivedId UI was removed per "зачем нам ID?" feedback.
    expect(
      screen.queryByLabelText(i18n.t('assets:subtypeAdminFieldId'))
    ).not.toBeInTheDocument();
  });

  it('does NOT render the sortOrder field (removed in Wave A.5)', () => {
    renderDialog();
    expect(
      screen.queryByLabelText(i18n.t('assets:subtypeAdminFieldSortOrder'))
    ).not.toBeInTheDocument();
  });

  it('typing a category that matches an existing one resolves to it (no new-category fields)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategoryByName(user, 'Техника');

    // No prefix input — that field is never shown in this dialog (Wave A.8).
    expect(
      screen.queryByLabelText(i18n.t('categories:inventoryCodePrefix'))
    ).not.toBeInTheDocument();
    // No new-category multilang toggle either (also gone in Wave A.8).
    expect(
      screen.queryByLabelText(i18n.t('categories:fieldRequiresMultilang'))
    ).not.toBeInTheDocument();
    // Hint says "Using existing category".
    expect(
      screen.getByText(
        i18n.t('assets:subtypeAdminCategoryHintExisting', { name: 'Техника' })
      )
    ).toBeInTheDocument();
  });

  it('typing a brand-new category name does NOT reveal a prefix input or multilang toggle (Wave A.8 trim)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategoryByName(user, 'Transport');

    // Wave A.8: dialog is for catalog CRUD; inventory codes are generated
    // by tech_admin/asset_admin during asset creation. No prefix input here.
    expect(
      screen.queryByLabelText(i18n.t('categories:inventoryCodePrefix'))
    ).not.toBeInTheDocument();
    // Multilang toggle is gone — multilang editing lives on /settings/categories.
    expect(
      screen.queryByLabelText(i18n.t('categories:fieldRequiresMultilang'))
    ).not.toBeInTheDocument();
    // The "new category will be created" hint still appears.
    expect(
      screen.getByText(
        i18n.t('assets:subtypeAdminCategoryHintNew', { name: 'Transport' })
      )
    ).toBeInTheDocument();
  });

  it('auto-fills a numeric sortOrder on create payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const before = Date.now();
    renderDialog({ onSubmit });

    await pickCategoryByName(user, 'Техника');
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    await user.type(nameInput, 'Laptop');
    await pickAttachableKind(user, 'branch');

    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:subtypeAdminSave') })
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [sanitized] = onSubmit.mock.calls[0];
    expect(typeof sanitized.sortOrder).toBe('number');
    expect(Number.isInteger(sanitized.sortOrder)).toBe(true);
    expect(sanitized.sortOrder).toBeGreaterThanOrEqual(before);
  });

  it('preserves the existing sortOrder on edit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({
      onSubmit,
      subtype: {
        subtypeId: 'license_os',
        categoryId: 'license',
        name: { ru: 'ОС', en: 'OS', hy: 'ՕՀ' },
        requiresMultilang: false,
        attachableTo: ['asset'],
        sortOrder: 42,
        isActive: true,
      },
    });

    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:subtypeAdminSave') })
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [sanitized] = onSubmit.mock.calls[0];
    expect(sanitized.sortOrder).toBe(42);
  });

  it('renders a single input (not MultiLangInput) when the chosen category does not require multilang', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategoryByName(user, 'Техника');

    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    expect(nameInput).toBeTruthy();
  });

  it('renders the attachableTo fieldset constrained to the parent category for License', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategoryByName(user, 'Лицензии');

    // License parent allows ['asset', 'employee'] — only those two checkboxes appear.
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindAsset'))
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindEmployee'))
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(i18n.t('assets:assignmentKindBranch'))
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(i18n.t('assets:assignmentKindWarehouse'))
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(i18n.t('assets:assignmentKindDepartment'))
    ).not.toBeInTheDocument();
  });

  it('renders the attachableTo fieldset for non-License categories too (configurable per spec)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategoryByName(user, 'Техника');

    // Device parent allows the four physical-holder kinds — fieldset shows them all.
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch'))
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindWarehouse'))
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindEmployee'))
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindDepartment'))
    ).toBeInTheDocument();
    // Device cannot be attached to another asset — checkbox absent.
    expect(
      screen.queryByLabelText(i18n.t('assets:assignmentKindAsset'))
    ).not.toBeInTheDocument();
  });

  it('changing category prunes previously checked kinds that the new parent disallows', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategoryByName(user, 'Техника');
    await pickAttachableKind(user, 'branch');
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindBranch')).checked
    ).toBe(true);

    // Switch to License — branch is not allowed → must be pruned.
    await pickCategoryByName(user, 'Лицензии');
    expect(
      screen.queryByLabelText(i18n.t('assets:assignmentKindBranch'))
    ).not.toBeInTheDocument();
  });

  it('submits sanitized input and the slug-derived id when the form is valid (existing category)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await pickCategoryByName(user, 'Техника');
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    await user.type(nameInput, 'Laptop');
    await pickAttachableKind(user, 'branch');
    await pickAttachableKind(user, 'employee');

    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:subtypeAdminSave') })
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [sanitized, opts] = onSubmit.mock.calls[0];
    expect(sanitized.categoryId).toBe('device');
    expect(sanitized.name.ru).toBe('Laptop');
    expect(sanitized.name.en).toBe('Laptop');
    expect(sanitized.name.hy).toBe('Laptop');
    expect(sanitized.attachableTo).toEqual(['employee', 'branch']);
    expect(opts.id).toBe('device_laptop');
    // Existing-category mode: no newCategory payload returned to parent.
    expect(opts.newCategory).toBeFalsy();
  });

  it('submits in new-category mode with auto-derived prefix and forced single-lang (Wave A.8)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    // Type a brand-new category name. No prefix or multilang inputs are
    // rendered — operator only types the category name and the subtype name.
    await pickCategoryByName(user, 'Transport');
    expect(
      screen.queryByLabelText(i18n.t('categories:inventoryCodePrefix'))
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(i18n.t('categories:fieldRequiresMultilang'))
    ).not.toBeInTheDocument();

    // Fill the subtype name. In new-category mode the subtype's name field
    // renders as a single <Input name="name"> because the new category is
    // always created with requiresMultilang=false (Wave A.8).
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    expect(nameInput).toBeTruthy();
    await user.type(nameInput, 'Ford');
    await pickAttachableKind(user, 'branch');

    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:subtypeAdminSave') })
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [sanitized, opts] = onSubmit.mock.calls[0];
    // The subtype's categoryId points at the just-derived new category slug.
    expect(sanitized.categoryId).toBe('transport');
    expect(sanitized.name.ru).toBe('Ford');
    // opts carries both the subtype doc id AND the new-category payload.
    expect(opts.id).toBe('transport_ford');
    expect(opts.newCategory).toBeTruthy();
    expect(opts.newCategory.id).toBe('transport');
    // Wave A.8: prefix auto-derived from the typed name's slug, uppercased,
    // with `_` separators stripped — satisfies INVENTORY_PREFIX_REGEX = /^[A-Z0-9]+$/.
    expect(opts.newCategory.input.inventoryCodePrefix).toBe('TRANSPORT');
    // Wave A.8: new categories created from this dialog are always single-lang;
    // the typed query is mirrored across ru/en/hy by sanitizeCategoryInput().
    expect(opts.newCategory.input.requiresMultilang).toBe(false);
    expect(opts.newCategory.input.name.ru).toBe('Transport');
    expect(opts.newCategory.input.name.en).toBe('Transport');
    expect(opts.newCategory.input.name.hy).toBe('Transport');
  });

  it('rejects new-category names that produce an empty slug with a localized hint (Wave A.8)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    // All-Cyrillic name → slugify() yields empty → auto-prefix is empty.
    // Dialog must surface the new error key and NOT call onSubmit.
    await pickCategoryByName(user, 'Транспорт');
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    await user.type(nameInput, 'Ford');
    await pickAttachableKind(user, 'branch');

    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:subtypeAdminSave') })
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(i18n.t('assets:subtypeAdminCategoryNameNeedsAscii'))
    ).toBeInTheDocument();
  });

  it('renders the edit-mode title and shows category name as read-only text', () => {
    renderDialog({
      subtype: {
        subtypeId: 'license_os',
        categoryId: 'license',
        name: { ru: 'ОС', en: 'OS', hy: 'ՕՀ' },
        requiresMultilang: false,
        attachableTo: ['asset'],
        sortOrder: 5,
        isActive: true,
      },
    });

    expect(
      screen.getByText(i18n.t('assets:subtypeAdminDialogEditTitle'))
    ).toBeInTheDocument();
    // Edit mode renders the category as plain read-only text (no input box).
    const catReadonly = screen.getByTestId('subtype-category-readonly');
    expect(catReadonly).toHaveTextContent('Лицензии');
    expect(catReadonly.tagName).toBe('P');
    // attachableTo fieldset is constrained to the parent category set
    // (License = ['asset', 'employee']) and pre-checks the saved kinds.
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindAsset')).checked
    ).toBe(true);
    expect(
      screen.getByLabelText(i18n.t('assets:assignmentKindEmployee')).checked
    ).toBe(false);
  });

  it('hides the isActive checkbox in create mode and shows it in edit mode (Wave A.6)', () => {
    const { unmount } = renderDialog();
    expect(
      screen.queryByLabelText(i18n.t('assets:subtypeAdminFieldIsActive'))
    ).not.toBeInTheDocument();
    unmount();

    renderDialog({
      subtype: {
        subtypeId: 'license_os',
        categoryId: 'license',
        name: { ru: 'ОС', en: 'OS', hy: 'ՕՀ' },
        requiresMultilang: false,
        attachableTo: ['asset'],
        sortOrder: 5,
        isActive: true,
      },
    });
    expect(
      screen.getByLabelText(i18n.t('assets:subtypeAdminFieldIsActive'))
    ).toBeInTheDocument();
  });

  it('locks the category in the dialog title when defaultCategoryId is provided', () => {
    renderDialog({ defaultCategoryId: 'license' });
    // Locked-category mode: the typeahead is suppressed entirely (operator
    // cannot accidentally re-target the subtype to a different category)
    // and the category name is rendered in the dialog title instead.
    expect(
      screen.queryByLabelText(i18n.t('assets:subtypeAdminFieldCategory'))
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        i18n.t('assets:subtypeAdminDialogCreateInCategoryTitle', {
          name: 'Лицензии',
        })
      )
    ).toBeInTheDocument();
  });

  it('shows the id-conflict error when the parent rejects with AssetSubtypeIdConflictError', async () => {
    const { AssetSubtypeIdConflictError } = await import(
      '@/domain/assetSubtypes.js'
    );
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new AssetSubtypeIdConflictError('device_laptop'));
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await pickCategoryByName(user, 'Техника');
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(
      (el) => el.getAttribute('name') === 'name' && !el.readOnly
    );
    await user.type(nameInput, 'Laptop');
    await pickAttachableKind(user, 'branch');
    await user.click(
      screen.getByRole('button', { name: i18n.t('assets:subtypeAdminSave') })
    );

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(i18n.t('assets:subtypeAdminErrorIdConflict')))
      .toBeInTheDocument();
  });
});

// All `userEvent.setup({ delay: null })` calls in this file are deliberate:
// the Dialog component portals into a body-appended <div>, and userEvent's
// default 0-ms-but-still-async-via-setTimeout cadence races with React's
// batched state flush during portal re-renders. delay: null fires every
// event synchronously and eliminates the flake.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import AssetFormDialog from '@/components/features/assets/AssetFormDialog.jsx';
import {
  AssetInventoryCodeTakenError,
  AssetCounterMissingError,
  AssetCategoryInactiveError,
} from '@/domain/assets.js';

// --- Hook mocks --------------------------------------------------------------
//
// AssetFormDialog reads catalogs from useCategories + useAssetStatuses, and
// the holder selectors lazily mount BranchSelect / EmployeeSelect / DepartmentSelect.
// We stub the underlying hooks so tests can swap data via shared state without
// resetting module mocks per-case.

const categoriesState = {
  data: [
    {
      categoryId: 'cat_device',
      name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' },
      inventoryCodePrefix: '400',
      requiresMultilang: false,
      attachableTo: ['warehouse', 'employee', 'branch', 'department'],
      isActive: true,
    },
    {
      categoryId: 'cat_furniture',
      name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
      inventoryCodePrefix: '450',
      requiresMultilang: true,
      attachableTo: ['warehouse', 'employee', 'branch', 'department'],
      isActive: true,
    },
    {
      categoryId: 'license',
      name: { ru: 'Лицензия', en: 'License', hy: 'Լիցենզիա' },
      inventoryCodePrefix: '300',
      requiresMultilang: false,
      attachableTo: ['warehouse', 'asset', 'employee'],
      isActive: true,
    },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => categoriesState,
}));

const statusesState = {
  data: [
    {
      statusId: 'warehouse',
      name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' },
      colorHex: '#9CA3AF',
      isAssignable: false,
      isFinal: false,
      isSystem: true,
      isActive: true,
      sortOrder: 10,
    },
    {
      statusId: 'in_prep',
      name: { ru: 'Подготовка', en: 'In prep', hy: 'Նախ' },
      colorHex: '#F59E0B',
      isAssignable: false,
      isFinal: false,
      isSystem: true,
      isActive: true,
      sortOrder: 20,
    },
    {
      statusId: 'assigned',
      name: { ru: 'Выдан', en: 'Assigned', hy: 'Տրված' },
      colorHex: '#10B981',
      isAssignable: true,
      isFinal: false,
      isSystem: true,
      isActive: true,
      sortOrder: 30,
    },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useAssetStatuses.js', () => ({
  useAssetStatuses: () => statusesState,
}));

// BranchSelect dependency.
const branchesState = {
  data: [
    {
      branchId: 'b_main',
      name: { ru: 'Главный офис', en: 'HQ', hy: 'Գլխավոր' },
      type: 'warehouse',
      address: 'Yerevan',
      isActive: true,
      isPrimary: true,
    },
    {
      branchId: 'b_north',
      name: { ru: 'Северный', en: 'North', hy: 'Հյուսիս' },
      type: 'branch',
      address: 'Gyumri',
      isActive: true,
      isPrimary: false,
    },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useBranches.js', () => ({
  useBranches: () => branchesState,
}));

// EmployeeSelect dependency.
const employeesState = {
  data: [
    {
      employeeId: 'e_khach',
      firstName: 'Khach',
      lastName: 'Z',
      email: 'khach@example.com',
      branchId: 'b_main',
      isActive: true,
    },
    {
      employeeId: 'e_petr',
      firstName: 'Petr',
      lastName: 'Ivanov',
      email: 'petr@example.com',
      branchId: 'b_north',
      isActive: true,
    },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useEmployees.js', () => ({
  useEmployees: () => employeesState,
}));

// Wave-A: useAssetSubtypes drives the new sub-type select. The mock takes
// `{ categoryId }` and returns the catalog filtered to that category. We
// model two licenses with distinct `attachableTo` arrays to exercise the
// configurable-holder-kinds invariant.
const SUBTYPE_BASELINE = vi.hoisted(() => [
  {
    subtypeId: 'device_laptop',
    categoryId: 'cat_device',
    name: 'Laptop',
    requiresMultilang: false,
    attachableTo: [],
    sortOrder: 1,
    isActive: true,
  },
  {
    subtypeId: 'device_monitor',
    categoryId: 'cat_device',
    name: 'Monitor',
    requiresMultilang: false,
    attachableTo: [],
    sortOrder: 2,
    isActive: true,
  },
  {
    subtypeId: 'furniture_chair',
    categoryId: 'cat_furniture',
    name: { ru: 'Стул', en: 'Chair', hy: 'Աթոռ' },
    requiresMultilang: true,
    attachableTo: [],
    sortOrder: 1,
    isActive: true,
  },
  {
    subtypeId: 'license_os',
    categoryId: 'license',
    name: 'Operating System',
    requiresMultilang: false,
    attachableTo: ['asset'],
    sortOrder: 1,
    isActive: true,
  },
  {
    subtypeId: 'license_office_suite',
    categoryId: 'license',
    name: 'Office Suite',
    requiresMultilang: false,
    attachableTo: ['asset', 'employee'],
    sortOrder: 2,
    isActive: true,
  },
]);
const subtypeMocks = vi.hoisted(() => ({ all: [] }));

vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: ({ categoryId = null, includeInactive = false } = {}) => {
    let data = subtypeMocks.all;
    if (categoryId) data = data.filter((s) => s.categoryId === categoryId);
    if (!includeInactive) data = data.filter((s) => s.isActive !== false);
    return { data, all: subtypeMocks.all, loading: false, error: null };
  },
}));

// Wave A.6: AssetFormDialog now reads role from useAuth() to gate the
// inline "+ Новый подтип" trigger. Default to super_admin so existing
// tests continue to render the form without an AuthProvider; individual
// cases can override via authState.role.
const authState = vi.hoisted(() => ({
  user: { uid: 'u_super', email: 'admin@example.com' },
  role: 'super_admin',
}));
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

// Wave A.6: stub the firestore subtype repository — the inline-create
// flow calls `.create(input, actor, { id })`. Tests assert the call
// shape; the dialog's own behavior on resolve (auto-select the new
// subtypeId) is what matters here.
const subtypeRepoMock = vi.hoisted(() => ({
  create: vi.fn(),
}));
vi.mock('@/infra/repositories/firestoreAssetSubtypeRepository.js', () => ({
  firestoreAssetSubtypeRepository: subtypeRepoMock,
}));

// Wave A.7: AssetFormDialog.handleCreateSubtype now ALSO calls
// firestoreCategoryRepository.create when the operator typed a brand-new
// category in the SubtypeFormDialog typeahead. Mocked here so the import
// doesn't pull in firebase. The existing tests in this file always pre-
// pick an existing category (cat_device / license), so the new-category
// branch isn't exercised — but the mock has to exist regardless.
const categoryRepoMock = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
  update: vi.fn(),
  setActive: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: categoryRepoMock,
}));

// Wave-A: AssetSelect picker for the license-asset target. The
// component itself doesn't exist yet (Task 11) — provide a stub so the
// dialog renders deterministically in the meantime.
vi.mock('@/components/features/assets/AssetSelect.jsx', () => ({
  default: function AssetSelectStub({ value, onChange, placeholder }) {
    return (
      <select
        data-testid="asset-target-select"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="">{placeholder ?? 'Pick a device'}</option>
        <option value="asset_target">Target device 400/1</option>
      </select>
    );
  },
}));

// --- Helpers ------------------------------------------------------------------

function renderDialog(props = {}) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn(async () => {});
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <AssetFormDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        {...props}
      />
    </I18nextProvider>
  );
  return { ...utils, onOpenChange, onSubmit };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('ru');
  // Reset auth + repo mocks between cases — individual tests may flip role.
  authState.user = { uid: 'u_super', email: 'admin@example.com' };
  authState.role = 'super_admin';
  subtypeRepoMock.create.mockReset();
  subtypeRepoMock.create.mockResolvedValue('cat_device_tesla');
  // Refill subtype catalog from baseline so a test that pushes a new row
  // (Wave A.6 inline-create case) doesn't leak into the next test's
  // assertions about which subtype options exist.
  subtypeMocks.all.length = 0;
  for (const row of SUBTYPE_BASELINE) subtypeMocks.all.push({ ...row });
});

// Helper: BranchSelect (under warehouse / branch modes) and the radio
// "Филиал" share the same Russian label, so RTL's getByLabelText matches
// both. Look up the BranchSelect by its DOM id instead.
function getBranchSelect(id = 'asset-branch') {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

describe('AssetFormDialog', () => {
  it('renders in create mode with default Куда=СКЛАД and default status=warehouse', async () => {
    // T35: Group 3 (holder radios + status) is visible only after a category is picked.
    const user = userEvent.setup({ delay: null });
    renderDialog();

    // Title is "Add asset" (i18n key addAsset).
    expect(screen.getByText(i18n.t('assets:addAsset'))).toBeInTheDocument();

    // Pick a category to reveal Group 3.
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // Куда radio: СКЛАД is selected by default.
    const warehouseRadio = screen.getByRole('radio', {
      name: i18n.t('assets:holderWarehouse'),
    });
    expect(warehouseRadio).toBeChecked();

    // The other three are not.
    expect(
      screen.getByRole('radio', { name: i18n.t('assets:holderEmployee') })
    ).not.toBeChecked();
    expect(
      screen.getByRole('radio', { name: i18n.t('assets:holderBranch') })
    ).not.toBeChecked();
    expect(
      screen.getByRole('radio', { name: i18n.t('assets:holderDepartment') })
    ).not.toBeChecked();

    // Status select defaults to "warehouse" (DEFAULT_ASSET_STATUS_CODE).
    const statusSelect = screen.getByLabelText(i18n.t('assets:status'));
    expect(statusSelect).toHaveValue('warehouse');

    // Куда=СКЛАД shows BranchSelect.
    expect(getBranchSelect()).toBeInTheDocument();
  });

  it('shows Brand and Model dropdowns (not a name field) when the category is single-lang (T35)', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

    // Pick "Устройство" (requiresMultilang = false).
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // In the new form (T35), non-multilang categories show Brand + Model dropdowns
    // instead of a plain name input. The MultiLangInput is not rendered either.
    expect(screen.queryByPlaceholderText(/RU/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[name="name.ru"]')).not.toBeInTheDocument();

    // Brand and Model labels appear for device (non-multilang) category.
    expect(screen.getByLabelText(i18n.t('assets:brandLabel'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('assets:modelLabel'))).toBeInTheDocument();
  });

  it('switches name to MultiLangInput when a multi-lang category is picked (T35: requires subtype too)', async () => {
    // T35: Group 2 (Identifiers) is visible only when BOTH category and subtype are set.
    // The MultiLangInput appears there for multilang categories.
    const user = userEvent.setup({ delay: null });
    const { container } = renderDialog();

    // Pick "Мебель" (requiresMultilang = true).
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_furniture'
    );
    // Also pick a subtype to reveal Group 2.
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'furniture_chair'
    );

    // MultiLangInput renders three inputs named `name.ru`, `name.en`, `name.hy`.
    await waitFor(() => {
      // Search the full document — Dialog portals outside `container`.
      expect(document.querySelector('input[name="name.ru"]')).toBeInTheDocument();
      expect(document.querySelector('input[name="name.en"]')).toBeInTheDocument();
      expect(document.querySelector('input[name="name.hy"]')).toBeInTheDocument();
    });
    // There is no single-lang <input id="asset-name"> for multilang categories.
    expect(document.getElementById('asset-name')).toBeNull();
    // container is referenced to avoid an unused-binding lint warning if any
    // future change drops the destructure.
    void container;
  });

  it('shows Brand/Model dropdowns when the category changes from multi-lang to single-lang (T35)', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_furniture'
    );
    // Now switch back to a single-lang category.
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // In the new form (T35), switching to a non-multilang category shows
    // Brand + Model dropdowns (not a plain name input).
    expect(screen.getByLabelText(i18n.t('assets:brandLabel'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('assets:modelLabel'))).toBeInTheDocument();
    // MultiLangInput is gone.
    expect(document.querySelector('input[name="name.ru"]')).not.toBeInTheDocument();
  });

  it('Куда=СОТРУДНИК hides BranchSelect and shows EmployeeSelect', async () => {
    // T35: holder radios are in Group 3, visible only after a category is picked.
    const user = userEvent.setup({ delay: null });
    renderDialog();

    // Pick a category first to reveal Group 3.
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // Switch Куда → СОТРУДНИК.
    await user.click(
      screen.getByRole('radio', { name: i18n.t('assets:holderEmployee') })
    );

    // BranchSelect (the warehouse one) is gone.
    expect(document.getElementById('asset-branch')).toBeNull();

    // EmployeeSelect appears with id="asset-employee".
    const employeeSelect = document.getElementById('asset-employee');
    expect(employeeSelect).toBeInTheDocument();
    expect(employeeSelect.tagName).toBe('SELECT');

    // The two active employees are listed.
    const opts = within(employeeSelect).getAllByRole('option');
    const values = opts.map((o) => o.getAttribute('value'));
    expect(values).toContain('e_khach');
    expect(values).toContain('e_petr');
  });

  it('Куда=ОТДЕЛ shows DepartmentSelect with the empty-state helper text', async () => {
    // T35: holder radios are in Group 3, visible only after a category is picked.
    const user = userEvent.setup({ delay: null });
    renderDialog();

    // Pick a category first to reveal Group 3.
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    await user.click(
      screen.getByRole('radio', { name: i18n.t('assets:holderDepartment') })
    );

    // DepartmentSelect renders disabled with a placeholder option whose
    // text matches `assets:departmentsComingSoon`.
    expect(
      screen.getByText(i18n.t('assets:departmentsComingSoon'))
    ).toBeInTheDocument();

    // BranchSelect is gone (department mode never shows it).
    expect(document.getElementById('asset-branch')).toBeNull();
  });

  it('shows errorRequired for categoryId and subtypeId when both are blank on submit', async () => {
    // T35: clicking Save without a category produces errorRequired for
    // categoryId and subtypeId (two errors minimum).
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderDialog();

    // Click Save & add another without picking a category (create mode button).
    await user.click(screen.getByRole('button', { name: i18n.t('assets:saveAndAddAnother') }));

    const errors = await screen.findAllByText(i18n.t('assets:errorRequired'));
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Status filter — Куда=СКЛАД shows only isAssignable===false statuses', async () => {
    // T35: status select is in Group 3, only visible once a category is set.
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    const statusSelect = screen.getByLabelText(i18n.t('assets:status'));
    const opts = within(statusSelect).getAllByRole('option');
    const values = opts.map((o) => o.getAttribute('value'));
    // Warehouse + In prep are isAssignable=false; Assigned is isAssignable=true.
    expect(values).toContain('warehouse');
    expect(values).toContain('in_prep');
    expect(values).not.toContain('assigned');
  });

  it('Status filter — Куда=СОТРУДНИК shows only isAssignable===true statuses', async () => {
    // T35: need a category first, then switch to employee mode.
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    await user.click(
      screen.getByRole('radio', { name: i18n.t('assets:holderEmployee') })
    );

    const statusSelect = screen.getByLabelText(i18n.t('assets:status'));
    const opts = within(statusSelect).getAllByRole('option');
    const values = opts.map((o) => o.getAttribute('value'));
    expect(values).toContain('assigned');
    expect(values).not.toContain('warehouse');
    expect(values).not.toContain('in_prep');
  });

  it('Submit success calls onSubmit with sanitized payload and closes the dialog', async () => {
    // T35: for non-multilang categories (e.g. cat_device), the form no longer
    // shows a plain name input — brand + model replace it. Accordingly
    // sanitizeAssetInput returns name: null for such categories.
    // This test uses edit mode so the direct Save button is available.
    const user = userEvent.setup({ delay: null });
    const { onSubmit, onOpenChange } = renderDialog({
      asset: {
        assetId: 'a_test',
        categoryId: 'cat_device',
        subtypeId: 'device_laptop',
        name: null,
        brandId: null,
        modelId: null,
        serialNumber: null,
        statusId: 'warehouse',
        assignedTo: { kind: 'warehouse', id: null },
        branchId: null,
        notes: null,
        purchaseDate: null,
        purchasePrice: null,
        condition: 'new',
        warrantyStart: null,
        warrantyEnd: null,
        isActive: true,
      },
    });

    await user.selectOptions(getBranchSelect(), 'b_main');

    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [payload, opts] = onSubmit.mock.calls[0];
    // T35: name is null for non-multilang (device) categories — the composed
    // display title comes from brand + model + category at the view layer.
    expect(payload.categoryId).toBe('cat_device');
    expect(payload.name).toBeNull();
    // Default Куда=СКЛАД, branchId set, assignedTo.kind=warehouse.
    expect(payload.assignedTo).toEqual({ kind: 'warehouse', id: null });
    expect(payload.branchId).toBe('b_main');
    // Default status is "warehouse".
    expect(payload.statusId).toBe('warehouse');
    // The form passes the resolved category to the submit callback.
    expect(opts.category?.categoryId).toBe('cat_device');

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('surfaces errorInventoryCodeTaken when the repository throws AssetInventoryCodeTakenError', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn(async () => {
      throw new AssetInventoryCodeTakenError('400/5');
    });

    render(
      <I18nextProvider i18n={i18n}>
        <AssetFormDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />
      </I18nextProvider>
    );

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'device_laptop'
    );
    // T35: device category has no name field; select branch to satisfy validation.
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('assets:saveAndAddAnother') }));

    expect(
      await screen.findByText(i18n.t('assets:errorInventoryCodeTaken'))
    ).toBeInTheDocument();
  });

  it('surfaces errorCounterMissing when the repository throws AssetCounterMissingError', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn(async () => {
      throw new AssetCounterMissingError('cat_device');
    });

    render(
      <I18nextProvider i18n={i18n}>
        <AssetFormDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />
      </I18nextProvider>
    );

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'device_laptop'
    );
    // T35: device category has no name field; select branch to satisfy validation.
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('assets:saveAndAddAnother') }));

    expect(
      await screen.findByText(i18n.t('assets:errorCounterMissing'))
    ).toBeInTheDocument();
  });

  it('surfaces errorRequired on AssetCategoryInactiveError', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn(async () => {
      throw new AssetCategoryInactiveError('cat_device');
    });

    render(
      <I18nextProvider i18n={i18n}>
        <AssetFormDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />
      </I18nextProvider>
    );

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'device_laptop'
    );
    // T35: device category has no name field; select branch to satisfy validation.
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('assets:saveAndAddAnother') }));

    expect(
      await screen.findByText(i18n.t('assets:errorRequired'))
    ).toBeInTheDocument();
  });

  it('pre-fills the form fields from the asset prop in edit mode', () => {
    const asset = {
      assetId: 'a1',
      inventoryCode: '400/5',
      categoryId: 'cat_device',
      subtypeId: 'device_laptop',
      name: 'ThinkPad',
      brand: 'Lenovo',
      model: 'T14',
      serialNumber: 'ABC123',
      statusId: 'warehouse',
      assignedTo: { kind: 'warehouse', id: null },
      branchId: 'b_main',
      notes: null,
      purchaseDate: null,
      purchasePrice: null,
      condition: 'new',
      warrantyStart: null,
      warrantyEnd: null,
      isActive: true,
    };
    renderDialog({ asset });

    expect(screen.getByText(i18n.t('assets:editAsset'))).toBeInTheDocument();
    // T35: cat_device is non-multilang, so there is no name field. Instead,
    // serialNumber from Group 2 Identifiers is verified.
    expect(screen.getByLabelText(i18n.t('assets:serialNumber'))).toHaveValue('ABC123');
    // categoryId / statusId selects are disabled in edit mode.
    expect(screen.getByLabelText(i18n.t('assets:category'))).toBeDisabled();
    expect(screen.getByLabelText(i18n.t('assets:status'))).toBeDisabled();
  });
});

describe('AssetFormDialog — subtype/condition/warranty/license-asset (Wave A)', () => {
  function renderD(props = {}) {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn(async () => {});
    const utils = render(
      <I18nextProvider i18n={i18n}>
        <AssetFormDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} {...props} />
      </I18nextProvider>
    );
    return { ...utils, onOpenChange, onSubmit };
  }

  it('subtype select is disabled until a category is picked', () => {
    renderD();
    const sel = screen.getByLabelText(i18n.t('assets:subtype'));
    expect(sel).toBeDisabled();
  });

  it('after picking category=device, subtype select lists only device sub-types', async () => {
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    const subtypeSel = screen.getByLabelText(i18n.t('assets:subtype'));
    expect(subtypeSel).not.toBeDisabled();
    const opts = within(subtypeSel).getAllByRole('option');
    const values = opts.map((o) => o.getAttribute('value'));
    expect(values).toContain('device_laptop');
    expect(values).toContain('device_monitor');
    expect(values).not.toContain('furniture_chair');
    expect(values).not.toContain('license_os');
  });

  it('submitting without a subtype shows errorRequired next to the subtype field', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    // T35: device category has no name field; select branch only.
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('assets:saveAndAddAnother') }));

    // The subtype field renders its own errorRequired message.
    const subtypeSel = screen.getByLabelText(i18n.t('assets:subtype'));
    expect(subtypeSel).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('default condition is "new" (T35: requires a category to be selected first)', async () => {
    // T35: condition radios are in Group 4, only visible once a category is set.
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    const newRadio = screen.getByRole('radio', { name: i18n.t('assets:conditionNew') });
    expect(newRadio).toBeChecked();
    const usedRadio = screen.getByRole('radio', { name: i18n.t('assets:conditionUsed') });
    expect(usedRadio).not.toBeChecked();
  });

  it('switching condition to "used" hides the warranty inputs', async () => {
    // T35: condition radios and warranty fields are in Group 4, visible once category is set.
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // Warranty inputs visible by default (condition=new).
    expect(screen.getByLabelText(i18n.t('assets:warrantyStart'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('assets:warrantyEnd'))).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: i18n.t('assets:conditionUsed') }));

    expect(screen.queryByLabelText(i18n.t('assets:warrantyStart'))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t('assets:warrantyEnd'))).not.toBeInTheDocument();
  });

  it('warrantyEnd before warrantyStart shows errorWarrantyEndBeforeStart', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'device_laptop'
    );
    // T35: device category has no name field.
    await user.selectOptions(getBranchSelect(), 'b_main');

    const startInput = screen.getByLabelText(i18n.t('assets:warrantyStart'));
    const endInput = screen.getByLabelText(i18n.t('assets:warrantyEnd'));
    await user.type(startInput, '2027-01-01');
    await user.type(endInput, '2026-01-01');

    await user.click(screen.getByRole('button', { name: i18n.t('assets:saveAndAddAnother') }));

    expect(
      await screen.findByText(i18n.t('assets:errorWarrantyEndBeforeStart'))
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('subtype with attachableTo=[asset] shows only the asset radio (auto-selected)', async () => {
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'license'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'license_os'
    );

    // Only `asset` is in attachableTo → only that radio is rendered, and
    // it's auto-checked because it's the single allowed option.
    const assetRadio = screen.getByRole('radio', { name: i18n.t('assets:holderAsset') });
    expect(assetRadio).toBeChecked();
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderWarehouse') })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderEmployee') })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderBranch') })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderDepartment') })
    ).not.toBeInTheDocument();
  });

  it('subtype with attachableTo=[asset,employee] shows asset+employee radios; no warehouse/branch/department', async () => {
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'license'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'license_office_suite'
    );

    expect(
      screen.getByRole('radio', { name: i18n.t('assets:holderEmployee') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: i18n.t('assets:holderAsset') })
    ).toBeInTheDocument();
    // Warehouse, Branch, Department are NOT in attachableTo.
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderWarehouse') })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderBranch') })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderDepartment') })
    ).not.toBeInTheDocument();
  });

  it('non-license category does NOT show the asset-target radio', async () => {
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    expect(
      screen.queryByRole('radio', { name: i18n.t('assets:holderAsset') })
    ).not.toBeInTheDocument();
  });

  it('picking the asset radio renders AssetSelect', async () => {
    const user = userEvent.setup({ delay: null });
    renderD();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'license'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:subtype')),
      'license_office_suite'
    );
    await user.click(
      screen.getByRole('radio', { name: i18n.t('assets:holderAsset') })
    );

    expect(screen.getByTestId('asset-target-select')).toBeInTheDocument();
  });
});

describe('AssetFormDialog — inline subtype creation (Wave A.6)', () => {
  function renderD(props = {}) {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn(async () => {});
    const utils = render(
      <I18nextProvider i18n={i18n}>
        <AssetFormDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} {...props} />
      </I18nextProvider>
    );
    return { ...utils, onOpenChange, onSubmit };
  }

  it('shows the "+ Добавить категорию" button for super_admin (next to the subtype select) (Wave A.7)', () => {
    authState.role = 'super_admin';
    renderD();

    const btn = screen.getByRole('button', {
      name: new RegExp(i18n.t('assets:addCategory'), 'i'),
    });
    expect(btn).toBeInTheDocument();
    // It lives next to the subtype select inside the same flex row.
    const subtypeSel = screen.getByLabelText(i18n.t('assets:subtype'));
    expect(subtypeSel.parentElement).toContainElement(btn);
  });

  it('hides the "+ Добавить категорию" button for tech_admin and asset_admin (Wave A.7)', () => {
    authState.role = 'tech_admin';
    const { unmount } = renderD();
    expect(
      screen.queryByRole('button', {
        name: new RegExp(i18n.t('assets:addCategory'), 'i'),
      })
    ).not.toBeInTheDocument();
    unmount();

    authState.role = 'asset_admin';
    renderD();
    expect(
      screen.queryByRole('button', {
        name: new RegExp(i18n.t('assets:addCategory'), 'i'),
      })
    ).not.toBeInTheDocument();
  });

  it('clicking the button opens SubtypeFormDialog with category prefilled from typeahead; on success the asset form auto-selects the new subtype (Wave A.7)', async () => {
    authState.role = 'super_admin';
    // Stub the repository so the create call resolves with the new id and
    // also pushes a matching row into the mock subtype catalog. This
    // simulates the live `useAssetSubtypes` snapshot delivering the new
    // subtype shortly after the write — the asset form needs an
    // `<option value=...>` to actually display the auto-selected id.
    const newId = 'cat_device_tesla';
    subtypeRepoMock.create.mockImplementation(async () => {
      subtypeMocks.all.push({
        subtypeId: newId,
        categoryId: 'cat_device',
        name: 'Tesla',
        requiresMultilang: false,
        attachableTo: null,
        sortOrder: Date.now(),
        isActive: true,
      });
      return newId;
    });

    const user = userEvent.setup({ delay: null });
    renderD();

    // Pick a category first so the inline-create button enables and the
    // nested dialog has a default categoryId to seed.
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // Click the inline trigger (Wave A.7: label is now "Добавить категорию").
    const trigger = screen.getByRole('button', {
      name: new RegExp(i18n.t('assets:addCategory'), 'i'),
    });
    await user.click(trigger);

    // The nested SubtypeFormDialog mounts in locked-category mode (the
    // asset form passes a defaultCategoryId): the category is baked into
    // the dialog title and the typeahead is suppressed so the operator
    // can't accidentally re-target the new sub-type to a different category.
    const nestedHeading = await screen.findByRole('heading', {
      name: i18n.t('assets:subtypeAdminDialogCreateInCategoryTitle', {
        name: 'Устройство',
      }),
    });
    expect(nestedHeading).toBeInTheDocument();
    expect(document.getElementById('subtype-category')).toBeNull();

    // Type a name and save the nested dialog. Scope the textbox lookup
    // to the nested dialog's panel — both dialogs have a `name="name"`
    // input and a top-level getAllByRole would match both.
    const nestedPanel = nestedHeading.closest('[role="dialog"]');
    expect(nestedPanel).toBeTruthy();
    const nestedNameInput = within(nestedPanel)
      .getAllByRole('textbox')
      .find((el) => el.getAttribute('name') === 'name' && !el.readOnly);
    expect(nestedNameInput).toBeTruthy();
    await user.type(nestedNameInput, 'Tesla');
    // Wave-A: the nested SubtypeFormDialog now requires picking at least one
    // allowed holder kind. The seeded category is `cat_device` whose
    // `attachableTo` array is the four non-asset kinds — pick `branch`.
    const nestedBranchCheckbox = within(nestedPanel).getByRole('checkbox', {
      name: i18n.t('assets:assignmentKindBranch'),
    });
    await user.click(nestedBranchCheckbox);
    await user.click(
      within(nestedPanel).getByRole('button', {
        name: i18n.t('assets:subtypeAdminSave'),
      })
    );

    // The repository was invoked with the slug-derived id (existing-category
    // mode → no `newCategory` payload should be passed).
    await waitFor(() => {
      expect(subtypeRepoMock.create).toHaveBeenCalledTimes(1);
    });
    const [, actor, opts] = subtypeRepoMock.create.mock.calls[0];
    expect(actor).toEqual({ uid: 'u_super', role: 'super_admin' });
    expect(opts.id).toBe(newId);

    // After resolution, the asset form's subtype select reflects the new id.
    const subtypeSel = screen.getByLabelText(i18n.t('assets:subtype'));
    await waitFor(() => {
      expect(subtypeSel).toHaveValue(newId);
    });
  });
});

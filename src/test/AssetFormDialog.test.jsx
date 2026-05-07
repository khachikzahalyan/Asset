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
      isActive: true,
    },
    {
      categoryId: 'cat_furniture',
      name: { ru: 'Мебель', en: 'Furniture', hy: 'Կահույք' },
      inventoryCodePrefix: '450',
      requiresMultilang: true,
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

// --- Helpers ------------------------------------------------------------------

function renderDialog(props = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => {});
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <AssetFormDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
        {...props}
      />
    </I18nextProvider>
  );
  return { ...utils, onClose, onSubmit };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('ru');
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
  it('renders in create mode with default Куда=СКЛАД and default status=warehouse', () => {
    renderDialog();

    // Title is "Add asset" (i18n key addAsset).
    expect(screen.getByText(i18n.t('assets:addAsset'))).toBeInTheDocument();

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

  it('shows a plain <input> for name when the category is single-lang', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

    // Pick "Устройство" (requiresMultilang = false).
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );

    // Name field is a single <input>, not three locale inputs.
    const nameInput = screen.getByLabelText(i18n.t('assets:name'));
    expect(nameInput.tagName).toBe('INPUT');

    // No locale hint labels (RU / EN / HY) rendered.
    // MultiLangInput renders three sub-inputs with placeholder/aria-label per locale.
    expect(screen.queryByPlaceholderText(/RU/i)).not.toBeInTheDocument();
  });

  it('switches name to MultiLangInput when a multi-lang category is picked', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderDialog();

    // Pick "Мебель" (requiresMultilang = true).
    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_furniture'
    );

    // MultiLangInput renders three inputs named `name.ru`, `name.en`, `name.hy`.
    await waitFor(() => {
      // Search the full document — Dialog portals outside `container`.
      expect(document.querySelector('input[name="name.ru"]')).toBeInTheDocument();
      expect(document.querySelector('input[name="name.en"]')).toBeInTheDocument();
      expect(document.querySelector('input[name="name.hy"]')).toBeInTheDocument();
    });
    // The single-lang <input id="asset-name"> is gone.
    expect(document.getElementById('asset-name')).toBeNull();
    // container is referenced to avoid an unused-binding lint warning if any
    // future change drops the destructure.
    void container;
  });

  it('switches back to single <input> when the category changes from multi-lang to single-lang', async () => {
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

    // The single-lang <input> reappears.
    const nameInput = screen.getByLabelText(i18n.t('assets:name'));
    expect(nameInput.tagName).toBe('INPUT');
  });

  it('Куда=СОТРУДНИК hides BranchSelect and shows EmployeeSelect', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

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
    const user = userEvent.setup({ delay: null });
    renderDialog();

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

  it('shows errorRequired for both categoryId and name when both are blank on submit', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderDialog();

    // Click Save without picking a category or typing a name.
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    const errors = await screen.findAllByText(i18n.t('assets:errorRequired'));
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Status filter — Куда=СКЛАД shows only isAssignable===false statuses', () => {
    renderDialog();

    const statusSelect = screen.getByLabelText(i18n.t('assets:status'));
    const opts = within(statusSelect).getAllByRole('option');
    const values = opts.map((o) => o.getAttribute('value'));
    // Warehouse + In prep are isAssignable=false; Assigned is isAssignable=true.
    expect(values).toContain('warehouse');
    expect(values).toContain('in_prep');
    expect(values).not.toContain('assigned');
  });

  it('Status filter — Куда=СОТРУДНИК shows only isAssignable===true statuses', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

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
    const user = userEvent.setup({ delay: null });
    const { onSubmit, onClose } = renderDialog();

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.type(
      screen.getByLabelText(i18n.t('assets:name')),
      '  ThinkPad ноутбук  '
    );
    await user.type(screen.getByLabelText(i18n.t('assets:brand')), '  Lenovo  ');
    await user.type(screen.getByLabelText(i18n.t('assets:model')), '  T14  ');
    await user.type(screen.getByLabelText(i18n.t('assets:serialNumber')), '  ABC123  ');
    await user.selectOptions(getBranchSelect(), 'b_main');

    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [payload, opts] = onSubmit.mock.calls[0];
    // Sanitization trims free-text fields and normalizes ASCII fields.
    expect(payload.categoryId).toBe('cat_device');
    expect(payload.name).toBe('ThinkPad ноутбук');
    expect(payload.brand).toBe('Lenovo');
    expect(payload.model).toBe('T14');
    expect(payload.serialNumber).toBe('ABC123');
    // Default Куда=СКЛАД, branchId set, assignedTo.kind=warehouse.
    expect(payload.assignedTo).toEqual({ kind: 'warehouse', id: null });
    expect(payload.branchId).toBe('b_main');
    // Default status is "warehouse".
    expect(payload.statusId).toBe('warehouse');
    // The form passes the resolved category to the submit callback.
    expect(opts.category?.categoryId).toBe('cat_device');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces errorInventoryCodeTaken when the repository throws AssetInventoryCodeTakenError', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn(async () => {
      throw new AssetInventoryCodeTakenError('400/5');
    });

    render(
      <I18nextProvider i18n={i18n}>
        <AssetFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />
      </I18nextProvider>
    );

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.type(screen.getByLabelText(i18n.t('assets:name')), 'X');
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

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
        <AssetFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />
      </I18nextProvider>
    );

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.type(screen.getByLabelText(i18n.t('assets:name')), 'X');
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

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
        <AssetFormDialog open onClose={vi.fn()} onSubmit={onSubmit} />
      </I18nextProvider>
    );

    await user.selectOptions(
      screen.getByLabelText(i18n.t('assets:category')),
      'cat_device'
    );
    await user.type(screen.getByLabelText(i18n.t('assets:name')), 'X');
    await user.selectOptions(getBranchSelect(), 'b_main');
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    expect(
      await screen.findByText(i18n.t('assets:errorRequired'))
    ).toBeInTheDocument();
  });

  it('pre-fills the form fields from the asset prop in edit mode', () => {
    const asset = {
      assetId: 'a1',
      inventoryCode: '400/5',
      categoryId: 'cat_device',
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
      isActive: true,
    };
    renderDialog({ asset });

    expect(screen.getByText(i18n.t('assets:editAsset'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('assets:name'))).toHaveValue('ThinkPad');
    expect(screen.getByLabelText(i18n.t('assets:brand'))).toHaveValue('Lenovo');
    expect(screen.getByLabelText(i18n.t('assets:model'))).toHaveValue('T14');
    expect(screen.getByLabelText(i18n.t('assets:serialNumber'))).toHaveValue('ABC123');
    // categoryId / statusId selects are disabled in edit mode.
    expect(screen.getByLabelText(i18n.t('assets:category'))).toBeDisabled();
    expect(screen.getByLabelText(i18n.t('assets:status'))).toBeDisabled();
  });
});

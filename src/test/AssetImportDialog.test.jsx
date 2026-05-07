import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import * as XLSX from 'xlsx';

import i18n from '@/i18n/index.js';
import AssetImportDialog from '@/components/features/assets/AssetImportDialog.jsx';

// --- Hook mocks --------------------------------------------------------------

const categoriesState = {
  data: [
    { categoryId: 'cat_device', name: { ru: 'Устройство', en: 'Device', hy: 'Սարք' }, requiresMultilang: false, inventoryCodePrefix: '400', isActive: true },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useCategories.js', () => ({ useCategories: () => categoriesState }));

const statusesState = {
  data: [
    { statusId: 'warehouse', name: { ru: 'Склад', en: 'Warehouse', hy: 'Պահեստ' }, isAssignable: false, isActive: true },
    { statusId: 'assigned',  name: { ru: 'Выдан',  en: 'Assigned',  hy: 'Տրված' },  isAssignable: true,  isActive: true },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useAssetStatuses.js', () => ({ useAssetStatuses: () => statusesState }));

const branchesState = {
  data: [{ branchId: 'b_main', name: { ru: 'HQ', en: 'HQ', hy: 'HQ' }, isActive: true }],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useBranches.js', () => ({ useBranches: () => branchesState }));

const employeesState = {
  data: [{ employeeId: 'e1', firstName: 'John', lastName: 'Doe', email: 'j@x.com', isActive: true }],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useEmployees.js', () => ({ useEmployees: () => employeesState }));

const assetsState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useAssets.js', () => ({ useAssets: () => assetsState }));

const { createSpy } = vi.hoisted(() => ({ createSpy: vi.fn(async () => 'newAssetId') }));
vi.mock('@/infra/repositories/firestoreAssetRepository.js', () => ({
  firestoreAssetRepository: { create: createSpy },
}));

// --- Helpers -----------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('ru');
  createSpy.mockResolvedValue('newAssetId');
});

function buildXlsxFile(rows) {
  const aoa = [
    ['inventoryCode', 'categoryId', 'categoryName', 'nameRu', 'nameEn', 'nameHy', 'brand', 'model', 'serialNumber', 'statusId', 'assignedToKind', 'assignedToId', 'holderName', 'branchId', 'notes', 'purchaseDate', 'purchasePrice', 'createdAt'],
    ...rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Assets');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new File([buf], 'assets.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function renderDialog(props = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AssetImportDialog
        open
        onClose={vi.fn()}
        actor={{ uid: 'admin1', role: 'super_admin' }}
        {...props}
      />
    </I18nextProvider>,
  );
}

// --- Tests -------------------------------------------------------------------

describe('AssetImportDialog', () => {
  it('renders the upload step with download-template and file picker', () => {
    renderDialog();
    expect(screen.getByText(i18n.t('assets:importDialogTitle'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('assets:downloadTemplate') }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/upload|загруз/i, { selector: 'input' }),
    ).toBeInTheDocument();
  });

  it('shows preview counts after a valid file is uploaded', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();
    const file = buildXlsxFile([
      ['', 'cat_device', '', 'X', '', '', '', '', '', 'warehouse', 'warehouse', '', '', 'b_main', '', '', '', ''],
      ['', 'cat_device', '', 'Y', '', '', '', '', '', 'warehouse', 'employee', 'eX', '', '', '', '', '', ''],
    ]);
    const input = screen.getByLabelText(/upload|загруз/i, { selector: 'input' });
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(i18n.t('assets:previewHeading'))).toBeInTheDocument();
    });

    expect(screen.getByText(/1.*green|1.*зелён/i)).toBeInTheDocument();
    expect(screen.getByText(/1.*red|1.*красн/i)).toBeInTheDocument();
  });

  it('disables Proceed while red rows are present', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();
    const file = buildXlsxFile([
      ['', 'cat_device', '', 'X', '', '', '', '', '', 'warehouse', 'employee', 'eX', '', '', '', '', '', ''],
    ]);
    const input = screen.getByLabelText(/upload|загруз/i, { selector: 'input' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByText(i18n.t('assets:previewHeading'))).toBeInTheDocument();
    });
    const proceedBtn = screen.getByRole('button', { name: i18n.t('assets:proceed') });
    expect(proceedBtn).toBeDisabled();
  });

  it('on Proceed calls repository create N times for non-red rows', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();
    const file = buildXlsxFile([
      ['', 'cat_device', '', 'A', '', '', '', '', '', 'warehouse', 'warehouse', '', '', 'b_main', '', '', '', ''],
      ['', 'cat_device', '', 'B', '', '', '', '', '', 'warehouse', 'warehouse', '', '', 'b_main', '', '', '', ''],
    ]);
    const input = screen.getByLabelText(/upload|загруз/i, { selector: 'input' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByText(i18n.t('assets:previewHeading'))).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: i18n.t('assets:proceed') }));
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('rejects files exceeding 5000 rows with errorImportTooManyRows', async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();
    const big = [];
    for (let i = 0; i < 5001; i++) {
      big.push(['', 'cat_device', '', 'X', '', '', '', '', '', 'warehouse', 'warehouse', '', '', 'b_main', '', '', '', '']);
    }
    const file = buildXlsxFile(big);
    const input = screen.getByLabelText(/upload|загруз/i, { selector: 'input' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(
        screen.getByText(i18n.t('assets:errorImportTooManyRows')),
      ).toBeInTheDocument();
    });
  });
});

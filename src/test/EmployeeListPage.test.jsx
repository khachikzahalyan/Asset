// userEvent.setup({ delay: null }) — see EmployeeFormDialog.test.jsx for
// the rationale (Dialog portal + async user events flake under load).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import EmployeeListPage from '@/pages/EmployeeListPage.jsx';

// --- Mocks --------------------------------------------------------------------

const employeesState = { data: [], loading: false, error: null };
vi.mock('@/hooks/useEmployees.js', () => ({
  useEmployees: () => employeesState,
}));

// Wave 1.5: list page now consumes the branches catalog for the column +
// filter dropdown. Provide a stable mock so test assertions can reference
// branch display names by id.
const branchesState = {
  data: [
    {
      branchId: 'b_main',
      name: { ru: 'Центральный офис', en: 'HQ', hy: 'Կենտրոնական' },
      type: 'warehouse',
      address: 'Yerevan',
      isActive: true,
    },
    {
      branchId: 'b_north',
      name: { ru: 'Северный', en: 'North', hy: 'Հյուսիս' },
      type: 'branch',
      address: 'Gyumri',
      isActive: true,
    },
  ],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useBranches.js', () => ({
  useBranches: () => branchesState,
}));

vi.mock('@/infra/repositories/firestoreEmployeeRepository.js', () => ({
  firestoreEmployeeRepository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
  },
}));

const authState = {
  user: { uid: 'u_super' },
  role: 'super_admin',
};
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

// --- Helpers ------------------------------------------------------------------

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/employees']}>
        <EmployeeListPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

const sampleEmployees = [
  {
    employeeId: 'e1',
    firstName: 'Khach',
    lastName: 'Z',
    email: 'khach@example.com',
    phone: null,
    branchId: 'b_main',
    departmentId: null,
    department: 'Engineering',
    isActive: true,
    terminatedAt: null,
  },
  {
    employeeId: 'e2',
    firstName: 'Anna',
    lastName: 'Petrova',
    email: 'anna@example.com',
    phone: null,
    branchId: 'b_north',
    departmentId: null,
    department: 'Marketing',
    isActive: true,
    terminatedAt: null,
  },
  {
    employeeId: 'e3',
    firstName: 'Boris',
    lastName: 'Sidorov',
    email: 'boris@example.com',
    phone: null,
    branchId: 'b_main',
    departmentId: null,
    department: 'Engineering',
    isActive: false,
    terminatedAt: null,
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  employeesState.data = [];
  employeesState.loading = false;
  employeesState.error = null;
  authState.role = 'super_admin';
  authState.user = { uid: 'u_super' };
  await i18n.changeLanguage('ru');
});

describe('EmployeeListPage', () => {
  it('shows the empty state when no employees exist', () => {
    renderPage();
    expect(screen.getByText(i18n.t('employees:emptyState'))).toBeInTheDocument();
  });

  it('renders rows with the branch and department columns when data is present', () => {
    employeesState.data = sampleEmployees;
    renderPage();

    const table = screen.getByRole('table');
    // 1 header row + 2 data rows (status filter defaults to "active",
    // so the inactive employee e3 is hidden).
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);

    // Branch column header is back (Wave 1.5).
    expect(
      within(table).getByRole('columnheader', { name: i18n.t('employees:branch') })
    ).toBeInTheDocument();

    // Khach's row links to /employees/e1 with the formatted full name "Z Khach".
    expect(screen.getByRole('link', { name: 'Z Khach' })).toHaveAttribute(
      'href',
      '/employees/e1'
    );
    // Branch column resolves the localized branch name (ru locale).
    expect(within(table).getByText('Центральный офис')).toBeInTheDocument();
    expect(within(table).getByText('Северный')).toBeInTheDocument();
    // Department column shows the free-text values.
    expect(within(table).getByText('Engineering')).toBeInTheDocument();
    expect(within(table).getByText('Marketing')).toBeInTheDocument();
  });

  it('renders a branch filter dropdown', () => {
    renderPage();
    // Filter is wired with aria-label = "Филиал" (key: filterByBranch).
    expect(
      screen.getByLabelText(i18n.t('employees:filterByBranch'))
    ).toBeInTheDocument();
  });

  it('hides "Добавить сотрудника" for tech_admin', () => {
    authState.role = 'tech_admin';
    renderPage();
    expect(
      screen.queryByRole('button', { name: i18n.t('employees:addEmployee') })
    ).not.toBeInTheDocument();
  });

  it('shows "Добавить сотрудника" for asset_admin', () => {
    authState.role = 'asset_admin';
    renderPage();
    expect(
      screen.getByRole('button', { name: i18n.t('employees:addEmployee') })
    ).toBeInTheDocument();
  });

  it('search input filters rows by name and email', async () => {
    const user = userEvent.setup({ delay: null });
    employeesState.data = sampleEmployees;
    renderPage();

    // Before filtering: Z Khach + Petrova Anna both visible (both active).
    expect(screen.getByRole('link', { name: 'Z Khach' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Petrova Anna' })).toBeInTheDocument();

    const searchBox = screen.getByRole('searchbox');
    await user.type(searchBox, 'anna');

    expect(screen.queryByRole('link', { name: 'Z Khach' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Petrova Anna' })).toBeInTheDocument();
  });

  it('branch filter narrows the visible rows to a single branch', async () => {
    const user = userEvent.setup({ delay: null });
    employeesState.data = sampleEmployees;
    renderPage();

    expect(screen.getByRole('link', { name: 'Z Khach' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Petrova Anna' })).toBeInTheDocument();

    const branchSelect = screen.getByLabelText(i18n.t('employees:filterByBranch'));
    await user.selectOptions(branchSelect, 'b_north');

    // Only Anna (b_north) remains visible after filter.
    expect(screen.queryByRole('link', { name: 'Z Khach' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Petrova Anna' })).toBeInTheDocument();
  });

  it('status filter chip flips between active and terminated', async () => {
    const user = userEvent.setup({ delay: null });
    employeesState.data = sampleEmployees;
    renderPage();

    // Default = active: Khach + Petrova visible, Sidorov hidden.
    expect(screen.getByRole('link', { name: 'Z Khach' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Sidorov Boris' })
    ).not.toBeInTheDocument();

    // Click the "terminated" chip.
    await user.click(
      screen.getByRole('button', {
        name: i18n.t('employees:filter_terminated'),
        pressed: false,
      })
    );

    // After flip: only Sidorov shows.
    expect(screen.queryByRole('link', { name: 'Z Khach' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sidorov Boris' })).toBeInTheDocument();

    // Click "all" → both visible.
    await user.click(
      screen.getByRole('button', { name: i18n.t('employees:filter_all') })
    );
    expect(screen.getByRole('link', { name: 'Z Khach' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sidorov Boris' })).toBeInTheDocument();
  });
});

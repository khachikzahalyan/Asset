import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import BranchListPage from '@/pages/BranchListPage.jsx';
import i18n from '@/i18n/index.js';

// useAuth mock — return a super-admin so the "Add branch" button renders.
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'u_test' },
    role: 'super_admin',
    employeeId: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

// useBranches mock — drives the component without touching Firestore.
const branchesState = {
  data: [],
  loading: false,
  error: null,
};
vi.mock('@/hooks/useBranches.js', () => ({
  useBranches: () => branchesState,
}));

// Repository mock — assert it isn't accidentally called from rendering paths.
vi.mock('@/infra/repositories/firestoreBranchRepository.js', () => ({
  firestoreBranchRepository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/branches']}>
        <BranchListPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  branchesState.data = [];
  branchesState.loading = false;
  branchesState.error = null;
  await i18n.changeLanguage('ru');
});

describe('BranchListPage', () => {
  it('shows the empty state when no branches exist', () => {
    renderPage();
    expect(screen.getByText(i18n.t('branches:emptyState'))).toBeInTheDocument();
  });

  it('renders the Add branch button for super_admin', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: i18n.t('branches:addBranch') })
    ).toBeInTheDocument();
  });

  it('renders a row per branch with localized name and status badge', () => {
    branchesState.data = [
      {
        branchId: 'b1',
        name: { ru: 'Главный', en: 'HQ', hy: 'Գլխավոր' },
        type: 'warehouse',
        address: 'Yerevan',
        responsibleEmployeeId: null,
        isActive: true,
      },
      {
        branchId: 'b2',
        name: { ru: 'Старый', en: 'Old', hy: 'Հին' },
        type: 'branch',
        address: '',
        responsibleEmployeeId: null,
        isActive: false,
      },
    ];

    renderPage();

    const main = screen.getByRole('table');
    const rows = within(main).getAllByRole('row');
    // 1 header row + 2 data rows
    expect(rows).toHaveLength(3);

    expect(screen.getByRole('link', { name: 'Главный' })).toHaveAttribute(
      'href',
      '/branches/b1'
    );
    expect(screen.getByRole('link', { name: 'Старый' })).toHaveAttribute(
      'href',
      '/branches/b2'
    );

    // Status badges from the i18n keys
    expect(screen.getByText(i18n.t('branches:active'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('branches:closed'))).toBeInTheDocument();
  });

  it('shows a loading spinner while branches are being fetched', () => {
    branchesState.loading = true;
    renderPage();
    expect(screen.getByText(i18n.t('common:loading'))).toBeInTheDocument();
  });

  it('shows an error alert when the hook reports an error', () => {
    branchesState.error = new Error('permission-denied');
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('permission-denied');
  });
});

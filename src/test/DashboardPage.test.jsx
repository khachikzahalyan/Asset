/**
 * Tests for DashboardPage live counters (Wave 1.5 — Task 1A).
 *
 * What's covered
 * --------------
 *  - Two live tiles ("Активные сотрудники", "Филиалы") render the numeric
 *    count returned from `useActiveCounts`.
 *  - Loading state shows a spinner; non-live tiles still show '—'.
 *  - Permission-denied error path falls back to '—' silently.
 *  - Wave-2 tooltip surfaces on the four deferred metric tiles.
 *
 * The hook itself is mocked here — its own end-to-end Firestore wiring is
 * unit-tested separately in `useActiveCounts.test.js`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import DashboardPage from '@/pages/DashboardPage.jsx';

const countsState = {
  activeEmployees: null,
  branches: null,
  loading: false,
  error: null,
};
vi.mock('@/hooks/useActiveCounts.js', () => ({
  useActiveCounts: () => countsState,
}));

const authState = { user: { uid: 'u_super' }, role: 'super_admin' };
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => authState,
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

beforeEach(async () => {
  countsState.activeEmployees = null;
  countsState.branches = null;
  countsState.loading = false;
  countsState.error = null;
  authState.role = 'super_admin';
  authState.user = { uid: 'u_super' };
  await i18n.changeLanguage('ru');
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <DashboardPage />
    </I18nextProvider>
  );
}

describe('DashboardPage live counters (Wave 1.5)', () => {
  it('renders the active employees and branches counts when the hook resolves', () => {
    countsState.activeEmployees = 1;
    countsState.branches = 3;
    renderPage();

    const empTile = screen.getByTestId('metric-activeEmployees');
    expect(within(empTile).getByText('1')).toBeInTheDocument();
    expect(
      within(empTile).getByText(i18n.t('dashboard:activeEmployees'))
    ).toBeInTheDocument();

    const brTile = screen.getByTestId('metric-branches');
    expect(within(brTile).getByText('3')).toBeInTheDocument();
    expect(
      within(brTile).getByText(i18n.t('dashboard:branches'))
    ).toBeInTheDocument();
  });

  it('renders the em-dash placeholder on the four Wave-2-deferred tiles', () => {
    countsState.activeEmployees = 7;
    countsState.branches = 2;
    renderPage();

    for (const key of ['totalAssets', 'inStock', 'issued', 'underRepair']) {
      const tile = screen.getByTestId(`metric-${key}`);
      expect(within(tile).getByText('—')).toBeInTheDocument();
      // Wave-2 tooltip surfaces on the card itself.
      expect(tile.getAttribute('title')).toBe(i18n.t('dashboard:metricNextWave'));
    }
  });

  it('shows a spinner on live tiles while loading and em-dash everywhere else', () => {
    countsState.loading = true;
    renderPage();

    const empTile = screen.getByTestId('metric-activeEmployees');
    // Spinner has aria-hidden, so we rely on the SVG element being present.
    expect(empTile.querySelector('svg.animate-spin')).toBeInTheDocument();

    // Non-live tile remains em-dash with the Wave-2 tooltip.
    const stockTile = screen.getByTestId('metric-inStock');
    expect(within(stockTile).getByText('—')).toBeInTheDocument();
  });

  it('falls back to em-dash silently on a permission-denied error', () => {
    countsState.error = new Error('permission-denied');
    countsState.activeEmployees = null;
    countsState.branches = null;
    renderPage();

    const empTile = screen.getByTestId('metric-activeEmployees');
    expect(within(empTile).getByText('—')).toBeInTheDocument();

    const brTile = screen.getByTestId('metric-branches');
    expect(within(brTile).getByText('—')).toBeInTheDocument();
  });

  it('hides the Add employee quick-action button for tech_admin', () => {
    authState.role = 'tech_admin';
    renderPage();
    expect(
      screen.queryByRole('button', { name: i18n.t('dashboard:addEmployee') })
    ).not.toBeInTheDocument();
  });
});

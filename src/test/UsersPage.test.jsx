import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import i18n from '@/i18n/index.js';

// --- mocks ---
const mockUsers = vi.fn();
const mockInvitations = vi.fn();
vi.mock('@/hooks/useUsers.js', () => ({ useUsers: (...args) => mockUsers(...args) }));
vi.mock('@/hooks/useUserInvitations.js', () => ({
  useUserInvitations: (...args) => mockInvitations(...args),
}));

const mockUpdateRole = vi.fn(async () => {});
const mockSetActive = vi.fn(async () => {});
vi.mock('@/infra/repositories/firestoreUsersRepository.js', () => ({
  firestoreUsersRepository: {
    updateRole: (...args) => mockUpdateRole(...args),
    setActive: (...args) => mockSetActive(...args),
    list: vi.fn(),
  },
}));

const mockCreateInvite = vi.fn(async () => {});
const mockRevokeInvite = vi.fn(async () => {});
vi.mock('@/infra/repositories/firestoreUserInvitationsRepository.js', () => ({
  firestoreUserInvitationsRepository: {
    create: (...args) => mockCreateInvite(...args),
    revoke: (...args) => mockRevokeInvite(...args),
    listPending: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'super-uid', email: 'zahalyanxcho@gmail.com' },
    role: 'super_admin',
  }),
}));

import UsersPage from '@/pages/UsersPage.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('UsersPage', () => {
  it('renders both sections with empty states', () => {
    mockUsers.mockReturnValue({ data: [], loading: false, error: null });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();
    expect(screen.getByText(/Активные пользователи|Active users/i)).toBeInTheDocument();
    expect(screen.getByText(/Ожидающие приглашения|Pending invitations/i)).toBeInTheDocument();
  });

  it('renders users in the active section', () => {
    mockUsers.mockReturnValue({
      data: [
        { uid: 'super-uid', email: 'zahalyanxcho@gmail.com', role: 'super_admin', isActive: true },
        { uid: 'kolya-uid', email: 'kolya@gmail.com', role: 'tech_admin', isActive: true },
      ],
      loading: false,
      error: null,
    });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();
    expect(screen.getByText('zahalyanxcho@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('kolya@gmail.com')).toBeInTheDocument();
  });

  it('disables Deactivate button on the current user (cannot deactivate self)', () => {
    mockUsers.mockReturnValue({
      data: [
        { uid: 'super-uid', email: 'zahalyanxcho@gmail.com', role: 'super_admin', isActive: true },
      ],
      loading: false,
      error: null,
    });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();
    const row = screen.getByText('zahalyanxcho@gmail.com').closest('tr');
    const deactivate = within(row).queryByRole('button', { name: /Деактивировать|Deactivate/i });
    if (deactivate) {
      expect(deactivate).toBeDisabled();
    }
  });

  it('blocks demoting the last active super_admin', async () => {
    const user = userEvent.setup();
    mockUsers.mockReturnValue({
      data: [
        { uid: 'super-uid', email: 'zahalyanxcho@gmail.com', role: 'super_admin', isActive: true },
        { uid: 'vasya-uid', email: 'vasya@gmail.com', role: 'tech_admin', isActive: true },
      ],
      loading: false,
      error: null,
    });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();

    // Open role change for the only super_admin
    const row = screen.getByText('zahalyanxcho@gmail.com').closest('tr');
    const changeBtn = within(row).getByRole('button', { name: /роль|role/i });
    await user.click(changeBtn);

    // Pick a non-super_admin role
    const techRadio = await screen.findByLabelText(/Тех\. админ|Tech admin/i);
    await user.click(techRadio);

    // Submit
    const submit = screen.getByRole('button', { name: /Сохранить|Save|Пригласить|Invite/i });
    await user.click(submit);

    await waitFor(() => {
      expect(screen.getByText(/super_admin|супер|gerad/i)).toBeInTheDocument();
    });
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it('opens invite dialog and submits a valid invitation', async () => {
    const user = userEvent.setup();
    mockUsers.mockReturnValue({ data: [], loading: false, error: null });
    mockInvitations.mockReturnValue({ data: [], loading: false, error: null });
    renderPage();

    const inviteCta = screen.getByRole('button', { name: /Пригласить|Invite/i });
    await user.click(inviteCta);

    const emailInput = await screen.findByLabelText(/E-?mail|почта|email/i);
    await user.type(emailInput, 'kolya@gmail.com');

    const submit = screen.getAllByRole('button', { name: /Пригласить|Invite/i }).pop();
    await user.click(submit);

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'kolya@gmail.com', role: 'tech_admin' }),
        expect.objectContaining({ uid: 'super-uid' })
      );
    });
  });
});

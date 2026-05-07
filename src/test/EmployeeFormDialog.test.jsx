// All `userEvent.setup({ delay: null })` calls in this file are deliberate:
// the Dialog component portals into a body-appended <div>, and userEvent's
// default 0-ms-but-still-async-via-setTimeout cadence races with React's
// batched state flush during portal re-renders. delay: null fires every
// event synchronously and eliminates the flake.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import EmployeeFormDialog from '@/components/features/employees/EmployeeFormDialog.jsx';
import { EmployeeEmailTakenError } from '@/domain/employees.js';

// --- Hook + repo mocks --------------------------------------------------------
//
// The dialog itself does not import any hook or repository — it just renders
// inputs and calls `onSubmit`. We still mock the employee repo to keep the
// test hermetic and to assert no accidental call from rendering paths.

vi.mock('@/infra/repositories/firestoreEmployeeRepository.js', () => ({
  firestoreEmployeeRepository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
  },
}));

// BranchSelect needs the branches catalog. Stub the hook so tests can
// pick a branch without going through Firestore. The first branch is
// flagged as the head office (isPrimary) — the form uses that flag to
// auto-fill the field on open.
const branchesState = {
  data: [
    {
      branchId: 'b_main',
      name: { ru: 'Центральный офис', en: 'HQ', hy: 'Կենտրոնական' },
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

// --- Helpers ------------------------------------------------------------------

function renderDialog(props = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => {});
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <EmployeeFormDialog
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

describe('EmployeeFormDialog', () => {
  it('renders the Wave-1.5 field labels in create mode', () => {
    renderDialog();
    // Title is "Add employee" (i18n key addEmployee).
    expect(
      screen.getByText(i18n.t('employees:addEmployee'))
    ).toBeInTheDocument();

    // Wave-1.5 fields: first name, last name, email, phone, branch, department.
    expect(screen.getByLabelText(i18n.t('employees:lastName'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('employees:firstName'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('employees:email'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('employees:phone'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('employees:branch'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('employees:department'))).toBeInTheDocument();
  });

  it('does NOT render the removed Wave-1 fields', () => {
    renderDialog();
    // middleName, hiredAt, position were removed in Wave 1. Branch is back.
    expect(
      screen.queryByLabelText(/Отчество|Middle name|Հայրանուն/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Дата найма|Hire date|Աշխատանքի ընդունման/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Должность|Position|Պաշտոն/i)
    ).not.toBeInTheDocument();
  });

  it('surfaces errorBranchRequired when no branches exist in the catalog', async () => {
    const user = userEvent.setup({ delay: null });
    // Empty branches catalog — the auto-default effect cannot pick anything,
    // so the form submits with branchId=null and validation fires.
    const previous = branchesState.data;
    branchesState.data = [];
    try {
      const { onSubmit } = renderDialog();
      await user.type(screen.getByLabelText(i18n.t('employees:firstName')), 'Khach');
      await user.type(screen.getByLabelText(i18n.t('employees:lastName')), 'Z');
      await user.type(
        screen.getByLabelText(i18n.t('employees:email')),
        'k@example.com'
      );
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      expect(
        await screen.findByText(i18n.t('employees:errorBranchRequired'))
      ).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      branchesState.data = previous;
    }
  });

  it('auto-selects the first active branch in create mode', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderDialog();

    // The first active branch in the mocked catalog is "b_main". The form
    // should pre-fill that — the user does not need to pick the branch
    // manually before submitting.
    await user.type(screen.getByLabelText(i18n.t('employees:firstName')), 'Khach');
    await user.type(screen.getByLabelText(i18n.t('employees:lastName')), 'Z');
    await user.type(
      screen.getByLabelText(i18n.t('employees:email')),
      'k@example.com'
    );
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0].branchId).toBe('b_main');
  });

  it('surfaces errorRequired when firstName is blank on submit', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderDialog();

    // Fill everything else but leave firstName blank.
    await user.type(screen.getByLabelText(i18n.t('employees:lastName')), 'Petrov');
    await user.type(screen.getByLabelText(i18n.t('employees:email')), 'petrov@example.com');

    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    // The dialog re-renders with the validation error visible inline.
    expect(
      await screen.findByText(i18n.t('employees:errorRequired'))
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('surfaces errorEmailNonAscii when email contains Cyrillic letters', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderDialog();

    await user.type(screen.getByLabelText(i18n.t('employees:firstName')), 'Khach');
    await user.type(screen.getByLabelText(i18n.t('employees:lastName')), 'Z');
    // type="email" inputs reject non-ASCII via DOM filtering in some browsers,
    // but jsdom accepts the value as-is.
    await user.type(
      screen.getByLabelText(i18n.t('employees:email')),
      'тест@example.com'
    );

    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    expect(
      await screen.findByText(i18n.t('employees:errorEmailNonAscii'))
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with sanitized input and then onClose on success', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit, onClose } = renderDialog();

    await user.type(screen.getByLabelText(i18n.t('employees:firstName')), '  Khach ');
    await user.type(screen.getByLabelText(i18n.t('employees:lastName')), '  Z ');
    await user.type(
      screen.getByLabelText(i18n.t('employees:email')),
      '  Khach@Example.COM '
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('employees:branch')),
      'b_main'
    );
    await user.type(
      screen.getByLabelText(i18n.t('employees:department')),
      '  IT '
    );
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const arg = onSubmit.mock.calls[0][0];
    // Sanitization: trims firstName/lastName/email/department; lowercases email.
    expect(arg.firstName).toBe('Khach');
    expect(arg.lastName).toBe('Z');
    expect(arg.email).toBe('khach@example.com');
    expect(arg.department).toBe('IT');
    // Wave 1.5: branchId is collected again.
    expect(arg.branchId).toBe('b_main');
    expect(arg.isActive).toBe(true);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('pre-fills the form fields from the employee prop in edit mode', () => {
    const employee = {
      employeeId: 'e1',
      firstName: 'Khach',
      lastName: 'Z',
      email: 'khach@example.com',
      phone: '+374 99 11 22 33',
      branchId: 'b_main',
      departmentId: null,
      department: 'Engineering',
      isActive: true,
      terminatedAt: null,
    };
    renderDialog({ employee });

    expect(screen.getByText(i18n.t('employees:editEmployee'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('employees:firstName'))).toHaveValue('Khach');
    expect(screen.getByLabelText(i18n.t('employees:lastName'))).toHaveValue('Z');
    expect(screen.getByLabelText(i18n.t('employees:email'))).toHaveValue('khach@example.com');
    expect(screen.getByLabelText(i18n.t('employees:phone'))).toHaveValue('+374 99 11 22 33');
    expect(screen.getByLabelText(i18n.t('employees:branch'))).toHaveValue('b_main');
    expect(screen.getByLabelText(i18n.t('employees:department'))).toHaveValue('Engineering');
  });

  it('surfaces errorEmailTaken on EmployeeEmailTakenError from onSubmit', async () => {
    const user = userEvent.setup({ delay: null });
    const failingSubmit = vi.fn(async () => {
      throw new EmployeeEmailTakenError('e1@example.com');
    });
    render(
      <I18nextProvider i18n={i18n}>
        <EmployeeFormDialog
          open
          onClose={vi.fn()}
          onSubmit={failingSubmit}
        />
      </I18nextProvider>
    );

    await user.type(screen.getByLabelText(i18n.t('employees:firstName')), 'Khach');
    await user.type(screen.getByLabelText(i18n.t('employees:lastName')), 'Z');
    await user.type(
      screen.getByLabelText(i18n.t('employees:email')),
      'e1@example.com'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('employees:branch')),
      'b_main'
    );
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    expect(
      await screen.findByText(i18n.t('employees:errorEmailTaken'))
    ).toBeInTheDocument();
  });

  it('mode="quick" does not change dialog behavior or render its own CTA', async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit, onClose } = renderDialog({ mode: 'quick' });

    // No "Issue asset" CTA inside the dialog itself.
    expect(
      screen.queryByText(i18n.t('employees:issueAssetCta'))
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(i18n.t('employees:firstName')), 'Khach');
    await user.type(screen.getByLabelText(i18n.t('employees:lastName')), 'Z');
    await user.type(
      screen.getByLabelText(i18n.t('employees:email')),
      'k@example.com'
    );
    await user.selectOptions(
      screen.getByLabelText(i18n.t('employees:branch')),
      'b_main'
    );
    await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

// AssignDialog (Wave-1 Step 4) — RTL tests.
//
// All `userEvent.setup({ delay: null })` calls match AssetFormDialog's pattern:
// the Dialog portals into a body-appended container, and userEvent's default
// async cadence races React's batched flush across portal re-renders. Sync
// dispatch (delay: null) eliminates the flake.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n/index.js';
import AssignDialog from '@/components/features/assignments/AssignDialog.jsx';
import { AssignmentConflictError } from '@/domain/assignmentEvents.js';

// --- Hook mocks --------------------------------------------------------------

const branchesState = {
  data: [
    {
      branchId: 'b_main',
      name: { ru: 'Главный офис', en: 'HQ', hy: 'Գլխավոր' },
      type: 'warehouse',
      isActive: true,
      isPrimary: true,
    },
    {
      branchId: 'b_north',
      name: { ru: 'Северный', en: 'North', hy: 'Հյուսիս' },
      type: 'branch',
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

const ACTOR = { uid: 'u_admin', role: 'asset_admin' };

function renderDialog(props = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => 'event_new');
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <AssignDialog
        open
        onClose={onClose}
        actor={ACTOR}
        onSubmit={onSubmit}
        {...props}
      />
    </I18nextProvider>
  );
  return { ...utils, onClose, onSubmit };
}

const ASSET_IN_WAREHOUSE = {
  assetId: 'a_1',
  inventoryCode: '400/5',
  name: 'Laptop',
  assignedTo: { kind: 'warehouse', id: null },
  statusId: 'warehouse',
  branchId: 'b_main',
};

const ASSET_WITH_EMPLOYEE = {
  assetId: 'a_1',
  inventoryCode: '400/5',
  name: 'Laptop',
  assignedTo: { kind: 'employee', id: 'e_khach' },
  statusId: 'assigned',
  branchId: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('ru');
});

describe('AssignDialog', () => {
  describe('issue mode (warehouse → ?)', () => {
    it('renders the issue title and disables the warehouse-current radio', () => {
      renderDialog({ asset: ASSET_IN_WAREHOUSE, mode: 'issue' });

      expect(screen.getByText(i18n.t('assets:assignDialogTitle'))).toBeInTheDocument();

      // Warehouse is the *current* holder — it must not appear in issue mode
      // (the dialog only offers non-warehouse targets for issue/transfer).
      expect(
        screen.queryByRole('radio', { name: i18n.t('assets:holderWarehouse') })
      ).toBeNull();

      // The default kind for issue is "employee", so EmployeeSelect mounts.
      expect(
        screen.getByRole('radio', { name: i18n.t('assets:holderEmployee') })
      ).toBeChecked();
      expect(document.getElementById('assign-employee')).toBeInTheDocument();
    });

    it('submits with the selected employee and produces an event payload', async () => {
      const user = userEvent.setup({ delay: null });
      const { onSubmit, onClose } = renderDialog({
        asset: ASSET_IN_WAREHOUSE,
        mode: 'issue',
      });

      // Pick employee e_khach.
      const empSelect = document.getElementById('assign-employee');
      await user.selectOptions(empSelect, 'e_khach');

      // Save.
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

      const [payload, actor] = onSubmit.mock.calls[0];
      expect(payload).toMatchObject({
        assetId: 'a_1',
        fromAssignment: { kind: 'warehouse', id: null },
        toAssignment: { kind: 'employee', id: 'e_khach' },
      });
      expect(payload.occurredAt).toBeInstanceOf(Date);
      expect(actor).toEqual(ACTOR);

      // Dialog closes after a successful submit.
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('switches the holder selector when the user picks a different kind', async () => {
      const user = userEvent.setup({ delay: null });
      renderDialog({ asset: ASSET_IN_WAREHOUSE, mode: 'issue' });

      // Default is employee → switch to branch.
      await user.click(
        screen.getByRole('radio', { name: i18n.t('assets:holderBranch') })
      );

      expect(document.getElementById('assign-employee')).toBeNull();
      expect(document.getElementById('assign-branch-target')).toBeInTheDocument();

      // And switch to department (stub).
      await user.click(
        screen.getByRole('radio', { name: i18n.t('assets:holderDepartment') })
      );
      expect(document.getElementById('assign-branch-target')).toBeNull();
      expect(document.getElementById('assign-department')).toBeInTheDocument();
    });

    it('blocks submit when the holder id is empty (validation)', async () => {
      const user = userEvent.setup({ delay: null });
      const { onSubmit } = renderDialog({
        asset: ASSET_IN_WAREHOUSE,
        mode: 'issue',
      });

      // Don't pick an employee — submit immediately.
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      // onSubmit must NOT have been called: validation rejects empty toAssignment.id.
      await waitFor(() => {
        expect(
          screen.getByText(i18n.t('assets:errorRequired'))
        ).toBeInTheDocument();
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('return mode (any → warehouse)', () => {
    it('renders the return title with the warehouse-only target and a destination picker', () => {
      renderDialog({ asset: ASSET_WITH_EMPLOYEE, mode: 'return' });

      expect(screen.getByText(i18n.t('assets:returnDialogTitle'))).toBeInTheDocument();

      // Only the warehouse radio is shown.
      expect(
        screen.getByRole('radio', { name: i18n.t('assets:holderWarehouse') })
      ).toBeChecked();
      expect(
        screen.queryByRole('radio', { name: i18n.t('assets:holderEmployee') })
      ).toBeNull();

      // Destination warehouse BranchSelect is mounted.
      expect(document.getElementById('assign-dest-branch')).toBeInTheDocument();
    });

    it('submits with toAssignment=warehouse and prepends the destination branch into notes', async () => {
      const user = userEvent.setup({ delay: null });
      const { onSubmit } = renderDialog({
        asset: ASSET_WITH_EMPLOYEE,
        mode: 'return',
      });

      // Pick destination branch b_north.
      await user.selectOptions(
        document.getElementById('assign-dest-branch'),
        'b_north'
      );

      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

      const [payload] = onSubmit.mock.calls[0];
      expect(payload.fromAssignment).toEqual({ kind: 'employee', id: 'e_khach' });
      expect(payload.toAssignment).toEqual({ kind: 'warehouse', id: null });
      // Wave-1 records the destination branch in the event notes.
      expect(payload.notes).toContain('branch:b_north');
    });
  });

  describe('transfer mode (holder → another holder)', () => {
    it('renders the transfer title and excludes the warehouse target', () => {
      renderDialog({ asset: ASSET_WITH_EMPLOYEE, mode: 'transfer' });

      expect(
        screen.getByText(i18n.t('assets:transferDialogTitle'))
      ).toBeInTheDocument();

      // No warehouse radio in transfer mode (use the dedicated Return action).
      expect(
        screen.queryByRole('radio', { name: i18n.t('assets:holderWarehouse') })
      ).toBeNull();

      // Default kind is employee.
      expect(
        screen.getByRole('radio', { name: i18n.t('assets:holderEmployee') })
      ).toBeChecked();
    });

    it('submits a transfer payload with the new employee', async () => {
      const user = userEvent.setup({ delay: null });
      const { onSubmit } = renderDialog({
        asset: ASSET_WITH_EMPLOYEE,
        mode: 'transfer',
      });

      // Pick the OTHER employee (e_petr); e_khach is the current holder.
      const empSelect = document.getElementById('assign-employee');
      // Confirm both employees are available in the select.
      const opts = within(empSelect).getAllByRole('option');
      const values = opts.map((o) => o.getAttribute('value'));
      expect(values).toContain('e_petr');

      await user.selectOptions(empSelect, 'e_petr');
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

      const [payload] = onSubmit.mock.calls[0];
      expect(payload).toMatchObject({
        assetId: 'a_1',
        fromAssignment: { kind: 'employee', id: 'e_khach' },
        toAssignment: { kind: 'employee', id: 'e_petr' },
      });
    });

    it('rejects a no-op (transfer to the same employee)', async () => {
      const user = userEvent.setup({ delay: null });
      const { onSubmit } = renderDialog({
        asset: ASSET_WITH_EMPLOYEE,
        mode: 'transfer',
      });

      // Pick the SAME employee currently assigned (e_khach) — no-op.
      const empSelect = document.getElementById('assign-employee');
      await user.selectOptions(empSelect, 'e_khach');
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      // Domain validate raises errorAssignmentNoOp before any onSubmit call.
      await waitFor(() => {
        expect(
          screen.getByText(i18n.t('assets:errorAssignmentNoOp'))
        ).toBeInTheDocument();
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('conflict handling', () => {
    it('surfaces a user-readable banner on AssignmentConflictError', async () => {
      const user = userEvent.setup({ delay: null });
      const onSubmit = vi.fn(async () => {
        throw new AssignmentConflictError(
          { kind: 'warehouse', id: null },
          { kind: 'employee', id: 'e_99' }
        );
      });
      const onClose = vi.fn();

      render(
        <I18nextProvider i18n={i18n}>
          <AssignDialog
            open
            onClose={onClose}
            actor={ACTOR}
            asset={ASSET_IN_WAREHOUSE}
            mode="issue"
            onSubmit={onSubmit}
          />
        </I18nextProvider>
      );

      await user.selectOptions(
        document.getElementById('assign-employee'),
        'e_khach'
      );
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      // The conflict alert renders.
      await waitFor(() => {
        expect(
          screen.getByText(i18n.t('assets:errorAssignmentConflict'))
        ).toBeInTheDocument();
      });
      // Dialog stays open so the user can refresh and retry.
      expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a generic submit error for non-conflict failures', async () => {
      const user = userEvent.setup({ delay: null });
      const onSubmit = vi.fn(async () => {
        throw new Error('boom');
      });

      render(
        <I18nextProvider i18n={i18n}>
          <AssignDialog
            open
            onClose={vi.fn()}
            actor={ACTOR}
            asset={ASSET_IN_WAREHOUSE}
            mode="issue"
            onSubmit={onSubmit}
          />
        </I18nextProvider>
      );

      await user.selectOptions(
        document.getElementById('assign-employee'),
        'e_khach'
      );
      await user.click(screen.getByRole('button', { name: i18n.t('common:save') }));

      await waitFor(() => {
        expect(screen.getByText('boom')).toBeInTheDocument();
      });
    });
  });
});

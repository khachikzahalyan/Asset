import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ConfirmDialog from '@/components/common/ConfirmDialog.jsx';

function renderConfirm(props = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Удалить категорию?',
    description: 'Вы хотите удалить «Устройство»? Это действие нельзя отменить.',
    confirmLabel: 'Удалить',
    cancelLabel: 'Отмена',
    destructive: true,
  };
  return render(<ConfirmDialog {...defaults} {...props} />);
}

describe('ConfirmDialog', () => {
  it('renders title, description, and both action buttons when open', async () => {
    renderConfirm();
    expect(await screen.findByText('Удалить категорию?')).toBeInTheDocument();
    expect(
      screen.getByText(/Вы хотите удалить «Устройство»/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Отмена' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Удалить' })
    ).toBeInTheDocument();
  });

  it('renders nothing when open=false', async () => {
    renderConfirm({ open: false });
    // Wait one tick to let any portal effect run, then assert no title.
    await waitFor(() => {
      expect(
        screen.queryByText('Удалить категорию?')
      ).not.toBeInTheDocument();
    });
  });

  it('cancel button calls onClose without invoking onConfirm', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderConfirm({ onClose, onConfirm });

    const cancelBtn = await screen.findByRole('button', { name: 'Отмена' });
    await user.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm-success: invokes onConfirm and resolves cleanly', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderConfirm({ onClose, onConfirm });

    const confirmBtn = await screen.findByRole('button', { name: 'Удалить' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    // The component itself does not auto-close on success — that's the
    // caller's responsibility (so the caller can decide to keep the dialog
    // open on error). onClose stays at zero on a successful confirm.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirm-error: keeps the dialog open and clears the busy state', async () => {
    const onClose = vi.fn();
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new Error('referential-integrity'));
    const user = userEvent.setup();
    renderConfirm({ onClose, onConfirm });

    const confirmBtn = await screen.findByRole('button', { name: 'Удалить' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    // Dialog still open: title still rendered.
    expect(screen.getByText('Удалить категорию?')).toBeInTheDocument();
    // Busy state cleared: confirm button enabled again.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Удалить' })
      ).not.toBeDisabled();
    });
    // onClose was never called by the dialog itself.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables both buttons while onConfirm is in-flight', async () => {
    let resolve;
    const onConfirm = vi.fn(
      () => new Promise((r) => {
        resolve = r;
      })
    );
    const user = userEvent.setup();
    renderConfirm({ onConfirm });

    const confirmBtn = await screen.findByRole('button', { name: 'Удалить' });
    const cancelBtn = screen.getByRole('button', { name: 'Отмена' });

    await user.click(confirmBtn);

    // While the promise is pending, both buttons are disabled.
    await waitFor(() => {
      expect(confirmBtn).toBeDisabled();
      expect(cancelBtn).toBeDisabled();
    });

    // Finish the promise so the test does not leak.
    resolve();
    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });
  });
});

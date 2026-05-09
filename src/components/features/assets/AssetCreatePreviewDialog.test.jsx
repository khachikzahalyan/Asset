// src/components/features/assets/AssetCreatePreviewDialog.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetCreatePreviewDialog } from './AssetCreatePreviewDialog.jsx';

const previewBase = {
  composedTitle: 'Laptop · HP · EliteBook 840 G6',
  inventoryCode: '450/302042',
  subtypeName: 'Laptop',
  brandName: 'HP',
  modelName: 'EliteBook 840 G6',
  holderSummary: 'Сотрудник: Иван Иванов',
  branchName: 'HQ',
  conditionLabel: 'Новый',
  warrantyWindow: '2026-01-01 → 2027-01-01',
  purchasePriceFormatted: '1,200 USD',
  licenseSummary: null,
};

describe('AssetCreatePreviewDialog', () => {
  it('renders the composed title', () => {
    render(
      <AssetCreatePreviewDialog
        open
        preview={previewBase}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('Laptop · HP · EliteBook 840 G6')).toBeInTheDocument();
  });

  it('shows "—" when inventoryCode is null', () => {
    render(
      <AssetCreatePreviewDialog
        open
        preview={{ ...previewBase, inventoryCode: null }}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows license summary rows when licenseSummary is present', () => {
    render(
      <AssetCreatePreviewDialog
        open
        preview={{
          ...previewBase,
          licenseSummary: {
            licenseTypeLabel: 'Корпоративная',
            subscribedAtFormatted: '2026-01-01',
            expiresAtFormatted: '2027-01-01',
            licenseKeySetLabel: 'Введён',
          },
        }}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('Корпоративная')).toBeInTheDocument();
    expect(screen.getByText('Введён')).toBeInTheDocument();
  });

  it('does NOT render the license key value, ever', () => {
    const { container } = render(
      <AssetCreatePreviewDialog
        open
        preview={{
          ...previewBase,
          licenseSummary: {
            licenseTypeLabel: 'Корпоративная',
            subscribedAtFormatted: '2026-01-01',
            expiresAtFormatted: '2027-01-01',
            licenseKeySetLabel: 'Введён',
          },
        }}
        onBack={() => {}}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(container.innerHTML).not.toMatch(/key-?value/i);
  });

  it('calls onBack on Back', () => {
    const onBack = vi.fn();
    render(
      <AssetCreatePreviewDialog
        open
        preview={previewBase}
        onBack={onBack}
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back|назад|հետ/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('calls onConfirm on Create', () => {
    const onConfirm = vi.fn();
    render(
      <AssetCreatePreviewDialog
        open
        preview={previewBase}
        onBack={() => {}}
        onConfirm={onConfirm}
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /create|создать|ստեղծել/i }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

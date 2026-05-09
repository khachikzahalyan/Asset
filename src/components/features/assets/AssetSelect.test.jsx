/**
 * Unit tests for AssetSelect — particularly the requireCanHostLicense filter.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/index.js';

// --- Mocks ---

const useAssetsMock = vi.fn(() => ({ data: [], loading: false }));
const useCategoriesMock = vi.fn(() => ({ data: [], loading: false }));

vi.mock('@/hooks/useAssets.js', () => ({
  useAssets: () => useAssetsMock(),
}));
vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => useCategoriesMock(),
}));

import AssetSelect from './AssetSelect.jsx';

// --- Test data ---

const deviceCategory = {
  categoryId: 'device',
  id: 'device',
  name: { ru: 'Устройство', en: 'Device', hy: 'Sarq' },
  canHostLicense: true,
};

const furnitureCategory = {
  categoryId: 'furniture',
  id: 'furniture',
  name: { ru: 'Мебель', en: 'Furniture', hy: 'Kahu' },
  canHostLicense: false,
};

const deviceAsset = {
  assetId: 'asset-device-1',
  categoryId: 'device',
  inventoryCode: '400/1',
  name: 'Laptop A',
  isActive: true,
};

const furnitureAsset = {
  assetId: 'asset-furniture-1',
  categoryId: 'furniture',
  inventoryCode: '500/1',
  name: 'Desk B',
  isActive: true,
};

describe('AssetSelect — requireCanHostLicense filter', () => {
  it('shows all assets in restrictToCategoryIds when requireCanHostLicense is false', () => {
    useAssetsMock.mockReturnValue({ data: [deviceAsset, furnitureAsset], loading: false });
    useCategoriesMock.mockReturnValue({ data: [deviceCategory, furnitureCategory], loading: false });

    render(
      <AssetSelect
        value=""
        onChange={() => {}}
        restrictToCategoryIds={['device', 'furniture']}
        requireCanHostLicense={false}
      />
    );

    // Both options should be present
    expect(screen.getByText(/400\/1/)).toBeInTheDocument();
    expect(screen.getByText(/500\/1/)).toBeInTheDocument();
  });

  it('filters to only canHostLicense:true categories when requireCanHostLicense is true', () => {
    useAssetsMock.mockReturnValue({ data: [deviceAsset, furnitureAsset], loading: false });
    useCategoriesMock.mockReturnValue({ data: [deviceCategory, furnitureCategory], loading: false });

    render(
      <AssetSelect
        value=""
        onChange={() => {}}
        restrictToCategoryIds={['device', 'furniture']}
        requireCanHostLicense={true}
      />
    );

    // Only the device asset should appear
    expect(screen.getByText(/400\/1/)).toBeInTheDocument();
    // Furniture asset should NOT appear
    expect(screen.queryByText(/500\/1/)).not.toBeInTheDocument();
  });
});

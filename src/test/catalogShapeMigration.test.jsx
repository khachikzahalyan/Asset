/**
 * Tests for CatalogShapeMigration — the bootstrap-time component that
 * upgrades pre-existing categories + asset_subtypes docs to the current
 * schema shape. Two passes:
 *   1) name shape: legacy single-lang mirror → multi-lang triple
 *   2) attachableTo shape: legacy enum / null / missing → array
 */

import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  authValue: { user: { uid: 'super_uid' }, role: 'super_admin' },
  categories: { data: [], loading: false },
  subtypes: { all: [], loading: false },
  catUpdates: [],
  subUpdates: [],
}));

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => mocks.authValue,
}));
vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => mocks.categories,
}));
vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => mocks.subtypes,
}));
vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: {
    update: vi.fn(async (id, input, before, actor) => {
      mocks.catUpdates.push({ id, input, before, actor });
    }),
  },
}));
vi.mock('@/infra/repositories/firestoreAssetSubtypeRepository.js', () => ({
  firestoreAssetSubtypeRepository: {
    update: vi.fn(async (id, input, before, actor) => {
      mocks.subUpdates.push({ id, input, before, actor });
    }),
  },
}));

import CatalogShapeMigration from '@/components/system/CatalogShapeMigration.jsx';

beforeEach(() => {
  mocks.authValue = { user: { uid: 'super_uid' }, role: 'super_admin' };
  mocks.categories = { data: [], loading: false };
  mocks.subtypes = { all: [], loading: false };
  mocks.catUpdates.length = 0;
  mocks.subUpdates.length = 0;
});

describe('CatalogShapeMigration — attachableTo upgrade', () => {
  it('upgrades a license sub-type with a legacy enum string to its category default', async () => {
    mocks.subtypes = {
      all: [
        {
          subtypeId: 'license_os',
          categoryId: 'license',
          name: { ru: 'Операционная система', en: 'Operating System', hy: 'Օպերացիոն համակարգ' },
          requiresMultilang: true,
          attachableTo: 'device-only',
          sortOrder: 10,
          isActive: true,
        },
      ],
      loading: false,
    };

    render(<CatalogShapeMigration />);
    await waitFor(() => {
      expect(mocks.subUpdates.length).toBe(1);
    });
    expect(mocks.subUpdates[0].input.attachableTo).toEqual(['asset', 'employee']);
  });

  it('upgrades a license sub-type missing attachableTo to its category default', async () => {
    mocks.subtypes = {
      all: [
        {
          subtypeId: 'license_office_suite',
          categoryId: 'license',
          name: { ru: 'Офисный пакет', en: 'Office Suite', hy: 'Գրասենյակային փաթեթ' },
          requiresMultilang: true,
          // attachableTo missing
          sortOrder: 20,
          isActive: true,
        },
      ],
      loading: false,
    };

    render(<CatalogShapeMigration />);
    await waitFor(() => {
      expect(mocks.subUpdates.length).toBe(1);
    });
    expect(mocks.subUpdates[0].input.attachableTo).toEqual(['asset', 'employee']);
  });

  it('upgrades a category missing attachableTo using its seed default', async () => {
    mocks.categories = {
      data: [
        {
          categoryId: 'device',
          name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
          inventoryCodePrefix: '400',
          requiresMultilang: true,
          isActive: true,
        },
      ],
      loading: false,
    };

    render(<CatalogShapeMigration />);
    await waitFor(() => {
      expect(mocks.catUpdates.length).toBe(1);
    });
    expect(mocks.catUpdates[0].input.attachableTo).toEqual([
      'branch', 'warehouse', 'employee', 'department',
    ]);
  });

  it('upgrades a sub-type missing attachableTo using its category default', async () => {
    mocks.subtypes = {
      all: [
        {
          subtypeId: 'device_laptop',
          categoryId: 'device',
          name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
          requiresMultilang: true,
          // attachableTo missing
          sortOrder: 20,
          isActive: true,
        },
      ],
      loading: false,
    };

    render(<CatalogShapeMigration />);
    await waitFor(() => {
      expect(mocks.subUpdates.length).toBe(1);
    });
    expect(mocks.subUpdates[0].input.attachableTo).toEqual([
      'branch', 'warehouse', 'employee', 'department',
    ]);
  });

  it('no-ops when attachableTo is already an array', async () => {
    mocks.categories = {
      data: [
        {
          categoryId: 'device',
          name: { ru: 'Устройства', en: 'Devices', hy: 'Սարքեր' },
          inventoryCodePrefix: '400',
          requiresMultilang: true,
          attachableTo: ['branch'],
          isActive: true,
        },
      ],
      loading: false,
    };
    mocks.subtypes = {
      all: [
        {
          subtypeId: 'device_laptop',
          categoryId: 'device',
          name: { ru: 'Ноутбук', en: 'Laptop', hy: 'Նոութբուք' },
          requiresMultilang: true,
          attachableTo: ['branch', 'employee'],
          sortOrder: 20,
          isActive: true,
        },
      ],
      loading: false,
    };

    render(<CatalogShapeMigration />);
    await new Promise((r) => setTimeout(r, 80));
    expect(mocks.catUpdates).toHaveLength(0);
    expect(mocks.subUpdates).toHaveLength(0);
  });

  it('skips entirely when role is not super_admin', async () => {
    mocks.authValue = { user: { uid: 'aa_uid' }, role: 'asset_admin' };
    mocks.subtypes = {
      all: [
        {
          subtypeId: 'license_os',
          categoryId: 'license',
          name: { ru: 'Операционная система', en: 'Operating System', hy: 'Օպերացիոն համակարգ' },
          requiresMultilang: true,
          attachableTo: 'device-only',
          sortOrder: 10,
          isActive: true,
        },
      ],
      loading: false,
    };

    render(<CatalogShapeMigration />);
    await new Promise((r) => setTimeout(r, 80));
    expect(mocks.subUpdates).toHaveLength(0);
  });
});

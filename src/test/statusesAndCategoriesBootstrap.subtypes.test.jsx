/**
 * Tests for the Wave-A subtype-bootstrap branch added to
 * StatusesAndCategoriesBootstrap.
 *
 * The component reads from useAssetStatuses / useCategories /
 * useAssetSubtypes, and seeds the corresponding Firestore collections via
 * the repository adapters. We mock all three hooks and the asset_subtype
 * repository so the test can assert exactly which subtype seeds the
 * component would create on first run.
 *
 * Per Wave-A user override (2026-05-07) the seed list is MINIMAL and
 * generic — 5-7 per category, no brand names. License seeds carry the
 * generic class only ("Antivirus", not "Kaspersky").
 */

import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ---------------------------------------------------------------
//
// Mock the three hooks the bootstrap depends on so we can drive the
// component into the "seed everything" branch.
const mocks = vi.hoisted(() => ({
  statuses: { data: [], loading: false },
  categories: { data: [], loading: false },
  subtypes: { data: [], all: [], loading: false },
  authValue: {
    user: { uid: 'super_uid' },
    role: 'super_admin',
  },
  // capture every subtype create call
  subtypeCreates: [],
  statusCreates: [],
  categoryCreates: [],
}));

vi.mock('@/hooks/useAssetStatuses.js', () => ({
  useAssetStatuses: () => mocks.statuses,
}));

vi.mock('@/hooks/useCategories.js', () => ({
  useCategories: () => mocks.categories,
}));

vi.mock('@/hooks/useAssetSubtypes.js', () => ({
  useAssetSubtypes: () => mocks.subtypes,
}));

vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => mocks.authValue,
}));

vi.mock('@/infra/repositories/firestoreAssetStatusRepository.js', () => ({
  firestoreAssetStatusRepository: {
    create: vi.fn(async (payload, actor, opts) => {
      mocks.statusCreates.push({ payload, actor, id: opts.id });
      return opts.id;
    }),
  },
}));

vi.mock('@/infra/repositories/firestoreCategoryRepository.js', () => ({
  firestoreCategoryRepository: {
    create: vi.fn(async (payload, actor, opts) => {
      mocks.categoryCreates.push({ payload, actor, id: opts.id });
      return opts.id;
    }),
  },
}));

vi.mock('@/infra/repositories/firestoreAssetSubtypeRepository.js', () => ({
  firestoreAssetSubtypeRepository: {
    create: vi.fn(async (payload, actor, opts) => {
      mocks.subtypeCreates.push({ payload, actor, id: opts.id });
      return opts.id;
    }),
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => true })),
  setDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => 'TS'),
  collection: vi.fn(() => ({})),
}));

vi.mock('@/lib/firebase/index.js', () => ({
  db: { __db: true },
}));

vi.mock('@/lib/audit/auditHelper.js', () => ({
  buildAuditLog: vi.fn((args) => args),
  newAuditLogRef: vi.fn(() => ({})),
}));

import StatusesAndCategoriesBootstrap from '@/components/system/StatusesAndCategoriesBootstrap.jsx';

beforeEach(() => {
  mocks.statuses = { data: ['warmed-up'], loading: false }; // pretend statuses exist
  mocks.categories = { data: ['warmed-up'], loading: false }; // pretend categories exist
  mocks.subtypes = { data: [], all: [], loading: false }; // empty -> trigger seed
  mocks.subtypeCreates.length = 0;
  mocks.statusCreates.length = 0;
  mocks.categoryCreates.length = 0;
});

describe('StatusesAndCategoriesBootstrap — subtype seeding (Wave A)', () => {
  it('seeds NOTHING when subtypes already exist', async () => {
    mocks.subtypes = { data: [{ subtypeId: 'x' }], all: [{ subtypeId: 'x' }], loading: false };
    render(<StatusesAndCategoriesBootstrap />);
    // Wait a tick for any potential effect to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.subtypeCreates).toHaveLength(0);
  });

  it('does NOT seed for non-super_admin', async () => {
    mocks.authValue = { user: { uid: 'asset_uid' }, role: 'asset_admin' };
    render(<StatusesAndCategoriesBootstrap />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.subtypeCreates).toHaveLength(0);
    // Restore for subsequent tests.
    mocks.authValue = { user: { uid: 'super_uid' }, role: 'super_admin' };
  });

  it('seeds the minimal generic subtype catalog on first super_admin run', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });

    // Group by category for shape assertions.
    const byCat = {};
    for (const c of mocks.subtypeCreates) {
      const cat = c.payload.categoryId;
      byCat[cat] ??= [];
      byCat[cat].push(c);
    }

    // Per Wave-A user override: 5-7 per category.
    expect(byCat.furniture?.length, 'furniture seed count').toBeGreaterThanOrEqual(5);
    expect(byCat.furniture?.length, 'furniture seed count').toBeLessThanOrEqual(7);
    expect(byCat.device?.length, 'device seed count').toBeGreaterThanOrEqual(5);
    expect(byCat.device?.length, 'device seed count').toBeLessThanOrEqual(7);
    expect(byCat.license?.length, 'license seed count').toBeGreaterThanOrEqual(5);
    expect(byCat.license?.length, 'license seed count').toBeLessThanOrEqual(7);
  });

  it('every seed has a stable `<categoryId>_<slug>` doc id', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });
    for (const c of mocks.subtypeCreates) {
      expect(c.id).toMatch(/^(furniture|device|license)_[a-z0-9_]+$/);
      expect(c.id.startsWith(`${c.payload.categoryId}_`)).toBe(true);
    }
  });

  it('NO license seed contains a brand name (per Wave-A user override)', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });
    const BRAND_NAMES = [
      'kaspersky',
      'eset',
      'bitdefender',
      'norton',
      'mcafee',
      'office 365',
      'office365',
      'microsoft office',
      'adobe',
      'photoshop',
      'illustrator',
      'acrobat',
      'autocad',
      'visual studio',
      'anydesk',
      'teamviewer',
      'zoom',
      'slack',
      'windows os', // Windows is a brand
      'windows',
      'macos',
      'linux',
    ];
    for (const c of mocks.subtypeCreates) {
      const name =
        typeof c.payload.name === 'string'
          ? c.payload.name
          : Object.values(c.payload.name).join(' ');
      const lower = name.toLowerCase();
      for (const brand of BRAND_NAMES) {
        expect(
          lower.includes(brand),
          `seed "${c.id}" has name "${name}" which contains brand "${brand}"`
        ).toBe(false);
      }
    }
  });

  it('every seed carries an attachableTo array of allowed kinds', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });
    const ALLOWED_KINDS = ['branch', 'warehouse', 'employee', 'department', 'asset'];
    for (const c of mocks.subtypeCreates) {
      expect(Array.isArray(c.payload.attachableTo)).toBe(true);
      expect(c.payload.attachableTo.length).toBeGreaterThan(0);
      for (const k of c.payload.attachableTo) {
        expect(ALLOWED_KINDS).toContain(k);
      }
    }
  });

  it('every license seed defaults to [asset, employee] (uniform per-category default)', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });
    const licenseSeeds = mocks.subtypeCreates.filter(
      (c) => c.payload.categoryId === 'license'
    );
    expect(licenseSeeds.length).toBeGreaterThan(0);
    for (const c of licenseSeeds) {
      expect(c.payload.attachableTo).toContain('asset');
      expect(c.payload.attachableTo).toContain('employee');
    }
  });

  it('every seed is multi-lang with ru/en/hy keys', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });
    for (const c of mocks.subtypeCreates) {
      expect(c.payload.requiresMultilang).toBe(true);
      expect(typeof c.payload.name).toBe('object');
      expect(c.payload.name).toHaveProperty('ru');
      expect(c.payload.name).toHaveProperty('en');
      expect(c.payload.name).toHaveProperty('hy');
      expect(typeof c.payload.name.ru).toBe('string');
      expect(typeof c.payload.name.en).toBe('string');
      expect(typeof c.payload.name.hy).toBe('string');
      expect(c.payload.name.ru.length).toBeGreaterThan(0);
      expect(c.payload.name.en.length).toBeGreaterThan(0);
      expect(c.payload.name.hy.length).toBeGreaterThan(0);
    }
  });

  it('every seed has integer sortOrder, isActive=true, and a non-null actor', async () => {
    render(<StatusesAndCategoriesBootstrap />);
    await waitFor(() => {
      expect(mocks.subtypeCreates.length).toBeGreaterThan(0);
    });
    for (const c of mocks.subtypeCreates) {
      expect(Number.isInteger(c.payload.sortOrder)).toBe(true);
      expect(c.payload.isActive).toBe(true);
      expect(c.actor.uid).toBe('super_uid');
      expect(c.actor.role).toBe('super_admin');
    }
  });
});

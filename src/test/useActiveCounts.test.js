/**
 * Unit test for the dashboard live-counters hook.
 *
 * Verifies:
 *   - happy path: `getCountFromServer` resolves -> hook exposes counts.
 *   - error path: rejection becomes `error`, counts stay null, loading=false.
 *   - the queries are built with `where('isActive', '==', true)` against
 *     the right collections.
 *
 * Firestore is fully mocked via `vi.hoisted`; no Firebase emulator needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  query: vi.fn((coll, ...mods) => ({ __query: coll, mods })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  getCountFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', () => mocks);
vi.mock('@/lib/firebase/index.js', () => ({ db: { __db: true } }));

import { useActiveCounts } from '@/hooks/useActiveCounts.js';

beforeEach(() => {
  mocks.collection.mockClear();
  mocks.query.mockClear();
  mocks.where.mockClear();
  mocks.getCountFromServer.mockReset();
});

describe('useActiveCounts', () => {
  it('resolves activeEmployees and branches from getCountFromServer', async () => {
    mocks.getCountFromServer
      .mockResolvedValueOnce({ data: () => ({ count: 5 }) }) // employees
      .mockResolvedValueOnce({ data: () => ({ count: 2 }) }); // branches

    const { result } = renderHook(() => useActiveCounts());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeEmployees).toBe(5);
    expect(result.current.branches).toBe(2);
    expect(result.current.error).toBeNull();

    // Both queries use isActive == true.
    const wheres = mocks.where.mock.calls;
    expect(wheres).toContainEqual(['isActive', '==', true]);
    // Both target the right collections.
    const cols = mocks.collection.mock.calls.map((c) => c[1]);
    expect(cols).toEqual(expect.arrayContaining(['employees', 'branches']));
  });

  it('surfaces the error and leaves counts null on rejection', async () => {
    mocks.getCountFromServer.mockRejectedValue(
      Object.assign(new Error('permission-denied'), { code: 'permission-denied' })
    );

    const { result } = renderHook(() => useActiveCounts());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.activeEmployees).toBeNull();
    expect(result.current.branches).toBeNull();
  });

  it('refetches when refreshKey changes', async () => {
    mocks.getCountFromServer.mockResolvedValue({
      data: () => ({ count: 0 }),
    });

    const { result, rerender } = renderHook(
      ({ refreshKey }) => useActiveCounts({ refreshKey }),
      { initialProps: { refreshKey: 0 } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstCallCount = mocks.getCountFromServer.mock.calls.length;

    rerender({ refreshKey: 1 });
    await waitFor(() => {
      expect(mocks.getCountFromServer.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });
});

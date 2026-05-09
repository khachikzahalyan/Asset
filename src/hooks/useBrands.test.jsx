// src/hooks/useBrands.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeToBrandsMock = vi.fn();
vi.mock('@/infra/repositories/firestoreBrandRepository.js', () => ({
  subscribeToBrands: (...args) => subscribeToBrandsMock(...args),
}));

import { useBrands } from './useBrands.js';

describe('useBrands', () => {
  beforeEach(() => {
    subscribeToBrandsMock.mockReset();
  });

  it('starts in loading state with empty data', () => {
    subscribeToBrandsMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useBrands());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it('exposes brands once the subscription pushes them', () => {
    let pushSnapshot = null;
    subscribeToBrandsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useBrands());
    act(() => {
      pushSnapshot([
        { brandId: 'b1', name: 'HP', isActive: true },
        { brandId: 'b2', name: 'Dell', isActive: true },
      ]);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0].name).toBe('HP');
  });

  it('records errors from the subscription', () => {
    let pushError = null;
    subscribeToBrandsMock.mockImplementation(({ onError }) => {
      pushError = onError;
      return () => {};
    });
    const { result } = renderHook(() => useBrands());
    act(() => {
      pushError(new Error('boom'));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('unsubscribes on unmount', () => {
    const unsub = vi.fn();
    subscribeToBrandsMock.mockImplementation(() => unsub);
    const { unmount } = renderHook(() => useBrands());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

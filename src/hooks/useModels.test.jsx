// src/hooks/useModels.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const subscribeToModelsMock = vi.fn();
vi.mock('@/infra/repositories/firestoreModelRepository.js', () => ({
  subscribeToModels: (...args) => subscribeToModelsMock(...args),
}));

import { useModels } from './useModels.js';

describe('useModels', () => {
  beforeEach(() => {
    subscribeToModelsMock.mockReset();
  });

  it('passes brandId filter through to the repository', () => {
    subscribeToModelsMock.mockImplementation(() => () => {});
    renderHook(() => useModels({ brandId: 'b1' }));
    expect(subscribeToModelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1' }),
    );
  });

  it('subscribes with brandId=null when called with no argument', () => {
    subscribeToModelsMock.mockImplementation(() => () => {});
    renderHook(() => useModels());
    expect(subscribeToModelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: null }),
    );
  });

  it('publishes pushed rows', () => {
    let pushSnapshot = null;
    subscribeToModelsMock.mockImplementation(({ onData }) => {
      pushSnapshot = onData;
      return () => {};
    });
    const { result } = renderHook(() => useModels({ brandId: 'b1' }));
    act(() => {
      pushSnapshot([{ modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true }]);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toHaveLength(1);
  });

  it('re-subscribes when brandId changes', () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    subscribeToModelsMock
      .mockImplementationOnce(() => unsub1)
      .mockImplementationOnce(() => unsub2);
    const { rerender } = renderHook(({ brandId }) => useModels({ brandId }), {
      initialProps: { brandId: 'b1' },
    });
    rerender({ brandId: 'b2' });
    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(subscribeToModelsMock).toHaveBeenCalledTimes(2);
  });
});

// src/hooks/useLicenseSecret.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const getLicenseKeyMock = vi.fn();
const setLicenseKeyMock = vi.fn();
vi.mock('@/infra/repositories/firestoreLicenseSecretRepository.js', () => ({
  getLicenseKey: (...args) => getLicenseKeyMock(...args),
  setLicenseKey: (...args) => setLicenseKeyMock(...args),
}));

const useAuthMock = vi.fn();
vi.mock('@/contexts/AuthContext.jsx', () => ({
  useAuth: () => useAuthMock(),
}));

import { useLicenseSecret } from './useLicenseSecret.js';

describe('useLicenseSecret', () => {
  beforeEach(() => {
    getLicenseKeyMock.mockReset();
    setLicenseKeyMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ user: { uid: 'u1' }, role: 'tech_admin' });
  });

  it('exposes a getKey function that calls the repository once', async () => {
    getLicenseKeyMock.mockResolvedValue('SECRET-VALUE');
    const { result } = renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    let returned;
    await act(async () => {
      returned = await result.current.getKey();
    });
    expect(getLicenseKeyMock).toHaveBeenCalledWith('a1');
    expect(returned).toBe('SECRET-VALUE');
  });

  it('exposes a setKey function that calls the repository with actor', async () => {
    setLicenseKeyMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    await act(async () => {
      await result.current.setKey('NEW-VALUE');
    });
    expect(setLicenseKeyMock).toHaveBeenCalledWith('a1', 'NEW-VALUE', {
      uid: 'u1',
      role: 'tech_admin',
    });
  });

  it('does NOT subscribe — no listener returned, repo never called on mount', () => {
    renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    expect(getLicenseKeyMock).not.toHaveBeenCalled();
    expect(setLicenseKeyMock).not.toHaveBeenCalled();
  });

  it('records errors from setKey without leaking the value', async () => {
    setLicenseKeyMock.mockRejectedValue(new Error('write failed'));
    const { result } = renderHook(() => useLicenseSecret({ assetId: 'a1' }));
    await act(async () => {
      try {
        await result.current.setKey('NEW-VALUE');
      } catch {
        /* swallow */
      }
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).not.toContain('NEW-VALUE');
  });
});

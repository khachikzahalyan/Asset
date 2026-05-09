// src/components/features/assets/LicenseExpiryBadge.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/index.js';

vi.mock('@/hooks/useNotificationSettings.js', () => ({
  useNotificationSettings: () => ({
    data: { licenseExpiryWarningDays: 30 },
    loading: false,
    error: null,
  }),
}));

import { LicenseExpiryBadge } from './LicenseExpiryBadge.jsx';

describe('LicenseExpiryBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when expiry is far in the future', () => {
    const { container } = render(
      <LicenseExpiryBadge expiresAt={new Date('2027-01-01T00:00:00Z')} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders soon-badge when expiry is within threshold', () => {
    render(
      <LicenseExpiryBadge expiresAt={new Date('2026-05-20T00:00:00Z')} />,
    );
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('renders past-badge when expiry is in the past', () => {
    render(
      <LicenseExpiryBadge expiresAt={new Date('2026-04-28T00:00:00Z')} />,
    );
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('renders nothing when expiresAt is null', () => {
    const { container } = render(<LicenseExpiryBadge expiresAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

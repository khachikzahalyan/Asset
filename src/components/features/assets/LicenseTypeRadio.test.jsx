// src/components/features/assets/LicenseTypeRadio.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LicenseTypeRadio } from './LicenseTypeRadio.jsx';

describe('LicenseTypeRadio', () => {
  it('renders the three options', () => {
    render(<LicenseTypeRadio value={null} onChange={() => {}} />);
    expect(screen.getByLabelText(/personal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/business/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enterprise/i)).toBeInTheDocument();
  });

  it('marks the active value', () => {
    render(<LicenseTypeRadio value="business" onChange={() => {}} />);
    expect(screen.getByLabelText(/business/i)).toBeChecked();
    expect(screen.getByLabelText(/personal/i)).not.toBeChecked();
  });

  it('emits the new value on change', () => {
    const onChange = vi.fn();
    render(<LicenseTypeRadio value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/enterprise/i));
    expect(onChange).toHaveBeenCalledWith('enterprise');
  });
});

// src/components/features/assets/BrandSelect.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useBrands.js', () => ({
  useBrands: () => ({
    data: [
      { brandId: 'b1', name: 'HP', isActive: true },
      { brandId: 'b2', name: 'Dell', isActive: true },
      { brandId: 'b3', name: 'Inactive', isActive: false },
    ],
    loading: false,
    error: null,
  }),
}));

import { BrandSelect } from './BrandSelect.jsx';

describe('BrandSelect', () => {
  it('lists only active brands', () => {
    render(<BrandSelect value={null} onChange={() => {}} />);
    expect(screen.getByText('HP')).toBeInTheDocument();
    expect(screen.getByText('Dell')).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('emits brandId on change', () => {
    const onChange = vi.fn();
    render(<BrandSelect value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b2' } });
    expect(onChange).toHaveBeenCalledWith('b2');
  });

  it('emits null when placeholder is selected', () => {
    const onChange = vi.fn();
    render(<BrandSelect value="b1" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

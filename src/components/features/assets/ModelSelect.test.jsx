// src/components/features/assets/ModelSelect.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useModelsMock = vi.fn();
vi.mock('@/hooks/useModels.js', () => ({
  useModels: (...args) => useModelsMock(...args),
}));

import { ModelSelect } from './ModelSelect.jsx';

describe('ModelSelect', () => {
  it('is disabled when brandId is null', () => {
    useModelsMock.mockReturnValue({ data: [], loading: false, error: null });
    render(<ModelSelect brandId={null} value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('lists active models for the brand', () => {
    useModelsMock.mockReturnValue({
      data: [
        { modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true },
        { modelId: 'm2', brandId: 'b1', name: 'X2', isActive: true },
        { modelId: 'm3', brandId: 'b1', name: 'Old', isActive: false },
      ],
      loading: false,
      error: null,
    });
    render(<ModelSelect brandId="b1" value={null} onChange={() => {}} />);
    expect(useModelsMock).toHaveBeenCalledWith({ brandId: 'b1' });
    expect(screen.getByText('X1')).toBeInTheDocument();
    expect(screen.getByText('X2')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('emits modelId on change', () => {
    useModelsMock.mockReturnValue({
      data: [{ modelId: 'm1', brandId: 'b1', name: 'X1', isActive: true }],
      loading: false,
      error: null,
    });
    const onChange = vi.fn();
    render(<ModelSelect brandId="b1" value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } });
    expect(onChange).toHaveBeenCalledWith('m1');
  });
});

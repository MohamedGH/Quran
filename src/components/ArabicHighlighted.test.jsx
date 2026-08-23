import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ArabicHighlighted from './ArabicHighlighted';

describe('ArabicHighlighted Component Tests', () => {
  it('renders Arabic text content correctly', () => {
    render(<ArabicHighlighted text="بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" />);
    expect(screen.getByText(/بِسْمِ/)).toBeInTheDocument();
  });
});

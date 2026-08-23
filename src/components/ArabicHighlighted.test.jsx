import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ArabicHighlighted from './ArabicHighlighted';

describe('ArabicHighlighted Component Tests', () => {
  it('renders Arabic text content correctly', () => {
    render(<ArabicHighlighted text="بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" />);
    expect(screen.getByText(/بِسْمِ/)).toBeInTheDocument();
  });

  it('renders part badges when ld parts are passed', () => {
    const ld = {
      parts: [
        { id: 1, wordIndices: [0, 1], text: 'بِسْمِ اللَّهِ' }
      ]
    };
    render(<ArabicHighlighted text="بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" ld={ld} />);
    expect(screen.getByText('P1')).toBeInTheDocument();
  });
});

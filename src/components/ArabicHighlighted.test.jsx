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

  it('applies active word class when currentMs matches timestamp range', () => {
    const timestamps = {
      words: [
        { chars: [{ char: 'ب', start: 100, end: 200 }] },
        { chars: [{ char: 'ا', start: 300, end: 400 }] }
      ]
    };
    const { container } = render(
      <ArabicHighlighted
        text="ب ا"
        timestamps={timestamps}
        currentMs={150}
      />
    );
    const activeWord = container.querySelector('.word-active');
    expect(activeWord).toBeInTheDocument();
  });
});

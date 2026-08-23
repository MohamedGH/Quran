import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RecitationChecker from './RecitationChecker';

describe('RecitationChecker Component Tests', () => {
  it('renders recitation checker controls', () => {
    render(
      <RecitationChecker
        ayat={{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ' }}
        attempts={[]}
        saveScore={() => {}}
      />
    );
    expect(screen.getByText(/RÉCITATION/i)).toBeInTheDocument();
  });
});

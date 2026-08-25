import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ConcordancePage from './ConcordancePage';

describe('ConcordancePage Component Tests', () => {
  it('renders concordance search interface', () => {
    render(
      <ConcordancePage
        surahs={[]}
        onNavigate={() => {}}
        collections={[]}
      />
    );
    expect(screen.getByPlaceholderText(/Rechercher un mot/i)).toBeInTheDocument();
  });
});

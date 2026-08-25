import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RevisionPage from './RevisionPage';

describe('RevisionPage Component Tests', () => {
  it('renders revision page', () => {
    render(
      <RevisionPage
        learnData={{}}
        surahs={[]}
        setLData={() => {}}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText('CONSOLIDATION DES VERSETS ET MOTS MARQUÉS')).toBeInTheDocument();
  });
});

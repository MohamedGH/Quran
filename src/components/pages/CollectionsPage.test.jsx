import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CollectionsPage from './CollectionsPage';

describe('CollectionsPage Component Tests', () => {
  it('renders collections page', () => {
    render(
      <CollectionsPage
        collections={[]}
        learnData={{}}
        setLData={() => {}}
        onCreateCollection={() => {}}
        onDeleteCollection={() => {}}
        onToggleAyat={() => {}}
        surahs={[]}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText(/AUCUNE COLLECTION/)).toBeInTheDocument();
  });
});

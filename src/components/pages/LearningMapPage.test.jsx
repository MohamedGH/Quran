import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LearningMapPage from './LearningMapPage';

describe('LearningMapPage Component Tests', () => {
  it('renders learning map page', () => {
    render(
      <LearningMapPage
        surahs={[]}
        learnData={{}}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText(/MÉMORISATION/i)).toBeInTheDocument();
  });
});

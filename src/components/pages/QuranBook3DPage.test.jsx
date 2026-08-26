import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import QuranBook3DPage from './QuranBook3DPage';

describe('QuranBook3DPage Component Tests', () => {
  it('renders Quran 3D book canvas view', () => {
    render(
      <MemoryRouter>
        <QuranBook3DPage surahs={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/SOURATES/)).toBeInTheDocument();
  });
});

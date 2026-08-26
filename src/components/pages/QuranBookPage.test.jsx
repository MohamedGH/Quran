import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import QuranBookPage from './QuranBookPage';

describe('QuranBookPage Component Tests', () => {
  it('renders Quran book page view', () => {
    render(
      <MemoryRouter>
        <QuranBookPage surahs={[]} />
      </MemoryRouter>
    );
    expect(screen.getAllByText(/OUVRIR LE LIVRE/).length).toBeGreaterThan(0);
  });
});

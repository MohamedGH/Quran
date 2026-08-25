import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QuranBookPage from './QuranBookPage';

describe('QuranBookPage Component Tests', () => {
  it('renders Quran book page view', () => {
    render(<QuranBookPage surahs={[]} />);
    expect(screen.getByText(/OUVRIR LE MUSHAF 3D/)).toBeInTheDocument();
  });
});

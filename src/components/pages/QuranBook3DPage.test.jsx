import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QuranBook3DPage from './QuranBook3DPage';

describe('QuranBook3DPage Component Tests', () => {
  it('renders Quran 3D book canvas view', () => {
    render(<QuranBook3DPage surahs={[]} />);
    expect(screen.getByText(/MUSHAF 3D/)).toBeInTheDocument();
  });
});

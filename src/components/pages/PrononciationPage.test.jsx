import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PrononciationPage from './PrononciationPage';

describe('PrononciationPage Component Tests', () => {
  it('renders pronunciation guide page', () => {
    render(<PrononciationPage />);
    expect(screen.getByText(/PRONONCIATION/i)).toBeInTheDocument();
  });
});

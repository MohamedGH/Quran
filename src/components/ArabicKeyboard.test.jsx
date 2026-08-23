import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ArabicKeyboard from './ArabicKeyboard';

describe('ArabicKeyboard Component Tests', () => {
  it('renders keyboard when show is true', () => {
    render(<ArabicKeyboard show={true} onClose={() => {}} />);
    expect(screen.getByText('ض')).toBeInTheDocument();
  });
});

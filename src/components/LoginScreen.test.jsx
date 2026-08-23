import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LoginScreen from './LoginScreen';

describe('LoginScreen Component Tests', () => {
  it('renders login form elements', () => {
    render(<LoginScreen onLoggedIn={() => {}} />);
    expect(screen.getByText(/SE CONNECTER/i)).toBeInTheDocument();
  });
});

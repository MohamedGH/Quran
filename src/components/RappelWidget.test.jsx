import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect } from 'vitest';
import { store } from '../store';
import RappelWidget from './RappelWidget';

describe('RappelWidget Component Tests', () => {
  it('renders rappel widget modal', () => {
    render(
      <Provider store={store}>
        <RappelWidget onClose={() => {}} />
      </Provider>
    );
    expect(screen.getByText(/RAPPEL VOCAL/i)).toBeInTheDocument();
  });
});

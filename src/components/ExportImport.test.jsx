import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect } from 'vitest';
import { store } from '../store';
import ExportImport from './ExportImport';

describe('ExportImport Component Tests', () => {
  it('renders export and import buttons', () => {
    render(
      <Provider store={store}>
        <ExportImport surah={{ number: 1, englishName: 'Al-Fatiha' }} />
      </Provider>
    );
    expect(screen.getByText(/EXPORT & IMPORT DES DONNÉES/i)).toBeInTheDocument();
  });
});

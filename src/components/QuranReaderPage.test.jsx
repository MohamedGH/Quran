import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { store } from '../store';
import QuranReaderPage from './QuranReaderPage';

describe('QuranReaderPage Component Tests', () => {
  it('renders Quran reader page view', () => {
    render(
      <Provider store={store}>
        <BrowserRouter>
          <QuranReaderPage
            currentUser={{ email: 'test@example.com' }}
            onNavigate={() => {}}
            listening={false}
            toggleVoice={() => {}}
          />
        </BrowserRouter>
      </Provider>
    );
    expect(screen.getByText('SÉLECTIONNEZ UNE SOURATE')).toBeInTheDocument();
  });
});

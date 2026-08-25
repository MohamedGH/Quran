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

  it('renders timestamp charger button in surah header when surah is selected', () => {
    const mockState = {
      ...store.getState(),
      quran: {
        ...store.getState().quran,
        surahs: [{ number: 1, name: 'الفاتحة', englishName: 'Al-Fatiha', numberOfAyahs: 7 }],
        selectedSurah: 1,
        ayats: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', number: 1 }]
      }
    };
    const testStore = {
      ...store,
      getState: () => mockState,
    };

    render(
      <Provider store={testStore}>
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

    expect(screen.getByText(/CHARGER TIMESTAMPS/)).toBeInTheDocument();
  });
});

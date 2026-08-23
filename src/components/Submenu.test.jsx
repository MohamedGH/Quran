import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { store } from '../store';
import Submenu from './Submenu';

const dummyAyat = {
  numberInSurah: 1,
  text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
  number: 1,
};

describe('Submenu Component Functional Tests', () => {
  it('renders submenu mode buttons and switches content mode', () => {
    const setSubmenuModeMock = vi.fn();

    render(
      <Provider store={store}>
        <Submenu
          ayat={dummyAyat}
          surahNum={1}
          ld={{ learned: false }}
          setLData={() => {}}
          submenuMode="lecture"
          setSubmenuMode={setSubmenuModeMock}
          audioUrl="http://example.com/1.mp3"
          collections={[]}
          ayatInCollections={[]}
        />
      </Provider>
    );

    expect(screen.getByText('LECTURE')).toBeInTheDocument();
    expect(screen.getByText('👁 DÉCOUVERTE')).toBeInTheDocument();
    expect(screen.getByText('APPRENTISSAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByText('👁 DÉCOUVERTE'));
    expect(setSubmenuModeMock).toHaveBeenCalledWith('decouverte');
  });

  it('renders ToRevise mode when mode is reviser', () => {
    render(
      <Provider store={store}>
        <Submenu
          ayat={dummyAyat}
          surahNum={1}
          ld={{ learned: false, toRevise: true }}
          setLData={() => {}}
          submenuMode="reviser"
          setSubmenuMode={() => {}}
          audioUrl="http://example.com/1.mp3"
          collections={[]}
          ayatInCollections={[]}
        />
      </Provider>
    );

    expect(screen.getByText('🔖 MARQUER À RÉVISER')).toBeInTheDocument();
  });

  it('renders cancel button when part selection is active and triggers onCancelPartCreate', () => {
    const onCancelMock = vi.fn();
    render(
      <Provider store={store}>
        <Submenu
          ayat={dummyAyat}
          surahNum={1}
          ld={{ learned: false }}
          setLData={() => {}}
          submenuMode="apprentissage"
          setSubmenuMode={() => {}}
          audioUrl="http://example.com/1.mp3"
          partSelectAyat={1}
          partSelectStep="start"
          onCancelPartCreate={onCancelMock}
          collections={[]}
          ayatInCollections={[]}
        />
      </Provider>
    );

    expect(screen.getByText("① Cliquez le premier mot sur l'ayat ↑")).toBeInTheDocument();
    const cancelBtn = screen.getByText('✕ ANNULER');
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);
    expect(onCancelMock).toHaveBeenCalled();
  });
});

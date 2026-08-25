import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect } from 'vitest';
import { store } from '../store';
import MainPlayer from './MainPlayer';

describe('MainPlayer Component Tests', () => {
  it('renders player controls', () => {
    render(
      <Provider store={store}>
        <MainPlayer
          selectedSurah={{ number: 1, name: 'الفاتحة', englishName: 'Al-Fatiha', numberOfAyahs: 7 }}
          ayats={[{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ' }]}
          currentMainAyat={{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ' }}
          mainAyatIdx={0}
          isMainPlaying={false}
          onPlayMainAyat={() => {}}
          onPauseMainAyat={() => {}}
          loopActive={false}
          setLoopActive={() => {}}
          loopStart={0}
          loopEnd={0}
          loopMax={0}
          loopCount={0}
          setLoopCount={() => {}}
          showLoopBar={false}
          setShowLoopBar={() => {}}
          loopStartInput="1"
          setLoopStartInput={() => {}}
          loopEndInput="1"
          setLoopEndInput={() => {}}
          onApplyLoopInput={() => {}}
          recitatorId="ar.alafasy"
          setRecitatorId={() => {}}
          timestampsMap={{}}
          tskey={() => ''}
          mainCurrentMs={0}
          listening={false}
          toggleVoice={() => {}}
        />
      </Provider>
    );
    expect(screen.getByText('AL-FATIHA')).toBeInTheDocument();
  });
});

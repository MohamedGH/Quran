import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VoiceRecorder from './VoiceRecorder';

describe('VoiceRecorder Component Tests', () => {
  it('renders voice recorder controls', () => {
    render(
      <VoiceRecorder
        ayat={{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ' }}
        surahNum={1}
        originalAudioUrl="http://example.com/1.mp3"
      />
    );
    expect(screen.getByText(/ENREGISTRER/i)).toBeInTheDocument();
  });
});

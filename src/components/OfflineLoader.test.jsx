import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OfflineLoader from './OfflineLoader';

describe('OfflineLoader Component Tests', () => {
  it('renders offline loader interface', () => {
    render(
      <OfflineLoader
        surah={{ number: 1, englishName: 'Al-Fatiha', numberOfAyahs: 7 }}
        recitatorId="ar.alafasy"
      />
    );
    expect(screen.getByText(/TÉLÉCHARGER TOUTES LES SOURATES/i)).toBeInTheDocument();
  });
});

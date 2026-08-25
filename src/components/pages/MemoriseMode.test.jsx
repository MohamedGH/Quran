import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MemoriseMode from './MemoriseMode';

describe('MemoriseMode Component Tests', () => {
  it('renders memorise mode controls', () => {
    render(
      <MemoriseMode
        surahs={[]}
        learnData={{}}
        setLData={() => {}}
      />
    );
    expect(screen.getByText(/MÉMORISATION/i)).toBeInTheDocument();
  });
});

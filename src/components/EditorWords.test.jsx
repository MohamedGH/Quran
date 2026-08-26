import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EditorWords from './EditorWords';

describe('EditorWords Component Tests', () => {
  it('renders editor word list', () => {
    const editTs = {
      words: [{ chars: [{ char: 'بِ', start: 0, end: 100 }] }]
    };
    render(
      <EditorWords
        editTs={editTs}
        currentMs={0}
        setCharField={() => {}}
        captureStart={() => {}}
        captureEnd={() => {}}
        onSave={() => {}}
        onReset={() => {}}
        isDiacritic={() => false}
      />
    );
    expect(screen.getByText('بِ')).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QuestionsModePage from './QuestionsModePage';

describe('QuestionsModePage Component Tests', () => {
  it('renders questions mode setup page', () => {
    render(
      <QuestionsModePage
        surahs={[]}
        learnData={{}}
        setLData={() => {}}
      />
    );
    expect(screen.getByText(/QUESTIONS/i)).toBeInTheDocument();
  });
});

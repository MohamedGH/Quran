import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardPage from './DashboardPage';

describe('DashboardPage Component Tests', () => {
  it('renders dashboard statistics', () => {
    render(
      <DashboardPage
        learnData={{}}
        surahs={[]}
        onNavigate={() => {}}
        goals={{}}
        activity={{}}
        onSetGoal={() => {}}
        onRecordActivity={() => {}}
      />
    );
    expect(screen.getAllByText(/OBJECTIF/i).length).toBeGreaterThan(0);
  });
});

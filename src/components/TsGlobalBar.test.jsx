import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TsGlobalBar from './TsGlobalBar';

describe('TsGlobalBar Component Tests', () => {
  it('renders global timestamp status when showTsBar is true', () => {
    render(
      <TsGlobalBar
        showTsBar={true}
        recitatorId="ar.alafasy"
        ayatsCount={7}
        loadedCount={7}
        timestampsMap={{}}
        onClearTimestamps={() => {}}
      />
    );
    expect(screen.getByText(/CHARGER JSON/i)).toBeInTheDocument();
  });
});

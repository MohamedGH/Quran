import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SyncConsole from './SyncConsole';

describe('SyncConsole Component Tests', () => {
  it('renders sync console widget', () => {
    render(<SyncConsole />);
    expect(screen.getByText(/SYNC LOG/i)).toBeInTheDocument();
  });
});

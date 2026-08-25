import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { store } from '../store';
import OptionsModal from './OptionsModal';

describe('OptionsModal Component Tests', () => {
  it('renders options section headers and toggles switches', () => {
    const onCloseMock = vi.fn();
    render(
      <Provider store={store}>
        <OptionsModal onClose={onCloseMock} />
      </Provider>
    );

    expect(screen.getByText('⚙ OPTIONS')).toBeInTheDocument();
    expect(screen.getByText('PERFORMANCE')).toBeInTheDocument();
    expect(screen.getByText('TAJWEED')).toBeInTheDocument();
    expect(screen.getByText('AFFICHAGE')).toBeInTheDocument();

    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalled();
  });
});

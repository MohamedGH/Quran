import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Header from './Header';

describe('Header Component Functional Tests', () => {
  it('renders title and navigation tabs', () => {
    const setActivePageMock = vi.fn();

    render(
      <Header
        sidebarOpen={true}
        setSidebarOpen={() => {}}
        activePage="quran"
        setActivePage={setActivePageMock}
        listening={false}
        toggleVoice={() => {}}
        showArabicKeyboard={false}
        setShowArabicKeyboard={() => {}}
        showRappel={false}
        setShowRappel={() => {}}
        showUserMenu={false}
        setShowUserMenu={() => {}}
        showOptionsModal={false}
        setShowOptionsModal={() => {}}
        currentUser={{ email: 'test@example.com' }}
        onSignOut={() => {}}
      />
    );

    expect(screen.getByText('STUDY')).toBeInTheDocument();
    expect(screen.getByText('CORAN')).toBeInTheDocument();
    expect(screen.getByText('DASH')).toBeInTheDocument();

    fireEvent.click(screen.getByText('DASH'));
    expect(setActivePageMock).toHaveBeenCalledWith('dashboard');
  });
});

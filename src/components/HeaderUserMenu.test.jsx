import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HeaderUserMenu from './HeaderUserMenu';

const dummyUser = {
  displayName: 'Test User',
  email: 'test@example.com',
};

describe('HeaderUserMenu Component Tests', () => {
  it('renders user details and handles menu item clicks', () => {
    const toggleKeyboardMock = vi.fn();
    const setShowRappelMock = vi.fn();
    const setShowOptionsModalMock = vi.fn();
    const setShowUserMenuMock = vi.fn();
    const onSignOutMock = vi.fn();

    render(
      <HeaderUserMenu
        currentUser={dummyUser}
        showArabicKeyboard={false}
        toggleKeyboard={toggleKeyboardMock}
        showRappel={false}
        setShowRappel={setShowRappelMock}
        setShowOptionsModal={setShowOptionsModalMock}
        setShowUserMenu={setShowUserMenuMock}
        onSignOut={onSignOutMock}
      />
    );

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Clavier Arabe'));
    expect(toggleKeyboardMock).toHaveBeenCalled();
    expect(setShowUserMenuMock).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByText('Se déconnecter'));
    expect(onSignOutMock).toHaveBeenCalled();
  });
});

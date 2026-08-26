import React from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { store } from '../store';
import CloudSyncManager from './CloudSyncManager';

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: vi.fn(() => Promise.resolve()),
  onSnapshot: vi.fn(() => vi.fn()),
}));

describe('CloudSyncManager Component Tests', () => {
  it('mounts without crashing when uid is provided', () => {
    const { container } = render(
      <Provider store={store}>
        <CloudSyncManager uid="test-uid" />
      </Provider>
    );
    expect(container).toBeInTheDocument();
  });
});

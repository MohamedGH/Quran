import { describe, it, expect } from 'vitest';
import { store, quranActions, uiActions, playerActions, collectionsActions, setLDataThunk, sel } from './store';

describe('Redux Store Unit Tests', () => {
  it('updates selected surah via quranActions', () => {
    store.dispatch(quranActions.setSelectedSurah(2));
    const state = store.getState();
    expect(sel.selectedSurah(state)).toBe(2);
  });

  it('toggles sidebar state via uiActions', () => {
    const prev = sel.sidebarOpen(store.getState());
    store.dispatch(uiActions.toggleSidebar());
    expect(sel.sidebarOpen(store.getState())).toBe(!prev);
  });

  it('sets playing ayat number via playerActions', () => {
    store.dispatch(playerActions.setPlayingAyatNum(255));
    const state = store.getState();
    expect(sel.playingAyatNum(state)).toBe(255);
  });

  it('creates and manages collections via collectionsActions', () => {
    store.dispatch(collectionsActions.createCollection('Favoris'));
    let collections = sel.collections(store.getState());
    const fav = collections.find(c => c.name === 'Favoris');
    expect(fav).toBeDefined();

    store.dispatch(collectionsActions.toggleAyatInCollection({
      collId: fav.id,
      ayatEntry: { surahNum: 1, ayatNum: 1, text: 'بِسْمِ اللَّهِ' }
    }));
    collections = sel.collections(store.getState());
    const updatedFav = collections.find(c => c.id === fav.id);
    expect(updatedFav.ayats.length).toBe(1);
  });

  it('updates learnData via setLDataThunk', () => {
    store.dispatch(setLDataThunk(1, 1, prev => ({ ...prev, learned: true })));
    const learnData = sel.learnData(store.getState());
    expect(learnData['1:1']?.learned).toBe(true);
  });
});

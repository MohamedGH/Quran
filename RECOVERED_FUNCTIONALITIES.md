# Recovered Functionalities Documentation

This document logs all functionalities that have been recovered from the monolithic `src/App.jsx` and restored into the modular component architecture on branch `refactor-extract-app-components-588390338694886294`.

---

## 1. Recovered Functionalities in `src/components/Submenu.jsx` (`DecouverteMode`)

### A. Sequential Audio Word Playback
- **Sequential Word Audio (`playWordsSequential`, `playWordAsync`)**:
  - Restored sequential word-by-word audio playback when revealing new words in `DecouverteMode`.
  - Uses forced-alignment timestamps (`timestamps.words`) to play audio segments for words from the current position up to the clicked word.
  - Automatically handles cancellation tokens (`seqTokenRef`) so clicking a new word immediately stops any previous audio sequence and starts the new sequence.

### B. Word & Letter Marking for Revision (`useToRevise`, `markMode`)
- **Revision Marking Toggle (`markMode`)**:
  - Restored the `🔖 MARQUER MOTS/LETTRES` toggle button inside `DecouverteMode`.
  - Integrates with `useToRevise` hook to allow users to click revealed words and mark them for targeted revision (`selWords`).
- **Letter Drill-Down Expansion**:
  - Restored the letter picker panel (`splitArabicChars`) for marked words.
  - Allows character-level selection (`selChars`) to flag specific Arabic letter clusters for revision.
  - Color-coded visual badges and interactive letter selection UI.

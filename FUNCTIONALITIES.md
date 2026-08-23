# List of Functionalities in `src/App.jsx`, `src/store.js`, and `public/audio-sw.js`

This document details all functionalities found across the core files of the application: `src/App.jsx`, `src/store.js`, and `public/audio-sw.js`.

---

## 1. Functionalities in `src/App.jsx`

`src/App.jsx` serves as the primary application file containing the user interface, routing, audio handling, API integrations, voice recognition, and interactive study modules.

### A. Firebase Authentication & Cloud Firestore Integration
- **Firebase Initialization**: Initializes Firebase app, Auth, and Firestore instances using environment variables (`VITE_FIREBASE_*`).
- **User Authentication**:
  - Email & Password sign-in and sign-up (`signInWithEmailAndPassword`, `createUserWithEmailAndPassword`).
  - Google OAuth Authentication via popup or redirect (`signInWithPopup`, `signInWithRedirect`, `GoogleAuthProvider`).
  - Sign-out functionality and user profile display (`signOut`, `updateProfile`).
  - Auth state listener (`onAuthStateChanged`).
- **Cloud Firestore Synchronization**:
  - Real-time synchronization of user learning progress, custom collections, reading history, and activity logs.

### B. Audio Recording Abstraction (`createAudioRecorder`)
- **Cross-Platform Audio Recorder**:
  - **Android (Capacitor Native)**: Uses `@capgo/capacitor-audio-recorder` with permission management and native file URL conversion (`Capacitor.convertFileSrc`).
  - **Web / iOS (MediaRecorder)**: Uses native `MediaRecorder` API with WebAudio `AudioContext` and `GainNode` to boost microphone volume (configurable gain factor, default 4.0).

### C. Reciter & Bitrate Management
- **Multi-Reciter Support**: Contains a list of reciters (e.g., Mishary Al-Afasy, Abdul Basit, Al-Husary, Al-Minshawi, etc.) with metadata (country flag, ID, label).
- **Dynamic Bitrate Detection & Fallback**:
  - Queries AlQuran Cloud API for available audio bitrates per reciter (e.g., 128kbps, 64kbps, 192kbps).
  - Remembers working bitrates per reciter in `localStorage`.
  - Auto-falls back to lower/alternative bitrates if an audio request 404s (`markBitrateBad`).

### D. Quran Data API & IndexedDB Caching
- **API Fetching (`https://api.alquran.cloud/v1`)**:
  - `fetchSurahs()`: Retrieves the list of 114 Surahs.
  - `fetchSurahTranslation(sn, lang)`: Fetches Surah translations in multiple languages (FR, EN, TR, UR, DE, ES, ID, RU).
  - `fetchAyats(n)` / `fetchSurahSimple(n)` / `fetchSurahDefault(n)`: Fetches Arabic text and metadata for Ayats.
  - `fetchSurahMeta(n)` / `fetchAyahMeta(sn, an)` / `fetchPageMeta(pageNum)`: Fetches Juz, Hizb, Page, and word count metadata.
  - `fetchQuranPage(pageNum)`: Fetches full page content for Uthmani mushaf view.
- **IndexedDB Quran Cache (`quran-ts-cache`)**:
  - Caches API responses (surahs, translations, ayats, page metadata) in IndexedDB (`quran` store) to minimize network usage and enable offline functionality.
- **Timestamps Loader (`loadTimestampsForSurah`)**:
  - Loads word/character forced-alignment JSON timestamp files locally (Android assets) or via server API (`/sourate/{recitatorId}/surah_XXX.json`), cached in IndexedDB (`timestamps` store).

### E. Phonetic Normalization & Recitation Scoring Engine
- **Arabic Text Normalization (`normalizeArabic`)**:
  - Unifies Alef/Hamza variants (ٱ, أ, إ, آ, ؤ, ئ → ا).
  - Normalizes Teh Marbuta (ة/ۃ), Alef Maqsura (ى), Heh (ہ/ھ), and Dagger Alif (ٰ).
  - Strips Tashkeel (vowel marks), Tatweel/Kashida, and Quranic punctuation marks.
- **Silent Letter Detection (`getSilentIndices`)**:
  - Identifies silent letters in words according to Tajweed rules (e.g., Hamza Wasl ٱ in connected speech, Alif Al-Fariqa ۥ/وا, silent Lam Shamsiyya).
- **Hamza Wasl Vowel Determination (`getWaslVowel`)**:
  - Determines the starting vowel (Fatha, Damma, Kasra) when Hamza Wasl is pronounced at sentence start.
- **Phonetic Distance & Alignment (`phonoCost`, `levenshteinChars`, `levenshteinAlign`, `diffWord`, `compareRecitation`)**:
  - Uses Levenshtein distance with phonetic proximity matrix (`PHONO_PAIRS`) to evaluate articulation similarity (makhraj and sifa).
  - Distinguishes between exact matches, minor phonetic variants ('near'), missing characters/words ('del'), extra insertions ('ins'), and silent letters ('silent').
  - Calculates percentage accuracy score for recitations.

### F. Speech Recognition & Voice Commands (`RecitationChecker`, Voice Navigation)
- **Web Speech API & Native Android Speech Bridge**:
  - Supports continuous speech recognition in Arabic (`ar-SA`).
  - Integrated speech recognition bridge for native Android apps (`window.Android.startSpeechRecognition`).
- **Voice Commands**: Voice-based navigation and Surah selection via voice matching against `SURAH_NAMES`.

### G. Virtual Arabic Keyboard (`ArabicKeyboard`)
- **On-Screen Arabic Keyboard Component**:
  - Provides full Arabic alphabet layout, Hamza toggle keys, backspace, space, and a dedicated diacritics bar (Fatha, Damma, Kasra, Tanwin, Shadda, Sukun, Dagger Alif).
  - Integrates with text input elements via `ArabicKeyboardContext`.

### H. Study & Reading Modes / Components
1. **Header & Navigation (`AppInner`)**:
   - Page tabs (Quran, Prononciation, Dashboard, Concordance, Collections, Révision, Questions, Apprentissage).
   - Reciter selection modal/sheet.
   - User profile dropdown menu & authentication status.
   - Global audio player bar (play/pause, seek, speed, A-B loop bar with start/end verse selector and repetition count).
2. **Ayat Display & Audio Highlighting (`PlayingArabicHighlighted`, `ArabicHighlighted`)**:
   - Zero-rerender DOM-ref based character highlighting synced with audio playback milliseconds.
   - Optional Tajweed rule color highlighting (Qalqala, Madd, Izhar, Idgham).
3. **Submenu Modes per Verse (`Submenu`)**:
   - **Lecture**: Verse audio playback, timestamp editing/adjustment (`EditorWords`), personal voice recording (`VoiceRecorder`) with side-by-side comparison (`ComparePlayer`).
   - **Découverte**: Progressive word-by-word reveal in reading order with sequential audio playback and word/letter marking.
   - **Apprentissage**: Verse learning breakdown into smaller custom parts (`PartItem`), part creation from audio (`CreatePartFromAudio`), multi-step learning (Listen → Memorize → Recite), word highlights, and unknown words marking.
   - **Infos**: Verse metadata display (Juz, Hizb, Page, word count, translation).
   - **Aide Mémoire**: Verse memory aid with interactive word masking, hint reveals, and word spelling check.
   - **Révision Écriture**: Verse writing revision mode with character-by-character validation (`RevisionEcritureMode`).
   - **Tajweed**: Interactive Tajweed exercise mode (`TajweedExercice`).
   - **ToRevise**: Panel to flag verses for revision (`ToRevisePanel`).
   - **Collections**: Verse collection assignment (`AyatCollectionsTab`).
4. **Interactive 3D Quran Book View (`QuranBookPage`, `QuranBook3DPage`)**:
   - Realistic 3D turning book interface with page flips, hardcover spine, medallion, and Mushaf page layout.
5. **Questions & Quizzes Engine (`QuestionsMode`, `QuestionsModePage`)**:
   - Interactive quiz types:
     - **Flashcard / Text Answer**: Type or speak the missing text.
     - **Reconstruct Question**: Reorder shuffled words of a verse.
     - **Compare Verse Question**: Identify differences between verses.
     - **Find Surah Question**: Identify which Surah a verse belongs to.
     - **Unknown Word Question**: Test comprehension of marked unknown words.
     - **Revise Part Question**: Quiz on custom verse parts.
     - **Page Structure Question**: Quiz on verse locations within pages/surahs.
6. **Concordance & Text Search Engine (`ConcordancePage`, `ConcordGroup`, `SharedGroup`)**:
   - Full-text search across all 114 Surahs with root word matching.
   - Grouping of identical or similar verse phrases across the Quran.
   - Cross-verse linking and saving to custom collections.
7. **Verse Collections (`CollectionsPage`, `CollectionModal`, `CollectionAyatRow`)**:
   - Create, edit, rename, and delete custom verse playlists/collections.
   - Search across saved collections.
8. **Dashboard & Learning Analytics (`DashboardPage`, `KpiWidget`, `ActivityCalendar`, `GoalsPanel`)**:
   - Progress KPIs: Total learned verses, total read verses, total words, total parts, completed Surahs.
   - Interactive activity heatmaps & streak counter.
   - Custom daily/weekly goal configuration (Daily verses read, Daily parts learned, Weekly targets).
9. **Pronunciation Module (`PrononciationPage`)**:
   - Interactive grid of Arabic letters with Makhraj (articulation points) tags, forms (isolated, initial, medial, final), Harakat audio samples, and audio playback.
10. **Data Sync & Backup (`CloudSyncManager`, `SyncConsole`, `ExportImport`)**:
    - JSON data export/import for local backups.
    - Cloud synchronization console for tracking Firestore sync state.

---

## 2. Functionalities in `src/store.js`

`src/store.js` provides centralized Redux state management using `@reduxjs/toolkit` with persistence via `localStorage`.

### A. LocalStorage Persistence Helpers
- `load(key, fallback)`: Safely loads and parses JSON values from `localStorage`.
- `save(key, value)`: Safely serializes and saves values to `localStorage`.

### B. Redux Slices & Reducers
1. **`ui` (Navigation & Display Preferences)**:
   - State: `activePage`, `sidebarOpen`, `showTsBar`, `showLoopBar`, `showVoiceHelp`, Tajweed toggles (`showQalqala`, `showMadd`, `showIzhar`, `showIdgham`), `announceNum`, `showParts`, `spellCheck`, performance toggles (`enableTimestamps`, `enableLetterByLetter`, `enableAnimations`, `enableHeavyCompute`).
   - Actions: Page switching, sidebar toggles, preference toggles with `localStorage` persistence.
2. **`quran` (Surah & Verse Navigation State)**:
   - State: `surahs`, `selectedSurah`, `ayats`, `loadingSurahs`, `loadingAyats`, `search`, `openAyatNum`, `submenuMode`, `lastAyatBySurah`.
   - Actions: Updating Surah list, setting active Surah/Ayats, setting search filters, recording last read verse position per Surah.
3. **`player` (Audio Playback & Loop State)**:
   - State: `isMainPlaying`, `mainAyatIdx`, `playingAyatNum`, `mainCurrentMs`, `timestampsMap`, loop configuration (`loopActive`, `loopStart`, `loopEnd`, `loopMax`, `loopCount`, `loopStartInput`, `loopEndInput`, `loopBySurah`), `playingPart`, `partCurrentMs`, `localPlaying`.
   - Actions: Controlling main audio player, updating timestamp map, configuring A-B loop intervals, tracking verse part playback.
4. **`learn` (Verse Learning & Mastery Data)**:
   - State: `data` (dictionary keyed by `surahNum:ayatNum` containing read counts, completion timestamps, custom parts, learned words), part selection state (`partSelectAyat`, `partSelectStep`, `partSelectStart`).
   - Actions: Updating learning entries, part creation selection, restoring state from cloud backups.
5. **`collections` (Verse Collections)**:
   - State: `list` (array of user collection objects), `collModal` state.
   - Actions: Creating/deleting collections, toggling verses in collections, modal management, restoring from cloud.
6. **`voice` (Voice & Speech Recognition UI)**:
   - State: `listening`, `voiceToast` notifications, `showVoiceInput`, `voiceInputText`.
   - Actions: Updating microphone listening state, managing voice toast messages and input text.
7. **`goals` (Goal Settings & Daily Activity Tracking)**:
   - State: `dailyAyats`, `dailyParts`, `weeklyAyats`, `targetSurah`, `targetDate`, `activity` (dictionary keyed by `YYYY-MM-DD` tracking read/learned counts).
   - Actions: Setting targets, recording daily activity deltas, cloud restoration.
8. **`revision` (Quiz Mastery Statistics)**:
   - State: `mastery` (dictionary keyed by `surahNum:ayatNum` storing `{ correct, total }` counts for questions).
   - Actions: Submitting question answers, resetting Surah mastery statistics, cloud restoration.

### C. Redux Thunks & Selectors
- **Thunk `setLDataThunk(surahNum, ayatNum, fn)`**:
  - Updates verse learning state in `learn.data`.
  - Stamps timestamps (`createdAt`, `updatedAt`, `learnedAt`).
  - Automatically records daily activity into `goals.activity` upon marking verses or parts as learned.
- **Selectors (`sel.*`)**:
  - Exported selector functions for UI state, Quran data, audio player state, learning progress, collections, voice state, goals, and Surah mastery percentages (`revisionMastery`).

---

## 3. Functionalities in `public/audio-sw.js`

`public/audio-sw.js` is a dedicated Service Worker responsible for intercepting audio requests and caching MP3 files in IndexedDB to enable offline recitation listening.

### A. Lifecycle Management
- **`install` event**: Triggers `self.skipWaiting()` for immediate activation.
- **`activate` event**: Triggers `self.clients.claim()` to control all clients without waiting for a reload.

### B. IndexedDB Audio Storage (`quran-ts-cache`)
- Opens IndexedDB database `quran-ts-cache` (version 3).
- Maintains object stores: `timestamps`, `quran`, and `audio`.
- Helper functions:
  - `idbGet(key)`: Retrieves cached audio ArrayBuffer by key (e.g., `"7456.mp3"`).
  - `idbSet(key, buf)`: Saves audio ArrayBuffer into the `audio` object store.

### C. Request Interception & Offline Caching
- **`fetch` event listener**:
  - Intercepts requests matching MP3 audio patterns (`/audio-proxy/*.mp3` in dev environment, or `https://cdn.islamic.network/*.mp3` in production).
  - **Step 1 (IDB Cache Lookup)**: If the requested MP3 is found in IndexedDB, returns a `Response` directly with `audio/mpeg` MIME type and `Accept-Ranges: bytes` header.
  - **Step 2 (Network Fetch & Cache)**: If not in IDB, fetches the MP3 file from the network/proxy, reads its `ArrayBuffer`, caches it in IndexedDB for future offline use, and returns the audio response.
  - **Offline Fallback**: Returns a 503 "Offline" HTTP Response if both cache lookup and network fetch fail.

### D. On-Demand Audio Pre-caching
- **`message` event listener (`PRECACHE_AUDIO`)**:
  - Listens for messages containing an array of audio URLs (`urls`).
  - Iterates through URLs and fetches/caches any missing MP3 audio files into IndexedDB ahead of time.

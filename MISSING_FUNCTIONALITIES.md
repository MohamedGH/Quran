# Missing Functionalities Documentation

This document lists all detailed, specific, and advanced functionalities from `src/App.jsx`, `src/store.js`, `public/audio-sw.js`, and the refactored component structure that were missing or omitted in high-level summaries.

---

## 1. Missing Submenu & Verse Study Functionalities (`src/App.jsx` & Submenu components)

### A. Extended Submenu Navigation Modes
- **Mode Toggle & Dynamic Badges**:
  - `lecture`: Full Verse Audio Player with interactive timestamp waveform & personal voice recorder.
  - `decouverte`: Word-by-word progressive reveal in RTL reading order.
  - `apprentissage`: Breakdown of verses into custom chunks/parts, part-level Audio Player, multi-step learning pipeline.
  - `collections`: Collection badge showing active collection count for the verse (`🗂 COLLECTIONS (N)`), opening modal to add/remove verse.
  - `infos`: Metadata inspection (Juz, Hizb, Page, word count, translation).
  - `memoire`: Aide-mémoire mode with word masking, hint reveals, and spelling validation.
  - `reviser`: Revision panel (`ToRevisePanel`) flagging verse/words for targeted review.
  - `tajweed`: Interactive Tajweed matching exercise (`TajweedExercice`).
  - `revision`: Character-by-character verse writing practice (`RevisionEcritureMode`).
  - **Bookmark Button (🔖)**: Toggle verse revision state with golden visual indicator.
  - **Loop Button (↺)**: Toggle single-verse audio loop.

### B. Timestamp Editor (`EditorWords`)
- Interactive word-by-word and character-by-character timestamp adjustment.
- **Audio Capture Buttons (⊙)**: Captures audio player position `currentTime` in milliseconds for letter start (`startMs`) and end (`endMs`).
- **Character Audio Preview (▶/⏸)**: Play individual letter audio slice based on `start`/`end` millisecond values.
- **Diacritic & Degenerate Handling**: Ignores diacritics in manual timestamping; warns on degenerate `start === end` character boundaries.
- **Export**: Generates downloadable JSON timestamp files (`timestamps_ayat_X.json`).

### C. Voice Recorder & Side-by-Side Comparison (`VoiceRecorder`, `ComparePlayer`)
- **Gain Control**: Amplification slider (1.0x to 8.0x) applying WebAudio `GainNode` to microphone stream.
- **Audio Storage**: Stores voice recordings as binary blobs in IndexedDB database `QuranRecordings`.
- **Side-by-Side Compare (`ComparePlayer`)**:
  - Simultaneous dual audio playback (`playBoth`, `stopBoth`, `pauseBoth`) playing user recording and official reciter audio synchronously.
  - Individual progress bars and controls for user audio (`🎙 MOI`) vs reciter audio (`📖 REF`).

### D. Advanced Learning Mode & Part Creator (`ApprentissageMode`, `CreatePartFromAudio`, `PartAudioPlayer`)
- **Audio-Based Part Creation (`CreatePartFromAudio`)**:
  - Set `DÉBUT` and `FIN` timestamps on the audio timeline.
  - Auto-calculates which Arabic words fall within the marked timestamp interval.
  - Highlights covered words and excludes previously assigned words.
- **Part Learning Pipeline (`PartItem`)**:
  - 3-step learning progression:
    1. **① ÉCOUTER**: Audio playback with highlighted text.
    2. **② MÉMORISER**: Audio playback with text blurred (`hideText={true}`).
    3. **③ RÉCITER**: Interactive recitation test on the specific verse part.
- **Interactive Verse Highlighting & Word Selection**:
  - **Mots à surligner**: Click words on the verse to highlight them in yellow/gold (`highlight`).
  - **Mots inconnus**: Click unknown words on the verse (`unknownWords`), automatically detecting other occurrences with the same Arabic root (`arabicRoot`) across the verse.

### E. Writing & Memory Modes (`AideMemoireMode`, `RevisionEcritureMode`)
- **Aide-Mémoire (`AideMemoireMode`)**:
  - Progressive word hiding/masking options: Hide all words, hide alternate words, show first letter only.
  - Interactive click-to-reveal word hints.
  - Spelling validation mode against the Quranic text.
- **Revision Ecriture (`RevisionEcritureMode`)**:
  - Character-by-character Arabic typing validation with real-time feedback.
  - Diacritic sensitivity toggles (`spellCheck`).

### F. Tajweed Interactive Exercise (`TajweedExercice`)
- Interactive matching game pairing verse letters/words with Tajweed rules (Qalqala, Madd, Izhar, Idgham).
- Shuffled character and rule buttons with color-coded feedback and score calculation (`✓ Parfait !` or ratio score).

---

## 2. Missing Quiz & Question Types (`QuestionsMode`, `QuestionsModePage`)

### A. Quiz Engine & Multi-Question Types
- **Flashcard / Text Answer Question**: Type or speak verse text with real-time accuracy scoring.
- **Reconstruct Question (`ReconstructQuestion`)**: Drag/click shuffled words of a verse into correct Quranic order.
- **Compare Verse Question (`CompareVerseQuestion`)**: Identify differences and similarities between similar Quranic verses.
- **Find Surah Question (`FindSurahQuestion`)**: Identify which Surah a given verse belongs to from multiple choice options.
- **Unknown Word Question (`UnknownWordQuestion`, `UnknownPickQuestion`)**: Test recall and identification of user-marked unknown words.
- **Revise Part Question (`RevisePartQuestion`)**: Quiz specifically targeting user-created verse parts.
- **Page Structure Question (`PageStructureQuestion`)**: Test knowledge of verse positions on the Mushaf page, Juz, and Hizb.

### B. Mastery Tracking & Scoring Metrics
- **Mastery Bar & Badge (`MasteryBar`, `MasteryBadge`)**: Visual percentage bars and badges for Surah/range completion.
- **Mastery Debug View (`MasteryDebug`)**: Inspect raw verse scores, attempts, and revision status.

---

## 3. Missing Page Views & Navigation Features

### A. 3D Interactive Quran Book (`QuranBook3DPage`, `QuranBookPage`)
- Realistic CSS 3D transformed Mushaf book interface.
- 3D hardcover with gold foil design, medallion ornament, and leather spine element.
- Page turning animations (`qbook-flip-fwd`, `qbook-flip-bwd`) with realistic paper grain SVG filters and page shadows.
- Page navigation controls, progress bar, and direct Surah selector.

### B. Learning Map Page (`LearningMapPage`)
- Visual overview map of all 114 Surahs categorized by learning status (Learned, In Progress, Unread).
- Quick navigation to specific Surahs and study modes.

### C. Concordance & Root Phrase Search Engine (`ConcordancePage`)
- Full-text and root-word search across all 114 Surahs.
- Grouping of identical phrases (`ConcordGroup`) and cross-verse links (`SharedGroup`).
- In-line audio preview player (`ConcordInlinePlayer`).
- Direct navigation to verses and collection creation from search results.

### D. Activity Analytics & Dashboard Features (`DashboardPage`, `ActivityCalendar`, `ActivityBarChart`)
- **Activity Calendar (`ActivityCalendar`)**: Monthly calendar grid highlighting daily study activity, streak goals reached, and partial targets.
- **Bar Chart (`ActivityBarChart`)**: Visual daily activity bars with goal baseline indicator (`goalLine`).
- **KPI Metrics (`KpiWidget`)**: Total learned verses, total read verses, word counts, active Surahs, and percentage completion.
- **Donut Chart (`DonutChart`) & Mini Bar Chart (`MiniBarChart`)**: Visual ring charts for goal progress.

### E. Reminders & Options (`RappelWidget`, `OptionsModal`, `CloudSyncManager`, `SyncConsole`)
- **Rappel Widget (`RappelWidget`)**: Daily study reminder popup with motivation quotes and quick action links.
- **Options Modal (`OptionsModal`)**: Settings modal for performance toggles (timestamps, letter-by-letter rendering, animations, heavy compute).
- **Cloud Sync Console (`CloudSyncManager`, `SyncConsole`)**: Real-time status console for Firestore synchronization, manual sync triggers, and user UID copy.
- **Offline Loader (`OfflineLoader`)**: Pre-downloads and caches full Surahs and audio files for offline use.
- **Export / Import (`ExportImport`)**: Export user learning progress, custom collections, and settings to JSON file, or restore from local JSON file.

---

## 4. Missing Redux Store Functionalities (`src/store.js`)

### A. Revision Mastery Slice (`revisionSlice`)
- State: `mastery` dictionary storing `{ correct, total }` answer counts per verse key (`surahNum:ayatNum`).
- Action `submitQuestionAnswer`: Records quiz attempt results and updates total/correct counters.
- Action `resetSurahMastery`: Resets quiz mastery statistics for an entire Surah.
- Selector `revisionMastery`: Calculates Surah mastery percentage (verses with ≥75% success rate).

### B. Enhanced Performance & UI Toggles
- `enableTimestamps`: Toggle forced-alignment word/character highlighting.
- `enableLetterByLetter`: Toggle character-level DOM rendering.
- `enableAnimations`: Toggle UI transition animations.
- `enableHeavyCompute`: Toggle compute-intensive phonetic distance calculations.

### C. Automatic Activity Logging (`setLDataThunk`)
- Automatically records daily activity into `goals.activity` upon marking verses or verse parts as learned.
- Manages `createdAt`, `updatedAt`, and `learnedAt` timestamps for verse entries.

---

## 5. Missing Service Worker & Audio Cache Functionalities (`public/audio-sw.js`)

### A. Audio Request Proxy Interception
- Intercepts both dev environment `/audio-proxy/*.mp3` and production `https://cdn.islamic.network/*.mp3` requests.
- Converts fetched MP3 responses to `ArrayBuffer` and stores them in IndexedDB `audio` store under `quran-ts-cache`.

### B. Pre-Caching Engine (`PRECACHE_AUDIO`)
- Receives list of audio URLs via Service Worker `message` event.
- Fetches and stores missing audio files in IndexedDB in the background ahead of offline playback.

### C. Response Header Formatting
- Constructs synthetic HTTP 200 responses from cached IndexedDB `ArrayBuffer` with `Content-Type: audio/mpeg`, `Content-Length`, and `Accept-Ranges: bytes` headers.

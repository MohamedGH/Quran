import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSelector, useDispatch, shallowEqual } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  sel, uiActions, quranActions, playerActions,
  setLDataThunk
} from "../store";
import { masteryColor } from "../utils/arabicUtils";
import ArabicHighlighted from "./ArabicHighlighted";
import Submenu from "./Submenu";
import TsGlobalBar from "./TsGlobalBar";
import MainPlayer from "./MainPlayer";
import { fetchSurahSimple } from "../services/quranApi";

export default function QuranReaderPage({
  currentUser,
  onNavigate,
  listening,
  toggleVoice,
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux Selectors
  const surahs          = useSelector(sel.surahs);
  const selectedSurahNum= useSelector(sel.selectedSurah);
  const ayats           = useSelector(sel.ayats);
  const openAyatNum     = useSelector(sel.openAyatNum);
  const submenuMode     = useSelector(sel.submenuMode);
  const learnData       = useSelector(sel.learnData, shallowEqual);
  const collections     = useSelector(sel.collections, shallowEqual);

  const showQalqala     = useSelector(sel.showQalqala);
  const showMadd        = useSelector(sel.showMadd);
  const showIzhar       = useSelector(sel.showIzhar);
  const showIdgham      = useSelector(sel.showIdgham);
  const showParts       = useSelector(sel.showParts);
  const showTsBar       = useSelector(sel.showTsBar);
  const showLoopBar     = useSelector(sel.showLoopBar);

  const isMainPlaying   = useSelector(sel.isMainPlaying);
  const mainAyatIdx     = useSelector(sel.mainAyatIdx);
  const playingAyatNum  = useSelector(sel.playingAyatNum);
  const mainCurrentMs   = useSelector(sel.mainCurrentMs);
  const timestampsMap   = useSelector(sel.timestampsMap, shallowEqual);

  const loopActive      = useSelector(sel.loopActive);
  const loopStart       = useSelector(sel.loopStart);
  const loopEnd         = useSelector(sel.loopEnd);
  const loopMax         = useSelector(sel.loopMax);
  const loopCount       = useSelector(sel.loopCount);
  const loopStartInput  = useSelector(sel.loopStartInput);
  const loopEndInput    = useSelector(sel.loopEndInput);

  // Local component states
  const [pageMode, setPageMode]             = useState(false);
  const [activePageCoran, setActivePageCoran] = useState(null);
  const [showSurahInfo, setShowSurahInfo]   = useState(false);
  const [showGoToAyat, setShowGoToAyat]     = useState(false);
  const [goToInput, setGoToInput]         = useState("");
  const [recitatorId, setRecitatorId]       = useState("Alafasy_128kbps");

  const selectedSurah = (surahs || []).find(s => s.number === selectedSurahNum) || null;
  const currentMainAyat = ayats[mainAyatIdx] || null;

  const mainAudioRef = useRef(null);

  const tskey = (sn, an) => `${recitatorId}:${sn}:${an}`;

  const handleSetLData = (surahNum, ayatNum, updater) => {
    dispatch(setLDataThunk(surahNum, ayatNum, updater));
  };

  const playMainAyat = (idx) => {
    if (idx < 0 || idx >= ayats.length) return;
    dispatch(playerActions.setMainAyatIdx(idx));
    dispatch(playerActions.setPlayingAyatNum(ayats[idx].numberInSurah));
    dispatch(playerActions.setIsMainPlaying(true));
  };

  const pauseMainAyat = () => {
    dispatch(playerActions.setIsMainPlaying(false));
    dispatch(playerActions.setPlayingAyatNum(null));
  };

  const handleApplyLoopInput = (sVal, eVal) => {
    const s = parseInt(sVal) - 1;
    const e = parseInt(eVal) - 1;
    if (!isNaN(s) && s >= 0 && s < ayats.length) dispatch(playerActions.setLoopStart(s));
    if (!isNaN(e) && e >= s && e < ayats.length) dispatch(playerActions.setLoopEnd(e));
  };

  if (!selectedSurah) {
    return (
      <div className="empty-state">
        <div className="empty-arabic">القرآن الكريم</div>
        <span>SÉLECTIONNEZ UNE SOURATE</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={() => navigate('/book')}
            style={{
              fontSize: 9, letterSpacing: 1.5, padding: '7px 16px',
              fontFamily: "'Cinzel',serif", background: 'rgba(201,168,76,.08)',
              border: '1px solid rgba(201,168,76,.3)', color: 'var(--gold2)',
              borderRadius: 8, cursor: 'pointer'
            }}
          >
            📖 LIVRE CSS
          </button>
          <button
            onClick={() => navigate('/book3d')}
            style={{
              fontSize: 9, letterSpacing: 1.5, padding: '7px 16px',
              fontFamily: "'Cinzel',serif", background: 'rgba(201,168,76,.14)',
              border: '1px solid rgba(201,168,76,.5)', color: 'var(--gold)',
              borderRadius: 8, cursor: 'pointer'
            }}
          >
            ✨ LIVRE 3D WEBGL
          </button>
        </div>
      </div>
    );
  }

  const isSurahFullyLearned = ayats.length > 0 && ayats.every(a => (learnData[`${selectedSurah.number}:${a.numberInSurah}`]?.learned));
  const markAllLearned   = () => ayats.forEach(a => handleSetLData(selectedSurah.number, a.numberInSurah, d => ({ ...d, learned: true })));
  const unmarkAllLearned = () => ayats.forEach(a => handleSetLData(selectedSurah.number, a.numberInSurah, d => ({ ...d, learned: false })));

  const loadedCount = ayats.filter(a => !!timestampsMap[tskey(selectedSurah.number, a.numberInSurah)]).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header toolbar */}
      <div className="surah-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="surah-header-ornament">{selectedSurah.name}</div>
          {selectedSurah.number !== 9 && (
            <div className="surah-header-bismillah" style={{ fontFamily: "'Amiri Quran',serif", fontSize: 18, color: 'var(--gold)', direction: 'rtl', opacity: .8, lineHeight: 1.3 }}>
              بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
            </div>
          )}
        </div>
        <div className="surah-header-title">
          {selectedSurah.englishName.toUpperCase()} · {selectedSurah.numberOfAyahs} AYATS
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {ayats.length > 0 && (
            <button
              onClick={isSurahFullyLearned ? unmarkAllLearned : markAllLearned}
              style={{
                fontSize: 8, letterSpacing: 1, padding: '4px 10px', borderRadius: 20,
                fontFamily: "'Cinzel',serif", cursor: 'pointer',
                background: isSurahFullyLearned ? 'rgba(76,175,129,.15)' : 'transparent',
                border: `1px solid ${isSurahFullyLearned ? 'var(--green)' : 'rgba(255,255,255,.1)'}`,
                color: isSurahFullyLearned ? 'var(--green)' : 'var(--text3)',
              }}
            >
              {isSurahFullyLearned ? '✓ APPRISE' : 'MARQUER APPRISE'}
            </button>
          )}

          <button
            onClick={() => setPageMode(!pageMode)}
            style={{
              fontSize: 8, letterSpacing: 1, padding: '4px 10px', borderRadius: 20,
              fontFamily: "'Cinzel',serif", cursor: 'pointer',
              background: pageMode ? 'rgba(200,120,255,.15)' : 'transparent',
              border: `1px solid ${pageMode ? '#c878ff' : 'rgba(255,255,255,.1)'}`,
              color: pageMode ? '#c878ff' : 'var(--text3)',
            }}
          >
            {pageMode ? '📖 MODE PAGE' : '📄 MODE SOURATE'}
          </button>
        </div>
      </div>

      {/* TsGlobalBar */}
      <TsGlobalBar
        showTsBar={showTsBar}
        recitatorId={recitatorId}
        ayatsCount={ayats.length}
        loadedCount={loadedCount}
        timestampsMap={timestampsMap}
        onClearTimestamps={() => {
          const kept = {};
          for (const [k, v] of Object.entries(timestampsMap)) {
            if (!k.startsWith(`${recitatorId}:`)) kept[k] = v;
          }
          dispatch(playerActions.setTimestampsMap(kept));
        }}
      />

      {/* Ayat scroll list */}
      <div className="ayat-scroll">
        {(ayats || []).map((a, idx) => {
          const isPlaying = playingAyatNum === a.numberInSurah;
          const isOpen = openAyatNum === a.numberInSurah;
          const ld = learnData[`${selectedSurah.number}:${a.numberInSurah}`] || {};

          return (
            <div
              key={a.numberInSurah}
              className={`ayat-row${isPlaying ? " playing" : ""}${isOpen ? " current" : ""}${ld.learned ? " learned" : ""}`}
            >
              <div
                className="ayat-main"
                onClick={() => {
                  dispatch(quranActions.setOpenAyatNum(isOpen ? null : a.numberInSurah));
                }}
              >
                <div className="ayat-number-badge">{a.numberInSurah}</div>
                <div className="ayat-arabic">
                  <ArabicHighlighted
                    text={a.text}
                    showQalqala={showQalqala}
                    showMadd={showMadd}
                    showIzhar={showIzhar}
                    showIdgham={showIdgham}
                  />
                </div>
              </div>

              {isOpen && (
                <Submenu
                  ayat={a}
                  surahNum={selectedSurah.number}
                  ld={ld}
                  setLData={handleSetLData}
                  submenuMode={submenuMode}
                  setSubmenuMode={(m) => dispatch(uiActions.setSubmenuMode(m))}
                  audioUrl={`https://everyayah.com/data/${recitatorId}/${String(selectedSurah.number).padStart(3, "0")}${String(a.numberInSurah).padStart(3, "0")}.mp3`}
                  collections={collections}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* MainPlayer at bottom */}
      <MainPlayer
        selectedSurah={selectedSurah}
        ayats={ayats}
        currentMainAyat={currentMainAyat}
        mainAyatIdx={mainAyatIdx}
        isMainPlaying={isMainPlaying}
        onPlayMainAyat={playMainAyat}
        onPauseMainAyat={pauseMainAyat}
        loopActive={loopActive}
        setLoopActive={(v) => dispatch(playerActions.setLoopActive(v))}
        loopStart={loopStart}
        loopEnd={loopEnd}
        loopMax={loopMax}
        loopCount={loopCount}
        setLoopCount={(v) => dispatch(playerActions.setLoopCount(v))}
        showLoopBar={showLoopBar}
        setShowLoopBar={(v) => dispatch(uiActions.setShowLoopBar(v))}
        loopStartInput={loopStartInput}
        setLoopStartInput={(v) => dispatch(playerActions.setLoopStartInput(v))}
        loopEndInput={loopEndInput}
        setLoopEndInput={(v) => dispatch(playerActions.setLoopEndInput(v))}
        onApplyLoopInput={handleApplyLoopInput}
        recitatorId={recitatorId}
        setRecitatorId={setRecitatorId}
        timestampsMap={timestampsMap}
        tskey={tskey}
        mainCurrentMs={mainCurrentMs}
        mainAudioRef={mainAudioRef}
        listening={listening}
        toggleVoice={toggleVoice}
      />
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSelector, useDispatch, shallowEqual } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  sel, uiActions, quranActions, playerActions, collectionsActions,
  setLDataThunk
} from "../store";
import { masteryColor, normalizeAr, arabicRoot } from "../utils/arabicUtils";
import ArabicHighlighted from "./ArabicHighlighted";
import Submenu from "./Submenu";
import TsGlobalBar from "./TsGlobalBar";
import MainPlayer from "./MainPlayer";
import { CollectionModal } from "./pages/CollectionsPage";
import { getAudioBase, setGlobalRecitator, markBitrateBad } from "../services/quranApi";

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
  const [recitatorId, setRecitatorId]       = useState(() => { try { return localStorage.getItem('quran_recitator') || 'ar.alafasy'; } catch { return 'ar.alafasy'; } });
  const [bitrateVersion, setBitrateVersion] = useState(0);

  // Submenu state props
  const [partSelectAyat, setPartSelectAyat] = useState(null);
  const [partSelectStep, setPartSelectStep] = useState(null); // 'start' | 'end'
  const [partSelectStart, setPartSelectStart] = useState(null);
  const [aideMemoireClickModes, setAideMemoireClickModes] = useState({});
  const [collModal, setCollModal]           = useState(null);

  const selectedSurah = (surahs || []).find(s => s.number === selectedSurahNum) || null;
  const currentMainAyat = ayats[mainAyatIdx] || null;

  const mainAudioRef = useRef(null);
  const loadedAyatIdxRef = useRef(null);

  const tskey = (sn, an) => `${recitatorId}:${sn}:${an}`;

  useEffect(() => {
    setGlobalRecitator(recitatorId);
  }, [recitatorId]);

  const handleSetLData = (surahNum, ayatNum, updater) => {
    dispatch(setLDataThunk(surahNum, ayatNum, updater));
  };

  const playMainAyat = useCallback((idx) => {
    if (!ayats || idx < 0 || idx >= ayats.length) return;
    const changed = idx !== mainAyatIdx;
    dispatch(playerActions.setMainAyatIdx(idx));
    dispatch(playerActions.setPlayingAyatNum(ayats[idx].numberInSurah));
    if (changed) dispatch(playerActions.setMainCurrentMs(0));
    dispatch(playerActions.setIsMainPlaying(true));
  }, [ayats, mainAyatIdx, dispatch]);

  const pauseMainAyat = useCallback(() => {
    dispatch(playerActions.setIsMainPlaying(false));
    dispatch(playerActions.setPlayingAyatNum(null));
    if (mainAudioRef.current) mainAudioRef.current.pause();
  }, [dispatch]);

  const playWhenReady = useCallback(() => {
    if (mainAudioRef.current) {
      mainAudioRef.current.play().catch(() => {});
    }
  }, []);

  const handleMainEnded = useCallback(() => {
    const next = mainAyatIdx + 1;
    if (loopActive) {
      const end = Math.min(loopEnd, ayats.length - 1);
      if (mainAyatIdx < end) {
        playMainAyat(next);
        playWhenReady();
      } else {
        const nc = loopCount + 1;
        if (loopMax === 0 || nc < loopMax) {
          dispatch(playerActions.setLoopCount(nc));
          playMainAyat(loopStart);
          playWhenReady();
        } else {
          dispatch(playerActions.setLoopActive(false));
          dispatch(playerActions.setLoopCount(0));
          dispatch(playerActions.setIsMainPlaying(false));
          dispatch(playerActions.setPlayingAyatNum(null));
          dispatch(playerActions.setMainCurrentMs(0));
        }
      }
      return;
    }
    if (next < ayats.length) {
      playMainAyat(next);
      playWhenReady();
    } else {
      dispatch(playerActions.setIsMainPlaying(false));
      dispatch(playerActions.setPlayingAyatNum(null));
      dispatch(playerActions.setMainCurrentMs(0));
    }
  }, [mainAyatIdx, ayats, loopActive, loopEnd, loopCount, loopMax, loopStart, playMainAyat, playWhenReady, dispatch]);

  useEffect(() => {
    if (!mainAudioRef.current) return;
    const audioEl = mainAudioRef.current;
    const ayatChanged = loadedAyatIdxRef.current !== mainAyatIdx;
    if (isMainPlaying) {
      if (ayatChanged) {
        loadedAyatIdxRef.current = mainAyatIdx;
        audioEl.load();
        audioEl.play().catch(() => {});
      } else {
        audioEl.play().catch(() => {});
      }
    } else {
      audioEl.pause();
    }
  }, [mainAyatIdx, isMainPlaying]);

  const handleApplyLoopInput = (sVal, eVal) => {
    const s = parseInt(sVal) - 1;
    const e = parseInt(eVal) - 1;
    if (!isNaN(s) && s >= 0 && s < ayats.length) dispatch(playerActions.setLoopStart(s));
    if (!isNaN(e) && e >= s && e < ayats.length) dispatch(playerActions.setLoopEnd(e));
  };

  const pages = useMemo(() => [...new Set(ayats.map(a => a.page).filter(Boolean))].sort((a,b)=>a-b), [ayats]);

  const filteredAyats = useMemo(() => {
    if (!pageMode || pages.length === 0) return ayats;
    const curPage = activePageCoran ?? ayats[mainAyatIdx]?.page ?? pages[0];
    return ayats.filter(a => a.page === curPage);
  }, [pageMode, pages, activePageCoran, ayats, mainAyatIdx]);

  const ayatInCollections = useCallback((sNum, aNum) => {
    const key = `${sNum}:${aNum}`;
    return collections.filter(c => (c.ayats || c.items || []).some(it => `${it.surahNum}:${it.ayatNum}` === key));
  }, [collections]);

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

  // Auto-scroll to currently playing or opened verse
  const scrollContainerRef = useRef(null);
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const targetNum = playingAyatNum || openAyatNum;
    if (targetNum == null) return;
    const el = scrollContainerRef.current.querySelector(`[data-ayat="${targetNum}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [playingAyatNum, openAyatNum]);

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

          <label
            style={{
              fontSize: 8, letterSpacing: 1, padding: '4px 10px', borderRadius: 20,
              fontFamily: "'Cinzel',serif", cursor: 'pointer',
              background: 'rgba(62,184,160,.12)',
              border: '1px solid var(--teal)',
              color: 'var(--teal2)',
              display: 'inline-flex', alignItems: 'center', gap: 4
            }}
          >
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  try {
                    const parsed = JSON.parse(ev.target.result);
                    if (parsed && typeof parsed === 'object') {
                      if (parsed.numberInSurah || parsed.words) {
                        const an = parsed.numberInSurah || 1;
                        dispatch(playerActions.updateTimestamp({ [tskey(selectedSurah.number, an)]: parsed }));
                      } else {
                        const mapUpdates = {};
                        Object.entries(parsed).forEach(([k, v]) => {
                          if (k.includes(':')) mapUpdates[k] = v;
                          else mapUpdates[`${recitatorId}:${selectedSurah.number}:${k}`] = v;
                        });
                        dispatch(playerActions.updateTimestamp(mapUpdates));
                      }
                    }
                  } catch (err) {
                    alert('Erreur lors de la lecture du fichier JSON: ' + err.message);
                  }
                };
                reader.readAsText(file);
              }}
            />
            📂 CHARGER TIMESTAMPS
          </label>
        </div>
      </div>

      {/* Page mode top navigation bar */}
      {pageMode && pages.length > 0 && (() => {
        const curPage = activePageCoran ?? ayats[mainAyatIdx]?.page ?? pages[0];
        const idx = pages.indexOf(curPage);
        return (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'6px 14px', background:'var(--surface2)', borderBottom:'1px solid var(--border)',
            position:'sticky', top:0, zIndex:10, gap:8
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button onClick={() => setActivePageCoran(pages[0])} disabled={idx<=0}
                style={{ fontSize:11, padding:'3px 7px', fontFamily:"'Cinzel',serif", background:'transparent', border:'1px solid var(--border2)', color: idx>0 ? 'var(--text2)' : 'var(--text3)', borderRadius:6, cursor: idx>0 ? 'pointer' : 'default', lineHeight:1 }}>⏮</button>
              <button onClick={() => setActivePageCoran(pages[idx-1])} disabled={idx<=0}
                style={{ fontSize:8, letterSpacing:1, padding:'3px 10px', fontFamily:"'Cinzel',serif", background:'transparent', border:'1px solid var(--border2)', color: idx>0 ? 'var(--text2)' : 'var(--text3)', borderRadius:6, cursor: idx>0 ? 'pointer' : 'default' }}>← {idx>0 ? pages[idx-1] : ''}</button>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:7, letterSpacing:2, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>PAGE</span>
              <input type="number" value={curPage}
                onChange={e => { const v=parseInt(e.target.value); if(pages.includes(v)) setActivePageCoran(v); }}
                style={{ width:48, textAlign:'center', background:'var(--surface3)', border:'1px solid #c878ff', borderRadius:6, padding:'3px 6px', color:'#c878ff', fontSize:13, fontFamily:"'Cinzel',serif", outline:'none' }} />
              <span style={{ fontSize:7, color:'var(--text3)' }}>/ {pages[pages.length-1]}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button onClick={() => setActivePageCoran(pages[idx+1])} disabled={idx>=pages.length-1}
                style={{ fontSize:8, letterSpacing:1, padding:'3px 10px', fontFamily:"'Cinzel',serif", background:'transparent', border:'1px solid var(--border2)', color: idx<pages.length-1 ? 'var(--text2)' : 'var(--text3)', borderRadius:6, cursor: idx<pages.length-1 ? 'pointer' : 'default' }}>{idx<pages.length-1 ? pages[idx+1] : ''} →</button>
              <button onClick={() => setActivePageCoran(pages[pages.length-1])} disabled={idx>=pages.length-1}
                style={{ fontSize:11, padding:'3px 7px', fontFamily:"'Cinzel',serif", background:'transparent', border:'1px solid var(--border2)', color: idx<pages.length-1 ? 'var(--text2)' : 'var(--text3)', borderRadius:6, cursor: idx<pages.length-1 ? 'pointer' : 'default', lineHeight:1 }}>⏭</button>
            </div>
          </div>
        );
      })()}

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
      <div className="ayat-scroll" ref={scrollContainerRef}>
        {(filteredAyats || []).map((a) => {
          const isPlaying = playingAyatNum === a.numberInSurah;
          const isOpen = openAyatNum === a.numberInSurah;
          const ld = learnData[`${selectedSurah.number}:${a.numberInSurah}`] || {};
          const fullIdx = ayats.findIndex(item => item.numberInSurah === a.numberInSurah);
          const ayatWords = a.text ? a.text.split(" ").filter(Boolean) : [];

          const handleWordClick = (wi) => {
            const aideMemoireClickMode = aideMemoireClickModes[a.numberInSurah] || null;
            if (aideMemoireClickMode === 'highlight') {
              const word = ayatWords[wi];
              const prev = ld?.highlight?.trim() ? ld.highlight.trim().split(/\s+/) : [];
              const normWord = normalizeAr(word);
              const exists = prev.some(w => normalizeAr(w) === normWord);
              const next = exists ? prev.filter(w => normalizeAr(w) !== normWord) : [...prev, word];
              handleSetLData(selectedSurah.number, a.numberInSurah, d => ({ ...d, highlight: next.join(' ') }));
              return;
            }
            if (aideMemoireClickMode === 'unknown') {
              const rootClicked = arabicRoot(ayatWords[wi] || '');
              const prev = ld?.unknownWords || [];
              const isRemoving = prev.includes(wi);
              const sameForm = ayatWords.reduce((acc, w, i) => { if (arabicRoot(w) === rootClicked) acc.push(i); return acc; }, []);
              const next = isRemoving
                ? prev.filter(x => !sameForm.includes(x))
                : [...new Set([...prev, ...sameForm])];
              handleSetLData(selectedSurah.number, a.numberInSurah, d => ({ ...d, unknownWords: next }));
              return;
            }
            if (partSelectAyat === a.numberInSurah) {
              const wordsInParts = new Set();
              (ld.parts || []).forEach(p => p.wordIndices?.forEach(i => wordsInParts.add(i)));
              const nextAvail = wordsInParts.size > 0 ? Math.max(...[...wordsInParts]) + 1 : 0;

              if (partSelectStep === 'start') {
                if (wi < nextAvail) return;
                setPartSelectStart(wi);
                setPartSelectStep('end');
              } else if (partSelectStep === 'end') {
                if (partSelectStart === null) return;
                const from = Math.min(partSelectStart, wi);
                const to   = Math.max(partSelectStart, wi);
                const clampedFrom = Math.max(from, nextAvail);
                const indices = []; for (let i = clampedFrom; i <= to; i++) indices.push(i);
                if (indices.length === 0) return;
                handleSetLData(selectedSurah.number, a.numberInSurah, d => ({
                  ...d, parts: [...(d.parts || []), { id: Date.now(), wordIndices: indices, text: indices.map(i => ayatWords[i]).join(" "), learned: !!d.learned }]
                }));
                const newNext = to + 1;
                if (newNext < ayatWords.length) {
                  setPartSelectStart(null);
                  setPartSelectStep('start');
                } else {
                  setPartSelectAyat(null); setPartSelectStep(null); setPartSelectStart(null);
                }
              }
            }
          };

          return (
            <div
              key={a.numberInSurah}
              data-ayat={a.numberInSurah}
              className={`ayat-row${isPlaying ? " playing" : ""}${isOpen ? " current" : ""}${ld.learned ? " learned" : ""}`}
            >
              <div
                className="ayat-main"
                onClick={() => {
                  const newOpen = isOpen ? null : a.numberInSurah;
                  dispatch(quranActions.setOpenAyatNum(newOpen));
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <div className="ayat-number-badge">{a.numberInSurah}</div>
                  <button
                    title="Lire depuis ce verset"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fullIdx >= 0) {
                        playMainAyat(fullIdx);
                      }
                    }}
                    style={{
                      width: 22, height: 22, borderRadius: "50%", border: "none",
                      background: isPlaying ? "var(--teal)" : "rgba(62,184,160,.15)",
                      color: isPlaying ? "#fff" : "var(--teal2)",
                      fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", flexShrink: 0, transition: "all .15s",
                      outline: isPlaying ? "2px solid var(--teal)" : "none",
                      outlineOffset: 2,
                    }}
                  >
                    ▶
                  </button>
                </div>

                <div className="ayat-arabic">
                  {isPlaying ? (
                    <PlayingArabicHighlighted
                      text={a.text}
                      timestamps={timestampsMap[tskey(selectedSurah.number, a.numberInSurah)]}
                      mode="main"
                      showQalqala={showQalqala}
                      showMadd={showMadd}
                      showIzhar={showIzhar}
                      showIdgham={showIdgham}
                      onWordClick={handleWordClick}
                      ld={ld}
                      partSelectAyat={partSelectAyat}
                      partSelectStep={partSelectStep}
                      partSelectStart={partSelectStart}
                      ayatNum={a.numberInSurah}
                    />
                  ) : (
                    <ArabicHighlighted
                      text={a.text}
                      timestamps={timestampsMap[tskey(selectedSurah.number, a.numberInSurah)]}
                      currentMs={0}
                      showQalqala={showQalqala}
                      showMadd={showMadd}
                      showIzhar={showIzhar}
                      showIdgham={showIdgham}
                      onWordClick={handleWordClick}
                      ld={ld}
                      partSelectAyat={partSelectAyat}
                      partSelectStep={partSelectStep}
                      partSelectStart={partSelectStart}
                      ayatNum={a.numberInSurah}
                    />
                  )}
                </div>
              </div>

              {isOpen && (
                <Submenu
                  ayat={a}
                  surahNum={selectedSurah.number}
                  ld={ld}
                  setLData={handleSetLData}
                  submenuMode={submenuMode}
                  setSubmenuMode={(m) => dispatch(quranActions.setSubmenuMode(m))}
                  audioUrl={`${getAudioBase()}/${a.number}.mp3`}
                  isMainPlaying={isMainPlaying}
                  timestamps={timestampsMap[tskey(selectedSurah.number, a.numberInSurah)]}
                  onLoadTimestamps={(data) => {
                    dispatch(playerActions.updateTimestamp({ [tskey(selectedSurah.number, a.numberInSurah)]: data }));
                  }}
                  onUpdateTimestamps={(data) => {
                    dispatch(playerActions.updateTimestamp({ [tskey(selectedSurah.number, a.numberInSurah)]: data }));
                  }}
                  onLocalPlay={(ms) => {
                    if (ms != null) dispatch(playerActions.setMainCurrentMs(ms));
                  }}
                  partSelectAyat={partSelectAyat}
                  partSelectStep={partSelectStep}
                  onStartPartCreate={() => {
                    setPartSelectAyat(a.numberInSurah);
                    setPartSelectStep('start');
                    setPartSelectStart(null);
                  }}
                  onCancelPartCreate={() => {
                    setPartSelectAyat(null);
                    setPartSelectStep(null);
                    setPartSelectStart(null);
                  }}
                  collections={collections}
                  ayatInCollections={ayatInCollections(selectedSurah.number, a.numberInSurah)}
                  onOpenCollModal={() => setCollModal({ surahNum: selectedSurah.number, surahEn: selectedSurah.englishName, ayatNum: a.numberInSurah, text: a.text, number: a.number })}
                  aideMemoireClickMode={aideMemoireClickModes[a.numberInSurah] || null}
                  setAideMemoireClickMode={(m) => setAideMemoireClickModes(prev => ({ ...prev, [a.numberInSurah]: m }))}
                  onSetLoop={() => handleApplyLoopInput(a.numberInSurah, a.numberInSurah)}
                  ayatLoopActive={loopActive && loopStart === fullIdx && loopEnd === fullIdx}
                />
              )}
            </div>
          );
        })}
      </div>

      {collModal && (
        <CollectionModal
          ayat={collModal}
          collections={collections}
          onToggle={(collId) => dispatch(collectionsActions.toggleAyatInCollection({ collId, ayatEntry: { surahNum: collModal.surahNum, ayatNum: collModal.ayatNum, text: collModal.text } }))}
          onCreateAndAdd={(name) => dispatch(collectionsActions.createCollectionWithAyat({ name, ayatEntry: { surahNum: collModal.surahNum, ayatNum: collModal.ayatNum, text: collModal.text } }))}
          onClose={() => setCollModal(null)}
        />
      )}

      {/* PERSISTENT AUDIO ELEMENT */}
      <audio
        ref={mainAudioRef}
        src={currentMainAyat ? `${getAudioBase()}/${currentMainAyat.number}.mp3` : ""}
        onEnded={handleMainEnded}
        onTimeUpdate={(e) => {
          dispatch(playerActions.setMainCurrentMs((e.target.currentTime || 0) * 1000));
        }}
        onError={() => {
          const next = markBitrateBad(recitatorId);
          if (next != null) {
            setBitrateVersion(v => v + 1);
            loadedAyatIdxRef.current = null;
            requestAnimationFrame(() => {
              const a = mainAudioRef.current;
              if (!a) return;
              a.load();
              loadedAyatIdxRef.current = mainAyatIdx;
              if (isMainPlaying) playWhenReady();
            });
          }
        }}
        style={{ display: "none" }}
      />

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

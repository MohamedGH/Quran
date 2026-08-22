import React, { useState } from "react";
import { createPortal } from "react-dom";
import { RECITATORS } from "../utils/quranData";
import { getReciterBitrate, setReciterBitrate, bitrateOrderFor } from "../services/quranApi";

export default function MainPlayer({
  selectedSurah,
  ayats = [],
  currentMainAyat,
  mainAyatIdx = 0,
  isMainPlaying = false,
  onPlayMainAyat,
  onPauseMainAyat,
  // Loop state
  loopActive = false,
  setLoopActive,
  loopStart = 0,
  loopEnd = 0,
  loopMax = 0,
  setLoopMax,
  loopCount = 0,
  setLoopCount,
  showLoopBar = false,
  setShowLoopBar,
  loopStartInput = "1",
  setLoopStartInput,
  loopEndInput = "1",
  setLoopEndInput,
  onApplyLoopInput,
  // Reciter state
  recitatorId = "Alafasy_128kbps",
  setRecitatorId,
  // Timestamps
  timestampsMap = {},
  tskey,
  mainCurrentMs = 0,
  mainAudioRef,
  // Voice
  listening = false,
  toggleVoice,
}) {
  const [showRecitPanel, setShowRecitPanel] = useState(false);
  const [recitatorSearch, setRecitatorSearch] = useState("");
  const [bitrateVersion, setBitrateVersion] = useState(0);

  if (!selectedSurah || ayats.length === 0) return null;

  const activeRecitator = RECITATORS.find(r => r.id === recitatorId);
  const visibleRecitators = RECITATORS.filter(r => {
    if (!recitatorSearch.trim()) return true;
    const q = recitatorSearch.toLowerCase();
    return r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
  });

  const loopStartNum = loopStart + 1;
  const loopEndNum = Math.min(loopEnd + 1, ayats.length);

  const sn = selectedSurah.number;
  const bitrate = getReciterBitrate(recitatorId);

  // Compute total surah / page duration from timestamps map if available
  const ayatDurations = ayats.map(a => {
    const ts = timestampsMap[tskey?.(sn, a.numberInSurah) || `${recitatorId}:${sn}:${a.numberInSurah}`];
    if (!ts?.words?.length) return 0;
    const allChars = ts.words.flatMap(w => w.chars || []);
    const first = allChars[0], last = allChars[allChars.length - 1];
    if (!first || !last) return 0;
    return Math.max(0, (last.end || 0) - (first.start || 0));
  });
  const totalMs = ayatDurations.reduce((s, d) => s + d, 0);

  const fmt = ms => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="main-player">
      <div className="player-row">
        <div className="player-info">
          <div className="player-surah">{selectedSurah.englishName.toUpperCase()}</div>
          <div className="player-ayah">
            AYAT {currentMainAyat?.numberInSurah || (mainAyatIdx + 1)} / {ayats.length}
            {loopActive && (
              <span style={{ color: "var(--teal)", marginLeft: 8 }}>
                ↺ {loopStartNum}–{loopEndNum}
                {loopMax > 0 && <span style={{ color: "var(--text3)" }}> · {loopCount + 1}/{loopMax}</span>}
              </span>
            )}
          </div>
        </div>

        <div className="player-controls">
          <button
            className="ctrl-btn"
            title="Premier verset"
            onClick={() => onPlayMainAyat?.(loopActive ? loopStart : 0)}
            style={{ fontSize: 11 }}
          >
            ⏮
          </button>
          <button
            className="ctrl-btn"
            title="Verset précédent"
            onClick={() => {
              const i = Math.max(loopActive ? loopStart : 0, mainAyatIdx - 1);
              onPlayMainAyat?.(i);
            }}
          >
            ◀
          </button>
          <button
            className="ctrl-btn play-btn"
            title={isMainPlaying ? "Pause" : "Lecture"}
            onClick={() => {
              if (!isMainPlaying) {
                onPlayMainAyat?.(loopActive ? loopStart : mainAyatIdx);
              } else {
                onPauseMainAyat?.();
              }
            }}
          >
            {isMainPlaying ? "⏸" : "▶"}
          </button>
          <button
            className="ctrl-btn"
            title="Verset suivant"
            onClick={() => {
              const i = Math.min(loopActive ? loopEnd : ayats.length - 1, mainAyatIdx + 1);
              onPlayMainAyat?.(i);
            }}
          >
            ▶
          </button>

          <button
            className={`ctrl-btn${loopActive ? " loop-on" : ""}`}
            title="Activer/désactiver la boucle"
            onClick={() => {
              setLoopActive?.(!loopActive);
              if (!loopActive) setLoopCount?.(0);
            }}
            style={{ fontSize: 12 }}
          >
            ↺
          </button>
          <button
            className={`ctrl-btn${showLoopBar ? " loop-on" : ""}`}
            title="Configurer le range de boucle"
            onClick={() => setShowLoopBar?.(!showLoopBar)}
            style={{ fontSize: 11 }}
          >
            ⚙
          </button>

          {toggleVoice && (
            <button
              className={`ctrl-btn${listening ? " loop-on" : ""}`}
              title="Commande vocale"
              onClick={toggleVoice}
              style={{ fontSize: 14 }}
            >
              🎤
            </button>
          )}

          <button
            className={`ctrl-btn reciter-trigger${showRecitPanel ? " loop-on" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={showRecitPanel}
            aria-label={`Choisir le récitateur. Actuel : ${activeRecitator?.label || recitatorId}`}
            title={`Récitateur : ${activeRecitator?.label || recitatorId}`}
            onClick={() => {
              setRecitatorSearch("");
              setShowRecitPanel(v => !v);
            }}
          >
            <span>{activeRecitator?.flag || '🎙️'}</span>
            <span className="reciter-trigger-label">{activeRecitator?.label || 'Récitateur'}</span>
          </button>
        </div>

        {/* Reciter sheet portal */}
        {showRecitPanel && createPortal(
          <>
            <div className="reciter-sheet-backdrop" onClick={() => setShowRecitPanel(false)} aria-hidden="true" />
            <section className="reciter-sheet" role="dialog" aria-modal="true" aria-labelledby="reciter-sheet-title">
              <div className="reciter-sheet-header">
                <div style={{ minWidth: 0 }}>
                  <div id="reciter-sheet-title" className="reciter-sheet-title">CHOISIR UN RÉCITATEUR</div>
                  <div className="reciter-sheet-current">Actuel · {activeRecitator?.label || recitatorId}</div>
                </div>
                <button className="reciter-sheet-close" onClick={() => setShowRecitPanel(false)} aria-label="Fermer le choix du récitateur">×</button>
              </div>

              <input
                className="reciter-search"
                type="search"
                autoFocus
                value={recitatorSearch}
                onChange={e => setRecitatorSearch(e.target.value)}
                placeholder="Rechercher un récitateur"
                aria-label="Rechercher un récitateur"
              />

              <div className="reciter-list">
                {visibleRecitators.map(r => (
                  <button
                    key={r.id}
                    className={`reciter-option${r.id === recitatorId ? ' selected' : ''}`}
                    onClick={() => {
                      setRecitatorId?.(r.id);
                      setShowRecitPanel(false);
                    }}
                  >
                    <span className="reciter-option-flag">{r.flag}</span>
                    <span className="reciter-option-name">{r.label}</span>
                    {r.id === recitatorId && <span className="reciter-option-check" aria-label="Sélectionné">✓</span>}
                  </button>
                ))}
                {visibleRecitators.length === 0 && (
                  <div className="reciter-empty">Aucun récitateur ne correspond à cette recherche.</div>
                )}
              </div>

              <div className="reciter-sheet-footer">
                <span>Débit audio · {bitrate} kbps</span>
                <button
                  className="reciter-reset"
                  onClick={() => {
                    setReciterBitrate(recitatorId, bitrateOrderFor(recitatorId)[0]);
                    setBitrateVersion(v => v + 1);
                  }}
                >
                  Réinitialiser le débit
                </button>
              </div>
            </section>
          </>,
          document.body
        )}

        {/* Progress bar */}
        {totalMs <= 0 ? (
          <div className="player-progress">
            <div className="progress-bar-wrap">
              {loopActive && ayats.length > 1 && (
                <div
                  className="progress-range"
                  style={{
                    left: `${(loopStart / ayats.length) * 100}%`,
                    width: `${((Math.min(loopEnd, ayats.length - 1) - loopStart + 1) / ayats.length) * 100}%`,
                  }}
                />
              )}
              <div className="progress-bar-fill" style={{ width: `${((mainAyatIdx + 1) / ayats.length) * 100}%` }} />
            </div>
            <span className="progress-text">{mainAyatIdx + 1}/{ayats.length}</span>
          </div>
        ) : (() => {
          const prevMs = ayatDurations.slice(0, mainAyatIdx).reduce((s, d) => s + d, 0);
          const ts = timestampsMap[tskey?.(sn, currentMainAyat?.numberInSurah) || `${recitatorId}:${sn}:${currentMainAyat?.numberInSurah}`];
          const ayatStartMs = ts?.words?.[0]?.chars?.[0]?.start ?? 0;
          const curMs = Math.max(0, prevMs + (mainCurrentMs - ayatStartMs));
          const pct = Math.min(100, (curMs / totalMs) * 100);

          const loopStartMs = ayatDurations.slice(0, loopStart).reduce((s, d) => s + d, 0);
          const loopEndMs = ayatDurations.slice(0, Math.min(loopEnd, ayats.length - 1) + 1).reduce((s, d) => s + d, 0);

          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', width: '100%' }}>
              <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: "'Cinzel',serif", letterSpacing: 1, flexShrink: 0 }}>{fmt(curMs)}</span>
              <div
                style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const targetMs = (e.clientX - rect.left) / rect.width * totalMs;
                  let acc = 0;
                  for (let i = 0; i < ayats.length; i++) {
                    if (acc + ayatDurations[i] >= targetMs || i === ayats.length - 1) {
                      onPlayMainAyat?.(i);
                      break;
                    }
                    acc += ayatDurations[i];
                  }
                }}
              >
                {loopActive && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${(loopStartMs / totalMs) * 100}%`,
                      width: `${((loopEndMs - loopStartMs) / totalMs) * 100}%`,
                      height: '100%',
                      background: 'rgba(62,184,160,.25)',
                    }}
                  />
                )}
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--gold)', borderRadius: 2, transition: 'width .1s linear' }} />
              </div>
              <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: "'Cinzel',serif", letterSpacing: 1, flexShrink: 0 }}>{fmt(totalMs)}</span>
            </div>
          );
        })()}
      </div>

      {/* Loop bar */}
      {showLoopBar && (
        <div className="loop-bar">
          <span className="loop-label">BOUCLE</span>
          <div className="loop-inputs">
            <input
              className="loop-input"
              type="number"
              min={1}
              max={ayats.length}
              value={loopStartInput}
              onChange={e => setLoopStartInput?.(e.target.value)}
              onBlur={() => onApplyLoopInput?.(loopStartInput, loopEndInput)}
              onKeyDown={e => e.key === 'Enter' && onApplyLoopInput?.(loopStartInput, loopEndInput)}
            />
            <span className="loop-sep">à</span>
            <input
              className="loop-input"
              type="number"
              min={1}
              max={ayats.length}
              value={loopEndInput}
              onChange={e => setLoopEndInput?.(e.target.value)}
              onBlur={() => onApplyLoopInput?.(loopStartInput, loopEndInput)}
              onKeyDown={e => e.key === 'Enter' && onApplyLoopInput?.(loopStartInput, loopEndInput)}
            />
          </div>

          <div className="loop-rep-wrap">
            <span className="loop-rep-label">RÉPÉTITIONS:</span>
            <div className="loop-rep-btns">
              {[1, 2, 3, 5, 10, 0].map(cnt => (
                <button
                  key={cnt}
                  className={`loop-rep-btn${loopMax === cnt ? ' sel' : ''}`}
                  onClick={() => { setLoopMax?.(cnt); setLoopCount?.(0); }}
                >
                  {cnt === 0 ? '∞' : `${cnt}×`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

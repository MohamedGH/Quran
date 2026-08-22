import React, { useState } from "react";
import { computeMastery, masteryColor, splitArabicWords } from "../../utils/arabicUtils";

export function MasteryBar({ pct, size = 'sm' }) {
  const h = size === 'lg' ? 8 : 4;
  return (
    <div style={{ width: '100%', height: h, background: 'var(--border)', borderRadius: h / 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: masteryColor(pct), borderRadius: h / 2, transition: 'width .4s ease' }} />
    </div>
  );
}

export function MasteryBadge({ pct }) {
  const col = masteryColor(pct);
  return (
    <span style={{
      fontSize: 8, fontFamily: "'Cinzel',serif", letterSpacing: 1,
      padding: '2px 7px', borderRadius: 10, border: `1px solid ${col}`,
      color: col, background: `${col}18`, flexShrink: 0,
    }}>
      {pct}% MAÎTRISÉ
    </span>
  );
}

export function MasteryDebug({ ld, ayatText }) {
  if (!ld) return null;
  const parts = ld.parts || [];
  const recs  = ld.recitAttempts || [];
  const best  = recs.length ? Math.max(...recs.map(r => r.score || 0)) : null;
  const words = Object.keys(ld.wordsLearned || {}).length;

  return (
    <div style={{ fontSize: 8, color: 'var(--text3)', fontFamily: "monospace", display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
      {ld.learned && <span style={{ color: 'var(--green2)' }}>✓ Appris</span>}
      {parts.length > 0 && <span>Parties: {parts.filter(p => p.learned).length}/{parts.length}</span>}
      {best !== null && <span>Meilleur récit: {best}%</span>}
      {words > 0 && <span>Mots: {words}/{splitArabicWords(ayatText || '').length}</span>}
      {(ld.readCount || 0) > 0 && <span>Lectures: {ld.readCount}</span>}
    </div>
  );
}

export function useToRevise(ld, surahNum, ayatNum, setLData) {
  const tr = ld?.toRevise || null;
  const isActive = !!tr;
  const selWords = tr?.words || [];
  const selChars = tr?.chars || {};

  const toggleWord = (wi) => {
    let wasSelected = false;
    setLData(surahNum, ayatNum, d => {
      const curTr   = d?.toRevise || { words: [], chars: {} };
      const curW    = curTr.words || [];
      const hasW    = curW.includes(wi);
      wasSelected   = !hasW;
      const nextW   = hasW ? curW.filter(i => i !== wi) : [...curW, wi];
      const nextC   = { ...(curTr.chars || {}) };
      if (hasW) delete nextC[wi];
      const hasAny  = nextW.length > 0 || Object.keys(nextC).length > 0;
      return { ...d, toRevise: hasAny ? { words: nextW, chars: nextC } : null };
    });
    return wasSelected;
  };

  const toggleChar = (wi, ci) => {
    setLData(surahNum, ayatNum, d => {
      const curTr = d?.toRevise || { words: [], chars: {} };
      const curC  = curTr.chars?.[wi] || [];
      const hasC  = curC.includes(ci);
      const nextCArr = hasC ? curC.filter(i => i !== ci) : [...curC, ci];
      const nextChars = { ...(curTr.chars || {}) };
      if (nextCArr.length > 0) nextChars[wi] = nextCArr;
      else delete nextChars[wi];
      const nextW  = (curTr.words || []).filter(i => i !== wi);
      const hasAny = nextW.length > 0 || Object.keys(nextChars).length > 0;
      return { ...d, toRevise: hasAny ? { words: nextW, chars: nextChars } : null };
    });
  };

  const clearAll = () => setLData(surahNum, ayatNum, d => ({ ...d, toRevise: null }));

  return { isActive, selWords, selChars, toggleWord, toggleChar, clearAll };
}

export function ToRevisePanel({ ayat, surahNum, ld, setLData }) {
  const words = ayat?.text ? splitArabicWords(ayat.text) : [];
  const { isActive, selWords, selChars, toggleWord, toggleChar, clearAll } =
    useToRevise(ld, surahNum, ayat?.numberInSurah, setLData);

  const [expandedWord, setExpandedWord] = useState(null);

  if (!setLData) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: 'var(--gold2)', fontFamily: "'Cinzel',serif" }}>
          🔖 MARQUAGE À RÉVISER
        </span>
        {isActive && (
          <button className="btn-small" onClick={clearAll} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
            EFFACER LE MARQUAGE
          </button>
        )}
      </div>

      <div style={{ fontSize: 8, color: 'var(--text3)', lineHeight: 1.5 }}>
        Cliquez sur un mot pour le marquer en entier, ou sur "▾" pour cibler une lettre spécifique.
      </div>

      <div style={{ direction: 'rtl', fontFamily: "'Amiri Quran',serif", lineHeight: 2.2, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {words.map((w, wi) => {
          const isW = selWords.includes(wi);
          const cArr = selChars[wi] || [];
          const isC = cArr.length > 0;

          return (
            <div key={wi} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span
                  onClick={() => toggleWord(wi)}
                  style={{
                    padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
                    background: isW ? 'rgba(201,168,76,.2)' : isC ? 'rgba(91,200,245,.15)' : 'var(--surface3)',
                    border: `1px solid ${isW ? 'var(--gold)' : isC ? '#5bc8f5' : 'var(--border2)'}`,
                    color: isW ? 'var(--gold2)' : isC ? '#5bc8f5' : 'var(--text)',
                  }}
                >
                  {w}
                </span>
                <button
                  onClick={() => setExpandedWord(expandedWord === wi ? null : wi)}
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 8, cursor: 'pointer' }}
                >
                  ▾
                </button>
              </div>

              {expandedWord === wi && (
                <div style={{ display: 'flex', gap: 3, marginTop: 4, background: 'var(--surface3)', padding: 4, borderRadius: 6 }}>
                  {[...w].map((ch, ci) => {
                    const sel = cArr.includes(ci);
                    return (
                      <button
                        key={ci}
                        onClick={() => toggleChar(wi, ci)}
                        style={{
                          background: sel ? '#5bc8f5' : 'transparent',
                          color: sel ? 'var(--bg)' : 'var(--text)',
                          border: '1px solid var(--border2)', borderRadius: 4,
                          fontSize: 12, padding: '2px 4px', cursor: 'pointer',
                        }}
                      >
                        {ch}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RevisionPage({ learnData = {}, surahs = [], setLData, onNavigate, initialFilter = "all" }) {
  const [filter, setFilter]           = useState(initialFilter);
  const [openSurahs, setOpenSurahs]   = useState({});

  const toggleSurah = (sn) => setOpenSurahs(p => ({ ...p, [sn]: !p[sn] }));

  const surahList = (surahs || []).map(s => {
    const sData = learnData[s.number] || {};
    const ayatsList = Object.entries(sData).map(([an, ld]) => ({
      num: Number(an),
      ld,
      mastery: computeMastery(ld),
      toRevise: ld?.toRevise,
    }));

    const toReviseCount = ayatsList.filter(a => a.toRevise).length;
    const avgMastery    = ayatsList.length
      ? Math.round(ayatsList.reduce((acc, a) => acc + a.mastery, 0) / ayatsList.length)
      : 0;

    return {
      ...s,
      ayatsList,
      toReviseCount,
      avgMastery,
    };
  }).filter(s => s.ayatsList.length > 0);

  const filteredSurahs = surahList.filter(s => {
    if (filter === "to_revise") return s.toReviseCount > 0;
    if (filter === "low_mastery") return s.avgMastery < 70;
    return true;
  });

  return (
    <div className="rev-page page-anim">
      <div className="rev-header-block">
        <div>
          <div className="rev-title">✏ ESPACE RÉVISION</div>
          <div className="rev-subtitle">CONSOLIDATION DES VERSETS ET MOTS MARQUÉS</div>
        </div>
      </div>

      <div className="rev-filter-row">
        <button
          className={`rev-filter-btn${filter === "all" ? " active" : ""}`}
          onClick={() => setFilter("all")}
        >
          TOUTES LES SOURATES EN COURS ({surahList.length})
        </button>
        <button
          className={`rev-filter-btn${filter === "to_revise" ? " active" : ""}`}
          onClick={() => setFilter("to_revise")}
        >
          🔖 AVEC MARQUAGE À RÉVISER
        </button>
        <button
          className={`rev-filter-btn${filter === "low_mastery" ? " active" : ""}`}
          onClick={() => setFilter("low_mastery")}
        >
          ⚠️ MAÎTRISE FAIBLE (&lt;70%)
        </button>
      </div>

      {filteredSurahs.length === 0 ? (
        <div className="rev-empty">
          AUCUN VERSET À RÉVISER POUR CE FILTRE
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredSurahs.map(s => {
            const isOpen = !!openSurahs[s.number];
            return (
              <div key={s.number} className="rev-surah-block">
                <div className="rev-surah-header" onClick={() => toggleSurah(s.number)}>
                  <div className="rev-surah-num">{s.number}</div>
                  <div className="rev-surah-name">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text)" }}>{s.englishName}</span>
                      <span className="rev-surah-name-ar">{s.name}</span>
                    </div>
                  </div>
                  {s.toReviseCount > 0 && (
                    <div className="rev-surah-badge">🔖 {s.toReviseCount} marqué{s.toReviseCount > 1 ? "s" : ""}</div>
                  )}
                  <MasteryBadge pct={s.avgMastery} />
                  <div style={{ fontSize: 10, color: "var(--text3)", transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                    ▾
                  </div>
                </div>

                {isOpen && (
                  <div className="rev-ayat-grid">
                    {s.ayatsList.map(a => (
                      <div key={a.num} className="rev-ayat-card">
                        <div className="rev-ayat-card-header" onClick={() => onNavigate?.(s.number, a.num)}>
                          <div className="rev-ayat-num">{a.num}</div>
                          <div className="rev-ayat-text-preview">
                            Verset {a.num}
                          </div>
                          <MasteryBadge pct={a.mastery} />
                          <button className="btn-small" onClick={(e) => { e.stopPropagation(); onNavigate?.(s.number, a.num); }}>
                            RÉVISER ▶
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { TAJWEED_RULES, SAJDA_AYATS } from "../utils/quranData";
import { splitArabicWords, splitArabicChars, isQalqala, getMaddType, isIzhar, isIdgham, arabicRoot } from "../utils/arabicUtils";
import { fixChars } from "../services/quranApi";
import { AyatCollectionsTab } from "./pages/CollectionsPage";
import EditorWords from "./EditorWords";
import VoiceRecorder from "./VoiceRecorder";
import RecitationChecker from "./RecitationChecker";
import "./Submenu.css";

export function AnimatedPage({ children, pageKey }) {
  return <div key={pageKey} className="page-anim">{children}</div>;
}

export function AnimatedSubmenu({ isOpen, children }) {
  if (!isOpen) return null;
  return <div className="submenu-anim-wrap">{children}</div>;
}

export function useToRevise(ld, surahNum, ayatNum, setLData) {
  const saveWithHistory = (nextRevise, prevRevise) => {
    const now = new Date().toISOString();
    setLData(surahNum, ayatNum, d => {
      const hist = [...(d.reviseHistory || [])];
      const wasActive = !!prevRevise;
      const willBeActive = !!nextRevise;

      if (!wasActive && willBeActive) {
        hist.push({
          startDate: now,
          endDate: null,
          words: typeof nextRevise === 'object' ? (nextRevise.words || []) : 'all',
          parts: typeof nextRevise === 'object' ? (nextRevise.parts || []) : [],
          chars: typeof nextRevise === 'object' ? (nextRevise.chars || {}) : {},
        });
      } else if (wasActive && !willBeActive) {
        const lastOpen = [...hist].reverse().findIndex(e => !e.endDate);
        if (lastOpen >= 0) {
          const idx = hist.length - 1 - lastOpen;
          hist[idx] = { ...hist[idx], endDate: now };
        }
      } else if (wasActive && willBeActive) {
        const lastOpen = [...hist].reverse().findIndex(e => !e.endDate);
        if (lastOpen >= 0) {
          const idx = hist.length - 1 - lastOpen;
          hist[idx] = {
            ...hist[idx],
            words: typeof nextRevise === 'object' ? (nextRevise.words || []) : 'all',
            parts: typeof nextRevise === 'object' ? (nextRevise.parts || []) : [],
            chars: typeof nextRevise === 'object' ? (nextRevise.chars || {}) : {},
          };
        } else {
          hist.push({
            startDate: now, endDate: null,
            words: typeof nextRevise === 'object' ? (nextRevise.words || []) : 'all',
            parts: typeof nextRevise === 'object' ? (nextRevise.parts || []) : [],
            chars: typeof nextRevise === 'object' ? (nextRevise.chars || {}) : {},
          });
        }
      }
      return { ...d, toRevise: nextRevise, reviseHistory: hist };
    });
  };

  const revise   = ld?.toRevise;
  const isActive = !!revise;
  const selWords = (revise && typeof revise === 'object') ? (revise.words || []) : [];
  const selParts = (revise && typeof revise === 'object') ? (revise.parts || []) : [];
  const selChars = (revise && typeof revise === 'object') ? (revise.chars || {}) : {};

  const toggleAll = () => saveWithHistory(isActive ? false : true, revise);

  const toggleWord = (i) => {
    const cur = typeof revise === 'object' ? revise : {};
    const prev = cur.words || [];
    const exists = prev.includes(i);
    const nextWords = exists ? prev.filter(x => x !== i) : [...prev, i];
    const nextChars = { ...(cur.chars || {}) };
    if (exists) delete nextChars[i];

    if (nextWords.length === 0 && (cur.parts || []).length === 0) {
      saveWithHistory(false, revise);
      return false;
    }
    saveWithHistory({ ...cur, words: nextWords, chars: nextChars }, revise);
    return !exists;
  };

  const toggleChar = (wi, ci) => {
    const cur = typeof revise === 'object' ? revise : {};
    const prevMap = cur.chars || {};
    const prevList = prevMap[wi] || [];
    const exists = prevList.includes(ci);
    const nextList = exists ? prevList.filter(x => x !== ci) : [...prevList, ci];
    const nextMap = { ...prevMap };

    if (nextList.length === 0) delete nextMap[wi];
    else nextMap[wi] = nextList;

    const curWords = cur.words || [];
    const nextWords = curWords.includes(wi) ? curWords : [...curWords, wi];

    saveWithHistory({ ...cur, words: nextWords, chars: nextMap }, revise);
  };

  const togglePart = (pid) => {
    const cur = typeof revise === 'object' ? revise : {};
    const prev = cur.parts || [];
    const exists = prev.includes(pid);
    const nextParts = exists ? prev.filter(x => x !== pid) : [...prev, pid];

    if (nextParts.length === 0 && (cur.words || []).length === 0) {
      saveWithHistory(false, revise);
      return;
    }
    saveWithHistory({ ...cur, parts: nextParts }, revise);
  };

  return { revise, isActive, selWords, selParts, selChars, toggleAll, toggleWord, toggleChar, togglePart };
}

export function ToRevisePanel({ ayat, surahNum, ld, setLData }) {
  const [expandedWord, setExpandedWord] = useState(null);

  const { isActive, selWords, selParts, selChars, toggleAll, toggleWord: toggleWordBase, toggleChar, togglePart } =
    useToRevise(ld, surahNum, ayat.numberInSurah, setLData);

  const ayatWords = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
  const parts     = ld?.parts || [];

  const toggleWord = (i) => {
    const wasSelected = toggleWordBase(i);
    if (wasSelected && expandedWord === i) setExpandedWord(null);
  };

  const splitChars = splitArabicChars;
  const gold = 'var(--gold)'; const gold2 = 'var(--gold2)';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)' }}>🔖 MARQUER À RÉVISER</div>
        <button onClick={toggleAll} style={{
          fontSize:8, letterSpacing:1.5, padding:'4px 12px', borderRadius:6, cursor:'pointer',
          fontFamily:"'Cinzel',serif", transition:'all .2s',
          background: isActive ? 'rgba(201,168,76,.15)' : 'transparent',
          border: `1px solid ${isActive ? gold : 'rgba(255,255,255,.15)'}`,
          color: isActive ? gold2 : 'var(--text3)',
        }}>{isActive ? '✓ MARQUÉ — RETIRER' : "MARQUER TOUT L'AYAT"}</button>
      </div>

      {ayatWords.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)' }}>MOTS · LETTRES · HARAKAT</div>
          <div style={{ direction:'rtl', display:'flex', flexWrap:'wrap', gap:6 }}>
            {ayatWords.map((w, i) => {
              const sel     = selWords.includes(i);
              const expanded= expandedWord === i;
              const charSel = selChars[i] || [];
              return (
                <div key={i} style={{ display:'flex', alignItems:'stretch', borderRadius:6, overflow:'hidden',
                  border:`1px solid ${expanded ? '#5bc8f5' : sel ? gold : 'rgba(255,255,255,.1)'}`,
                  background: sel ? 'rgba(201,168,76,.15)' : 'rgba(255,255,255,.03)' }}>
                  <button onClick={() => toggleWord(i)} style={{
                    fontFamily:"'Amiri Quran',serif", fontSize:18, padding:'4px 10px',
                    background:'transparent', border:'none', cursor:'pointer',
                    color: sel ? gold2 : 'var(--text2)' }}>{w}</button>
                  <button onClick={() => setExpandedWord(expanded ? null : i)}
                    style={{ padding:'0 7px', cursor:'pointer', border:'none',
                      background: expanded ? 'rgba(91,200,245,.15)' : charSel.length > 0 ? 'rgba(91,200,245,.08)' : 'rgba(255,255,255,.04)',
                      borderLeft:'1px solid rgba(255,255,255,.08)',
                      color: expanded || charSel.length > 0 ? '#5bc8f5' : 'var(--text3)',
                      fontSize:8, display:'flex', alignItems:'center' }}>
                    {charSel.length > 0 ? charSel.length : ''}{expanded ? '▲' : '▾'}
                  </button>
                </div>
              );
            })}
          </div>

          {expandedWord !== null && (() => {
            const wi      = expandedWord;
            const w       = ayatWords[wi] || '';
            const clusters= splitChars(w);
            const charSel = selChars[wi] || [];
            return (
              <div style={{ direction:'rtl', display:'flex', flexWrap:'wrap', gap:4,
                padding:'8px 10px', background:'rgba(91,200,245,.06)',
                border:'1px solid rgba(91,200,245,.2)', borderRadius:8 }}>
                <div style={{ width:'100%', fontSize:7, letterSpacing:1.5, color:'#5bc8f5',
                  fontFamily:"'Cinzel',serif", marginBottom:4, textAlign:'right' }}>
                  LETTRES DE : {w}
                </div>
                {clusters.map((c, ci) => {
                  const cSel = charSel.includes(ci);
                  return (
                    <button key={ci} onClick={() => toggleChar(wi, ci)} style={{
                      fontFamily:"'Amiri Quran',serif", fontSize:22,
                      padding:'4px 8px', minWidth:34, borderRadius:6, cursor:'pointer',
                      background: cSel ? 'rgba(91,200,245,.2)' : 'rgba(255,255,255,.05)',
                      border:`1px solid ${cSel ? '#5bc8f5' : 'rgba(255,255,255,.12)'}`,
                      color: cSel ? '#5bc8f5' : 'var(--text1)',
                      boxShadow: cSel ? '0 0 6px rgba(91,200,245,.35)' : 'none',
                      transition:'all .12s' }}>{c}</button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {parts.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)' }}>PARTIES DE L'AYAT</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {parts.map((p, pi) => {
              const pSel = selParts.includes(p.id);
              return (
                <button key={p.id} onClick={() => togglePart(p.id)} style={{
                  fontSize:9, letterSpacing:1, padding:'6px 12px', borderRadius:6, cursor:'pointer',
                  fontFamily:"'Cinzel',serif", transition:'all .15s',
                  background: pSel ? 'rgba(201,168,76,.15)' : 'rgba(255,255,255,.03)',
                  border: `1px solid ${pSel ? gold : 'rgba(255,255,255,.1)'}`,
                  color: pSel ? gold2 : 'var(--text2)',
                }}>PARTIE {pi + 1}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TajweedExercice({ ayat }) {
  const [answered, setAnswered] = useState({});
  const [selected, setSelected] = useState(null);

  const wordArr = ayat?.text ? splitArabicWords(ayat.text) : [];

  const charsWithRules = useMemo(() => {
    const list = [];
    wordArr.forEach((w, wi) => {
      const chars = splitArabicChars(w);
      chars.forEach((c, ci) => {
        let ruleId = null;
        if (isQalqala(chars, ci)) ruleId = 'qalqala';
        else if (getMaddType(chars, ci)) ruleId = 'madd';
        else if (isIzhar(chars, ci)) ruleId = 'izhar';
        else if (isIdgham(chars, ci)) ruleId = 'idgham';

        if (ruleId) {
          list.push({ char: c, ruleId, idx: `${wi}_${ci}` });
        }
      });
    });
    return list;
  }, [ayat]);

  const shuffledChars = useMemo(() => [...charsWithRules].sort(() => Math.random() - 0.5), [charsWithRules]);
  const shuffledRules = useMemo(() => [...TAJWEED_RULES].sort(() => Math.random() - 0.5), []);

  const handleSelect = (type, id) => {
    if (!selected) {
      setSelected({ type, id });
      return;
    }

    if (selected.type === type) {
      setSelected({ type, id });
      return;
    }

    const charId = type === 'char' ? id : selected.id;
    const ruleId = type === 'rule' ? id : selected.id;

    const targetChar = charsWithRules.find(c => `${c.char}:${c.idx}` === charId);
    const isCorrect = targetChar?.ruleId === ruleId;

    setAnswered(prev => ({ ...prev, [`${charId}::${ruleId}`]: isCorrect }));
    setSelected(null);
  };

  const ruleColor = (id) => TAJWEED_RULES.find(r => r.id === id)?.color || 'var(--gold)';
  const totalPairs = charsWithRules.length;
  const answeredCount = Object.keys(answered).length;
  const correctCount = Object.values(answered).filter(Boolean).length;
  const isRuleAnswered = (ruleId) => Object.entries(answered).some(([k, v]) => k.endsWith(`::${ruleId}`) && v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        ☪ EXERCICE DE TAJWEED
      </div>

      {totalPairs === 0 ? (
        <div style={{ fontSize: 9, color: "var(--text3)", fontStyle: "italic" }}>
          Aucune règle de Tajweed spécifique détectée sur cette ayat.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--text3)" }}>LETTRES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, direction: "rtl" }}>
              {shuffledChars.map(p => {
                const charId = `${p.char}:${p.idx}`;
                const isSelected = selected?.type === 'char' && selected.id === charId;
                const ans = Object.entries(answered).find(([k]) => k.startsWith(charId + '::'));
                const color = ans ? (ans[1] ? '#4caf81' : '#e05a5a') : ruleColor(p.ruleId);
                return (
                  <button key={charId} onClick={() => handleSelect('char', charId)}
                    style={{
                      fontSize: 22, fontFamily: 'Scheherazade New, serif',
                      padding: '6px 14px', borderRadius: 8, cursor: ans ? 'default' : 'pointer',
                      border: `2px solid ${isSelected ? 'var(--gold)' : ans ? color : 'var(--border2)'}`,
                      background: isSelected ? 'rgba(201,168,76,.12)' : ans ? `${color}22` : 'var(--surface2)',
                      color: ans ? color : 'var(--text)', transition: 'all .15s',
                    }}>{p.char}</button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--text3)" }}>RÈGLES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {shuffledRules.map(rule => {
                const isSelected = selected?.type === 'rule' && selected.id === rule.id;
                const done = isRuleAnswered(rule.id);
                return (
                  <button key={rule.id} onClick={() => handleSelect('rule', rule.id)}
                    style={{
                      fontSize: 9, letterSpacing: 1.5, fontFamily: "'Cinzel',serif",
                      padding: '8px 16px', borderRadius: 8, cursor: done ? 'default' : 'pointer',
                      border: `2px solid ${isSelected ? 'var(--gold)' : done ? rule.color : 'var(--border2)'}`,
                      background: isSelected ? 'rgba(201,168,76,.12)' : done ? `${rule.color}22` : 'var(--surface2)',
                      color: done ? rule.color : isSelected ? 'var(--gold)' : 'var(--text2)',
                      transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                    <span style={{ fontSize: 14, fontFamily: 'Scheherazade New, serif' }}>{rule.labelAr}</span>
                    {rule.label}
                  </button>
                );
              })}
            </div>
          </div>

          {answeredCount === totalPairs && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, textAlign: 'center',
              background: correctCount === totalPairs ? 'rgba(76,175,129,.1)' : 'rgba(224,90,90,.08)',
              border: `1px solid ${correctCount === totalPairs ? 'var(--green)' : 'var(--red)'}`,
            }}>
              <div style={{ fontSize: 12, color: correctCount === totalPairs ? 'var(--green)' : 'var(--red)' }}>
                {correctCount === totalPairs ? '✓ Parfait !' : `${correctCount}/${totalPairs}`}
              </div>
              <button onClick={() => { setAnswered({}); setSelected(null); }}
                style={{
                  marginTop: 6, fontSize: 8, letterSpacing: 1.5, fontFamily: "'Cinzel',serif",
                  padding: '5px 14px', borderRadius: 6, background: 'none', cursor: 'pointer',
                  border: '1px solid var(--border2)', color: 'var(--text3)',
                }}>↺ RECOMMENCER</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function InfoMode({ ayat, ld, setLData, surahNum }) {
  const isSajda = SAJDA_AYATS.has(`${surahNum}:${ayat?.numberInSurah}`);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        ℹ INFOS DE L'AYAT {ayat?.numberInSurah}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        <div className="learn-stat">JUZ <span className="val">{ayat?.juz || 1}</span></div>
        <div className="learn-stat">HIZB <span className="val">{ayat?.hizbQuarter ? Math.ceil(ayat.hizbQuarter/4) : 1}</span></div>
        <div className="learn-stat">PAGE <span className="val">{ayat?.page || 1}</span></div>
        <div className="learn-stat">PROSTERNATION <span className="val">{isSajda ? "OUI ۩" : "NON"}</span></div>
      </div>
    </div>
  );
}

export function AideMemoireMode({ ayat, surahNum, ld, setLData, clickMode, setClickMode, spellCheck = true }) {
  const words = ayat?.text ? splitArabicWords(ayat.text) : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        📖 AIDE MÉMOIRE (PREMIERS & DERNIERS MOTS)
      </div>
      <div style={{ display: "flex", gap: 12, direction: "rtl", fontFamily: "'Amiri Quran',serif", fontSize: 20 }}>
        <div style={{ flex: 1, padding: 10, background: "var(--surface3)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 8, color: "var(--text3)", fontFamily: "'Cinzel',serif", direction: "ltr", marginBottom: 4 }}>DÉBUT</div>
          {words.slice(0, 3).join(" ")}…
        </div>
        <div style={{ flex: 1, padding: 10, background: "var(--surface3)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 8, color: "var(--text3)", fontFamily: "'Cinzel',serif", direction: "ltr", marginBottom: 4 }}>FIN</div>
          …{words.slice(-3).join(" ")}
        </div>
      </div>
    </div>
  );
}

export function DecouverteMode({ ayat, surahNum, ld, setLData, audioUrl, timestamps }) {
  const words = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
  const [revealedUpTo, setRevealedUpTo] = useState(-1);
  const [markMode, setMarkMode]         = useState(false);
  const [expandedWord, setExpandedWord] = useState(null);
  const [playingWord, setPlayingWord]   = useState(null);
  const audioRef = useRef(null);
  const seqTokenRef = useRef(0);

  const hasToRevise = !!setLData;
  const { isActive, selWords, selChars, toggleWord: toggleWordBase, toggleChar } =
    useToRevise(ld, surahNum, ayat.numberInSurah, setLData);

  const toggleWord = (i) => {
    const wasSelected = toggleWordBase(i);
    if (wasSelected && expandedWord === i) setExpandedWord(null);
  };

  const hasTs = !!timestamps?.words;
  const playWordAsync = (i, myToken) => {
    return new Promise(resolve => {
      const a = audioRef.current;
      const word = timestamps?.words?.[i];
      if (!a || !audioUrl || !word) { resolve(); return; }
      const chars = fixChars(word.chars || []);
      if (!chars.length) { resolve(); return; }
      const startMs = chars[0].start;
      const endMs   = chars[chars.length - 1].end;
      if (a.src !== audioUrl) a.src = audioUrl;
      a.currentTime = startMs / 1000;
      setPlayingWord(i);
      a.play().then(() => {
        const checkEnd = () => {
          if (!audioRef.current || seqTokenRef.current !== myToken) { resolve(); return; }
          if (audioRef.current.currentTime * 1000 >= endMs) {
            audioRef.current.pause();
            resolve();
            return;
          }
          requestAnimationFrame(checkEnd);
        };
        requestAnimationFrame(checkEnd);
      }).catch(() => resolve());
    });
  };

  const playWordsSequential = async (fromIdx, toIdx) => {
    seqTokenRef.current += 1;
    const myToken = seqTokenRef.current;
    for (let i = fromIdx; i <= toIdx; i++) {
      if (seqTokenRef.current !== myToken) return;
      await playWordAsync(i, myToken);
      if (seqTokenRef.current !== myToken) return;
    }
    setPlayingWord(null);
  };

  useEffect(() => () => { seqTokenRef.current += 1; audioRef.current?.pause(); }, []);

  const displayNum = (i) => i + 1;
  const isRevealed = (i) => i <= revealedUpTo;

  const revealNext = () => setRevealedUpTo(v => Math.min(v + 1, words.length - 1));
  const reset      = () => setRevealedUpTo(-1);
  const revealAll  = () => setRevealedUpTo(words.length - 1);

  const revealed   = revealedUpTo + 1;
  const hidden     = words.length - revealed;
  const allShown   = revealedUpTo >= words.length - 1;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'14px 16px' }}>
      <audio ref={audioRef} style={{ display:'none' }} />

      <div style={{ direction:'rtl', fontFamily:"'Amiri Quran',serif",
        lineHeight:2.4, textAlign:'center', padding:'12px 10px',
        background:'var(--surface3)', borderRadius:10, border:'1px solid var(--border)',
        display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', alignItems:'flex-end' }}>
        {words.map((w, i) => {
          const rev = isRevealed(i);
          return (
            <span key={i} onClick={() => !rev && setRevealedUpTo(i)} style={{
              display:'inline-block', padding:'2px 8px', borderRadius:6,
              fontFamily:"'Amiri Quran',serif", fontSize: rev ? 22 : 20,
              color: rev ? 'var(--text1)' : 'transparent',
              background: rev ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.18)',
              minWidth: rev ? 0 : 34, textAlign:'center', cursor:'pointer',
            }}>{rev ? w : '▪▪▪'}</span>
          );
        })}
      </div>

      <div style={{ display:'flex', gap:8 }}>
        {!allShown ? (
          <button onClick={revealNext} style={{ flex:1, padding:'10px', background:'var(--teal)', border:'none', borderRadius:8, color:'#fff', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
            ▶ SUIVANT · {hidden} MOT{hidden>1?'S':''}
          </button>
        ) : (
          <div style={{ flex:1, textAlign:'center', fontSize:9, letterSpacing:2, color:'var(--green)', fontFamily:"'Cinzel',serif", padding:'10px' }}>✓ COMPLET</div>
        )}
        <button onClick={reset} style={{ padding:'10px 14px', background:'transparent', border:'1px solid var(--border2)', borderRadius:8, color:'var(--text3)', fontSize:13, cursor:'pointer' }}>↺</button>
        {!allShown && (
          <button onClick={revealAll} style={{ padding:'10px 14px', background:'transparent', border:'1px solid var(--border2)', borderRadius:8, color:'var(--text3)', fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>TOUT</button>
        )}
      </div>
    </div>
  );
}

export function LectureMode({ ayat, surahNum, audioUrl, isMainPlaying, timestamps, onLoadTimestamps, onUpdateTimestamps, onLocalPlay }) {
  const audioRef = useRef(null);
  const rafRef   = useRef(null);
  const [lectureTab, setLectureTab]   = useState("listen");
  const [currentMs, setCurrentMs]     = useState(0);
  const [showEditor, setShowEditor]   = useState(false);
  const [editTs, setEditTs]           = useState(null);

  useEffect(() => { if (timestamps) setEditTs(JSON.parse(JSON.stringify(timestamps))); }, [timestamps]);

  const stop = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } onLocalPlay?.(null); };
  useEffect(() => { if (isMainPlaying && audioRef.current) { audioRef.current.pause(); stop(); } }, [isMainPlaying]);

  const onPlay = () => {
    const tick = () => {
      if (audioRef.current) {
        const ms = audioRef.current.currentTime * 1000;
        setCurrentMs(ms);
        onLocalPlay?.(ms);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const onPause = () => stop();
  const onEnded = () => { stop(); setCurrentMs(0); };

  const handleFile = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { try { onLoadTimestamps(JSON.parse(ev.target.result)); } catch { alert("JSON invalide"); } };
    r.readAsText(f);
  };

  const isDiacritic = ch => /[\u064B-\u065F\u0670]/.test(ch);

  const setCharField = (wi, ci, field, val) => {
    setEditTs(prev => {
      const next  = JSON.parse(JSON.stringify(prev));
      const chars = next.words[wi].chars;
      chars[ci][field] = Number(val);
      return next;
    });
  };

  const captureStart = (wi, ci) => {
    const ms = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setCharField(wi, ci, 'start', ms);
  };
  const captureEnd = (wi, ci) => {
    const ms = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setCharField(wi, ci, 'end', ms);
  };

  const saveAndExport = () => {
    onUpdateTimestamps(editTs);
    const blob = new Blob([JSON.stringify(editTs, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `timestamps_ayat_${ayat.numberInSurah}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const [localPlaying, setLocalPlaying] = useState(false);
  const [localCurrentMs, setLocalCurrentMs] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  };

  const seek = (e) => {
    if (!audioRef.current || !localDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * (localDuration / 1000);
  };

  const fmt = ms => {
    if (!ms) return "0:00";
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  };

  const pct = localDuration > 0 ? Math.min(1, localCurrentMs / localDuration) : 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", gap:6 }}>
        {[["listen","📖 ÉCOUTER"],["record","🎙 ENREGISTRER"]].map(([id,label])=>(
          <button key={id} onClick={() => setLectureTab(id)} style={{
            fontSize:8, letterSpacing:2, padding:"5px 14px", fontFamily:"'Cinzel',serif",
            background: lectureTab===id ? "rgba(201,168,76,.12)" : "transparent",
            border: `1px solid ${lectureTab===id ? "var(--gold)" : "var(--border2)"}`,
            color: lectureTab===id ? "var(--gold2)" : "var(--text3)",
            borderRadius:6, cursor:"pointer", transition:"all .15s",
          }}>{label}</button>
        ))}
      </div>

      {lectureTab === "listen" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
              AYAT {ayat.numberInSurah}
            </div>
            {timestamps && (
              <button onClick={() => setShowEditor(s => !s)} style={{
                fontSize:7, letterSpacing:1, padding:"3px 10px", fontFamily:"'Cinzel',serif",
                background: showEditor ? "rgba(201,168,76,.1)" : "transparent",
                border:`1px solid ${showEditor?"var(--gold)":"var(--border2)"}`,
                color: showEditor ? "var(--gold2)" : "var(--text3)",
                borderRadius:4, cursor:"pointer",
              }}>{showEditor ? "✕ FERMER ÉDITEUR" : "✏ TIMESTAMPS"}</button>
            )}
          </div>

          <div style={{
            background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
            padding:"12px 14px", display:"flex", flexDirection:"column", gap:10,
          }}>
            <audio ref={audioRef} src={audioUrl}
              onPlay={() => { setLocalPlaying(true); onPlay(); }}
              onPause={() => { setLocalPlaying(false); onPause(); }}
              onEnded={() => { setLocalPlaying(false); onEnded(); setLocalCurrentMs(0); }}
              onLoadedMetadata={() => setLocalDuration((audioRef.current?.duration||0)*1000)}
              onTimeUpdate={() => setLocalCurrentMs((audioRef.current?.currentTime||0)*1000)}
              style={{ display:"none" }} />

            <div onClick={seek} style={{ height:4, background:"var(--surface3)", borderRadius:2, cursor:"pointer", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, top:0, bottom:0, width:`${pct*100}%`, background:"var(--gold)", borderRadius:2, transition:"width .1s linear" }}/>
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button onClick={togglePlay} style={{
                width:36, height:36, borderRadius:"50%",
                background: localPlaying ? "rgba(201,168,76,.15)" : "rgba(62,184,160,.12)",
                border:`1px solid ${localPlaying ? "var(--gold)" : "var(--teal)"}`,
                color: localPlaying ? "var(--gold2)" : "var(--teal2)",
                fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all .15s",
              }}>{localPlaying ? "⏸" : "▶"}</button>

              <div style={{ fontSize:8, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif", flexShrink:0 }}>
                {fmt(localCurrentMs)} / {fmt(localDuration)}
              </div>

              <div style={{ flex:1 }}/>

              {!timestamps && (
                <label style={{ cursor:"pointer" }}>
                  <input type="file" accept=".json" onChange={handleFile} style={{ display:"none" }} />
                  <span style={{ fontSize:7, letterSpacing:1, padding:"3px 10px", border:"1px solid var(--border2)", borderRadius:4, color:"var(--text3)", fontFamily:"'Cinzel',serif", whiteSpace:"nowrap" }}>📂 TS</span>
                </label>
              )}
              {timestamps && <div style={{ fontSize:7, color:"var(--teal2)", letterSpacing:1 }}>⚡ TS</div>}
            </div>
          </div>

          {showEditor && editTs?.words && (
            <EditorWords editTs={editTs} currentMs={localCurrentMs} setCharField={setCharField}
              captureStart={captureStart} captureEnd={captureEnd}
              onSave={saveAndExport} onReset={() => setEditTs(JSON.parse(JSON.stringify(timestamps)))}
              isDiacritic={isDiacritic} audioRef={audioRef} />
          )}
        </div>
      )}

      {lectureTab === "record" && (
        <VoiceRecorder
          ayat={ayat}
          surahNum={surahNum}
          originalAudioUrl={audioUrl}
          localAudioRef={audioRef}
        />
      )}
    </div>
  );
}

function PartAudioPlayer({ part, words, timestamps, audioUrl, autoPlay, hideText }) {
  const audioRef  = useRef(null);
  const rafRef    = useRef(null);
  const [playing,   setPlaying]   = useState(false);
  const [looping,   setLooping]   = useState(true);
  const [currentMs, setCurrentMs] = useState(0);

  const fixChars = (chars) => {
    const isDiac = ch => /[\u064B-\u065F\u0670]/.test(ch);
    const res = [];
    for (let i = 0; i < chars.length; i++) {
      let ch = chars[i].char;
      while (i + 1 < chars.length && isDiac(chars[i + 1].char)) {
        i++;
        ch += chars[i].char;
      }
      res.push({ char: ch, start: chars[i].start, end: chars[i].end });
    }
    return res;
  };

  const timeRange = useMemo(() => {
    if (!timestamps?.words || !part.wordIndices?.length) return null;
    let startMs = Infinity, endMs = -1;
    part.wordIndices.forEach(wi => {
      const w = timestamps.words[wi];
      if (!w?.chars?.length) return;
      const ws = w.chars[0].start;
      const we = w.chars[w.chars.length - 1].end;
      if (ws < startMs) startMs = ws;
      if (we > endMs) endMs = we;
    });
    return startMs < Infinity ? { startMs, endMs } : null;
  }, [timestamps, part.wordIndices]);

  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setCurrentMs(0);
    stopRaf();
  }, [stopRaf]);

  const play = useCallback((loop, fromMs) => {
    const audio = audioRef.current;
    if (!audio || !timeRange) return;
    const startAt = fromMs ?? timeRange.startMs;
    audio.currentTime = startAt / 1000;
    audio.play().catch(() => {});
    setPlaying(true);
    stopRaf();
    const tick = () => {
      if (!audioRef.current) return;
      const ms = audioRef.current.currentTime * 1000;
      setCurrentMs(ms);
      if (ms >= timeRange.endMs) {
        if (loop) {
          audioRef.current.currentTime = timeRange.startMs / 1000;
          audioRef.current.play().catch(() => {});
          rafRef.current = requestAnimationFrame(tick);
        } else {
          stop();
        }
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [timeRange, stop, stopRaf]);

  const playFromWord = useCallback((wi) => {
    if (!timestamps?.words) return;
    const tsWord = timestamps.words[wi];
    const fromMs = tsWord?.chars?.[0]?.start ?? null;
    if (fromMs == null) return;
    stop();
    setTimeout(() => play(looping, fromMs), 20);
  }, [timestamps, play, stop, looping]);

  useEffect(() => () => { stopRaf(); audioRef.current?.pause(); }, [stopRaf]);
  useEffect(() => { if (autoPlay && timeRange) { setTimeout(() => play(true), 80); } }, [autoPlay, !!timeRange]);

  if (!timeRange) return (
    <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1, padding:"4px 0" }}>
      Aucun timestamp — chargez un fichier JSON dans l'onglet ÉCOUTER
    </div>
  );

  const durationMs = timeRange.endMs - timeRange.startMs;
  const progress   = durationMs > 0 ? Math.min(1, Math.max(0, (currentMs - timeRange.startMs) / durationMs)) : 0;

  return (
    <div>
      <audio ref={audioRef} src={audioUrl} style={{ display:"none" }}
        onEnded={() => { if (!looping) stop(); }} />
      <div className="part-player-inline">
        <button
          className={`part-player-btn ${playing ? "stop" : "play"}`}
          onClick={() => playing ? stop() : play(looping)}
          title={playing ? "Arrêter" : "Lire cette partie"}>
          {playing ? "⏹" : "▶"}
        </button>
        <button
          className={`part-player-btn ${looping ? "loop-on" : "loop-off"}`}
          onClick={() => {
            const nl = !looping;
            setLooping(nl);
            if (playing) { stop(); setTimeout(() => play(nl), 40); }
          }}
          title={looping ? "Boucle activée" : "Activer la boucle"}>
          🔁
        </button>
        <div className="part-player-chars" style={ hideText ? { filter:'blur(6px)', userSelect:'none', pointerEvents:'none', opacity:.4 } : {} }>
          {timestamps?.words
            ? part.wordIndices.map((wi, ii) => {
                const tsWord = timestamps.words[wi];
                return (
                  <span key={ii} onClick={() => playFromWord(wi)} style={{ cursor:"pointer" }}>
                    {fixChars(tsWord?.chars || [{ char: words[wi] || "", start:0, end:0 }]).map((c, ci) => {
                      const active = playing && currentMs >= c.start && currentMs <= c.end;
                      const done   = playing && currentMs > c.end;
                      return <span key={ci} className={`char-span${active?" char-active":done?" char-done":""}`}>{c.char}</span>;
                    })}
                    {ii < part.wordIndices.length - 1 ? " " : ""}
                  </span>
                );
              })
            : <span>{part.text}</span>
          }
        </div>
        <span className="part-player-dur">{(durationMs / 1000).toFixed(1)}s</span>
      </div>
      {playing && (
        <div className="part-player-progress">
          <div className="part-player-progress-fill" style={{ width:`${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function CreatePartFromAudio({ ayat, timestamps, audioUrl, existingWordIndices, initialSeekMs, onCreatePart }) {
  const audioRef    = useRef(null);
  const rafRef      = useRef(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying]     = useState(false);
  const [startMs, setStartMs]     = useState(null);
  const [endMs,   setEndMs]       = useState(null);

  const words = ayat.text ? ayat.text.split(" ").filter(Boolean) : [];
  const stopRaf = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  const onPlay  = () => {
    const tick = () => {
      if (audioRef.current) setCurrentMs(audioRef.current.currentTime * 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    setPlaying(true);
  };
  const onPause = () => { stopRaf(); setPlaying(false); };
  const onEnded = () => { stopRaf(); setPlaying(false); };

  useEffect(() => () => stopRaf(), []);
  useEffect(() => {
    if (initialSeekMs == null || !audioRef.current) return;
    audioRef.current.currentTime = initialSeekMs / 1000;
    setCurrentMs(initialSeekMs);
  }, [initialSeekMs]);

  const coveredIndices = useMemo(() => {
    if (startMs == null || endMs == null || !timestamps?.words) return [];
    return timestamps.words
      .map((w, wi) => {
        const ws = w.chars?.[0]?.start ?? null;
        const we = w.chars?.[w.chars.length - 1]?.end ?? null;
        if (ws == null || we == null) return null;
        if (we < startMs || ws > endMs) return null;
        return wi;
      })
      .filter(wi => wi !== null && !existingWordIndices.has(wi));
  }, [startMs, endMs, timestamps, existingWordIndices]);

  const fmtMs = (ms) => ms == null ? "--:--.---"
    : `${String(Math.floor(ms / 60000)).padStart(2,"0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2,"0")}.${String(Math.floor(ms % 1000)).padStart(3,"0")}`;

  const captureStart = () => setStartMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));
  const captureEnd   = () => setEndMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));

  const canCreate = coveredIndices.length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    const text = coveredIndices.map(wi => words[wi]).join(" ");
    const newStart = endMs ?? 0;
    onCreatePart({ wordIndices: coveredIndices, text });
    setStartMs(newStart);
    setEndMs(null);
    if (audioRef.current) {
      audioRef.current.currentTime = newStart / 1000;
      setCurrentMs(newStart);
    }
  };

  return (
    <div className="cpa-wrap">
      <div className="cpa-title">✂ CRÉER UNE PARTIE VIA L'AUDIO</div>
      <audio
        ref={audioRef} controls src={audioUrl}
        style={{ width:"100%", marginBottom:2 }}
        onPlay={onPlay} onPause={onPause} onEnded={onEnded}
      />
      <div className="cpa-controls">
        <div className="cpa-marker">
          <div className="cpa-marker-label">DÉBUT</div>
          <div className={`cpa-marker-time${startMs != null ? " set" : ""}`}>{fmtMs(startMs)}</div>
          <button className="cpa-btn-capture" onClick={captureStart}>
            ⬤ MARQUER
          </button>
        </div>
        <div style={{ fontSize:18, color:"var(--border2)", alignSelf:"center" }}>→</div>
        <div className="cpa-marker">
          <div className="cpa-marker-label">FIN</div>
          <div className={`cpa-marker-time${endMs != null ? " set" : ""}`}>{fmtMs(endMs)}</div>
          <button className="cpa-btn-capture" onClick={captureEnd}>
            ⬤ MARQUER
          </button>
        </div>
        <button className="cpa-btn-capture"
          onClick={() => { setStartMs(null); setEndMs(null); }}
          style={{ borderColor:"var(--border2)", color:"var(--text3)", background:"transparent" }}>
          ↺ RESET
        </button>
      </div>

      {timestamps?.words && (
        <div className="cpa-preview">
          {words.map((w, wi) => {
            const inRange   = coveredIndices.includes(wi);
            const isExist   = existingWordIndices.has(wi);
            return (
              <span key={wi} className={`cpa-preview-word${inRange ? " in-range" : ""}`}
                style={isExist ? { opacity:.35 } : {}}>
                {w}{" "}
              </span>
            );
          })}
        </div>
      )}
      <button className="cpa-create-btn" onClick={handleCreate} disabled={!canCreate}>
        + CRÉER LA PARTIE ({coveredIndices.length} mot{coveredIndices.length !== 1 ? "s" : ""})
      </button>
    </div>
  );
}

function PartItem({ part, pi, words, timestamps, audioUrl, update }) {
  const [learningStep, setLearningStep] = useState(0);
  const fakeAyat = useMemo(() => ({ text: part.text, numberInSurah: part.id }), [part.text, part.id]);

  const STEPS = [
    { label: '① ÉCOUTER',   color: '#5bc8f5', bg: 'rgba(91,200,245,.12)' },
    { label: '② MÉMORISER', color: '#ffd166', bg: 'rgba(255,209,102,.12)' },
    { label: '③ RÉCITER',   color: '#c878ff', bg: 'rgba(200,120,255,.12)' },
    { label: '↺ RESET',     color: 'var(--text3)', bg: 'transparent' },
  ];
  const btnStep = learningStep < 3 ? STEPS[learningStep] : STEPS[3];
  const advance = () => setLearningStep(s => s >= 3 ? 0 : s + 1);

  return (
    <div className={`part-item${part.learned ? " part-learned" : ""}`}>
      <div className="part-header">
        <div className="part-label">PARTIE {pi + 1} · {part.wordIndices?.length} MOTS</div>
        <button onClick={advance} style={{
          fontSize:8, letterSpacing:1, padding:'3px 10px', borderRadius:6, cursor:'pointer',
          fontFamily:"'Cinzel',serif", transition:'all .2s',
          background: btnStep.bg, border:`1px solid ${btnStep.color}`, color: btnStep.color,
        }}>{btnStep.label}</button>
        <button className={`btn-small${part.learned ? " done" : ""}`}
          onClick={() => update(d => ({ ...d, parts: d.parts.map(p => p.id === part.id ? { ...p, learned: !p.learned } : p) }))}>
          {part.learned ? "✓" : "APPRIS"}
        </button>
        <button className="btn-small" style={{ color:"var(--red)", borderColor:"var(--red)" }}
          onClick={() => update(d => ({ ...d, parts: d.parts.filter(p => p.id !== part.id) }))}>✕</button>
      </div>

      {learningStep > 0 && (
        <div style={{ display:'flex', gap:4, padding:'4px 12px 0' }}>
          {STEPS.slice(0,3).map((s,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, transition:'background .3s',
              background: i < learningStep ? s.color : 'rgba(255,255,255,.08)' }} />
          ))}
        </div>
      )}

      {learningStep < 3 && (
        <div style={{ padding: learningStep === 0 ? "0 12px 10px" : "6px 12px 6px" }}>
          <PartAudioPlayer
            key={`step-${learningStep}`}
            part={part} words={words} timestamps={timestamps} audioUrl={audioUrl}
            autoPlay={learningStep > 0}
            hideText={learningStep === 2}
          />
        </div>
      )}

      {learningStep === 2 && (
        <div style={{ margin:'0 12px 8px', padding:'8px', borderRadius:6,
          background:'rgba(255,209,102,.04)', border:'1px dashed rgba(255,209,102,.2)',
          textAlign:'center', fontSize:8, letterSpacing:2, color:'rgba(255,209,102,.35)',
          fontFamily:"'Cinzel',serif" }}>
          TEXTE MASQUÉ — RÉCITEZ DE MÉMOIRE
        </div>
      )}

      {learningStep === 3 && (
        <div style={{ padding:"4px 12px 12px" }}>
          <RecitationChecker ayat={fakeAyat} attempts={part.recitAttempts||[]} saveScore={s => update(d => ({
            ...d, parts: d.parts.map(p => {
              if (p.id !== part.id) return p;
              const prev    = p.recitAttempts || [];
              const merged  = [...prev, s];
              const bestIdx = merged.reduce((bi, a, i) => a.score > merged[bi].score ? i : bi, 0);
              const kept    = [...new Set([0, bestIdx, merged.length-1])].sort((a,b)=>a-b).map(i => merged[i]);
              return { ...p, recitAttempts: kept, ...(s.score === 100 ? { learned: true } : {}) };
            })
          }))} />
        </div>
      )}
    </div>
  );
}

export function ApprentissageMode({ ayat, surahNum, ld, setLData, timestamps, audioUrl, isSelectingThisAyat, partSelectStep, onStartPartCreate, onCancelPartCreate, clickMode, setClickMode }) {
  const words  = ayat.text ? ayat.text.split(" ").filter(Boolean) : [];
  const update = fn => setLData(surahNum, ayat.numberInSurah, fn);
  const allWordsLearned = words.length > 0 && words.every((_, i) => ld.wordsLearned?.[i]);
  const allPartsLearned = ld.parts?.length > 0 && ld.parts.every(p => p.learned);

  useEffect(() => {
    if ((allWordsLearned || allPartsLearned) && !ld.learned) {
      update(d => ({ ...d, learned: true }));
    }
  }, [allWordsLearned, allPartsLearned]);

  const [showCreateAudio, setShowCreateAudio] = useState(false);
  const [partsOpen, setPartsOpen] = useState(() => isSelectingThisAyat || false);

  useEffect(() => {
    if (isSelectingThisAyat) setPartsOpen(true);
  }, [isSelectingThisAyat]);

  const wordsInParts = useMemo(() => {
    const s = new Set();
    (ld.parts || []).forEach(p => p.wordIndices?.forEach(i => s.add(i)));
    return s;
  }, [ld.parts]);

  const nextAvailStart = wordsInParts.size > 0 ? Math.max(...[...wordsInParts]) + 1 : 0;
  const allWordsAssigned = nextAvailStart >= words.length;

  const lastPartEndMs = useMemo(() => {
    if (!timestamps?.words || wordsInParts.size === 0) return null;
    const maxIdx = Math.max(...[...wordsInParts]);
    const w = timestamps.words[maxIdx];
    if (!w) return null;
    return w.chars?.[w.chars.length - 1]?.end ?? null;
  }, [timestamps, wordsInParts]);

  const handleCreateFromAudio = ({ wordIndices, text }) => {
    update(d => ({ ...d, parts: [...(d.parts || []), { id: Date.now(), wordIndices, text, learned: !!d.learned }] }));
  };

  return (
    <div className="learn-section">
      <div className="learn-status-row">
        <div className={`learn-stat${ld.learned ? " learned-stat" : ""}`}>STATUT <span className="val">{ld.learned ? "✓ APPRIS" : "EN COURS"}</span></div>
        <div className="learn-stat">LECTURES <span className="val">{ld.readCount || 0}</span></div>
        <button className={`btn-primary${ld.learned ? " active" : ""}`} onClick={() => update(d => {
          const newLearned = !d.learned;
          return {
            ...d,
            learned: newLearned,
            parts: newLearned ? (d.parts || []).map(p => ({ ...p, learned: true })) : d.parts,
          };
        })}>{ld.learned ? "✓ APPRIS" : "MARQUER COMME APPRIS"}</button>
        {ld.parts?.length > 0 &&
          <button className="btn-small" onClick={() => update(d => ({ ...d, parts: [], wordsLearned: {} }))}>RÉINITIALISER</button>}
      </div>

      <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <button onClick={() => setPartsOpen(v => !v)} style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"8px 12px", background:"var(--surface2)", border:"none", cursor:"pointer",
          fontFamily:"'Cinzel',serif"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>PARTIES</span>
            {ld.parts?.length > 0 && (
              <span style={{ fontSize:8, padding:"2px 8px", borderRadius:10,
                background: allPartsLearned ? "rgba(76,175,129,.15)" : "rgba(201,168,76,.1)",
                color: allPartsLearned ? "var(--green)" : "var(--gold2)",
                border:"1px solid " + (allPartsLearned ? "var(--green)" : "var(--gold)") }}>
                {ld.parts.filter(p=>p.learned).length}/{ld.parts.length}
              </span>
            )}
          </div>
          <span style={{ fontSize:10, color:"var(--text3)", transition:"transform .2s",
            display:"inline-block", transform: partsOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
        </button>

        {partsOpen && (
          <div style={{ padding:"12px", display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {!isSelectingThisAyat && !allWordsAssigned && (
                <button className="btn-small" onClick={onStartPartCreate}>
                  ✂ DÉCOUPER PAR MOTS
                </button>
              )}
              {audioUrl && (
                <button className="btn-small"
                  style={showCreateAudio ? { borderColor:"var(--gold)", color:"var(--gold2)" } : {}}
                  onClick={() => setShowCreateAudio(v => !v)}>
                  🎵 CRÉER VIA AUDIO
                </button>
              )}
            </div>

            {isSelectingThisAyat && (
              <div className="create-mode-hint" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  {partSelectStep === 'start' ? "① Cliquez le premier mot sur l'ayat ↑" : "② Cliquez le dernier mot sur l'ayat ↑"}
                </span>
                <button
                  className="btn-small"
                  onClick={onCancelPartCreate}
                  style={{ color: 'var(--red)', borderColor: 'var(--red)', padding: '2px 8px', fontSize: 8 }}
                >
                  ✕ ANNULER
                </button>
              </div>
            )}
            {allWordsAssigned && ld.parts?.length > 0 && (
              <div style={{ fontSize: 9, color: "var(--green)", letterSpacing: 1 }}>✓ Tous les mots sont découpés</div>
            )}

            {showCreateAudio && (
              <CreatePartFromAudio
                ayat={ayat}
                timestamps={timestamps}
                audioUrl={audioUrl}
                existingWordIndices={wordsInParts}
                initialSeekMs={lastPartEndMs}
                onCreatePart={handleCreateFromAudio}
              />
            )}

            {(ld.parts || []).map((part, pi) => (
              <PartItem key={part.id} part={part} pi={pi} words={words} timestamps={timestamps} audioUrl={audioUrl} update={update} />
            ))}
            {ld.parts?.length === 0 && !isSelectingThisAyat && !showCreateAudio && (
              <div style={{ fontSize: 9, color: "var(--text3)", letterSpacing: 1 }}>
                Aucune partie — utilisez ✂ DÉCOUPER PAR MOTS ou 🎵 CRÉER VIA AUDIO
              </div>
            )}
          </div>
        )}
      </div>
      <RecitationChecker ayat={ayat} attempts={ld.recitAttempts||[]} saveScore={s => update(d => ({ ...d, recitAttempts: [...(d.recitAttempts||[]).slice(-49), s], ...(s.score === 100 ? { learned: true } : {}) }))} />

      {/* MOTS À SURLIGNER */}
      <div style={{display:'flex',flexDirection:'column',gap:8,padding:'12px 14px',borderTop:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)'}}>MOTS À SURLIGNER</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setClickMode?.(clickMode==='highlight'?null:'highlight')} style={{
              fontSize:8,letterSpacing:1,padding:'3px 10px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
              background:clickMode==='highlight'?'rgba(255,209,102,.15)':'transparent',
              border:`1px solid ${clickMode==='highlight'?'var(--gold)':'var(--border2)'}`,
              color:clickMode==='highlight'?'var(--gold2)':'var(--text3)',
            }}>{clickMode==='highlight' ? '✕ DÉSACTIVER' : "✏ CLIQUER SUR L'AYAT"}</button>
            {ld?.highlight?.trim() && (
              <button onClick={()=>setLData(surahNum,ayat.numberInSurah,d=>({...d,highlight:''}))} style={{
                fontSize:8,letterSpacing:1,padding:'3px 8px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
                background:'transparent',border:'1px solid var(--border2)',color:'var(--text3)',
              }}>✕</button>
            )}
          </div>
        </div>
        {clickMode==='highlight' && (
          <div style={{fontSize:8,color:'var(--teal2)',letterSpacing:1,padding:'4px 8px',background:'rgba(62,184,160,.08)',borderRadius:6,border:'1px solid var(--teal)'}}>
            ↑ Cliquez sur les mots dans l'ayat ci-dessus
          </div>
        )}
        {ld?.highlight?.trim() ? (
          <div style={{direction:'rtl',fontFamily:"'Amiri Quran',serif",fontSize:18,color:'#ffd166',letterSpacing:.5,padding:'6px 10px',background:'rgba(255,209,102,.07)',borderRadius:6,border:'1px solid rgba(255,209,102,.2)'}}>
            {ld.highlight}
          </div>
        ) : (
          <div style={{fontSize:9,color:'var(--text3)',fontStyle:'italic'}}>Aucun mot sélectionné</div>
        )}
      </div>

      {/* MOTS INCONNUS */}
      <div style={{display:'flex',flexDirection:'column',gap:8,padding:'12px 14px',borderTop:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)'}}>MOTS INCONNUS</div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button onClick={()=>setClickMode?.(clickMode==='unknown'?null:'unknown')} style={{
              fontSize:8,letterSpacing:1,padding:'3px 10px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
              background:clickMode==='unknown'?'rgba(255,126,179,.15)':'transparent',
              border:`1px solid ${clickMode==='unknown'?'#ff7eb3':'var(--border2)'}`,
              color:clickMode==='unknown'?'#ff7eb3':'var(--text3)',
            }}>{clickMode==='unknown' ? '✕ DÉSACTIVER' : "✏ CLIQUER SUR L'AYAT"}</button>
            {(ld?.unknownWords||[]).length > 0 && (
              <button onClick={()=>setLData(surahNum,ayat.numberInSurah,d=>({...d,unknownWords:[]}))} style={{
                fontSize:8,letterSpacing:1,padding:'3px 8px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
                background:'transparent',border:'1px solid var(--border2)',color:'var(--text3)',
              }}>✕</button>
            )}
          </div>
        </div>
        {clickMode==='unknown' && (
          <div style={{fontSize:8,color:'#ff7eb3',letterSpacing:1,padding:'4px 8px',background:'rgba(255,126,179,.08)',borderRadius:6,border:'1px solid rgba(255,126,179,.3)'}}>
            ↑ Cliquez sur les mots inconnus dans l'ayat ci-dessus
          </div>
        )}
        {(() => {
          const ayatWords2 = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
          const unkSet = new Set(ld?.unknownWords || []);
          if (unkSet.size === 0) return <div style={{fontSize:9,color:'var(--text3)',fontStyle:'italic'}}>Aucun mot inconnu marqué</div>;
          const unkNorms = new Set([...unkSet].map(i => arabicRoot(ayatWords2[i] || '')).filter(Boolean));
          const autoSet = new Set();
          ayatWords2.forEach((w, i) => { if (!unkSet.has(i) && unkNorms.has(arabicRoot(w))) autoSet.add(i); });
          return (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{direction:'rtl',fontFamily:"'Amiri Quran',serif",fontSize:18,lineHeight:1.8}}>
                {ayatWords2.map((w, i) => {
                  const manual = unkSet.has(i);
                  const auto   = !manual && autoSet.has(i);
                  if (!manual && !auto) return null;
                  return (
                    <span key={i} style={{display:'inline-block',margin:'2px 4px',padding:'2px 6px',borderRadius:5,
                      background: auto ? 'rgba(255,126,179,.07)' : 'rgba(255,126,179,.15)',
                      border: `1px solid ${auto ? 'rgba(255,126,179,.25)' : 'rgba(255,126,179,.4)'}`,
                      color:'#ff7eb3', opacity: auto ? 0.7 : 1,
                      textDecoration:'underline dotted #ff7eb3',
                      position:'relative',
                    }}>
                      {w}
                      {auto && <span style={{position:'absolute',top:-6,right:2,fontSize:6,letterSpacing:.5,color:'rgba(255,126,179,.6)',fontFamily:"'Cinzel',serif"}}>AUTO</span>}
                    </span>
                  );
                })}
              </div>
              {autoSet.size > 0 && (
                <div style={{fontSize:8,color:'rgba(255,126,179,.6)',letterSpacing:1,fontFamily:"'Cinzel',serif"}}>
                  +{autoSet.size} AUTRE{autoSet.size>1?'S':''} OCCURRENCE{autoSet.size>1?'S':''} DÉTECTÉE{autoSet.size>1?'S':''}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default function Submenu({
  ayat, surahNum, ld, setLData, submenuMode, setSubmenuMode,
  audioUrl, isMainPlaying, timestamps, onLoadTimestamps, onUpdateTimestamps,
  onLocalPlay, partSelectAyat, partSelectStep, onStartPartCreate, onCancelPartCreate, collections,
  ayatInCollections, onOpenCollModal, aideMemoireClickMode, setAideMemoireClickMode,
  spellCheck, onSetLoop, ayatLoopActive
}) {
  return (
    <div className="submenu" onClick={e => e.stopPropagation()}>
      <div className="submenu-header">
        <button className={`mode-btn${submenuMode === "lecture" ? " active" : ""}`} onClick={() => setSubmenuMode("lecture")}>LECTURE</button>
        <button className={`mode-btn${submenuMode === "decouverte" ? " active" : ""}`} onClick={() => setSubmenuMode("decouverte")}>👁 DÉCOUVERTE</button>
        <button className={`mode-btn${submenuMode === "apprentissage" ? " active" : ""}`} onClick={() => setSubmenuMode("apprentissage")}>APPRENTISSAGE</button>
        <button
          className={`mode-btn${submenuMode === "collections" ? " active" : ""}`}
          onClick={() => setSubmenuMode("collections")}
          style={submenuMode !== "collections" && ayatInCollections?.length > 0 ? { color: "#c878ff" } : {}}
        >
          🗂 COLLECTIONS{ayatInCollections?.length > 0 ? ` (${ayatInCollections.length})` : ""}
        </button>
        <button className={`mode-btn${submenuMode === "infos" ? " active" : ""}`} onClick={() => setSubmenuMode("infos")}>ℹ INFOS</button>
        <button className={`mode-btn${submenuMode === "memoire" ? " active" : ""}`} onClick={() => setSubmenuMode("memoire")}>📖 AIDE MÉMOIRE</button>
        <button className={`mode-btn${submenuMode === "tajweed" ? " active" : ""}`} onClick={() => setSubmenuMode("tajweed")}>☪ TAJWEED</button>
        <button
          onClick={() => setSubmenuMode(submenuMode === 'reviser' ? 'lecture' : 'reviser')}
          title={ld.toRevise ? "Modifier marquage à réviser" : "Marquer à réviser"}
          style={{
            flexShrink:0, padding:"6px 10px", fontSize:13, cursor:"pointer",
            background: ld.toRevise ? "rgba(201,168,76,.12)" : submenuMode === 'reviser' ? "rgba(255,255,255,.05)" : "transparent",
            border:"none", borderBottom: ld.toRevise ? "2px solid var(--gold)" : submenuMode === 'reviser' ? "2px solid var(--text3)" : "2px solid transparent",
            color: ld.toRevise ? "var(--gold2)" : submenuMode === 'reviser' ? "var(--text2)" : "var(--text3)",
            transition:"all .15s",
          }}>🔖</button>
        <button onClick={() => onSetLoop?.()} style={{
          flexShrink:0, padding:"6px 10px", fontSize:14, cursor:"pointer",
          background: ayatLoopActive ? "rgba(62,184,160,.12)" : "transparent",
          border: "none", borderBottom: ayatLoopActive ? "2px solid var(--teal)" : "2px solid transparent",
          color: ayatLoopActive ? "var(--teal2)" : "var(--text3)",
          transition:"all .15s",
        }} title="Lire en boucle">↺</button>
      </div>

      <div className="submenu-content">
        {submenuMode === "lecture"
          ? <LectureMode ayat={ayat} surahNum={surahNum} audioUrl={audioUrl} isMainPlaying={isMainPlaying} timestamps={timestamps} onLoadTimestamps={onLoadTimestamps} onUpdateTimestamps={onUpdateTimestamps} onLocalPlay={onLocalPlay} />
          : submenuMode === "decouverte"
          ? <DecouverteMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} audioUrl={audioUrl} timestamps={timestamps} />
          : submenuMode === "apprentissage"
          ? <ApprentissageMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} timestamps={timestamps} audioUrl={audioUrl}
              isSelectingThisAyat={partSelectAyat === ayat.numberInSurah}
              partSelectStep={partSelectStep}
              onStartPartCreate={onStartPartCreate}
              onCancelPartCreate={onCancelPartCreate}
              clickMode={aideMemoireClickMode} setClickMode={setAideMemoireClickMode} />
          : submenuMode === "infos"
          ? <InfoMode ayat={ayat} ld={ld} setLData={setLData} surahNum={surahNum} />
          : submenuMode === "memoire"
          ? <AideMemoireMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} clickMode={aideMemoireClickMode} setClickMode={setAideMemoireClickMode} spellCheck={spellCheck} />
          : submenuMode === "tajweed"
          ? <TajweedExercice ayat={ayat} />
          : submenuMode === "reviser"
          ? <ToRevisePanel ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} />
          : <AyatCollectionsTab
              surahNum={surahNum} ayatNum={ayat.numberInSurah}
              collections={collections}
              ayatInCollections={ayatInCollections}
              onOpenModal={onOpenCollModal}
            />
        }
      </div>
    </div>
  );
}

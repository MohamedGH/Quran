import React, { useState, useEffect, useRef, useMemo } from "react";
import { TAJWEED_RULES, SAJDA_AYATS, PAGE_POSITION_LABELS } from "../utils/quranData";
import { splitArabicWords, arabicRoot, splitArabicChars, isQalqala, getMaddType, isIzhar, isIdgham } from "../utils/arabicUtils";
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

export function RevisionEcritureMode({ ayat, surahNum, ld, setLData, spellCheck = false }) {
  const [val, setVal]   = useState("");
  const [show, setShow] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        ✏ RÉVISION ÉCRITURE
      </div>
      <textarea
        rows={3}
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="Écrivez le verset de mémoire…"
        spellCheck={spellCheck}
        style={{
          width: "100%", background: "var(--surface3)", border: "1px solid var(--border2)",
          borderRadius: 8, padding: 12, color: "var(--text)", fontFamily: "'Amiri Quran',serif",
          fontSize: 20, direction: "rtl", outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={() => setShow(!show)}>
          {show ? "MASQUER CORRECTION" : "COMPARER AVEC L'ORIGINAL"}
        </button>
      </div>
      {show && (
        <div style={{ padding: 12, background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "'Amiri Quran',serif", fontSize: 22, direction: "rtl" }}>
          {ayat?.text}
        </div>
      )}
    </div>
  );
}

export function DecouverteMode({ ayat, surahNum, ld, setLData, audioUrl, timestamps }) {
  const words = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
  const [revealedUpTo, setRevealedUpTo] = useState(-1);
  const audioRef = useRef(null);

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

export function ApprentissageMode({ ayat, surahNum, ld, setLData, timestamps, audioUrl, isSelectingThisAyat, partSelectStep, onStartPartCreate, clickMode, setClickMode }) {
  const update = fn => setLData(surahNum, ayat.numberInSurah, fn);

  return (
    <div className="learn-section">
      <div className="learn-status-row">
        <div className={`learn-stat${ld.learned ? " learned-stat" : ""}`}>STATUT <span className="val">{ld.learned ? "✓ APPRIS" : "EN COURS"}</span></div>
        <div className="learn-stat">LECTURES <span className="val">{ld.readCount || 0}</span></div>
        <button className={`btn-primary${ld.learned ? " active" : ""}`} onClick={() => update(d => ({ ...d, learned: !d.learned }))}>
          {ld.learned ? "✓ APPRIS" : "MARQUER COMME APPRIS"}
        </button>
      </div>

      <RecitationChecker ayat={ayat} attempts={ld.recitAttempts||[]} saveScore={s => update(d => ({ ...d, recitAttempts: [...(d.recitAttempts||[]).slice(-49), s], ...(s.score === 100 ? { learned: true } : {}) }))} />
    </div>
  );
}

export default function Submenu({
  ayat, surahNum, ld, setLData, submenuMode, setSubmenuMode,
  audioUrl, isMainPlaying, timestamps, onLoadTimestamps, onUpdateTimestamps,
  onLocalPlay, partSelectAyat, partSelectStep, onStartPartCreate, collections,
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
              clickMode={aideMemoireClickMode} setClickMode={setAideMemoireClickMode} />
          : submenuMode === "infos"
          ? <InfoMode ayat={ayat} ld={ld} setLData={setLData} surahNum={surahNum} />
          : submenuMode === "memoire"
          ? <AideMemoireMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} clickMode={aideMemoireClickMode} setClickMode={setAideMemoireClickMode} spellCheck={spellCheck} />
          : submenuMode === "tajweed"
          ? <TajweedExercice ayat={ayat} />
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

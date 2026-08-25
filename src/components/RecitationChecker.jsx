import React, { useState, useEffect, useRef, useCallback } from "react";
import { compareRecitation, normalizeArabic } from "../utils/arabicUtils";
import { useArabicKeyboard } from "./ArabicKeyboard";
import { createAudioRecorder, IS_ANDROID } from "../services/audioRecorder";

export default function RecitationChecker({ ayat, saveScore, attempts }) {
  const { activeInput: arabicActiveInput } = useArabicKeyboard();
  const [typedText, setTypedText]       = useState("");
  const [transcript, setTranscript]     = useState("");
  const [recResult, setRecResult]       = useState(null);
  const [recording, setRecording]       = useState(false);
  const [showDebug, setShowDebug]       = useState(false);
  const [inputMode, setInputMode]       = useState('mic');
  const [userAudioUrl, setUserAudioUrl] = useState(null);
  const [recitOpen, setRecitOpen]       = useState(false);
  const [histOpen, setHistOpen]         = useState(false);

  const shouldRef      = useRef(false);
  const isStartingRef  = useRef(false);
  const recInstanceRef = useRef(null);
  const audioRecRef    = useRef(null);
  const restartTimerRef= useRef(null);
  const contFailsRef   = useRef(0);
  const finalTextRef   = useRef("");

  const refText = ayat.text || "";

  useEffect(() => () => {
    clearTimeout(restartTimerRef.current);
    if (userAudioUrl) URL.revokeObjectURL(userAudioUrl);
    audioRecRef.current?.release();
  }, [userAudioUrl]);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
  };

  const handleTranscript = useCallback((text) => {
    if (!text?.trim()) return;
    finalTextRef.current = (finalTextRef.current + " " + text).trim();
    setTranscript(finalTextRef.current);
    const res = compareRecitation(refText, finalTextRef.current);
    const r = { ...res, source: 'mic' };
    setRecResult(r);
    saveScore?.({ score: r.score, source: 'mic', date: new Date().toISOString() });
  }, [refText, saveScore]);

  useEffect(() => {
    window.RecitApp = window.RecitApp || {};
    window.RecitApp.onSpeechResult = (text) => {
      handleTranscript(text);
      if (shouldRef.current) {
        try { window.Android?.startSpeechRecognition('ar-SA'); } catch {}
      } else {
        setRecording(false);
      }
    };
    window.RecitApp.onSpeechError = () => {
      if (shouldRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          try { window.Android?.startSpeechRecognition('ar-SA'); } catch {}
        }, 700);
      } else {
        setRecording(false);
      }
    };
    return () => {
      clearTimeout(restartTimerRef.current);
      if (window.RecitApp) { window.RecitApp.onSpeechResult = null; window.RecitApp.onSpeechError = null; }
    };
  }, [handleTranscript]);

  const spawnRecognition = useCallback((useContinuous) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !shouldRef.current || isStartingRef.current) return;

    if (recInstanceRef.current) {
      try {
        recInstanceRef.current.onend    = null;
        recInstanceRef.current.onerror  = null;
        recInstanceRef.current.onresult = null;
        recInstanceRef.current.abort();
      } catch {}
      recInstanceRef.current = null;
    }

    isStartingRef.current = true;
    const rec = new SR();
    rec.lang            = 'ar-SA';
    rec.continuous      = useContinuous;
    rec.interimResults  = false;
    rec.maxAlternatives = 1;
    recInstanceRef.current = rec;

    rec.onstart = () => {
      isStartingRef.current = false;
      if (useContinuous) contFailsRef.current = 0;
      setRecording(true);
    };

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handleTranscript(e.results[i][0].transcript.trim());
      }
    };

    rec.onerror = (e) => {
      isStartingRef.current = false;
      clearRestartTimer();

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        shouldRef.current = false;
        setRecording(false);
        alert("Microphone refusé — vérifiez les permissions.");
        return;
      }

      if (e.error === 'aborted') {
        if (!shouldRef.current) { setRecording(false); return; }
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 400);
        return;
      }

      if (e.error === 'audio-capture') {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 1200);
        return;
      }

      if (e.error === 'network') {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 2500);
        return;
      }

      if (shouldRef.current) {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 350);
      }
    };

    rec.onend = () => {
      isStartingRef.current = false;

      if (!shouldRef.current) {
        setRecording(false);
        return;
      }

      if (useContinuous) {
        contFailsRef.current += 1;
        clearRestartTimer();
        if (contFailsRef.current >= 2) {
          restartTimerRef.current = setTimeout(() => spawnRecognition(false), 300);
        } else {
          restartTimerRef.current = setTimeout(() => spawnRecognition(true), 300);
        }
      } else {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => spawnRecognition(false), 200);
      }
    };

    try {
      rec.start();
    } catch {
      isStartingRef.current = false;
      restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 600);
    }
  }, [handleTranscript]);

  const toggleMic = useCallback(() => {
    if (shouldRef.current) {
      shouldRef.current = false;
      clearRestartTimer();
      isStartingRef.current = false;

      if (recInstanceRef.current) {
        try {
          recInstanceRef.current.onend    = null;
          recInstanceRef.current.onerror  = null;
          recInstanceRef.current.abort();
        } catch {}
        recInstanceRef.current = null;
      }
      try { window.Android?.stopSpeechRecognition(); } catch {}

      if (audioRecRef.current) {
        audioRecRef.current.stop().then(url => {
          audioRecRef.current = null;
          if (url) setUserAudioUrl(url);
        }).catch(() => { audioRecRef.current = null; });
      }

      setRecording(false);
    } else {
      shouldRef.current = true;
      contFailsRef.current = 0;
      finalTextRef.current = "";
      setTranscript("");
      setRecResult(null);
      if (userAudioUrl) { URL.revokeObjectURL(userAudioUrl); setUserAudioUrl(null); }

      if (!IS_ANDROID) {
        const arec = createAudioRecorder();
        audioRecRef.current = arec;
        arec.start().catch(() => {
          audioRecRef.current = null;
        });
      }

      if (window.Android && typeof window.Android.startSpeechRecognition === 'function') {
        setRecording(true);
        try {
          window.Android.startSpeechRecognition('ar-SA');
        } catch {
          spawnRecognition(false);
        }
      } else if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        spawnRecognition(IS_ANDROID ? false : true);
      } else {
        shouldRef.current = false;
        alert("Reconnaissance vocale non supportée dans ce navigateur.");
      }
    }
  }, [spawnRecognition, userAudioUrl]);

  const checkTyped = () => {
    if (!typedText.trim()) return;
    const res = compareRecitation(refText, typedText.trim());
    const r = { ...res, source: 'text' };
    setRecResult(r);
    saveScore?.({ score: r.score, source: 'text', date: new Date().toISOString() });
  };

  const reset = () => {
    if (shouldRef.current) {
      shouldRef.current = false;
      clearRestartTimer();
      isStartingRef.current = false;
      if (recInstanceRef.current) {
        try { recInstanceRef.current.onend = null; recInstanceRef.current.onerror = null; recInstanceRef.current.abort(); } catch {}
        recInstanceRef.current = null;
      }
      try { window.Android?.stopSpeechRecognition(); } catch {}
      audioRecRef.current?.stop().catch(() => {});
      audioRecRef.current = null;
      setRecording(false);
    }
    finalTextRef.current = "";
    if (userAudioUrl) { URL.revokeObjectURL(userAudioUrl); setUserAudioUrl(null); }
    setTypedText(""); setTranscript(""); setRecResult(null);
  };

  const scoreClass = !recResult ? "" : recResult.score === 100 ? "perfect" : recResult.score >= 70 ? "good" : "bad";
  const bestScore = attempts?.length > 0 ? Math.max(...attempts.map(a => a.score)) : null;

  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginTop:8 }}>
      <button onClick={() => setRecitOpen(v => !v)} style={{
        width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"8px 12px", background:"var(--surface2)", border:"none", cursor:"pointer",
        fontFamily:"'Cinzel',serif",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>🎙 CORRECTION DE RÉCITATION</span>
          {bestScore !== null && (
            <span style={{ fontSize:8, padding:"2px 8px", borderRadius:10,
              background: bestScore===100?"rgba(76,175,129,.15)":bestScore>=70?"rgba(201,168,76,.1)":"rgba(224,90,90,.1)",
              color: bestScore===100?"var(--green)":bestScore>=70?"var(--gold2)":"var(--red)",
              border:"1px solid "+(bestScore===100?"var(--green)":bestScore>=70?"var(--gold)":"var(--red)") }}>
              {bestScore}%
            </span>
          )}
        </div>
        <span style={{ fontSize:10, color:"var(--text3)", transition:"transform .2s",
          display:"inline-block", transform: recitOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>

      {recitOpen && <div className="recit-section">
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:4 }}>
        {recResult && (
          <button className="btn-small" onClick={reset} style={{fontSize:9,letterSpacing:1}}>↺ RÉINITIALISER</button>
        )}
      </div>

      <div className="recit-tabs">
        <button className={`recit-tab${inputMode==='mic'?' active':''}`} onClick={()=>setInputMode('mic')}>🎤 VOIX</button>
        <button className={`recit-tab${inputMode==='text'?' active':''}`} onClick={()=>setInputMode('text')}>✏️ TEXTE</button>
      </div>

      {inputMode === 'mic' && (
        <div>
          <div className={`recit-mic-zone${recording?' active':''}`}>
            <div className={`recit-mic-circle${recording?' recording':''}`} onClick={toggleMic}
              role="button" aria-label={recording?'Arrêter':'Commencer'}>
              {recording ? '⏹' : '🎤'}
            </div>
            <div className={`recit-mic-label${recording?' recording':''}`}>
              {recording ? 'ÉCOUTE EN COURS…' : 'APPUYER POUR RÉCITER'}
            </div>
            <div className={`recit-live-box${transcript?' has-text':''}`} style={{width:'100%'}}>
              {transcript
                ? transcript
                : <div className="recit-live-placeholder">Le texte reconnu apparaîtra ici</div>}
            </div>
          </div>
          {userAudioUrl && !recording && (
            <div style={{marginTop:8,padding:'8px 12px',background:'rgba(62,184,160,.06)',border:'1px solid rgba(62,184,160,.3)',borderRadius:8,display:'flex',flexDirection:'column',gap:6}}>
              <div style={{fontSize:9,letterSpacing:1.5,color:'var(--teal2)',fontFamily:"'Cinzel',serif"}}>🎧 RÉÉCOUTER MA RÉCITATION</div>
              <audio controls src={userAudioUrl} style={{width:'100%',height:36}} />
            </div>
          )}
        </div>
      )}

      {inputMode === 'text' && (
        <div>
          <textarea
            className="recit-textarea" spellCheck={false}
            onFocus={e => { if (arabicActiveInput) arabicActiveInput.current = e.target; }}
            rows={3}
            placeholder="اكتب الآية هنا…"
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            autoComplete="off"
          />
          <div className="recit-actions">
            <button className="btn-primary" onClick={checkTyped} disabled={!typedText.trim()}>VÉRIFIER</button>
            {typedText && <button className="btn-small" onClick={()=>setTypedText('')}>EFFACER</button>}
          </div>
        </div>
      )}

      {recResult && (
        <div style={{marginTop:16}}>
          <div className="recit-score-ring">
            <div className="recit-score-arc">
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="6"/>
                <circle cx="40" cy="40" r="34" fill="none"
                  stroke={recResult.score===100?'var(--green2)':recResult.score>=70?'var(--gold2)':'var(--red)'}
                  strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${2*Math.PI*34}`}
                  strokeDashoffset={`${2*Math.PI*34*(1-recResult.score/100)}`}
                  style={{transition:'stroke-dashoffset .6s ease'}}
                />
              </svg>
              <div className={`recit-score-arc-num ${scoreClass}`}>{recResult.score}%</div>
            </div>
            <div className={`recit-score-label ${scoreClass}`}>
              {recResult.score===100?'✓ PARFAIT':recResult.score>=70?'~ BON':'✗ À REVOIR'}
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {recResult.wordResults.filter(wr=>wr.op!=='ins').map((wr, wi) => {
              const wordOk = wr.wordOk;
              const isDel  = wr.op==='del';
              const borderCol = isDel?'var(--red)':wordOk?'rgba(76,175,129,.3)':'rgba(224,90,90,.3)';
              const bgCol     = isDel?'rgba(224,90,90,.05)':wordOk?'rgba(76,175,129,.05)':'rgba(224,90,90,.05)';

              const DIAC_RE = /[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g;
              const normAlifWaw = s => normalizeArabic(s || '');

              const refNorm5 = normAlifWaw(wr.ref  || '');
              const userRaw5 = normAlifWaw(wr.user || '');

              const strip = s => s.replace(DIAC_RE,'');
              const refStripped  = strip(refNorm5);
              const userStripped = strip(userRaw5);

              let correctedUser = userStripped;
              if (refStripped.endsWith('ة') && correctedUser.endsWith('ه')) {
                correctedUser = correctedUser.slice(0,-1) + 'ة';
              }

              const userN = normalizeArabic(correctedUser);

              let displayParts = [];
              if (!isDel && wr.chars && wr.chars.length > 0) {
                const userChars = [...userN].filter(c => !/[\u064B-\u065F\u0670]/.test(c));
                let userIdx = 0;
                for (const c of wr.chars) {
                  if (c.status === 'silent') continue;
                  const userCh = userChars[userIdx] ?? null;
                  if (c.status === 'ok' || c.status === 'near') {
                    if (userCh) displayParts.push({ ch: userCh, color: c.status === 'ok' ? 'var(--green2)' : 'var(--gold2)' });
                    userIdx++;
                  } else if (c.status === 'miss') {
                    displayParts.push({ ch: '–', color: 'var(--teal2)', added: true });
                  } else {
                    if (userCh) displayParts.push({ ch: userCh, color: 'var(--red)', under: true });
                    userIdx++;
                  }
                }
              }

              return (
                <div key={wi} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',
                  background:bgCol,border:`1px solid ${borderCol}`,borderRadius:'var(--radius-sm)'}}>
                  <div style={{flex:1,fontFamily:"'Amiri Quran',serif",fontSize:20,direction:'rtl',textAlign:'right',lineHeight:1.7}}>
                    {wr.chars.map((c,ci)=>(
                      <span key={ci} className={
                        c.status==='ok'?'recit-char-ok':
                        c.status==='near'?'recit-char-near':
                        c.status==='miss'?'recit-char-miss':
                        c.status==='silent'?'recit-char-silent':
                        'recit-char-err'
                      }>{normAlifWaw(c.char).replace(DIAC_RE,'')}{c.waslVowel?(c.waslVowel==='fatha'?'َ':c.waslVowel==='damma'?'ُ':'ِ'):''}</span>
                    ))}
                  </div>
                  <div style={{width:1,alignSelf:'stretch',background:'var(--border2)',flexShrink:0}}/>
                  <div style={{flex:1,fontFamily:"'Amiri Quran',serif",fontSize:18,direction:'rtl',textAlign:'right',lineHeight:1.7}}>
                    {isDel
                      ? <span style={{fontSize:10,letterSpacing:1,color:'var(--red)',fontFamily:"'Cinzel',serif"}}>MANQUANT</span>
                      : displayParts.length > 0
                        ? displayParts.map((p,pi)=>(
                            <span key={pi} style={{
                              color:p.color,
                              textDecoration:p.added?'underline dotted':p.under?'underline wavy':'none',
                              textDecorationColor:p.color,
                              fontStyle:p.added?'italic':'normal',
                            }}>{p.ch}</span>
                          ))
                        : <span style={{color:'var(--text3)',fontSize:10,fontFamily:"'Cinzel',serif"}}>—</span>
                    }
                  </div>
                  <div style={{fontSize:13,flexShrink:0,width:18,textAlign:'center',color:isDel?'var(--red)':wordOk?'var(--green2)':'var(--gold2)'}}>
                    {isDel?'✗':wordOk?'✓':'~'}
                  </div>
                </div>
              );
            })}
          </div>

          {recResult.insertions?.length>0&&(
            <div style={{marginTop:8,padding:'6px 10px',background:'rgba(62,184,160,.06)',
              border:'1px solid var(--teal)',borderRadius:6,fontSize:11}}>
              <span style={{color:'var(--teal)',letterSpacing:1,fontSize:9}}>MOTS AJOUTÉS (pénalité ×3) · </span>
              {recResult.insertions.map((a,i)=>(
                <span key={i} style={{fontFamily:"'Amiri Quran',serif",fontSize:16,
                  color:'var(--teal)',marginLeft:8,direction:'rtl'}}>{a.user}</span>
              ))}
            </div>
          )}

          <div className="recit-debug-toggle">
            <button className="btn-small" onClick={()=>setShowDebug(v=>!v)}
              style={{fontSize:9,letterSpacing:1,width:'100%'}}>
              {showDebug?'▲ MASQUER DEBUG':'▼ TABLEAU DE DÉBOGAGE'}
            </button>
          </div>

          {showDebug&&(
            <div style={{marginTop:8,overflowX:'auto'}}>
              <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)',marginBottom:6,fontFamily:"'Cinzel',serif"}}>
                DÉTAIL MOT PAR MOT · LETTRE PAR LETTRE
              </div>
              <table className="recit-debug-table">
                <thead>
                  <tr>{['#','OP','RÉFÉRENCE','UTILISATEUR','NORM REF','NORM USER','LETTRES'].map(h=>(
                    <th key={h}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {recResult.wordResults.map((wr,wi)=>(
                    <tr key={wi} style={{background:wr.wordOk?'rgba(76,175,129,.04)':'rgba(224,90,90,.04)'}}>
                      <td style={{color:'var(--text3)'}}>{wi}</td>
                      <td style={{fontWeight:700,color:
                        wr.op==='match'?'var(--green2)':wr.op==='del'?'var(--red)':
                        wr.op==='ins'?'var(--teal)':'var(--gold2)'}}>{wr.op||'—'}</td>
                      <td style={{fontFamily:"'Amiri Quran',serif",fontSize:15,direction:'rtl'}}>{wr.ref||'—'}</td>
                      <td style={{fontFamily:"'Amiri Quran',serif",fontSize:15,direction:'rtl',color:wr.user?'var(--text)':'var(--text3)'}}>
                        {wr.user||<em style={{fontSize:9}}>manquant</em>}</td>
                      <td style={{color:'var(--gold2)',direction:'rtl',fontSize:13}}>{normalizeArabic(wr.ref)}</td>
                      <td style={{color:'var(--teal)',direction:'rtl',fontSize:13}}>{normalizeArabic(wr.user)||<em style={{fontSize:9,color:'var(--text3)'}}>vide</em>}</td>
                      <td>
                        <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                          {wr.chars.map((c,ci)=>(
                            <span key={ci} style={{
                              display:'inline-flex',flexDirection:'column',alignItems:'center',
                              gap:1,padding:'2px 4px',borderRadius:3,minWidth:24,
                              background:
                                c.status==='ok'    ?'rgba(76,175,129,.12)':
                                c.status==='near'  ?'rgba(232,160,32,.12)':
                                c.status==='silent'?'rgba(212,175,55,.1)':
                                c.status==='miss'  ?'rgba(100,100,100,.1)':
                                                    'rgba(224,90,90,.12)',
                              border:'1px solid '+(
                                c.status==='ok'    ?'var(--green2)':
                                c.status==='near'  ?'#e8a020':
                                c.status==='silent'?'var(--gold)':
                                c.status==='miss'  ?'var(--border2)':
                                                    'var(--red)')
                            }}>
                              <span style={{fontFamily:"'Amiri Quran',serif",fontSize:15,direction:'rtl',color:
                                c.status==='ok'    ?'var(--green2)':
                                c.status==='near'  ?'#e8a020':
                                c.status==='silent'?'var(--gold)':
                                c.status==='miss'  ?'var(--text3)':
                                                    'var(--red)'
                              }}>{c.char}</span>
                              <span style={{fontSize:7,color:'var(--text3)',whiteSpace:'nowrap'}}>
                                {c.status==='silent'?'muette':c.status}
                                {c.status==='near'?` (${Math.round((1-(c.cost??0.4))*100)}%)`:''}
                                {c.waslVowel?` [${c.waslVowel}]`:''}
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {attempts?.length > 0 && (
        <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginTop:8 }}>
          <button onClick={() => setHistOpen(v => !v)} style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"7px 12px", background:"var(--surface2)", border:"none", cursor:"pointer",
            fontFamily:"'Cinzel',serif",
          }}>
            <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>HISTORIQUE · {attempts.length}</span>
            <span style={{ fontSize:10, color:"var(--text3)", transition:"transform .2s",
              display:"inline-block", transform: histOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
          </button>
          {histOpen && (
            <div style={{ padding:"8px", display:"flex", flexDirection:"column", gap:4 }}>
              {[...attempts].reverse().map((a,i)=>{
                const c=a.score===100?'var(--green2)':a.score>=70?'var(--gold2)':a.score>=40?'#ff9f43':'var(--red)';
                return(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'var(--surface3)',borderRadius:'var(--radius-sm)',border:`1px solid ${c}22`}}>
                    <div style={{width:34,height:34,borderRadius:'50%',border:`1px solid ${c}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:c,fontFamily:"'Cinzel',serif",flexShrink:0}}>{a.score}%</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:8,color:'var(--text3)',marginBottom:1}}>{a.source==='mic'?'🎤 VOIX':'✏ TEXTE'}</div>
                      <div style={{fontSize:8,color:'var(--text3)'}}>{new Date(a.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                    </div>
                    <div style={{fontSize:18,flexShrink:0}}>{a.score===100?'✓':a.score>=70?'~':'✗'}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </div>}
    </div>
  );
}

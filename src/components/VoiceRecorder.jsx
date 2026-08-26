import React, { useState, useEffect, useRef } from "react";
import { createAudioRecorder, IS_ANDROID } from "../services/audioRecorder";

const DB_NAME = "QuranRecordings";
const DB_VER  = 1;
const STORE   = "recordings";

export function openRecDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function saveRecording(rec) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function loadRecordings(ayatKey) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res((req.result || []).filter(r => r.ayatKey === ayatKey));
    req.onerror   = () => rej(req.error);
  });
}

export async function deleteRecording(id) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export function MiniAudioPlayer({ src, color = "var(--gold2)", label = null }) {
  const ref  = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur,     setCur]     = useState(0);
  const [dur,     setDur]     = useState(0);
  const rafRef = useRef(null);

  const tick = () => {
    if (ref.current) setCur(ref.current.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  };

  const toggle = () => {
    if (!ref.current) return;
    if (ref.current.paused) { ref.current.play(); setPlaying(true); rafRef.current = requestAnimationFrame(tick); }
    else { ref.current.pause(); setPlaying(false); cancelAnimationFrame(rafRef.current); }
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
  const pct = dur > 0 ? Math.min(1, cur / dur) : 0;

  const seek = (e) => {
    if (!ref.current || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    ref.current.currentTime = Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
  };

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
      background:"var(--surface3)", borderRadius:8, border:"1px solid var(--border2)" }}>
      <audio ref={ref} src={src}
        onLoadedMetadata={() => setDur(ref.current?.duration || 0)}
        onEnded={() => { setPlaying(false); cancelAnimationFrame(rafRef.current); setCur(0); }}
        style={{ display:"none" }} />
      <button onClick={toggle} style={{
        width:30, height:30, borderRadius:"50%", border:`1px solid ${color}`,
        background: playing ? `${color}22` : "transparent",
        color, fontSize:11, cursor:"pointer", display:"flex",
        alignItems:"center", justifyContent:"center", flexShrink:0,
      }}>{playing ? "⏸" : "▶"}</button>
      {label && <span style={{ fontSize:8, letterSpacing:1, color:"var(--text3)", flexShrink:0 }}>{label}</span>}
      <div onClick={seek} style={{ flex:1, height:4, background:"var(--surface2)",
        borderRadius:2, cursor:"pointer", overflow:"hidden", position:"relative" }}>
        <div style={{ position:"absolute", left:0, top:0, bottom:0,
          width:`${pct*100}%`, background:color, borderRadius:2, transition:"width .1s linear" }}/>
      </div>
      <span style={{ fontSize:8, color:"var(--text3)", flexShrink:0, fontFamily:"'Cinzel',serif" }}>
        {fmt(cur)}<span style={{color:"var(--border2)"}}>/</span>{fmt(dur)}
      </span>
    </div>
  );
}

export function ComparePlayer({ userSrc, refSrc }) {
  const userRef = useRef(null);
  const refRef  = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [userT,   setUserT]     = useState(0);
  const [refT,    setRefT]      = useState(0);
  const [userDur, setUserDur]   = useState(0);
  const [refDur,  setRefDur]    = useState(0);
  const rafRef  = useRef(null);

  const tick = () => {
    if (userRef.current) setUserT(userRef.current.currentTime);
    if (refRef.current)  setRefT(refRef.current.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  };

  const playBoth = () => {
    if (!userRef.current || !refRef.current) return;
    userRef.current.currentTime = 0;
    refRef.current.currentTime  = 0;
    userRef.current.play().catch(()=>{});
    refRef.current.play().catch(()=>{});
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pauseBoth = () => {
    userRef.current?.pause();
    refRef.current?.pause();
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const stopBoth = () => {
    pauseBoth();
    if (userRef.current) userRef.current.currentTime = 0;
    if (refRef.current)  refRef.current.currentTime  = 0;
    setUserT(0); setRefT(0);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const handleEnded = () => {
    if (userRef.current?.ended && refRef.current?.ended) {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    }
  };

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
  const progBar = (t, dur, color) => (
    <div style={{height:3,background:"var(--surface3)",borderRadius:2,overflow:"hidden",flex:1}}>
      <div style={{height:"100%",width:`${dur>0?Math.min(1,t/dur)*100:0}%`,background:color,borderRadius:2,transition:"width .1s linear"}}/>
    </div>
  );

  return (
    <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:10,background:"var(--surface2)",borderRadius:8,border:"1px solid var(--border)"}}>
      <audio ref={userRef} src={userSrc} onLoadedMetadata={()=>setUserDur(userRef.current?.duration||0)} onEnded={handleEnded} />
      <audio ref={refRef}  src={refSrc}  onLoadedMetadata={()=>setRefDur(refRef.current?.duration||0)}   onEnded={handleEnded} />

      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={playing ? pauseBoth : playBoth} style={{
          width:36,height:36,borderRadius:"50%",border:"none",cursor:"pointer",
          background:playing?"rgba(255,126,179,.15)":"rgba(62,184,160,.15)",
          color:playing?"#ff7eb3":"var(--teal2)",fontSize:14,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}>{playing ? "⏸" : "▶"}</button>
        <button onClick={stopBoth} style={{
          width:28,height:28,borderRadius:"50%",border:"1px solid var(--border2)",cursor:"pointer",
          background:"transparent",color:"var(--text3)",fontSize:11,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}>⏹</button>
        <span style={{fontSize:8,letterSpacing:1.5,color:"var(--gold2)",fontFamily:"'Cinzel',serif"}}>ÉCOUTE SIMULTANÉE</span>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:8,letterSpacing:1,color:"var(--teal2)",flexShrink:0}}>🎙 MOI</span>
          {progBar(userT, userDur, "var(--teal)")}
          <span style={{fontSize:7,color:"var(--text3)",flexShrink:0}}>{fmt(userT)}/{fmt(userDur)}</span>
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:8,letterSpacing:1,color:"var(--gold2)",flexShrink:0}}>📖 REF</span>
          {progBar(refT, refDur, "var(--gold)")}
          <span style={{fontSize:7,color:"var(--text3)",flexShrink:0}}>{fmt(refT)}/{fmt(refDur)}</span>
        </div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <MiniAudioPlayer src={userSrc} color="var(--teal2)" label="🎙 MOI" />
        <MiniAudioPlayer src={refSrc}  color="var(--gold2)" label="📖 REF" />
      </div>
    </div>
  );
}

export default function VoiceRecorder({ ayat, surahNum, originalAudioUrl, localAudioRef }) {
  const ayatKey = `${surahNum}:${ayat.numberInSurah}`;
  const [recordings, setRecordings]   = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed]         = useState(0);
  const [expandedId, setExpandedId]   = useState(null);
  const [compareId, setCompareId]     = useState(null);
  const [micGain, setMicGain]         = useState(4.0);
  const audioRecRef   = useRef(null);
  const timerRef      = useRef(null);
  const startTimeRef  = useRef(0);

  useEffect(() => {
    loadRecordings(ayatKey).then(setRecordings).catch(() => {});
  }, [ayatKey]);

  useEffect(() => () => { audioRecRef.current?.release(); }, []);

  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const startRec = async () => {
    try {
      if (IS_ANDROID) { try { localAudioRef?.current?.pause(); } catch {} }
      const arec = createAudioRecorder();
      audioRecRef.current = arec;
      await arec.start(micGain);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 200);
    } catch (err) {
      console.error("[VoiceRecorder] startRec:", err);
      alert("Impossible d'accéder au microphone : " + (err.message || err));
    }
  };

  const stopRec = async () => {
    clearInterval(timerRef.current);
    setIsRecording(false);
    try {
      const url = await audioRecRef.current?.stop();
      audioRecRef.current = null;
      if (!url) return;

      let blob;
      try { const r = await fetch(url); blob = await r.blob(); }
      catch { return; }
      if (!blob || blob.size === 0) return;

      const duration = Date.now() - startTimeRef.current;
      const id = Date.now();
      const rec = { id, ayatKey, date: new Date().toISOString(), duration, mimeType: blob.type, blob };
      await saveRecording(rec);
      const updated = await loadRecordings(ayatKey);
      setRecordings(updated);
      setExpandedId(id);
    } catch (err) {
      console.error("[VoiceRecorder] stopRec:", err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Supprimer cet enregistrement ?")) return;
    await deleteRecording(id);
    setRecordings(r => r.filter(x => x.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (compareId  === id) setCompareId(null);
  };

  const getBlobUrl = (rec) => {
    if (!rec._blobUrl) rec._blobUrl = URL.createObjectURL(rec.blob);
    return rec._blobUrl;
  };

  return (
    <div className="rec-wrap">
      {!isRecording && (
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"4px 0"}}>
          <span style={{fontSize:8,letterSpacing:1,color:"var(--text3)",fontFamily:"'Cinzel',serif",flexShrink:0}}>🎤 GAIN</span>
          <input type="range" min="1" max="8" step="0.5" value={micGain}
            onChange={e=>setMicGain(Number(e.target.value))}
            style={{flex:1,accentColor:"var(--teal)"}} />
          <span style={{fontSize:9,color:"var(--teal2)",fontFamily:"'Cinzel',serif",width:28,textAlign:"right"}}>{micGain}×</span>
        </div>
      )}

      <button
        className={`rec-btn ${isRecording ? "recording" : "idle"}`}
        onClick={isRecording ? stopRec : startRec}
      >
        <div className="rec-dot" />
        {isRecording
          ? <><span className="rec-timer">{fmtTime(elapsed)}</span><span>ARRÊTER L'ENREGISTREMENT</span></>
          : "🎙 ENREGISTRER MA RÉCITATION"
        }
      </button>

      {recordings.length === 0 && !isRecording && (
        <div style={{ textAlign:"center", fontSize:9, letterSpacing:1.5, color:"var(--text3)", padding:"12px 0" }}>
          Aucun enregistrement — appuyez sur le bouton pour commencer
        </div>
      )}

      {recordings.length > 0 && (
        <div className="rec-list">
          <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>
            {recordings.length} ENREGISTREMENT{recordings.length > 1 ? "S" : ""}
          </div>
          {[...recordings].reverse().map((rec) => {
            const isExpanded = expandedId === rec.id;
            const isCompare  = compareId  === rec.id;
            return (
              <div key={rec.id} className="rec-item">
                <div className="rec-item-header">
                  <div className="rec-item-icon">🎙</div>
                  <div className="rec-item-info">
                    <div className="rec-item-date">
                      {new Date(rec.date).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })}
                    </div>
                    <div className="rec-item-dur">{fmtTime(rec.duration)}</div>
                  </div>
                  <div className="rec-item-actions">
                    <button className="btn-small"
                      onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                      style={isExpanded ? { borderColor:"var(--teal)", color:"var(--teal2)" } : {}}>
                      {isExpanded ? "▲" : "▶ ÉCOUTER"}
                    </button>
                    <button className="btn-small"
                      onClick={() => setCompareId(isCompare ? null : rec.id)}
                      style={isCompare ? { borderColor:"var(--gold)", color:"var(--gold2)" } : {}}>
                      ⇌ COMPARER
                    </button>
                    <button className="btn-small"
                      onClick={() => handleDelete(rec.id)}
                      style={{ borderColor:"var(--red)", color:"var(--red)" }}>✕</button>
                  </div>
                </div>

                {isExpanded && <MiniAudioPlayer src={getBlobUrl(rec)} color="var(--teal2)" />}

                {isCompare && (
                  <ComparePlayer userSrc={getBlobUrl(rec)} refSrc={originalAudioUrl} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

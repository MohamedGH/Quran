import React, { useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { sel } from "../store";

export default function RappelWidget({ onClose }) {
  const surahs = useSelector(sel.surahs);
  const [targetSurah, setTargetSurah] = useState("1");
  const [targetAyat,  setTargetAyat]  = useState("1");
  const [intervalMin, setIntervalMin] = useState("5");
  const [running,     setRecording]  = useState(false); // "running" state
  const [isActive,    setIsActive]   = useState(false);
  const [nextInSec,   setNextInSec]  = useState(null);
  const [logs,        setLogs]       = useState([]);

  const timerRef = useRef(null);
  const cdRef    = useRef(null);
  const audioRef = useRef(null);

  const addLog = msg => setLogs(p => [{ time: new Date().toLocaleTimeString('fr-FR'), msg }, ...p.slice(0, 19)]);

  const playTarget = () => {
    const sn = parseInt(targetSurah, 10);
    const an = parseInt(targetAyat, 10);
    if (!sn || !an) return;
    const padS = String(sn).padStart(3, "0");
    const padA = String(an).padStart(3, "0");
    const url  = `https://everyayah.com/data/Alafasy_128kbps/${padS}${padA}.mp3`;
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play().then(() => {
        addLog(`▶ Lecture Sourate ${sn}, Ayat ${an}`);
      }).catch(e => addLog(`Erreur lecture: ${e.message}`));
    }
  };

  const startRappel = () => {
    const mins = parseInt(intervalMin, 10);
    if (!mins || mins < 1) return;
    setIsActive(true);
    addLog(`Rappel démarré : toutes les ${mins} min (Sourate ${targetSurah}, Ayat ${targetAyat})`);
    playTarget();

    let sec = mins * 60;
    setNextInSec(sec);

    clearInterval(cdRef.current);
    cdRef.current = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        sec = mins * 60;
        playTarget();
      }
      setNextInSec(sec);
    }, 1000);
  };

  const stopRappel = () => {
    clearInterval(cdRef.current);
    setIsActive(false);
    setNextInSec(null);
    if (audioRef.current) audioRef.current.pause();
    addLog("Rappel arrêté");
  };

  useEffect(() => () => { clearInterval(cdRef.current); }, []);

  const fmtCd = s => s == null ? "" : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  return (
    <div style={{
      position:"fixed", top: "calc(var(--header-h) + 12px)", right: 16, zIndex: 400,
      width: 310, background: "var(--surface2)", border: "1px solid var(--border2)",
      borderRadius: 14, boxShadow: "0 12px 36px rgba(0,0,0,.6)", padding: 16,
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <audio ref={audioRef} style={{ display:"none" }} />
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:10, letterSpacing:2, color:"var(--gold2)", fontFamily:"'Cinzel',serif" }}>🔔 RAPPEL VOCAL</span>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:16, cursor:"pointer" }}>✕</button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1, marginBottom:3 }}>SOURATE</div>
            <select value={targetSurah} onChange={e => setTargetSurah(e.target.value)} disabled={isActive}
              style={{ width:"100%", background:"var(--surface3)", border:"1px solid var(--border2)", color:"var(--text)", borderRadius:6, padding:"5px 8px", fontSize:11 }}>
              {(surahs || []).map(s => (
                <option key={s.number} value={s.number}>{s.number}. {s.englishName}</option>
              ))}
            </select>
          </div>
          <div style={{ width:70 }}>
            <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1, marginBottom:3 }}>AYAT</div>
            <input type="number" min="1" value={targetAyat} onChange={e => setTargetAyat(e.target.value)} disabled={isActive}
              style={{ width:"100%", background:"var(--surface3)", border:"1px solid var(--border2)", color:"var(--text)", borderRadius:6, padding:"5px 8px", fontSize:11, textAlign:"center" }} />
          </div>
        </div>

        <div>
          <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1, marginBottom:3 }}>INTERVALLE (MINUTES)</div>
          <input type="number" min="1" max="1440" value={intervalMin} onChange={e => setIntervalMin(e.target.value)} disabled={isActive}
            style={{ width:"100%", background:"var(--surface3)", border:"1px solid var(--border2)", color:"var(--text)", borderRadius:6, padding:"5px 8px", fontSize:11 }} />
        </div>
      </div>

      {isActive && nextInSec !== null && (
        <div style={{ padding:"8px 12px", background:"rgba(201,168,76,.08)", border:"1px solid var(--gold)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:8, letterSpacing:1, color:"var(--gold2)", fontFamily:"'Cinzel',serif" }}>PROCHAIN RAPPEL</span>
          <span style={{ fontSize:14, fontFamily:"monospace", color:"var(--gold2)", fontWeight:"bold" }}>{fmtCd(nextInSec)}</span>
        </div>
      )}

      <div style={{ display:"flex", gap:8 }}>
        {!isActive ? (
          <button onClick={startRappel} className="btn-primary" style={{ flex:1 }}>► DÉMARRER</button>
        ) : (
          <button onClick={stopRappel} className="btn-small" style={{ flex:1, borderColor:"var(--red)", color:"var(--red)" }}>⏹ ARRÊTER</button>
        )}
        <button onClick={playTarget} className="btn-small" title="Tester la lecture">▶ TEST</button>
      </div>

      {logs.length > 0 && (
        <div style={{ borderTop:"1px solid var(--border)", paddingTop:8, maxHeight:100, overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
          {logs.map((l, i) => (
            <div key={i} style={{ fontSize:8, color:"var(--text3)", fontFamily:"monospace" }}>
              <span style={{ color:"var(--gold)" }}>[{l.time}]</span> {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

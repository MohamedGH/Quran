import React, { useState } from "react";
import { fixChars } from "../services/quranApi";

export default function EditorWords({ editTs, currentMs, setCharField, captureStart, captureEnd, onSave, onReset, isDiacritic, audioRef }) {
  const [openWords, setOpenWords] = useState({});
  const [playingChar, setPlayingChar] = useState(null);

  const toggle = wi => setOpenWords(p => ({ ...p, [wi]: !p[wi] }));

  const playChar = (wi, ci, c) => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (playingChar?.wi === wi && playingChar?.ci === ci) {
      audio.pause(); setPlayingChar(null); return;
    }
    const startSec = c.start / 1000;
    const endSec   = c.end   / 1000;
    if (startSec === endSec) return;
    audio.currentTime = startSec;
    audio.play().catch(() => {});
    setPlayingChar({ wi, ci });
    const check = () => {
      if (audio.currentTime >= endSec) {
        audio.pause(); setPlayingChar(null);
        audio.removeEventListener('timeupdate', check);
      }
    };
    audio.addEventListener('timeupdate', check);
    audio.addEventListener('ended', () => { setPlayingChar(null); audio.removeEventListener('timeupdate', check); }, { once: true });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--text3)", marginBottom: 8, fontFamily: "'Cinzel',serif" }}>
        CLIQUEZ ▶ POUR ÉCOUTER LA LETTRE · ⊙ POUR CAPTURER LA POSITION AUDIO
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
        {editTs.words.map((word, wi) => {
          const isOpen   = !!openWords[wi];
          const hasActive = word.chars?.some(c => currentMs >= c.start && currentMs <= c.end);
          return (
            <div key={wi} style={{ border: `1px solid ${hasActive ? "var(--gold)" : "var(--border)"}`, borderRadius: 6, transition: "border-color .15s" }}>
              <button onClick={() => toggle(wi)} style={{ width: "100%", background: hasActive ? "rgba(201,168,76,.08)" : "var(--surface3)", border: "none", padding: "6px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", position: "sticky", top: 0, zIndex: 2, borderBottom: isOpen ? "1px solid var(--border)" : "none" }}>
                <span style={{ fontFamily: "'Amiri Quran',serif", fontSize: 20, direction: "rtl", flex: 1, lineHeight: 1.6 }}>
                  {fixChars(word.chars || []).map((c, ci) => {
                    const active = currentMs >= c.start && currentMs <= c.end;
                    const done   = currentMs > c.end && currentMs > 0 && c.end > 0;
                    const isCharPlaying2 = playingChar?.wi === wi && playingChar?.ci === ci;
                    return (
                      <span key={ci} className={`char-span${isCharPlaying2 ? " char-active" : active ? " char-active" : done ? " char-done" : ""}`}>{c.char}</span>
                    );
                  })}
                </span>
                <span style={{ fontSize: 8, color: "var(--text3)", letterSpacing: 1, fontFamily: "'Cinzel',serif" }}>MOT {wi + 1} · {word.chars?.length ?? 0} LETTRES</span>
                <span style={{ fontSize: 10, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div style={{ padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
                  {(word.chars || []).map((c, ci) => {
                    const active       = currentMs >= c.start && currentMs <= c.end;
                    const isDiac       = isDiacritic(c.char);
                    const isDegenerate = !isDiac && c.start === c.end;
                    const isDisabled   = isDiac || isDegenerate;
                    const isCharPlaying = playingChar?.wi === wi && playingChar?.ci === ci;
                    return (
                      <div key={ci} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 4, background: active ? "rgba(201,168,76,.07)" : isCharPlaying ? "rgba(62,184,160,.07)" : "transparent", opacity: isDisabled ? 0.4 : 1 }}>
                        <button onClick={() => playChar(wi, ci, c)} disabled={isDegenerate || isDiac}
                          style={{ width: 22, height: 22, borderRadius: "50%", border: `1px solid ${isCharPlaying ? "var(--red)" : "var(--teal)"}`, background: "transparent", color: isCharPlaying ? "var(--red)" : "var(--teal)", cursor: isDegenerate || isDiac ? "default" : "pointer", fontSize: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {isCharPlaying ? "⏸" : "▶"}
                        </button>
                        <span style={{ fontFamily: "'Amiri Quran',serif", fontSize: 20, minWidth: 24, textAlign: "center", color: active ? "var(--gold2)" : isCharPlaying ? "var(--teal2)" : isDisabled ? "var(--text3)" : "var(--text2)" }}>{c.char}</span>
                        <span style={{ fontSize: 8, color: "var(--text3)", letterSpacing: 1, width: 30 }}>START</span>
                        <button onClick={() => captureStart(wi, ci)} disabled={isDiac} style={{ fontSize: 9, padding: "2px 5px", border: "1px solid var(--teal)", background: "transparent", color: isDiac ? "var(--text3)" : "var(--teal)", borderRadius: 3, cursor: isDiac ? "default" : "pointer" }}>⊙</button>
                        <input type="number" value={c.start} onChange={e => setCharField(wi, ci, 'start', e.target.value)} disabled={isDiac}
                          style={{ width: 62, fontSize: 10, padding: "2px 4px", background: "var(--surface3)", border: `1px solid ${isDegenerate ? "var(--red)" : "var(--border2)"}`, borderRadius: 3, color: "var(--text2)", fontFamily: "monospace", opacity: isDiac ? 0.5 : 1 }} />
                        <span style={{ fontSize: 8, color: "var(--text3)", letterSpacing: 1, width: 24 }}>END</span>
                        <button onClick={() => captureEnd(wi, ci)} disabled={isDiac} style={{ fontSize: 9, padding: "2px 5px", border: "1px solid var(--gold)", background: "transparent", color: isDiac ? "var(--text3)" : "var(--gold)", borderRadius: 3, cursor: isDiac ? "default" : "pointer" }}>⊙</button>
                        <input type="number" value={c.end} onChange={e => setCharField(wi, ci, 'end', e.target.value)} disabled={isDiac}
                          style={{ width: 62, fontSize: 10, padding: "2px 4px", background: "var(--surface3)", border: `1px solid ${isDegenerate ? "var(--red)" : "var(--border2)"}`, borderRadius: 3, color: "var(--text2)", fontFamily: "monospace", opacity: isDiac ? 0.5 : 1 }} />
                        {active && !isCharPlaying && <span style={{ fontSize: 8, color: "var(--gold2)" }}>●</span>}
                        {isDiac && <span style={{ fontSize: 7, color: "var(--text3)" }}>~</span>}
                        {isDegenerate && <span style={{ fontSize: 7, color: "var(--red)" }}>!</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn-primary" onClick={onSave}>💾 SAUVEGARDER + EXPORTER JSON</button>
        <button className="btn-small" onClick={onReset}>↺ RÉINITIALISER</button>
      </div>
    </div>
  );
}

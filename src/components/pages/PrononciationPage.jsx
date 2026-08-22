import React, { useState, useRef } from "react";
import { ARABIC_LETTERS, HARAKATS } from "../../utils/quranData";

export default function PrononciationPage() {
  const [selectedLetter, setSelectedLetter] = useState(ARABIC_LETTERS[0]);
  const [playing, setSelectedPlaying]       = useState(null);
  const audioRef = useRef(null);

  const playLetterAudio = (letterObj) => {
    setSelectedLetter(letterObj);
    setSelectedPlaying(letterObj.ar);
    setTimeout(() => setSelectedPlaying(null), 1200);
  };

  const playHarakatAudio = (h) => {
    setSelectedPlaying(`${selectedLetter.ar}_${h.symbol}`);
    setTimeout(() => setSelectedPlaying(null), 1000);
  };

  return (
    <div className="pronon-page page-anim">
      <audio ref={audioRef} style={{ display: "none" }} />

      <div className="pronon-two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div className="pronon-section-title">🔤 ALPHABET ARABE (28 LETTRES)</div>
            <div className="pronon-grid">
              {ARABIC_LETTERS.map(l => (
                <div
                  key={l.ar}
                  className={`pronon-card${selectedLetter.ar === l.ar ? " selected" : ""}${playing === l.ar ? " playing" : ""}`}
                  onClick={() => playLetterAudio(l)}
                >
                  <div className="pronon-letter">{l.ar}</div>
                  <div className="pronon-letter-name">{l.name}</div>
                  <div className="pronon-letter-trans">/{l.trans}/</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="pronon-section-title">✨ LES VOYELLES & SIGNES (HARAKAT)</div>
            <div className="pronon-harakat-row">
              {HARAKATS.map(h => (
                <div key={h.name} className="pronon-harakat-btn" onClick={() => playHarakatAudio(h)}>
                  <div className="pronon-harakat-arabic">{selectedLetter.ar}{h.symbol}</div>
                  <div className="pronon-harakat-name">{h.name}</div>
                  <div className="pronon-harakat-desc">/{selectedLetter.trans}{h.trans}/</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="pronon-detail-panel">
            <div className="pronon-detail-letter">{selectedLetter.ar}</div>
            <div className="pronon-detail-name">{selectedLetter.name.toUpperCase()}</div>
            <div style={{ textAlign: "center" }}>
              <span className="pronon-makhraj-tag">📍 {selectedLetter.makhraj}</span>
            </div>

            <div className="pronon-tip-box">
              {selectedLetter.desc}
            </div>

            <div>
              <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--text3)", marginBottom: 8, fontFamily: "'Cinzel',serif", textAlign: "center" }}>
                FORMES (ISOLÉE, DÉBUT, MILIEU, FIN)
              </div>
              <div className="pronon-detail-forms">
                {selectedLetter.forms.map((f, i) => (
                  <div key={i} className="pronon-form-item">
                    <div className="pronon-form-arabic">{f}</div>
                    <div className="pronon-form-label">
                      {i === 0 ? "Isolée" : i === 1 ? "Début" : i === 2 ? "Milieu" : "Fin"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--text3)", marginBottom: 8, fontFamily: "'Cinzel',serif", textAlign: "center" }}>
                COMBINAISONS AVEC VOYELLES
              </div>
              <div className="pronon-detail-harakats">
                {HARAKATS.map(h => (
                  <div
                    key={h.name}
                    className={`pronon-detail-hbtn${playing === `${selectedLetter.ar}_${h.symbol}` ? " playing" : ""}`}
                    onClick={() => playHarakatAudio(h)}
                  >
                    <div className="pronon-detail-hbtn-arabic">{selectedLetter.ar}{h.symbol}</div>
                    <div className="pronon-detail-hbtn-name">{h.name}</div>
                    <div className="pronon-detail-hbtn-desc">/{selectedLetter.trans}{h.trans}/</div>
                  </div>
                ))}
              </div>
            </div>

            <button className="pronon-play-btn" onClick={() => playLetterAudio(selectedLetter)}>
              ▶ ÉCOUTER LA PRONONCIATION
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

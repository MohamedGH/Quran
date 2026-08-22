import React, { useState, useEffect } from "react";
import { fetchSurahDefault } from "../../services/quranApi";

export function MemoriseInfoPanel({ surahNum, ayatNum }) {
  return (
    <div style={{ padding: 12, background: "var(--surface3)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        INFORMATIONS SUR L'AYAT {ayatNum} (SOURATE {surahNum})
      </div>
    </div>
  );
}

export default function MemoriseMode({ surahs = [], learnData = {}, setLData, initialSurahNum = 1, initialRangeFrom = 1, initialRangeTo = 10 }) {
  const [surahNum, setSurahNum]   = useState(initialSurahNum);
  const [rangeFrom, setRangeFrom] = useState(initialRangeFrom);
  const [rangeTo, setRangeTo]     = useState(initialRangeTo);
  const [ayats, setAyats]         = useState([]);
  const [curIdx, setCurIdx]       = useState(0);
  const [hidden, setHidden]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSurahDefault(surahNum).then(data => {
      if (!cancelled) setAyats(data);
    });
    return () => { cancelled = true; };
  }, [surahNum]);

  const currentSurah = surahs.find(s => s.number === Number(surahNum)) || { englishName: `Sourate ${surahNum}`, numberOfAyahs: 7 };
  const filteredAyats = ayats.filter(a => a.numberInSurah >= rangeFrom && a.numberInSurah <= rangeTo);
  const curAyat = filteredAyats[curIdx] || { numberInSurah: 1, text: "" };

  return (
    <div className="rev-page page-anim">
      <div className="rev-header-block">
        <div>
          <div className="rev-title">📖 MODE MÉMORISATION RÉPÉTITIVE</div>
          <div className="rev-subtitle">{currentSurah.englishName} ({currentSurah.name})</div>
        </div>
      </div>

      <div style={{ padding: 20, background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={surahNum} onChange={e => setSurahNum(Number(e.target.value))} className="coll-input" style={{ width: "auto" }}>
            {surahs.map(s => (
              <option key={s.number} value={s.number}>{s.number}. {s.englishName}</option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 10, color: "var(--text3)", fontFamily: "'Cinzel',serif" }}>
            <span>DU VERSET</span>
            <input type="number" min="1" max={currentSurah.numberOfAyahs || 286} value={rangeFrom} onChange={e => setRangeFrom(Number(e.target.value))} className="goal-input" />
            <span>AU VERSET</span>
            <input type="number" min={rangeFrom} max={currentSurah.numberOfAyahs || 286} value={rangeTo} onChange={e => setRangeTo(Number(e.target.value))} className="goal-input" />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
            VERSET {curAyat.numberInSurah} ({curIdx + 1} / {filteredAyats.length})
          </span>
          <button className="btn-small" onClick={() => setHidden(!hidden)}>
            {hidden ? "👁 AFFICHER LE TEXTE" : "🙈 MASQUER LE TEXTE"}
          </button>
        </div>

        <div style={{
          padding: 24, background: "var(--surface3)", borderRadius: 10, border: "1px solid var(--border2)",
          fontFamily: "'Amiri Quran',serif", fontSize: 26, direction: "rtl", textAlign: "right",
          lineHeight: 2, filter: hidden ? "blur(8px)" : "none", transition: "filter .2s",
        }}>
          {curAyat.text}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
          <button className="btn-primary" disabled={curIdx <= 0} onClick={() => setCurIdx(c => c - 1)}>
            ◄ PRÉCÉDENT
          </button>
          <button className="btn-primary" disabled={curIdx >= filteredAyats.length - 1} onClick={() => setCurIdx(c => c + 1)}>
            SUIVANT ►
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useMemo, useRef } from "react";
import { splitArabicWords, normalizeArabic } from "../../utils/arabicUtils";
import { useArabicKeyboard } from "../ArabicKeyboard";
import ArabicHighlighted from "../ArabicHighlighted";

export function TextAnswerInput({ q, onReveal }) {
  const { activeInput } = useArabicKeyboard();
  const [val, setVal]   = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <input
        type="text"
        value={val}
        onFocus={e => { if (activeInput) activeInput.current = e.target; }}
        onChange={e => setVal(e.target.value)}
        placeholder="Saisissez la réponse en arabe…"
        style={{
          width: "100%", background: "var(--surface3)", border: "1px solid var(--border2)",
          borderRadius: 8, padding: "10px 14px", color: "var(--text)", fontFamily: "'Amiri Quran',serif",
          fontSize: 18, direction: "rtl", outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={() => onReveal(val)}>VÉRIFIER</button>
        {val && <button className="btn-small" onClick={() => setVal("")}>EFFACER</button>}
      </div>
    </div>
  );
}

export function ReconstructQuestion({ q, ayatTexts, selectedSn, onAnswer }) {
  const targetText = q.text || ayatTexts[q.ayatNum] || "";
  const words = splitArabicWords(targetText);

  const [picked, setPicked] = useState([]);
  const [pool, setPool]     = useState(() => {
    return [...words].map((w, idx) => ({ id: `${idx}_${w}`, text: w })).sort(() => Math.random() - 0.5);
  });
  const [done, setDone]     = useState(false);

  const pick = (item) => {
    if (done) return;
    setPicked(p => [...p, item]);
    setPool(p => p.filter(x => x.id !== item.id));
  };

  const unpick = (item) => {
    if (done) return;
    setPicked(p => p.filter(x => x.id !== item.id));
    setPool(p => [...p, item]);
  };

  const validate = () => {
    setDone(true);
    const constructed = picked.map(x => x.text).join(" ");
    const isCorrect = normalizeArabic(constructed) === normalizeArabic(targetText);
    onAnswer(isCorrect);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        RECONSTRUISEZ LE VERSET DANS L'ORDRE
      </div>

      <div style={{
        minHeight: 60, padding: 12, background: "var(--surface3)", border: "1px solid var(--border2)",
        borderRadius: 8, display: "flex", flexWrap: "wrap", gap: 6, direction: "rtl",
      }}>
        {picked.map((item) => (
          <button
            key={item.id}
            onClick={() => unpick(item)}
            style={{
              fontFamily: "'Amiri Quran',serif", fontSize: 18, padding: "4px 10px",
              background: "rgba(201,168,76,.15)", border: "1px solid var(--gold)", borderRadius: 6,
              color: "var(--gold2)", cursor: "pointer",
            }}
          >
            {item.text}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, direction: "rtl" }}>
        {pool.map((item) => (
          <button
            key={item.id}
            onClick={() => pick(item)}
            style={{
              fontFamily: "'Amiri Quran',serif", fontSize: 18, padding: "4px 10px",
              background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6,
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {item.text}
          </button>
        ))}
      </div>

      {!done && (
        <button className="btn-primary" onClick={validate} disabled={picked.length !== words.length}>
          VÉRIFIER
        </button>
      )}
    </div>
  );
}

export function QAyatPlayer({ ayatText, timestamps, parts, audioUrl, learnData }) {
  return (
    <div style={{ padding: 12, background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <ArabicHighlighted text={ayatText} timestamps={timestamps} />
    </div>
  );
}

export function CompareVerseQuestion({ q, onAnswer, globalNums }) {
  const [ans, setAns] = useState(null);

  const choose = (idx) => {
    setAns(idx);
    onAnswer(idx === q.correctIdx);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        CHOISISSEZ LE VERSET CORRECT
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {q.options.map((opt, i) => (
          <div
            key={i}
            onClick={() => choose(i)}
            style={{
              padding: 12, borderRadius: 8, border: `1px solid ${ans === i ? (i === q.correctIdx ? "var(--green)" : "var(--red)") : "var(--border)"}`,
              background: ans === i ? (i === q.correctIdx ? "rgba(76,175,129,.12)" : "rgba(224,90,90,.12)") : "var(--surface2)",
              cursor: "pointer", fontFamily: "'Amiri Quran',serif", fontSize: 20, direction: "rtl", textAlign: "right",
            }}
          >
            {opt}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FindSurahQuestion({ q, surahs = [], onAnswer }) {
  const [selected, setSelected] = useState(null);

  const choose = (num) => {
    setSelected(num);
    onAnswer(num === q.correctSurahNum);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        A QUELLE SOURATE APPARTIENT CE VERSET ?
      </div>

      <div style={{
        padding: 14, background: "var(--surface3)", border: "1px solid var(--border2)",
        borderRadius: 8, fontFamily: "'Amiri Quran',serif", fontSize: 22, direction: "rtl", textAlign: "right",
      }}>
        {q.ayatText}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {q.options.map((num) => {
          const s = surahs.find(x => x.number === num);
          const isCorrect = num === q.correctSurahNum;
          const isSel = selected === num;

          return (
            <button
              key={num}
              onClick={() => choose(num)}
              style={{
                padding: 10, borderRadius: 8,
                border: `1px solid ${isSel ? (isCorrect ? "var(--green)" : "var(--red)") : "var(--border)"}`,
                background: isSel ? (isCorrect ? "rgba(76,175,129,.15)" : "rgba(224,90,90,.15)") : "var(--surface2)",
                color: "var(--text)", fontFamily: "'Cinzel',serif", fontSize: 10, cursor: "pointer",
              }}
            >
              {num}. {s?.englishName || `Sourate ${num}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function UnknownWordQuestion({ q, onAnswer }) {
  const [ans, setAns] = useState(null);

  const choose = (w) => {
    setAns(w);
    onAnswer(w === q.targetWord);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        TROUVEZ LE MOT CORRESPONDANT À LA DÉFINITION
      </div>

      <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>
        {q.definition}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, direction: "rtl" }}>
        {q.options.map((w, i) => (
          <button
            key={i}
            onClick={() => choose(w)}
            style={{
              fontFamily: "'Amiri Quran',serif", fontSize: 20, padding: "8px 16px",
              borderRadius: 8, border: `1px solid ${ans === w ? (w === q.targetWord ? "var(--green)" : "var(--red)") : "var(--border)"}`,
              background: ans === w ? (w === q.targetWord ? "rgba(76,175,129,.15)" : "rgba(224,90,90,.15)") : "var(--surface2)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}

export function UnknownPickQuestion({ q, onAnswer }) {
  return <UnknownWordQuestion q={q} onAnswer={onAnswer} />;
}

export function RevisePartQuestion({ q, onAnswer }) {
  const [done, setDone] = useState(false);

  const finish = (ok) => {
    setDone(true);
    onAnswer(ok);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        RÉCITER DE MÉMOIRE LA PARTIE
      </div>

      <div style={{ padding: 14, background: "var(--surface3)", borderRadius: 8, border: "1px solid var(--border2)", fontFamily: "'Amiri Quran',serif", fontSize: 22, direction: "rtl", textAlign: "right" }}>
        {q.partText}
      </div>

      {!done && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={() => finish(true)}>✓ RÉCITÉ SANS ERREUR</button>
          <button className="btn-small" style={{ color: "var(--red)", borderColor: "var(--red)" }} onClick={() => finish(false)}>✕ ERREUR</button>
        </div>
      )}
    </div>
  );
}

export function PageStructureQuestion({ q, onAnswer, ayatTexts, globalNums, timestamps, sn }) {
  const [ans, setAns] = useState(null);

  const choose = (val) => {
    setAns(val);
    onAnswer(val === q.correctVal);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        {q.title || "QUESTION DE STRUCTURE DU MUSHAF"}
      </div>

      <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>
        {q.questionText}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => choose(opt.val)}
            style={{
              padding: 12, borderRadius: 8,
              border: `1px solid ${ans === opt.val ? (opt.val === q.correctVal ? "var(--green)" : "var(--red)") : "var(--border)"}`,
              background: ans === opt.val ? (opt.val === q.correctVal ? "rgba(76,175,129,.15)" : "rgba(224,90,90,.15)") : "var(--surface2)",
              color: "var(--text)", fontFamily: "'Cinzel',serif", fontSize: 11, cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuestionsMode({ selectedSn, ayatList = [], surahs = [], learnData = {}, setLData, ayatTexts = {}, randomize, selectedQTypes, initialQIdx = 0, onQIdxChange, onDone }) {
  const [qIdx, setQIdx] = useState(initialQIdx);
  const [score, setScore] = useState(0);

  const currentAyat = ayatList[qIdx] || { numberInSurah: 1, text: "" };

  const handleAnswer = (isCorrect) => {
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      const next = qIdx + 1;
      if (next < ayatList.length) {
        setQIdx(next);
        onQIdxChange?.(next);
      } else {
        onDone?.(score + (isCorrect ? 1 : 0), ayatList.length);
      }
    }, 1000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, color: "var(--text3)", fontFamily: "'Cinzel',serif" }}>
        <span>QUESTION {qIdx + 1} / {ayatList.length}</span>
        <span>SCORE : {score}</span>
      </div>

      <ReconstructQuestion
        q={{ ayatNum: currentAyat.numberInSurah, text: currentAyat.text }}
        ayatTexts={ayatTexts}
        selectedSn={selectedSn}
        onAnswer={handleAnswer}
      />
    </div>
  );
}

export default function QuestionsModePage({ surahs = [], learnData = {}, setLData, initialSurahNum = 1 }) {
  return (
    <div className="rev-page page-anim">
      <div className="rev-header-block">
        <div>
          <div className="rev-title">❓ MODE QUESTIONS & QUIZ</div>
          <div className="rev-subtitle">TESTEZ VOS CONNAISSANCES SUR LE CORAN</div>
        </div>
      </div>

      <div style={{ padding: 20, background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)" }}>
        <QuestionsMode
          selectedSn={initialSurahNum}
          surahs={surahs}
          learnData={learnData}
          setLData={setLData}
        />
      </div>
    </div>
  );
}

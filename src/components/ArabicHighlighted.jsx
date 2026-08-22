import React, { useRef, useMemo, useEffect } from "react";
import { useSelector } from "react-redux";
import { sel } from "../store";
import { fixChars } from "../services/quranApi";
import { isQalqala, getMaddType, isIzhar, isIdgham } from "../utils/arabicUtils";

export const ArabicHighlighted = React.memo(React.forwardRef(function ArabicHighlighted({ text, timestamps, currentMs, rangeStartMs, showQalqala, showMadd, showIzhar, showIdgham }, ref) {
  if (!timestamps?.words) return <div className="ayat-arabic">{text}</div>;

  const wordData = useMemo(() => timestamps.words.map(word => {
    const wordArr = word.chars ? word.chars.map(x => x.char) : [];
    const fixed = fixChars(word.chars || []);
    return fixed.map((c, ci) => {
      const isQalqalaOn = showQalqala && isQalqala(wordArr, ci);
      const maddType    = showMadd ? getMaddType(wordArr, ci) : null;
      const izharOn     = showIzhar && isIzhar(wordArr, ci);
      const idghamOn    = showIdgham && isIdgham(wordArr, ci);
      const tajStyle    = isQalqalaOn ? {color:'#5bc8f5',textShadow:'0 0 6px rgba(91,200,245,.5)'}
                        : maddType === 'muttasil' ? {color:'#ff7eb3',textShadow:'0 0 8px rgba(255,126,179,.6)',fontWeight:600}
                        : maddType === 'normal'   ? {color:'#f09de0',textShadow:'0 0 6px rgba(240,157,224,.5)'}
                        : izharOn                 ? {color:'#4caf81',textShadow:'0 0 6px rgba(76,175,129,.5)'}
                        : idghamOn                ? {color:'#ffd166',textShadow:'0 0 6px rgba(255,209,102,.5)'}
                        : undefined;
      return { char: c.char, start: c.start, end: c.end, tajStyle };
    });
  }), [timestamps, showQalqala, showMadd, showIzhar, showIdgham]);

  return (
    <div className="ayat-arabic" ref={ref}>
      {wordData.map((chars, wi) => (
        <span key={wi}>
          {chars.map((c, ci) => (
            <span key={ci} className="char-span" style={c.tajStyle}>{c.char}</span>
          ))}
          {wi < wordData.length - 1 ? ' ' : ''}
        </span>
      ))}
    </div>
  );
}), (prev, next) =>
  prev.text === next.text &&
  prev.timestamps === next.timestamps &&
  prev.currentMs === next.currentMs &&
  prev.showQalqala === next.showQalqala &&
  prev.showMadd === next.showMadd &&
  prev.showIzhar === next.showIzhar &&
  prev.showIdgham === next.showIdgham
);

export const PlayingArabicHighlighted = React.memo(function PlayingArabicHighlighted({
  text, timestamps, mode, playingPart, ld, showQalqala, showMadd, showIzhar, showIdgham
}) {
  const mainCurrentMs = useSelector(sel.mainCurrentMs);
  const partCurrentMs = useSelector(sel.partCurrentMs);
  const localPlaying  = useSelector(sel.localPlaying);
  const containerRef  = useRef(null);
  const charDataRef   = useRef(null);

  const charData = useMemo(() => {
    if (!timestamps?.words) return null;
    const flat = [];
    timestamps.words.forEach(word => {
      const chars = fixChars(word.chars || []);
      chars.forEach(c => flat.push({ start: c.start, end: c.end }));
    });
    return flat;
  }, [timestamps]);

  charDataRef.current = charData;

  useEffect(() => {
    const flat = charDataRef.current;
    if (!flat || !containerRef.current) return;
    let curMs;
    let rangeStartMs = null;
    if (mode === 'main') {
      curMs = mainCurrentMs;
    } else if (mode === 'part') {
      const activePart = (ld?.parts || []).find(p => p.id === playingPart?.partId);
      const firstWordIdx = activePart?.wordIndices?.[0];
      rangeStartMs = firstWordIdx != null ? timestamps?.words?.[firstWordIdx]?.chars?.[0]?.start : null;
      curMs = partCurrentMs;
    } else {
      curMs = localPlaying?.currentMs ?? -1;
    }
    const spans = containerRef.current.querySelectorAll('.char-span');
    if (spans.length !== flat.length) return;
    flat.forEach(({ start, end }, i) => {
      const active = curMs >= start && curMs <= end;
      const done   = curMs > end && curMs > 0 && (rangeStartMs == null || end > rangeStartMs);
      const el = spans[i];
      if (active) {
        if (!el.classList.contains('char-active')) { el.classList.add('char-active'); el.classList.remove('char-done'); }
      } else if (done) {
        if (!el.classList.contains('char-done')) { el.classList.add('char-done'); el.classList.remove('char-active'); }
      } else {
        if (el.classList.contains('char-active') || el.classList.contains('char-done')) {
          el.classList.remove('char-active','char-done');
        }
      }
    });
  }, [mainCurrentMs, partCurrentMs, localPlaying, mode, ld, playingPart, timestamps]);

  return <ArabicHighlighted ref={containerRef} text={text} timestamps={timestamps}
    currentMs={-1} showQalqala={showQalqala} showMadd={showMadd}
    showIzhar={showIzhar} showIdgham={showIdgham} />;
}, (prev, next) =>
  prev.text === next.text &&
  prev.timestamps === next.timestamps &&
  prev.mode === next.mode &&
  prev.showQalqala === next.showQalqala &&
  prev.showMadd === next.showMadd &&
  prev.showIzhar === next.showIzhar &&
  prev.showIdgham === next.showIdgham
);

export default ArabicHighlighted;

import React, { useRef, useMemo, useEffect } from "react";
import { useSelector } from "react-redux";
import { sel } from "../store";
import { fixChars } from "../services/quranApi";
import { isQalqala, getMaddType, isIzhar, isIdgham, normalizeAr, arabicRoot } from "../utils/arabicUtils";

export const PART_COLORS = [
  'rgba(91, 200, 245, 0.18)',
  'rgba(255, 209, 102, 0.18)',
  'rgba(200, 120, 255, 0.18)',
  'rgba(76, 175, 129, 0.18)',
  'rgba(255, 126, 179, 0.18)'
];

export const PART_BORDERS = [
  '#5bc8f5',
  '#ffd166',
  '#c878ff',
  '#4caf81',
  '#ff7eb3'
];

export const ArabicHighlighted = React.memo(React.forwardRef(function ArabicHighlighted({
  text,
  timestamps,
  currentMs = 0,
  rangeStartMs,
  showQalqala,
  showMadd,
  showIzhar,
  showIdgham,
  onWordClick,
  ld,
  partSelectAyat,
  partSelectStep,
  partSelectStart,
  ayatNum
}, ref) {
  const words = useMemo(() => text ? text.split(" ").filter(Boolean) : [], [text]);

  const wordPartMap = useMemo(() => {
    if (!ld?.parts || ld.parts.length === 0) return {};
    const map = {};
    ld.parts.forEach((part, pi) => {
      (part.wordIndices || []).forEach((wi, iInPart) => {
        map[wi] = {
          partId: part.id,
          partIndex: pi,
          isFirst: iInPart === 0,
          isLast: iInPart === (part.wordIndices.length - 1),
          learned: part.learned,
          color: PART_COLORS[pi % PART_COLORS.length],
          border: PART_BORDERS[pi % PART_BORDERS.length]
        };
      });
    });
    return map;
  }, [ld?.parts]);

  const wordsInParts = useMemo(() => {
    const s = new Set();
    (ld?.parts || []).forEach(p => p.wordIndices?.forEach(i => s.add(i)));
    return s;
  }, [ld?.parts]);

  const nextAvail = wordsInParts.size > 0 ? Math.max(...[...wordsInParts]) + 1 : 0;

  const highlightedSet = useMemo(() => {
    if (!ld?.highlight?.trim()) return new Set();
    const list = ld.highlight.trim().split(/\s+/).map(normalizeAr);
    const set = new Set();
    words.forEach((w, wi) => {
      if (list.includes(normalizeAr(w))) set.add(wi);
    });
    return set;
  }, [ld?.highlight, words]);

  const unknownSet = useMemo(() => {
    if (!ld?.unknownWords || ld.unknownWords.length === 0) return new Set();
    const manualSet = new Set(ld.unknownWords);
    const manualRoots = new Set([...manualSet].map(i => arabicRoot(words[i] || '')).filter(Boolean));
    const fullSet = new Set(manualSet);
    words.forEach((w, i) => {
      if (!manualSet.has(i) && manualRoots.has(arabicRoot(w))) {
        fullSet.add(i);
      }
    });
    return fullSet;
  }, [ld?.unknownWords, words]);

  const wordData = useMemo(() => {
    if (timestamps?.words) {
      return timestamps.words.map((word, wi) => {
        const origWord = words[wi] || '';
        if (word.chars && word.chars.length > 0) {
          const wordArr = word.chars.map(x => x.char);
          const fixed = fixChars(word.chars);
          const charsMapped = fixed.map((c, ci) => {
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
          const hasTajweed = charsMapped.some(c => c.tajStyle !== undefined);
          return { origWord, chars: charsMapped, hasTajweed, hasTimestampChars: true };
        }
        return { origWord, chars: [{ char: origWord, start: 0, end: 0, tajStyle: undefined }], hasTajweed: false, hasTimestampChars: false };
      });
    }

    return words.map(w => ({
      origWord: w,
      chars: [{ char: w, start: 0, end: 0, tajStyle: undefined }],
      hasTajweed: false,
      hasTimestampChars: false
    }));
  }, [timestamps, words, showQalqala, showMadd, showIzhar, showIdgham]);

  const isSelectingThisAyat = partSelectAyat === ayatNum;

  return (
    <div className="ayat-arabic" ref={ref} style={{ direction: 'rtl' }}>
      {wordData.map((item, wi) => {
        const chars = item.chars;
        const partInfo = wordPartMap[wi];
        const isHighlighted = highlightedSet.has(wi);
        const isUnknown = unknownSet.has(wi);

        let isSelectedForPart = false;
        let isDisabledForPart = false;

        if (isSelectingThisAyat) {
          if (partSelectStep === 'start') {
            if (wi < nextAvail) isDisabledForPart = true;
            else if (partSelectStart === wi) isSelectedForPart = true;
          } else if (partSelectStep === 'end') {
            if (wi < nextAvail) isDisabledForPart = true;
            else if (partSelectStart != null) {
              const minI = Math.min(partSelectStart, wi);
              const maxI = Math.max(partSelectStart, wi);
              if (wi >= minI && wi <= maxI) isSelectedForPart = true;
            }
          }
        }

        const wordStart = chars[0]?.start ?? 0;
        const wordEnd = chars[chars.length - 1]?.end ?? 0;
        const isWordActive = currentMs > 0 && currentMs >= wordStart && currentMs <= wordEnd;
        const isWordDone = currentMs > 0 && currentMs > wordEnd;

        const hasCustomBox = partInfo || isHighlighted || isUnknown || isSelectedForPart || isDisabledForPart;

        const wordStyle = {
          position: 'relative',
          display: hasCustomBox ? 'inline-block' : 'inline',
          padding: hasCustomBox ? '2px 4px' : undefined,
          borderRadius: '4px',
          transition: 'all 0.15s ease',
          cursor: onWordClick ? 'pointer' : 'default',
          opacity: isDisabledForPart ? 0.4 : 1,
          ...(partInfo ? {
            background: partInfo.color,
            borderTop: `1.5px solid ${partInfo.border}`,
            borderBottom: `1.5px solid ${partInfo.border}`,
            borderRight: partInfo.isFirst ? `1.5px solid ${partInfo.border}` : 'none',
            borderLeft: partInfo.isLast ? `1.5px solid ${partInfo.border}` : 'none',
            borderRadius: partInfo.isFirst && partInfo.isLast ? '6px'
              : partInfo.isFirst ? '0 6px 6px 0'
              : partInfo.isLast ? '6px 0 0 6px'
              : '0'
          } : {}),
          ...(isHighlighted ? {
            background: 'rgba(255, 209, 102, 0.25)',
            boxShadow: '0 0 8px rgba(255, 209, 102, 0.4)',
            borderRadius: '4px'
          } : {}),
          ...(isUnknown ? {
            borderBottom: '2px dotted #ff7eb3',
            color: '#ff7eb3'
          } : {}),
          ...(isSelectedForPart ? {
            background: 'rgba(91, 200, 245, 0.3)',
            boxShadow: '0 0 8px rgba(91, 200, 245, 0.5)',
            border: '1.5px dashed #5bc8f5',
            borderRadius: '4px'
          } : {})
        };

        const wordClass = `word-span${isSelectedForPart ? ' word-selecting' : ''}${isWordActive ? ' word-active' : ''}${isWordDone ? ' word-done' : ''}`;

        return (
          <React.Fragment key={wi}>
            <span
              className={wordClass}
              style={wordStyle}
              data-word-idx={wi}
              onClick={(e) => {
                if (onWordClick) {
                  e.stopPropagation();
                  onWordClick(wi);
                }
              }}
            >
              {partInfo && partInfo.isFirst && (
                <span
                  className="part-badge"
                  style={{
                    fontSize: '8px',
                    fontFamily: "'Cinzel', serif",
                    fontWeight: 'bold',
                    background: partInfo.border,
                    color: '#111',
                    padding: '1px 4px',
                    borderRadius: '3px',
                    marginLeft: '4px',
                    lineHeight: 1,
                    display: 'inline-block',
                    userSelect: 'none'
                  }}
                >
                  P{partInfo.partIndex + 1}
                </span>
              )}
              {item.hasTimestampChars || item.hasTajweed || currentMs > 0
                ? chars.map((c, ci) => {
                    const isCharActive = currentMs > 0 && currentMs >= c.start && currentMs <= c.end;
                    const isCharDone = currentMs > 0 && currentMs > c.end;
                    const charClass = `char-span${isCharActive ? ' char-active' : ''}${isCharDone ? ' char-done' : ''}`;
                    return (
                      <span key={ci} className={charClass} style={c.tajStyle}>{c.char}</span>
                    );
                  })
                : <span className="char-span">{item.origWord}</span>
              }
            </span>
            {wi < wordData.length - 1 ? ' ' : ''}
          </React.Fragment>
        );
      })}
    </div>
  );
}), (prev, next) =>
  prev.text === next.text &&
  prev.timestamps === next.timestamps &&
  prev.currentMs === next.currentMs &&
  prev.showQalqala === next.showQalqala &&
  prev.showMadd === next.showMadd &&
  prev.showIzhar === next.showIzhar &&
  prev.showIdgham === next.showIdgham &&
  prev.ld === next.ld &&
  prev.partSelectAyat === next.partSelectAyat &&
  prev.partSelectStep === next.partSelectStep &&
  prev.partSelectStart === next.partSelectStart
);

export const PlayingArabicHighlighted = React.memo(function PlayingArabicHighlighted({
  text, timestamps, mode, playingPart, ld, showQalqala, showMadd, showIzhar, showIdgham,
  onWordClick, partSelectAyat, partSelectStep, partSelectStart, ayatNum
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
      fixChars(word.chars || []).forEach(c => flat.push({ start: c.start, end: c.end }));
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
        if (!el.classList.contains('char-active')) {
          el.classList.add('char-active');
          el.classList.remove('char-done');
        }
      } else if (done) {
        if (!el.classList.contains('char-done')) {
          el.classList.add('char-done');
          el.classList.remove('char-active');
        }
      } else {
        if (el.classList.contains('char-active') || el.classList.contains('char-done')) {
          el.classList.remove('char-active', 'char-done');
        }
      }
    });
  }, [mainCurrentMs, partCurrentMs, localPlaying, mode, ld, playingPart, timestamps]);

  return <ArabicHighlighted ref={containerRef} text={text} timestamps={timestamps}
    currentMs={-1} showQalqala={showQalqala} showMadd={showMadd}
    showIzhar={showIzhar} showIdgham={showIdgham}
    onWordClick={onWordClick} ld={ld} partSelectAyat={partSelectAyat}
    partSelectStep={partSelectStep} partSelectStart={partSelectStart} ayatNum={ayatNum} />;
}, (prev, next) =>
  prev.text === next.text &&
  prev.timestamps === next.timestamps &&
  prev.mode === next.mode &&
  prev.showQalqala === next.showQalqala &&
  prev.showMadd === next.showMadd &&
  prev.showIzhar === next.showIzhar &&
  prev.showIdgham === next.showIdgham &&
  prev.ld === next.ld &&
  prev.partSelectAyat === next.partSelectAyat &&
  prev.partSelectStep === next.partSelectStep &&
  prev.partSelectStart === next.partSelectStart
);

export default ArabicHighlighted;

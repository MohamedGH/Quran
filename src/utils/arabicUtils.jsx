import React from "react";
import { SURAH_NAMES, ARABIC_ROOTS } from "./quranData";

export const QALQALA_LETTERS = new Set(['ق','ط','ب','ج','د']);
export const MADD_MARK       = new Set(['ٓ','ٰ']);
export const LONG_VOWEL      = new Set(['َ','ُ','ِ']);
export const MADD_LETTER     = new Set(['ا','و','ي']);
export const HAMZA_SET       = new Set(['ء','أ','إ','ؤ','ئ']);
export const IZHAR_LETTERS   = new Set(['ء','ه','ع','غ','ح','خ']);
export const SUKUN           = 'ْ';
export const TANWIN          = new Set(['ً','ٌ','ٍ']);
export const IDGHAM_LETTERS  = new Set(['ي','ن','م','و','ل','ر']);

export function isQalqala(arr, i) {
  if (!QALQALA_LETTERS.has(arr[i])) return false;
  for (let j = i + 1; j < arr.length; j++) {
    const nc = arr[j];
    if (nc === SUKUN) return true;
    if (nc === ' ' || j === arr.length - 1) return true;
    if (nc >= '؀' && nc <= 'ۿ') continue;
    return false;
  }
  return true;
}

export function isIzhar(arr, i) {
  const ch = arr[i];
  let isNunSakin = false;
  if (ch === 'ن') {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j] === ' ') break;
      if (arr[j] === SUKUN) { isNunSakin = true; break; }
      if (arr[j] >= 'ء' && arr[j] <= 'ي' && !TANWIN.has(arr[j])) break;
    }
  }
  const isTanwin = TANWIN.has(ch);
  if (!isNunSakin && !isTanwin) return false;
  for (let j = (isTanwin ? i + 1 : i + 1); j < arr.length; j++) {
    const nc = arr[j];
    if (nc === ' ') continue;
    if (IZHAR_LETTERS.has(nc)) return true;
    if (nc >= 'ء' && nc <= 'ي' && !TANWIN.has(nc) && nc !== SUKUN) return false;
  }
  return false;
}

export function isIdgham(arr, i) {
  const ch = arr[i];
  let isNunSakin = false;
  if (ch === 'ن') {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j] === ' ') break;
      if (arr[j] === SUKUN) { isNunSakin = true; break; }
      if (arr[j] >= 'ء' && arr[j] <= 'ي' && !TANWIN.has(arr[j])) break;
    }
  }
  const isTanwin = TANWIN.has(ch);
  if (!isNunSakin && !isTanwin) return false;
  for (let j = i + 1; j < arr.length; j++) {
    const nc = arr[j];
    if (nc === ' ') continue;
    if (IDGHAM_LETTERS.has(nc)) return true;
    if (nc >= 'ء' && nc <= 'ي' && !TANWIN.has(nc) && nc !== SUKUN) return false;
  }
  return false;
}

export function getMaddType(arr, i) {
  const ch = arr[i];

  if (MADD_MARK.has(ch)) return 'muttasil';

  if (MADD_LETTER.has(ch)) {
    let prevVowel = null;
    for (let j = i - 1; j >= 0; j--) {
      if (LONG_VOWEL.has(arr[j])) { prevVowel = arr[j]; break; }
      if (arr[j] === ' ' || (arr[j] >= 'ء' && arr[j] <= 'ي')) break;
    }
    const match = (ch === 'ا' && prevVowel === 'َ') ||
                  (ch === 'و' && prevVowel === 'ُ') ||
                  (ch === 'ي' && prevVowel === 'ِ');
    if (!match) return null;

    let nextChar = null;
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j] === ' ') break;
      if (arr[j] >= '؀' && arr[j] <= 'ۿ' && !LONG_VOWEL.has(arr[j])) continue;
      nextChar = arr[j];
      break;
    }
    if (nextChar && HAMZA_SET.has(nextChar)) return 'muttasil';
    return 'normal';
  }
  return null;
}

export function isMaddChar(arr, i) {
  return getMaddType(arr, i) !== null;
}

export function normalizeAr(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff\s]/g, '')
    .trim();
}

export function parseVoiceCommand(transcript, surahs, ayats, currentSurah) {
  if (!transcript) return null;
  const raw = transcript.trim().toLowerCase();
  const norm = normalizeAr(raw);

  if (norm.includes("pause") || norm.includes("stop") || norm.includes("arreter") || norm.includes("arret") || norm.includes("quitter")) {
    return { type: "PAUSE" };
  }
  if (norm.includes("play") || norm.includes("lecture") || norm.includes("continuer") || norm.includes("reprendre") || norm.includes("ecouter")) {
    return { type: "PLAY" };
  }
  if (norm.includes("suivant") || norm.includes("suivante") || norm.includes("apres") || norm.includes("next")) {
    return { type: "NEXT_AYAT" };
  }
  if (norm.includes("precedent") || norm.includes("precedente") || norm.includes("avant") || norm.includes("retour") || norm.includes("previous")) {
    return { type: "PREV_AYAT" };
  }
  if (norm.includes("repetition") || norm.includes("repete") || norm.includes("encore") || norm.includes("recommencer") || norm.includes("relire")) {
    return { type: "REPEAT_AYAT" };
  }

  const sourateMatch = norm.match(/(?:sourate|surah|sura|chapitre)\s+([a-z0-9\s'-]+?)(?:\s+(?:verset|ayat|verser|vers|v)\s+(\d+))?$/);
  if (sourateMatch) {
    const surahTarget = sourateMatch[1].trim();
    const ayatNum     = sourateMatch[2] ? parseInt(sourateMatch[2], 10) : null;

    let surahNum = null;
    if (!isNaN(parseInt(surahTarget, 10))) {
      const n = parseInt(surahTarget, 10);
      if (n >= 1 && n <= 114) surahNum = n;
    }
    const key = surahTarget.replace(/[\s'-]/g, '');
    if (!surahNum) {
      if (SURAH_NAMES[key]) surahNum = SURAH_NAMES[key];
      else {
        for (const [k, v] of Object.entries(SURAH_NAMES)) {
          if (k.includes(key) || key.includes(k)) { surahNum = v; break; }
        }
      }
    }
    if (!surahNum && surahs) {
      const found = surahs.find(s =>
        normalizeAr(s.englishName).includes(key) ||
        normalizeAr(s.name).includes(key)
      );
      if (found) surahNum = found.number;
    }

    if (surahNum) {
      return { type: "GOTO_SURAH", surahNum, ayatNum: ayatNum || 1 };
    }
  }

  const versetOnlyMatch = norm.match(/(?:verset|ayat|verser|vers|v)\s+(\d+)/);
  if (versetOnlyMatch) {
    const ayatNum = parseInt(versetOnlyMatch[1], 10);
    return { type: "GOTO_AYAT", ayatNum };
  }

  const numWords = { "un":1,"deux":2,"trois":3,"quatre":4,"cinq":5,"six":6,"sept":7,"huit":8,"neuf":9,"dix":10 };
  for (const [w, n] of Object.entries(numWords)) {
    if (norm === w || norm === `verset ${w}`) {
      return { type: "GOTO_AYAT", ayatNum: n };
    }
  }

  return null;
}

export function arabicRoot(word) {
  if (!word) return "";
  const bare = stripDiacritics(word)
    .replace(/[أإآءئؤ]/g, 'ا')
    .replace(/^و/, '')
    .replace(/^(ال|بال|كال|فال|لل)/, '')
    .replace(/(هم|كم|نا|ها|ون|ين|ات|ة)$/, '');
  return bare.slice(0, 4);
}

export function highlightArabic(text, query) {
  if (!text) return text;
  if (!query || !query.trim()) return text;
  const qNorm = stripDiacritics(query.trim());
  if (!qNorm) return text;

  const words = text.split(/(\s+)/);
  return words.map((w, i) => {
    if (!w.trim()) return w;
    const wNorm = stripDiacritics(w);
    if (wNorm.includes(qNorm)) {
      return <span key={i} className="concord-highlight">{w}</span>;
    }
    return w;
  });
}

export function stripDiacritics(s) {
  if (!s) return "";
  return s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
}

export function wordTranslit(w) {
  const b = stripDiacritics(w);
  const map = {
    'ا':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh',
    'د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s',
    'ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q',
    'ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y',
    'ة':'h','أ':'a','إ':'i','آ':'aa','ء':'a','ى':'a',
  };
  return [...b].map(c => map[c] || c).join('');
}

export function calcDifficulty(text, ld) {
  let score = 0;
  const len = text ? text.length : 0;
  if (len > 120) score += 2;
  else if (len > 70) score += 1;
  const recs = ld?.recitAttempts || [];
  if (recs.length > 0) {
    const last = recs[recs.length - 1]?.score ?? 100;
    if (last < 50) score += 2;
    else if (last < 80) score += 1;
  }
  if ((ld?.unknownWords || []).length > 0) score += 1;
  return score >= 3 ? "Difficile" : score >= 1 ? "Moyen" : "Facile";
}

export function calcPhase(ld) {
  if (!ld || (!ld.learned && !ld.readCount && !(ld.parts?.length))) return "Découverte";
  if (ld.learned) {
    const recs = ld.recitAttempts || [];
    const last = recs.length ? recs[recs.length - 1].date : null;
    if (!last) return "Mémorisé";
    const days = (Date.now() - new Date(last).getTime()) / (1000 * 3600 * 24);
    if (days > 14) return "Consolidation (Ancien)";
    return "Mémorisé (Récent)";
  }
  return "Apprentissage";
}

export function splitArabicChars(word) {
  if (!word) return [];
  const clusters = [];
  let cur = '';
  for (const ch of word) {
    if (/[\u064B-\u065F\u0670\u06D6-\u06ED]/.test(ch)) {
      cur += ch;
    } else {
      if (cur) clusters.push(cur);
      cur = ch;
    }
  }
  if (cur) clusters.push(cur);
  return clusters;
}

export function splitArabicWords(text) {
  if (!text) return [];
  return text.split(/\s+/).filter(Boolean);
}

export const QURAN_NON_LETTER_RE = /[\u06D6-\u06ED\u0660-\u0669\u06F0-\u06F9\uFD3E\uFD3F]/;

export function splitArabicClusters(text) {
  if (!text) return [];
  const res = [];
  let cur = '';
  for (const c of text) {
    if (/\s/.test(c)) {
      if (cur) { res.push(cur); cur = ''; }
      res.push(c);
    } else if (/[\u064B-\u065F\u0670]/.test(c) || QURAN_NON_LETTER_RE.test(c)) {
      cur += c;
    } else {
      if (cur) res.push(cur);
      cur = c;
    }
  }
  if (cur) res.push(cur);
  return res;
}

export function computeMastery(ld, ayatText) {
  if (!ld && !ayatText) return 0;
  if (ld?.learned) return 100;
  let score = 0;
  const parts = ld?.parts || [];
  if (parts.length > 0) {
    const learnedCount = parts.filter(p => p.learned).length;
    score += Math.round((learnedCount / parts.length) * 60);
  }
  const recs = ld?.recitAttempts || [];
  if (recs.length > 0) {
    const best = Math.max(...recs.map(r => r.score || 0));
    score += Math.round((best / 100) * 30);
  }
  if (ld?.wordsLearned) {
    const wCount = Object.keys(ld.wordsLearned).length;
    const totalW = ayatText ? splitArabicWords(ayatText).length : 1;
    score += Math.min(10, Math.round((wCount / Math.max(1, totalW)) * 10));
  }
  if (ld?.readCount && ld.readCount > 0) score += Math.min(10, ld.readCount * 2);
  return Math.min(100, score);
}

export function masteryColor(pct) {
  if (pct >= 90) return 'var(--green2)';
  if (pct >= 60) return 'var(--teal2)';
  if (pct >= 30) return 'var(--gold2)';
  if (pct > 0)  return '#ff9f43';
  return 'var(--text3)';
}

export function normalizeArabic(str) {
  if (!str) return "";
  return str
    .replace(/[\u0671\u0623\u0625\u0622\u0624\u0626]/g, "\u0627")
    .replace(/\u06CC/g, "\u064A")
    .replace(/[\u06C1\u06BE]/g, "\u0647")
    .replace(/\u06C3/g, "\u0629")
    .replace(/\u0649\u0670/g, "\u0627")
    .replace(/([\u0600-\u06FF])[\u064B-\u065F]+([\u0670])/g, "$1$2")
    .replace(/([^\u0627\u0020])(\u0670)/g, "$1\u0627")
    .replace(/\u0670/g, "")
    .replace(/\u0649(?=[\u0600-\u06FF])/g, "\u064A")
    .replace(/\u0649\u0627/g, "\u0627")
    .replace(/[\u064E\u064B]\u0649(\s|$)/g, "\u0627$1")
    .replace(/[\u064E\u064B]\u0649$/g, "\u0627")
    .replace(/[\u0650\u064F]\u0649(\s|$)/g, "\u064A$1")
    .replace(/[\u0650\u064F]\u0649$/g, "\u064A")
    .replace(/\u0649(\s|$)/g, "\u0627$1")
    .replace(/\u0649$/g, "\u0627")
    .replace(/[\u0640\u064B-\u065F]/g, "")
    .replace(/[\u0610-\u061A]/g, "")
    .replace(/[\u06D6-\u06ED]/g, "")
    .replace(/[\u0870-\u08FF]/g, "")
    .replace(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const SILENT_WORD_MAP = {
  "ذلك":    new Set([1]),
  "داود":   new Set([2]),
  "طاوس":   new Set([2]),
  "اسم":    new Set([0]),
};

export function getWaslVowel(rawWord) {
  const body = rawWord.replace(/^[اٱ]/, '');
  if (/^ل[اَُِْ]/.test(body) || /^لل/.test(body)) return 'fatha';
  const DIACRITICS = /[ً-ٟؐ-ؚۖ-ۜ۟-۪ۤۧۨ-ۭ]/;
  let letterCount = 0;
  for (let i = 0; i < rawWord.length; i++) {
    if (!DIACRITICS.test(rawWord[i])) letterCount++;
    if (letterCount === 3) {
      let j = i + 1;
      while (j < rawWord.length && DIACRITICS.test(rawWord[j])) {
        if (rawWord[j] === 'ُ') return 'damma';
        j++;
      }
      break;
    }
  }
  return 'kasra';
}

export function getSilentIndices(normWord, rawWord, wordIndex = 0) {
  const silent = new Set();
  const isFirstWord = (wordIndex === 0);

  if (SILENT_WORD_MAP[normWord]) return SILENT_WORD_MAP[normWord];

  if (rawWord && rawWord[0] === '\u0671' && !isFirstWord) {
    silent.add(0);
  }

  if (/^\u0627\u0644/.test(normWord) && !isFirstWord) {
    const firstRaw = rawWord ? rawWord[0] : '';
    if (firstRaw === '\u0671' || firstRaw === '\u0627') {
      silent.add(0);
    }
  }

  if (/\u0648\u0627$/.test(normWord) && normWord.length > 2) {
    silent.add(normWord.length - 1);
  }

  return silent;
}

export const PHONO_PAIRS = new Map();
export function addPair(a, b, cost) {
  PHONO_PAIRS.set(a + b, cost);
  PHONO_PAIRS.set(b + a, cost);
}

addPair('س','ص', 0.3);  addPair('ز','ظ', 0.3);  addPair('ز','ض', 0.35);
addPair('د','ض', 0.3);  addPair('ت','ط', 0.3);   addPair('ذ','ظ', 0.3);
addPair('ع','غ', 0.3);  addPair('ح','خ', 0.3);   addPair('ه','ح', 0.35);
addPair('ة','ه', 0.1);
addPair('ا','ع', 0.4);
addPair('س','ش', 0.4);  addPair('ز','س', 0.4);   addPair('ص','ض', 0.4);
addPair('ك','ق', 0.4);  addPair('ب','ف', 0.45);  addPair('ت','د', 0.4);
addPair('ك','خ', 0.45);
addPair('م','ن', 0.5);  addPair('ل','ن', 0.5);   addPair('ل','ر', 0.45);
addPair('و','ب', 0.5);  addPair('ي','ء', 0.45);
['ت','ث','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ن'].forEach(c => addPair('ل', c, 0.3));

export const SOLAR_LETTERS = new Set(['ت','ث','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ل','ن']);
export const NEAR_THRESHOLD = 0.5;

export function phonoCost(a, b) {
  if (a === b) return 0;
  return PHONO_PAIRS.get(a + b) ?? 1;
}

export function levenshteinChars(refChars, gotChars) {
  const R = refChars.length, G = gotChars.length;
  const dp = Array.from({ length: R + 1 }, (_, r) =>
    Array.from({ length: G + 1 }, (_, g) => (r === 0 ? g : g === 0 ? r : 0))
  );
  for (let r = 1; r <= R; r++) {
    for (let g = 1; g <= G; g++) {
      const cost = phonoCost(refChars[r-1], gotChars[g-1]);
      dp[r][g] = Math.min(
        dp[r-1][g]   + 1,
        dp[r][g-1]   + 1,
        dp[r-1][g-1] + cost
      );
    }
  }
  const aligned = [];
  let r = R, g = G;
  while (r > 0 || g > 0) {
    if (r > 0 && g > 0) {
      const cost = phonoCost(refChars[r-1], gotChars[g-1]);
      const diag = dp[r-1][g-1] + cost;
      const del  = dp[r-1][g]   + 1;
      const ins  = dp[r][g-1]   + 1;
      if (dp[r][g] >= diag - 1e-9 && diag <= del && diag <= ins) {
        const op = cost === 0 ? 'match' : cost <= NEAR_THRESHOLD ? 'near' : 'sub';
        aligned.push({ refChar: refChars[r-1], gotChar: gotChars[g-1], op, cost });
        r--; g--; continue;
      }
    }
    if (r > 0 && (g === 0 || dp[r-1][g] <= dp[r][g-1])) {
      aligned.push({ refChar: refChars[r-1], gotChar: null, op: 'del', cost: 1 });
      r--; continue;
    }
    g--;
  }
  return aligned.reverse();
}

export function removeSolarLam(word) {
  return word.replace(/^(ا?ل)([تثدذرزسشصضطظلن])/u, '$2');
}

export function hasSolarLam(word) {
  return /^ا?ل[تثدذرزسشصضطظلن]/u.test(word);
}

export function diffWord(refRaw, gotRaw, wordIndex = 0) {
  if (!refRaw) return [];
  if (!gotRaw) gotRaw = '';

  const refHasSolar = hasSolarLam(normalizeArabic(refRaw));
  if (refHasSolar) {
    const gotN = normalizeArabic(gotRaw);
    const refStripped = removeSolarLam(normalizeArabic(refRaw));
    const gotStripped = removeSolarLam(gotN);
    if (refStripped === gotStripped || normalizeArabic(refRaw) === gotStripped) {
      const refCharsDisplay = [...normalizeArabic(refRaw)];
      return refCharsDisplay.map((ch, i) => {
        const isSolarLamPos = i === 1 && ch === 'ل' && SOLAR_LETTERS.has(refCharsDisplay[i+1]);
        if (isSolarLamPos) return { char: ch, status: 'near', cost: 0 };
        return { char: ch, status: 'ok', cost: 0 };
      });
    }
  }

  const refN = normalizeArabic(refRaw);
  const gotN = normalizeArabic(gotRaw);
  if (!refN) return [];

  const silent   = getSilentIndices(refN, refRaw, wordIndex);
  const waslVowel = (wordIndex === 0 &&
    (refRaw[0] === '\u0671' || /^\u0627\u0644/.test(refN))) ? getWaslVowel(refRaw) : null;

  const DIAC = /[\u0640\u0670\u064B-\u065F\u0610-\u061A\u06D6-\u06ED]/;
  const rawSegments = [];
  let seg = '';
  for (const ch of refRaw) {
    if (DIAC.test(ch)) { seg += ch; }
    else { if (seg) rawSegments.push(seg); seg = ch; }
  }
  if (seg) rawSegments.push(seg);
  const STRIP_DISPLAY = /[\u06E0\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0610-\u061A]/g;
  const useRaw = rawSegments.length === refN.length;
  const getDisplay = (i) => useRaw ? (rawSegments[i] || refN[i]).replace(STRIP_DISPLAY,'') : refN[i];

  const phoneticIndices = [];
  const phoneticRefChars = [];
  for (let i = 0; i < refN.length; i++) {
    if (!silent.has(i)) {
      phoneticIndices.push(i);
      phoneticRefChars.push(refN[i]);
    }
  }

  let gotNPhonetic = gotN;
  if (silent.has(refN.length - 1) && gotNPhonetic.endsWith(refN[refN.length - 1])) {
    gotNPhonetic = gotNPhonetic.slice(0, -1);
  }

  const gotChars = [...gotNPhonetic];
  const alignment = levenshteinChars(phoneticRefChars, gotChars);

  const statusMap = new Map();
  let phoneticPtr = 0;
  for (const a of alignment) {
    if (a.op === 'ins') continue;
    const refIdx = phoneticIndices[phoneticPtr++];
    if (refIdx === undefined) break;
    statusMap.set(refIdx, {
      status: a.op === 'match' ? 'ok'   :
              a.op === 'near'  ? 'near' :
              a.op === 'del'   ? 'miss' : 'err',
      cost: a.cost ?? 1
    });
  }

  const result = [];
  for (let i = 0; i < refN.length; i++) {
    const displayChar = getDisplay(i);
    if (silent.has(i)) {
      result.push({ char: displayChar, status: 'silent' });
    } else {
      const sm    = statusMap.get(i) || { status: 'miss', cost: 1 };
      const entry = { char: displayChar, status: sm.status, cost: sm.cost };
      if (i === 0 && waslVowel) entry.waslVowel = waslVowel;
      result.push(entry);
    }
  }
  return result;
}

export function wordEditDist(a, b) {
  const na = normalizeArabic(a), nb = normalizeArabic(b);
  if (na === nb) return 0;
  const R = na.length, G = nb.length;
  if (Math.abs(R - G) > 2) return 99;
  const dp = Array.from({ length: R + 1 }, (_, r) =>
    Array.from({ length: G + 1 }, (_, g) => (r === 0 ? g : g === 0 ? r : 0))
  );
  for (let r = 1; r <= R; r++)
    for (let g = 1; g <= G; g++) {
      dp[r][g] = Math.min(
        dp[r-1][g] + 1, dp[r][g-1] + 1,
        dp[r-1][g-1] + phonoCost(na[r-1], nb[g-1])
      );
    }
  return dp[R][G];
}

export function levenshteinAlign(refWords, userWords) {
  const R = refWords.length, U = userWords.length;
  const dp = Array.from({ length: R + 1 }, (_, r) =>
    Array.from({ length: U + 1 }, (_, u) => (r === 0 ? u : u === 0 ? r : 0))
  );
  for (let r = 1; r <= R; r++) {
    for (let u = 1; u <= U; u++) {
      const dist = wordEditDist(refWords[r-1], userWords[u-1]);
      const eq   = dist <= 1;
      dp[r][u] = Math.min(
        dp[r-1][u]   + 1,
        dp[r][u-1]   + 1,
        dp[r-1][u-1] + (eq ? 0 : 1)
      );
    }
  }
  const aligned = [];
  let r = R, u = U;
  while (r > 0 || u > 0) {
    if (r > 0 && u > 0) {
      const dist = wordEditDist(refWords[r-1], userWords[u-1]);
      const eq   = dist <= 1;
      const diagCost = eq ? 0 : 1;
      const delCost  = 1;
      const insCost  = 1;
      if (dp[r][u] === dp[r-1][u-1] + diagCost &&
          dp[r][u] <  dp[r-1][u]    + delCost  &&
          dp[r][u] <  dp[r][u-1]    + insCost) {
        aligned.push({ ref: refWords[r-1], user: userWords[u-1], op: eq ? 'match' : 'sub' });
        r--; u--; continue;
      }
    }
    if (r > 0 && dp[r][u] === dp[r-1][u] + 1) {
      aligned.push({ ref: refWords[r-1], user: '', op: 'del' });
      r--; continue;
    }
    if (u > 0 && dp[r][u] === dp[r][u-1] + 1) {
      aligned.push({ ref: '', user: userWords[u-1], op: 'ins' });
      u--; continue;
    }
    if (r > 0 && u > 0) {
      const dist = wordEditDist(refWords[r-1], userWords[u-1]);
      const eq   = dist <= 1;
      aligned.push({ ref: refWords[r-1], user: userWords[u-1], op: eq ? 'match' : 'sub' });
      r--; u--;
    } else if (r > 0) {
      aligned.push({ ref: refWords[r-1], user: '', op: 'del' }); r--;
    } else {
      aligned.push({ ref: '', user: userWords[u-1], op: 'ins' }); u--;
    }
  }
  return aligned.reverse();
}

export function compareRecitation(refText, userText) {
  if (!refText || !userText) return { wordResults: [], score: 0 };
  const QURANIC_MARKS = /[\u06D6-\u06ED\u0610-\u061A\u0600-\u0605\u0615]/g;
  const clean = s => s.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ');
  const refWords  = clean(refText).split(' ').map(w => w.replace(QURANIC_MARKS, '')).filter(Boolean);
  const userWords = clean(userText).split(' ').filter(Boolean);

  const aligned = levenshteinAlign(refWords, userWords);
  const PENALTY = { sub: 0.5, del: 1.5, ins: 3 };

  let totalPoints = 0, earnedPoints = 0;
  let refIdx = 0;

  const refWordsNorm = refWords.map(normalizeArabic);
  const insertions = aligned.filter(a => {
    if (a.op !== 'ins') return false;
    const n = normalizeArabic(a.user);
    return !refWordsNorm.includes(n);
  });

  const wordResults = aligned
    .filter(a => a.op !== 'ins')
    .map(a => {
      const wi = refIdx++;
      let chars;
      try {
        chars = diffWord(a.ref, a.user, wi);
      } catch(e) {
        console.error('diffWord error', wi, a.ref, a.user, e);
        chars = [...normalizeArabic(a.ref)].map(c => ({ char: c, status: 'err' }));
      }

      const scored  = chars.filter(c => c.status !== 'silent');
      const okCount = scored.reduce((acc, c) => {
        if (c.status === 'ok' || c.status === 'near') return acc + 1;
        return acc;
      }, 0);
      totalPoints  += scored.length;
      earnedPoints += okCount;

      if (a.op === 'del') {
        totalPoints  += PENALTY.del;
      }

      const wordOk = a.op === 'match';
      return { ref: a.ref, user: a.user, op: a.op, chars, wordOk };
    });

  totalPoints += insertions.length * PENALTY.ins;

  const score = totalPoints > 0 ? Math.max(0, Math.round((earnedPoints / totalPoints) * 100)) : 0;
  return { wordResults, score, insertions };
}

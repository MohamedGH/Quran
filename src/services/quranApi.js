import { BITRATE_FALLBACK_ORDER, TRANS_EDITIONS } from "../utils/quranData";
import { splitArabicWords } from "../utils/arabicUtils";

export const API = "https://api.alquran.cloud/v1";
export const AUDIO_CDN_ROOT = 'https://cdn.islamic.network/quran/audio';

export const IS_ANDROID = typeof window !== 'undefined' && (
  !!window.Capacitor?.isNativePlatform?.() ||
  /Android/i.test(navigator?.userAgent || '')
);

let _recitatorId = (() => { try { return localStorage.getItem('quran_recitator') || 'ar.alafasy'; } catch { return 'ar.alafasy'; } })();
let _officialBitrates = (() => { try { return JSON.parse(localStorage.getItem('quran_official_bitrates')) || {}; } catch { return {}; } })();
let _bitrateByReciter  = (() => { try { return JSON.parse(localStorage.getItem('quran_bitrate_by_reciter')) || {}; } catch { return {}; } })();

export const bitrateOrderFor = (id) => (_officialBitrates[id]?.length ? _officialBitrates[id] : BITRATE_FALLBACK_ORDER);

export const getReciterBitrate = (id) => _bitrateByReciter[id] ?? bitrateOrderFor(id)[0];

export const setReciterBitrate = (id, kbps) => {
  _bitrateByReciter = { ..._bitrateByReciter, [id]: kbps };
  try { localStorage.setItem('quran_bitrate_by_reciter', JSON.stringify(_bitrateByReciter)); } catch {}
};

export const markBitrateBad = (id) => {
  const order = bitrateOrderFor(id);
  const cur   = getReciterBitrate(id);
  const next  = order[order.indexOf(cur) + 1];
  if (next == null) return null;
  setReciterBitrate(id, next);
  return next;
};

export async function fetchOfficialBitrates(id) {
  if (_officialBitrates[id]) return _officialBitrates[id];
  try {
    const r = await fetch(`${API}/ayah/1/${id}`);
    const j = await r.json();
    const urls = [j?.data?.audio, ...(j?.data?.audioSecondary || [])].filter(Boolean);
    const kbps = [...new Set(urls
      .map(u => parseInt((u.match(/\/audio\/(\d+)\//) || [])[1], 10))
      .filter(n => !isNaN(n)))];
    if (!kbps.length) return null;
    kbps.sort((a, b) => (a === 128 ? -1 : b === 128 ? 1 : a - b));
    _officialBitrates = { ..._officialBitrates, [id]: kbps };
    try { localStorage.setItem('quran_official_bitrates', JSON.stringify(_officialBitrates)); } catch {}
    if (!kbps.includes(getReciterBitrate(id))) setReciterBitrate(id, kbps[0]);
    return kbps;
  } catch { return null; }
}

export const getAudioBase = () => `${AUDIO_CDN_ROOT}/${getReciterBitrate(_recitatorId)}/${_recitatorId}`;
export const setGlobalRecitator = (id) => { _recitatorId = id; try { localStorage.setItem('quran_recitator', id); } catch {} };
export const getGlobalRecitator = () => _recitatorId;

// ─── IndexedDB timestamps cache ───────────────────────────────────────────────
const IDB_NAME        = 'quran-ts-cache';
const IDB_STORE       = 'timestamps';
const IDB_QURAN_STORE = 'quran';
export const tsMemCache    = {};
export const quranMemCache = {};
let _tsDbPromise = null;

export function openTsDb() {
  if (!_tsDbPromise) {
    _tsDbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME, 3);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE))       db.createObjectStore(IDB_STORE);
        if (!db.objectStoreNames.contains(IDB_QURAN_STORE)) db.createObjectStore(IDB_QURAN_STORE);
        if (!db.objectStoreNames.contains('audio'))         db.createObjectStore('audio');
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => { _tsDbPromise = null; rej(e.target.error); };
    });
  }
  return _tsDbPromise;
}

export async function idbGetQuran(key) {
  if (quranMemCache[key] !== undefined) return quranMemCache[key];
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_QURAN_STORE, 'readonly');
    const req = tx.objectStore(IDB_QURAN_STORE).get(key);
    req.onsuccess = () => { quranMemCache[key] = req.result ?? null; res(req.result ?? null); };
    req.onerror   = e => rej(e.target.error);
  });
}

export async function idbSetQuran(key, val) {
  quranMemCache[key] = val;
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_QURAN_STORE, 'readwrite');
    tx.objectStore(IDB_QURAN_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

export async function idbGet(key) {
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e.target.error);
  });
}

export async function idbSet(key, val) {
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

export async function fetchSurahs() {
  const idbKey = 'surahs';
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah`);
  const data = (await r.json()).data;
  idbSetQuran(idbKey, data).catch(() => {});
  return data;
}

export async function fetchSurahTranslation(sn, lang) {
  const edition = TRANS_EDITIONS[lang];
  if (!edition) return [];
  const idbKey = `trans:${lang}:${sn}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${sn}/${edition}`);
  const ayahs = (await r.json()).data?.ayahs || [];
  const result = ayahs.map(a => ({ numberInSurah: a.numberInSurah, text: a.text }));
  idbSetQuran(idbKey, result).catch(() => {});
  return result;
}

export async function fetchAyats(n) {
  const idbKey = `alafasy:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${n}/ar.alafasy`);
  const data = (await r.json()).data;
  idbSetQuran(idbKey, data).catch(() => {});
  return data;
}

export async function fetchSurahSimple(n) {
  const idbKey = `text:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${n}/quran-simple`);
  const data = (await r.json()).data?.ayahs || [];
  const ayats = data.map(a => ({ num: a.numberInSurah, text: a.text }));
  idbSetQuran(idbKey, ayats).catch(() => {});
  return ayats;
}

export async function fetchSurahDefault(n) {
  const idbKey = `simple:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${n}`);
  const ayahs = (await r.json()).data?.ayahs || [];
  idbSetQuran(idbKey, ayahs).catch(() => {});
  return ayahs;
}

export async function fetchSurahMeta(n) {
  const idbKey = `smeta:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const ayahs = await fetchSurahDefault(n);
  const a1 = ayahs[0] || {};
  const wordCount = ayahs.reduce((s, a) => s + splitArabicWords(a.text || '').length, 0);
  const meta = {
    hizb:      a1.hizbQuarter != null ? Math.ceil(a1.hizbQuarter / 4) : null,
    juz:       a1.juz  ?? null,
    page:      a1.page ?? null,
    wordCount,
  };
  idbSetQuran(idbKey, meta).catch(() => {});
  return meta;
}

export async function fetchAyahMeta(sn, an) {
  const ayahs = await fetchSurahDefault(sn);
  return ayahs.find(a => a.numberInSurah === an) || null;
}

export async function fetchQuranPage(pageNum) {
  const key = `mushaf_page:${pageNum}`;
  try { const c = await idbGetQuran(key); if (c) return c; } catch {}
  const r = await fetch(`${API}/page/${pageNum}/quran-uthmani`);
  const ayahs = (await r.json()).data?.ayahs || [];
  idbSetQuran(key, ayahs).catch(() => {});
  return ayahs;
}

export async function fetchPageMeta(pageNum) {
  const idbKey = `pmeta:${pageNum}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const ayahs = await fetchQuranPage(pageNum);
  const a1 = ayahs[0] || {};
  const wordCount = ayahs.reduce((s, a) => s + splitArabicWords(a.text || '').length, 0);
  const meta = {
    hizb:      a1.hizbQuarter != null ? Math.ceil(a1.hizbQuarter / 4) : null,
    juz:       a1.juz  ?? null,
    ayatCount: ayahs.length,
    wordCount,
  };
  idbSetQuran(idbKey, meta).catch(() => {});
  return meta;
}

export function _stripBasmalaWords(words, sn) {
  if (!words || words.length <= 4 || sn === 1 || sn === 9) return words;
  const stripD = s => s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');
  const firstWord = words[0]?.chars?.map(c => c.char).join('') || '';
  if (stripD(firstWord).startsWith('بسم')) return words.slice(4);
  return words;
}

export function parseTimestampsFile(data, surahNum, keyPrefix) {
  const result = {};
  const pfx = keyPrefix ? `${keyPrefix}:` : '';
  const addEntry = (sn, ayatNum, words) => {
    const processedWords = ayatNum === 1 ? _stripBasmalaWords(words, sn) : words;
    result[`${pfx}${sn}:${ayatNum}`] = { words: processedWords };
  };
  if (Array.isArray(data)) {
    data.forEach(item => { if (item.ayat && item.words) addEntry(item.surah || surahNum, item.ayat, item.words); });
  } else if (data.ayat && data.words) {
    addEntry(data.surah || surahNum, data.ayat, data.words);
  }
  return result;
}

const TS_SERVER_BASE   = 'http://localhost:3000/sourate';
const TS_ANDROID_BASE  = 'public/assets/timestamps';

export async function loadTimestampsForSurah(surahNum, recitatorId = 'ar.alafasy') {
  const memKey = `${recitatorId}:${surahNum}`;
  if (tsMemCache[memKey]) return tsMemCache[memKey];
  const cacheKey = `ts:${recitatorId}:${surahNum}`;
  const file     = `surah_${String(surahNum).padStart(3,'0')}.json`;

  if (IS_ANDROID) {
    const url = `${TS_ANDROID_BASE}/${recitatorId}/${file}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const data = await r.json();
      const parsed = parseTimestampsFile(data, surahNum, recitatorId);
      if (parsed) tsMemCache[memKey] = parsed;
      return parsed;
    } catch { return null; }
  }

  try {
    const cached = await idbGet(cacheKey);
    if (cached) { tsMemCache[memKey] = cached; return cached; }
  } catch {}

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${TS_SERVER_BASE}/${recitatorId}/${file}`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const data   = await r.json();
    const parsed = parseTimestampsFile(data, surahNum, recitatorId);
    if (Object.keys(parsed).length > 0) {
      tsMemCache[memKey] = parsed;
      idbSet(cacheKey, parsed).catch(() => {});
    }
    return parsed;
  } catch { return null; }
}

export function fixChars(chars) {
  if (!chars?.length) return [];
  const isDiac = ch => /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/.test(ch);

  // Group standalone diacritics with preceding base character if present
  const merged = [];
  for (let i = 0; i < chars.length; i++) {
    let curr = { ...chars[i] };
    while (i + 1 < chars.length && isDiac(chars[i + 1].char)) {
      i++;
      curr.char += chars[i].char;
      curr.end = Math.max(curr.end, chars[i].end);
    }
    merged.push(curr);
  }

  const wordEnd = merged[merged.length - 1].end;
  return merged.map((c, ci) => {
    if (c.start === c.end) {
      const nextReal = merged.slice(ci + 1).find(x => x.end > c.start);
      return { ...c, end: nextReal ? nextReal.start : wordEnd };
    }
    return c;
  });
}

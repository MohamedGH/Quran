import React, { useState, useEffect, useRef } from "react";
import { SUGGESTED_SEARCHES } from "../../utils/quranData";
import { highlightArabic, normalizeArabic, stripDiacritics } from "../../utils/arabicUtils";
import { fetchSurahDefault } from "../../services/quranApi";

export function ConcordInlinePlayer({ audioUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const toggle = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  };

  return (
    <>
      <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} style={{ display: "none" }} />
      <button
        onClick={toggle}
        style={{
          width: 26, height: 26, borderRadius: "50%",
          border: `1px solid ${playing ? "var(--gold)" : "var(--border2)"}`,
          background: playing ? "rgba(201,168,76,.15)" : "transparent",
          color: playing ? "var(--gold2)" : "var(--text3)",
          fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0, transition: "all .15s",
        }}
      >
        {playing ? "⏸" : "▶"}
      </button>
    </>
  );
}

export function ConcordGroup({ group, debouncedQ, onNavigate, isLinked, toggleLink, textCache, onOpenCollModal, ayatInCollectionsFn }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="concord-group">
      <div className="concord-group-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="concord-group-num">{group.surahNum}</div>
        <div className="concord-group-name">{group.surahEn}</div>
        <div className="concord-group-ar">{group.surahAr}</div>
        <div className="concord-group-badge">{group.matches.length} verset{group.matches.length > 1 ? "s" : ""}</div>
        <div className={`concord-group-chevron${isOpen ? " open" : ""}`}>▶</div>
      </div>

      {isOpen && (
        <div>
          {group.matches.map(m => {
            const padS = String(group.surahNum).padStart(3, "0");
            const padA = String(m.num).padStart(3, "0");
            const audioUrl = `https://everyayah.com/data/Alafasy_128kbps/${padS}${padA}.mp3`;
            const linked = isLinked(group.surahNum, m.num);

            return (
              <div key={m.num} className="concord-ayat-item" onClick={() => onNavigate(group.surahNum, m.num)}>
                <div className="concord-ayat-num">{m.num}</div>
                <div className="concord-ayat-text">
                  {highlightArabic(m.text, debouncedQ)}
                </div>
                <div className="concord-ayat-actions" onClick={e => e.stopPropagation()}>
                  <ConcordInlinePlayer audioUrl={audioUrl} />
                  <button
                    className={`concord-link-btn${linked ? " linked" : ""}`}
                    onClick={() => toggleLink(group.surahNum, m.num, m.text)}
                  >
                    {linked ? "✓ LIÉ" : "🔗 LIER"}
                  </button>
                  <button className="concord-go-btn" onClick={() => onNavigate(group.surahNum, m.num)}>
                    VOIR ▶
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SharedGroup({ group, sharedN, searchMode, onNavigate, toggleLink, isLinked, onOpenCollModal }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="concord-group">
      <div className="concord-group-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="concord-group-num">{group.surahNum}</div>
        <div className="concord-group-name">{group.surahEn}</div>
        <div className="concord-group-ar">{group.surahAr}</div>
        <div className="concord-group-badge">{group.ayats.length} verset{group.ayats.length > 1 ? "s" : ""}</div>
        <div className={`concord-group-chevron${isOpen ? " open" : ""}`}>▶</div>
      </div>

      {isOpen && (
        <div>
          {group.ayats.map(a => {
            const padS = String(group.surahNum).padStart(3, "0");
            const padA = String(a.num).padStart(3, "0");
            const audioUrl = `https://everyayah.com/data/Alafasy_128kbps/${padS}${padA}.mp3`;
            const linked = isLinked(group.surahNum, a.num);

            return (
              <div key={a.num} className="concord-ayat-item" onClick={() => onNavigate(group.surahNum, a.num)}>
                <div className="concord-ayat-num">{a.num}</div>
                <div className="concord-ayat-text">
                  {highlightArabic(a.text, sharedN)}
                </div>
                <div className="concord-ayat-actions" onClick={e => e.stopPropagation()}>
                  <ConcordInlinePlayer audioUrl={audioUrl} />
                  <button
                    className={`concord-link-btn${linked ? " linked" : ""}`}
                    onClick={() => toggleLink(group.surahNum, a.num, a.text)}
                  >
                    {linked ? "✓ LIÉ" : "🔗 LIER"}
                  </button>
                  <button className="concord-go-btn" onClick={() => onNavigate(group.surahNum, a.num)}>
                    VOIR ▶
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ConcordancePage({
  surahs: surahList = [],
  onNavigate,
  collections = [],
  onOpenCollModal,
  ayatInCollectionsFn,
  initialQuery = "",
}) {
  const [query,          setQuery]          = useState(initialQuery || "");
  const [debouncedQ,     setDebouncedQ]     = useState(initialQuery || "");
  const [selectedSurah,  setSelectedSurah]  = useState("all");
  const [searchMode,     setSearchMode]     = useState("contains"); // "contains" | "exact" | "root"
  const [loading,        setLoading]        = useState(false);
  const [results,        setResults]        = useState([]);
  const [totalMatches,   setTotalMatches]   = useState(0);
  const [linkedAyats,    setLinkedAyats]    = useState(() => {
    try { return JSON.parse(localStorage.getItem("quran_concordance_links")) || []; } catch { return []; }
  });
  const [activeTab,      setActiveTab]      = useState("search"); // "search" | "links"
  const [sharedGroups,   setSharedGroups]   = useState([]);
  const [textCache,      setTextCache]      = useState({});

  useEffect(() => {
    const tid = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(tid);
  }, [query]);

  useEffect(() => {
    if (!debouncedQ.trim()) {
      setResults([]);
      setTotalMatches(0);
      setSharedGroups([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const runSearch = async () => {
      const qNorm = stripDiacritics(debouncedQ.trim());
      if (!qNorm) { setLoading(false); return; }

      const surahsToSearch = selectedSurah === "all"
        ? surahList
        : surahList.filter(s => String(s.number) === String(selectedSurah));

      const groups = [];
      let total = 0;

      for (const surah of surahsToSearch) {
        if (cancelled) return;
        try {
          let ayats = textCache[surah.number];
          if (!ayats) {
            ayats = await fetchSurahDefault(surah.number);
            setTextCache(prev => ({ ...prev, [surah.number]: ayats }));
          }

          const matches = [];
          for (const a of ayats) {
            const aText = a.text || "";
            const aNorm = stripDiacritics(aText);

            let hit = false;
            if (searchMode === "contains") {
              hit = aNorm.includes(qNorm);
            } else if (searchMode === "exact") {
              const words = aNorm.split(/\s+/);
              hit = words.some(w => w === qNorm);
            } else if (searchMode === "root") {
              hit = aNorm.includes(qNorm.slice(0, 3));
            }

            if (hit) {
              matches.push({ num: a.numberInSurah, text: aText });
              total++;
            }
          }

          if (matches.length > 0) {
            groups.push({
              surahNum: surah.number,
              surahEn: surah.englishName,
              surahAr: surah.name,
              matches,
            });
          }
        } catch (err) {
          console.error("[ConcordancePage]", err);
        }
      }

      if (!cancelled) {
        setResults(groups);
        setTotalMatches(total);
        setLoading(false);
      }
    };

    runSearch();
    return () => { cancelled = true; };
  }, [debouncedQ, selectedSurah, searchMode, surahList]);

  const toggleLink = (surahNum, ayatNum, text) => {
    setLinkedAyats(prev => {
      const exists = prev.some(l => l.surahNum === surahNum && l.ayatNum === ayatNum);
      let next;
      if (exists) {
        next = prev.filter(l => !(l.surahNum === surahNum && l.ayatNum === ayatNum));
      } else {
        const surah = surahList.find(s => s.number === surahNum);
        next = [...prev, {
          surahNum,
          ayatNum,
          text,
          surahEn: surah?.englishName || `Sourate ${surahNum}`,
          surahAr: surah?.name || "",
        }];
      }
      try { localStorage.setItem("quran_concordance_links", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const isLinked = (surahNum, ayatNum) => {
    return linkedAyats.some(l => l.surahNum === surahNum && l.ayatNum === ayatNum);
  };

  return (
    <div className="concord-page page-anim">
      <div className="concord-search-bar">
        <input
          type="text"
          placeholder="Rechercher un mot, racine ou expression dans le Coran…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button className="btn-small" onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>

      <div className="concord-filter-row">
        <span className="concord-filter-label">SOURATE :</span>
        <select
          className="concord-surah-select"
          value={selectedSurah}
          onChange={e => setSelectedSurah(e.target.value)}
        >
          <option value="all">Toutes les sourates (114)</option>
          {surahList.map(s => (
            <option key={s.number} value={s.number}>
              {s.number}. {s.englishName} ({s.name})
            </option>
          ))}
        </select>

        <span className="concord-filter-label" style={{ marginLeft: 8 }}>MODE :</span>
        <div className="concord-mode-tabs">
          <button
            className={`concord-mode-tab${searchMode === "contains" ? " active" : ""}`}
            onClick={() => setSearchMode("contains")}
          >
            Contient
          </button>
          <button
            className={`concord-mode-tab${searchMode === "exact" ? " active" : ""}`}
            onClick={() => setSearchMode("exact")}
          >
            Mot exact
          </button>
          <button
            className={`concord-mode-tab${searchMode === "root" ? " active" : ""}`}
            onClick={() => setSearchMode("root")}
          >
            Racine
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            className={`btn-small${activeTab === "search" ? " done" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            🔍 RÉSULTATS ({totalMatches})
          </button>
          <button
            className={`btn-small${activeTab === "links" ? " done" : ""}`}
            onClick={() => setActiveTab("links")}
          >
            🔗 VERSETS LIÉS ({linkedAyats.length})
          </button>
        </div>
      </div>

      <div className="concord-tags-row">
        <span style={{ fontSize: 8, letterSpacing: 1, color: "var(--text3)", fontFamily: "'Cinzel',serif", alignSelf: "center" }}>
          SUGGESTIONS :
        </span>
        {SUGGESTED_SEARCHES.map(s => (
          <div key={s.label} className="concord-tag" onClick={() => setQuery(s.query)}>
            <span>{s.label}</span>
            <span style={{ fontFamily: "'Amiri Quran',serif", fontSize: 13, color: "var(--gold)" }}>{s.query}</span>
          </div>
        ))}
      </div>

      {activeTab === "search" && (
        <div>
          {loading ? (
            <div className="concord-loading">
              <div className="loading-ring" />
              <span>Recherche dans le Coran en cours…</span>
            </div>
          ) : debouncedQ.trim() && results.length === 0 ? (
            <div className="concord-empty">
              <div className="concord-empty-arabic">لا نتائج</div>
              <div className="concord-empty-msg">
                AUCUN VERSET TROUVÉ POUR "{debouncedQ}"<br />
                Essayez un autre mot, une racine à 3 lettres ou modifiez le mode de recherche.
              </div>
            </div>
          ) : results.length > 0 ? (
            <div>
              <div className="concord-results-header" style={{ marginBottom: 12 }}>
                <div className="concord-results-count">
                  <span>{totalMatches}</span> occurrence{totalMatches > 1 ? "s" : ""} trouvée{totalMatches > 1 ? "s" : ""} dans <span>{results.length}</span> sourate{results.length > 1 ? "s" : ""}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {results.map(g => (
                  <ConcordGroup
                    key={g.surahNum}
                    group={g}
                    debouncedQ={debouncedQ}
                    onNavigate={onNavigate}
                    isLinked={isLinked}
                    toggleLink={toggleLink}
                    textCache={textCache}
                    onOpenCollModal={onOpenCollModal}
                    ayatInCollectionsFn={ayatInCollectionsFn}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="concord-empty">
              <div className="concord-empty-arabic">البحث</div>
              <div className="concord-empty-msg">
                RECHERCHEZ DES MOTS OU PARTIES D'AYATS<br />
                PUIS LIEZ LES VERSETS QUI PARTAGENT UN THÈME
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "links" && (
        <div className="concord-links-panel">
          <div className="concord-links-title">
            <span>🔗 VERSETS LIÉS / THÉMATIQUES ({linkedAyats.length})</span>
          </div>

          {linkedAyats.length === 0 ? (
            <div className="concord-empty">
              <div className="concord-empty-msg">
                AUCUN VERSET LIÉ POUR LE MOMENT<br />
                Pendant vos recherches, cliquez sur "🔗 LIER" pour sauvegarder des versets à réviser ensemble.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {linkedAyats.map(l => (
                <div key={`${l.surahNum}:${l.ayatNum}`} className="concord-link-card" onClick={() => onNavigate(l.surahNum, l.ayatNum)}>
                  <div className="concord-link-ref">
                    S.{l.surahNum} V.{l.ayatNum}
                  </div>
                  <div className="concord-link-text">
                    {l.text}
                  </div>
                  <button
                    className="concord-link-remove"
                    onClick={e => { e.stopPropagation(); toggleLink(l.surahNum, l.ayatNum, l.text); }}
                    title="Retirer le lien"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

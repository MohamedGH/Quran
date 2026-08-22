import React, { useState } from "react";

export default function LearningMapPage({ surahs = [], learnData = {}, onNavigate }) {
  const [filter, setFilter] = useState("all"); // "all" | "learned" | "in_progress" | "not_started"

  const surahList = surahs.map(s => {
    const sData = learnData[s.number] || {};
    const ayatsCount = s.numberOfAyahs || 1;
    const learnedCount = Object.values(sData).filter(a => a.learned).length;
    const pct = Math.round((learnedCount / ayatsCount) * 100);
    const status = learnedCount === ayatsCount ? "learned" : learnedCount > 0 ? "in_progress" : "not_started";
    return { ...s, learnedCount, pct, status };
  });

  const filteredSurahs = surahList.filter(s => {
    if (filter === "learned") return s.status === "learned";
    if (filter === "in_progress") return s.status === "in_progress";
    if (filter === "not_started") return s.status === "not_started";
    return true;
  });

  const totalLearnedSurahs = surahList.filter(s => s.status === "learned").length;
  const totalInProgress    = surahList.filter(s => s.status === "in_progress").length;

  return (
    <div className="rev-page page-anim">
      <div className="rev-header-block">
        <div>
          <div className="rev-title">🗺 CARTE DE MÉMORISATION</div>
          <div className="rev-subtitle">VUE D'ENSEMBLE DES 114 SOURATES DU CORAN</div>
        </div>

        <div className="rev-stats-row">
          <div className="rev-stat-pill">
            <div className="rev-stat-num">{totalLearnedSurahs}</div>
            <div className="rev-stat-label">COMPLÈTES</div>
          </div>
          <div className="rev-stat-pill">
            <div className="rev-stat-num">{totalInProgress}</div>
            <div className="rev-stat-label">EN COURS</div>
          </div>
          <div className="rev-stat-pill">
            <div className="rev-stat-num">{114 - totalLearnedSurahs - totalInProgress}</div>
            <div className="rev-stat-label">À DÉBUTER</div>
          </div>
        </div>
      </div>

      <div className="rev-filter-row">
        <button
          className={`rev-filter-btn${filter === "all" ? " active" : ""}`}
          onClick={() => setFilter("all")}
        >
          TOUTES (114)
        </button>
        <button
          className={`rev-filter-btn${filter === "learned" ? " active" : ""}`}
          onClick={() => setFilter("learned")}
        >
          COMPLÈTES ({totalLearnedSurahs})
        </button>
        <button
          className={`rev-filter-btn${filter === "in_progress" ? " active" : ""}`}
          onClick={() => setFilter("in_progress")}
        >
          EN COURS ({totalInProgress})
        </button>
        <button
          className={`rev-filter-btn${filter === "not_started" ? " active" : ""}`}
          onClick={() => setFilter("not_started")}
        >
          À DÉBUTER ({114 - totalLearnedSurahs - totalInProgress})
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {filteredSurahs.map(s => (
          <div
            key={s.number}
            className="rev-surah-block"
            onClick={() => onNavigate?.(s.number, 1)}
            style={{ cursor: "pointer" }}
          >
            <div className="rev-surah-header">
              <div className="rev-surah-num">{s.number}</div>
              <div className="rev-surah-name">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text)" }}>{s.englishName}</span>
                  <span className="rev-surah-name-ar">{s.name}</span>
                </div>
                <div className="rev-surah-name-en">
                  {s.numberOfAyahs} versets · {s.revelationType === "Meccan" ? "Mecquoise" : "Médinoise"}
                </div>
              </div>
            </div>

            <div style={{ padding: "0 16px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--text3)", marginBottom: 4, fontFamily: "'Cinzel',serif" }}>
                <span>PROGRESSION</span>
                <span>{s.learnedCount}/{s.numberOfAyahs} ({s.pct}%)</span>
              </div>
              <div className="rev-progress-bar">
                <div
                  className="rev-progress-fill"
                  style={{
                    width: `${s.pct}%`,
                    background: s.pct === 100 ? "var(--green)" : s.pct > 0 ? "var(--teal)" : "var(--border2)",
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

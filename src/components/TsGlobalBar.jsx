import React from "react";
import { RECITATORS } from "../utils/quranData";

export default function TsGlobalBar({
  showTsBar,
  recitatorId,
  ayatsCount = 0,
  loadedCount = 0,
  timestampsMap = {},
  onClearTimestamps,
  onFilesSelected,
}) {
  if (!showTsBar) return null;

  const activeReciter = RECITATORS.find(r => r.id === recitatorId);

  return (
    <div className="ts-global-bar">
      <span style={{ fontSize: 8, letterSpacing: 1, color: "var(--text3)", fontFamily: "'Cinzel',serif", marginRight: 4 }}>
        {activeReciter?.flag} {activeReciter?.label?.toUpperCase()}
      </span>
      <div className="ts-progress-bar">
        <div className="ts-progress-fill" style={{ width: `${ayatsCount ? (loadedCount / ayatsCount) * 100 : 0}%` }} />
      </div>
      <label className="ts-drop-zone">
        <input type="file" accept=".json" multiple onChange={e => onFilesSelected?.([...e.target.files])} />
        <span className="ts-drop-label">📂 CHARGER JSON(S)</span>
      </label>
      {loadedCount > 0 && (
        <button
          className="btn-small"
          style={{ color: "var(--red)", borderColor: "var(--red)" }}
          title={`Effacer les timestamps de ${activeReciter?.label || recitatorId}`}
          onClick={onClearTimestamps}
        >
          ✕
        </button>
      )}
    </div>
  );
}

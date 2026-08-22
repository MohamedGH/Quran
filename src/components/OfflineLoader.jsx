import React, { useState } from "react";
import { openTsDb, API } from "../services/quranApi";

export default function OfflineLoader() {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress]       = useState(0);
  const [log, setLog]                 = useState([]);

  const addLog = msg => setLog(p => [msg, ...p.slice(0, 19)]);

  const downloadAll = async () => {
    setDownloading(true);
    setProgress(0);
    setLog([]);
    addLog("Début du téléchargement du Coran complet pour usage hors ligne...");

    try {
      const db = await openTsDb();
      const tx = db.transaction("quran", "readwrite");
      const store = tx.objectStore("quran");

      const r = await fetch(`${API}/quran/quran-uthmani`);
      const data = (await r.json()).data;
      if (data && data.surahs) {
        addLog(`Téléchargé ${data.surahs.length} sourates du Coran`);
        store.put(data.surahs, "all_surahs_uthmani");
      }

      for (let s = 1; s <= 114; s++) {
        const sr = await fetch(`${API}/surah/${s}/ar.alafasy`);
        const sdata = (await sr.json()).data;
        if (sdata) {
          store.put(sdata, `alafasy:${s}`);
        }
        setProgress(Math.round((s / 114) * 100));
        if (s % 10 === 0) addLog(`Sauvegardé sourate ${s}/114 dans le cache local`);
      }

      addLog("✓ Téléchargement complet terminé ! Toutes les sourates sont disponibles hors ligne.");
    } catch (err) {
      console.error("[OfflineLoader]", err);
      addLog(`❌ Erreur : ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border)",
      borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        📥 TÉLÉCHARGEMENT HORS LIGNE
      </div>
      <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
        Téléchargez le texte arabe complet et les métadonnées de toutes les 114 sourates dans la base de données locale (IndexedDB) pour pouvoir réviser même sans connexion internet.
      </div>

      {downloading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--teal2)", fontFamily: "'Cinzel',serif" }}>
            <span>PROGRESSION</span>
            <span>{progress}%</span>
          </div>
          <div style={{ height: 6, background: "var(--surface3)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, var(--gold), var(--teal))", transition: "width .2s" }} />
          </div>
        </div>
      )}

      <button
        onClick={downloadAll}
        disabled={downloading}
        className="btn-primary"
        style={{ alignSelf: "flex-start", padding: "10px 18px" }}
      >
        {downloading ? "TÉLÉCHARGEMENT EN COURS…" : "⬇ TÉLÉCHARGER TOUTES LES SOURATES"}
      </button>

      {log.length > 0 && (
        <div style={{
          background: "var(--surface3)", border: "1px solid var(--border2)", borderRadius: 8,
          padding: 10, maxHeight: 120, overflowY: "auto", fontFamily: "monospace", fontSize: 9,
          display: "flex", flexDirection: "column", gap: 3, color: "var(--text2)",
        }}>
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

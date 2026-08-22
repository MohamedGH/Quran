import React, { useState } from "react";
import ArabicHighlighted from "../ArabicHighlighted";
import "./CollectionsPage.css";

export function AyatCollectionsTab({ surahNum, ayatNum, collections = [], ayatInCollections = [], onOpenModal }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: "var(--text3)", fontFamily: "'Cinzel',serif" }}>
          🗂 COLLECTIONS ({ayatInCollections.length})
        </span>
        <button className="btn-primary" onClick={onOpenModal}>
          + GÉRER
        </button>
      </div>

      {ayatInCollections.length === 0 ? (
        <div style={{ fontSize: 9, color: "var(--text3)", fontStyle: "italic" }}>
          Ce verset n'appartient à aucune collection. Cliquez sur "+ GÉRER" pour l'ajouter.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ayatInCollections.map(coll => (
            <div key={coll.id} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
              borderRadius: 20, background: "rgba(200,120,255,.12)", border: "1px solid rgba(200,120,255,.3)",
              color: "#c878ff", fontSize: 9, fontFamily: "'Cinzel',serif", letterSpacing: 1,
            }}>
              <span>{coll.icon || "📂"}</span>
              <span>{coll.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectionModal({ ayat, collections = [], onToggle, onCreateAndAdd, onClose }) {
  const [newCollName, setNewCollName] = useState("");

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newCollName.trim()) return;
    onCreateAndAdd(newCollName.trim());
    setNewCollName("");
  };

  return (
    <div className="coll-modal-overlay" onClick={onClose}>
      <div className="coll-modal" onClick={e => e.stopPropagation()}>
        <div className="coll-modal-title">🗂 AJOUTER À UNE COLLECTION</div>

        {ayat && (
          <div className="coll-modal-subtitle">
            Sourate {ayat.surahNum || ayat.surah?.number}, Verset {ayat.numberInSurah}
          </div>
        )}

        <div className="coll-modal-list">
          {collections.map(coll => {
            const hasIt = (coll.items || []).some(
              it => it.surahNum === (ayat.surahNum || ayat.surah?.number) && it.ayatNum === ayat.numberInSurah
            );
            return (
              <div
                key={coll.id}
                className={`coll-modal-item${hasIt ? " selected" : ""}`}
                onClick={() => onToggle(coll.id)}
              >
                <div className="coll-modal-check">{hasIt ? "✓" : ""}</div>
                <div className="coll-modal-item-name">{coll.icon || "📂"} {coll.name}</div>
                <div className="coll-modal-item-count">{coll.items?.length || 0} versets</div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleCreate} className="coll-modal-new">
          <input
            type="text"
            className="coll-input"
            placeholder="Nouvelle collection…"
            value={newCollName}
            onChange={e => setNewCollName(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!newCollName.trim()}>
            + CRÉER
          </button>
        </form>

        <div className="coll-modal-actions">
          <button className="btn-small" onClick={onClose}>FERMER</button>
        </div>
      </div>
    </div>
  );
}

export function CollectionAyatRow({ entry, collId, learnData, setLData, onToggleAyat, onOpenCollModal, ayatInCollectionsFn, collections, showQalqala, showMadd, showIzhar, showIdgham }) {
  return (
    <div className="coll-ayat-row">
      <div className="coll-ayat-ref">
        <div className="coll-ayat-surah">S.{entry.surahNum}</div>
        <div className="coll-ayat-num">{entry.ayatNum}</div>
      </div>

      <div className="coll-ayat-text">
        <ArabicHighlighted
          text={entry.text}
          timestamps={entry.timestamps}
          showQalqala={showQalqala}
          showMadd={showMadd}
          showIzhar={showIzhar}
          showIdgham={showIdgham}
        />
      </div>

      <div className="coll-ayat-btns">
        <button
          className="btn-small"
          style={{ color: "var(--red)", borderColor: "var(--red)" }}
          onClick={() => onToggleAyat(collId, entry.surahNum, entry.ayatNum)}
          title="Retirer de cette collection"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function CollectionsPage({
  collections = [],
  learnData,
  setLData,
  onCreateCollection,
  onDeleteCollection,
  onToggleAyat,
  onOpenCollModal,
  ayatInCollectionsFn,
  surahs,
  onNavigate,
  showQalqala,
  showMadd,
  showIzhar,
  showIdgham,
  initialSearchQuery,
  onConsumeSearchQuery,
}) {
  const [newCollName, setNewCollName] = useState("");
  const [openColls,   setOpenColls]   = useState({});
  const [searchQ,     setSearchQ]     = useState(initialSearchQuery || "");

  const toggleOpen = (id) => setOpenColls(p => ({ ...p, [id]: !p[id] }));

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newCollName.trim()) return;
    onCreateCollection?.(newCollName.trim());
    setNewCollName("");
  };

  const filteredCollections = collections.filter(c => {
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    if (c.name.toLowerCase().includes(q)) return true;
    return (c.items || []).some(it => String(it.surahNum) === q || String(it.ayatNum) === q || (it.text || "").includes(q));
  });

  return (
    <div className="collections-page page-anim">
      <div className="coll-top-bar">
        <form onSubmit={handleCreate} className="coll-create-form">
          <input
            type="text"
            className="coll-input"
            placeholder="Nom de la nouvelle collection…"
            value={newCollName}
            onChange={e => setNewCollName(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!newCollName.trim()}>
            + CRÉER
          </button>
        </form>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 200 }}>
          <input
            type="text"
            className="coll-search-input"
            placeholder="Rechercher dans les collections…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          {searchQ && (
            <button className="btn-small" onClick={() => setSearchQ("")}>
              ✕
            </button>
          )}
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="coll-empty">
          <div className="coll-empty-arabic">المجموعات</div>
          <div className="coll-empty-msg">
            AUCUNE COLLECTION POUR LE MOMENT<br />
            Créez une collection ci-dessus pour y regrouper vos versets favoris.
          </div>
        </div>
      ) : (
        <div className="coll-list">
          {filteredCollections.map(coll => {
            const isOpen = !!openColls[coll.id];
            const count  = coll.items?.length || 0;

            return (
              <div key={coll.id} className="coll-card">
                <div className="coll-card-header" onClick={() => toggleOpen(coll.id)}>
                  <div className="coll-card-icon">{coll.icon || "📂"}</div>
                  <div className="coll-card-name">{coll.name}</div>
                  <div className="coll-card-count">{count} verset{count > 1 ? "s" : ""}</div>
                  <div className={`coll-card-chevron${isOpen ? " open" : ""}`}>▶</div>
                  <div className="coll-card-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="btn-small"
                      style={{ color: "var(--red)", borderColor: "var(--red)" }}
                      onClick={() => onDeleteCollection?.(coll.id)}
                      title="Supprimer la collection"
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="coll-ayat-list">
                    {count === 0 ? (
                      <div style={{ padding: 16, fontSize: 9, color: "var(--text3)", fontStyle: "italic", textAlign: "center" }}>
                        Cette collection est vide. Ajoutez des versets depuis l'onglet CORAN.
                      </div>
                    ) : (
                      coll.items.map(it => (
                        <CollectionAyatRow
                          key={`${it.surahNum}:${it.ayatNum}`}
                          entry={it}
                          collId={coll.id}
                          learnData={learnData}
                          setLData={setLData}
                          onToggleAyat={onToggleAyat}
                          onOpenCollModal={onOpenCollModal}
                          ayatInCollectionsFn={ayatInCollectionsFn}
                          collections={collections}
                          showQalqala={showQalqala}
                          showMadd={showMadd}
                          showIzhar={showIzhar}
                          showIdgham={showIdgham}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

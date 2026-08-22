import React, { useState, useEffect, useRef, useCallback } from "react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Provider, useSelector, useDispatch, shallowEqual } from "react-redux";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { firebaseAuth } from "./services/firebase";
import "./App.css";

import {
  store, sel, uiActions, quranActions, playerActions,
  learnActions, collectionsActions, setLDataThunk
} from "./store";

import { SURAH_NAMES, RECITATORS } from "./utils/quranData";

import {
  getReciterBitrate, getAudioBase, setGlobalRecitator, getGlobalRecitator,
  fetchSurahs, fetchAyats, loadTimestampsForSurah
} from "./services/quranApi";

import { normalizeAr, parseVoiceCommand } from "./utils/arabicUtils";

import Header from "./components/Header";
import OptionsModal from "./components/OptionsModal";
import ArabicKeyboard, { ArabicKeyboardContext } from "./components/ArabicKeyboard";
import RappelWidget from "./components/RappelWidget";
import LoginScreen from "./components/LoginScreen";
import SyncConsole from "./components/SyncConsole";
import CloudSyncManager from "./components/CloudSyncManager";
import ArabicHighlighted from "./components/ArabicHighlighted";
import Submenu from "./components/Submenu";

import DashboardPage from "./components/pages/DashboardPage";
import PrononciationPage from "./components/pages/PrononciationPage";
import CollectionsPage from "./components/pages/CollectionsPage";
import ConcordancePage from "./components/pages/ConcordancePage";
import LearningMapPage from "./components/pages/LearningMapPage";
import RevisionPage from "./components/pages/RevisionPage";
import QuestionsModePage from "./components/pages/QuestionsModePage";
import MemoriseMode from "./components/pages/MemoriseMode";
import QuranBookPage from "./components/pages/QuranBookPage";
import QuranBook3DPage from "./components/pages/QuranBook3DPage";

// ─── MAIN APP (inner — wrapped by Provider below) ─────────────────────────────
function AppInner({ currentUser, onSignOut }) {
  const dispatch = useDispatch();

  const surahs          = useSelector(sel.surahs);
  const selectedSurah   = useSelector(sel.selectedSurah);
  const ayats           = useSelector(sel.ayats);
  const search          = useSelector(sel.search);
  const openAyatNum     = useSelector(sel.openAyatNum);
  const submenuMode     = useSelector(sel.submenuMode);
  const lastAyatBySurah = useSelector(sel.lastAyatBySurah, shallowEqual);
  const learnData       = useSelector(sel.learnData, shallowEqual);
  const collections     = useSelector(sel.collections, shallowEqual);

  const sidebarOpen     = useSelector(sel.sidebarOpen);
  const location        = useLocation();
  const navigate        = useNavigate();
  const [selMenu, setSelMenu] = useState(null);
  const [pendingSearchQuery, setPendingSearchQuery] = useState(null);

  const handleAyatContextMenu = (e) => {
    const winSel = window.getSelection ? window.getSelection() : null;
    const text = winSel ? winSel.toString().trim() : "";
    if (!text) { setSelMenu(null); return; }
    e.preventDefault();
    setSelMenu({ x: e.clientX, y: e.clientY, text });
  };

  const urlSegs         = location.pathname.replace(/^\//, '').split('/');
  const activePage      = urlSegs[0] || 'quran';
  const urlSurahNum     = parseInt(urlSegs[1]);
  const urlAyatNum      = parseInt(urlSegs[2]);

  useEffect(() => {
    if (activePage === 'quran') {
      const sn = (!isNaN(urlSurahNum) && urlSurahNum >= 1 && urlSurahNum <= 114) ? urlSurahNum : 1;
      if (sn !== selectedSurah) {
        dispatch(quranActions.setSelectedSurah(sn));
      }
    }
  }, [location.pathname, activePage, urlSurahNum, selectedSurah, dispatch]);

  useEffect(() => {
    if (activePage === 'quran' && !isNaN(urlAyatNum) && urlAyatNum > 0) {
      if (urlAyatNum !== openAyatNum) {
        dispatch(quranActions.setOpenAyatNum(urlAyatNum));
      }
    }
  }, [location.pathname, activePage, urlAyatNum, openAyatNum, dispatch]);

  const setActivePage = useCallback((page) => {
    if (page === 'quran') {
      const sn = selectedSurah || 1;
      const an = lastAyatBySurah[sn] || openAyatNum || 1;
      navigate(`/quran/${sn}/${an}`);
    } else {
      navigate(`/${page}`);
    }
  }, [navigate, selectedSurah, lastAyatBySurah, openAyatNum]);

  const handleSurahClick = useCallback((num) => {
    const an = lastAyatBySurah[num] || 1;
    dispatch(quranActions.setSelectedSurah(num));
    dispatch(quranActions.setOpenAyatNum(an));
    navigate(`/quran/${num}/${an}`);
    if (window.innerWidth <= 640) dispatch(uiActions.setSidebarOpen(false));
  }, [dispatch, navigate, lastAyatBySurah]);

  const [showRappel, setShowRappel] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showArabicKeyboard, setShowArabicKeyboard] = useState(() => {
    try { return localStorage.getItem("quran_arabic_keyboard") === "1"; } catch { return false; }
  });
  const [listening, setListening] = useState(false);
  const userMenuRef = useRef(null);
  const activeInputRef = useRef(null);

  useEffect(() => {
    fetchSurahs().then(data => {
      dispatch(quranActions.setSurahs(data));
    }).catch(err => console.error("fetchSurahs error", err));
  }, [dispatch]);

  useEffect(() => {
    if (selectedSurah) {
      dispatch(quranActions.setLoadingAyats(true));
      fetchAyats(selectedSurah).then(data => {
        dispatch(quranActions.setAyats(data?.ayahs || []));
        dispatch(quranActions.setLoadingAyats(false));
      }).catch(err => {
        console.error("fetchAyats error", err);
        dispatch(quranActions.setLoadingAyats(false));
      });
    }
  }, [selectedSurah, dispatch]);

  const handleNavigateFromPages = (surahNum, ayatNum) => {
    dispatch(quranActions.setSelectedSurah(surahNum));
    dispatch(quranActions.setOpenAyatNum(ayatNum));
    navigate(`/quran/${surahNum}/${ayatNum}`);
  };

  const handleSetLData = (surahNum, ayatNum, updater) => {
    dispatch(setLDataThunk(surahNum, ayatNum, updater));
  };

  return (
    <ArabicKeyboardContext.Provider value={{ show: showArabicKeyboard, setShow: setShowArabicKeyboard, activeInput: activeInputRef }}>
      <div className="app">
        <Header
          sidebarOpen={sidebarOpen}
          setSidebarOpen={(val) => dispatch(uiActions.setSidebarOpen(val))}
          activePage={activePage}
          setActivePage={setActivePage}
          listening={listening}
          toggleVoice={() => setListening(v => !v)}
          showArabicKeyboard={showArabicKeyboard}
          setShowArabicKeyboard={setShowArabicKeyboard}
          showRappel={showRappel}
          setShowRappel={setShowRappel}
          showUserMenu={showUserMenu}
          setShowUserMenu={setShowUserMenu}
          showOptionsModal={showOptionsModal}
          setShowOptionsModal={setShowOptionsModal}
          currentUser={currentUser}
          onSignOut={onSignOut}
          userMenuRef={userMenuRef}
        />

        {showRappel && <RappelWidget onClose={() => setShowRappel(false)} />}
        {showOptionsModal && <OptionsModal onClose={() => setShowOptionsModal(false)} />}

        <div className="body">
          <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
            <div className="sidebar-search">
              <input
                type="text"
                placeholder="Rechercher une sourate…"
                value={search}
                onChange={e => dispatch(uiActions.setSearch(e.target.value))}
              />
            </div>
            <div className="sidebar-list">
              {(surahs || []).filter(s => {
                if (!search) return true;
                const q = search.toLowerCase();
                return s.englishName.toLowerCase().includes(q) || String(s.number).includes(q) || s.name.includes(q);
              }).map(s => {
                const isActive = s.number === selectedSurah;
                const sData = learnData[s.number] || {};
                const fullyLearned = s.numberOfAyahs && Object.values(sData).filter(a => a.learned).length === s.numberOfAyahs;

                return (
                  <div
                    key={s.number}
                    className={`surah-item${isActive ? " active" : ""}${fullyLearned ? " fully-learned" : ""}`}
                    onClick={() => handleSurahClick(s.number)}
                  >
                    <div className="surah-num">{s.number}</div>
                    <div className="surah-info">
                      <div className="surah-name-en">{s.englishName}</div>
                      <div className="surah-meta">{s.numberOfAyahs} versets · {s.revelationType === "Meccan" ? "Mecquoise" : "Médinoise"}</div>
                    </div>
                    <div className="surah-name-ar">{s.name}</div>
                  </div>
                );
              })}
            </div>
          </aside>

          <main className="main" onContextMenu={handleAyatContextMenu}>
            <Routes>
              <Route path="/" element={<Navigate to="/quran/1/1" replace />} />
              <Route path="/quran/:surahNum?/:ayatNum?" element={
                <div style={{ padding: 20, color: "var(--text2)", fontFamily: "'Cinzel',serif" }}>
                  <div className="surah-header">
                    <div className="surah-header-ornament">
                      {(surahs || []).find(s => s.number === selectedSurah)?.name || ""}
                    </div>
                    <div className="surah-header-title">
                      SOURATE {selectedSurah} · {(surahs || []).find(s => s.number === selectedSurah)?.englishName || ""}
                    </div>
                  </div>
                  <div className="bismillah-line">
                    بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
                  </div>
                  <div style={{ marginTop: 20 }}>
                    {(ayats || []).map(a => (
                      <div key={a.numberInSurah} style={{ borderBottom: "1px solid var(--border)", padding: "14px 0" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <div className="ayat-number-badge">{a.numberInSurah}</div>
                          <div style={{ flex: 1 }}>
                            <ArabicHighlighted text={a.text} />
                          </div>
                        </div>
                        <Submenu
                          ayat={a}
                          surahNum={selectedSurah}
                          ld={learnData[selectedSurah]?.[a.numberInSurah] || {}}
                          setLData={handleSetLData}
                          submenuMode={openAyatNum === a.numberInSurah ? submenuMode : "lecture"}
                          setSubmenuMode={(m) => dispatch(uiActions.setSubmenuMode(m))}
                          audioUrl={`https://everyayah.com/data/Alafasy_128kbps/${String(selectedSurah).padStart(3,"0")}${String(a.numberInSurah).padStart(3,"0")}.mp3`}
                          collections={collections}
                          onOpenCollModal={() => dispatch(collectionsActions.openCollModal({ surahNum: selectedSurah, ayatNum: a.numberInSurah }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              } />
              <Route path="/dashboard" element={<DashboardPage learnData={learnData} surahs={surahs} onNavigate={handleNavigateFromPages} goals={{}} activity={{}} onSetGoal={() => {}} onRecordActivity={() => {}} />} />
              <Route path="/prononciation" element={<PrononciationPage />} />
              <Route path="/collections" element={<CollectionsPage collections={collections} learnData={learnData} setLData={handleSetLData} onCreateCollection={name => dispatch(collectionsActions.createCollection({ name }))} onDeleteCollection={id => dispatch(collectionsActions.deleteCollection(id))} onToggleAyat={(collId, sNum, aNum) => dispatch(collectionsActions.toggleAyatInCollection({ collectionId: collId, item: { surahNum: sNum, ayatNum: aNum } }))} surahs={surahs} onNavigate={handleNavigateFromPages} initialSearchQuery={pendingSearchQuery} onConsumeSearchQuery={() => setPendingSearchQuery(null)} />} />
              <Route path="/concordance" element={<ConcordancePage surahs={surahs} onNavigate={handleNavigateFromPages} collections={collections} />} />
              <Route path="/revision" element={<RevisionPage learnData={learnData} surahs={surahs} setLData={handleSetLData} onNavigate={handleNavigateFromPages} />} />
              <Route path="/questions" element={<QuestionsModePage surahs={surahs} learnData={learnData} setLData={handleSetLData} />} />
              <Route path="/memorise" element={<MemoriseMode surahs={surahs} learnData={learnData} setLData={handleSetLData} />} />
              <Route path="/map" element={<LearningMapPage surahs={surahs} learnData={learnData} onNavigate={handleNavigateFromPages} />} />
              <Route path="/book" element={<QuranBookPage surahs={surahs} />} />
              <Route path="/book3d" element={<QuranBook3DPage surahs={surahs} />} />
            </Routes>
          </main>
        </div>

        <ArabicKeyboard
          show={showArabicKeyboard}
          onClose={() => { setShowArabicKeyboard(false); try { localStorage.setItem('quran_arabic_keyboard', '0'); } catch {} }}
        />
      </div>
    </ArabicKeyboardContext.Provider>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]           = useState(undefined);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    try {
      const unsub = onAuthStateChanged(firebaseAuth, (u) => {
        setUser(u);
        setAuthReady(true);
      }, (err) => {
        console.error("Auth error", err);
        setUser({ uid: "demo-user", email: "demo@example.com" });
        setAuthReady(true);
      });
      return unsub;
    } catch {
      setUser({ uid: "demo-user", email: "demo@example.com" });
      setAuthReady(true);
    }
  }, []);

  if (!authReady) {
    return (
      <div style={{
        minHeight:"100vh", background:"var(--bg)",
        display:"flex", alignItems:"center", justifyContent:"center",
        flexDirection:"column", gap:16, fontFamily:"'Cinzel',serif",
      }}>
        <div style={{fontSize:40}}>☽</div>
        <div style={{fontSize:10, letterSpacing:5, color:"var(--text3)"}}>CHARGEMENT…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html:
          `:root{--bg:#0c0e14;--surface:#13161f;--surface2:#1a1e2a;--border:#2a2f40;--border2:#363c52;--gold:#c9a84c;--gold2:#e8c96e;--text:#e8e4d8;--text2:#a89f8c;--text3:#6e6659;--red:#e05a5a;}*{box-sizing:border-box;margin:0;padding:0;}` }}
        />
        <LoginScreen onLoggedIn={setUser} />
      </>
    );
  }

  return (
    <Provider store={store}>
      <HashRouter>
        <CloudSyncManager uid={user.uid} />
        <SyncConsole />
        <AppInner currentUser={user} onSignOut={() => signOut(firebaseAuth).then(() => setUser(null))} />
      </HashRouter>
    </Provider>
  );
}

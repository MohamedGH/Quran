import React, { useState, useEffect, useRef, useCallback } from "react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Provider, useSelector, useDispatch, shallowEqual } from "react-redux";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { firebaseAuth } from "./services/firebase";

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

// ─── STYLES ───────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=Cinzel:wght@400;600;700&display=swap');

  :root {
    --bg:#0c0e14; --surface:#13161f; --surface2:#1a1e2a; --surface3:#222736;
    --border:#2a2f40; --border2:#363c52;
    --gold:#c9a84c; --gold2:#e8c96e; --gold3:#f5e0a0;
    --teal:#3eb8a0; --teal2:#56d4bc; --red:#e05a5a; --green:#4caf81; --green2:#6fcf9a;
    --text:#e8e4d8; --text2:#a89f8c; --text3:#6e6659;
    --learned-bg:#1a2e20; --learned-border:#2d5a38; --highlight:rgba(201,168,76,.18);
    --sidebar-w:280px; --player-h:64px; --player-loop-h:50px;
    --header-h:calc(54px + env(safe-area-inset-top, 0px));
    --radius:8px; --radius-sm:5px;
    --transition:.18s ease;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html{font-size:16px;}
  body{background:var(--bg);color:var(--text);font-family:'Cinzel',serif;min-height:100dvh;overflow-x:hidden;-webkit-tap-highlight-color:transparent;}
  ::-webkit-scrollbar{width:4px;}
  ::-webkit-scrollbar-track{background:var(--surface);}
  ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}
  .app{display:flex;flex-direction:column;height:100dvh;overflow:hidden;}

  .header{
    background:linear-gradient(180deg,rgba(16,19,30,0.95) 0%,rgba(10,12,20,0.98) 100%);
    backdrop-filter:blur(20px) saturate(160%);
    -webkit-backdrop-filter:blur(20px) saturate(160%);
    border-bottom:1px solid rgba(201,168,76,.18);
    padding:max(env(safe-area-inset-top, 0px), 0px) 14px 0 14px;
    height:var(--header-h);
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    flex-shrink:0; position:relative; z-index:200;
    box-shadow:0 4px 24px rgba(0,0,0,.45);
    user-select:none;
  }
  .header::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent 0%,rgba(201,168,76,.5) 50%,transparent 100%);}
  .header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent 0%,rgba(201,168,76,.25) 50%,transparent 100%);}
  
  .header-left{display:flex;align-items:center;gap:10px;flex-shrink:0;}
  .header-menu-btn{display:flex;width:38px;height:38px;border-radius:10px;border:1px solid rgba(201,168,76,.22);background:rgba(201,168,76,.06);color:var(--text2);cursor:pointer;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;transition:all .2s cubic-bezier(0.4, 0, 0.2, 1);-webkit-tap-highlight-color:transparent;}
  .header-menu-btn:hover{border-color:rgba(201,168,76,.6);color:var(--gold2);background:rgba(201,168,76,.14);box-shadow:0 0 12px rgba(201,168,76,.2);}
  .header-menu-btn:active{transform:scale(0.94);}
  
  .header-logo{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1;font-size:15px;font-weight:700;letter-spacing:2.5px;color:var(--gold2);flex-shrink:0;text-shadow:0 0 20px rgba(201,168,76,.35);cursor:pointer;}
  .header-logo span.logo-highlight{color:var(--teal);text-shadow:0 0 16px rgba(62,184,160,.45);}
  .header-logo .header-subtitle{font-size:6.5px;letter-spacing:3px;color:var(--text3);font-family:'Cinzel',serif;opacity:.8;}
  .header-bismillah{font-family:'Amiri Quran',serif;font-size:20px;color:var(--gold);opacity:.7;margin-left:auto;direction:rtl;}

  .header-nav{display:flex;align-items:center;gap:3px;flex:1;max-width:540px;min-width:0;background:rgba(255,255,255,.035);border-radius:12px;padding:3px;border:1px solid rgba(255,255,255,.07);box-shadow:inset 0 1px 3px rgba(0,0,0,.3);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
  .header-nav::-webkit-scrollbar{display:none;}
  
  .header-nav-btn{font-family:'Cinzel',serif;font-size:9px;font-weight:600;letter-spacing:.8px;padding:6px 10px;border:1px solid transparent;background:transparent;color:var(--text3);cursor:pointer;border-radius:8px;transition:all .2s cubic-bezier(0.4, 0, 0.2, 1);white-space:nowrap;flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;-webkit-tap-highlight-color:transparent;}
  .header-nav-btn:hover{color:var(--text2);background:rgba(255,255,255,.06);}
  .header-nav-btn:active{transform:scale(0.96);}
  .header-nav-btn .nav-icon{font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center;}
  .header-nav-btn.active-quran{background:linear-gradient(135deg,rgba(201,168,76,.22),rgba(201,168,76,.1));color:var(--gold2);border-color:rgba(201,168,76,.3);box-shadow:0 2px 10px rgba(201,168,76,.18),inset 0 1px 0 rgba(201,168,76,.2);}
  .header-nav-btn.active-prononciation{background:linear-gradient(135deg,rgba(62,184,160,.22),rgba(62,184,160,.1));color:var(--teal2);border-color:rgba(62,184,160,.3);box-shadow:0 2px 10px rgba(62,184,160,.18),inset 0 1px 0 rgba(62,184,160,.2);}
  .header-nav-btn.active-dashboard{background:linear-gradient(135deg,rgba(111,207,154,.22),rgba(111,207,154,.1));color:var(--green2);border-color:rgba(111,207,154,.3);box-shadow:0 2px 10px rgba(111,207,154,.18),inset 0 1px 0 rgba(111,207,154,.2);}
  .header-nav-btn.active-concordance{background:linear-gradient(135deg,rgba(201,168,76,.22),rgba(201,168,76,.1));color:var(--gold2);border-color:rgba(201,168,76,.3);box-shadow:0 2px 10px rgba(201,168,76,.18),inset 0 1px 0 rgba(201,168,76,.2);}
  .header-nav-btn.active-collections{background:linear-gradient(135deg,rgba(200,120,255,.22),rgba(200,120,255,.1));color:#c878ff;border-color:rgba(200,120,255,.3);box-shadow:0 2px 10px rgba(200,120,255,.18),inset 0 1px 0 rgba(200,120,255,.2);}
  .header-nav-btn.active-revision{background:linear-gradient(135deg,rgba(86,212,188,.22),rgba(86,212,188,.1));color:var(--teal2);border-color:rgba(86,212,188,.3);box-shadow:0 2px 10px rgba(86,212,188,.18),inset 0 1px 0 rgba(86,212,188,.2);}

  .header-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;position:relative;}
  .voice-btn{width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .2s cubic-bezier(0.4, 0, 0.2, 1);flex-shrink:0;-webkit-tap-highlight-color:transparent;}
  .voice-btn:hover{border-color:rgba(201,168,76,.4);color:var(--gold2);background:rgba(201,168,76,.1);}
  .voice-btn:active{transform:scale(0.94);}
  .voice-btn.listening{border-color:var(--red);color:var(--red);animation:pulse 1.2s ease-in-out infinite;background:rgba(224,90,90,.14);}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(224,90,90,.45);}50%{box-shadow:0 0 0 8px rgba(224,90,90,0);}}

  .header-user-btn{display:flex;align-items:center;justify-content:center;padding:2px;border-radius:50%;border:1.5px solid rgba(201,168,76,.35);background:transparent;cursor:pointer;transition:all .2s cubic-bezier(0.4, 0, 0.2, 1);flex-shrink:0;-webkit-tap-highlight-color:transparent;}
  .header-user-btn:hover,.header-user-btn.active{border-color:var(--gold2);box-shadow:0 0 12px rgba(201,168,76,.35);transform:scale(1.05);}
  .header-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;}
  .header-avatar-placeholder{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#c9a84c,#e8c96e);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#0c0e14;font-family:'Cinzel',serif;}

  .body{display:flex;flex:1;overflow:hidden;position:relative;}

  .sidebar{
    width:var(--sidebar-w); background:var(--surface);
    border-right:1px solid var(--border);
    display:flex; flex-direction:column;
    flex-shrink:0; overflow:hidden;
    transition:transform var(--transition), width var(--transition);
  }
  .sidebar.sidebar-floating{
    position:absolute;left:0;top:0;bottom:0;z-index:300;
    transform:translateX(-100%);box-shadow:4px 0 24px rgba(0,0,0,.4);
  }
  .sidebar.sidebar-floating.open{transform:translateX(0);}
  @media (min-width:641px){
    .sidebar:not(.sidebar-floating):not(.open){
      width:0 !important;
      min-width:0 !important;
      border-right:none !important;
      overflow:hidden !important;
    }
    .sidebar:not(.sidebar-floating).open{
      width:var(--sidebar-w) !important;
    }
  }
  .sidebar-overlay{display:none;position:absolute;inset:0;z-index:299;background:rgba(0,0,0,.4);}
  .sidebar-overlay.open{display:block;}
  @media (min-width:641px){.sidebar-overlay.open{pointer-events:none;background:transparent;}}
  .sidebar-search{padding:12px;border-bottom:1px solid var(--border);}
  .sidebar-search input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;color:var(--text);font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;outline:none;transition:border-color var(--transition);}
  .sidebar-search input:focus{border-color:var(--gold);}
  .sidebar-search input::placeholder{color:var(--text3);}
  .sidebar-list{overflow-y:auto;flex:1;}
  .surah-item{display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-bottom:1px solid rgba(42,47,64,.5);transition:background var(--transition);position:relative;}
  .surah-item:hover{background:var(--surface2);}
  .surah-item.active{background:var(--surface3);}
  .surah-item.fully-learned{background:rgba(26,46,32,.45);border-right:2px solid var(--green);}
  .surah-item.fully-learned .surah-name-en{color:var(--green2);}
  .surah-item.fully-learned .surah-num{color:var(--green);border-color:var(--green);}
  .surah-item.fully-learned .surah-meta::before{content:'✓ ';color:var(--green);}
  .surah-item.active::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(to bottom,var(--gold),var(--teal));border-radius:0 2px 2px 0;}
  .surah-num{width:30px;height:30px;background:var(--surface2);border:1px solid var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--gold);font-weight:600;flex-shrink:0;}
  .surah-active .surah-num{background:var(--gold);color:var(--bg);border-color:var(--gold);}
  .surah-info{flex:1;min-width:0;}
  .surah-name-en{font-size:11px;letter-spacing:1px;color:var(--text);font-weight:600;}
  .surah-meta{font-size:9px;color:var(--text3);letter-spacing:.5px;margin-top:2px;}
  .surah-name-ar{font-family:'Amiri',serif;font-size:16px;color:var(--gold);direction:rtl;}

  .main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;}
  .surah-header{background:linear-gradient(180deg,var(--surface),var(--bg));border-bottom:1px solid var(--border);padding:10px 16px;flex-shrink:0;text-align:center;}
  .surah-header-ornament{font-family:'Amiri Quran',serif;font-size:26px;color:var(--gold2);direction:rtl;line-height:1.3;}
  .surah-header-title{font-size:9px;letter-spacing:2px;color:var(--gold);margin-top:3px;opacity:.8;}
  .surah-header-sub{font-size:9px;color:var(--text3);letter-spacing:2px;margin-top:2px;}
  .bismillah-line{font-family:'Amiri Quran',serif;font-size:26px;color:var(--gold);direction:rtl;text-align:center;padding:14px 24px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;opacity:.85;}

  .ayat-main{display:flex;align-items:flex-start;gap:14px;padding:14px 22px;cursor:pointer;}
  .ayat-main:hover{background:rgba(255,255,255,.02);}
  .ayat-number-badge{width:32px;height:32px;border:1px solid var(--border2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text3);flex-shrink:0;margin-top:4px;transition:all var(--transition);font-weight:600;}
  .ayat-arabic{font-family:'Amiri Quran',serif;font-size:26px;line-height:2;direction:rtl;text-align:right;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;color:var(--text);}
  .char-span{display:inline;transition:color .04s;color:var(--text);}
  .char-span.char-done{color:var(--teal);}
  .char-span.char-active{color:var(--gold2);text-shadow:0 0 14px rgba(232,201,110,.65);}

  .submenu{background:var(--surface2);border-top:1px solid var(--border);padding:14px 22px 18px;}
  .submenu-header{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;}
  .submenu-header::-webkit-scrollbar{display:none;}
  .mode-btn{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;padding:8px 14px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text3);cursor:pointer;transition:all var(--transition);white-space:nowrap;flex-shrink:0;}
  .mode-btn:hover{color:var(--text2);}
  .mode-btn.active{color:var(--gold);border-bottom-color:var(--gold);}

  .btn-primary{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;padding:8px 16px;border:1px solid var(--gold);background:transparent;color:var(--gold);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--transition);}
  .btn-primary:hover{background:rgba(201,168,76,.12);}
  .btn-primary.active{background:var(--gold);color:var(--bg);}
  .btn-primary:disabled{opacity:.35;cursor:not-allowed;}
  .btn-small{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;padding:5px 10px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--transition);}
  .btn-small:hover{border-color:var(--text2);color:var(--text2);}
  .btn-small.done{border-color:var(--green);color:var(--green);}

  @media (max-width:640px) {
    :root{ --sidebar-w:100vw; --header-h:calc(52px + env(safe-area-inset-top, 0px)); --player-h:56px; }
    .header{ padding:max(env(safe-area-inset-top, 0px), 0px) 8px 0 8px; height:var(--header-h); gap:6px; }
    .header-menu-btn{ width:36px; height:36px; font-size:15px; border-radius:8px; }
    .header-logo{ font-size:13px; letter-spacing:1.5px; }
    .header-logo .header-subtitle{ font-size:5.5px; letter-spacing:2px; }
    
    .header-nav{ padding:2px; gap:2px; border-radius:10px; flex:1; min-width:0; justify-content:space-around; }
    .header-nav-btn{ padding:5px 6px; font-size:8px; letter-spacing:0; border-radius:7px; flex:1; min-width:0; }
    .header-nav-btn .nav-label{ display:none; }
    .header-nav-btn .nav-icon{ font-size:16px; margin:0; }

    .sidebar{
      position:fixed; top:var(--header-h); left:0; bottom:0; z-index:300;
      width:var(--sidebar-w); transform:translateX(-100%);
      transition:transform .25s ease;
      box-shadow:4px 0 32px rgba(0,0,0,.5);
    }
    .sidebar.open{ transform:translateX(0); }
    .main{ width:100%; }
    .ayat-main{ padding:12px 14px; gap:10px; }
    .ayat-arabic{ font-size:20px; line-height:1.9; }
    .ayat-number-badge{ width:28px; height:28px; font-size:9px; }
    .submenu{ padding:12px 14px 16px; }
  }

  @media (max-width:400px) {
    .header{ padding:max(env(safe-area-inset-top, 0px), 0px) 4px 0 4px; gap:3px; }
    .header-menu-btn{ width:34px; height:34px; font-size:14px; }
    .header-logo{ display:none; }
    .header-nav-btn{ padding:4px 3px; }
    .header-nav-btn .nav-icon{ font-size:15px; }
    .voice-btn{ width:34px; height:34px; font-size:13px; }
    .header-user-btn{ width:34px; height:34px; }
    .header-avatar,.header-avatar-placeholder{ width:28px; height:28px; font-size:11px; }
    .ayat-arabic{ font-size:18px; }
    .surah-header-ornament{ font-size:18px; }
    .bismillah-line{ font-size:18px; }
  }
`;

const StyleTag = () => <style dangerouslySetInnerHTML={{ __html: CSS }} />;

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
    dispatch(quranActions.fetchSurahsThunk());
  }, [dispatch]);

  useEffect(() => {
    if (selectedSurah) {
      dispatch(quranActions.fetchAyatsThunk(selectedSurah));
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
      <StyleTag />
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

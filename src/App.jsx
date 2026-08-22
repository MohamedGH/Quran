import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { Provider, useSelector, useDispatch, shallowEqual } from "react-redux";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { firebaseAuth } from "./services/firebase";
import { createAudioRecorder, IS_ANDROID } from "./services/audioRecorder";

import {
  store, sel, uiActions, quranActions, playerActions,
  learnActions, collectionsActions, voiceActions, goalsActions, setLDataThunk
} from "./store";

import {
  SURAH_NAMES, RECITATORS, BITRATE_FALLBACK_ORDER, TRANS_EDITIONS, TRANS_LABELS,
  SURAH_INFO, SUGGESTED_SEARCHES, SAJDA_AYATS, PAGE_POSITION_LABELS,
  TAJWEED_RULES, ARABIC_LETTERS, HARAKATS, ARABIC_ROOTS, DATA_KEYS
} from "./utils/quranData";

import {
  API, AUDIO_CDN_ROOT, bitrateOrderFor, getReciterBitrate, setReciterBitrate,
  markBitrateBad, fetchOfficialBitrates, getAudioBase, setGlobalRecitator, getGlobalRecitator,
  openTsDb, idbGetQuran, idbSetQuran, idbGet, idbSet, fetchSurahs, fetchSurahTranslation,
  fetchAyats, fetchSurahSimple, fetchSurahDefault, fetchSurahMeta, fetchAyahMeta,
  fetchQuranPage, fetchPageMeta, loadTimestampsForSurah, parseTimestampsFile, fixChars
} from "./services/quranApi";

import {
  isQalqala, isIzhar, isIdgham, getMaddType, isMaddChar, normalizeAr, parseVoiceCommand,
  arabicRoot, highlightArabic, stripDiacritics, wordTranslit, calcDifficulty, calcPhase,
  splitArabicChars, splitArabicWords, splitArabicClusters, computeMastery, masteryColor,
  normalizeArabic, getWaslVowel, getSilentIndices, phonoCost, levenshteinChars,
  removeSolarLam, hasSolarLam, diffWord, wordEditDist, levenshteinAlign, compareRecitation
} from "./utils/arabicUtils";

import Header from "./components/Header";
import HeaderUserMenu from "./components/HeaderUserMenu";
import OptionsModal from "./components/OptionsModal";
import ArabicKeyboard, { ArabicKeyboardContext, useArabicKeyboard } from "./components/ArabicKeyboard";
import RappelWidget from "./components/RappelWidget";
import LoginScreen from "./components/LoginScreen";
import SyncConsole, { addSyncLog } from "./components/SyncConsole";
import CloudSyncManager from "./components/CloudSyncManager";
import ExportImport, { getDeviceId, mergeLearnData, mergeActivity, mergeCollections } from "./components/ExportImport";
import OfflineLoader from "./components/OfflineLoader";
import ArabicHighlighted, { PlayingArabicHighlighted } from "./components/ArabicHighlighted";
import EditorWords from "./EditorWords";
import VoiceRecorder from "./VoiceRecorder";
import RecitationChecker from "./RecitationChecker";
import Submenu, { AnimatedPage, AnimatedSubmenu, TajweedExercice, InfoMode, AideMemoireMode, RevisionEcritureMode, DecouverteMode, LectureMode, ApprentissageMode } from "./components/Submenu";

import DashboardPage from "./components/pages/DashboardPage";
import PrononciationPage from "./components/pages/PrononciationPage";
import CollectionsPage, { CollectionModal, CollectionAyatRow, AyatCollectionsTab } from "./components/pages/CollectionsPage";
import ConcordancePage, { ConcordInlinePlayer, ConcordGroup, SharedGroup } from "./components/pages/ConcordancePage";
import LearningMapPage from "./components/pages/LearningMapPage";
import RevisionPage, { MasteryBar, MasteryBadge, MasteryDebug, useToRevise, ToRevisePanel } from "./components/pages/RevisionPage";
import QuestionsModePage, { QuestionsMode, ReconstructQuestion, CompareVerseQuestion, FindSurahQuestion, UnknownWordQuestion, UnknownPickQuestion, RevisePartQuestion, PageStructureQuestion, QAyatPlayer, TextAnswerInput } from "./components/pages/QuestionsModePage";
import MemoriseMode, { MemoriseInfoPanel } from "./components/pages/MemoriseMode";
import QuranBookPage from "./components/pages/QuranBookPage";
import QuranBook3DPage from "./components/pages/QuranBook3DPage";

// ─── STYLES ───────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=Cinzel:wght@400;600;700&display=swap');

  /* ── TOKENS ─────────────────────────────────────────────────────── */
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

  /* ── HEADER ──────────────────────────────────────────────────────── */
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

  /* ── HEADER PAGE NAV ──────────────────────────────────────────────── */
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

  /* ── RIGHT ACTION BUTTONS & USER MENU ────────────────────────────── */
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

  /* Dropdown User Menu */
  .header-user-menu{position:absolute;top:calc(100% + 8px);right:0;width:250px;background:rgba(19,22,31,.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(201,168,76,.25);border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.05);padding:8px;z-index:300;display:flex;flex-direction:column;gap:4px;animation:menuFadeIn .2s cubic-bezier(0.16, 1, 0.3, 1);}
  @keyframes menuFadeIn{from{opacity:0;transform:translateY(-8px) scale(0.96);}to{opacity:1;transform:translateY(0) scale(1);}}
  .user-menu-header{padding:8px 10px 10px 10px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px;}
  .user-menu-name{font-family:'Cinzel',serif;font-size:11px;font-weight:600;color:var(--gold2);letter-spacing:.8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .user-menu-email{font-size:9.5px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .user-menu-item{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;border:none;background:transparent;color:var(--text);cursor:pointer;font-family:'Cinzel',serif;font-size:10px;letter-spacing:.5px;transition:all .15s ease;text-align:left;width:100%;}
  .user-menu-item:hover{background:rgba(201,168,76,.1);color:var(--gold2);}
  .user-menu-item .menu-left{display:flex;align-items:center;gap:8px;}
  .user-menu-badge{font-size:8px;padding:2px 6px;border-radius:6px;letter-spacing:.5px;}
  .user-menu-badge.on{background:rgba(62,184,160,.2);color:var(--teal2);border:1px solid rgba(62,184,160,.4);}
  .user-menu-badge.off{background:rgba(255,255,255,.05);color:var(--text3);}
  .user-menu-item.logout{color:var(--red);border-top:1px solid rgba(255,255,255,.06);margin-top:4px;padding-top:10px;}
  .user-menu-item.logout:hover{background:rgba(224,90,90,.1);color:#ff7b7b;}

  /* ── TOAST ────────────────────────────────────────────────────────── */
  .voice-toast{position:fixed;top:calc(var(--header-h) + 10px);left:50%;transform:translateX(-50%);background:var(--surface3);border:1px solid var(--border2);border-radius:var(--radius);padding:9px 18px;font-size:11px;letter-spacing:1px;color:var(--text2);z-index:500;display:flex;align-items:center;gap:10px;max-width:min(420px,90vw);box-shadow:0 8px 32px rgba(0,0,0,.4);}
  .voice-toast.success{border-color:var(--teal);color:var(--teal);}
  .voice-toast.error{border-color:var(--red);color:var(--red);}
  .voice-toast .transcript{color:var(--gold2);font-style:italic;}
  .voice-dot{width:8px;height:8px;border-radius:50%;background:var(--red);animation:pulse-dot 1s infinite;flex-shrink:0;}
  @keyframes pulse-dot{0%,100%{opacity:1;}50%{opacity:.3;}}

  /* ── VOICE HELP ───────────────────────────────────────────────────── */
  .voice-help{position:fixed;top:calc(var(--header-h) + 10px);right:12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;z-index:400;max-width:260px;box-shadow:0 8px 32px rgba(0,0,0,.4);}
  .voice-help-title{font-size:10px;letter-spacing:2px;color:var(--gold);margin-bottom:10px;}
  .voice-help-cmd{font-size:10px;letter-spacing:.5px;color:var(--text3);padding:3px 0;display:flex;gap:8px;align-items:baseline;}
  .voice-help-ex{color:var(--text2);font-size:10px;}

  /* ── BODY / SIDEBAR ───────────────────────────────────────────────── */
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

  /* ── MAIN AREA ────────────────────────────────────────────────────── */
  .main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;}
  .surah-header{background:linear-gradient(180deg,var(--surface),var(--bg));border-bottom:1px solid var(--border);padding:10px 16px;flex-shrink:0;text-align:center;}
  .surah-header-ornament{font-family:'Amiri Quran',serif;font-size:26px;color:var(--gold2);direction:rtl;line-height:1.3;}
  .surah-header-title{font-size:9px;letter-spacing:2px;color:var(--gold);margin-top:3px;opacity:.8;}
  .surah-header-sub{font-size:9px;color:var(--text3);letter-spacing:2px;margin-top:2px;}
  .bismillah-line{font-family:'Amiri Quran',serif;font-size:26px;color:var(--gold);direction:rtl;text-align:center;padding:14px 24px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;opacity:.85;}

  /* ── TS BAR ───────────────────────────────────────────────────────── */
  .ts-global-bar{background:var(--surface2);border-bottom:1px solid var(--border);padding:6px 20px;display:flex;align-items:center;gap:8px;flex-shrink:0;position:relative;z-index:20;}
  .panel-row{position:relative;}
  .panel-expand{position:absolute;top:calc(100% + 4px);left:0;z-index:30;min-width:0;max-width:calc(100vw - 24px);}
  .tajweed-panel{display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--surface2);border-radius:8px;border:1px solid rgba(255,255,255,.12);flex-wrap:wrap;box-shadow:0 4px 16px rgba(0,0,0,.4);}
  @keyframes tajweedPanelIn{from{opacity:0;transform:scaleX(.9);transform-origin:left}to{opacity:1;transform:scaleX(1)}}
  .tajweed-panel{animation:tajweedPanelIn .18s cubic-bezier(.4,0,.2,1) forwards;}
  .ts-global-label{font-size:10px;letter-spacing:1px;color:var(--text3);}
  .ts-global-count{font-size:10px;letter-spacing:1px;color:var(--gold2);}
  .ts-drop-zone{border:1px dashed var(--border2);border-radius:var(--radius-sm);padding:5px 12px;cursor:pointer;transition:border-color var(--transition);display:flex;align-items:center;gap:8px;}
  .ts-drop-zone:hover{border-color:var(--gold);}
  .ts-drop-zone input{display:none;}
  .ts-drop-label{font-size:10px;letter-spacing:1px;color:var(--text3);}
  .ts-progress-bar{flex:1;min-width:80px;height:3px;background:var(--border);border-radius:2px;overflow:hidden;}
  .ts-progress-fill{height:100%;background:linear-gradient(90deg,var(--gold),var(--teal));border-radius:2px;transition:width .3s;}
  .ts-status{display:inline-flex;align-items:center;gap:5px;font-size:9px;letter-spacing:1px;padding:2px 8px;border-radius:10px;border:1px solid var(--border2);color:var(--text3);flex-shrink:0;align-self:flex-start;margin-top:6px;}
  .ts-status.loaded{border-color:var(--teal);color:var(--teal);}

  /* ── AYAT LIST ────────────────────────────────────────────────────── */
  .ayat-scroll{flex:1;overflow-y:auto;padding:6px 0 calc(var(--player-h) + var(--player-loop-h) + 20px);will-change:transform;}
  .ayat-row{border-bottom:1px solid rgba(42,47,64,.4);transition:background var(--transition);content-visibility:auto;contain-intrinsic-size:0 80px;}
  .ayat-row.playing{background:var(--highlight);}
  .ayat-row.playing .ayat-main{background:var(--highlight);}
  .ayat-row.current .ayat-number-badge{border-color:var(--gold);color:var(--gold);}
  .ayat-row.learned{background:var(--learned-bg);}
  .ayat-row.selecting{background:rgba(201,168,76,.03);}
  .ayat-row.learned .ayat-number-badge{border-color:var(--green);color:var(--green);}
  .ayat-row.page-start{position:relative;margin-top:22px;}
  .ayat-row.page-start::before{content:'';position:absolute;top:-11px;left:22px;right:22px;height:1px;background:linear-gradient(90deg,transparent,rgba(200,120,255,.15),#c878ff,rgba(200,120,255,.15),transparent);}
  .ayat-row.page-end{position:relative;margin-bottom:22px;}
  .ayat-row.page-end::after{content:'';position:absolute;bottom:-11px;left:22px;right:22px;height:1px;background:linear-gradient(90deg,transparent,rgba(200,120,255,.15),#c878ff,rgba(200,120,255,.15),transparent);}
  .page-edge-pill{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:5px;background:linear-gradient(135deg,#d896ff,#9a4fd1);color:#fff;font-size:7px;letter-spacing:2px;padding:4px 12px;border-radius:20px;font-family:'Cinzel',serif;box-shadow:0 3px 14px rgba(178,90,255,.45),0 0 0 3px var(--surface1,#12141c);white-space:nowrap;z-index:2;}
  .page-edge-pill.start{top:-11px;transform:translate(-50%,-50%);}
  .page-edge-pill.end{bottom:-11px;transform:translate(-50%,50%);}
  .page-edge-pill svg{width:8px;height:8px;}
  .ayat-main{display:flex;align-items:flex-start;gap:14px;padding:14px 22px;cursor:pointer;}
  .ayat-main:hover{background:rgba(255,255,255,.02);}
  .ayat-number-badge{width:32px;height:32px;border:1px solid var(--border2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text3);flex-shrink:0;margin-top:4px;transition:all var(--transition);font-weight:600;}
  .ayat-playing .ayat-number-badge{border-color:var(--gold);color:var(--gold);box-shadow:0 0 12px rgba(201,168,76,.3);}
  .ayat-arabic{font-family:'Amiri Quran',serif;font-size:26px;line-height:2;direction:rtl;text-align:right;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;color:var(--text);}
  .char-span{display:inline;transition:color .04s;color:var(--text);}
  .char-span.char-done{color:var(--teal);}
  .char-span.char-active{color:var(--gold2);text-shadow:0 0 14px rgba(232,201,110,.65);}
  .ayat-learned-badge{font-size:9px;letter-spacing:1px;color:var(--green);padding:2px 8px;border:1px solid var(--green);border-radius:10px;margin-top:6px;flex-shrink:0;align-self:flex-start;}

  /* ── SUBMENU ──────────────────────────────────────────────────────── */
  @keyframes pageIn{from{opacity:0}to{opacity:1}}
  .page-anim{animation:pageIn .12s ease forwards;flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;width:100%;}
  @keyframes submenuIn{0%{opacity:0;transform:translateY(-4px)}100%{opacity:1;transform:translateY(0)}}
  @keyframes submenuOut{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}
  .submenu{background:var(--surface2);border-top:1px solid var(--border);padding:14px 22px 18px;}
  .submenu-anim-wrap{animation:submenuIn .32s cubic-bezier(.4,0,.2,1) forwards;}
  .submenu-anim-wrap.closing{animation:submenuOut .24s cubic-bezier(.4,0,.2,1) forwards;}
  .submenu-header{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;}
  .submenu-header::-webkit-scrollbar{display:none;}
  .mode-btn{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;padding:8px 14px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text3);cursor:pointer;transition:all var(--transition);white-space:nowrap;flex-shrink:0;}
  .mode-btn:hover{color:var(--text2);}
  .mode-btn.active{color:var(--gold);border-bottom-color:var(--gold);}
  .submenu-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto;}
  .submenu-tab{font-size:9px;letter-spacing:1.5px;color:var(--text3);padding:8px 14px;background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all var(--transition);white-space:nowrap;flex-shrink:0;}
  .submenu-tab:hover{color:var(--text2);}
  .submenu-tab.active{color:var(--gold);border-bottom-color:var(--gold);}

  /* ── BUTTONS ──────────────────────────────────────────────────────── */
  .btn-primary{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;padding:8px 16px;border:1px solid var(--gold);background:transparent;color:var(--gold);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--transition);}
  .btn-primary:hover{background:rgba(201,168,76,.12);}
  .btn-primary.active{background:var(--gold);color:var(--bg);}
  .btn-primary:disabled{opacity:.35;cursor:not-allowed;}
  .btn-small{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;padding:5px 10px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--transition);}
  .btn-small:hover{border-color:var(--text2);color:var(--text2);}
  .btn-small.done{border-color:var(--green);color:var(--green);}

  /* ── MAIN PLAYER ─────────────────────────────────────────────────── */
  .main-player{position:fixed;bottom:0;left:0;right:0;background:linear-gradient(0deg,var(--surface),rgba(19,22,31,.98));border-top:1px solid var(--border);z-index:200;backdrop-filter:blur(10px);}
  .main-player::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);}
  .player-row{display:flex;align-items:center;gap:14px;padding:8px 20px;height:var(--player-h);}
  .player-info{min-width:120px;max-width:180px;}
  .player-surah{font-size:9px;letter-spacing:1.5px;color:var(--gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .player-ayah{font-size:8px;letter-spacing:1px;color:var(--text3);margin-top:2px;}
  .player-controls{display:flex;align-items:center;gap:6px;}
  .ctrl-btn{width:32px;height:32px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all var(--transition);flex-shrink:0;touch-action:manipulation;}
  .ctrl-btn:hover{border-color:var(--gold);color:var(--gold);}
  .ctrl-btn.play-btn{width:38px;height:38px;background:var(--gold);border-color:var(--gold);color:var(--bg);font-size:14px;}
  .ctrl-btn.play-btn:hover{background:var(--gold2);}
  .ctrl-btn.loop-on{border-color:var(--teal);color:var(--teal);background:rgba(62,184,160,.1);}
  .reciter-trigger{gap:5px;padding:0 10px;width:auto;min-width:44px;font-family:'Cinzel',serif;font-size:10px;}
  .reciter-trigger-label{max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .reciter-sheet-backdrop{position:fixed;inset:0;z-index:350;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);}
  .reciter-sheet{position:fixed;z-index:351;right:16px;bottom:76px;width:min(420px,calc(100vw - 32px));max-height:min(640px,calc(100dvh - 100px));display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border2);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.55);overflow:hidden;}
  .reciter-sheet-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--border);}
  .reciter-sheet-title{font-family:'Cinzel',serif;font-size:12px;letter-spacing:2px;color:var(--gold2);}
  .reciter-sheet-current{font-size:10px;color:var(--text3);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .reciter-sheet-close{width:40px;height:40px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:20px;cursor:pointer;flex-shrink:0;}
  .reciter-search{margin:12px 16px 8px;width:calc(100% - 32px);box-sizing:border-box;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:11px 12px;color:var(--text);font-size:16px;outline:none;}
  .reciter-search:focus{border-color:var(--gold);}
  .reciter-list{overflow-y:auto;padding:4px 12px 12px;overscroll-behavior:contain;}
  .reciter-option{width:100%;min-height:52px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:9px;background:transparent;border:1px solid transparent;color:var(--text2);font-size:14px;text-align:left;cursor:pointer;}
  .reciter-option.selected{background:rgba(201,168,76,.12);border-color:var(--gold);color:var(--gold2);}
  .reciter-option-flag{font-size:20px;line-height:1;}
  .reciter-option-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .reciter-option-check{font-size:16px;color:var(--gold2);}
  .reciter-empty{padding:24px 12px;text-align:center;color:var(--text3);font-size:13px;}
  .reciter-sheet-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid var(--border);color:var(--text3);font-size:11px;}
  .reciter-reset{min-height:36px;padding:0 10px;border:1px solid var(--border2);border-radius:6px;background:transparent;color:var(--text2);font-size:11px;cursor:pointer;}
  .player-progress{flex:1;display:flex;align-items:center;gap:8px;min-width:0;}
  .progress-bar-wrap{flex:1;height:3px;background:var(--border);border-radius:2px;position:relative;}
  .progress-bar-fill{height:100%;background:linear-gradient(90deg,var(--gold),var(--teal));border-radius:2px;transition:width .3s;}
  .progress-range{position:absolute;top:0;height:100%;background:rgba(62,184,160,.3);border-radius:2px;pointer-events:none;}
  .progress-text{font-size:8px;color:var(--text3);letter-spacing:1px;white-space:nowrap;}
  .loop-bar{display:flex;align-items:center;gap:8px;padding:6px 20px 8px;border-top:1px solid rgba(42,47,64,.5);flex-wrap:wrap;}
  .loop-label{font-size:9px;letter-spacing:1.5px;color:var(--teal);flex-shrink:0;}
  .loop-inputs{display:flex;align-items:center;gap:6px;flex-shrink:0;}
  .loop-input{background:var(--surface3);border:1px solid var(--border2);border-radius:4px;padding:3px 6px;color:var(--text2);font-family:'Cinzel',serif;font-size:10px;width:52px;outline:none;text-align:center;}
  .loop-input:focus{border-color:var(--teal);}
  .loop-sep{font-size:10px;color:var(--text3);}
  .loop-rep-wrap{display:flex;align-items:center;gap:5px;margin-left:6px;}
  .loop-rep-label{font-size:9px;letter-spacing:1px;color:var(--text3);}
  .loop-rep-btns{display:flex;gap:3px;}
  .loop-rep-btn{font-family:'Cinzel',serif;font-size:9px;padding:3px 7px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;border-radius:3px;transition:all .15s;}
  .loop-rep-btn:hover{border-color:var(--teal);color:var(--teal);}
  .loop-rep-btn.sel{border-color:var(--teal);color:var(--teal);background:rgba(62,184,160,.1);}
  .loop-count-badge{font-size:9px;letter-spacing:1px;color:var(--text3);margin-left:auto;}
  .loop-count-badge span{color:var(--teal);}

  /* ── MISC ─────────────────────────────────────────────────────────── */
  .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--text3);font-size:11px;letter-spacing:2px;}
  .loading-ring{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}
  .empty-state{display:flex;align-items:center;justify-content:center;height:300px;color:var(--text3);font-size:11px;letter-spacing:2px;flex-direction:column;gap:12px;}
  .empty-arabic{font-family:'Amiri Quran',serif;font-size:32px;color:var(--gold);opacity:.3;direction:rtl;}

  @media (max-width:900px) {
    :root{ --sidebar-w:240px; }
    .header-bismillah{ display:none; }
    .ayat-arabic{ font-size:22px; }
    .surah-header{ padding:12px 20px; }
    .surah-header-ornament{ font-size:28px; }
    .bismillah-line{ font-size:22px; padding:12px 18px; }
    .player-info{ display:none; }
  }

  @media (max-width:640px) {
    :root{ --sidebar-w:100vw; --header-h:calc(52px + env(safe-area-inset-top, 0px)); --player-h:56px; }
    .header{ padding:max(env(safe-area-inset-top, 0px), 0px) 8px 0 8px; height:var(--header-h); gap:6px; }
    .header-left{ gap:6px; }
    .header-menu-btn{ width:36px; height:36px; font-size:15px; border-radius:8px; }
    .header-logo{ font-size:13px; letter-spacing:1.5px; }
    .header-logo .header-subtitle{ font-size:5.5px; letter-spacing:2px; }
    
    .header-nav{ padding:2px; gap:2px; border-radius:10px; flex:1; min-width:0; justify-content:space-around; }
    .header-nav-btn{ padding:5px 6px; font-size:8px; letter-spacing:0; border-radius:7px; flex:1; min-width:0; }
    .header-nav-btn .nav-label{ display:none; }
    .header-nav-btn .nav-icon{ font-size:16px; margin:0; }

    .header-actions{ gap:5px; }
    .voice-btn{ width:36px; height:36px; font-size:14px; border-radius:8px; }
    .desktop-only-action{ display:none !important; }
    
    .header-user-btn{ width:36px; height:36px; }
    .header-avatar,.header-avatar-placeholder{ width:30px; height:30px; font-size:12px; }

    .sidebar{
      position:fixed; top:var(--header-h); left:0; bottom:0; z-index:300;
      width:var(--sidebar-w); transform:translateX(-100%);
      transition:transform .25s ease;
      box-shadow:4px 0 32px rgba(0,0,0,.5);
    }
    .sidebar.open{ transform:translateX(0); }

    .sidebar-overlay{
      display:none; position:fixed; inset:0; z-index:299;
      background:rgba(0,0,0,.5); backdrop-filter:blur(2px);
    }
    .sidebar-overlay.open{ display:block; }

    .main{ width:100%; }
    .ayat-main{ padding:12px 14px; gap:10px; }
    .ayat-arabic{ font-size:20px; line-height:1.9; }
    .ayat-number-badge{ width:28px; height:28px; font-size:9px; }
    .submenu{ padding:12px 14px 16px; }

    .surah-header{ padding:7px 10px; }
    .surah-header-ornament{ font-size:20px; }
    .surah-header-title{ font-size:8px; letter-spacing:1px; }
    .bismillah-line{ font-size:20px; padding:10px 14px; }

    .ts-global-bar{ padding:6px 14px; gap:8px; }
    .player-row{ padding:6px 14px; gap:10px; }
    .ctrl-btn{ width:30px; height:30px; font-size:11px; }
    .ctrl-btn.play-btn{ width:36px; height:36px; font-size:13px; }
    .reciter-trigger{position:fixed;right:12px;bottom:68px;z-index:201;min-height:44px;padding:0 14px;border-radius:22px;background:var(--surface2);box-shadow:0 6px 20px rgba(0,0,0,.35);}
    .reciter-trigger-label{display:inline;max-width:120px;}
    .reciter-sheet{right:0;bottom:0;width:100%;max-height:min(82dvh,680px);border-radius:18px 18px 0 0;}
    .reciter-sheet-header{padding:18px 16px 14px;}
    .reciter-list{padding-bottom:16px;}
    .reciter-option{min-height:56px;font-size:16px;}
    .progress-text{ display:none; }
    .loop-bar{ padding:4px 14px 6px; gap:6px; }
    .loop-rep-wrap{ display:none; }
    .voice-help{ right:8px; left:8px; max-width:none; top:calc(var(--header-h) + 6px); }
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
  const loadingSurahs   = useSelector(sel.loadingSurahs);
  const loadingAyats    = useSelector(sel.loadingAyats);
  const search          = useSelector(sel.search);
  const openAyatNum     = useSelector(sel.openAyatNum);
  const submenuMode     = useSelector(sel.submenuMode);
  const lastAyatBySurah = useSelector(sel.lastAyatBySurah, shallowEqual);
  const partSelectAyat  = useSelector(sel.partSelectAyat);
  const partSelectStep  = useSelector(sel.partSelectStep);
  const partSelectStart = useSelector(sel.partSelectStart);
  const learnData       = useSelector(sel.learnData, shallowEqual);
  const collections     = useSelector(sel.collections, shallowEqual);
  const collModal       = useSelector(sel.collModal);

  const playingAyatNumRef = useRef(null);
  const isMainPlayingRef  = useRef(false);
  const mainAyatIdxRef    = useRef(0);
  const localPlayingRef   = useRef(null);
  const [playStateVer, setPlayStateVer] = useState(0);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      const s = store.getState();
      mainCurrentMsRef.current = sel.mainCurrentMs(s);
      const pan = sel.playingAyatNum(s);
      const imp = sel.isMainPlaying(s);
      const mai = sel.mainAyatIdx(s);
      const lp  = sel.localPlaying(s);
      if (pan !== playingAyatNumRef.current || imp !== isMainPlayingRef.current ||
          mai !== mainAyatIdxRef.current || lp?.ayatNum !== localPlayingRef.current?.ayatNum) {
        playingAyatNumRef.current = pan;
        isMainPlayingRef.current  = imp;
        mainAyatIdxRef.current    = mai;
        localPlayingRef.current   = lp;
        setPlayStateVer(v => v + 1);
      }
    });
    return unsub;
  }, []);

  const playingAyatNum = playingAyatNumRef.current;
  const isMainPlaying  = isMainPlayingRef.current;
  const mainAyatIdx    = mainAyatIdxRef.current;
  const localPlaying   = localPlayingRef.current;
  const timestampsMapRef = useRef({});
  const tsVersionRef = useRef(0);
  const [tsVersion, setTsVersion] = useState(0);
  const timestampsMap = timestampsMapRef.current;
  const mainCurrentMsRef = useRef(0);

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

  const searchSelectionInCollections = () => {
    if (!selMenu?.text) return;
    setPendingSearchQuery(selMenu.text);
    setSelMenu(null);
    navigate("/collections");
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
        dispatch(uiActions.setOpenAyatNum(urlAyatNum));
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
    dispatch(uiActions.setOpenAyatNum(an));
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

  const currentReciter = getGlobalRecitator();

  const handleNavigateFromPages = (surahNum, ayatNum) => {
    dispatch(quranActions.setSelectedSurah(surahNum));
    dispatch(uiActions.setOpenAyatNum(ayatNum));
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
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
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

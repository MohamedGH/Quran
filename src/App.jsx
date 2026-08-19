import React,{ useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { Provider, useSelector, useDispatch, shallowEqual } from "react-redux";
import { store, sel, uiActions, quranActions, playerActions, learnActions, collectionsActions, voiceActions, goalsActions, setLDataThunk } from "./store";
import { CapacitorAudioRecorder } from '@capgo/capacitor-audio-recorder';
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";

// ─── Firebase config ─────────────────────────────────────────────────────────
// Replace with your actual Firebase project config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const firebaseApp  = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const firebaseDb   = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// ─── Android / Capacitor detection ───────────────────────────────────────────
const IS_ANDROID = typeof window !== 'undefined' &&
  (typeof window.Capacitor !== 'undefined' && /Android/i.test(navigator.userAgent));

// ─── Unified audio recorder abstraction ──────────────────────────────────────
// Android APK  → CapacitorAudioRecorder
// Web / iOS    → MediaRecorder
// API: { start(), stop() → Promise<blobUrl|null>, release() }
function createAudioRecorder() {
  if (IS_ANDROID) {
    let _started = false;
    return {
      async start() {
        const perm = await CapacitorAudioRecorder.requestPermission().catch(() => null);
        if (perm?.granted === false) throw new Error("Permission microphone refusée");
        await CapacitorAudioRecorder.startRecording();
        _started = true;
      },
      async stop() {
        if (!_started) return null;
        _started = false;
        const result = await CapacitorAudioRecorder.stopRecording();
        // Priorité à result.uri + Capacitor.convertFileSrc (chemin natif → URL lisible par WebView)
        if (result?.uri) {
          return window.Capacitor?.convertFileSrc(result.uri) ?? result.uri;
        }
        // Fallback base64
        const raw = result?.value ?? result?.recordDataBase64 ?? result?.blob ?? null;
        if (!raw) return null;
       // const bin = atob(raw); const buf = new Uint8Array(bin.length);
       // for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return URL.createObjectURL(raw);
      },
      release() { if (_started) { CapacitorAudioRecorder.stopRecording().catch(()=>{}); _started = false; } },
    };
  }
  // Web MediaRecorder with gain boost
  let _stream, _mr, _chunks = [], _mime = "", _actx = null;
  return {
    async start(gainValue = 4.0) {
      _stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      // Boost volume via WebAudio GainNode → record the boosted stream
      let recordStream = _stream;
      try {
        _actx = new (window.AudioContext || window.webkitAudioContext)();
        const src  = _actx.createMediaStreamSource(_stream);
        const gain = _actx.createGain();
        gain.gain.value = gainValue;
        const dst  = _actx.createMediaStreamDestination();
        src.connect(gain);
        gain.connect(dst);
        recordStream = dst.stream;
      } catch (e) {
        console.warn("[Recorder] GainNode unavailable, recording raw:", e);
        recordStream = _stream;
      }

      _mime = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"]
        .find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
      _mr = new MediaRecorder(recordStream, _mime ? { mimeType: _mime } : undefined);
      _chunks = [];
      _mr.ondataavailable = e => { if (e.data?.size > 0) _chunks.push(e.data); };
      _mr.start(200);
    },
    stop() {
      return new Promise(resolve => {
        if (!_mr || _mr.state === "inactive") { resolve(null); return; }
        _mr.onstop = () => {
          _stream?.getTracks().forEach(t => t.stop());
          try { _actx?.close(); } catch {}
          _actx = null;
          resolve(_chunks.length ? URL.createObjectURL(new Blob(_chunks, { type: _mime || "audio/webm" })) : null);
        };
        _mr.stop();
      });
    },
    release() {
      try { if (_mr?.state !== "inactive") _mr?.stop(); } catch {}
      _stream?.getTracks().forEach(t => t.stop());
      try { _actx?.close(); } catch {}
      _actx = null;
    },
  };
}


// ─── SURAH NAME MAP (French + Arabic + English for voice recognition) ─────────
const SURAH_NAMES = {
  "fatiha":1,"al-fatiha":1,"fatihah":1,"ouverture":1,
  "baqara":2,"al-baqara":2,"vache":2,"bakara":2,
  "imran":3,"al-imran":3,"famille d'imran":3,
  "nisa":4,"an-nisa":4,"femmes":4,
  "maida":5,"al-maida":5,"table":5,
  "anam":6,"al-anam":6,"troupeaux":6,
  "araf":7,"al-araf":7,"murailles":7,
  "anfal":8,"al-anfal":8,"dépouilles":8,
  "tawba":9,"at-tawba":9,"repentir":9,
  "yunus":10,"younes":10,"jonas":10,
  "hud":11,"houd":11,
  "yusuf":12,"youssef":12,"joseph":12,
  "rad":13,"ar-rad":13,"tonnerre":13,
  "ibrahim":14,"abraham":14,
  "hijr":15,"al-hijr":15,
  "nahl":16,"an-nahl":16,"abeilles":16,
  "isra":17,"al-isra":17,"voyage nocturne":17,
  "kahf":18,"al-kahf":18,"caverne":18,
  "maryam":19,"marie":19,
  "taha":20,"ta-ha":20,
  "anbiya":21,"al-anbiya":21,"prophètes":21,
  "hajj":22,"pèlerinage":22,
  "muminun":23,"croyants":23,
  "nur":24,"an-nur":24,"lumière":24,
  "furqan":25,"al-furqan":25,"critère":25,
  "shuara":26,"poètes":26,
  "naml":27,"an-naml":27,"fourmis":27,
  "qasas":28,"al-qasas":28,"récits":28,
  "ankabut":29,"araignée":29,
  "rum":30,"ar-rum":30,"romains":30,
  "luqman":31,"lokman":31,
  "sajda":32,"as-sajda":32,"prosternation":32,
  "ahzab":33,"al-ahzab":33,"coalisés":33,
  "saba":34,"saba'":34,
  "fatir":35,"créateur":35,
  "yasin":36,"ya-sin":36,
  "saffat":37,"as-saffat":37,"rangés":37,
  "sad":38,
  "zumar":39,"az-zumar":39,"groupes":39,
  "ghafir":40,"al-ghafir":40,"pardonneur":40,
  "fussilat":41,"explicitement":41,
  "shura":42,"ash-shura":42,"concertation":42,
  "zukhruf":43,"az-zukhruf":43,"ornements":43,
  "dukhan":44,"ad-dukhan":44,"fumée":44,
  "jathiya":45,"al-jathiya":45,"agenouillée":45,
  "ahqaf":46,"al-ahqaf":46,
  "muhammad":47,"combat":47,
  "fath":48,"al-fath":48,"victoire":48,
  "hujurat":49,"al-hujurat":49,"appartements":49,
  "qaf":50,
  "dhariyat":51,"adh-dhariyat":51,"vents":51,
  "tur":52,"at-tur":52,"mont":52,
  "najm":53,"an-najm":53,"étoile":53,
  "qamar":54,"al-qamar":54,"lune":54,
  "rahman":55,"ar-rahman":55,"miséricordieux":55,
  "waqia":56,"al-waqia":56,"événement":56,
  "hadid":57,"al-hadid":57,"fer":57,
  "mujadila":58,"al-mujadila":58,"discussion":58,
  "hashr":59,"al-hashr":59,"rassemblement":59,
  "mumtahana":60,"al-mumtahana":60,"éprouvée":60,
  "saff":61,"as-saff":61,"rang":61,
  "juma":62,"al-juma":62,"vendredi":62,
  "munafiqun":63,"hypocrites":63,
  "taghabun":64,"at-taghabun":64,"tromperie":64,
  "talaq":65,"at-talaq":65,"divorce":65,
  "tahrim":66,"at-tahrim":66,"interdiction":66,
  "mulk":67,"al-mulk":67,"royauté":67,
  "qalam":68,"al-qalam":68,"plume":68,
  "haqqa":69,"al-haqqa":69,"inévitable":69,
  "maarij":70,"al-maarij":70,"degrés":70,
  "nuh":71,"noé":71,
  "jinn":72,"al-jinn":72,"djinns":72,
  "muzzammil":73,"al-muzzammil":73,"enveloppé":73,
  "muddaththir":74,"al-muddaththir":74,"revêtu":74,
  "qiyama":75,"al-qiyama":75,"résurrection":75,
  "insan":76,"al-insan":76,"homme":76,
  "mursalat":77,"al-mursalat":77,"envoyés":77,
  "naba":78,"an-naba":78,"nouvelle":78,
  "naziat":79,"an-naziat":79,"arracheurs":79,
  "abasa":80,"froncement":80,
  "takwir":81,"at-takwir":81,"obscurcissement":81,
  "infitar":82,"al-infitar":82,"fissure":82,
  "mutaffifin":83,"fraudeurs":83,
  "inshiqaq":84,"al-inshiqaq":84,"déchirement":84,
  "buruj":85,"al-buruj":85,"constellations":85,
  "tariq":86,"at-tariq":86,"nocturne":86,
  "ala":87,"al-ala":87,"très-haut":87,
  "ghashiya":88,"al-ghashiya":88,"enveloppante":88,
  "fajr":89,"al-fajr":89,"aube":89,
  "balad":90,"al-balad":90,"cité":90,
  "shams":91,"ash-shams":91,"soleil":91,
  "layl":92,"al-layl":92,"nuit":92,
  "duha":93,"ad-duha":93,"matinée":93,
  "sharh":94,"inshirah":94,"ouverture de cœur":94,
  "tin":95,"at-tin":95,"figuier":95,
  "alaq":96,"al-alaq":96,"adhérence":96,
  "qadr":97,"al-qadr":97,"destin":97,
  "bayyina":98,"al-bayyina":98,"preuve":98,
  "zalzala":99,"az-zalzala":99,"séisme":99,
  "adiyat":100,"al-adiyat":100,"coursiers":100,
  "qaria":101,"al-qaria":101,"fracas":101,
  "takathur":102,"at-takathur":102,"accumulation":102,
  "asr":103,"al-asr":103,"après-midi":103,
  "humaza":104,"al-humaza":104,"calomniateur":104,
  "fil":105,"al-fil":105,"éléphant":105,
  "quraysh":106,"coréishites":106,
  "maun":107,"al-maun":107,"ustensiles":107,
  "kawthar":108,"al-kawthar":108,"abondance":108,
  "kafirun":109,"al-kafirun":109,"infidèles":109,
  "nasr":110,"an-nasr":110,"secours":110,
  "masad":111,"al-masad":111,"fibre":111,
  "ikhlas":112,"al-ikhlas":112,"sincérité":112,
  "falaq":113,"al-falaq":113,"aube naissante":113,
  "nas":114,"an-nas":114,"humanité":114,
};

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
  /* On non-quran pages sidebar floats as a full-height drawer */
  .sidebar.sidebar-floating{
    position:absolute;left:0;top:0;bottom:0;z-index:300;
    transform:translateX(-100%);box-shadow:4px 0 24px rgba(0,0,0,.4);
  }
  .sidebar.sidebar-floating.open{transform:translateX(0);}
  /* On quran page desktop (non-floating): toggle width on open/close */
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

  /* ── LEARN SECTION ────────────────────────────────────────────────── */
  .learn-section{display:flex;flex-direction:column;gap:14px;}
  .learn-status-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
  .learn-stat{font-size:10px;letter-spacing:1px;color:var(--text3);display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--surface3);border-radius:var(--radius-sm);border:1px solid var(--border);}
  .learn-stat .val{color:var(--gold2);}
  .learn-stat.learned-stat{border-color:var(--green);color:var(--green);}
  .learn-stat.learned-stat .val{color:var(--green2);}
  .parts-title{font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:8px;}
  .create-mode-hint{font-size:9px;letter-spacing:1px;color:var(--teal);margin-bottom:6px;padding:6px 10px;background:rgba(62,184,160,.06);border-radius:var(--radius-sm);}
  .words-area{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;direction:rtl;justify-content:flex-end;}
  .word-btn{font-family:'Amiri Quran',serif;font-size:18px;padding:4px 8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--transition);}
  .word-btn:hover{border-color:var(--gold);color:var(--gold);}
  .word-btn.word-learned{border-color:var(--green);color:var(--green2);background:rgba(76,175,129,.06);}
  .parts-divider{height:1px;background:var(--border);margin:8px 0;}
  .part-item{border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden;}
  .part-item.part-learned{border-color:var(--learned-border);background:rgba(26,46,32,.3);}
  .part-header{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface3);}
  .part-label{font-size:10px;letter-spacing:1px;color:var(--text3);flex:1;}
  .part-arabic{font-family:'Amiri Quran',serif;font-size:18px;direction:rtl;text-align:right;padding:8px 12px 10px;color:var(--text2);line-height:1.8;}
  .part-learned .part-arabic{color:var(--green2);}

  /* ── RECITATION ───────────────────────────────────────────────────── */
  .recit-section{display:flex;flex-direction:column;gap:0;margin-top:0;padding-top:16px;border-top:1px solid var(--border);}
  .recit-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;}
  .recit-title{font-size:9px;letter-spacing:3px;color:var(--text3);display:flex;align-items:center;gap:8px;font-family:'Cinzel',serif;}
  .recit-title-icon{width:26px;height:26px;border-radius:50%;background:rgba(62,184,160,.12);border:1px solid var(--teal);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}
  .recit-tabs{display:flex;gap:0;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:14px;}
  .recit-tab{flex:1;padding:8px 4px;font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;background:transparent;color:var(--text3);border:none;cursor:pointer;transition:all var(--transition);text-align:center;}
  .recit-tab:hover{background:rgba(255,255,255,.04);color:var(--text2);}
  .recit-tab.active{background:rgba(62,184,160,.1);color:var(--teal);border-bottom:2px solid var(--teal);}
  .recit-mic-zone{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 16px;background:var(--surface3);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;transition:border-color .3s;}
  .recit-mic-zone.active{border-color:var(--red);background:rgba(224,90,90,.04);}
  .recit-mic-circle{width:64px;height:64px;border-radius:50%;border:2px solid var(--teal);background:rgba(62,184,160,.08);display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;transition:all .25s;position:relative;touch-action:manipulation;}
  .recit-mic-circle:hover,.recit-mic-circle:active{transform:scale(1.06);background:rgba(62,184,160,.16);}
  .recit-mic-circle.recording{border-color:var(--red);background:rgba(224,90,90,.12);animation:micPulse 1s ease-in-out infinite;}
  @keyframes micPulse{0%,100%{box-shadow:0 0 0 0 rgba(224,90,90,.4)}50%{box-shadow:0 0 0 12px rgba(224,90,90,0)}}
  .recit-mic-label{font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;color:var(--text3);}
  .recit-mic-label.recording{color:var(--red);}
  .recit-live-box{width:100%;min-height:40px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:10px 14px;font-family:'Amiri Quran',serif;font-size:18px;direction:rtl;text-align:right;color:var(--text2);line-height:1.8;transition:border-color .2s;}
  .recit-live-box.has-text{border-color:var(--teal);}
  .recit-live-placeholder{color:var(--text3);font-family:'Cinzel',serif;font-size:9px;direction:ltr;text-align:center;letter-spacing:1px;padding:4px 0;}
  .recit-textarea{width:100%;background:var(--surface3);border:1px solid var(--border2);border-radius:var(--radius);padding:12px 16px;color:var(--text);font-family:'Amiri Quran',serif;font-size:22px;direction:rtl;text-align:right;resize:none;outline:none;line-height:1.8;transition:border-color var(--transition);margin-bottom:8px;}
  .recit-textarea:focus{border-color:var(--gold);}
  .recit-textarea::placeholder{color:var(--text3);font-family:'Cinzel',serif;font-size:11px;direction:ltr;text-align:left;}
  .recit-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .recit-score-ring{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px;background:var(--surface3);border-radius:12px;border:1px solid var(--border);margin-bottom:14px;}
  .recit-score-arc{position:relative;width:80px;height:80px;}
  .recit-score-arc svg{transform:rotate(-90deg);}
  .recit-score-arc-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:20px;font-weight:700;letter-spacing:-1px;}
  .recit-score-arc-num.perfect{color:var(--green2);}
  .recit-score-arc-num.good{color:var(--gold2);}
  .recit-score-arc-num.bad{color:var(--red);}
  .recit-score-label{font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;}
  .recit-score-label.perfect{color:var(--green2);}
  .recit-score-label.good{color:var(--gold2);}
  .recit-score-label.bad{color:var(--red);}
  .recit-compare{font-family:'Amiri Quran',serif;font-size:26px;direction:rtl;text-align:right;line-height:2.4;padding:12px 16px;background:var(--surface3);border-radius:var(--radius);border:1px solid var(--border);}
  .recit-char-ok{color:var(--green2);}
  .recit-char-near{color:#e8a020;text-decoration:underline wavy #e8a020;}
  .recit-char-err{color:var(--red);text-decoration:underline wavy var(--red);}
  .recit-char-miss{color:var(--border2);text-decoration:underline dotted var(--text3);}
  .recit-char-silent{color:var(--gold);opacity:0.65;font-style:italic;}
  .recit-wasl-fatha{color:var(--gold2);}
  .recit-wasl-damma{color:var(--teal);}
  .recit-wasl-kasra{color:var(--text2);}
  .recit-word-wrap{display:inline;margin:0 3px;}
  .recit-word-wrap.word-ok{border-bottom:2px solid rgba(76,175,129,.35);}
  .recit-word-wrap.word-err{border-bottom:2px solid rgba(224,90,90,.4);}
  .recit-word-wrap.word-del{color:var(--red);opacity:.5;text-decoration:line-through;}
  .recit-word-wrap.word-silent{}
  .recit-legend{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px;}
  .recit-legend-pill{display:inline-flex;align-items:center;gap:4px;font-family:'Cinzel',serif;font-size:8px;letter-spacing:1px;padding:3px 8px;border-radius:20px;opacity:.85;}
  .recit-replay{font-family:'Amiri Quran',serif;font-size:17px;direction:rtl;text-align:right;color:var(--text3);padding:8px 12px;background:var(--surface3);border-radius:var(--radius-sm);border:1px solid var(--border);margin-top:8px;line-height:1.8;}
  .recit-debug-toggle{margin-top:12px;width:100%;text-align:center;}
  .recit-debug-table{width:100%;border-collapse:collapse;font-size:11px;font-family:monospace;direction:ltr;}
  .recit-debug-table th{padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text3);font-size:9px;letter-spacing:1px;white-space:nowrap;background:var(--surface3);}
  .recit-debug-table td{padding:4px 8px;border-bottom:1px solid var(--border);vertical-align:top;}

  /* ── REVISION PAGE ───────────────────────────────────────────────── */
  .rev-page{flex:1;overflow-y:auto;padding:24px 28px 80px;display:flex;flex-direction:column;gap:20px;}
  .rev-header-block{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;}
  .rev-title{font-size:18px;letter-spacing:3px;color:var(--gold2);font-weight:700;}
  .rev-subtitle{font-size:9px;letter-spacing:2px;color:var(--text3);margin-top:4px;}
  .rev-stats-row{display:flex;gap:10px;flex-wrap:wrap;}
  .rev-stat-pill{display:flex;flex-direction:column;align-items:center;padding:8px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);}
  .rev-stat-num{font-size:20px;color:var(--gold2);font-weight:700;}
  .rev-stat-label{font-size:8px;letter-spacing:1.5px;color:var(--text3);margin-top:2px;}
  .rev-filter-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
  .rev-filter-btn{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;padding:5px 12px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;border-radius:var(--radius-sm);transition:all .2s;}
  .rev-filter-btn:hover{border-color:var(--text2);color:var(--text2);}
  .rev-filter-btn.active{border-color:var(--teal);color:var(--teal);background:rgba(62,184,160,.08);}
  .rev-surah-block{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);}
  .rev-surah-header{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;user-select:none;}
  .rev-surah-header:hover{background:rgba(255,255,255,.02);}
  .rev-surah-num{width:32px;height:32px;border-radius:50%;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text3);flex-shrink:0;}
  .rev-surah-name{flex:1;}
  .rev-surah-name-ar{font-family:'Amiri Quran',serif;font-size:18px;color:var(--text2);direction:rtl;}
  .rev-surah-name-en{font-size:10px;letter-spacing:1.5px;color:var(--text3);margin-top:2px;}
  .rev-surah-badge{font-size:9px;letter-spacing:1px;padding:3px 10px;border-radius:10px;border:1px solid var(--green);color:var(--green);white-space:nowrap;}
  .rev-ayat-grid{padding:0 16px 14px;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--border);}
  .rev-ayat-card{border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;}
  .rev-ayat-card.rev-ayat-active{border-color:var(--teal);}
  .rev-ayat-card-header{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface2);cursor:pointer;}
  .rev-ayat-card-header:hover{background:var(--surface3);}
  .rev-ayat-num{width:28px;height:28px;border-radius:50%;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text3);flex-shrink:0;}
  .rev-ayat-text-preview{font-family:'Amiri Quran',serif;font-size:15px;direction:rtl;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;}
  .rev-ayat-score-badge{font-size:9px;letter-spacing:1px;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;}
  .rev-ayat-score-badge.perfect{border:1px solid var(--green);color:var(--green);}
  .rev-ayat-score-badge.good{border:1px solid var(--gold);color:var(--gold);}
  .rev-ayat-score-badge.bad{border:1px solid var(--red);color:var(--red);}
  .rev-ayat-score-badge.none{border:1px solid var(--border2);color:var(--text3);}
  .rev-ayat-body{padding:14px 14px 10px;display:flex;flex-direction:column;gap:12px;}
  .rev-ayat-arabic{font-family:'Amiri Quran',serif;font-size:24px;direction:rtl;text-align:right;color:var(--text);line-height:1.9;padding:10px 14px;background:var(--surface2);border-radius:var(--radius-sm);}
  .rev-empty{text-align:center;padding:60px 20px;color:var(--text3);font-size:11px;letter-spacing:2px;}
  .rev-progress-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:4px;}
  .rev-progress-fill{height:100%;border-radius:2px;transition:width .4s ease;}
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

  /* ── DASHBOARD PAGE ──────────────────────────────────────────────── */
  .dash-page{flex:1;overflow-y:auto;padding:24px 28px 60px;display:flex;flex-direction:column;gap:24px;}
  .dash-kpi-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;}
  .dash-kpi{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:18px 16px;display:flex;flex-direction:column;gap:6px;position:relative;overflow:hidden;transition:border-color .2s;}
  .dash-kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--kpi-color,var(--gold));}
  .dash-kpi-val{font-family:'Cinzel',serif;font-size:28px;font-weight:700;color:var(--kpi-color,var(--gold));letter-spacing:-1px;line-height:1;}
  .dash-kpi-label{font-size:9px;letter-spacing:2px;color:var(--text3);}
  .dash-kpi-sub{font-size:9px;color:var(--text2);}
  .dash-section-title{font-size:9px;letter-spacing:3px;color:var(--gold);margin-bottom:12px;display:flex;align-items:center;gap:10px;}
  .dash-section-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent);}
  .dash-two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;}
  .dash-card{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:18px 20px;}
  .dash-surah-bar{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(42,47,64,.4);cursor:pointer;transition:background .15s;}
  .dash-surah-bar:last-child{border-bottom:none;}
  .dash-surah-bar:hover{background:rgba(255,255,255,.02);}
  .dash-surah-num{width:22px;font-size:9px;color:var(--text3);flex-shrink:0;text-align:right;}
  .dash-surah-name{font-size:10px;letter-spacing:.5px;color:var(--text2);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .dash-surah-ar{font-family:'Amiri',serif;font-size:14px;color:var(--gold);direction:rtl;flex-shrink:0;}
  .dash-bar-track{flex:1;max-width:90px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;}
  .dash-bar-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--teal),var(--green));}
  .dash-bar-pct{font-size:9px;color:var(--text3);width:28px;text-align:right;flex-shrink:0;}
  .dash-heatmap{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
  .dash-heatmap-cell{aspect-ratio:1;border-radius:3px;background:var(--surface3);border:1px solid var(--border);transition:transform .15s;cursor:default;}
  .dash-heatmap-cell:hover{transform:scale(1.15);}
  .dash-streak-badge{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;border:1px solid var(--gold);background:rgba(201,168,76,.06);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;color:var(--gold2);}
  .dash-activity-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(42,47,64,.4);}
  .dash-activity-row:last-child{border-bottom:none;}
  .dash-activity-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
  .dash-activity-text{font-size:10px;color:var(--text2);flex:1;}
  .dash-activity-time{font-size:9px;color:var(--text3);}
  .dash-donut-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap;}
  .dash-legend-item{display:flex;align-items:center;gap:6px;font-size:9px;letter-spacing:.5px;color:var(--text2);}
  .dash-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
  .dash-ring-label{font-family:'Cinzel',serif;font-size:10px;letter-spacing:2px;color:var(--text3);text-align:center;margin-top:4px;}
  .dash-empty-hint{font-size:10px;color:var(--text3);letter-spacing:1px;text-align:center;padding:20px 0;}
  @media(max-width:700px){
    .dash-two-col{grid-template-columns:1fr;}
    .dash-page{padding:12px 8px 60px;}
    .dash-kpi-row{grid-template-columns:repeat(2,1fr);}
    .dash-card{min-width:0;max-width:100%;overflow-x:hidden;}
    /* Force all dashboard grid cells to full width */
    .dash-widget-cell{grid-column:1 / -1 !important;max-width:100%;min-width:0;}
  }
  @media(max-width:480px){
    .dash-kpi-row{grid-template-columns:repeat(2,1fr);}
    .dash-kpi{padding:10px 8px;min-width:0;}
    .dash-kpi-val{font-size:20px;}
  }

  /* ── PRONONCIATION PAGE ───────────────────────────────────────────── */
  .pronon-page{flex:1;overflow-y:auto;padding:24px 28px 80px;display:flex;flex-direction:column;gap:28px;}
  .pronon-section-title{font-size:9px;letter-spacing:3px;color:var(--gold);margin-bottom:14px;display:flex;align-items:center;gap:10px;}
  .pronon-section-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent);}
  .pronon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;}
  .pronon-card{
    background:var(--surface2);border:1px solid var(--border);border-radius:10px;
    padding:14px 8px 10px;cursor:pointer;transition:all .2s;
    display:flex;flex-direction:column;align-items:center;gap:6px;
    position:relative;overflow:hidden;
  }
  .pronon-card:hover{border-color:var(--gold);background:var(--surface3);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3);}
  .pronon-card.selected{border-color:var(--teal);background:rgba(62,184,160,.07);box-shadow:0 0 0 2px rgba(62,184,160,.25);}
  .pronon-card.playing{border-color:var(--gold2);background:rgba(201,168,76,.08);}
  .pronon-letter{font-family:'Amiri Quran',serif;font-size:36px;color:var(--text);line-height:1.2;direction:rtl;}
  .pronon-letter-name{font-size:8px;letter-spacing:1px;color:var(--text3);text-align:center;font-family:'Cinzel',serif;}
  .pronon-letter-trans{font-size:9px;color:var(--teal2);letter-spacing:.5px;}
  .pronon-harakat-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;}
  .pronon-harakat-btn{
    background:var(--surface3);border:1px solid var(--border2);border-radius:8px;
    padding:10px 14px;cursor:pointer;transition:all .2s;
    display:flex;flex-direction:column;align-items:center;gap:4px;min-width:72px;
  }
  .pronon-harakat-btn:hover{border-color:var(--gold);background:rgba(201,168,76,.06);}
  .pronon-harakat-btn.playing{border-color:var(--teal);background:rgba(62,184,160,.08);}
  .pronon-harakat-arabic{font-family:'Amiri Quran',serif;font-size:28px;color:var(--gold2);direction:rtl;}
  .pronon-harakat-name{font-size:8px;letter-spacing:1px;color:var(--text3);font-family:'Cinzel',serif;text-align:center;}
  .pronon-harakat-desc{font-size:8px;color:var(--teal2);text-align:center;}
  .pronon-detail-panel{
    background:var(--surface2);border:1px solid var(--border2);border-radius:12px;
    padding:20px;display:flex;flex-direction:column;gap:16px;
    position:sticky;top:0;
  }
  .pronon-detail-letter{font-family:'Amiri Quran',serif;font-size:72px;color:var(--gold2);direction:rtl;text-align:center;line-height:1;}
  .pronon-detail-name{font-size:11px;letter-spacing:3px;color:var(--gold);text-align:center;}
  .pronon-detail-forms{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px;}
  .pronon-form-item{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 10px;background:var(--surface3);border-radius:6px;border:1px solid var(--border);}
  .pronon-form-arabic{font-family:'Amiri Quran',serif;font-size:22px;color:var(--text);direction:rtl;}
  .pronon-form-label{font-size:7px;letter-spacing:1px;color:var(--text3);font-family:'Cinzel',serif;}
  .pronon-detail-harakats{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}
  .pronon-detail-hbtn{
    display:flex;flex-direction:column;align-items:center;gap:3px;
    padding:10px 16px;background:var(--surface3);border:1px solid var(--border2);
    border-radius:8px;cursor:pointer;transition:all .2s;min-width:80px;
  }
  .pronon-detail-hbtn:hover{border-color:var(--teal);transform:scale(1.04);}
  .pronon-detail-hbtn.playing{border-color:var(--gold);background:rgba(201,168,76,.08);animation:softGlow .6s ease-in-out infinite alternate;}
  @keyframes softGlow{from{box-shadow:0 0 0 0 rgba(201,168,76,0);}to{box-shadow:0 0 12px 2px rgba(201,168,76,.2);}}
  .pronon-detail-hbtn-arabic{font-family:'Amiri Quran',serif;font-size:26px;color:var(--gold2);direction:rtl;}
  .pronon-detail-hbtn-name{font-size:8px;letter-spacing:1px;color:var(--text3);font-family:'Cinzel',serif;}
  .pronon-detail-hbtn-desc{font-size:8px;color:var(--teal);text-align:center;}
  .pronon-play-btn{
    display:flex;align-items:center;justify-content:center;gap:8px;
    padding:10px 20px;border:1px solid var(--teal);background:rgba(62,184,160,.08);
    border-radius:8px;cursor:pointer;font-family:'Cinzel',serif;font-size:9px;
    letter-spacing:2px;color:var(--teal);transition:all .2s;
  }
  .pronon-play-btn:hover{background:rgba(62,184,160,.16);}
  .pronon-play-btn.playing{border-color:var(--red);color:var(--red);background:rgba(224,90,90,.08);}
  .pronon-tip-box{padding:10px 14px;background:rgba(201,168,76,.05);border:1px solid rgba(201,168,76,.2);border-radius:8px;font-size:10px;color:var(--text2);line-height:1.6;}
  .pronon-makhraj-tag{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:10px;background:rgba(62,184,160,.1);border:1px solid rgba(62,184,160,.3);font-size:8px;letter-spacing:1px;color:var(--teal2);}
  .pronon-nav-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px;overflow-x:auto;flex-shrink:0;}
  .pronon-nav-tab{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;color:var(--text3);padding:10px 16px;background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap;flex-shrink:0;}
  .pronon-nav-tab:hover{color:var(--text2);}
  .pronon-nav-tab.active{color:var(--gold);border-bottom-color:var(--gold);}
  .pronon-two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;}
  @media (max-width:700px){.pronon-two-col{grid-template-columns:1fr;} .pronon-page{padding:16px 14px 80px;}}

  /* ── MISC ─────────────────────────────────────────────────────────── */
  .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--text3);font-size:11px;letter-spacing:2px;}
  .loading-ring{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  .empty-state{display:flex;align-items:center;justify-content:center;height:300px;color:var(--text3);font-size:11px;letter-spacing:2px;flex-direction:column;gap:12px;}
  /* ── Quran Book (CSS 3D Transforms — inspired by Codrops AnimatedBooks) ── */
  .qbook-wrapper{
    display:flex;flex-direction:column;height:100%;
    background:radial-gradient(ellipse at 50% 30%,#18090200 0%,#060200 100%);
    align-items:center;justify-content:space-between;overflow:hidden;position:relative;
    background-color:#0c0501;
  }
  /* ── Scene / perspective ── */
  .qbook-scene{
    perspective:2000px;perspective-origin:50% 40%;
    display:flex;align-items:center;justify-content:center;
    flex:1;width:100%;position:relative;
  }
  /* ── Book root ── */
  .qbook{
    position:relative;transform-style:preserve-3d;
    transition:transform .5s ease;
    transform:rotateX(4deg) rotateY(-1deg);
  }
  /* ── Hardcover front ── */
  .qbook-hc-front{
    position:absolute;top:0;left:0;width:100%;height:100%;
    transform-style:preserve-3d;transform-origin:left center;
    transition:transform .8s cubic-bezier(.645,.045,.355,1.000);
    z-index:100;
  }
  .qbook-hc-front > li:first-child{
    /* front face */
    position:absolute;top:0;left:0;width:100%;height:100%;
    border-radius:0 3px 3px 0;overflow:hidden;
    background:linear-gradient(135deg,#2d0e02 0%,#5c1e06 35%,#8b3410 55%,#5c1e06 75%,#2d0e02 100%);
    box-shadow:inset -6px 0 20px rgba(0,0,0,.5),inset 0 0 40px rgba(0,0,0,.3);
    backface-visibility:hidden;
    display:flex;align-items:center;justify-content:center;
  }
  .qbook-hc-front > li:last-child{
    /* back face of front cover (inside) */
    position:absolute;top:0;left:0;width:100%;height:100%;
    border-radius:0 3px 3px 0;overflow:hidden;
    background:linear-gradient(to right,#1a0500,#3d1208);
    transform:rotateY(180deg);backface-visibility:hidden;
  }
  /* front cover open state */
  .qbook-open .qbook-hc-front{
    transform:rotateY(-160deg);
  }
  /* Cover decorative design */
  .qbook-cover-design{
    position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:4px;
    padding:16px;
  }
  .qbook-cover-title{
    font-family:'Amiri Quran',serif;font-size:clamp(16px,4vw,32px);
    color:#c9a84c;direction:rtl;text-align:center;line-height:1.4;
    text-shadow:0 0 20px rgba(201,168,76,.4),0 2px 4px rgba(0,0,0,.6);
  }
  .qbook-cover-sub{
    font-family:'Cinzel',serif;font-size:clamp(6px,1.2vw,9px);
    letter-spacing:3px;color:rgba(201,168,76,.55);text-align:center;
    margin-top:4px;
  }
  /* Gold border on cover */
  .qbook-cover-design::before{
    content:'';position:absolute;inset:8%;
    border:1px solid rgba(201,168,76,.30);pointer-events:none;
  }
  .qbook-cover-design::after{
    content:'';position:absolute;inset:11%;
    border:1px solid rgba(201,168,76,.15);pointer-events:none;
  }
  /* Medallion ornament */
  .qbook-medallion{
    width:clamp(40px,8vw,70px);height:clamp(40px,8vw,70px);
    border-radius:50%;
    background:radial-gradient(circle,rgba(201,168,76,.25) 0%,rgba(201,168,76,.05) 60%,transparent 100%);
    border:1px solid rgba(201,168,76,.35);
    display:flex;align-items:center;justify-content:center;
    font-size:clamp(18px,3.5vw,28px);
    margin-bottom:4px;
  }
  /* ── Hardcover back ── */
  .qbook-hc-back{
    position:absolute;top:0;left:0;width:100%;height:100%;
    z-index:0;
  }
  .qbook-hc-back > li:first-child{
    position:absolute;top:0;left:0;width:100%;height:100%;
    border-radius:3px 0 0 3px;overflow:hidden;
    background:linear-gradient(135deg,#2d0e02,#4a1608,#2d0e02);
    box-shadow:-3px 0 10px rgba(0,0,0,.4),inset 3px 0 10px rgba(0,0,0,.3);
  }
  .qbook-hc-back > li:last-child{
    position:absolute;top:0;right:-8px;width:8px;height:100%;
    background:linear-gradient(to right,#1a0500,#0a0200);
    border-radius:0 2px 2px 0;
  }
  /* ── Spine ── */
  .qbook-spine-el{
    position:absolute;top:0;left:0;
    width:100%;height:100%;
    transform:translateX(-100%) rotateY(-90deg);
    transform-origin:right center;
    background:linear-gradient(to bottom,#0e0300,#3a1204,#7c3010,#c07828,#e8a840,#c07828,#7c3010,#3a1204,#0e0300);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
  }
  .qbook-spine-el::before{
    content:'';position:absolute;inset:0;
    background:repeating-linear-gradient(to bottom,transparent 0,transparent 18px,rgba(255,195,70,.10) 18px,rgba(255,195,70,.10) 19px);
  }
  .qbook-spine-text{
    writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);
    font-family:'Amiri Quran',serif;font-size:clamp(8px,1.5vw,12px);
    color:rgba(201,168,76,.55);letter-spacing:3px;white-space:nowrap;
    text-shadow:0 0 8px rgba(201,168,76,.2);
  }
  /* ── Pages stack ── */
  .qbook-pages{
    position:absolute;top:3px;left:3px;right:3px;bottom:3px;
    transform-style:preserve-3d;
  }
  .qbook-pages > li{
    position:absolute;top:0;left:0;width:100%;height:100%;
    border-radius:0 2px 2px 0;overflow:hidden;
    background:linear-gradient(to right,#f5ead0,#fdf8ea,#f5ead0);
  }
  .qbook-pages > li:nth-child(1){ transform:translateX(0px);background:#f0e4c0; }
  .qbook-pages > li:nth-child(2){ transform:translateX(-1px);background:#f3e8c8; }
  .qbook-pages > li:nth-child(3){ transform:translateX(-2px);background:#f6ecce; }
  .qbook-pages > li:nth-child(4){ transform:translateX(-3px);background:#f9f0d4; }
  .qbook-pages > li:nth-child(5){ transform:translateX(-4px);background:#fcf4da; }
  /* ── Individual flipping page ── */
  .qbook-page{
    position:absolute;top:0;height:100%;width:100%;
    transform-style:preserve-3d;transform-origin:left center;
    z-index:200;
  }
  .qbook-page-face{
    position:absolute;top:0;left:0;width:100%;height:100%;
    backface-visibility:hidden;overflow:hidden;
    border-radius:0 2px 2px 0;
    background:linear-gradient(160deg,#fef9ee 0%,#fdf3d8 40%,#faecc0 100%);
  }
  .qbook-page-face-back{
    transform:rotateY(180deg);
    background:linear-gradient(160deg,#fdf8e8 0%,#fcefd2 50%,#f8e4b8 100%);
  }
  /* Paper grain on pages */
  .qbook-page-face::after{
    content:'';position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply;opacity:.5;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='.08'/%3E%3C/svg%3E");
  }
  /* Flip animations */
  .qbook-flip-fwd{animation:qFlipFwd .72s cubic-bezier(.455,.030,.515,.955) forwards;}
  .qbook-flip-bwd{animation:qFlipBwd .72s cubic-bezier(.455,.030,.515,.955) forwards;}
  @keyframes qFlipFwd{
    0%  {transform:rotateY(0deg);z-index:200;}
    100%{transform:rotateY(-180deg);z-index:200;}
  }
  @keyframes qFlipBwd{
    0%  {transform:rotateY(-180deg);z-index:200;}
    100%{transform:rotateY(0deg);z-index:200;}
  }
  /* Shadow during page turn */
  .qbook-flip-fwd .qbook-page-face::before,
  .qbook-flip-bwd .qbook-page-face::before{
    content:'';position:absolute;inset:0;z-index:10;pointer-events:none;
    animation:qShadowFwd .72s cubic-bezier(.455,.030,.515,.955) forwards;
  }
  .qbook-flip-bwd .qbook-page-face::before{
    animation:qShadowBwd .72s cubic-bezier(.455,.030,.515,.955) forwards;
  }
  @keyframes qShadowFwd{
    0%  {background:linear-gradient(to right,rgba(0,0,0,.0),rgba(0,0,0,.0));}
    20% {background:linear-gradient(to right,rgba(0,0,0,.22),rgba(0,0,0,.0));}
    50% {background:linear-gradient(to left,rgba(0,0,0,.28),rgba(0,0,0,.05) 40%,transparent);}
    100%{background:linear-gradient(to right,rgba(0,0,0,.0),rgba(0,0,0,.0));}
  }
  @keyframes qShadowBwd{
    0%  {background:linear-gradient(to right,rgba(0,0,0,.0),rgba(0,0,0,.0));}
    20% {background:linear-gradient(to left,rgba(0,0,0,.22),rgba(0,0,0,.0));}
    50% {background:linear-gradient(to right,rgba(0,0,0,.28),rgba(0,0,0,.05) 40%,transparent);}
    100%{background:linear-gradient(to right,rgba(0,0,0,.0),rgba(0,0,0,.0));}
  }
  /* Click zones */
  .qbook-click{position:absolute;top:0;height:100%;width:44%;cursor:pointer;z-index:300;transition:background .2s;}
  .qbook-click-left{left:0;}.qbook-click-right{right:0;}
  .qbook-click:hover{background:rgba(255,240,180,.03);}
  /* Page content */
  .qbook-page-content{
    padding:clamp(8px,2%,20px) clamp(7px,2%,16px) clamp(6px,1.5%,12px);
    direction:rtl;font-family:'Amiri Quran',serif;color:#1a0a03;
    overflow:hidden;height:100%;display:flex;flex-direction:column;
    box-sizing:border-box;position:relative;
  }
  /* Inset border */
  .qbook-page-content::before{
    content:'';position:absolute;
    inset:clamp(4px,1.2%,8px);
    border:1px solid rgba(139,90,20,.14);pointer-events:none;border-radius:1px;
  }
  /* Spine shadow on page */
  .qbook-page-content::after{
    content:'';position:absolute;top:0;bottom:0;left:0;width:20%;
    background:linear-gradient(to right,rgba(0,0,0,.08),transparent);
    pointer-events:none;
  }
  .qbook-page-content-right::after{
    left:auto;right:0;
    background:linear-gradient(to left,rgba(0,0,0,.08),transparent);
  }
  .qbook-ayah-text{line-height:2.1;text-align:justify;word-break:break-word;flex:1;overflow:hidden;}
  .qbook-surah-header{
    text-align:center;font-family:'Cinzel',serif;font-size:clamp(7px,1.3vw,9px);letter-spacing:1.5px;
    color:#7a4010;
    border-top:1px solid rgba(139,90,20,.28);border-bottom:1px solid rgba(139,90,20,.28);
    padding:4px 0;margin:6px 0 4px;
    background:linear-gradient(to right,transparent,rgba(201,168,76,.09),transparent);
  }
  .qbook-basmala{
    text-align:center;font-family:'Amiri Quran',serif;color:#3d1a05;
    margin:3px 0 5px;direction:rtl;text-shadow:0 1px 2px rgba(255,255,255,.6);
  }
  .qbook-page-num{
    text-align:center;font-family:'Cinzel',serif;font-size:clamp(6px,1.1vw,7.5px);
    letter-spacing:2.5px;color:rgba(120,76,20,.48);
    padding-top:5px;border-top:1px solid rgba(139,90,20,.12);
    margin-top:auto;
  }
  .qbook-page-num::before,.qbook-page-num::after{content:'❧';font-size:8px;color:rgba(139,90,20,.22);margin:0 4px;}
  .qbook-ayah-num{font-size:.68em;color:#9b6020;padding:0 2px;vertical-align:middle;font-family:'Amiri Quran',serif;}
  .qbook-loading-page{display:flex;align-items:center;justify-content:center;height:100%;
    font-family:'Amiri Quran',serif;font-size:clamp(24px,5vw,40px);color:rgba(139,92,26,.14);direction:rtl;}
  /* Topbar */
  .qbook-topbar{
    display:flex;align-items:center;gap:10px;width:100%;padding:10px 20px;
    box-sizing:border-box;flex-shrink:0;flex-wrap:wrap;
    background:linear-gradient(to bottom,rgba(0,0,0,.38),transparent);
  }
  /* Bottom nav */
  .qbook-botnav{display:flex;align-items:center;gap:14px;padding:10px 0 16px;flex-shrink:0;flex-wrap:wrap;justify-content:center;}
  .qbook-navbtn{
    font-size:9px;letter-spacing:1.5px;padding:6px 18px;font-family:'Cinzel',serif;
    background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.30);
    color:var(--gold2);border-radius:8px;cursor:pointer;transition:all .2s;
  }
  .qbook-navbtn:hover:not(:disabled){background:rgba(201,168,76,.18);border-color:rgba(201,168,76,.55);}
  .qbook-navbtn:disabled{opacity:.3;cursor:default;}
  .qbook-navlabel{font-size:9px;letter-spacing:1.5px;color:rgba(201,168,76,.4);font-family:'Cinzel',serif;min-width:70px;text-align:center;}
  /* Progress bar */
  .qbook-progress{width:88px;height:2px;background:rgba(201,168,76,.10);border-radius:2px;overflow:hidden;margin-top:4px;}
  .qbook-progress-bar{height:100%;border-radius:2px;background:linear-gradient(to right,#7a3c0a,#c9a84c);transition:width .5s;}
  /* Open/close book button */
  .qbook-open-btn{
    font-size:clamp(7px,1.5vw,9px);letter-spacing:clamp(2px,0.5vw,3px);
    padding:clamp(4px,1vh,6px) clamp(12px,2.5vw,20px);
    font-family:'Cinzel',serif;border-radius:20px;cursor:pointer;
    background:rgba(0,0,0,.38);border:1px solid rgba(201,168,76,.25);
    color:rgba(201,168,76,.72);text-shadow:0 0 12px rgba(201,168,76,.35);
    animation:qbpulse 2.4s ease-in-out infinite;
  }
  @keyframes qbpulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
  /* Surah picker */
  .qbook-surah-select{
    background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.25);
    color:var(--gold2);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;
    border-radius:6px;padding:4px 8px;outline:none;cursor:pointer;
  }
  .qbook-surah-select option{background:#1a0a03;color:#c9a84c;}
  /* Responsive */
  @media(max-width:600px){
    .qbook-page-content{padding:8px 7px 6px;}
  }

  .empty-arabic{font-family:'Amiri Quran',serif;font-size:32px;color:var(--gold);opacity:.3;direction:rtl;}

  /* ══════════════════════════════════════════════════════════════════
     RESPONSIVE — TABLET  (≤ 900px)
  ══════════════════════════════════════════════════════════════════ */
  @media (max-width:900px) {
    :root{ --sidebar-w:240px; }
    .header-bismillah{ display:none; }
    .ayat-arabic{ font-size:22px; }
    .recit-compare{ font-size:22px; line-height:2.2; }
    .surah-header{ padding:12px 20px; }
    .surah-header-ornament{ font-size:28px; }
    .bismillah-line{ font-size:22px; padding:12px 18px; }
    .player-info{ display:none; }
  }

  /* ══════════════════════════════════════════════════════════════════
     RESPONSIVE — MOBILE  (≤ 640px)
  ══════════════════════════════════════════════════════════════════ */
  @media (max-width:640px) {
    :root{ --sidebar-w:100vw; --header-h:calc(52px + env(safe-area-inset-top, 0px)); --player-h:56px; }

    /* Header: Single compact fluid bar */
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

    /* Sidebar becomes a full-screen drawer aligned below header */
    .sidebar{
      position:fixed; top:var(--header-h); left:0; bottom:0; z-index:300;
      width:var(--sidebar-w); transform:translateX(-100%);
      transition:transform .25s ease;
      box-shadow:4px 0 32px rgba(0,0,0,.5);
    }
    .sidebar.open{ transform:translateX(0); }

    /* Overlay when sidebar open */
    .sidebar-overlay{
      display:none; position:fixed; inset:0; z-index:299;
      background:rgba(0,0,0,.5); backdrop-filter:blur(2px);
    }
    .sidebar-overlay.open{ display:block; }

    /* Main takes full width */
    .main{ width:100%; }

    /* Ayat list */
    .ayat-main{ padding:12px 14px; gap:10px; }
    .ayat-arabic{ font-size:20px; line-height:1.9; }
    .ayat-number-badge{ width:28px; height:28px; font-size:9px; }
    .submenu{ padding:12px 14px 16px; }

    /* Surah header compact */
    .surah-header{ padding:7px 10px; }
    .surah-header-ornament{ font-size:20px; }
    .surah-header-bismillah{ font-size:14px !important; }
    .surah-header-title{ font-size:8px; letter-spacing:1px; }
    .bismillah-line{ font-size:20px; padding:10px 14px; }

    /* TS bar compact */
    .ts-global-bar{ padding:6px 14px; gap:8px; }

    /* Player compact */
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

    /* Recitation */
    .recit-compare{ font-size:18px; line-height:2; padding:10px 10px; }
    .recit-score-arc{ width:68px; height:68px; }
    .recit-score-arc-num{ font-size:17px; }
    .recit-mic-circle{ width:56px; height:56px; font-size:22px; }
    .recit-mic-zone{ padding:14px 10px; }
    .recit-debug-table{ font-size:9px; }
    .recit-debug-table td,.recit-debug-table th{ padding:3px 4px; }

    /* Voice help full-width on mobile */
    .voice-help{ right:8px; left:8px; max-width:none; top:calc(var(--header-h) + 6px); }
  }

  /* ══════════════════════════════════════════════════════════════════
     RESPONSIVE — SMALL MOBILE  (≤ 400px)
  ══════════════════════════════════════════════════════════════════ */
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
    .recit-compare{ font-size:16px; }
    .surah-header-ornament{ font-size:18px; }
    .surah-header-bismillah{ font-size:14px !important; }
    .bismillah-line{ font-size:18px; }
  }

  /* ── COLLECTIONS PAGE ────────────────────────────────────────────── */
  .collections-page{flex:1;overflow-y:auto;padding:24px 28px 80px;display:flex;flex-direction:column;gap:20px;}
  .coll-top-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
  .coll-create-form{display:flex;gap:8px;align-items:center;flex:1;min-width:200px;}
  .coll-input{flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:9px 14px;color:var(--text);font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;outline:none;transition:border-color var(--transition);}
  .coll-input:focus{border-color:var(--gold);}
  .coll-input::placeholder{color:var(--text3);}
  .coll-list{display:flex;flex-direction:column;gap:14px;}
  .coll-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color var(--transition);}
  .coll-card:hover{border-color:var(--border2);}
  .coll-card-header{display:flex;align-items:center;gap:12px;padding:13px 18px;cursor:pointer;background:linear-gradient(135deg,var(--surface),var(--surface2));}
  .coll-card-header:hover{background:var(--surface2);}
  .coll-card-icon{width:34px;height:34px;border-radius:8px;background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.3);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .coll-card-name{font-size:11px;letter-spacing:2px;color:var(--gold2);font-weight:600;flex:1;}
  .coll-card-count{font-size:9px;letter-spacing:1px;color:var(--text3);padding:2px 8px;border:1px solid var(--border2);border-radius:10px;flex-shrink:0;}
  .coll-card-chevron{font-size:10px;color:var(--text3);transition:transform .2s;flex-shrink:0;}
  .coll-card-chevron.open{transform:rotate(90deg);}
  .coll-card-actions{display:flex;gap:6px;align-items:center;flex-shrink:0;}
  .coll-ayat-list{border-top:1px solid var(--border);display:flex;flex-direction:column;}
  .coll-ayat-row{display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-bottom:1px solid rgba(42,47,64,.4);transition:background var(--transition);}
  .coll-ayat-row:last-child{border-bottom:none;}
  .coll-ayat-row:hover{background:rgba(255,255,255,.02);}
  .coll-ayat-ref{display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;width:46px;}
  .coll-ayat-surah{font-size:8px;letter-spacing:1px;color:var(--text3);}
  .coll-ayat-num{width:28px;height:28px;border:1px solid var(--border2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);font-weight:600;}
  .coll-ayat-text{font-family:'Amiri Quran',serif;font-size:20px;line-height:1.9;direction:rtl;text-align:right;flex:1;color:var(--text);}
  .coll-ayat-btns{display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-self:center;}
  .coll-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:14px;color:var(--text3);}
  .coll-empty-arabic{font-family:'Amiri Quran',serif;font-size:36px;color:var(--gold);opacity:.3;direction:rtl;}
  .coll-empty-msg{font-size:10px;letter-spacing:2px;text-align:center;line-height:1.8;}
  /* Modal overlay for "add to collection" */
  .coll-modal-overlay{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;}
  .coll-modal{background:var(--surface2);border:1px solid var(--border2);border-radius:12px;padding:24px;width:100%;max-width:400px;display:flex;flex-direction:column;gap:16px;box-shadow:0 24px 64px rgba(0,0,0,.5);}
  .coll-modal-title{font-size:11px;letter-spacing:3px;color:var(--gold2);}
  .coll-modal-subtitle{font-family:'Amiri Quran',serif;font-size:17px;direction:rtl;text-align:right;color:var(--text2);line-height:1.7;padding:8px 12px;background:var(--surface3);border-radius:6px;border:1px solid var(--border);}
  .coll-modal-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;}
  .coll-modal-item{display:flex;align-items:center;gap:10px;padding:9px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .15s;}
  .coll-modal-item:hover{border-color:var(--gold);background:rgba(201,168,76,.07);}
  .coll-modal-item.selected{border-color:var(--teal);background:rgba(62,184,160,.08);}
  .coll-modal-check{width:18px;height:18px;border-radius:4px;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;transition:all .15s;}
  .coll-modal-item.selected .coll-modal-check{background:var(--teal);border-color:var(--teal);color:var(--bg);}
  .coll-modal-item-name{font-size:10px;letter-spacing:1.5px;color:var(--text2);flex:1;}
  .coll-modal-item-count{font-size:9px;color:var(--text3);}
  .coll-modal-actions{display:flex;gap:8px;justify-content:flex-end;}
  .coll-modal-new{display:flex;gap:8px;padding-top:8px;border-top:1px solid var(--border);}
  @media(max-width:640px){.collections-page{padding:16px 14px 80px;}.coll-top-bar{flex-direction:column;align-items:stretch;}.coll-ayat-text{font-size:17px;}}
  .coll-search-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid var(--border2);flex-shrink:0;}
  .coll-search-input{background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:7px 12px;color:var(--text);font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;outline:none;flex:1;min-width:140px;transition:border-color .2s;}
  .coll-search-input:focus{border-color:#c878ff;}
  .coll-search-chip{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;padding:5px 12px;border-radius:20px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;transition:all .2s;white-space:nowrap;}
  .coll-search-chip.active{border-color:#c878ff;color:#c878ff;background:rgba(200,120,255,.08);}
  .coll-search-results{flex:1;overflow-y:auto;padding:8px 0;}
  .coll-search-result-item{display:flex;align-items:flex-start;gap:10px;padding:10px 20px;border-bottom:1px solid rgba(42,47,64,.4);cursor:pointer;transition:background .15s;}
  .coll-search-result-item:hover{background:var(--surface2);}
  .coll-search-meta{font-size:9px;letter-spacing:1.5px;color:#c878ff;margin-bottom:4px;}
  .coll-search-arabic{font-family:'Amiri Quran',serif;font-size:18px;direction:rtl;text-align:right;line-height:1.8;color:var(--text);flex:1;}

  /* ── CALENDAR & GOALS ────────────────────────────────────────────── */
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
  .cal-day-name{font-size:8px;letter-spacing:1px;color:var(--text3);text-align:center;padding-bottom:4px;font-family:'Cinzel',serif;}
  .cal-cell{aspect-ratio:1;border-radius:6px;border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:default;transition:all .15s;position:relative;font-size:9px;color:var(--text3);}
  .cal-cell.today{border-color:var(--gold);color:var(--gold2);font-weight:700;}
  .cal-cell.has-activity{border-color:rgba(62,184,160,.4);}
  .cal-cell.goal-reached{background:rgba(62,184,160,.12);border-color:var(--teal);}
  .cal-cell.goal-partial{background:rgba(201,168,76,.08);border-color:rgba(201,168,76,.4);}
  .cal-cell.other-month{opacity:.3;}
  .cal-cell-num{font-family:'Cinzel',serif;font-size:9px;line-height:1;}
  .cal-cell-dot{width:4px;height:4px;border-radius:50%;flex-shrink:0;}
  .cal-month-nav{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
  .cal-month-title{flex:1;text-align:center;font-family:'Cinzel',serif;font-size:11px;letter-spacing:2px;color:var(--text2);}
  .cal-nav-btn{background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:4px 10px;color:var(--text3);cursor:pointer;font-size:12px;transition:all .15s;}
  .cal-nav-btn:hover{border-color:var(--gold);color:var(--gold);}
  .cal-legend{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap;}
  .cal-legend-item{display:flex;align-items:center;gap:5px;font-size:8px;letter-spacing:1px;color:var(--text3);}
  .cal-legend-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0;}
  /* Goals */
  .goals-grid{display:flex;flex-direction:column;gap:12px;}
  .goal-row{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;transition:border-color .15s;}
  .goal-row:hover{border-color:var(--border2);}
  .goal-icon{font-size:20px;flex-shrink:0;width:36px;text-align:center;}
  .goal-info{flex:1;min-width:0;}
  .goal-label{font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:3px;}
  .goal-value{font-family:'Cinzel',serif;font-size:13px;color:var(--text2);}
  .goal-track{flex:1;height:5px;background:var(--surface3);border-radius:3px;overflow:hidden;}
  .goal-fill{height:100%;border-radius:3px;transition:width .5s ease;}
  .goal-pct{font-family:'Cinzel',serif;font-size:10px;color:var(--text3);min-width:34px;text-align:right;}
  .goal-edit-btn{background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:4px 10px;color:var(--text3);cursor:pointer;font-size:9px;letter-spacing:1px;font-family:'Cinzel',serif;transition:all .15s;flex-shrink:0;}
  .goal-edit-btn:hover{border-color:var(--gold);color:var(--gold2);}
  .goal-input{background:var(--surface2);border:1px solid var(--gold);border-radius:6px;padding:4px 8px;color:var(--text);font-family:'Cinzel',serif;font-size:11px;width:60px;outline:none;text-align:center;}
  .goal-today-box{background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.2);border-radius:10px;padding:14px 18px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;}
  .goal-today-stat{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:70px;}
  .goal-today-val{font-family:'Cinzel',serif;font-size:20px;color:var(--gold2);}
  .goal-today-label{font-size:8px;letter-spacing:1.5px;color:var(--text3);text-align:center;}
  .goal-streak{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(224,90,90,.06);border:1px solid rgba(224,90,90,.2);border-radius:8px;}
  .goal-streak-fire{font-size:18px;}
  .goal-streak-num{font-family:'Cinzel',serif;font-size:16px;color:#e05a5a;}
  .goal-streak-label{font-size:8px;letter-spacing:1px;color:var(--text3);}
  @media(max-width:640px){.cal-cell{font-size:8px;}.cal-cell-num{font-size:8px;}}

  /* ── RECORDING ────────────────────────────────────────────────────── */
  .rec-wrap{display:flex;flex-direction:column;gap:14px;}
  .rec-btn{display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 20px;border-radius:50px;border:2px solid;cursor:pointer;font-family:'Cinzel',serif;font-size:10px;letter-spacing:2px;transition:all .2s;width:100%;}
  .rec-btn.idle{background:rgba(201,168,76,.08);border-color:var(--gold);color:var(--gold2);}
  .rec-btn.idle:hover{background:rgba(201,168,76,.16);}
  .rec-btn.recording{background:rgba(224,90,90,.15);border-color:var(--red);color:#e05a5a;animation:recPulse 1s ease-in-out infinite;}
  @keyframes recPulse{0%,100%{box-shadow:0 0 0 0 rgba(224,90,90,.4)}50%{box-shadow:0 0 0 8px rgba(224,90,90,0)}}
  .rec-dot{width:10px;height:10px;border-radius:50%;background:currentColor;flex-shrink:0;}
  .rec-timer{font-variant-numeric:tabular-nums;font-size:13px;font-family:'Cinzel',serif;color:var(--red);}
  .rec-list{display:flex;flex-direction:column;gap:8px;}
  .rec-item{background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .15s;}
  .rec-item:hover{border-color:var(--border2);}
  .rec-item-header{display:flex;align-items:center;gap:10px;padding:10px 14px;}
  .rec-item-icon{width:30px;height:30px;border-radius:50%;background:rgba(62,184,160,.1);border:1px solid rgba(62,184,160,.3);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}
  .rec-item-info{flex:1;min-width:0;}
  .rec-item-date{font-size:9px;letter-spacing:1px;color:var(--text3);}
  .rec-item-dur{font-family:'Cinzel',serif;font-size:11px;color:var(--teal2);}
  .rec-item-actions{display:flex;gap:6px;align-items:center;}
  .rec-audio{width:100%;padding:0 14px 10px;display:block;}
  .rec-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 14px 12px;}
  .rec-compare-label{font-size:8px;letter-spacing:1.5px;color:var(--text3);padding-bottom:4px;}

  /* ── INLINE PART PLAYER (floating under clicked part) ────────────── */
  .part-player-inline{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;margin:4px 0 2px;flex-wrap:wrap;}
  .part-player-btn{width:30px;height:30px;border-radius:50%;border:1.5px solid;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;background:transparent;flex-shrink:0;transition:all .15s;}
  .part-player-btn.play{border-color:var(--teal);color:var(--teal);}
  .part-player-btn.play:hover{background:rgba(62,184,160,.15);}
  .part-player-btn.stop{border-color:var(--red);color:var(--red);}
  .part-player-btn.stop:hover{background:rgba(224,90,90,.15);}
  .part-player-btn.loop-on{border-color:var(--gold);color:var(--gold2);background:rgba(201,168,76,.12);}
  .part-player-btn.loop-off{border-color:var(--border2);color:var(--text3);}
  .part-player-chars{font-family:'Amiri Quran',serif;font-size:20px;direction:rtl;flex:1;text-align:right;line-height:1.8;min-width:0;}
  .part-player-dur{font-family:'Cinzel',serif;font-size:9px;color:var(--text3);letter-spacing:1px;flex-shrink:0;}
  .part-player-progress{height:3px;background:var(--border2);border-radius:2px;overflow:hidden;width:100%;}
  .part-player-progress-fill{height:100%;background:var(--teal);border-radius:2px;transition:width .1s linear;}
  /* ── CREATE PART FROM AUDIO ────────────────────────────────────────── */
  .cpa-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;background:rgba(201,168,76,.04);border:1px solid rgba(201,168,76,.2);border-radius:10px;margin-top:8px;}
  .cpa-title{font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;color:var(--gold2);}
  .cpa-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
  .cpa-marker{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:80px;}
  .cpa-marker-label{font-size:8px;letter-spacing:1.5px;color:var(--text3);}
  .cpa-marker-time{font-family:'Cinzel',serif;font-size:13px;color:var(--text2);font-variant-numeric:tabular-nums;}
  .cpa-marker-time.set{color:var(--gold2);}
  .cpa-btn-capture{padding:6px 14px;border:1.5px solid var(--gold);background:rgba(201,168,76,.1);color:var(--gold2);border-radius:6px;cursor:pointer;font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;transition:all .15s;white-space:nowrap;}
  .cpa-btn-capture:hover{background:rgba(201,168,76,.2);}
  .cpa-btn-capture:active{transform:scale(.96);}
  .cpa-preview{font-family:'Amiri Quran',serif;font-size:20px;direction:rtl;text-align:right;padding:8px 12px;background:var(--surface3);border-radius:6px;border:1px solid var(--border);color:var(--text);line-height:1.9;}
  .cpa-preview-word{display:inline;transition:all .12s;}
  .cpa-preview-word.in-range{background:rgba(62,184,160,.2);outline:1px solid var(--teal);border-radius:3px;padding:0 2px;}
  .cpa-create-btn{padding:9px 18px;border:1.5px solid var(--teal);background:rgba(62,184,160,.1);color:var(--teal2);border-radius:8px;cursor:pointer;font-family:'Cinzel',serif;font-size:10px;letter-spacing:2px;transition:all .15s;align-self:flex-start;}
  .cpa-create-btn:hover{background:rgba(62,184,160,.2);}
  .cpa-create-btn:disabled{opacity:.4;cursor:default;}

  /* ── CONCORDANCE PAGE ─────────────────────────────────────────────── */
  .concord-page{flex:1;overflow-y:auto;padding:24px 28px 80px;display:flex;flex-direction:column;gap:20px;}
  .concord-search-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;}
  .concord-search-bar input{flex:1;min-width:200px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-family:'Amiri Quran',serif;font-size:20px;direction:rtl;text-align:right;outline:none;transition:border-color var(--transition);}
  .concord-search-bar input:focus{border-color:var(--gold);}
  .concord-search-bar input::placeholder{font-family:'Cinzel',serif;font-size:11px;direction:ltr;color:var(--text3);}
  .concord-filter-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
  .concord-filter-label{font-size:9px;letter-spacing:2px;color:var(--text3);flex-shrink:0;}
  .concord-surah-select{background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:5px 10px;color:var(--text2);font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;outline:none;cursor:pointer;max-width:200px;}
  .concord-surah-select:focus{border-color:var(--gold);}
  .concord-mode-tabs{display:flex;border:1px solid var(--border2);border-radius:var(--radius-sm);overflow:hidden;}
  .concord-mode-tab{font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;padding:5px 12px;background:transparent;color:var(--text3);border:none;cursor:pointer;border-right:1px solid var(--border2);transition:all .2s;white-space:nowrap;}
  .concord-mode-tab:last-child{border-right:none;}
  .concord-mode-tab.active{background:rgba(201,168,76,.12);color:var(--gold2);}
  .concord-results-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;}
  .concord-results-count{font-size:10px;letter-spacing:1.5px;color:var(--text3);}
  .concord-results-count span{color:var(--gold2);}
  .concord-group{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:0;}
  .concord-group-header{display:flex;align-items:center;gap:12px;padding:12px 18px;background:linear-gradient(90deg,var(--surface2),var(--surface));border-bottom:1px solid var(--border);cursor:pointer;transition:background .2s;user-select:none;}
  .concord-group-header:hover{background:var(--surface2);}
  .concord-group-num{width:28px;height:28px;border-radius:50%;background:var(--surface3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);font-weight:600;flex-shrink:0;}
  .concord-group-name{flex:1;font-size:11px;letter-spacing:1px;color:var(--text);}
  .concord-group-ar{font-family:'Amiri',serif;font-size:15px;color:var(--gold);direction:rtl;}
  .concord-group-badge{font-size:9px;letter-spacing:1px;padding:3px 8px;border-radius:10px;background:rgba(62,184,160,.1);border:1px solid rgba(62,184,160,.3);color:var(--teal2);flex-shrink:0;}
  .concord-group-chevron{font-size:10px;color:var(--text3);transition:transform .2s;flex-shrink:0;}
  .concord-group-chevron.open{transform:rotate(90deg);}
  .concord-ayat-item{display:flex;align-items:flex-start;gap:14px;padding:14px 18px;border-bottom:1px solid rgba(42,47,64,.3);transition:background .15s;cursor:pointer;}
  .concord-ayat-item:last-child{border-bottom:none;}
  .concord-ayat-item:hover{background:rgba(255,255,255,.02);}
  .concord-ayat-num{width:30px;height:30px;border:1px solid var(--border2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text3);flex-shrink:0;margin-top:4px;}
  .concord-ayat-text{font-family:'Amiri Quran',serif;font-size:22px;direction:rtl;text-align:right;flex:1;line-height:2;color:var(--text);}
  .concord-highlight{background:rgba(201,168,76,.25);color:var(--gold2);border-radius:3px;padding:0 2px;}
  .concord-ayat-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;align-items:flex-end;}
  .concord-go-btn{font-family:'Cinzel',serif;font-size:8px;letter-spacing:1px;padding:5px 10px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;border-radius:var(--radius-sm);transition:all .2s;white-space:nowrap;}
  .concord-go-btn:hover{border-color:var(--gold);color:var(--gold);}
  .concord-link-btn{font-family:'Cinzel',serif;font-size:8px;letter-spacing:1px;padding:5px 10px;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;border-radius:var(--radius-sm);transition:all .2s;}
  .concord-link-btn:hover{border-color:var(--teal);color:var(--teal);}
  .concord-link-btn.linked{border-color:var(--teal);color:var(--teal);background:rgba(62,184,160,.08);}
  .concord-links-panel{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:18px 20px;}
  .concord-links-title{font-size:9px;letter-spacing:3px;color:var(--gold);margin-bottom:14px;display:flex;align-items:center;gap:10px;}
  .concord-links-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent);}
  .concord-link-card{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid rgba(42,47,64,.3);cursor:pointer;transition:background .15s;}
  .concord-link-card:last-child{border-bottom:none;}
  .concord-link-card:hover{background:rgba(255,255,255,.02);}
  .concord-link-ref{font-size:9px;letter-spacing:1px;color:var(--gold2);flex-shrink:0;padding-top:4px;}
  .concord-link-text{font-family:'Amiri Quran',serif;font-size:19px;direction:rtl;text-align:right;flex:1;line-height:1.9;color:var(--text2);}
  .concord-link-remove{width:22px;height:22px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text3);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;}
  .concord-link-remove:hover{border-color:var(--red);color:var(--red);}
  .concord-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:60px 20px;color:var(--text3);}
  .concord-empty-arabic{font-family:'Amiri Quran',serif;font-size:40px;color:var(--gold);opacity:.25;direction:rtl;}
  .concord-empty-msg{font-size:11px;letter-spacing:2px;text-align:center;line-height:1.8;}
  .concord-loading{display:flex;align-items:center;gap:12px;padding:24px;justify-content:center;color:var(--text3);font-size:10px;letter-spacing:2px;}
  .concord-tag{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;border:1px solid var(--border2);background:var(--surface2);font-size:9px;letter-spacing:1px;color:var(--text2);cursor:pointer;transition:all .2s;}
  .concord-tag:hover{border-color:var(--gold);color:var(--gold);}
  .concord-tags-row{display:flex;flex-wrap:wrap;gap:6px;}
  @media(max-width:700px){.concord-page{padding:16px 14px 80px;}.concord-ayat-text{font-size:18px;}.concord-search-bar input{font-size:16px;}}

`;

const StyleTag = () => <style dangerouslySetInnerHTML={{ __html: CSS }} />;

const API = "https://api.alquran.cloud/v1";
const AUDIO_CDN_ROOT = 'https://cdn.islamic.network/quran/audio'; // bitrate is appended dynamically, see getAudioBase()
// Bitrate list: see BITRATE_FALLBACK_ORDER below (auto-detected per reciter).

const RECITATORS = [
  { id: 'ar.alafasy',            label: 'Mishary Al-Afasy',            flag: '🇰🇼' },
  { id: 'ar.abdulbasitmurattal', label: 'Abdul Basit (Murattal)',      flag: '🇪🇬' },
  { id: 'ar.abdullahbasfar',     label: 'Abdullah Basfar',             flag: '🇸🇦' },
  { id: 'ar.abdurrahmaansudais', label: 'Abdul Rahman Al-Sudais',      flag: '🇸🇦' },
  { id: 'ar.shaatree',           label: 'Abu Bakr Ash-Shaatree',       flag: '🇸🇦' },
  { id: 'ar.ahmedajamy',         label: 'Ahmed Al-Ajamy',              flag: '🇸🇦' },
  { id: 'ar.hanirifai',          label: 'Hani Ar-Rifai',               flag: '🇸🇦' },
  { id: 'ar.husary',             label: 'Mahmoud Khalil Al-Husary',    flag: '🇪🇬' },
  { id: 'ar.husarymujawwad',     label: 'Al-Husary (Mujawwad)',        flag: '🇪🇬' },
  { id: 'ar.hudhaify',           label: 'Ali Al-Hudhaify',             flag: '🇸🇦' },
  { id: 'ar.ibrahimakhbar',      label: 'Ibrahim Al-Akhdar',           flag: '🇸🇦' },
  { id: 'ar.mahermuaiqly',       label: 'Maher Al-Muaiqly',            flag: '🇸🇦' },
  { id: 'ar.minshawi',           label: 'Mohamed Siddiq Al-Minshawi',  flag: '🇪🇬' },
  { id: 'ar.minshawimujawwad',   label: 'Al-Minshawi (Mujawwad)',      flag: '🇪🇬' },
  { id: 'ar.muhammadayyoub',     label: 'Muhammad Ayyoub',             flag: '🇸🇦' },
  { id: 'ar.muhammadjibreel',    label: 'Muhammad Jibreel',            flag: '🇪🇬' },
  { id: 'ar.saoodshuraym',       label: 'Saud Al-Shuraim',             flag: '🇸🇦' },
  { id: 'ar.parhizgar',          label: 'Shahriar Parhizgar',          flag: '🇮🇷' },
  { id: 'ar.aymanswoaid',        label: 'Ayman Sowaid',                flag: '🇸🇾' },
];

let _recitatorId = (() => { try { return localStorage.getItem('quran_recitator') || 'ar.alafasy'; } catch { return 'ar.alafasy'; } })();

// Bitrate is automatic and per-reciter — not every reciter's audio is hosted at every bitrate.
// The official per-ayah API response (`audio` + `audioSecondary` fields) reports exactly which
// bitrate URLs actually exist for a given reciter — this is the same source data that backs
// cdn.islamic.network's info.json, fetched live via the API instead of parsing a static dump.
const BITRATE_FALLBACK_ORDER = [128, 64, 192, 48, 40, 32]; // generic guess, used only until the official list arrives
let _officialBitrates = (() => { try { return JSON.parse(localStorage.getItem('quran_official_bitrates')) || {}; } catch { return {}; } })();
let _bitrateByReciter  = (() => { try { return JSON.parse(localStorage.getItem('quran_bitrate_by_reciter')) || {}; } catch { return {}; } })();

const bitrateOrderFor  = (id) => (_officialBitrates[id]?.length ? _officialBitrates[id] : BITRATE_FALLBACK_ORDER);
const getReciterBitrate = (id) => _bitrateByReciter[id] ?? bitrateOrderFor(id)[0];
const setReciterBitrate = (id, kbps) => {
  _bitrateByReciter = { ..._bitrateByReciter, [id]: kbps };
  try { localStorage.setItem('quran_bitrate_by_reciter', JSON.stringify(_bitrateByReciter)); } catch {}
};
// Called when the current bitrate 404s for a reciter — advances to the next candidate in its
// (ideally official) list and remembers it, so this reciter "just works" from then on. Returns
// the new bitrate, or null if every candidate has already been exhausted.
const markBitrateBad = (id) => {
  const order = bitrateOrderFor(id);
  const cur   = getReciterBitrate(id);
  const next  = order[order.indexOf(cur) + 1];
  if (next == null) return null;
  setReciterBitrate(id, next);
  return next;
};
// Queries the official API for the bitrates actually available for a reciter and caches the
// result. `data.audio` is the primary URL, `data.audioSecondary` lists the rest — together they
// enumerate every working `{bitrate}` for that edition, straight from the source.
async function fetchOfficialBitrates(id) {
  if (_officialBitrates[id]) return _officialBitrates[id];
  try {
    const r = await fetch(`${API}/ayah/1/${id}`);
    const j = await r.json();
    const urls = [j?.data?.audio, ...(j?.data?.audioSecondary || [])].filter(Boolean);
    const kbps = [...new Set(urls
      .map(u => parseInt((u.match(/\/audio\/(\d+)\//) || [])[1], 10))
      .filter(n => !isNaN(n)))];
    if (!kbps.length) return null;
    kbps.sort((a, b) => (a === 128 ? -1 : b === 128 ? 1 : a - b)); // prefer 128 when it's an option
    _officialBitrates = { ..._officialBitrates, [id]: kbps };
    try { localStorage.setItem('quran_official_bitrates', JSON.stringify(_officialBitrates)); } catch {}
    // if what we had remembered for this reciter turns out not to be real, snap to the true default
    if (!kbps.includes(getReciterBitrate(id))) setReciterBitrate(id, kbps[0]);
    return kbps;
  } catch { return null; }
}
const getAudioBase = () => `${AUDIO_CDN_ROOT}/${getReciterBitrate(_recitatorId)}/${_recitatorId}`;
const setGlobalRecitator = (id) => { _recitatorId = id; try { localStorage.setItem('quran_recitator', id); } catch {} };
const getGlobalRecitator = () => _recitatorId;

// AUDIO_BASE removed — use getAudioBase() (dynamic, follows the selected reciter, bitrate is automatic)



async function fetchSurahs() {
  const idbKey = 'surahs';
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah`);
  const data = (await r.json()).data;
  idbSetQuran(idbKey, data).catch(() => {});
  return data;
}

// Translation editions keyed by lang code
const TRANS_EDITIONS = {
  fr: 'fr.hamidullah',
  en: 'en.sahih',
  tr: 'tr.diyanet',
  ur: 'ur.jalandhry',
  de: 'de.aburida',
  es: 'es.asad',
  id: 'id.indonesian',
  ru: 'ru.kuliev',
};
const TRANS_LABELS = { fr:'🇫🇷 FR', en:'🇬🇧 EN', tr:'🇹🇷 TR', ur:'🇵🇰 UR', de:'🇩🇪 DE', es:'🇪🇸 ES', id:'🇮🇩 ID', ru:'🇷🇺 RU' };

// fetchSurahTranslation(sn, lang) → [{numberInSurah, text}] cached in IDB
async function fetchSurahTranslation(sn, lang) {
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
async function fetchAyats(n) {
  const idbKey = `alafasy:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${n}/ar.alafasy`);
  const data = (await r.json()).data;
  idbSetQuran(idbKey, data).catch(() => {});
  return data;
}
// /surah/${n}/quran-simple  →  [{num, text}, …]
async function fetchSurahSimple(n) {
  const idbKey = `text:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${n}/quran-simple`);
  const data = (await r.json()).data?.ayahs || [];
  const ayats = data.map(a => ({ num: a.numberInSurah, text: a.text }));
  idbSetQuran(idbKey, ayats).catch(() => {});
  return ayats;
}
// /surah/${n}  (default edition — used for ayat texts in MemoriseMode etc.)
// Returns raw ayahs array from API data.ayahs
async function fetchSurahDefault(n) {
  const idbKey = `simple:${n}`;
  try { const c = await idbGetQuran(idbKey); if (c) return c; } catch {}
  const r = await fetch(`${API}/surah/${n}`);
  const ayahs = (await r.json()).data?.ayahs || [];
  idbSetQuran(idbKey, ayahs).catch(() => {});
  return ayahs;
}
// Static surah metadata cache: hizb, juz, page (from ayat 1) + total word count
async function fetchSurahMeta(n) {
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
// Single-ayah meta (page, juz, hizb, manzil, ruku, sajda) — cached per-surah
async function fetchAyahMeta(sn, an) {
  const ayahs = await fetchSurahDefault(sn);
  return ayahs.find(a => a.numberInSurah === an) || null;
}
async function fetchQuranPage(pageNum) {
  const key = `mushaf_page:${pageNum}`;
  try { const c = await idbGetQuran(key); if (c) return c; } catch {}
  const r = await fetch(`${API}/page/${pageNum}/quran-uthmani`);
  const ayahs = (await r.json()).data?.ayahs || [];
  idbSetQuran(key, ayahs).catch(() => {});
  return ayahs;
}
// Static page-level metadata: hizb, juz, word count — cached in IDB as pmeta:N
async function fetchPageMeta(pageNum) {
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

function _stripBasmalaWords(words, sn) {
  // Strip first 4 words (basmala) from ayat 1 timestamps for non-Fatiha/Tawba surahs
  if (!words || words.length <= 4 || sn === 1 || sn === 9) return words;
  const stripD = s => s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');
  const firstWord = words[0]?.chars?.map(c => c.char).join('') || '';
  if (stripD(firstWord).startsWith('بسم')) return words.slice(4);
  return words;
}

function parseTimestampsFile(data, surahNum, keyPrefix) {
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

// ─── PlayingArabicHighlighted — zero-rerender highlight via DOM refs ─────────
// Renders chars once, then updates active/done classes via RAF + DOM refs only.
const PlayingArabicHighlighted = React.memo(function PlayingArabicHighlighted({
  text, timestamps, mode, playingPart, ld, showQalqala, showMadd, showIzhar, showIdgham
}) {
  const mainCurrentMs = useSelector(sel.mainCurrentMs);
  const partCurrentMs = useSelector(sel.partCurrentMs);
  const localPlaying  = useSelector(sel.localPlaying);
  const containerRef  = useRef(null);
  const charDataRef   = useRef(null); // flat array of {start,end,el}
  const prevActiveRef = useRef(-1);

  // Build flat char metadata once per timestamps change
  const charData = useMemo(() => {
    if (!timestamps?.words) return null;
    const flat = [];
    timestamps.words.forEach(word => {
      const chars = fixChars(word.chars || []);
      chars.forEach(c => flat.push({ start: c.start, end: c.end }));
    });
    return flat;
  }, [timestamps]);

  charDataRef.current = charData;

  // Update active/done spans via direct DOM after every currentMs change
  useEffect(() => {
    const flat = charDataRef.current;
    if (!flat || !containerRef.current) return;
    let curMs;
    let rangeStartMs = null;
    if (mode === 'main') {
      curMs = mainCurrentMs;
    } else if (mode === 'part') {
      const activePart = (ld?.parts || []).find(p => p.id === playingPart?.partId);
      const firstWordIdx = activePart?.wordIndices?.[0];
      rangeStartMs = firstWordIdx != null ? timestamps?.words?.[firstWordIdx]?.chars?.[0]?.start : null;
      curMs = partCurrentMs;
    } else {
      curMs = localPlaying?.currentMs ?? -1;
    }
    const spans = containerRef.current.querySelectorAll('.char-span');
    if (spans.length !== flat.length) return;
    flat.forEach(({ start, end }, i) => {
      const active = curMs >= start && curMs <= end;
      const done   = curMs > end && curMs > 0 && (rangeStartMs == null || end > rangeStartMs);
      const el = spans[i];
      if (active) {
        if (!el.classList.contains('char-active')) { el.classList.add('char-active'); el.classList.remove('char-done'); }
      } else if (done) {
        if (!el.classList.contains('char-done')) { el.classList.add('char-done'); el.classList.remove('char-active'); }
      } else {
        if (el.classList.contains('char-active') || el.classList.contains('char-done')) {
          el.classList.remove('char-active','char-done');
        }
      }
    });
  }, [mainCurrentMs, partCurrentMs, localPlaying, mode]);

  // Render static chars (no active/done — DOM handles it)
  return <ArabicHighlighted ref={containerRef} text={text} timestamps={timestamps}
    currentMs={-1} showQalqala={showQalqala} showMadd={showMadd}
    showIzhar={showIzhar} showIdgham={showIdgham} />;
}, (prev, next) =>
  prev.text === next.text &&
  prev.timestamps === next.timestamps &&
  prev.mode === next.mode &&
  prev.showQalqala === next.showQalqala &&
  prev.showMadd === next.showMadd &&
  prev.showIzhar === next.showIzhar &&
  prev.showIdgham === next.showIdgham
);

// ─── Arabic Virtual Keyboard ───────────────────────────────────────────────────
const ArabicKeyboardContext = React.createContext({ show: false, setShow: () => {}, activeInput: { current: null } });
function useArabicKeyboard() { return React.useContext(ArabicKeyboardContext); }

const AR_ROWS = [
  ['ض','ص','ث','ق','ف','غ','ع','ه','خ','ح','ج','د','ذ'],
  ['ش','س','ي','ب','ل','ا','ت','ن','م','ك','ط','ظ'],
  ['ئ','ء','ؤ','ر','لا','ى','ة','و','ز','سّ'],
];
const AR_DIACRITICS = [
  { label:'َ', title:'Fatha' },
  { label:'ُ', title:'Damma' },
  { label:'ِ', title:'Kasra' },
  { label:'ً', title:'Tanwin fath' },
  { label:'ٌ', title:'Tanwin damm' },
  { label:'ٍ', title:'Tanwin kasr' },
  { label:'ّ', title:'Shadda' },
  { label:'ْ', title:'Sukun' },
  { label:'ٰ', title:'Dagger alif' },
];

function ArabicKeyboard({ show, onClose }) {
  const { activeInput } = useArabicKeyboard();
  const [capsHamza, setCapsHamza] = React.useState(false);

  const insert = (char) => {
    const el = activeInput.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const before = el.value.slice(0, start);
    const after  = el.value.slice(end);
    const newVal = before + char + after;
    // Use native input setter to trigger React's onChange
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    nativeSetter?.set?.call(el, newVal);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const newPos = start + char.length;
    el.setSelectionRange(newPos, newPos);
    el.focus();
  };

  const backspace = () => {
    const el = activeInput.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    if (start !== end) {
      insert('');
    } else if (start > 0) {
      const before = el.value.slice(0, start - 1);
      const after  = el.value.slice(start);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      nativeSetter?.set?.call(el, before + after);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.setSelectionRange(start - 1, start - 1);
      el.focus();
    }
  };

  const HAMZA_MAP = {
    'ا': 'أ', 'و': 'ؤ', 'ي': 'ئ', 'ه': 'ه',
  };

  if (!show) return null;
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:9999,
      background:'var(--surface2)', borderTop:'1px solid var(--border)',
      padding:'8px 6px 12px', boxShadow:'0 -4px 24px rgba(0,0,0,.4)',
      userSelect:'none' }}>
      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>CLAVIER ARABE</div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => setCapsHamza(v => !v)}
            style={{ fontSize:9, padding:'3px 10px', borderRadius:6,
              background: capsHamza ? 'rgba(201,168,76,.18)' : 'transparent',
              border:'1px solid ' + (capsHamza ? 'var(--gold)' : 'var(--border2)'),
              color: capsHamza ? 'var(--gold2)' : 'var(--text3)', cursor:'pointer' }}>
            ء HAMZA
          </button>
          <button onClick={onClose}
            style={{ fontSize:11, padding:'3px 10px', borderRadius:6,
              background:'transparent', border:'1px solid var(--border2)',
              color:'var(--text3)', cursor:'pointer' }}>✕</button>
        </div>
      </div>

      {/* Letter rows */}
      {AR_ROWS.map((row, ri) => (
        <div key={ri} style={{ display:'flex', justifyContent:'center', gap:3, marginBottom:3 }}>
          {row.map((ch) => {
            const display = capsHamza && HAMZA_MAP[ch] ? HAMZA_MAP[ch] : ch;
            return (
              <button key={ch} onClick={() => insert(display)}
                style={{ minWidth:32, height:38, fontSize:18, borderRadius:6,
                  fontFamily:"'Amiri Quran',serif", border:'1px solid var(--border2)',
                  background:'var(--surface3)', color:'var(--text)',
                  cursor:'pointer', direction:'rtl', padding:'0 4px',
                  transition:'background .1s', flexShrink:0 }}>
                {display}
              </button>
            );
          })}
          {ri === 2 && (
            <button onClick={backspace}
              style={{ minWidth:44, height:38, fontSize:14, borderRadius:6,
                border:'1px solid var(--border2)', background:'rgba(224,90,90,.12)',
                color:'var(--red)', cursor:'pointer', flexShrink:0 }}>
              ⌫
            </button>
          )}
        </div>
      ))}

      {/* Diacritics row */}
      <div style={{ display:'flex', justifyContent:'center', gap:3, marginTop:4 }}>
        {AR_DIACRITICS.map(({ label, title }) => (
          <button key={label} onClick={() => insert(label)} title={title}
            style={{ minWidth:32, height:32, fontSize:14, borderRadius:6,
              fontFamily:"'Amiri Quran',serif", border:'1px solid var(--border2)',
              background:'rgba(201,168,76,.08)', color:'var(--gold2)',
              cursor:'pointer', padding:'0 4px', flexShrink:0 }}>
            د{label}
          </button>
        ))}
        <button onClick={() => insert(' ')}
          style={{ minWidth:80, height:32, fontSize:9, borderRadius:6,
            border:'1px solid var(--border2)', background:'var(--surface3)',
            color:'var(--text3)', cursor:'pointer', letterSpacing:2, fontFamily:"'Cinzel',serif" }}>
          ESPACE
        </button>
      </div>
    </div>
  );
}


// ─── IndexedDB timestamps cache ───────────────────────────────────────────────
const IDB_NAME        = 'quran-ts-cache';
const IDB_STORE       = 'timestamps';
const IDB_QURAN_STORE = 'quran';
const tsMemCache    = {};
const quranMemCache = {};
let _tsDbPromise = null;
function openTsDb() {
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
async function idbGetQuran(key) {
  if (quranMemCache[key] !== undefined) return quranMemCache[key];
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_QURAN_STORE, 'readonly');
    const req = tx.objectStore(IDB_QURAN_STORE).get(key);
    req.onsuccess = () => { quranMemCache[key] = req.result ?? null; res(req.result ?? null); };
    req.onerror   = e => rej(e.target.error);
  });
}
async function idbSetQuran(key, val) {
  quranMemCache[key] = val;
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_QURAN_STORE, 'readwrite');
    tx.objectStore(IDB_QURAN_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}
async function idbGet(key) {
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function idbSet(key, val) {
  const db = await openTsDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// ─── Auto-load timestamps for a surah (per reciter) ──────────────────────────
// Path scheme — one subfolder per reciter id, same file-naming pattern as before:
//   Android (bundled assets): public/assets/timestamps/{recitatorId}/surah_XXX.json
//   Web (server):              http://localhost:3000/sourate/{recitatorId}/surah_XXX.json
// e.g. for sourate 1 / ar.husary → public/assets/timestamps/ar.husary/surah_001.json
const TS_SERVER_BASE   = 'http://localhost:3000/sourate';
const TS_ANDROID_BASE  = 'public/assets/timestamps';
async function loadTimestampsForSurah(surahNum, recitatorId = 'ar.alafasy') {
  const memKey = `${recitatorId}:${surahNum}`;
  if (tsMemCache[memKey]) return tsMemCache[memKey];
  const cacheKey = `ts:${recitatorId}:${surahNum}`;
  const file     = `surah_${String(surahNum).padStart(3,'0')}.json`;

  if (IS_ANDROID) {
    // Capacitor: load directly from bundled assets, no IDB needed
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

  // Web: try IDB cache first, then fetch from server and cache
  try {
    const cached = await idbGet(cacheKey);
    if (cached) { tsMemCache[memKey] = cached; return cached; }
  } catch {}

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000); // 5s timeout — don't stall UI
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


// Fix degenerate timestamp chars where start===end by extending to next real boundary
function fixChars(chars) {
  if (!chars?.length) return [];
  const wordEnd = chars[chars.length - 1].end;
  return chars.map((c, ci) => {
    if (c.start === c.end) {
      const nextReal = chars.slice(ci + 1).find(x => x.end > c.start);
      return { ...c, end: nextReal ? nextReal.start : wordEnd };
    }
    return c;
  });
}

const ArabicHighlighted = React.memo(React.forwardRef(function ArabicHighlighted({ text, timestamps, currentMs, rangeStartMs, showQalqala, showMadd, showIzhar, showIdgham }, ref) {
  if (!timestamps?.words) return <div className="ayat-arabic">{text}</div>;

  // Pre-compute tajweed styles and fixed chars once per timestamps+tajweed change
  const wordData = useMemo(() => timestamps.words.map(word => {
    const wordArr = word.chars ? word.chars.map(x => x.char) : [];
    const fixed = fixChars(word.chars || []);
    return fixed.map((c, ci) => {
      const isQalqalaOn = showQalqala && isQalqala(wordArr, ci);
      const maddType    = showMadd ? getMaddType(wordArr, ci) : null;
      const izharOn     = showIzhar && isIzhar(wordArr, ci);
      const idghamOn    = showIdgham && isIdgham(wordArr, ci);
      const tajStyle    = isQalqalaOn ? {color:'#5bc8f5',textShadow:'0 0 6px rgba(91,200,245,.5)'}
                        : maddType === 'muttasil' ? {color:'#ff7eb3',textShadow:'0 0 8px rgba(255,126,179,.6)',fontWeight:600}
                        : maddType === 'normal'   ? {color:'#f09de0',textShadow:'0 0 6px rgba(240,157,224,.5)'}
                        : izharOn                 ? {color:'#4caf81',textShadow:'0 0 6px rgba(76,175,129,.5)'}
                        : idghamOn                ? {color:'#ffd166',textShadow:'0 0 6px rgba(255,209,102,.5)'}
                        : undefined;
      return { char: c.char, start: c.start, end: c.end, tajStyle };
    });
  }), [timestamps, showQalqala, showMadd, showIzhar, showIdgham]);

  // Static render — no active/done classes here (DOM updates them for playing mode)
  return (
    <div className="ayat-arabic" ref={ref}>
      {wordData.map((chars, wi) => (
        <span key={wi}>
          {chars.map((c, ci) => (
            <span key={ci} className="char-span" style={c.tajStyle}>{c.char}</span>
          ))}
          {wi < wordData.length - 1 ? ' ' : ''}
        </span>
      ))}
    </div>
  );
}), (prev, next) =>
  prev.text === next.text &&
  prev.timestamps === next.timestamps &&
  prev.currentMs === next.currentMs &&
  prev.showQalqala === next.showQalqala &&
  prev.showMadd === next.showMadd &&
  prev.showIzhar === next.showIzhar &&
  prev.showIdgham === next.showIdgham
);

// ─── Qalqala letters (ق ط ب ج د)
const QALQALA_LETTERS = new Set(['ق','ط','ب','ج','د']);
function isQalqala(arr, i) {
  if (!QALQALA_LETTERS.has(arr[i])) return false;
  // Check next char is sukun, or last char of word (waqf = implicit sukun)
  for (let j = i + 1; j < arr.length; j++) {
    const nc = arr[j];
    if (nc === SUKUN) return true;
    if (nc === ' ' || j === arr.length - 1) return true; // waqf
    if (nc >= '؀' && nc <= 'ۿ') continue; // other diacritics — keep looking
    return false; // base letter follows — no sukun
  }
  return true; // end of text
}

// ─── Madd detection
const MADD_MARK   = new Set(['ٓ','ٰ']);
const LONG_VOWEL  = new Set(['َ','ُ','ِ']);
const MADD_LETTER = new Set(['ا','و','ي']);
const HAMZA_SET   = new Set(['ء','أ','إ','ؤ','ئ']); // ء أ إ ؤ ئ
// Izhar halqi letters: ء ه ع غ ح خ
const IZHAR_LETTERS = new Set(['ء','ه','ع','غ','ح','خ']);
const SUKUN = 'ْ'; // ْ
const TANWIN = new Set(['ً','ٌ','ٍ']); // ً ٌ ٍ
// Returns true if char at i is a nun-sakin or tanwin that is followed (skip diacritics) by an izhar letter
function isIzhar(arr, i) {
  const ch = arr[i];
  let isNunSakin = false;
  // Nun with sukun: ن followed by sukun OR sukun directly on this char
  if (ch === 'ن') { // ن
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j] === ' ') break;
      if (arr[j] === SUKUN) { isNunSakin = true; break; }
      if (arr[j] >= 'ء' && arr[j] <= 'ي' && !TANWIN.has(arr[j])) break;
    }
  }
  // Tanwin on current char
  const isTanwin = TANWIN.has(ch);
  if (!isNunSakin && !isTanwin) return false;
  // Find next base letter (skip diacritics and spaces)
  const start = isTanwin ? i + 1 : i + 2; // skip sukun for nun-sakin
  for (let j = (isTanwin ? i + 1 : i + 1); j < arr.length; j++) {
    const nc = arr[j];
    if (nc === ' ') continue;
    if (IZHAR_LETTERS.has(nc)) return true;
    if (nc >= 'ء' && nc <= 'ي' && !TANWIN.has(nc) && nc !== SUKUN) return false;
  }
  return false;
}

// Idgham letters: ي ن م و ل ر
const IDGHAM_LETTERS = new Set(['ي','ن','م','و','ل','ر']);
function isIdgham(arr, i) {
  const ch = arr[i];
  let isNunSakin = false;
  if (ch === 'ن') {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j] === SUKUN) { isNunSakin = true; break; }
      if (arr[j] >= 'ء' && arr[j] <= 'ي' && !TANWIN.has(arr[j])) break;
    }
  }
  const isTanwin = TANWIN.has(ch);
  if (!isNunSakin && !isTanwin) return false;
  // Must be at word boundary (next non-diacritic is in next word = after space)
  // For nun-sakin: skip to next word
  let hitSpace = false;
  for (let j = i + 1; j < arr.length; j++) {
    const nc = arr[j];
    if (nc === ' ') { hitSpace = true; continue; }
    if (!hitSpace && (nc >= '؀' && nc <= 'ۿ')) continue; // diacritics same word
    if (IDGHAM_LETTERS.has(nc)) return true;
    return false;
  }
  return false;
}

// Returns 'muttasil' (4-5 beats, madd before hamza same word), 'normal' (2 beats), or null
function getMaddType(arr, i) {
  const ch = arr[i];
  // Explicit maddah/superscript-alif mark
  const hasMark = MADD_MARK.has(ch) || (i + 1 < arr.length && MADD_MARK.has(arr[i + 1]));
  // Long vowel + letter
  const isLongVowelLetter = MADD_LETTER.has(ch) && i > 0 && LONG_VOWEL.has(arr[i - 1]);
  if (!hasMark && !isLongVowelLetter) return null;
  // Check if a hamza follows (skip diacritics) within the same word
  for (let j = i + 1; j < arr.length; j++) {
    const nc = arr[j];
    if (nc === ' ') break; // word boundary
    if (HAMZA_SET.has(nc)) return 'muttasil';
    if (nc >= 'ء' && nc <= 'ي') break; // another base letter — no hamza follows immediately
  }
  return 'normal';
}
// Backward-compat single-char check
function isMaddChar(arr, i) { return getMaddType(arr, i) !== null; }

// ─── VOICE COMMAND PARSER ─────────────────────────────────────────────────────
function parseVoiceCommand(transcript, surahs, ayats, currentSurah) {
  const t = transcript.toLowerCase().trim()
    .replace(/[,;.!?]/g, ' ')
    .replace(/\s+/g, ' ');

  // Play / pause / stop
  if (/\b(play|joue|lecture|lire|lancer|démarrer|start)\b/.test(t)) return { action: 'play' };
  if (/\b(pause|pauser|mettre en pause)\b/.test(t)) return { action: 'pause' };
  if (/\b(stop|arrêter|arrête|stopper)\b/.test(t)) return { action: 'stop' };
  if (/\b(suivant|next|verset suivant)\b/.test(t)) return { action: 'next' };
  if (/\b(précédent|retour|previous|verset précédent)\b/.test(t)) return { action: 'prev' };

  // Surah selection: "sourate fatiha", "ouvre al-baqara", "va à la sourate 2"
  const surahByNum = t.match(/\b(?:sourate|surah|sura|ouvre|va à la sourate|va sourate)\s+(\d+)\b/i);
  if (surahByNum) {
    const n = parseInt(surahByNum[1]);
    if (n >= 1 && n <= 114) return { action: 'surah', number: n };
  }
  // By name
  for (const [key, num] of Object.entries(SURAH_NAMES)) {
    if (t.includes(key)) return { action: 'surah', number: num };
  }

  // Ayat: "verset 5", "ayat 12", "va au verset 7", "commence au verset 3"
  const ayatMatch = t.match(/\b(?:verset|ayat|ayah|aya|commence|va au|aller au verset|aller verset)\s+(\d+)\b/i);
  if (ayatMatch) {
    const n = parseInt(ayatMatch[1]);
    return { action: 'ayat', number: n };
  }

  // Loop range: "boucle versets 2 à 5", "répéter 3 à 7", "loop 1 5"
  const loopMatch = t.match(/\b(?:boucle|loop|répéter|répète|lire en boucle)\s+(?:versets?\s+)?(\d+)\s+(?:à|au|jusqu'à|to|-)\s+(\d+)\b/i);
  if (loopMatch) {
    return { action: 'loop', from: parseInt(loopMatch[1]), to: parseInt(loopMatch[2]) };
  }

  // Loop off: "arrêter la boucle", "stop loop"
  if (/\b(arrêter la boucle|stop loop|désactiver boucle|no loop|sans boucle)\b/.test(t)) {
    return { action: 'loop_off' };
  }

  // Repetitions: "répéter 3 fois", "5 fois"
  const repMatch = t.match(/\b(\d+)\s+fois\b/i);
  if (repMatch) return { action: 'repeat', times: parseInt(repMatch[1]) };

  return null;
}

// ─── CONCORDANCE PAGE ────────────────────────────────────────────────────────
const SURAH_INFO = [
  {n:1,en:"Al-Fatiha",ar:"الفاتحة"},{n:2,en:"Al-Baqara",ar:"البقرة"},{n:3,en:"Al-Imran",ar:"آل عمران"},
  {n:4,en:"An-Nisa",ar:"النساء"},{n:5,en:"Al-Maida",ar:"المائدة"},{n:6,en:"Al-Anam",ar:"الأنعام"},
  {n:7,en:"Al-Araf",ar:"الأعراف"},{n:8,en:"Al-Anfal",ar:"الأنفال"},{n:9,en:"At-Tawba",ar:"التوبة"},
  {n:10,en:"Yunus",ar:"يونس"},{n:11,en:"Hud",ar:"هود"},{n:12,en:"Yusuf",ar:"يوسف"},
  {n:13,en:"Ar-Rad",ar:"الرعد"},{n:14,en:"Ibrahim",ar:"إبراهيم"},{n:15,en:"Al-Hijr",ar:"الحجر"},
  {n:16,en:"An-Nahl",ar:"النحل"},{n:17,en:"Al-Isra",ar:"الإسراء"},{n:18,en:"Al-Kahf",ar:"الكهف"},
  {n:19,en:"Maryam",ar:"مريم"},{n:20,en:"Taha",ar:"طه"},{n:21,en:"Al-Anbiya",ar:"الأنبياء"},
  {n:22,en:"Al-Hajj",ar:"الحج"},{n:23,en:"Al-Muminun",ar:"المؤمنون"},{n:24,en:"An-Nur",ar:"النور"},
  {n:25,en:"Al-Furqan",ar:"الفرقان"},{n:26,en:"Ash-Shuara",ar:"الشعراء"},{n:27,en:"An-Naml",ar:"النمل"},
  {n:28,en:"Al-Qasas",ar:"القصص"},{n:29,en:"Al-Ankabut",ar:"العنكبوت"},{n:30,en:"Ar-Rum",ar:"الروم"},
  {n:31,en:"Luqman",ar:"لقمان"},{n:32,en:"As-Sajda",ar:"السجدة"},{n:33,en:"Al-Ahzab",ar:"الأحزاب"},
  {n:34,en:"Saba",ar:"سبأ"},{n:35,en:"Fatir",ar:"فاطر"},{n:36,en:"Ya-Sin",ar:"يس"},
  {n:37,en:"As-Saffat",ar:"الصافات"},{n:38,en:"Sad",ar:"ص"},{n:39,en:"Az-Zumar",ar:"الزمر"},
  {n:40,en:"Ghafir",ar:"غافر"},{n:41,en:"Fussilat",ar:"فصلت"},{n:42,en:"Ash-Shura",ar:"الشورى"},
  {n:43,en:"Az-Zukhruf",ar:"الزخرف"},{n:44,en:"Ad-Dukhan",ar:"الدخان"},{n:45,en:"Al-Jathiya",ar:"الجاثية"},
  {n:46,en:"Al-Ahqaf",ar:"الأحقاف"},{n:47,en:"Muhammad",ar:"محمد"},{n:48,en:"Al-Fath",ar:"الفتح"},
  {n:49,en:"Al-Hujurat",ar:"الحجرات"},{n:50,en:"Qaf",ar:"ق"},{n:51,en:"Adh-Dhariyat",ar:"الذاريات"},
  {n:52,en:"At-Tur",ar:"الطور"},{n:53,en:"An-Najm",ar:"النجم"},{n:54,en:"Al-Qamar",ar:"القمر"},
  {n:55,en:"Ar-Rahman",ar:"الرحمن"},{n:56,en:"Al-Waqia",ar:"الواقعة"},{n:57,en:"Al-Hadid",ar:"الحديد"},
  {n:58,en:"Al-Mujadila",ar:"المجادلة"},{n:59,en:"Al-Hashr",ar:"الحشر"},{n:60,en:"Al-Mumtahana",ar:"الممتحنة"},
  {n:61,en:"As-Saff",ar:"الصف"},{n:62,en:"Al-Juma",ar:"الجمعة"},{n:63,en:"Al-Munafiqun",ar:"المنافقون"},
  {n:64,en:"At-Taghabun",ar:"التغابن"},{n:65,en:"At-Talaq",ar:"الطلاق"},{n:66,en:"At-Tahrim",ar:"التحريم"},
  {n:67,en:"Al-Mulk",ar:"الملك"},{n:68,en:"Al-Qalam",ar:"القلم"},{n:69,en:"Al-Haqqa",ar:"الحاقة"},
  {n:70,en:"Al-Maarij",ar:"المعارج"},{n:71,en:"Nuh",ar:"نوح"},{n:72,en:"Al-Jinn",ar:"الجن"},
  {n:73,en:"Al-Muzzammil",ar:"المزمل"},{n:74,en:"Al-Muddaththir",ar:"المدثر"},{n:75,en:"Al-Qiyama",ar:"القيامة"},
  {n:76,en:"Al-Insan",ar:"الإنسان"},{n:77,en:"Al-Mursalat",ar:"المرسلات"},{n:78,en:"An-Naba",ar:"النبأ"},
  {n:79,en:"An-Naziat",ar:"النازعات"},{n:80,en:"Abasa",ar:"عبس"},{n:81,en:"At-Takwir",ar:"التكوير"},
  {n:82,en:"Al-Infitar",ar:"الانفطار"},{n:83,en:"Al-Mutaffifin",ar:"المطففين"},{n:84,en:"Al-Inshiqaq",ar:"الانشقاق"},
  {n:85,en:"Al-Buruj",ar:"البروج"},{n:86,en:"At-Tariq",ar:"الطارق"},{n:87,en:"Al-Ala",ar:"الأعلى"},
  {n:88,en:"Al-Ghashiya",ar:"الغاشية"},{n:89,en:"Al-Fajr",ar:"الفجر"},{n:90,en:"Al-Balad",ar:"البلد"},
  {n:91,en:"Ash-Shams",ar:"الشمس"},{n:92,en:"Al-Layl",ar:"الليل"},{n:93,en:"Ad-Duha",ar:"الضحى"},
  {n:94,en:"Ash-Sharh",ar:"الشرح"},{n:95,en:"At-Tin",ar:"التين"},{n:96,en:"Al-Alaq",ar:"العلق"},
  {n:97,en:"Al-Qadr",ar:"القدر"},{n:98,en:"Al-Bayyina",ar:"البينة"},{n:99,en:"Az-Zalzala",ar:"الزلزلة"},
  {n:100,en:"Al-Adiyat",ar:"العاديات"},{n:101,en:"Al-Qaria",ar:"القارعة"},{n:102,en:"At-Takathur",ar:"التكاثر"},
  {n:103,en:"Al-Asr",ar:"العصر"},{n:104,en:"Al-Humaza",ar:"الهمزة"},{n:105,en:"Al-Fil",ar:"الفيل"},
  {n:106,en:"Quraysh",ar:"قريش"},{n:107,en:"Al-Maun",ar:"الماعون"},{n:108,en:"Al-Kawthar",ar:"الكوثر"},
  {n:109,en:"Al-Kafirun",ar:"الكافرون"},{n:110,en:"An-Nasr",ar:"النصر"},{n:111,en:"Al-Masad",ar:"المسد"},
  {n:112,en:"Al-Ikhlas",ar:"الإخلاص"},{n:113,en:"Al-Falaq",ar:"الفلق"},{n:114,en:"An-Nas",ar:"الناس"},
];

// Normalize Arabic for fuzzy matching (remove diacritics)
function normalizeAr(s) {
  if (!s) return "";
  return s
    .replace(/[\u0610-\u061A]/g, "")          // signes arabes (haut de page)
    .replace(/[\u064B-\u065F]/g, "")          // harakat classiques (fatha, damma, kasra…)
    .replace(/\u0670/g, "")                    // ٰ alef superscript (U+0670) — cause principale du bug
    .replace(/[\u06D6-\u06ED]/g, "")          // marques coraniques étendues
    .replace(/[أإآٱ\u0671]/g, "ا")           // toutes variantes d'alef → ا
    .replace(/[ىئ]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}

// Arabic root extraction via morphological pattern stripping
// Handles: prefixes (conj/art/prep), verb conjugation affixes (يُ/تُ/أَ/نَ),
// object/subject suffixes, dual/plural endings, shadda (doubled letter), weak letters.
function arabicRoot(word) {
  let w = normalizeAr(word);
  if (!w) return '';

  // 1. Strip definite article + prepositional prefixes (longest first)
  w = w.replace(/^(وبال|وكال|وفال|وال|فال|بال|كال|لل|فل|بل|كل|ول|ال)/, '');

  // 2. Strip conjunctions / prepositions (single-letter prefixes)
  w = w.replace(/^[وفبكل](?=[^\s])/, '');

  // 3. Strip verb conjugation prefixes: يُـ يَـ تُـ تَـ أَـ نَـ
  //    (imperfect prefixes — the letter stays, we just note it's a prefix marker)
  //    represented after normalizeAr as bare ي ت ا ن
  const verbPrefixRe = /^[يتان]/;

  // 4. Strip common verb/noun suffixes (longest first)
  w = w.replace(/(وكم|وكن|وهم|وهن|وها|وني|وكَ|وك|ون|ين|تم|تن|كم|كن|هم|هن|وا|ها|ني|تي|ان|ات|اه|اك|نا|ك|ه|ا|ن)$/, '');

  // 5. Strip verb conjugation prefix AFTER suffix stripping (order matters)
  if (verbPrefixRe.test(w) && w.length > 3) w = w.replace(/^[يتان]/, '');

  // 6. Collapse shadda-equivalent doubled letters (شدة effect):
  //    In uthmani text after normalizeAr, shadda (ّ) is stripped by normalizeAr already,
  //    but the doubled consonant may appear as two identical letters — deduplicate runs of 2
  w = w.replace(/(.)\1/, '$1');

  // 7. Strip remaining weak letters at edges if root still > 3 chars
  if (w.length > 3) {
    w = w.replace(/^[اويء]/, '');
    w = w.replace(/[اوي]$/, '');
  }

  // 8. Collapse again after weak-letter stripping
  w = w.replace(/(.)\1/, '$1');

  return w.length >= 2 ? w : normalizeAr(word);
}

// Highlight occurrences of query in text
function highlightArabic(text, query) {
  if (!query || !text) return text;
  const normQ = normalizeAr(query.trim());
  if (!normQ) return text;
  const words = text.split(' ');
  const result = [];
  words.forEach((w, i) => {
    const normW = normalizeAr(w);
    const hit = normW.includes(normQ);
    result.push(
      <span key={i}>
        {hit ? <mark className="concord-highlight">{w}</mark> : w}
        {i < words.length - 1 ? ' ' : ''}
      </span>
    );
  });
  return result;
}

const SUGGESTED_SEARCHES = [
  "الرحمن","الله","الصلاة","الجنة","النار","الإيمان","التوبة","الصبر","الشيطان","الكافرين",
  "اللهم","المؤمنين","الرحيم","السماء","الأرض"
];

// ─── Lecteur audio inline pour concordance ────────────────────────────────────
function ConcordInlinePlayer({ audioUrl }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.currentTime = 0; a.play().catch(()=>{}); setPlaying(true); }
  };
  return (
    <>
      <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} style={{display:'none'}} />
      <button className="concord-go-btn" onClick={toggle}
        style={{ color: playing ? 'var(--teal)' : undefined, borderColor: playing ? 'var(--teal)' : undefined }}>
        {playing ? '⏹' : '▶'}
      </button>
    </>
  );
}

// ── Sous-composant : un groupe sourate avec lazy-load à l'ouverture ──────────
function ConcordGroup({ group, debouncedQ, onNavigate, isLinked, toggleLink, textCache, onOpenCollModal, ayatInCollectionsFn }) {
  const [open, setOpen]       = useState(false);
  const [ayats, setAyats]     = useState(null); // null = pas encore chargé
  const [loadingAyats, setLoadingAyats] = useState(false);
  const headerRef   = useRef(null);
  const observerRef = useRef(null);

  // IntersectionObserver : charge les ayats dès que le header entre dans le viewport
  // ET que le groupe est ouvert — évite tout chargement hors-écran
  const loadAyats = useCallback(async () => {
    if (ayats !== null || loadingAyats) return; // déjà chargé ou en cours
    setLoadingAyats(true);
    try {
      // Réutiliser le cache de phase 1 (quran-simple, sans diacritiques)
      // pour garantir que normalizeAr produit le même résultat qu'au scan
      let all = textCache?.current?.[group.surahNum];
      if (!all) {
        all = await fetchSurahSimple(group.surahNum);
        if (textCache?.current) textCache.current[group.surahNum] = all;
      }
      const normQ = normalizeAr(debouncedQ.trim());
      const matching = all.filter(a => {
        const t = normalizeAr(a.text);
        const words = normQ.split(/\s+/).filter(Boolean);
        if (group.fuzzy)    return words.every(w => t.includes(w));
        if (group.wordMode) return t.split(" ").some(w => w === normQ || w.startsWith(normQ) || w.endsWith(normQ));
        return t.includes(normQ);
      });
      setAyats(matching);
    } catch {
      setAyats([]);
    }
    setLoadingAyats(false);
  }, [ayats, loadingAyats, group.surahNum, group.fuzzy, debouncedQ, textCache]);

  // Quand on ouvre le groupe, charger les ayats
  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && ayats === null) loadAyats();
  };

  // Observer scroll : si le header devient visible ET groupe déjà ouvert, charger
  useEffect(() => {
    if (!headerRef.current) return;
    observerRef.current = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && open && ayats === null) loadAyats(); },
      { rootMargin: '120px' }
    );
    observerRef.current.observe(headerRef.current);
    return () => observerRef.current?.disconnect();
  }, [open, ayats, loadAyats]);

  const displayAyats = ayats ?? [];

  return (
    <div className="concord-group">
      {/* En-tête cliquable */}
      <div ref={headerRef} className="concord-group-header" onClick={handleToggle}>
        <div className="concord-group-num">{group.surahNum}</div>
        <div className="concord-group-name">{group.surahEn}</div>
        <div className="concord-group-ar">{group.surahAr}</div>
        <div className="concord-group-badge">
          {ayats === null ? `~${group.count}` : displayAyats.length} AYAT{group.count>1?"S":""}
        </div>
        <div className={`concord-group-chevron${open?" open":""}`}>▶</div>
      </div>

      {/* Corps — visible seulement si ouvert */}
      {open && (
        <div>
          {loadingAyats && (
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 18px",color:"var(--text3)",fontSize:10,letterSpacing:1}}>
              <div className="loading-ring" style={{width:16,height:16,borderWidth:2}} />
              CHARGEMENT...
            </div>
          )}
          {!loadingAyats && displayAyats.length === 0 && (
            <div style={{padding:"12px 18px",fontSize:10,color:"var(--text3)",letterSpacing:1}}>
              AUCUN RÉSULTAT DANS CETTE SOURATE
            </div>
          )}
          {displayAyats.map(ayat => (
            <div key={ayat.num} className="concord-ayat-item">
              <div className="concord-ayat-num">{ayat.num}</div>
              <div className="concord-ayat-text">
                {highlightArabic(ayat.text, debouncedQ)}
              </div>
              <div className="concord-ayat-actions">
                <button className="concord-go-btn" onClick={() => onNavigate(group.surahNum, ayat.num)}>
                  → OUVRIR
                </button>
                {onOpenCollModal && (
                  <button
                    className="concord-go-btn"
                    style={{ color: ayatInCollectionsFn?.(group.surahNum, ayat.num)?.length > 0 ? "#c878ff" : undefined,
                             borderColor: ayatInCollectionsFn?.(group.surahNum, ayat.num)?.length > 0 ? "#c878ff" : undefined }}
                    onClick={() => onOpenCollModal({ surahNum: group.surahNum, surahEn: group.surahEn, ayatNum: ayat.num, text: ayat.text, number: ayat.num })}
                  >
                    🗂
                  </button>
                )}
                <button
                  className={`concord-link-btn${isLinked(group.surahNum, ayat.num) ? " linked" : ""}`}
                  onClick={() => toggleLink(group.surahNum, group.surahEn, ayat.num, ayat.text)}
                >
                  {isLinked(group.surahNum, ayat.num) ? "✓ LIÉ" : "🔗 LIER"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── SharedGroup — affiche un groupe d'ayats partageant une séquence ──────────
function SharedGroup({ group, sharedN, searchMode, onNavigate, toggleLink, isLinked, onOpenCollModal }) {
  const [open, setOpen] = useState(false);
  const label = searchMode === 'shared-start' ? 'DÉBUT' : searchMode === 'shared-end' ? 'FIN' : 'SÉQUENCE';
  return (
    <div style={{borderBottom:'1px solid var(--border2)',margin:'0'}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:'10px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:open?'var(--surface2)':'transparent',transition:'background .15s'}}>
        <div style={{width:28,height:28,borderRadius:'50%',border:'1px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--gold)',fontFamily:"'Cinzel',serif",flexShrink:0}}>
          {group.count}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:8,letterSpacing:1.5,color:'var(--text3)',marginBottom:3}}>{label} · {sharedN} MOT{sharedN>1?'S':''}</div>
          <div style={{fontFamily:"'Amiri Quran',serif",fontSize:17,direction:'rtl',color:'var(--gold2)',textAlign:'right',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {group.seq}
          </div>
        </div>
        <span style={{fontSize:8,color:'var(--text3)'}}>{open?'▲':'▼'}</span>
      </div>
      {open && (
        <div style={{background:'var(--surface2)',padding:'4px 0 8px'}}>
          {group.ayats.map((a,i) => {
            const info = SURAH_INFO.find(s=>s.n===a.sn);
            const linked = isLinked(a.sn, a.num);
            return (
              <div key={i} style={{padding:'8px 20px',borderBottom:'1px solid rgba(42,47,64,.3)',display:'flex',alignItems:'flex-start',gap:10}}>
                <div style={{flexShrink:0,display:'flex',flexDirection:'column',gap:3,alignItems:'center',minWidth:44}}>
                  <div style={{width:30,height:30,border:'1px solid var(--border2)',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'var(--text3)',fontFamily:"'Cinzel',serif"}}>{a.num}</div>
                  <div style={{fontSize:7,letterSpacing:1,color:'var(--text3)'}}>{info?.en||`S.${a.sn}`}</div>
                </div>
                <div style={{flex:1,minWidth:0,fontFamily:"'Amiri Quran',serif",fontSize:18,direction:'rtl',textAlign:'right',lineHeight:1.8,color:'var(--text)',cursor:'pointer'}}
                  onClick={()=>onNavigate(a.sn,a.num)}>
                  {a.text}
                </div>
                <div style={{flexShrink:0,display:'flex',flexDirection:'column',gap:4}}>
                  <button onClick={()=>toggleLink(a.sn,info?.en||`S.${a.sn}`,a.num,a.text)}
                    style={{fontSize:8,padding:'3px 8px',border:`1px solid ${linked?'var(--gold)':'var(--border2)'}`,background:linked?'rgba(201,168,76,.12)':'transparent',color:linked?'var(--gold)':'var(--text3)',borderRadius:10,cursor:'pointer',fontFamily:"'Cinzel',serif"}}>
                    {linked?'✓':'🔗'}
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

function ConcordancePage({ surahs: surahList, onNavigate, collections, onOpenCollModal, ayatInCollectionsFn, initialQuery }) {
  const [query, setQuery]           = useState(initialQuery || "");
  const [debouncedQ, setDebouncedQ] = useState(initialQuery || "");
  const [searchMode, setSearchMode] = useState("exact");
  const [surahFilter, setSurahFilter]= useState("all"); // "all" | Set of surahNums as strings
  const surahFilterKey = useMemo(() =>
    surahFilter instanceof Set ? [...surahFilter].sort().join(',') : String(surahFilter),
  [surahFilter]);
  const [surahPickerOpen, setSurahPickerOpen] = useState(false);
  const [surahPickerSearch, setSurahPickerSearch] = useState("");
  // surahsToSearch helper (shared by both useEffects)
  const getsurahsToSearch = (filter) =>
    filter === "all" ? SURAH_INFO.map(s => s.n)
    : filter instanceof Set ? [...filter].map(Number).sort((a,b)=>a-b)
    : [parseInt(filter)];
  // groups = [{surahNum, surahEn, surahAr, count, fuzzy}] — PAS les ayats
  const [groups, setGroups]         = useState([]);
  const [loading, setLoading]       = useState(false);
  const [sharedN, setSharedN]         = useState(3);   // nb de mots pour modes shared-*
  const [sharedGroups, setSharedGroups] = useState([]); // [{seq, count, ayats:[{sn,num,text}]}]
  const [sharedLoading, setSharedLoading] = useState(false);
  const sharedTokenRef = useRef(0);

  const [linkedAyats, setLinkedAyats]= useState(() => {
    try { const s = localStorage.getItem("quran_concordLinks"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const debounceRef    = useRef(null);
  const cacheRef       = useRef({}); // surahNum -> ayats[] (texte brut)
  const searchTokenRef = useRef(0);
  const listRef        = useRef(null); // ref sur le conteneur de résultats

  // Debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(query), 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Re-sync when a new "search selection" query arrives while page stays mounted
  useEffect(() => {
    if (initialQuery && initialQuery !== query) { setQuery(initialQuery); setDebouncedQ(initialQuery); }
  }, [initialQuery]); // eslint-disable-line

  // Fetch texte brut d'une sourate (cache léger — texte seul, pas d'audio)
  const fetchSurahText = useCallback(async (num) => {
    if (cacheRef.current[num]) return cacheRef.current[num];
    const ayats = await fetchSurahSimple(num);
    cacheRef.current[num] = ayats;
    return ayats;
  }, []);

  // Phase 1 : scan léger — détermine quelles sourates contiennent le mot
  // Charge le texte sans audio (endpoint plus léger), pas les ayats complets
  useEffect(() => {
    if (!debouncedQ.trim()) { setGroups([]); setLoading(false); return; }
    const normQ = normalizeAr(debouncedQ.trim());
    if (normQ.length < 2) { setGroups([]); return; }

    const token = ++searchTokenRef.current;
    setGroups([]);
    setLoading(true);

    const surahsToSearch = getsurahsToSearch(surahFilter);

    const BATCH = 5; // plus rapide pour le scan léger
    const fuzzy = searchMode === "fuzzy";
    const wordMode = searchMode === "word";
    const startMode = searchMode === "start";
    const endMode   = searchMode === "end";

    // matchText: retourne true si normQ correspond dans le texte selon le mode
    const matchText = (t, q) => {
      if (fuzzy) return q.split(/\s+/).filter(Boolean).every(w => t.includes(w));
      if (wordMode) {
        const words = t.split(" ");
        return words.some(w => w === q || w.startsWith(q) || w.endsWith(q));
      }
      if (startMode) {
        // L'ayat (normalisé) commence par exactement ces mots
        const qWords = q.split(/\s+/).filter(Boolean);
        const tWords = t.split(/\s+/).filter(Boolean);
        return qWords.every((w, i) => tWords[i] !== undefined && (tWords[i] === w || tWords[i].startsWith(w)));
      }
      if (endMode) {
        // L'ayat (normalisé) se termine par exactement ces mots
        const qWords = q.split(/\s+/).filter(Boolean);
        const tWords = t.split(/\s+/).filter(Boolean);
        const offset = tWords.length - qWords.length;
        if (offset < 0) return false;
        return qWords.every((w, i) => tWords[offset + i] !== undefined && (tWords[offset + i] === w || tWords[offset + i].endsWith(w)));
      }
      return t.includes(q);
    };

    (async () => {
      for (let i = 0; i < surahsToSearch.length; i += BATCH) {
        if (token !== searchTokenRef.current) return;
        const batch = surahsToSearch.slice(i, i + BATCH);
        const batchGroups = await Promise.all(batch.map(async (sn) => {
          try {
            const ayats = await fetchSurahText(sn);
            const count = ayats.filter(a => {
              const t = normalizeAr(a.text);
              return matchText(t, normQ);
            }).length;
            if (count > 0) {
              const info = SURAH_INFO.find(s => s.n === sn);
              return { surahNum: sn, surahEn: info?.en||`Sourate ${sn}`, surahAr: info?.ar||"", count, fuzzy, wordMode, startMode, endMode };
            }
          } catch {}
          return null;
        }));
        if (token !== searchTokenRef.current) return;
        const valid = batchGroups.filter(Boolean);
        if (valid.length > 0) {
          setGroups(prev => {
            const merged = [...prev, ...valid];
            merged.sort((a,b) => a.surahNum - b.surahNum);
            return merged;
          });
        }
      }
      if (token === searchTokenRef.current) setLoading(false);
    })();
  }, [debouncedQ, searchMode, surahFilter, fetchSurahText]);

  // ── Modes shared-* : grouper les ayats par séquence de N mots identiques ──
  const isSharedMode = ["shared-start","shared-end","shared-contain"].includes(searchMode);

  useEffect(() => {
    if (!isSharedMode) { setSharedGroups([]); return; }
    const token = ++sharedTokenRef.current;
    setSharedGroups([]);
    setSharedLoading(true);

    const surahsToSearch = getsurahsToSearch(surahFilter);

    const N = Math.max(1, sharedN);

    const getSeq = (words, mode) => {
      if (mode === "shared-start")   return words.slice(0, N).join(" ");
      if (mode === "shared-end")     return words.slice(-N).join(" ");
      // shared-contain: toutes les sous-séquences de N mots consécutifs
      const seqs = [];
      for (let i = 0; i <= words.length - N; i++) seqs.push(words.slice(i, i + N).join(" "));
      return seqs;
    };

    (async () => {
      // Phase 1: charger tous les ayats
      const allAyats = [];
      for (let i = 0; i < surahsToSearch.length; i += 10) {
        if (token !== sharedTokenRef.current) return;
        const batch = surahsToSearch.slice(i, i + 10);
        const results = await Promise.all(batch.map(sn =>
          fetchSurahText(sn).then(ayats => ayats.map(a => ({ sn, num: a.num, text: a.text }))).catch(() => [])
        ));
        results.forEach(r => allAyats.push(...r));
      }
      if (token !== sharedTokenRef.current) return;

      // Phase 2: grouper par séquence
      const map = new Map(); // seq -> [{sn,num,text}]
      allAyats.forEach(a => {
        const words = normalizeAr(a.text).split(/\s+/).filter(Boolean);
        if (words.length < N) return;
        const seqs = searchMode === "shared-contain" ? getSeq(words, searchMode) : [getSeq(words, searchMode)];
        seqs.forEach(seq => {
          if (!seq) return;
          if (!map.has(seq)) map.set(seq, []);
          map.get(seq).push(a);
        });
      });

      // Phase 3: garder uniquement les séquences partagées par ≥2 ayats
      const groups = [];
      map.forEach((ayats, seq) => {
        if (ayats.length >= 2) groups.push({ seq, count: ayats.length, ayats });
      });
      groups.sort((a, b) => b.count - a.count);

      if (token === sharedTokenRef.current) {
        setSharedGroups(groups);
        setSharedLoading(false);
      }
    })();
  }, [searchMode, sharedN, surahFilterKey, isSharedMode, fetchSurahText]);

  // Scroll vers le haut quand une nouvelle recherche commence
  useEffect(() => {
    if (debouncedQ && listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [debouncedQ]);

  const totalCount = groups.reduce((a, g) => a + g.count, 0);

  const toggleLink = (surahNum, surahEn, ayatNum, text) => {
    setLinkedAyats(prev => {
      const key = `${surahNum}:${ayatNum}`;
      const exists = prev.find(l => l.key === key);
      const next = exists
        ? prev.filter(l => l.key !== key)
        : [...prev, { key, surahNum, surahEn, ayatNum, text }];
      try { localStorage.setItem("quran_concordLinks", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const isLinked = (surahNum, ayatNum) =>
    linkedAyats.some(l => l.key === `${surahNum}:${ayatNum}`);

  return (
    <div className="concord-page" ref={listRef}>
      {/* Barre de recherche */}
      <div className="concord-search-bar">
        <input
          type="text"
          placeholder="Rechercher des mots ou parties d'ayats..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="concord-mode-tabs">
          <button className={`concord-mode-tab${searchMode==="exact"?" active":""}`} onClick={()=>setSearchMode("exact")} title="Correspondance exacte n'importe où dans le mot">EXACT</button>
          <button className={`concord-mode-tab${searchMode==="word"?" active":""}`} onClick={()=>setSearchMode("word")} title="Mot entier — premier ou dernier mot de l'ayat inclus">MOT</button>
          <button className={`concord-mode-tab${searchMode==="fuzzy"?" active":""}`} onClick={()=>setSearchMode("fuzzy")} title="Tous les mots de la recherche présents dans l'ayat">FLOU</button>
          <button className={`concord-mode-tab${searchMode==="start"?" active":""}`} onClick={()=>setSearchMode("start")} title="L'ayat commence par ces mots">DÉBUT</button>
          <button className={`concord-mode-tab${searchMode==="end"?" active":""}`} onClick={()=>setSearchMode("end")} title="L'ayat se termine par ces mots">FIN</button>
          <button className={`concord-mode-tab${searchMode==="shared-start"?" active":""}`} onClick={()=>setSearchMode("shared-start")} title="Ayats partageant les mêmes N premiers mots">DÉBUT COMMUN</button>
          <button className={`concord-mode-tab${searchMode==="shared-end"?" active":""}`} onClick={()=>setSearchMode("shared-end")} title="Ayats partageant les mêmes N derniers mots">FIN COMMUNE</button>
          <button className={`concord-mode-tab${searchMode==="shared-contain"?" active":""}`} onClick={()=>setSearchMode("shared-contain")} title="Ayats partageant une séquence de N mots identiques">SÉQUENCE</button>
        </div>
        {isSharedMode && (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0 2px',flexWrap:'wrap'}}>
            <span style={{fontSize:9,letterSpacing:1.5,color:'var(--text3)',fontFamily:"'Cinzel',serif"}}>MOTS :</span>
            {[1,2,3,4,5,6,7,8].map(n => (
              <button key={n} onClick={()=>setSharedN(n)}
                style={{fontSize:9,letterSpacing:1,padding:'3px 10px',borderRadius:12,cursor:'pointer',fontFamily:"'Cinzel',serif",
                  border:`1px solid ${sharedN===n?'var(--gold)':'var(--border2)'}`,
                  background:sharedN===n?'rgba(201,168,76,.12)':'transparent',
                  color:sharedN===n?'var(--gold)':'var(--text3)',transition:'all .2s'}}>
                {n}
              </button>
            ))}
          </div>
        )}
        {/* Surah multi-picker */}
        <div style={{position:'relative'}}>
          <button onClick={()=>setSurahPickerOpen(o=>!o)}
            style={{display:'flex',alignItems:'center',gap:6,background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',padding:'7px 12px',color:surahFilter==='all'?'var(--text3)':'var(--gold)',fontSize:10,letterSpacing:1,fontFamily:"'Cinzel',serif",cursor:'pointer',whiteSpace:'nowrap',minWidth:180}}>
            {surahFilter==='all'
              ? 'TOUTES LES SOURATES'
              : `${surahFilter instanceof Set ? surahFilter.size : 1} SOURATE${(surahFilter instanceof Set?surahFilter.size:1)>1?'S':''} SÉLECTIONNÉE${(surahFilter instanceof Set?surahFilter.size:1)>1?'S':''}`}
            <span style={{marginLeft:'auto',fontSize:8,color:'var(--text3)'}}>{surahPickerOpen?'▲':'▼'}</span>
          </button>
          {surahPickerOpen && (
            <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:200,background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',boxShadow:'0 8px 24px rgba(0,0,0,.4)',width:260,maxHeight:320,display:'flex',flexDirection:'column'}}>
              <div style={{padding:'8px 10px',borderBottom:'1px solid var(--border2)',display:'flex',gap:6}}>
                <input value={surahPickerSearch} onChange={e=>setSurahPickerSearch(e.target.value)}
                  placeholder="Filtrer sourates…"
                  style={{flex:1,background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:4,padding:'4px 8px',color:'var(--text)',fontSize:10,outline:'none'}}/>
                <button onClick={()=>{setSurahFilter('all');setSurahPickerOpen(false);setSurahPickerSearch('');}}
                  style={{fontSize:8,padding:'4px 8px',border:'1px solid var(--border2)',background:'transparent',color:'var(--text3)',borderRadius:4,cursor:'pointer',fontFamily:"'Cinzel',serif"}}>
                  TOUT
                </button>
              </div>
              <div style={{overflowY:'auto',flex:1}}>
                {SURAH_INFO.filter(s=>
                  !surahPickerSearch.trim() ||
                  s.en.toLowerCase().includes(surahPickerSearch.toLowerCase()) ||
                  s.ar.includes(surahPickerSearch) ||
                  String(s.n).includes(surahPickerSearch)
                ).map(s => {
                  const sel = surahFilter instanceof Set ? surahFilter.has(String(s.n)) : surahFilter===String(s.n);
                  return (
                    <div key={s.n} onClick={()=>{
                      setSurahFilter(prev => {
                        const set = prev === 'all' ? new Set() : prev instanceof Set ? new Set(prev) : new Set([String(prev)]);
                        if (set.has(String(s.n))) set.delete(String(s.n)); else set.add(String(s.n));
                        return set.size === 0 ? 'all' : set;
                      });
                    }}
                      style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',cursor:'pointer',background:sel?'rgba(201,168,76,.08)':'transparent',transition:'background .1s',borderBottom:'1px solid rgba(42,47,64,.3)'}}>
                      <div style={{width:14,height:14,border:`1px solid ${sel?'var(--gold)':'var(--border2)'}`,borderRadius:3,background:sel?'var(--gold)':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        {sel && <span style={{fontSize:8,color:'var(--surface)',lineHeight:1}}>✓</span>}
                      </div>
                      <span style={{fontSize:9,color:'var(--text3)',minWidth:20}}>{s.n}.</span>
                      <span style={{fontSize:10,color:sel?'var(--gold)':'var(--text2)',flex:1}}>{s.en}</span>
                      <span style={{fontFamily:"'Amiri Quran',serif",fontSize:14,color:sel?'var(--gold)':'var(--text3)',direction:'rtl'}}>{s.ar}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{padding:'6px 10px',borderTop:'1px solid var(--border2)',display:'flex',justifyContent:'flex-end'}}>
                <button onClick={()=>setSurahPickerOpen(false)}
                  style={{fontSize:8,padding:'4px 12px',border:'1px solid var(--gold)',background:'transparent',color:'var(--gold)',borderRadius:4,cursor:'pointer',fontFamily:"'Cinzel',serif"}}>
                  OK
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Shared-mode results */}
      {isSharedMode && (
        <div style={{padding:'0 0 12px'}}>
          {sharedLoading && (
            <div style={{padding:'16px 20px',fontSize:9,letterSpacing:1.5,color:'var(--text3)',fontFamily:"'Cinzel',serif"}}>
              ANALYSE DU CORPUS…
            </div>
          )}
          {!sharedLoading && sharedGroups.length === 0 && (
            <div style={{padding:'16px 20px',fontSize:9,letterSpacing:1.5,color:'var(--text3)',fontFamily:"'Cinzel',serif',textAlign:'center"}}>
              AUCUN AYAT NE PARTAGE {sharedN} MOT{sharedN>1?'S':''} {searchMode==='shared-start'?'DE DÉBUT':searchMode==='shared-end'?'DE FIN':'EN SÉQUENCE'}
            </div>
          )}
          {!sharedLoading && sharedGroups.length > 0 && (
            <div style={{padding:'8px 0 0'}}>
              <div style={{padding:'4px 20px 10px',fontSize:9,letterSpacing:1.5,color:'var(--text3)',fontFamily:"'Cinzel',serif"}}>
                {sharedGroups.length} SÉQUENCE{sharedGroups.length>1?'S':''} — {sharedGroups.reduce((a,g)=>a+g.count,0)} AYATS
              </div>
              {sharedGroups.map((g, gi) => (
                <SharedGroup key={gi} group={g} sharedN={sharedN} searchMode={searchMode}
                  onNavigate={onNavigate} toggleLink={toggleLink} isLinked={isLinked}
                  onOpenCollModal={onOpenCollModal} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Suggestions */}
      {!isSharedMode && !query && (
        <div>
          <div style={{fontSize:9,letterSpacing:2,color:"var(--text3)",marginBottom:8,fontFamily:"'Cinzel',serif"}}>SUGGESTIONS DE RECHERCHE</div>
          <div className="concord-tags-row">
            {SUGGESTED_SEARCHES.map(s => (
              <button key={s} className="concord-tag" onClick={() => setQuery(s)}>
                <span style={{fontFamily:"'Amiri Quran',serif",fontSize:16,direction:"rtl"}}>{s}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chargement initial */}
      {!isSharedMode && loading && groups.length === 0 && (
        <div className="concord-loading">
          <div className="loading-ring" />
          SCAN EN COURS...
        </div>
      )}

      {/* Pas de résultats */}
      {!loading && debouncedQ && groups.length === 0 && (
        <div className="concord-empty">
          <div className="concord-empty-arabic">لا نتائج</div>
          <div className="concord-empty-msg">AUCUN AYAT TROUVÉ<br/>Essayez un autre mot ou le mode FLOU</div>
        </div>
      )}

      {/* Résultats */}
      {groups.length > 0 && (
        <>
          <div className="concord-results-header">
            <div className="concord-results-count">
              <span>~{totalCount}</span> AYAT{totalCount>1?"S":""} · <span>{groups.length}</span> SOURATE{groups.length>1?"S":""}
              {loading && (
                <span style={{marginLeft:8,display:"inline-flex",alignItems:"center",gap:5,color:"var(--text3)",fontSize:9}}>
                  <span style={{width:10,height:10,border:"1.5px solid var(--border2)",borderTopColor:"var(--gold)",borderRadius:"50%",display:"inline-block",animation:"spin .8s linear infinite"}}/>
                  EN COURS...
                </span>
              )}
            </div>
            <div style={{fontSize:9,letterSpacing:1,color:"var(--text3)"}}>
              CLIQUEZ SUR UNE SOURATE POUR CHARGER LES AYATS
            </div>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {groups.map(group => (
              <ConcordGroup
                key={`${group.surahNum}-${debouncedQ}`}
                group={group}
                debouncedQ={debouncedQ}
                onNavigate={onNavigate}
                isLinked={isLinked}
                toggleLink={toggleLink}
                textCache={cacheRef}
                onOpenCollModal={onOpenCollModal}
                ayatInCollectionsFn={ayatInCollectionsFn}
              />
            ))}
          </div>
        </>
      )}

      {/* Ayats liés */}
      {linkedAyats.length > 0 && (
        <div className="concord-links-panel">
          <div className="concord-links-title">🔗 AYATS LIÉS · {linkedAyats.length}</div>
          {linkedAyats.map(link => (
            <div key={link.key} className="concord-link-card" onClick={()=>onNavigate(link.surahNum, link.ayatNum)}>
              <div className="concord-link-ref">{link.surahEn} · {link.ayatNum}</div>
              <div className="concord-link-text">{link.text}</div>
              <button className="concord-link-remove" onClick={e=>{e.stopPropagation();toggleLink(link.surahNum,link.surahEn,link.ayatNum,link.text);}}>✕</button>
            </div>
          ))}
          <div style={{marginTop:10}}>
            <button className="btn-small" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>{
              setLinkedAyats([]);
              try{localStorage.removeItem("quran_concordLinks");}catch{}
            }}>EFFACER TOUS LES LIENS</button>
          </div>
        </div>
      )}

      {!query && linkedAyats.length === 0 && (
        <div className="concord-empty">
          <div className="concord-empty-arabic">البحث</div>
          <div className="concord-empty-msg">
            RECHERCHEZ DES MOTS OU PARTIES D'AYATS<br/>
            PUIS LIEZ LES VERSETS QUI PARTAGENT UN THÈME
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP (inner — wrapped by Provider below) ─────────────────────────────
function AppInner({ currentUser, onSignOut }) {
  const dispatch = useDispatch();

  // ── Selectors ──────────────────────────────────────────────────────
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
  // ── High-frequency play state → refs + version counter (avoids full re-render) ──
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
  const [selMenu, setSelMenu] = useState(null); // {x,y,text} — custom context menu on ayat text selection
  const [pendingSearchQuery, setPendingSearchQuery] = useState(null);
  const handleAyatContextMenu = (e) => {
    const winSel = window.getSelection ? window.getSelection() : null;
    const text = winSel ? winSel.toString().trim() : "";
    if (!text) { setSelMenu(null); return; } // no selection → let native menu show
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

  // ── Sync URL → Redux (selectedSurah, openAyatNum) ──
  useEffect(() => {
    if (isNaN(urlSurahNum) || surahs.length === 0) return;
    const s = surahs.find(x => x.number === urlSurahNum);
    if (s && s.number !== selectedSurah?.number) {
      setSelectedSurah(s);
    } else if (s && s.number === selectedSurah?.number) {
      // Same surah — back navigation: restore openAyatNum from URL or lastAyatBySurah
      const targetAyat = !isNaN(urlAyatNum) ? urlAyatNum : (lastAyatBySurah[urlSurahNum] ?? null);
      if (targetAyat != null) {
        setOpenAyatNum(targetAyat);
        const tryScroll = (attempts = 0) => {
          const el = ayatRefs.current[targetAyat];
          if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
          else if (attempts < 20) requestAnimationFrame(() => tryScroll(attempts + 1));
        };
        requestAnimationFrame(() => tryScroll());
      } else {
        setOpenAyatNum(null);
      }
    }
    if (!isNaN(urlAyatNum) && s?.number !== selectedSurah?.number) setTimeout(() => {
      setOpenAyatNum(urlAyatNum);
      const el = ayatRefs.current[urlAyatNum];
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    }, 400);
  }, [urlSurahNum, urlAyatNum, surahs.length, activePage]);

  // ── Sync Redux → URL (selectedSurah) ──
  useEffect(() => {
    if (!selectedSurah) return;
    const target = `/quran/${selectedSurah.number}`;
    if (!location.pathname.startsWith(target)) navigate(target, { replace: true });
  }, [selectedSurah?.number]);

  // ── Sync Redux → URL (openAyatNum) ──
  useEffect(() => {
    if (!selectedSurah || openAyatNum == null) return;
    const target = `/quran/${selectedSurah.number}/${openAyatNum}`;
    if (location.pathname !== target) navigate(target, { replace: true });
  }, [openAyatNum, selectedSurah?.number]);
  const showTsBar           = useSelector(sel.showTsBar);
  const enableTimestamps     = useSelector(sel.enableTimestamps);
  const enableLetterByLetter = useSelector(sel.enableLetterByLetter);
  const enableAnimations     = useSelector(sel.enableAnimations);
  const enableHeavyCompute   = useSelector(sel.enableHeavyCompute);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showUserMenu, setShowUserMenu]         = useState(false);
  const userMenuRef                             = useRef(null);

  // Close user menu on outside click or page change
  useEffect(() => {
    const handleOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) {
      document.addEventListener("mousedown", handleOutside);
      document.addEventListener("touchstart", handleOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [showUserMenu]);

  useEffect(() => {
    setShowUserMenu(false);
  }, [activePage]);

  const loopActiveRef   = useRef(false);
  const loopStartRef    = useRef(0);
  const loopEndRef      = useRef(0);
  const [loopStateVer, setLoopStateVer] = useState(0);
  useEffect(() => {
    const unsub = store.subscribe(() => {
      const s = store.getState();
      const la = sel.loopActive(s), ls = sel.loopStart(s), le = sel.loopEnd(s);
      if (la !== loopActiveRef.current || ls !== loopStartRef.current || le !== loopEndRef.current) {
        loopActiveRef.current = la; loopStartRef.current = ls; loopEndRef.current = le;
        setLoopStateVer(v => v + 1);
      }
    });
    return unsub;
  }, []);
  const loopActive = loopActiveRef.current;
  const loopStart  = loopStartRef.current;
  const loopEnd    = loopEndRef.current;
  const loopMax         = useSelector(sel.loopMax);
  const loopCount       = useSelector(sel.loopCount);
  const showLoopBar     = useSelector(sel.showLoopBar);
  const loopStartInput  = useSelector(sel.loopStartInput);
  const loopEndInput    = useSelector(sel.loopEndInput);
  const loopBySurah     = useSelector(sel.loopBySurah);
  const playingPartRef  = useRef(null);
  useEffect(() => {
    const unsub = store.subscribe(() => {
      const pp = sel.playingPart(store.getState());
      if (pp?.ayatNum !== playingPartRef.current?.ayatNum || pp?.partId !== playingPartRef.current?.partId) {
        playingPartRef.current = pp;
        setPlayStateVer(v => v + 1);
      }
    });
    return unsub;
  }, []);
  const playingPart = playingPartRef.current;
  const listening       = useSelector(sel.listening);
  const voiceToast      = useSelector(sel.voiceToast);
  const showVoiceHelp   = useSelector(sel.showVoiceHelp);
  const showQalqala     = useSelector(sel.showQalqala);
  const showMadd        = useSelector(sel.showMadd);
  const showIzhar       = useSelector(sel.showIzhar);
  const showIdgham      = useSelector(sel.showIdgham);
  const announceNum     = useSelector(sel.announceNum);
  const spellCheck      = useSelector(sel.spellCheck);
  const showParts       = useSelector(sel.showParts);
  const showVoiceInput  = useSelector(sel.showVoiceInput);
  const voiceInputText  = useSelector(sel.voiceInputText);
  const goals           = useSelector(sel.goals, shallowEqual);
  const activity        = useSelector(sel.activity, shallowEqual);

  // ── Dispatch shims (drop-in replacements for old setState calls) ───
  const setSurahs          = (v) => dispatch(quranActions.setSurahs(v));
  const setSelectedSurah   = (v) => dispatch(quranActions.setSelectedSurah(v));
  const setAyats           = (v) => dispatch(quranActions.setAyats(v));
  const setLoadingAyats    = (v) => dispatch(quranActions.setLoadingAyats(v));
  const setSearch          = (v) => dispatch(quranActions.setSearch(v));
  const setOpenAyatNum     = (v) => {
    dispatch(quranActions.setOpenAyatNum(v));
    if (v == null) setAideMemoireClickModes({});
  };
  const setSubmenuMode     = (v) => dispatch(quranActions.setSubmenuMode(v));
  const setLastAyatForSurah = (surahNum, ayatNum) => dispatch(quranActions.setLastAyatForSurah({ surahNum, ayatNum }));
  const setPartSelectAyat  = (v) => dispatch(learnActions.setPartSelectAyat(v));
  const setPartSelectStep  = (v) => dispatch(learnActions.setPartSelectStep(v));
  const setPartSelectStart = (v) => dispatch(learnActions.setPartSelectStart(v));
  const setPlayingPart     = (v) => dispatch(playerActions.setPlayingPart(v));
  const setPartCurrentMs   = (v) => dispatch(playerActions.setPartCurrentMs(v));
  const setLocalPlaying    = (v) => dispatch(playerActions.setLocalPlaying(v));
  const setCollModal       = (v) => dispatch(collectionsActions.setCollModal(v));
  const setPlayingAyatNum  = (v) => dispatch(playerActions.setPlayingAyatNum(v));
  const setIsMainPlaying   = (v) => dispatch(playerActions.setIsMainPlaying(v));
  const setMainAyatIdx     = (v) => dispatch(playerActions.setMainAyatIdx(v));
  const setTimestampsMap   = (v) => { timestampsMapRef.current = v; tsVersionRef.current++; setTsVersion(n => n + 1); };
  const updateTimestamps   = (v) => {
    Object.assign(timestampsMapRef.current, v);
    tsVersionRef.current++;
    // Use startTransition so timestamp render doesn't block user interactions
    if (typeof React.startTransition === 'function') {
      React.startTransition(() => setTsVersion(n => n + 1));
    } else {
      setTsVersion(n => n + 1);
    }
  };
  const setMainCurrentMs   = (v) => dispatch(playerActions.setMainCurrentMs(v));
  const setSidebarOpen     = (v) => dispatch(uiActions.setSidebarOpen(v));
  const setActivePage      = (v) => navigate("/" + v);
  const setShowTsBar       = (v) => dispatch(uiActions.setShowTsBar(v));
  const setLoopActive      = (v) => dispatch(playerActions.setLoopActive(v));
  const setLoopStart       = (v) => dispatch(playerActions.setLoopStart(v));
  const setLoopEnd         = (v) => dispatch(playerActions.setLoopEnd(v));
  const setLoopMax         = (v) => dispatch(playerActions.setLoopMax(v));
  const saveLoopForSurah   = (surahNum, data) => dispatch(playerActions.saveLoopForSurah({ surahNum, ...data }));
  const setLoopCount       = (v) => dispatch(playerActions.setLoopCount(v));
  const setShowLoopBar     = (v) => dispatch(uiActions.setShowLoopBar(v));
  const setLoopStartInput  = (v) => dispatch(playerActions.setLoopStartInput(v));
  const setLoopEndInput    = (v) => dispatch(playerActions.setLoopEndInput(v));
  const setListening       = (v) => dispatch(voiceActions.setListening(v));
  const setVoiceToast      = (v) => dispatch(voiceActions.setVoiceToast(v));
  const setShowVoiceHelp   = (v) => dispatch(uiActions.setShowVoiceHelp(v));
  const [showTajweedPanel, setShowTajweedPanel] = React.useState(false);
  const [showArabicKeyboard, setShowArabicKeyboard] = React.useState(() => { try { return localStorage.getItem('quran_arabic_keyboard') === '1'; } catch { return false; } });
  const activeArabicInput = React.useRef(null);
  const [showOptionsPanel, setShowOptionsPanel] = React.useState(false);
  const [showLangPanel,    setShowLangPanel]    = React.useState(false);
  const [recitatorId,      setRecitatorId]      = useState(() => { try { return localStorage.getItem('quran_recitator') || 'ar.alafasy'; } catch { return 'ar.alafasy'; } });
  const [showRecitPanel,   setShowRecitPanel]   = useState(false);
  const [recitatorSearch,  setRecitatorSearch]  = useState("");
  // Bumped whenever a reciter's bitrate self-heals (markBitrateBad) so components
  // re-render and pick up the newly-known-good bitrate for that reciter.
  const [bitrateVersion,   setBitrateVersion]   = useState(0);

  // Keep global in sync with state
  useEffect(() => { setGlobalRecitator(recitatorId); }, [recitatorId]);

  // Fetch the official bitrate list (from the API's own audio/audioSecondary fields) for the
  // currently selected reciter as soon as it's chosen — this is the "real" data, so it takes
  // over from the generic guess order the moment it arrives.
  useEffect(() => {
    let cancelled = false;
    fetchOfficialBitrates(recitatorId).then(() => { if (!cancelled) setBitrateVersion(v => v + 1); });
    return () => { cancelled = true; };
  }, [recitatorId]);

  // Warm the same cache for every other reciter in the background (staggered, one at a time)
  // so the picker panel can show everyone's real bitrate without waiting for each to be selected.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const r of RECITATORS) {
        if (cancelled) return;
        await fetchOfficialBitrates(r.id);
        if (cancelled) return;
        setBitrateVersion(v => v + 1);
        await new Promise(res => setTimeout(res, 250));
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bitrate   = getReciterBitrate(recitatorId); // eslint-disable-line react-hooks/exhaustive-deps
  const audioBase = `${AUDIO_CDN_ROOT}/${bitrate}/${recitatorId}`;
  const activeRecitator = RECITATORS.find(r => r.id === recitatorId);
  const visibleRecitators = RECITATORS.filter(r =>
    r.label.toLowerCase().includes(recitatorSearch.trim().toLowerCase())
  );
  const toggleQalqala      = () => dispatch(uiActions.toggleQalqala());
  const toggleMadd         = () => dispatch(uiActions.toggleMadd());
  const toggleIzhar        = () => dispatch(uiActions.toggleIzhar());
  const toggleIdgham       = () => dispatch(uiActions.toggleIdgham());
  const toggleAnnounceNum  = () => dispatch(uiActions.toggleAnnounceNum());
  const toggleSpellCheck   = () => dispatch(uiActions.toggleSpellCheck());
  const toggleShowParts    = () => dispatch(uiActions.toggleShowParts());
  const toggleEnableTimestamps     = () => dispatch(uiActions.toggleEnableTimestamps());
  const toggleEnableLetterByLetter = () => dispatch(uiActions.toggleEnableLetterByLetter());
  const toggleEnableAnimations     = () => dispatch(uiActions.toggleEnableAnimations());
  const toggleEnableHeavyCompute   = () => dispatch(uiActions.toggleEnableHeavyCompute());
  const setShowVoiceInput  = (v) => dispatch(voiceActions.setShowVoiceInput(v));
  const setVoiceInputText  = (v) => dispatch(voiceActions.setVoiceInputText(v));

  // Part audio refs (not in Redux — updated 60fps, no need to re-render)
  const partAudioRef  = useRef(null);
  const partRafRef    = useRef(null);

  const stopPartRaf = () => { if (partRafRef.current) { cancelAnimationFrame(partRafRef.current); partRafRef.current = null; } };
  const startPartRaf = () => {
    stopPartRaf();
    const tick = () => {
      if (partAudioRef.current) setPartCurrentMs(partAudioRef.current.currentTime * 1000);
      partRafRef.current = requestAnimationFrame(tick);
    };
    partRafRef.current = requestAnimationFrame(tick);
  };

  // ── setLData shim ──────────────────────────────────────────────────
  const setLData = useCallback((surahNum, ayatNum, fn) => {
    dispatch(setLDataThunk(surahNum, ayatNum, fn));
  }, [dispatch]);

  // ── Collections helpers ────────────────────────────────────────────
  const saveCollections    = null; // no longer needed — Redux handles persistence
  const createCollection   = (name)            => dispatch(collectionsActions.createCollection(name));
  const deleteCollection   = (id)              => dispatch(collectionsActions.deleteCollection(id));
  const toggleAyatInCollection = (collId, ayatEntry) => dispatch(collectionsActions.toggleAyatInCollection({ collId, ayatEntry }));
  // Memoized per-surah collection lookup — O(1) instead of O(collections×ayats) per row
  const collectionsByAyat = useMemo(() => {
    const map = {};
    for (const c of collections) {
      for (const a of (c.ayats || [])) {
        const k = `${a.surahNum}:${a.ayatNum}`;
        if (!map[k]) map[k] = [];
        map[k].push(c.id);
      }
    }
    return map;
  }, [collections]);
  const ayatInCollections = (surahNum, ayatNum) => collectionsByAyat[`${surahNum}:${ayatNum}`] || [];

  const recognitionRef = useRef(null);
  const toastTimerRef  = useRef(null);

  const ayatRefs     = useRef({});
  const mainAudioRef = useRef(null);
  const tsLoadGenRef = useRef(0); // incremented on each surah change to cancel stale ts loads

  // Re-run timestamp auto-load when the reciter changes (without redoing the whole
  // surah-load effect below, which also restores scroll position, loop, etc.)
  useEffect(() => {
    if (!selectedSurah || !sel.enableTimestamps(store.getState())) return;
    const gen = ++tsLoadGenRef.current;
    loadTimestampsForSurah(selectedSurah.number, recitatorId).then(parsed => {
      if (gen !== tsLoadGenRef.current) return;
      if (parsed && Object.keys(parsed).length > 0) updateTimestamps(parsed);
    });
  }, [recitatorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [renderLimit, setRenderLimit] = useState(30);
  const [pageMode,    setPageMode]    = useState(() => { try { return JSON.parse(localStorage.getItem('quran_page_mode')) ?? false; } catch { return false; } });
  const [surahMeta,   setSurahMeta]   = useState(null); // { hizb, juz, page, wordCount }
  const [pageMeta,    setPageMeta]    = useState(null); // { hizb, juz, ayatCount, wordCount } for current page
  const [showSurahInfo, setShowSurahInfo] = useState(false);
  const [showAyatJump, setShowAyatJump] = useState(false);
  const [surahTextCache, setSurahTextCache] = useState({}); // surahNum → { numberInSurah: text } — feeds mastery calc
  const [ayatSearchInput, setAyatSearchInput] = useState("");
  const [autoPageFollow, setAutoPageFollow] = useState(true);
  const [translationLang, setTranslationLang] = useState(null); // null | 'fr'|'en'|'tr'…
  const [translations, setTranslations] = useState({}); // { 'fr:2': [{numberInSurah, text}] }
  const [activePageCoran,  setactivePageCoran]  = useState(null);
  React.useEffect(() => { try { localStorage.setItem('quran_page_mode', JSON.stringify(pageMode)); } catch {} }, [pageMode]);
  const rafRef       = useRef(null);
  const wakeLockRef  = useRef(null);

  const [showRappel, setShowRappel] = useState(false);
  const [aideMemoireClickModes, setAideMemoireClickModes] = useState({});

  const surahs_ref    = useRef(surahs);
  const ayats_ref     = useRef(ayats);
  const selSurah_ref  = useRef(selectedSurah);
  useEffect(() => {
    if (!selectedSurah) { setSurahMeta(null); return; }
    fetchSurahMeta(selectedSurah.number).then(setSurahMeta).catch(() => setSurahMeta(null));
  }, [selectedSurah?.number]);
  useEffect(() => {
    if (!pageMode || !ayats || ayats.length === 0) { setPageMeta(null); return; }
    const curPage = activePageCoran ?? ayats[mainAyatIdx]?.page ?? null;
    if (!curPage) { setPageMeta(null); return; }
    fetchPageMeta(curPage).then(setPageMeta).catch(() => setPageMeta(null));
  }, [pageMode, activePageCoran, mainAyatIdx, ayats]);
  useEffect(() => {
    if (!translationLang || !selectedSurah) return;
    const key = `${translationLang}:${selectedSurah.number}`;
    if (translations[key]) return;
    fetchSurahTranslation(selectedSurah.number, translationLang).then(data => {
      setTranslations(p => ({ ...p, [key]: data }));
    }).catch(() => {});
  }, [translationLang, selectedSurah?.number]);

  // pageMode: auto-change page when mainAyatIdx moves to a different page, then scroll to ayat
  useEffect(() => {
    if (!pageMode || !autoPageFollow || !ayats || ayats.length === 0) return;
    const curAyat = ayats[mainAyatIdx];
    if (!curAyat?.page) return;
    const curPage = activePageCoran ?? ayats[0]?.page;
    if (curAyat.page !== curPage) {
      setactivePageCoran(curAyat.page);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ayatRefs.current[curAyat.numberInSurah]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    }
  }, [mainAyatIdx, pageMode, autoPageFollow]);

  // pageMode: when page changes manually, scroll to first ayat of that page
  useEffect(() => {
    if (!pageMode || !activePageCoran || !ayats || ayats.length === 0) return;
    const firstOfPage = ayats.find(a => a.page === activePageCoran);
    if (!firstOfPage) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ayatRefs.current[firstOfPage.numberInSurah]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }, [activePageCoran, pageMode]);
  useEffect(() => { ayats_ref.current = ayats; }, [ayats]);
  useEffect(() => { selSurah_ref.current = selectedSurah; }, [selectedSurah]);

  // ── AUDIO PERSISTANCE APK / VEILLE MOBILE ────────────────────────
  // Stratégie multi-couches pour WebView Android :
  // 1. Media Session API  → contrôles écran verrouillé + signal "média actif"
  // 2. Pre-fetch audio    → l'ayat suivant est chargé à l'avance
  // 3. visibilitychange   → reprend si le WebView a suspendu l'audio
  // 4. Wake Lock API      → fallback si disponible (Chromium récent)
  // 5. Silent audio loop  → maintient le contexte audio actif en arrière-plan

  const silentAudioRef  = useRef(null);   // <audio> silencieux en boucle
  const prefetchRef     = useRef(null);   // <audio> de pré-chargement
  const isPlayingRef    = useRef(false);  // ref miroir pour closures

  // Maintenir ref miroir de isMainPlaying (utilisable dans les callbacks)
  useEffect(() => { isPlayingRef.current = isMainPlaying; }, [isMainPlaying]);

  // Robust "resume playback" helper — tries immediately, and again as soon as the
  // audio element signals it's actually ready (more reliable in background than a
  // blind setTimeout, which Android can throttle/delay well past the media's own timing).
  const playWhenReady = useCallback(() => {
    const a = mainAudioRef.current;
    if (!a) return;
    const tryNow = () => a.play().catch(() => {});
    tryNow();
    if (a.readyState < 2) {
      const onReady = () => { tryNow(); a.removeEventListener('canplay', onReady); };
      a.addEventListener('canplay', onReady, { once: true });
    }
  }, []);

  // ── 1. Media Session API ──────────────────────────────────────────
  const updateMediaSession = useCallback((ayat, surah) => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Ayat ${ayat?.numberInSurah || ''}`,
        artist: surah?.englishName || 'Quran',
        album: 'القرآن الكريم',
        artwork: [{ src: 'https://cdn.islamic.network/quran/images/chapter_icon.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch {}
  }, []);

  // Enregistrer les action handlers Media Session une seule fois
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play:         () => { setIsMainPlaying(true); mainAudioRef.current?.play().catch(()=>{}); },
      pause:        () => { setIsMainPlaying(false); mainAudioRef.current?.pause(); },
      stop:         () => { setIsMainPlaying(false); mainAudioRef.current?.pause(); },
      nexttrack:    () => {
        const a = ayats_ref.current;
        const idx = Math.min((a.findIndex(x => x.numberInSurah === (mainAudioRef.current?._ayatNum)) || 0) + 1, a.length - 1);
        playMainAyat(idx);
        playWhenReady();
      },
      previoustrack: () => {
        const a = ayats_ref.current;
        const idx = Math.max((a.findIndex(x => x.numberInSurah === (mainAudioRef.current?._ayatNum)) || 0) - 1, 0);
        playMainAyat(idx);
        playWhenReady();
      },
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    });
    return () => {
      Object.keys(handlers).forEach(action => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      });
    };
  }, []); // eslint-disable-line

  // Mettre à jour Media Session quand l'ayat change
  useEffect(() => {
    if (isMainPlaying && currentMainAyat) {
      updateMediaSession(currentMainAyat, selectedSurah);
    }
  }, [mainAyatIdx, isMainPlaying, updateMediaSession]); // eslint-disable-line

  // ── 2. Audio silencieux en boucle (maintient contexte audio actif) ─
  // Un fichier audio silencieux ultra-court en base64 (WAV 0.1s silence)
  const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  useEffect(() => {
    if (!silentAudioRef.current) return;
    const s = silentAudioRef.current;
    s.loop = true;
    s.volume = 0.001; // quasi-silencieux mais non-nul pour éviter optimisations
    if (isMainPlaying) {
      s.play().catch(() => {});
    } else {
      s.pause();
    }
  }, [isMainPlaying]);

  // ── 3. visibilitychange — reprend si suspendu par le WebView ──────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const audio = mainAudioRef.current;
      if (!audio || !isPlayingRef.current) return;
      // Petit délai pour laisser le WebView se réveiller complètement
      setTimeout(() => {
        if (audio.paused && isPlayingRef.current) {
          audio.play().catch(() => {});
        }
        silentAudioRef.current?.play().catch(() => {});
        // Re-signaler à Android que le média est actif
        if ('mediaSession' in navigator) {
          try { navigator.mediaSession.playbackState = 'playing'; } catch {}
        }
      }, 300);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    // Aussi sur 'resume' pour les WebView qui émettent cet événement
    document.addEventListener('resume', handleVisibility);

    // Capacitor natif : plus fiable que 'visibilitychange' dans certaines WebView Android
    let removeCapListener = null;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const sub = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) handleVisibility();
        });
        removeCapListener = () => sub.remove();
      } catch {} // plugin absent ou non-natif : les listeners web ci-dessus suffisent
    })();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('resume', handleVisibility);
      removeCapListener?.();
    };
  }, []);

  // ── 4. Wake Lock API (Chromium WebView récent) ────────────────────
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;
    if (isMainPlaying) {
      navigator.wakeLock.request('screen').then(l => { lock = l; wakeLockRef.current = l; }).catch(() => {});
    } else {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
    const reacquire = () => {
      if (isPlayingRef.current && !lock) {
        navigator.wakeLock.request('screen').then(l => { lock = l; wakeLockRef.current = l; }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => {
      lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', reacquire);
    };
  }, [isMainPlaying]);

  // ── 6. Watchdog — auto-relance si l'OS a mis l'audio en pause en arrière-plan ──
  // Contrairement à un setTimeout ponctuel (peut être différé indéfiniment quand le
  // WebView est en arrière-plan), un setInterval continue de se déclencher (throttled
  // mais jamais totalement gelé) : c'est le filet de sécurité qui répare toute lecture
  // interrompue par le système, sans dépendre du retour au premier plan de l'utilisateur.
  useEffect(() => {
    if (!isMainPlaying) return;
    const iv = setInterval(() => {
      const a = mainAudioRef.current;
      if (a && isPlayingRef.current && a.paused && !a.ended) {
        a.play().catch(() => {});
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [isMainPlaying]);

  // ── 5. Pré-chargement de l'ayat suivant ──────────────────────────
  useEffect(() => {
    if (!isMainPlaying || !ayats.length) return;
    const nextIdx = mainAyatIdx + 1;
    if (nextIdx >= ayats.length) return;
    const nextUrl = `${getAudioBase()}/${ayats[nextIdx].number}.mp3`;
    if (!prefetchRef.current) {
      prefetchRef.current = new Audio();
      prefetchRef.current.preload = 'auto';
    }
    prefetchRef.current.src = nextUrl;
    prefetchRef.current.load();
  }, [mainAyatIdx, isMainPlaying, ayats]);

  useEffect(() => {
    fetchSurahs().then(d => { setSurahs(d); }); // setSurahs already sets loadingSurahs:false in reducer
    // SW registered only in prod/Android (not localhost) so dev streams CDN directly
    if ('serviceWorker' in navigator && window.location.hostname !== 'localhost') {
      navigator.serviceWorker.register('/audio-sw.js', { scope: '/' }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!selectedSurah) return;
    setOpenAyatNum(null); setPlayingAyatNum(null);
    setactivePageCoran(null);
    setIsMainPlaying(false); setMainCurrentMs(0);
    setLoopActive(false); setLoopCount(0);
    // Only show spinner if data isn't already in memory cache
    if (quranMemCache[`alafasy:${selectedSurah.number}`] == null) setLoadingAyats(true);
    fetchAyats(selectedSurah.number).then(d => {
      const ayahList = (d.ayahs || []).map(a => {
        if (a.numberInSurah === 1 && a.text) {
          // Strip leading basmala from first ayat (except Al-Fatiha surah 1 and At-Tawba surah 9)
          const sn = selectedSurah.number;
          if (sn !== 1 && sn !== 9) {
            // Basmala = exactly 4 words: بسم / الله / الرحمن / الرحيم
            // Check first word starts with بسم (bare, no diacritics)
            const words = a.text.trim().split(' ');
            const stripD = s => s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');
            if (words.length > 4 && stripD(words[0]) === 'بسم') {
              return { ...a, text: words.slice(4).join(' ') };
            }
            return a;
          }
        }
        return a;
      });
      const savedAyatNum = lastAyatBySurah[selectedSurah.number] ?? null;
      const restoredIdx = savedAyatNum != null
        ? Math.max(0, ayahList.findIndex(a => a.numberInSurah === savedAyatNum))
        : 0;
      // Start render window around the active ayat so it's visible immediately
      const initialLimit = Math.max(30, restoredIdx + 15);
      setRenderLimit(initialLimit);
      setAyats(ayahList); setLoadingAyats(false);
      setMainAyatIdx(restoredIdx);
      setactivePageCoran(null); // reset; will be derived from mainAyatIdx
      if (savedAyatNum != null) setOpenAyatNum(savedAyatNum);
      // Expand remaining ayats progressively after first paint
      const total = ayahList.length;
      const expandChunk = (from) => {
        if (from >= total) return;
        const next = Math.min(from + 50, total);
        requestAnimationFrame(() => { setRenderLimit(next); expandChunk(next); });
      };
      requestAnimationFrame(() => expandChunk(initialLimit));
      // Restore loop
      const savedLoop = loopBySurah[selectedSurah.number];
      if (savedLoop) {
        setLoopActive(savedLoop.active ?? false);
        setLoopStart(Math.min(savedLoop.start ?? 0, ayahList.length - 1));
        setLoopEnd(Math.min(savedLoop.end ?? Math.min(2, ayahList.length - 1), ayahList.length - 1));
        setLoopMax(savedLoop.max ?? 0);
        setLoopStartInput(parseInt(savedLoop.startInput) || 1);
        setLoopEndInput(parseInt(savedLoop.endInput) || Math.min(3, ayahList.length));
      } else {
        setLoopStart(0); setLoopEnd(Math.min(2, ayahList.length - 1));
        setLoopStartInput(1); setLoopEndInput(Math.min(3, ayahList.length));
      }
      // Scroll to active ayat — retry until ref is mounted (handles progressive render)
      if (savedAyatNum != null) {
        let attempts = 0;
        const tryScroll = () => {
          const el = ayatRefs.current[savedAyatNum];
          if (el) {
            el.scrollIntoView({ behavior: "instant", block: "center" });
          } else if (attempts++ < 20) {
            requestAnimationFrame(tryScroll);
          }
        };
        requestAnimationFrame(tryScroll);
      }
      // Auto-load timestamps deferred — don't block first ayat render
      // Use a ref-based generation counter to discard results from previous surahs
      if (sel.enableTimestamps(store.getState())) {
        const gen = ++tsLoadGenRef.current;
        setTimeout(() => {
          if (gen !== tsLoadGenRef.current) return; // surah changed before we ran
          loadTimestampsForSurah(selectedSurah.number, recitatorId).then(parsed => {
            if (gen !== tsLoadGenRef.current) return; // surah changed while loading
            if (parsed && Object.keys(parsed).length > 0) {
              updateTimestamps(parsed);
            }
          });
        }, 0);
      }
    });
  }, [selectedSurah]);

  useEffect(() => {
    if (selectedSurah && ayats.length > 0) {
      saveLoopForSurah(selectedSurah.number, {
        active: loopActive, start: loopStart, end: loopEnd, max: loopMax,
        startInput: loopStartInput, endInput: loopEndInput,
      });
    }
  }, [loopActive, loopStart, loopEnd, loopMax, loopStartInput, loopEndInput, selectedSurah?.number]);

  useEffect(() => {
    if (selectedSurah && ayats.length > 0) {
      const ayatNum = ayats[mainAyatIdx]?.numberInSurah;
      if (ayatNum != null) setLastAyatForSurah(selectedSurah.number, ayatNum);
    }
  }, [mainAyatIdx, selectedSurah?.number]);

  useEffect(() => {
    if (selectedSurah && openAyatNum != null) {
      setLastAyatForSurah(selectedSurah.number, openAyatNum);
    }
  }, [openAyatNum, selectedSurah?.number]);

  // RAF
  const startRaf = useCallback(() => {
    const tick = () => {
      if (mainAudioRef.current) setMainCurrentMs(mainAudioRef.current.currentTime * 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);
  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);
  useEffect(() => {
    if (isMainPlaying) startRaf(); else stopRaf(); // keep mainCurrentMs as-is on pause so playback can resume from the same spot
    return stopRaf;
  }, [isMainPlaying, startRaf, stopRaf]);

  const lkey     = (s, a) => `${s}:${a}`;
  const getLData = (s, a) => learnData[lkey(s, a)] || { learned: false, readCount: 0, parts: [], wordsLearned: {} };
  // Forced-alignment timestamps are tied to one specific reciter's audio timing,
  // so they're stored/looked-up per reciter (unlike learnData, which stays global).
  const tskey    = (s, a) => `${recitatorId}:${s}:${a}`;

  const announceNumRef = useRef(false);
  useEffect(() => { announceNumRef.current = announceNum; }, [announceNum]);

  const speakAyatNum = useCallback((ayatNum) => {
    if (!announceNumRef.current) return Promise.resolve();
    return new Promise(resolve => {
      const ss = window.speechSynthesis;
      if (!ss) { resolve(); return; }
      ss.cancel();
      const utter = new SpeechSynthesisUtterance(String(ayatNum));
      utter.lang = 'ar-SA';
      utter.rate = 0.85;
      utter.volume = 1;
      utter.onend = resolve;
      utter.onerror = () => resolve();
      // Android Chrome fix: resume if paused
      const resumeTimer = setInterval(() => { if (ss.paused) ss.resume(); }, 250);
      utter.onend = () => { clearInterval(resumeTimer); resolve(); };
      utter.onerror = () => { clearInterval(resumeTimer); resolve(); };
      ss.speak(utter);
    });
  }, []);

  const playMainAyat = useCallback((idx) => {
    if (!ayats.length) return;
    const i = Math.max(0, Math.min(idx, ayats.length - 1));
    const changed = i !== mainAyatIdx;
    setMainAyatIdx(i); setPlayingAyatNum(ayats[i]?.numberInSurah);
    if (changed) setMainCurrentMs(0); // only reset elapsed time on an actual ayat change, not on resume
    const targetAyat = ayats[i];
    // Page mode: if the target ayat lives on a different page than the one currently
    // displayed, switch page first (its DOM node doesn't exist until we do) then scroll to it.
    if (pageMode && targetAyat?.page != null) {
      const curPage = activePageCoran ?? ayats[0]?.page;
      if (targetAyat.page !== curPage) {
        setactivePageCoran(targetAyat.page);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            ayatRefs.current[targetAyat.numberInSurah]?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        });
        return;
      }
    }
    if (changed) ayatRefs.current[ayats[i]?.numberInSurah]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [ayats, mainAyatIdx, pageMode, activePageCoran]);

  const handleMainEnded = useCallback(() => {
    const next = mainAyatIdx + 1;
    if (loopActive) {
      const end = Math.min(loopEnd, ayats.length - 1);
      if (mainAyatIdx < end) {
        playMainAyat(next); playWhenReady();
      } else {
        const nc = loopCount + 1;
        if (loopMax === 0 || nc < loopMax) {
          setLoopCount(nc); playMainAyat(loopStart); playWhenReady();
        } else {
          setLoopActive(false); setLoopCount(0);
          setIsMainPlaying(false); setPlayingAyatNum(null); setMainCurrentMs(0);
        }
      }
      return;
    }
    if (next < ayats.length) { playMainAyat(next); playWhenReady(); }
    else { setIsMainPlaying(false); setPlayingAyatNum(null); setMainCurrentMs(0); }
  }, [mainAyatIdx, ayats, playMainAyat, loopActive, loopStart, loopEnd, loopCount, loopMax, playWhenReady]);

  const loadedAyatIdxRef = useRef(null);
  useEffect(() => {
    if (!mainAudioRef.current) return;
    const audioEl = mainAudioRef.current;
    const ayatChanged = loadedAyatIdxRef.current !== mainAyatIdx;
    if (isMainPlaying) {
      const num = ayats[mainAyatIdx]?.numberInSurah;
      if (ayatChanged) {
        loadedAyatIdxRef.current = mainAyatIdx;
        audioEl.load(); // new ayat → (re)load its audio source from the start
        if (announceNumRef.current && num) {
          audioEl.pause();
          speakAyatNum(num).then(() => { mainAudioRef.current?.play().catch(() => {}); });
        } else {
          audioEl.play().catch(() => {});
        }
      } else {
        audioEl.play().catch(() => {}); // resume: same ayat, same audio element → keeps its currentTime
      }
    } else {
      audioEl.pause(); // pausing never touches currentTime, so resuming continues from here
    }
  }, [mainAyatIdx, isMainPlaying]);

  useEffect(() => {
    if (openAyatNum && submenuMode === "lecture" && selectedSurah) {
      setLData(selectedSurah.number, openAyatNum, d => ({ ...d, readCount: (d.readCount || 0) + 1 }));
      // Record daily activity
      const today = new Date().toISOString().slice(0, 10);
      dispatch(goalsActions.recordActivity({ date: today, ayatsRead: 1 }));
    }
    // Stop part audio when leaving apprentissage tab
    if (submenuMode !== "apprentissage") {
      if (partAudioRef.current && !partAudioRef.current.paused) {
        partAudioRef.current.pause();
      }
      setPlayingPart(null);
      setPartCurrentMs(0);
      stopPartRaf();
    }
  }, [openAyatNum, submenuMode]);

  // ── Toast helper ──
  const showToast = useCallback((text, type = 'info') => {
    setVoiceToast({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setVoiceToast(null), 3000);
  }, []);

  // ── Aller à un ayat par son numéro (sourate courante) ──
  const jumpToAyatNumber = (raw) => {
    const n = parseInt(raw, 10);
    if (!n || !selectedSurah) return;
    const target = ayats.find(a => a.numberInSurah === n);
    if (!target) { showToast(`Ayat ${n} introuvable`, 'error'); return; }
    navigate(`/quran/${selectedSurah.number}/${n}`);
    setOpenAyatNum(n);
    if (pageMode && target.page != null) setactivePageCoran(target.page);
    setTimeout(() => { ayatRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, pageMode ? 250 : 50);
  };

  // ── Voice command execution ──
  const executeCommand = useCallback((cmd) => {
    if (!cmd) return false;
    const s = surahs_ref.current;
    const a = ayats_ref.current;

    if (cmd.action === 'play') {
      const startIdx = loopActive ? loopStart : mainAyatIdx;
      playMainAyat(startIdx); setIsMainPlaying(true);
      showToast('▶ Lecture', 'success'); return true;
    }
    if (cmd.action === 'pause') {
      setIsMainPlaying(false); mainAudioRef.current?.pause();
      showToast('⏸ Pause', 'success'); return true;
    }
    if (cmd.action === 'stop') {
      setIsMainPlaying(false); setPlayingAyatNum(null);
      setLoopActive(false); setLoopCount(0);
      mainAudioRef.current?.pause();
      showToast('⏹ Stop', 'success'); return true;
    }
    if (cmd.action === 'next') {
      const i = Math.min(a.length - 1, mainAyatIdx + 1);
      playMainAyat(i); if (isMainPlaying) setTimeout(() => mainAudioRef.current?.play(), 100);
      showToast(`→ Ayat ${a[i]?.numberInSurah}`, 'success'); return true;
    }
    if (cmd.action === 'prev') {
      const i = Math.max(0, mainAyatIdx - 1);
      playMainAyat(i); if (isMainPlaying) setTimeout(() => mainAudioRef.current?.play(), 100);
      showToast(`← Ayat ${a[i]?.numberInSurah}`, 'success'); return true;
    }
    if (cmd.action === 'surah') {
      const surah = s.find(x => x.number === cmd.number);
      if (surah) { setSelectedSurah(surah); showToast(`📖 ${surah.englishName}`, 'success'); return true; }
    }
    if (cmd.action === 'ayat') {
      const idx = a.findIndex(x => x.numberInSurah === cmd.number);
      if (idx >= 0) {
        playMainAyat(idx);
        if (!isMainPlaying) { setIsMainPlaying(true); }
        else setTimeout(() => mainAudioRef.current?.play(), 100);
        showToast(`→ Ayat ${cmd.number}`, 'success'); return true;
      }
      showToast(`Ayat ${cmd.number} introuvable`, 'error'); return true;
    }
    if (cmd.action === 'loop') {
      const fromIdx = a.findIndex(x => x.numberInSurah === cmd.from);
      const toIdx   = a.findIndex(x => x.numberInSurah === cmd.to);
      if (fromIdx >= 0 && toIdx >= 0) {
        const s = Math.min(fromIdx, toIdx);
        const e = Math.max(fromIdx, toIdx);
        setLoopStart(s); setLoopEnd(e);
        setLoopStartInput(a[s]?.numberInSurah ?? 1);
        setLoopEndInput(a[e]?.numberInSurah ?? 1);
        setLoopActive(true); setLoopCount(0); setShowLoopBar(true);
        playMainAyat(s); setIsMainPlaying(true);
        showToast(`↺ Boucle ${a[s]?.numberInSurah}–${a[e]?.numberInSurah}`, 'success'); return true;
      }
      showToast(`Range introuvable`, 'error'); return true;
    }
    if (cmd.action === 'loop_off') {
      setLoopActive(false); setLoopCount(0);
      showToast('↺ Boucle désactivée', 'success'); return true;
    }
    if (cmd.action === 'repeat') {
      setLoopMax(cmd.times); setLoopActive(true); setLoopCount(0); setShowLoopBar(true);
      showToast(`↺ × ${cmd.times}`, 'success'); return true;
    }
    return false;
  }, [mainAyatIdx, isMainPlaying, loopActive, loopStart, playMainAyat, showToast]);

  // ── Voice recognition — enregistrement continu robuste mobile ──────
  //
  // Problème Android WebView / Chrome mobile :
  //   • continuous:true → erreur "aborted" en boucle sur certains appareils
  //   • continuous:false → session courte, gap au redémarrage, overlap si deux
  //     instances se chevauchent → erreurs "aborted" en cascade
  //
  // Solution : session unique continuous:true avec watchdog.
  //   Si continuous:true échoue 2× de suite → basculer en mode session courte
  //   avec verrou isStarting pour empêcher tout overlap.
  //
  // Couche 1 : Android native bridge  → window.Android.startSpeechRecognition()
  // Couche 2 : Web Speech API continue (continuous:true + watchdog)
  // Couche 3 : Web Speech API sessions courtes (fallback si continuous crash)
  // Couche 4 : Saisie manuelle (dernier recours)

  const shouldListenRef  = useRef(false);
  const voicePausedMain  = useRef(false);   // main audio was paused for voice
  const voicePausedPart  = useRef(false);   // part audio was paused for voice
  const isStartingRef    = useRef(false); // verrou anti-overlap
  const recInstanceRef   = useRef(null);  // instance active
  const voiceLayer       = useRef('unknown');
  const continuousFails  = useRef(0);     // nb d'échecs consecutive de continuous:true
  const restartTimerRef  = useRef(null);
  // showVoiceInput and voiceInputText are now in Redux (voiceSlice)

  const clearRestartTimer = () => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
  };

  // Callback partagé : traite un transcript quelle que soit la couche
  const handleTranscript = useCallback((transcript) => {
    if (!transcript?.trim()) return;
    showToast(transcript, 'info');
    const cmd = parseVoiceCommand(transcript, surahs_ref.current, ayats_ref.current, selSurah_ref.current);
    if (cmd) { executeCommand(cmd); }
    else { showToast(`"${transcript}" — commande inconnue`, 'error'); }
  }, [executeCommand, showToast]);

  // Exposer le callback pour le bridge Android natif
  useEffect(() => {
    window.QuranApp = window.QuranApp || {};
    window.QuranApp.onSpeechResult = (transcript) => {
      handleTranscript(transcript);
      if (shouldListenRef.current) {
        try { window.Android?.startSpeechRecognition('fr-FR'); } catch {}
      } else { setListening(false); }
    };
    window.QuranApp.onSpeechError = () => {
      if (shouldListenRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          try { window.Android?.startSpeechRecognition('fr-FR'); } catch {}
        }, 700);
      } else { setListening(false); }
    };
    return () => {
      clearTimeout(restartTimerRef.current);
      if (window.QuranApp) { window.QuranApp.onSpeechResult = null; window.QuranApp.onSpeechError = null; }
    };
  }, [handleTranscript]);

  // ── Couche Web Speech : crée une instance et la démarre ──
  const spawnRecognition = useCallback((useContinuous) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !shouldListenRef.current || isStartingRef.current) return;

    // Détruire l'instance précédente proprement
    if (recInstanceRef.current) {
      try {
        recInstanceRef.current.onend   = null;
        recInstanceRef.current.onerror = null;
        recInstanceRef.current.onresult= null;
        recInstanceRef.current.abort();
      } catch {}
      recInstanceRef.current = null;
    }

    isStartingRef.current = true;
    const rec = new SR();
    rec.lang            = 'fr-FR';
    rec.continuous      = useContinuous;
    rec.interimResults  = false;
    rec.maxAlternatives = 1;
    recInstanceRef.current  = rec;
    recognitionRef.current  = rec;

    rec.onstart = () => {
      isStartingRef.current = false;
      continuousFails.current = useContinuous ? 0 : continuousFails.current;
      setListening(true);
    };

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handleTranscript(e.results[i][0].transcript.trim());
      }
    };

    rec.onerror = (e) => {
      isStartingRef.current = false;
      clearRestartTimer();

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        shouldListenRef.current = false;
        setListening(false);
        voiceLayer.current = 'manual';
        setShowVoiceInput(true);
        showToast('Micro refusé — saisie manuelle', 'error');
        return;
      }

      if (e.error === 'aborted') {
        // aborted = on a appelé abort() nous-mêmes → ignorer si on arrête
        if (!shouldListenRef.current) { setListening(false); return; }
        // sinon : overlap ou bug WebView — courte pause puis respawn
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 400);
        return;
      }

      if (e.error === 'audio-capture') {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 1200);
        return;
      }

      if (e.error === 'network') {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 2500);
        return;
      }

      // no-speech et autres : redémarrer rapidement
      if (shouldListenRef.current) {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 350);
      }
    };

    rec.onend = () => {
      isStartingRef.current = false;
      if (!shouldListenRef.current) { setListening(false); return; }

      if (useContinuous) {
        // continuous:true s'est terminé seul → probablement pas supporté
        continuousFails.current += 1;
        clearRestartTimer();
        if (continuousFails.current >= 2) {
          // Basculer définitivement en sessions courtes
          restartTimerRef.current = setTimeout(() => spawnRecognition(false), 300);
        } else {
          restartTimerRef.current = setTimeout(() => spawnRecognition(true), 300);
        }
      } else {
        // Session courte terminée normalement → redémarrer
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => spawnRecognition(false), 200);
      }
    };

    try {
      rec.start();
    } catch {
      isStartingRef.current = false;
      restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 600);
    }
  }, [handleTranscript, showToast]);

  const toggleVoice = useCallback(() => {
    if (shouldListenRef.current) {
      // ── ARRÊT ──
      shouldListenRef.current = false;
      clearRestartTimer();
      isStartingRef.current = false;
      if (recInstanceRef.current) {
        try {
          recInstanceRef.current.onend   = null;
          recInstanceRef.current.onerror = null;
          recInstanceRef.current.abort();
        } catch {}
        recInstanceRef.current = null;
      }
      try { window.Android?.stopSpeechRecognition(); } catch {}
      setListening(false);
      setShowVoiceInput(false);
      // ── Reprendre les audios mis en pause pour la voix ──
      if (voicePausedMain.current) {
        voicePausedMain.current = false;
        mainAudioRef.current?.play().catch(() => {});
        setIsMainPlaying(true);
      }
      if (voicePausedPart.current) {
        voicePausedPart.current = false;
        partAudioRef.current?.play().catch(() => {});
      }
    } else {
      // ── DÉMARRAGE : couper tous les audios en cours ──
      voicePausedMain.current = false;
      voicePausedPart.current = false;
      if (isPlayingRef.current) {
        mainAudioRef.current?.pause();
        setIsMainPlaying(false);
        voicePausedMain.current = true;
      }
      if (partAudioRef.current && !partAudioRef.current.paused) {
        partAudioRef.current.pause();
        voicePausedPart.current = true;
      }
      shouldListenRef.current = true;
      continuousFails.current = 0;

      if (window.Android && typeof window.Android.startSpeechRecognition === 'function') {
        voiceLayer.current = 'bridge';
        setListening(true);
        try { window.Android.startSpeechRecognition('fr-FR'); } catch {
          voiceLayer.current = 'webspeech';
          spawnRecognition(true);
        }
      } else if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        voiceLayer.current = 'webspeech';
        spawnRecognition(true);
      } else {
        voiceLayer.current = 'manual';
        setListening(true);
        setShowVoiceInput(true);
      }
    }
  }, [spawnRecognition]);

  // Timestamps
  const handleTimestampsFiles = useCallback(async (files) => {
    const newEntries = {};
    for (const file of files) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        Object.assign(newEntries, parseTimestampsFile(data, selectedSurah?.number, recitatorId));
      } catch (e) { console.error(e); }
    }
    setTimestampsMap({ ...timestampsMap, ...newEntries });
  }, [selectedSurah, timestampsMap, recitatorId]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.json'));
    if (files.length) handleTimestampsFiles(files);
  }, [handleTimestampsFiles]);

  // Loop inputs apply
  const applyLoopInputs = () => {
    const s = (typeof loopStartInput === "number" ? loopStartInput : parseInt(loopStartInput)) || 1;
    const e = (typeof loopEndInput   === "number" ? loopEndInput   : parseInt(loopEndInput))   || 1;
    const si = ayats.findIndex(a => a.numberInSurah === s);
    const ei = ayats.findIndex(a => a.numberInSurah === e);
    if (si >= 0) setLoopStart(si);
    if (ei >= 0) setLoopEnd(ei);
  };

  // Memoized per-surah learn stats — only recomputes when learnData or the text cache changes
  const surahStats = useMemo(() => {
    if (!enableHeavyCompute) return {};
    const stats = {};
    for (const [key, val] of Object.entries(learnData)) {
      const colon = key.indexOf(':');
      if (colon === -1) continue;
      const sn = parseInt(key.slice(0, colon));
      const an = parseInt(key.slice(colon + 1));
      if (!stats[sn]) stats[sn] = { learned: 0, mastery: 0, count: 0 };
      if (val.learned) stats[sn].learned++;
      const ayatText = surahTextCache[sn]?.[an];
      stats[sn].mastery += computeMastery(val, ayatText);
      stats[sn].count++;
    }
    return stats;
  }, [learnData, surahTextCache]);

  // Seed the text cache from the surah currently loaded (no extra fetch needed)
  useEffect(() => {
    if (!selectedSurah || !ayats || ayats.length === 0) return;
    const map = {};
    ayats.forEach(a => { map[a.numberInSurah] = a.text; });
    setSurahTextCache(c => ({ ...c, [selectedSurah.number]: map }));
  }, [ayats, selectedSurah]);

  // Lazily fetch text for any other surah that has learnData but isn't cached yet
  // (needed so the sidebar mastery % is accurate for surahs not currently open)
  useEffect(() => {
    const sns = new Set();
    Object.keys(learnData).forEach(k => {
      const sn = parseInt(k.slice(0, k.indexOf(':')));
      if (!isNaN(sn)) sns.add(sn);
    });
    const toFetch = [...sns].filter(sn => !surahTextCache[sn]);
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const sn of toFetch) {
        try {
          const arr = await fetchSurahSimple(sn); // [{num, text}]
          if (cancelled) return;
          const map = {};
          arr.forEach(a => { map[a.num] = a.text; });
          setSurahTextCache(c => c[sn] ? c : { ...c, [sn]: map });
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [learnData]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredSurahs = useMemo(() => surahs.filter(s =>
    s.englishName.toLowerCase().includes(search.toLowerCase()) ||
    s.name.includes(search) || String(s.number).includes(search)
  ), [surahs, search]);

  const currentMainAyat = ayats[mainAyatIdx];
  const audioUrl = a => a ? `${getAudioBase()}/${a.number}.mp3` : "";
  // Memoized mastery per ayat key
  const masteryMap = useMemo(() => {
    if (!enableHeavyCompute) return {};
    const m = {};
    // Build ayat text lookup from loaded ayats
    const textLookup = {};
    if (selectedSurah && ayats) {
      ayats.forEach(a => { textLookup[`${selectedSurah.number}:${a.numberInSurah}`] = a.text; });
    }
    for (const [k, v] of Object.entries(learnData)) m[k] = computeMastery(v, textLookup[k]);
    return m;
  }, [learnData, enableHeavyCompute, ayats, selectedSurah]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedCount = useMemo(() => selectedSurah
    ? ayats.filter(a => timestampsMapRef.current[tskey(selectedSurah.number, a.numberInSurah)]).length : 0,
  [tsVersion, ayats, selectedSurah, recitatorId]);

  const loopStartNum = ayats[loopStart]?.numberInSurah || 1;
  const loopEndNum   = ayats[Math.min(loopEnd, ayats.length - 1)]?.numberInSurah || 1;

  return (
    <ArabicKeyboardContext.Provider value={{ show: showArabicKeyboard, setShow: setShowArabicKeyboard, activeInput: activeArabicInput }}>
    <>
      <StyleTag />
      <div className="app" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
        <header className="header">
          {/* Left Branding / Hamburger group */}
          <div className="header-left">
            <button
              className="header-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Menu sourates"
              style={{
                background: sidebarOpen ? "rgba(201,168,76,.18)" : undefined,
                borderColor: sidebarOpen ? "rgba(201,168,76,.55)" : undefined,
                color: sidebarOpen ? "var(--gold2)" : undefined,
              }}
            >
              ☰
            </button>

            <div className="header-logo" onClick={() => setActivePage('quran')} title="Accueil Coran">
              <span>QUR<span className="logo-highlight">ÂN</span></span>
              <span className="header-subtitle">STUDY</span>
            </div>
          </div>

          {/* Page nav tabs — Segmented pill control */}
          <nav className="header-nav" aria-label="Navigation principale">
            {[
              { id: "quran",         icon: "📖", label: "CORAN" },
              { id: "prononciation", icon: "🔤", label: "PRONON." },
              { id: "dashboard",     icon: "📊", label: "DASH" },
              { id: "collections",   icon: "🗂", label: "COLL." },
              { id: "revision",      icon: "✏",  label: "RÉVISION" },
            ].map(({ id, icon, label }) => (
              <button
                key={id}
                className={`header-nav-btn${activePage === id ? ` active-${id}` : ""}`}
                onClick={() => setActivePage(id)}
                title={label}
              >
                <span className="nav-icon">{icon}</span>
                <span className="nav-label">{label}</span>
              </button>
            ))}
          </nav>

          {/* Right Action buttons & User Menu */}
          <div className="header-actions" ref={userMenuRef}>
            {/* Arabic keyboard toggle (desktop only) */}
            <button
              className="voice-btn desktop-only-action"
              onClick={() => setShowArabicKeyboard(v => {
                const next = !v;
                try { localStorage.setItem('quran_arabic_keyboard', next ? '1' : '0'); } catch {}
                return next;
              })}
              title={showArabicKeyboard ? "Masquer clavier arabe" : "Afficher clavier arabe"}
              style={{
                background: showArabicKeyboard ? 'rgba(62,184,160,.18)' : undefined,
                borderColor: showArabicKeyboard ? 'var(--teal)' : undefined,
                color: showArabicKeyboard ? 'var(--teal2)' : undefined,
              }}
            >
              ⌨️
            </button>

            {/* Voice Command Mic */}
            <button
              className={`voice-btn${listening ? ' listening' : ''}`}
              onClick={toggleVoice}
              title={listening ? "Arrêter écoute vocale" : "Commande vocale"}
            >
              🎤
            </button>

            {/* Rappel vocal (desktop only) */}
            <button
              className="voice-btn desktop-only-action"
              onClick={() => setShowRappel(v => !v)}
              title="Rappel vocal"
              style={{
                background: showRappel ? 'rgba(201,168,76,.18)' : undefined,
                borderColor: showRappel ? 'rgba(201,168,76,.5)' : undefined,
                color: showRappel ? 'var(--gold2)' : undefined,
              }}
            >
              🔔
            </button>

            {/* User Avatar & Dropdown */}
            {currentUser && (
              <div style={{ position: 'relative' }}>
                <button
                  className={`header-user-btn${showUserMenu ? ' active' : ''}`}
                  onClick={() => setShowUserMenu(v => !v)}
                  title={currentUser.displayName || currentUser.email || "Mon compte"}
                  aria-expanded={showUserMenu}
                >
                  {currentUser.photoURL ? (
                    <img src={currentUser.photoURL} alt="avatar" className="header-avatar" />
                  ) : (
                    <div className="header-avatar-placeholder">
                      {(currentUser.displayName || currentUser.email || "?")[0].toUpperCase()}
                    </div>
                  )}
                </button>

                {/* Mobile / Desktop Dropdown Menu */}
                {showUserMenu && (
                  <div className="header-user-menu">
                    <div className="user-menu-header">
                      <div className="user-menu-name">
                        {currentUser.displayName || "Utilisateur"}
                      </div>
                      <div className="user-menu-email">
                        {currentUser.email || ""}
                      </div>
                    </div>

                    <button
                      className="user-menu-item"
                      onClick={() => {
                        setShowArabicKeyboard(v => {
                          const next = !v;
                          try { localStorage.setItem('quran_arabic_keyboard', next ? '1' : '0'); } catch {}
                          return next;
                        });
                        setShowUserMenu(false);
                      }}
                    >
                      <div className="menu-left">
                        <span>⌨️</span>
                        <span>Clavier Arabe</span>
                      </div>
                      <span className={`user-menu-badge ${showArabicKeyboard ? 'on' : 'off'}`}>
                        {showArabicKeyboard ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    <button
                      className="user-menu-item"
                      onClick={() => {
                        setShowRappel(v => !v);
                        setShowUserMenu(false);
                      }}
                    >
                      <div className="menu-left">
                        <span>🔔</span>
                        <span>Rappel Vocal</span>
                      </div>
                      <span className={`user-menu-badge ${showRappel ? 'on' : 'off'}`}>
                        {showRappel ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    <button
                      className="user-menu-item"
                      onClick={() => {
                        setShowOptionsModal(true);
                        setShowUserMenu(false);
                      }}
                    >
                      <div className="menu-left">
                        <span>⚙</span>
                        <span>Paramètres & Sync</span>
                      </div>
                    </button>

                    <button
                      className="user-menu-item logout"
                      onClick={() => {
                        setShowUserMenu(false);
                        onSignOut();
                      }}
                    >
                      <div className="menu-left">
                        <span>⏏</span>
                        <span>Se déconnecter</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Voice toast */}
        {voiceToast && (
          <div className={`voice-toast${voiceToast.type === 'success' ? ' success' : voiceToast.type === 'error' ? ' error' : ''}`}>
            {listening && <div className="voice-dot" />}
            <span className="transcript">{voiceToast.text}</span>
          </div>
        )}

        {/* Manual voice input — fallback quand SpeechRecognition indisponible (Android WebView) */}
        {showVoiceInput && listening && (
          <div style={{
            position:"fixed",top:66,left:0,right:0,zIndex:490,
            background:"var(--surface2)",borderBottom:"2px solid var(--gold)",
            padding:"10px 14px",display:"flex",gap:10,alignItems:"center",
            boxShadow:"0 4px 20px rgba(0,0,0,.4)"
          }}>
            <div className="voice-dot" />
            <input
              autoFocus
              type="text"
              placeholder="Tapez une commande... (ex: sourate 2, verset 5, play)"
              value={voiceInputText}
              onChange={e => setVoiceInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && voiceInputText.trim()) {
                  handleTranscript(voiceInputText.trim());
                  setVoiceInputText('');
                }
              }}
              style={{
                flex:1,background:"var(--surface3)",border:"1px solid var(--gold)",
                borderRadius:6,padding:"8px 12px",color:"var(--text)",
                fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:1,outline:"none"
              }}
            />
            <button
              onClick={() => { if (voiceInputText.trim()) { handleTranscript(voiceInputText.trim()); setVoiceInputText(''); } }}
              style={{ padding:"8px 14px",background:"rgba(201,168,76,.15)",border:"1px solid var(--gold)",borderRadius:6,color:"var(--gold)",cursor:"pointer",fontSize:11,fontFamily:"'Cinzel',serif",letterSpacing:1,flexShrink:0 }}>
              ↵ OK
            </button>
            <button onClick={toggleVoice}
              style={{ padding:"8px 12px",background:"transparent",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text3)",cursor:"pointer",fontSize:11,flexShrink:0 }}>
              ✕
            </button>
          </div>
        )}

        {/* Voice help panel */}
        {showVoiceHelp && (
          <div className="voice-help">
            <div className="voice-help-title">COMMANDES VOCALES</div>
            {[
              ["▶ Lecture",    "play / joue / lire"],
              ["⏸ Pause",     "pause"],
              ["⏹ Stop",      "stop / arrête"],
              ["→ Suivant",   "suivant"],
              ["← Précédent", "précédent"],
              ["📖 Sourate",  "sourate fatiha / sourate 2"],
              ["→ Verset",    "verset 5 / ayat 12"],
              ["↺ Boucle",    "boucle versets 2 à 7"],
              ["↺ Off",       "arrêter la boucle"],
              ["× Répéter",   "3 fois"],
            ].map(([label, ex]) => (
              <div className="voice-help-cmd" key={label}>
                <span>{label}</span>
                <span className="voice-help-ex">"{ex}"</span>
              </div>
            ))}
          </div>
        )}

        <div className="body">
          {/* Mobile overlay */}
          <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />

          {/* Sidebar — always rendered, accessible via ☰ from any page */}
          <aside className={`sidebar${sidebarOpen ? ' open' : ''}${activePage !== 'quran' ? ' sidebar-floating' : ''}`}>
            <div className="sidebar-search">
              <input placeholder="RECHERCHER..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="sidebar-list">
              {loadingSurahs
                ? <div className="loading"><div className="loading-ring" /><span>CHARGEMENT</span></div>
                : filteredSurahs.map(s => (
                  <div key={s.number}
                    className={`surah-item${selectedSurah?.number === s.number ? " active surah-active" : ""}${(surahStats[s.number]?.learned >= s.numberOfAyahs && s.numberOfAyahs > 0) ? " fully-learned" : ""}`}
                    onClick={() => { setSelectedSurah(s); setSidebarOpen(false); if (activePage !== 'quran') setActivePage('quran'); }}>
                    <div className="surah-num">{s.number}</div>
                    <div className="surah-info">
                      <div className="surah-name-en">{s.englishName}</div>
                      <div className="surah-meta">{s.revelationType} · {s.numberOfAyahs} AYATS{surahStats[s.number]?.learned > 0 ? ` · ${surahStats[s.number].learned}✓` : ''}</div>
                      {(() => { const st = surahStats[s.number]; const total = s.numberOfAyahs || 0; const pct = total > 0 ? Math.round((st?.mastery || 0) / total) : 0; return (
                        <div style={{marginTop:3,display:'flex',alignItems:'center',gap:6}}>
                          <div style={{flex:1,height:2,background:'var(--surface3)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:pct+'%',background:masteryColor(pct),borderRadius:2}} />
                          </div>
                          <span style={{fontSize:7,fontFamily:"'Cinzel',serif",color:masteryColor(pct),flexShrink:0}}>{pct}%</span>
                        </div>
                      ); })()}
                    </div>
                    <div className="surah-name-ar">{s.name}</div>
                  </div>
                ))}
            </div>
          </aside>

          <Routes>
            <Route path="/" element={<Navigate to="/quran" replace />} />
            <Route path="/prononciation" element={<AnimatedPage pageKey="prononciation"><PrononciationPage /></AnimatedPage>} />
            <Route path="/dashboard" element={
              <AnimatedPage pageKey="dashboard"><DashboardPage
                learnData={learnData}
                surahs={surahs}
                goals={goals}
                activity={activity}
                onSetGoal={(key, value) => dispatch(goalsActions.setGoal({ key, value }))}
                onRecordActivity={(date, delta) => dispatch(goalsActions.recordActivity({ date, ...delta }))}
                onNavigate={(surahNum) => { navigate(`/quran/${surahNum}`); const s = surahs.find(x=>x.number===surahNum); if(s){setSelectedSurah(s);} }}
              /></AnimatedPage>
            } />
            <Route path="/collections" element={
              <AnimatedPage pageKey="collections"><CollectionsPage
                collections={collections}
                learnData={learnData}
                showQalqala={showQalqala}
                showMadd={showMadd}
                showIzhar={showIzhar}
                showIdgham={showIdgham}
                setLData={setLData}
                onCreateCollection={createCollection}
                onDeleteCollection={deleteCollection}
                onToggleAyat={toggleAyatInCollection}
                onOpenCollModal={(entry) => setCollModal(entry)}
                ayatInCollectionsFn={ayatInCollections}
                surahs={surahs}
                initialSearchQuery={pendingSearchQuery}
                onConsumeSearchQuery={() => setPendingSearchQuery(null)}
                onNavigate={(surahNum, ayatNum) => {
                  navigate(`/quran/${surahNum}/${ayatNum}`);
                  const s = surahs.find(x => x.number === surahNum);
                  if (s) {
                    setSelectedSurah(s);
                    setTimeout(() => {
                      const el = ayatRefs.current[ayatNum];
                      if (el) { el.scrollIntoView({ behavior:"smooth", block:"center" }); setOpenAyatNum(ayatNum); }
                    }, 1200);
                  }
                }}
              /></AnimatedPage>
            } />
            <Route path="/revision" element={
              <AnimatedPage pageKey="revision"><RevisionPage
                learnData={learnData}
                surahs={surahs}
                setLData={setLData}
                onNavigate={(surahNum, ayatNum) => {
                  navigate(`/quran/${surahNum}/${ayatNum}`);
                  const s = surahs.find(x => x.number === surahNum);
                  if (s) {
                    setSelectedSurah(s);
                    setTimeout(() => {
                      const el = ayatRefs.current[ayatNum];
                      if (el) { el.scrollIntoView({ behavior:"smooth", block:"center" }); setOpenAyatNum(ayatNum); }
                    }, 1200);
                  }
                }}
              /></AnimatedPage>
            } />
            <Route path="/revision/memorise/:surahNum?/:rangeFrom?/:rangeTo?" element={
              <AnimatedPage pageKey="revision"><RevisionPage
                learnData={learnData}
                surahs={surahs}
                setLData={setLData}
                initialFilter="carte"
                onNavigate={(surahNum, ayatNum) => {
                  navigate(`/quran/${surahNum}/${ayatNum}`);
                  const s = surahs.find(x => x.number === surahNum);
                  if (s) {
                    setSelectedSurah(s);
                    setTimeout(() => {
                      const el = ayatRefs.current[ayatNum];
                      if (el) { el.scrollIntoView({ behavior:"smooth", block:"center" }); setOpenAyatNum(ayatNum); }
                    }, 1200);
                  }
                }}
              /></AnimatedPage>
            } />
            <Route path="/revision/questions/:surahNum?/:rangeFrom?/:rangeTo?/:qIdx?" element={
              <AnimatedPage pageKey="revision"><RevisionPage
                learnData={learnData}
                surahs={surahs}
                setLData={setLData}
                initialFilter="questions"
                onNavigate={(surahNum, ayatNum) => {
                  navigate(`/quran/${surahNum}/${ayatNum}`);
                  const s = surahs.find(x => x.number === surahNum);
                  if (s) {
                    setSelectedSurah(s);
                    setTimeout(() => {
                      const el = ayatRefs.current[ayatNum];
                      if (el) { el.scrollIntoView({ behavior:"smooth", block:"center" }); setOpenAyatNum(ayatNum); }
                    }, 1200);
                  }
                }}
              /></AnimatedPage>
            } />
            <Route path="/quran/book" element={
              <AnimatedPage pageKey="quran-book">
                <QuranBookPage surahs={surahs} />
              </AnimatedPage>
            } />
            <Route path="/quran/book3d" element={
              <AnimatedPage pageKey="quran-book3d">
                <QuranBook3DPage surahs={surahs} />
              </AnimatedPage>
            } />
            <Route path="/quran/:surahNum?/:ayatNum?" element={(
            <AnimatedPage pageKey="quran"><main className="main">
              {!selectedSurah ? (
              <div className="empty-state">
                <div className="empty-arabic">القرآن الكريم</div>
                <span>SÉLECTIONNEZ UNE SOURATE</span>
                <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap',justifyContent:'center'}}>
                  <button onClick={() => navigate('/quran/book')}
                    style={{ fontSize:9, letterSpacing:1.5, padding:'7px 16px',
                      fontFamily:"'Cinzel',serif", background:'rgba(201,168,76,.08)',
                      border:'1px solid rgba(201,168,76,.3)', color:'var(--gold2)',
                      borderRadius:8, cursor:'pointer' }}>📖 LIVRE CSS</button>
                  <button onClick={() => navigate('/quran/book3d')}
                    style={{ fontSize:9, letterSpacing:1.5, padding:'7px 16px',
                      fontFamily:"'Cinzel',serif", background:'rgba(201,168,76,.14)',
                      border:'1px solid rgba(201,168,76,.5)', color:'var(--gold)',
                      borderRadius:8, cursor:'pointer' }}>✨ LIVRE 3D WEBGL</button>
                </div>
              </div>
            ) : (
              <>
                {(() => {
                  const isSurahFullyLearned = ayats.length > 0 && ayats.every(a => getLData(selectedSurah.number, a.numberInSurah).learned);
                  const markAllLearned   = () => ayats.forEach(a => setLData(selectedSurah.number, a.numberInSurah, d => ({ ...d, learned: true })));
                  const unmarkAllLearned = () => ayats.forEach(a => setLData(selectedSurah.number, a.numberInSurah, d => ({ ...d, learned: false })));
                  return (
                <div className="surah-header">
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,flexWrap:'wrap'}}>
                    <div className="surah-header-ornament">{selectedSurah.name}</div>
                    {selectedSurah.number !== 9 && (
                      <div className="surah-header-bismillah" style={{fontFamily:"'Amiri Quran',serif",fontSize:18,color:'var(--gold)',direction:'rtl',opacity:.8,lineHeight:1.3}}>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
                    )}
                  </div>
                  <div className="surah-header-title">{selectedSurah.englishName.toUpperCase()} · <span style={{opacity:.6}}>{selectedSurah.englishNameTranslation?.toUpperCase()}</span> · {selectedSurah.numberOfAyahs} AYATS</div>

                  {/* Compact single-line toolbar: mastery · info toggle · learned toggle · go-to-ayat toggle */}
                  {(() => {
                    const st = surahStats[selectedSurah.number];
                    const total = selectedSurah.numberOfAyahs || 0;
                    const totalMasteryPct = total > 0 ? Math.round((st?.mastery || 0) / total) : 0;

                    const sn = selectedSurah.number;
                    const curPage = pageMode ? (activePageCoran ?? ayats[mainAyatIdx]?.page ?? null) : null;
                    const pageAyats = curPage ? ayats.filter(a => a.page === curPage) : ayats;
                    const totalParts = pageAyats.reduce((s, a) => s + (learnData[lkey(sn, a.numberInSurah)]?.parts?.length || 0), 0);
                    const totalUnk   = pageAyats.reduce((s, a) => s + (learnData[lkey(sn, a.numberInSurah)]?.unknownWords?.length || 0), 0);
                    const meta = pageMode && pageMeta ? pageMeta : surahMeta;
                    const pills = pageMode && curPage ? [
                      { label: 'PAGE',    val: curPage,              color: '#c878ff' },
                      { label: 'HIZB',    val: meta?.hizb    ?? '…', color: '#ffd166' },
                      { label: 'JUZ',     val: meta?.juz     ?? '…', color: '#a8edea' },
                      { label: 'AYATS',   val: meta?.ayatCount ?? pageAyats.length, color: 'var(--gold2)' },
                      { label: 'MOTS',    val: meta?.wordCount ?? '…', color: '#5bc8f5' },
                      { label: 'PARTIES', val: totalParts,            color: '#c878ff' },
                      { label: 'INCONNUS',val: totalUnk, color: totalUnk > 0 ? '#ff9f43' : 'var(--text3)' },
                    ] : [
                      { label: 'HIZB',    val: surahMeta?.hizb ?? '…', color: '#ffd166' },
                      { label: 'AYATS',   val: selectedSurah.numberOfAyahs, color: 'var(--gold2)' },
                      { label: 'MOTS',    val: surahMeta?.wordCount ?? '…', color: '#5bc8f5' },
                      { label: 'PARTIES', val: totalParts, color: '#c878ff' },
                      { label: 'INCONNUS',val: totalUnk,  color: totalUnk > 0 ? '#ff9f43' : 'var(--text3)' },
                    ];
                    const infoLabel = pageMode && curPage ? `PAGE ${curPage}` : `SOURATE`;

                    const pillBtnStyle = (active, activeColor='rgba(255,255,255,.2)') => ({
                      display:'flex', alignItems:'center', gap:4,
                      fontSize:8, letterSpacing:1, padding:'4px 10px', borderRadius:20,
                      fontFamily:"'Cinzel',serif", cursor:'pointer', whiteSpace:'nowrap',
                      background: active ? 'rgba(255,255,255,.06)' : 'transparent',
                      border:'1px solid ' + (active ? activeColor : 'rgba(255,255,255,.1)'),
                      color: active ? 'var(--text2)' : 'var(--text3)', transition:'all .2s',
                    });

                    return (
                      <>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginTop:8,flexWrap:'wrap'}}>
                          {/* Mastery */}
                          <div style={{display:'flex',alignItems:'center',gap:5,padding:'4px 11px',borderRadius:20,
                            border:`1px solid ${masteryColor(totalMasteryPct)}`,background:'rgba(255,255,255,.03)'}}>
                            <span style={{fontSize:9}}>🎯</span>
                            <span style={{fontSize:11,fontWeight:700,fontFamily:"'Cinzel',serif",color:masteryColor(totalMasteryPct)}}>{totalMasteryPct}%</span>
                          </div>

                          {/* Info toggle (page/hizb/juz/mots/parties/inconnus pills) */}
                          <button onClick={() => setShowSurahInfo(v => !v)}
                            style={pillBtnStyle(showSurahInfo, 'rgba(255,255,255,.25)')}>
                            ℹ {infoLabel} {showSurahInfo ? '▲' : '▼'}
                          </button>

                          {/* Learned toggle */}
                          {ayats.length > 0 && (
                            <button onClick={isSurahFullyLearned ? unmarkAllLearned : markAllLearned}
                              title={isSurahFullyLearned ? "Sourate apprise — cliquer pour désactiver" : "Marquer toute la sourate comme apprise"}
                              style={pillBtnStyle(isSurahFullyLearned, 'var(--green)')}>
                              {isSurahFullyLearned
                                ? <span style={{color:'var(--green)'}}>✓ APPRISE</span>
                                : 'MARQUER APPRISE'}
                            </button>
                          )}

                          {/* Go-to-ayat toggle */}
                          {ayats.length > 0 && (
                            <button onClick={() => setShowAyatJump(v => !v)}
                              style={pillBtnStyle(showAyatJump, '#c878ff')}>
                              🔎 ALLER {showAyatJump ? '▲' : '▼'}
                            </button>
                          )}
                        </div>

                        {showSurahInfo && (
                          <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'center',marginTop:8}}>
                            {pills.map(({ label: l, val, color }) => (
                              <div key={l} style={{
                                display:'flex',flexDirection:'column',alignItems:'center',
                                background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',
                                borderRadius:7,padding:'5px 12px',minWidth:52,
                              }}>
                                <div style={{fontSize:14,fontWeight:700,color,fontFamily:"'Cinzel',serif",lineHeight:1}}>{val}</div>
                                <div style={{fontSize:7,letterSpacing:1.5,color:'var(--text3)',marginTop:3}}>{l}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {showAyatJump && (
                          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginTop:8}}>
                            <input type="number" min={1} max={selectedSurah.numberOfAyahs}
                              autoFocus
                              value={ayatSearchInput}
                              onChange={e => setAyatSearchInput(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') { jumpToAyatNumber(ayatSearchInput); setAyatSearchInput(''); setShowAyatJump(false); } }}
                              placeholder="N°"
                              style={{width:56,textAlign:'center',background:'var(--surface3)',
                                border:'1px solid var(--border2)',borderRadius:6,padding:'4px 6px',
                                color:'var(--text)',fontSize:12,fontFamily:"'Cinzel',serif",outline:'none'}} />
                            <button onClick={() => { jumpToAyatNumber(ayatSearchInput); setAyatSearchInput(''); setShowAyatJump(false); }}
                              style={{fontSize:8,letterSpacing:1,padding:'5px 10px',fontFamily:"'Cinzel',serif",
                                background:'rgba(200,120,255,.08)',border:'1px solid #c878ff',color:'#c878ff',
                                borderRadius:6,cursor:'pointer'}}>
                              🔎 ALLER
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                  );
                })()}

                {(() => {
                  const anyTj = showQalqala||showMadd||showIzhar||showIdgham;
                  const anyOpt = announceNum||spellCheck||showParts||pageMode;
                  return (
                <div className="ts-global-bar">
                  <button onClick={() => setShowTsBar(!showTsBar)}
                    style={{ display:"flex", alignItems:"center", gap:6, background:"transparent", border:"1px solid var(--border2)", borderRadius:"var(--radius-sm)", padding:"3px 10px", cursor:"pointer", flexShrink:0 }}>
                    <span className="ts-global-label">⚡ TS</span>
                    <span className="ts-global-count">{loadedCount}/{ayats.length}</span>
                    <span style={{ fontSize:8, color:"var(--text3)", marginLeft:2 }}>{showTsBar ? "▲" : "▼"}</span>
                  </button>
                  <div className="panel-row">
                  <button onClick={() => setShowTajweedPanel(v => !v)}
                    style={{ display:"flex", alignItems:"center", gap:5,
                      background: showTajweedPanel ? "rgba(255,255,255,.06)" : anyTj ? "rgba(91,200,245,.08)" : "transparent",
                      border: "1px solid " + (anyTj ? "#5bc8f5" : showTajweedPanel ? "rgba(255,255,255,.15)" : "var(--border2)"),
                      borderRadius:"var(--radius-sm)", padding:"3px 10px", cursor:"pointer", flexShrink:0,
                      color: anyTj ? "#5bc8f5" : "var(--text3)",
                      fontSize:9, letterSpacing:"1px", fontFamily:"Cinzel,serif", transition:"all .2s" }}>
                    تجويد <span style={{fontSize:7,marginLeft:2}}>{showTajweedPanel ? "▲" : "▼"}</span>
                  </button>
                  {showTajweedPanel && (
                    <div className="panel-expand" style={{ left:0, right:0, minWidth:0 }}>
                    <div className="tajweed-panel" style={{ flexWrap:'wrap', gap:6, padding:'8px 12px' }}>
                      {[
                        { toggle: toggleQalqala, on: showQalqala, label: "قلقلة", color: "#5bc8f5", bg: "rgba(91,200,245,.1)" },
                        { toggle: toggleMadd,    on: showMadd,    label: "مَدّ",   color: "#f09de0", bg: "rgba(240,157,224,.1)" },
                        { toggle: toggleIzhar,   on: showIzhar,   label: "إظهار", color: "#4caf81", bg: "rgba(76,175,129,.1)" },
                        { toggle: toggleIdgham,  on: showIdgham,  label: "إدغام", color: "#ffd166", bg: "rgba(255,209,102,.1)" },
                      ].map(({toggle,on,label,color,bg}) => (
                        <button key={label} onClick={toggle}
                          style={{ display:"flex", alignItems:"center", background: on ? bg : "transparent",
                            border: "1px solid " + (on ? color : "rgba(255,255,255,.1)"),
                            borderRadius:"var(--radius-sm)", padding:"3px 9px", cursor:"pointer", flexShrink:0,
                            color: on ? color : "var(--text3)", fontSize:10, fontFamily:"Cinzel,serif", transition:"all .2s" }}>
                          {label}
                        </button>
                      ))}
                    </div></div>
                  )}
                  </div>
                  <div className="panel-row">
                  <button onClick={() => setShowOptionsPanel(v => !v)}
                    style={{ display:"flex", alignItems:"center", gap:5,
                      background: showOptionsPanel ? "rgba(255,255,255,.06)" : anyOpt ? "rgba(201,168,76,.08)" : "transparent",
                      border: "1px solid " + (anyOpt ? "var(--gold)" : showOptionsPanel ? "rgba(255,255,255,.15)" : "var(--border2)"),
                      borderRadius:"var(--radius-sm)", padding:"3px 10px", cursor:"pointer", flexShrink:0,
                      color: anyOpt ? "var(--gold2)" : "var(--text3)",
                      fontSize:9, letterSpacing:"1px", fontFamily:"Cinzel,serif", transition:"all .2s" }}>
                    OPTIONS <span style={{fontSize:7,marginLeft:2}}>{showOptionsPanel ? "▲" : "▼"}</span>
                  </button>
                  {showOptionsPanel && (
                    <div className="panel-expand" style={{ left:0, right:0, minWidth:0 }}>
                    <div className="tajweed-panel" style={{ flexWrap:'wrap', gap:6, padding:'8px 12px' }}>
                      {[
                        { toggle: toggleAnnounceNum, on: announceNum, label: "🔢 N°",      color: "var(--teal2)",  bg: "rgba(62,184,160,.12)" },
                        { toggle: toggleSpellCheck,  on: spellCheck,  label: "✔ ORTHO",   color: "var(--gold2)",  bg: "rgba(201,168,76,.1)" },
                        { toggle: toggleShowParts,   on: showParts,   label: "✂ PARTIES", color: "var(--gold2)",  bg: "rgba(201,168,76,.1)" },
                        { toggle: () => { setPageMode(v=>!v); setactivePageCoran(null); }, on: pageMode, label: "📖 PAGE", color: "#c878ff", bg: "rgba(200,120,255,.12)" },
                        ...(pageMode ? [{ toggle: () => setAutoPageFollow(v=>!v), on: autoPageFollow, label: "⇄ SUIVI", color: "#c878ff", bg: "rgba(200,120,255,.12)" }] : []),
                      ].map(({toggle,on,label,color,bg}) => (
                        <button key={label} onClick={toggle}
                          style={{ display:"flex", alignItems:"center", background: on ? bg : "transparent",
                            border: "1px solid " + (on ? color : "rgba(255,255,255,.1)"),
                            borderRadius:"var(--radius-sm)", padding:"3px 9px", cursor:"pointer", flexShrink:0,
                            color: on ? color : "var(--text3)", fontSize:9, fontFamily:"Cinzel,serif", transition:"all .2s" }}>
                          {label}
                        </button>
                      ))}
                      <button onClick={()=>navigate('/quran/book')}
                        style={{display:"flex",alignItems:"center",background:"rgba(201,168,76,.07)",
                          border:"1px solid rgba(201,168,76,.28)",borderRadius:"var(--radius-sm)",
                          padding:"3px 9px",cursor:"pointer",flexShrink:0,
                          color:"var(--gold2)",fontSize:9,fontFamily:"Cinzel,serif"}}>📖 CSS</button>
                      <button onClick={()=>navigate('/quran/book3d')}
                        style={{display:"flex",alignItems:"center",background:"rgba(201,168,76,.13)",
                          border:"1px solid rgba(201,168,76,.45)",borderRadius:"var(--radius-sm)",
                          padding:"3px 9px",cursor:"pointer",flexShrink:0,
                          color:"var(--gold)",fontSize:9,fontFamily:"Cinzel,serif"}}>✨ 3D</button>
                    </div>
                    </div>
                  )}
                  </div>
                  {/* LANGUES button */}
                  <div style={{ position:"relative", flexShrink:0 }}>
                  <button onClick={() => setShowLangPanel(v => !v)}
                    style={{ display:"flex", alignItems:"center", gap:5,
                      background: showLangPanel ? "rgba(255,255,255,.06)" : translationLang ? "rgba(91,200,245,.08)" : "transparent",
                      border: "1px solid " + (translationLang ? "#5bc8f5" : showLangPanel ? "rgba(255,255,255,.15)" : "var(--border2)"),
                      borderRadius:"var(--radius-sm)", padding:"3px 10px", cursor:"pointer", flexShrink:0,
                      color: translationLang ? "#5bc8f5" : "var(--text3)",
                      fontSize:9, letterSpacing:"1px", fontFamily:"Cinzel,serif", transition:"all .2s" }}>
                    🌐 LANGUE <span style={{fontSize:7,marginLeft:2}}>{showLangPanel ? "▲" : "▼"}</span>
                  </button>
                  {showLangPanel && (
                    <div className="panel-expand" style={{ left:0, right:0, minWidth:0 }}>
                    <div className="tajweed-panel" style={{ flexWrap:'wrap', gap:6, padding:'8px 12px' }}>
                      {Object.entries(TRANS_LABELS).map(([lang, label]) => (
                        <button key={lang} onClick={() => setTranslationLang(t => t === lang ? null : lang)}
                          style={{ display:"flex", alignItems:"center", flexShrink:0,
                            background: translationLang === lang ? 'rgba(91,200,245,.12)' : 'transparent',
                            border:`1px solid ${translationLang === lang ? '#5bc8f5' : 'rgba(255,255,255,.08)'}`,
                            borderRadius:5, padding:'5px 12px', cursor:'pointer',
                            color: translationLang === lang ? '#5bc8f5' : 'var(--text3)',
                            fontSize:10, fontFamily:"Cinzel,serif", transition:'all .15s',
                            boxShadow: translationLang === lang ? '0 0 6px rgba(91,200,245,.2)' : 'none' }}>
                          {label}
                        </button>
                      ))}
                      {translationLang && (
                        <button onClick={() => setTranslationLang(null)}
                          style={{ fontSize:9, padding:'5px 10px', borderRadius:5, cursor:'pointer',
                            background:'rgba(229,115,115,.1)', border:'1px solid rgba(229,115,115,.3)',
                            color:'var(--red)', fontFamily:"Cinzel,serif" }}>✕ OFF</button>
                      )}
                    </div>
                    </div>
                  )}
                  </div>
                  {showTsBar && (
                    <>
                      <span style={{ fontSize:8, letterSpacing:1, color:'var(--text3)', fontFamily:"'Cinzel',serif", marginRight:4 }}>
                        {RECITATORS.find(r => r.id === recitatorId)?.flag} {RECITATORS.find(r => r.id === recitatorId)?.label?.toUpperCase()}
                      </span>
                      <div className="ts-progress-bar">
                        <div className="ts-progress-fill" style={{ width: `${ayats.length ? (loadedCount / ayats.length) * 100 : 0}%` }} />
                      </div>
                      <label className="ts-drop-zone">
                        <input type="file" accept=".json" multiple onChange={e => handleTimestampsFiles([...e.target.files])} />
                        <span className="ts-drop-label">📂 CHARGER JSON(S)</span>
                      </label>
                      {loadedCount > 0 && (
                        <button className="btn-small" style={{ color: "var(--red)", borderColor: "var(--red)" }}
                          title={`Effacer les timestamps de ${RECITATORS.find(r => r.id === recitatorId)?.label || recitatorId}`}
                          onClick={() => {
                            // Only clear this reciter's entries — other reciters keep theirs
                            const kept = {};
                            for (const [k, v] of Object.entries(timestampsMap)) {
                              if (!k.startsWith(`${recitatorId}:`)) kept[k] = v;
                            }
                            setTimestampsMap(kept);
                          }}>✕</button>
                      )}
                    </>
                  )}
                </div>); })()} 

                {/* ── Page mode navigator bar ── */}
                {pageMode && ayats && ayats.length > 0 && (() => {
                  const pages = [...new Set(ayats.map(a => a.page).filter(Boolean))].sort((a,b)=>a-b);
                  const curPage = activePageCoran ?? ayats[mainAyatIdx]?.page ?? pages[0];
                  const idx = pages.indexOf(curPage);
                  return (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                      padding:'6px 14px', background:'var(--surface2)', borderBottom:'1px solid var(--border)',
                      position:'sticky', top:0, zIndex:10, gap:8 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <button onClick={() => setactivePageCoran(pages[0])} disabled={idx<=0}
                          title="Première page de la sourate"
                          style={{ fontSize:11, padding:'3px 7px', fontFamily:"'Cinzel',serif",
                            background:'transparent', border:'1px solid var(--border2)',
                            color: idx>0 ? 'var(--text2)' : 'var(--text3)', borderRadius:6,
                            cursor: idx>0 ? 'pointer' : 'default', lineHeight:1 }}>⏮</button>
                        <button onClick={() => setactivePageCoran(pages[idx-1])} disabled={idx<=0}
                          style={{ fontSize:8, letterSpacing:1, padding:'3px 10px', fontFamily:"'Cinzel',serif",
                            background:'transparent', border:'1px solid var(--border2)',
                            color: idx>0 ? 'var(--text2)' : 'var(--text3)', borderRadius:6,
                            cursor: idx>0 ? 'pointer' : 'default' }}>← {idx>0 ? pages[idx-1] : ''}</button>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:7, letterSpacing:2, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>PAGE</span>
                        <input type="number" value={curPage}
                          onChange={e => { const v=parseInt(e.target.value); if(pages.includes(v)) setactivePageCoran(v); }}
                          style={{ width:48, textAlign:'center', background:'var(--surface3)',
                            border:'1px solid #c878ff', borderRadius:6, padding:'3px 6px',
                            color:'#c878ff', fontSize:13, fontFamily:"'Cinzel',serif", outline:'none' }} />
                        <span style={{ fontSize:7, color:'var(--text3)' }}>/ {pages[pages.length-1]}</span>
                        {/* Page loop button */}
                        {(() => {
                          const pageAyats = ayats.filter(a => a.page === curPage);
                          const firstIdx  = pageAyats.length ? ayats.indexOf(pageAyats[0]) : -1;
                          const lastIdx   = pageAyats.length ? ayats.indexOf(pageAyats[pageAyats.length-1]) : -1;
                          const isPageLoop = loopActive && loopStart === firstIdx && loopEnd === lastIdx;
                          const togglePageLoop = () => {
                            if (isPageLoop) {
                              setLoopActive(false);
                            } else {
                              if (firstIdx < 0) return;
                              setLoopStart(firstIdx); setLoopEnd(lastIdx);
                              setLoopStartInput(pageAyats[0].numberInSurah);
                              setLoopEndInput(pageAyats[pageAyats.length-1].numberInSurah);
                              setLoopActive(true); setLoopCount(0);
                              playMainAyat(firstIdx);
                              setTimeout(() => mainAudioRef.current?.play(), 80);
                            }
                          };
                          return (
                            <button onClick={togglePageLoop} title={isPageLoop ? 'Arrêter boucle page' : 'Lire page en boucle'}
                              style={{ fontSize:12, padding:'2px 7px', borderRadius:6, cursor:'pointer', lineHeight:1,
                                background: isPageLoop ? 'rgba(200,120,255,.2)' : 'transparent',
                                border: `1px solid ${isPageLoop ? '#c878ff' : 'rgba(255,255,255,.15)'}`,
                                color: isPageLoop ? '#c878ff' : 'var(--text3)', transition:'all .2s' }}>
                              {isPageLoop ? '⏹' : '🔁'}
                            </button>
                          );
                        })()}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <button onClick={() => setactivePageCoran(pages[idx+1])} disabled={idx>=pages.length-1}
                          style={{ fontSize:8, letterSpacing:1, padding:'3px 10px', fontFamily:"'Cinzel',serif",
                            background:'transparent', border:'1px solid var(--border2)',
                            color: idx<pages.length-1 ? 'var(--text2)' : 'var(--text3)', borderRadius:6,
                            cursor: idx<pages.length-1 ? 'pointer' : 'default' }}>
                          {idx<pages.length-1 ? pages[idx+1] : ''} →</button>
                        <button onClick={() => setactivePageCoran(pages[pages.length-1])} disabled={idx>=pages.length-1}
                          title="Dernière page de la sourate"
                          style={{ fontSize:11, padding:'3px 7px', fontFamily:"'Cinzel',serif",
                            background:'transparent', border:'1px solid var(--border2)',
                            color: idx<pages.length-1 ? 'var(--text2)' : 'var(--text3)', borderRadius:6,
                            cursor: idx<pages.length-1 ? 'pointer' : 'default', lineHeight:1 }}>⏭</button>
                      </div>
                    </div>
                  );
                })()}

                <div className="ayat-scroll" onContextMenu={handleAyatContextMenu}>
                  <audio ref={partAudioRef} style={{ display: "none" }} onEnded={() => { setTimeout(() => { setPlayingPart(null); setPartCurrentMs(0); stopPartRaf(); }, 250); }} />
                  {loadingAyats
                    ? <div className="loading"><div className="loading-ring" /><span>CHARGEMENT</span></div>
                    : <>{tsVersion > -1 && (playStateVer >= 0) && (loopStateVer >= 0) && (() => {
                      const curPage = pageMode ? (activePageCoran ?? ayats[mainAyatIdx]?.page) : null;
                      const visible = curPage ? ayats.filter(a => a.page === curPage) : ayats.slice(0, renderLimit);
                      return visible.map(ayat => {
                      const ld        = getLData(selectedSurah.number, ayat.numberInSurah);
                      const isOpen    = openAyatNum === ayat.numberInSurah;
                      const isPlaying = playingAyatNum === ayat.numberInSurah && isMainPlaying;
                      const isCurrent = ayats[mainAyatIdx]?.numberInSurah === ayat.numberInSurah && !isPlaying;
                      const ts        = timestampsMap[tskey(selectedSurah.number, ayat.numberInSurah)];
                      const inLoop    = loopActive && ayat.numberInSurah >= loopStartNum && ayat.numberInSurah <= loopEndNum;
                      const isSelecting = partSelectAyat === ayat.numberInSurah;
                      const globalIdx = ayats.indexOf(ayat);
                      const prevAyat  = globalIdx > 0 ? ayats[globalIdx - 1] : null;
                      const nextAyat  = globalIdx >= 0 && globalIdx < ayats.length - 1 ? ayats[globalIdx + 1] : null;
                      const isPageStart = ayat.page != null && (!prevAyat || prevAyat.page !== ayat.page);
                      const isPageEnd   = ayat.page != null && (!nextAyat || nextAyat.page !== ayat.page);

                      const playPartInline = (part, loop = false) => {
                        if (!ts?.words || !part.wordIndices?.length) return;
                        const url = audioUrl(ayat);
                        if (!url) return;
                        const firstTs = ts.words[part.wordIndices[0]];
                        const lastTs  = ts.words[part.wordIndices[part.wordIndices.length - 1]];
                        if (!firstTs || !lastTs) return;
                        const startMs = firstTs.chars?.[0]?.start;
                        const endMs   = lastTs.chars?.[lastTs.chars.length - 1]?.end;
                        if (startMs == null || endMs == null) return;
                        const audio = partAudioRef.current;
                        if (!audio) return;
                        // Toggle stop if same part playing
                        if (playingPart?.ayatNum === ayat.numberInSurah && playingPart?.partId === part.id) {
                          audio.pause(); setPlayingPart(null); setPartCurrentMs(0); stopPartRaf(); return;
                        }
                        audio.src = url;
                        audio.currentTime = startMs / 1000;
                        audio.play().catch(() => {});
                        setPlayingPart({ ayatNum: ayat.numberInSurah, partId: part.id, loop });
                        startPartRaf();
                        const endSec = endMs / 1000;
                        const startSec = startMs / 1000;
                        const check = () => {
                          if (audio.currentTime >= endSec) {
                            if (loop && playingPart?.loop !== false) {
                              audio.currentTime = startSec;
                              audio.play().catch(() => {});
                            } else {
                              audio.pause();
                              setTimeout(() => { stopPartRaf(); setPlayingPart(null); setPartCurrentMs(0); audio.removeEventListener('timeupdate', check); }, 250);
                              audio.removeEventListener('timeupdate', check);
                            }
                          }
                        };
                        audio.addEventListener('timeupdate', check);
                      };

                      // Word→partIndex map for coloring
                      const PART_COLORS  = ["rgba(201,168,76,.22)","rgba(62,184,160,.18)","rgba(111,207,154,.18)","rgba(224,90,90,.15)","rgba(200,120,255,.15)"];
                      const PART_BORDERS = ["var(--gold)","var(--teal)","var(--green)","var(--red)","#c878ff"];
                      const wordPartMap  = {};
                      (ld.parts || []).forEach((p, pi) => p.wordIndices?.forEach(wi => { wordPartMap[wi] = pi; }));
                      const wordsInParts = new Set(Object.keys(wordPartMap).map(Number));
                      const nextAvail    = wordsInParts.size > 0 ? Math.max(...wordsInParts) + 1 : 0;
                      const ayatWords    = ayat.text ? ayat.text.split(" ").filter(Boolean) : [];

                      // Handle word click during inline selection
                      const handleInlineWordClick = (e, wi) => {
                        e.stopPropagation();
                        // Aide mémoire click modes
                        const aideMemoireClickMode = aideMemoireClickModes[ayat.numberInSurah]||null;
                        if (aideMemoireClickMode === 'highlight') {
                          e.stopPropagation();
                          const word = ayatWords[wi];
                          const prev = ld?.highlight?.trim() ? ld.highlight.trim().split(/\s+/) : [];
                          const normWord = normalizeAr(word);
                          const exists = prev.some(w => normalizeAr(w) === normWord);
                          const next = exists ? prev.filter(w => normalizeAr(w) !== normWord) : [...prev, word];
                          setLData(selectedSurah.number, ayat.numberInSurah, d => ({ ...d, highlight: next.join(' ') }));
                          return;
                        }
                        if (aideMemoireClickMode === 'unknown') {
                          e.stopPropagation();
                          const ayatWordsList = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
                          const rootClicked   = arabicRoot(ayatWordsList[wi] || '');
                          const prev = ld?.unknownWords || [];
                          const isRemoving = prev.includes(wi);
                          // add/remove ALL indices with the same root
                          const sameForm = ayatWordsList.reduce((acc, w, i) => { if (arabicRoot(w) === rootClicked) acc.push(i); return acc; }, []);
                          const next = isRemoving
                            ? prev.filter(x => !sameForm.includes(x))
                            : [...new Set([...prev, ...sameForm])];
                          setLData(selectedSurah.number, ayat.numberInSurah, d => ({ ...d, unknownWords: next }));
                          return;
                        }
                        if (!isSelecting) return;
                        if (partSelectStep === 'start') {
                          if (wi < nextAvail) return;
                          setPartSelectStart(wi);
                          setPartSelectStep('end');
                        } else if (partSelectStep === 'end') {
                          if (partSelectStart === null) return;
                          const from = Math.min(partSelectStart, wi);
                          const to   = Math.max(partSelectStart, wi);
                          const clampedFrom = Math.max(from, nextAvail);
                          const indices = []; for (let i = clampedFrom; i <= to; i++) indices.push(i);
                          if (indices.length === 0) return;
                          setLData(selectedSurah.number, ayat.numberInSurah, d => ({
                            ...d, parts: [...(d.parts || []), { id: Date.now(), wordIndices: indices, text: indices.map(i => ayatWords[i]).join(" "), learned: !!d.learned }]
                          }));
                          const newNext = to + 1;
                          if (newNext < ayatWords.length) {
                            setPartSelectStart(null);
                            setPartSelectStep('start');
                          } else {
                            setPartSelectAyat(null); setPartSelectStep(null); setPartSelectStart(null);
                          }
                        }
                      };

                      // Render the Arabic text — either TS-highlighted, inline-selectable, or plain
                      // _tsForAyat: basmala already stripped at parse time — pass ts directly
                      const renderAyatText = () => {
                        if (isPlaying && ts && enableLetterByLetter) return <PlayingArabicHighlighted text={ayat.text} timestamps={ts} mode="main" showQalqala={showQalqala} showMadd={showMadd} showIzhar={showIzhar} showIdgham={showIdgham} />;
                        if (playingPart?.ayatNum === ayat.numberInSurah && ts && enableLetterByLetter)
                          return <PlayingArabicHighlighted text={ayat.text} timestamps={ts} mode="part" playingPart={playingPart} ld={ld} showQalqala={showQalqala} showMadd={showMadd} showIzhar={showIzhar} showIdgham={showIdgham} />;
                        if (localPlaying?.ayatNum === ayat.numberInSurah && ts && enableLetterByLetter)
                          return <PlayingArabicHighlighted text={ayat.text} timestamps={ts} mode="local" showQalqala={showQalqala} showMadd={showMadd} showIzhar={showIzhar} showIdgham={showIdgham} />;

                        // Revise highlighting — declared early to avoid TDZ with showPartColors
                        const _reviseData = ld?.toRevise;
                        const revWordSet  = _reviseData && typeof _reviseData === 'object' ? new Set(_reviseData.words || []) : (_reviseData === true ? 'all' : null);
                        const revChars    = _reviseData && typeof _reviseData === 'object' ? (_reviseData.chars || {}) : {};

                        const aideMemoireClickMode = aideMemoireClickModes[ayat.numberInSurah]||null;
                        const showWordButtons = isSelecting || aideMemoireClickMode !== null;
                        const showPartColors  = !isSelecting && showParts && Object.keys(wordPartMap).length > 0;

                        // When timestamps loaded and not in word-select/aide-memoire mode: use ArabicHighlighted for tajweed coloring
                        if (ts && enableTimestamps && !showWordButtons && !showPartColors) {
                          return <ArabicHighlighted text={ayat.text} timestamps={ts} currentMs={-1} showQalqala={showQalqala} showMadd={showMadd} showIzhar={showIzhar} showIdgham={showIdgham} />;
                        }

                        if (showWordButtons) {
                          return (
                            <div className="ayat-arabic" style={{ cursor: aideMemoireClickMode ? "pointer" : "default" }}>
                              {ayatWords.map((w, wi) => {
                                // Aide mémoire display
                                const aideMemoireClickMode = aideMemoireClickModes[ayat.numberInSurah]||null;
                        if (aideMemoireClickMode === 'highlight') {
                                  const normW = normalizeAr(w);
                                  const isHl = ld?.highlight?.trim()?.split(/\s+/).some(hw => normalizeAr(hw) === normW);
                                  return (
                                    <span key={wi} onClick={e => handleInlineWordClick(e, wi)} style={{
                                      display:'inline-block', cursor:'pointer', padding:'1px 4px', margin:'1px',
                                      borderRadius:5, transition:'all .15s', userSelect:'none',
                                      background: isHl ? 'rgba(255,209,102,.2)' : 'transparent',
                                      border: `1px solid ${isHl ? 'var(--gold)' : 'transparent'}`,
                                      color: isHl ? '#ffd166' : undefined,
                                      textShadow: isHl ? '0 0 8px rgba(255,209,102,.5)' : 'none',
                                    }}>{w}{wi < ayatWords.length-1 ? ' ' : ''}</span>
                                  );
                                }
                                if (aideMemoireClickMode === 'unknown') {
                                  const isUnk = (ld?.unknownWords||[]).includes(wi);
                                  return (
                                    <span key={wi} onClick={e => handleInlineWordClick(e, wi)} style={{
                                      display:'inline-block', cursor:'pointer', padding:'1px 4px', margin:'1px',
                                      borderRadius:5, transition:'all .15s', userSelect:'none',
                                      background: isUnk ? 'rgba(255,126,179,.18)' : 'transparent',
                                      border: `1px solid ${isUnk ? '#ff7eb3' : 'transparent'}`,
                                      color: isUnk ? '#ff7eb3' : undefined,
                                      textDecoration: isUnk ? 'underline dotted #ff7eb3' : 'none',
                                    }}>{w}{wi < ayatWords.length-1 ? ' ' : ''}</span>
                                  );
                                }
                                const inExistingPart = wordsInParts.has(wi);
                                const pi             = wordPartMap[wi];
                                const isLearned      = pi !== undefined && (ld.parts || [])[pi]?.learned;
                                const isPast         = wi < nextAvail;
                                const isStart        = partSelectStep === 'end' && wi === partSelectStart;
                                const isInPreview    = partSelectStep === 'end' && partSelectStart !== null && wi >= Math.min(partSelectStart, wi) && wi >= nextAvail && wi <= Math.max(partSelectStart, wi);
                                // preview: between startIdx and current (we can't hover in React without extra state,
                                // so we just highlight the chosen start word)
                                let bg = "transparent", border = "var(--border)", color = "var(--text2)", cursor = "pointer";
                                if (isPast || inExistingPart) {
                                  bg = isLearned ? "rgba(76,175,129,.15)" : PART_COLORS[pi % PART_COLORS.length] ?? "rgba(62,184,160,.1)";
                                  border = isLearned ? "var(--green)" : PART_BORDERS[pi % PART_BORDERS.length] ?? "var(--teal)";
                                  color  = "var(--text2)"; cursor = "default";
                                } else if (isStart) {
                                  bg = "rgba(201,168,76,.25)"; border = "var(--gold2)"; color = "var(--gold2)";
                                } else if (partSelectStep === 'start') {
                                  bg = "rgba(201,168,76,.04)"; border = "rgba(201,168,76,.5)"; color = "var(--gold)";
                                } else if (partSelectStep === 'end') {
                                  bg = "rgba(62,184,160,.05)"; border = "rgba(62,184,160,.5)"; color = "var(--teal2)";
                                }
                                return (
                                  <span key={wi} onClick={e => handleInlineWordClick(e, wi)} style={{
                                    display: "inline-block", margin: "2px 3px", padding: "2px 5px",
                                    borderRadius: 5, border: `1px solid ${border}`,
                                    background: bg, color, cursor,
                                    transition: "all .12s",
                                    fontFamily: "'Amiri Quran',serif",
                                  }}>{w}</span>
                                );
                              })}
                            </div>
                          );
                        }

                        if (showPartColors) {
                          // pre-compute annotation indices
                          const _hlSet  = (() => { const s=new Set(); if (!ld.highlight?.trim()) return s; ld.highlight.trim().split(/\s+/).forEach(hw => { const n=normalizeAr(hw); ayatWords.forEach((aw,i)=>{ if(normalizeAr(aw)===n) s.add(i); }); }); return s; })();
                          const _unkSet = new Set(ld?.unknownWords||[]);
                          // Group consecutive words by part (segment) — one unified bubble per part
                          const segments2 = [];
                          let seg2 = null;
                          ayatWords.forEach((w, wi) => {
                            const pi = wordPartMap[wi];
                            if (seg2 && seg2.pi === pi) { seg2.words.push({ w, wi }); }
                            else { seg2 = { pi, words: [{ w, wi }] }; segments2.push(seg2); }
                          });
                          return (
                            <div className="ayat-arabic">
                              {segments2.map((seg, si) => {
                                const pi        = seg.pi;
                                const hasPart   = pi !== undefined;
                                const part      = hasPart ? (ld.parts||[])[pi] : null;
                                const isLearned = part?.learned;
                                const isPlaying = hasPart && playingPart?.ayatNum===ayat.numberInSurah && playingPart?.partId===part?.id;
                                const canPlay   = hasPart && !!ts?.words;
                                const segBg     = hasPart ? (isPlaying ? "rgba(62,184,160,.28)" : isLearned ? "rgba(76,175,129,.18)" : PART_COLORS[pi%PART_COLORS.length]) : "transparent";
                                const segBorder = hasPart ? `1px solid ${isPlaying ? "var(--teal2)" : isLearned ? "var(--green)" : PART_BORDERS[pi%PART_BORDERS.length]}` : "none";
                                return (
                                  <span key={si}
                                    onClick={e=>{ e.stopPropagation(); if(canPlay) playPartInline(part,false); }}
                                    title={canPlay ? (isPlaying?"Stopper":"Lire cette partie") : undefined}
                                    style={{
                                      display:"inline-block",
                                      background:segBg, border:segBorder,
                                      borderRadius:6, padding:"1px 7px", margin:"2px 2px",
                                      cursor:canPlay?"pointer":"default",
                                      transition:"all .15s",
                                    }}>
                                    {seg.words.map(({w,wi},wii) => {
                                      const isUnk = _unkSet.has(wi);
                                      const isHl  = _hlSet.has(wi);
                                      const isRevW = revWordSet === 'all' || (revWordSet && revWordSet.has(wi));
                                      const wRevChars = isRevW ? revChars[wi] : null;
                                      const wColor  = isUnk?"#ff7eb3":isHl?"#ffd166":isRevW?"var(--gold2)":undefined;
                                      const wShadow = isUnk?"0 0 8px rgba(255,126,179,.5)":isHl?"0 0 8px rgba(255,209,102,.6)":isRevW?"0 0 6px rgba(201,168,76,.4)":"none";
                                      const wDecor  = isUnk?"underline dotted #ff7eb3":isRevW&&!wRevChars?.length?"underline wavy var(--gold)":"none";
                                      const wBg     = isUnk?"rgba(255,126,179,.15)":isHl?"rgba(255,209,102,.12)":isRevW&&!wRevChars?.length?"rgba(201,168,76,.2)":"transparent";
                                      const renderCh = (ch,ci,arr2) => {
                                        if(isUnk||isHl) return <span key={ci}>{ch}</span>;
                                        const q  = showQalqala && isQalqala(arr2,ci);
                                        const mt = showMadd ? getMaddType(arr2,ci) : null;
                                        const iz = showIzhar && isIzhar(arr2,ci);
                                        const id = showIdgham && isIdgham(arr2,ci);
                                        return q               ? <span key={ci} style={{color:"#5bc8f5",textShadow:"0 0 6px rgba(91,200,245,.5)"}}>{ch}</span>
                                             : mt==="muttasil" ? <span key={ci} style={{color:"#ff7eb3",textShadow:"0 0 8px rgba(255,126,179,.6)",fontWeight:600}}>{ch}</span>
                                             : mt==="normal"   ? <span key={ci} style={{color:"#f09de0",textShadow:"0 0 6px rgba(240,157,224,.5)"}}>{ch}</span>
                                             : iz              ? <span key={ci} style={{color:"#4caf81",textShadow:"0 0 6px rgba(76,175,129,.5)"}}>{ch}</span>
                                             : id              ? <span key={ci} style={{color:"#ffd166",textShadow:"0 0 6px rgba(255,209,102,.5)"}}>{ch}</span>
                                             : <span key={ci}>{ch}</span>;
                                      };
                                      return (
                                        <span key={wii} style={{
                                          color:wColor, textShadow:wShadow,
                                          textDecoration:wDecor,
                                          background: wBg,
                                          borderRadius: (isUnk||isHl||isRevW)?3:0,
                                          padding: (isUnk||isHl||isRevW)?"0 1px":0,
                                          borderBottom: isRevW&&!wRevChars?.length ? '2px solid rgba(201,168,76,.5)' : 'none',
                                        }}>
                                          {(showQalqala||showMadd||showIzhar||showIdgham)
                                            ? (() => { const arr2=[...w]; return arr2.map((ch,ci)=>renderCh(ch,ci,arr2)); })()
                                            : w}
                                          {wii < seg.words.length-1 ? " " : ""}
                                        </span>
                                      );
                                    })}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        }

                        // Build highlight index set from ld.highlight
                        const hlIndices  = (() => {
                          const set = new Set();
                          if (!ld.highlight?.trim()) return set;
                          ld.highlight.trim().split(/\s+/).forEach(hw => {
                            const norm = normalizeAr(hw);
                            ayatWords.forEach((aw, i) => { if (normalizeAr(aw) === norm) set.add(i); });
                          });
                          return set;
                        })();
                        const unkIndices = new Set(ld?.unknownWords || []);
                        const hasRevise  = !!_reviseData;
                        const hasAnnotations = (ld.highlight?.trim() && hlIndices.size > 0) || unkIndices.size > 0 || hasRevise;

                        if (hasAnnotations) {
                          return (
                            <div className="ayat-arabic">
                              {ayatWords.map((w, wi) => {
                                const hit = hlIndices.has(wi);
                                const unk = unkIndices.has(wi);
                                const isRevWord = revWordSet === 'all' || (revWordSet && revWordSet.has(wi));
                                const wordChars = isRevWord ? revChars[wi] : null; // selected char indices
                                const clusters  = isRevWord ? splitArabicClusters(w) : null;

                                const baseStyle = {
                                  color: unk ? '#ff7eb3' : hit ? '#ffd166' : isRevWord ? 'var(--text1)' : undefined,
                                  textShadow: unk ? '0 0 8px rgba(255,126,179,.5)' : hit ? '0 0 8px rgba(255,209,102,.6)' : 'none',
                                  background: unk ? 'rgba(255,126,179,.12)' : hit ? 'rgba(255,209,102,.13)' : isRevWord && !wordChars?.length ? 'rgba(201,168,76,.12)' : 'transparent',
                                  textDecoration: unk ? 'underline dotted #ff7eb3' : isRevWord && !wordChars?.length ? 'underline wavy var(--gold)' : 'none',
                                  borderRadius: (hit||unk||isRevWord) ? 4 : 0,
                                  padding: (hit||unk||isRevWord) ? '0 2px' : 0,
                                  border: isRevWord && !wordChars?.length ? '1px solid rgba(201,168,76,.35)' : 'none',
                                  display: 'inline',
                                };

                                if (isRevWord && wordChars?.length && clusters) {
                                  // Highlight whole word (Arabic shaping can't split mid-ligature)
                                  // show char selection as badge count
                                  return (
                                    <span key={wi} style={{
                                      display:'inline', padding:'0 2px',
                                      background:'rgba(91,200,245,.15)',
                                      borderBottom:'2px solid #5bc8f5',
                                      borderRadius:3,
                                      color:'#5bc8f5',
                                      textShadow:'0 0 6px rgba(91,200,245,.5)',
                                      position:'relative',
                                    }}>
                                      {w}
                                      <sup style={{ fontSize:'0.4em', color:'#5bc8f5', marginRight:1, verticalAlign:'super' }}>{wordChars.length}</sup>
                                      {wi < ayatWords.length - 1 ? ' ' : ''}
                                    </span>
                                  );
                                }

                                return (
                                  <span key={wi} style={baseStyle}>
                                    {w}{wi < ayatWords.length - 1 ? ' ' : ''}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        }

                        return (
                          <div className="ayat-arabic">
                            {(showQalqala || showMadd)
                              ? (() => { const arr = [...ayat.text]; return arr.map((ch, i) => {
                                  const q = showQalqala && isQalqala(arr, i);
                                  const mt = showMadd ? getMaddType(arr, i) : null;
                                  const iz = showIzhar && isIzhar(arr, i);
                                  const id = showIdgham && isIdgham(arr, i);
                                  return q ? <span key={i} style={{color:'#5bc8f5',textShadow:'0 0 6px rgba(91,200,245,.5)'}}>{ch}</span>
                                       : mt==='muttasil' ? <span key={i} style={{color:'#ff7eb3',textShadow:'0 0 8px rgba(255,126,179,.6)',fontWeight:600}}>{ch}</span>
                                       : mt==='normal'   ? <span key={i} style={{color:'#f09de0',textShadow:'0 0 6px rgba(240,157,224,.5)'}}>{ch}</span>
                                       : iz              ? <span key={i} style={{color:'#4caf81',textShadow:'0 0 6px rgba(76,175,129,.5)'}}>{ch}</span>
                                       : id              ? <span key={i} style={{color:'#ffd166',textShadow:'0 0 6px rgba(255,209,102,.5)'}}>{ch}</span>
                                       : <span key={i}>{ch}</span>;
                                }); })()
                              : ayat.text}
                          </div>
                        );
                      };

                      return (
                        <div key={ayat.number}
                          className={`ayat-row${isPlaying ? " playing" : ""}${isCurrent ? " current" : ""}${ld.learned ? " learned" : ""}${isSelecting ? " selecting" : ""}${isPageStart ? " page-start" : ""}${isPageEnd ? " page-end" : ""}`}
                          style={inLoop && !isPlaying && !isSelecting ? { borderLeft: "2px solid var(--teal)", background: "rgba(62,184,160,0.04)" } : isSelecting ? { borderLeft: "2px solid var(--gold)", background: "rgba(201,168,76,0.04)" } : {}}
                          ref={el => ayatRefs.current[ayat.numberInSurah] = el}>

                          {isPageStart && <div className="page-edge-pill start">◆ PAGE {ayat.page}</div>}

                          {/* Selection hint bar shown above the ayat when selecting */}
                          {isSelecting && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 22px 2px", background: "rgba(201,168,76,.05)" }}>
                              <span style={{ fontSize: 9, letterSpacing: 1.5, color: partSelectStep === 'start' ? "var(--gold2)" : "var(--teal2)", fontFamily: "'Cinzel',serif" }}>
                                {partSelectStep === 'start' ? "① CLIQUEZ LE PREMIER MOT" : `② CLIQUEZ LE DERNIER MOT — début : `}
                                {partSelectStep === 'end' && partSelectStart !== null && (
                                  <span style={{ fontFamily: "'Amiri Quran',serif", fontSize: 15, color: "var(--gold2)", marginRight: 4 }}>{ayatWords[partSelectStart]}</span>
                                )}
                              </span>
                              <button onClick={e => { e.stopPropagation(); setPartSelectAyat(null); setPartSelectStep(null); setPartSelectStart(null); }}
                                style={{ marginLeft: "auto", fontSize: 9, letterSpacing: 1, padding: "3px 8px", border: "1px solid var(--border2)", background: "transparent", color: "var(--text3)", cursor: "pointer", borderRadius: 4, fontFamily: "'Cinzel',serif" }}>
                                ANNULER
                              </button>
                            </div>
                          )}

                          <div className={`ayat-main${isPlaying ? " ayat-playing" : ""}`}
                            onClick={() => {
                              if (isSelecting) return; // don't open/close while selecting
                              setOpenAyatNum(isOpen ? null : ayat.numberInSurah);
                              if (isOpen) setAideMemoireClickModes(prev => { const n={...prev}; delete n[ayat.numberInSurah]; return n; });
                              if (!isOpen) setSubmenuMode("lecture");
                            }}>
                            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, flexShrink:0 }}>
                              <div className="ayat-number-badge"
                                title="Ouvrir le verset"
                                style={{cursor:'pointer'}}
                              >{ayat.numberInSurah}</div>
                              <button
                                title="Lire depuis ce verset"
                                onClick={e => {
                                  e.stopPropagation();
                                  const idx = ayats.findIndex(a => a.numberInSurah === ayat.numberInSurah);
                                  if (idx >= 0) { playMainAyat(idx); setIsMainPlaying(true); }
                                }}
                                style={{
                                  width:22, height:22, borderRadius:"50%", border:"none",
                                  background: isPlaying ? "var(--teal)" : "rgba(62,184,160,.15)",
                                  color: isPlaying ? "#fff" : "var(--teal2)",
                                  fontSize:9, cursor:"pointer", display:"flex", alignItems:"center",
                                  justifyContent:"center", flexShrink:0, transition:"all .15s",
                                  outline: isPlaying ? "2px solid var(--teal)" : "none",
                                  outlineOffset:2,
                                }}>▶</button>
                            </div>
                            {renderAyatText()}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                              {ld.learned && <div className="ayat-learned-badge">✓ APPRIS</div>}
                              {ld.toRevise && <div style={{ fontSize:7, letterSpacing:1, padding:'2px 6px', borderRadius:8, border:'1px solid var(--gold)', color:'var(--gold2)', fontFamily:"'Cinzel',serif" }}>🔖 RÉVISER</div>}
                              {(() => { const m = masteryMap[lkey(selectedSurah.number, ayat.numberInSurah)] ?? 0; return m > 0 ? <div style={{ fontSize:8, letterSpacing:1, padding:'2px 7px', borderRadius:10, border:'1px solid '+masteryColor(m), color:masteryColor(m), fontFamily:"'Cinzel',serif" }}>{m}%</div> : null; })()}
                              {ts && <div className="ts-status loaded">⚡ TS</div>}
                            </div>
                          </div>

                          {/* Translation — full-width block below Arabic */}
                          {translationLang && (() => {
                            const key = `${translationLang}:${selectedSurah.number}`;
                            const tList = translations[key];
                            const tText = tList?.find(t => t.numberInSurah === ayat.numberInSurah)?.text;
                            return tText ? (
                              <div style={{
                                padding: '4px 14px 8px 54px',
                                borderTop: '1px solid rgba(91,200,245,.08)',
                                background: 'rgba(91,200,245,.03)',
                                direction: translationLang === 'ur' ? 'rtl' : 'ltr',
                              }}>
                                <div style={{
                                  fontSize: 11,
                                  color: 'rgba(91,200,245,.6)',
                                  fontStyle: 'italic',
                                  lineHeight: 1.65,
                                  letterSpacing: .2,
                                }}>
                                  {tText}
                                </div>
                              </div>
                            ) : null;
                          })()}

                          <AnimatedSubmenu isOpen={isOpen}>
                            <Submenu
                              ayat={ayat} surahNum={selectedSurah.number}
                              ld={ld} setLData={setLData}
                              submenuMode={submenuMode} setSubmenuMode={setSubmenuMode}
                              audioUrl={audioUrl(ayat)}
                              isMainPlaying={isMainPlaying}
                              timestamps={ts}
                              partSelectAyat={partSelectAyat} partSelectStep={partSelectStep}
                              onStartPartCreate={() => {
                                setPartSelectAyat(ayat.numberInSurah);
                                setPartSelectStep('start');
                                setPartSelectStart(null);
                              }}
                              collections={collections}
                              ayatInCollections={ayatInCollections(selectedSurah.number, ayat.numberInSurah)}
                              onOpenCollModal={() => setCollModal({ surahNum: selectedSurah.number, surahEn: selectedSurah.englishName, ayatNum: ayat.numberInSurah, text: ayat.text, number: ayat.number })}
                              onLoadTimestamps={data => {
                                const parsed = parseTimestampsFile(data, selectedSurah.number, recitatorId);
                                if (Object.keys(parsed).length === 0 && data.words)
                                  setTimestampsMap({ ...timestampsMap, [tskey(selectedSurah.number, ayat.numberInSurah)]: { words: data.words } });
                                else setTimestampsMap({ ...timestampsMap, ...parsed });
                              }}
                              onUpdateTimestamps={data => {
                                setTimestampsMap({ ...timestampsMap, [tskey(selectedSurah.number, ayat.numberInSurah)]: data });
                              }}
                              onLocalPlay={(ms) => setLocalPlaying(ms != null ? { ayatNum: ayat.numberInSurah, currentMs: ms } : null)}
                              aideMemoireClickMode={aideMemoireClickModes[ayat.numberInSurah]||null}
                              setAideMemoireClickMode={(m)=>setAideMemoireClickModes(prev=>({...prev,[ayat.numberInSurah]:m}))}
                              spellCheck={spellCheck}
                              ayatLoopActive={loopActive && loopStartNum === ayat.numberInSurah && loopEndNum === ayat.numberInSurah}
                              onSetLoop={() => {
                                const idx = ayats.findIndex(a => a.numberInSurah === ayat.numberInSurah);
                                if (idx === -1) return;
                                setLoopStart(idx); setLoopEnd(idx);
                                setLoopStartInput(ayat.numberInSurah); setLoopEndInput(ayat.numberInSurah);
                                setLoopActive(true);
                              }}
                            />
                          </AnimatedSubmenu>
                          {isPageEnd && <div className="page-edge-pill end">FIN · PAGE {ayat.page} ◆</div>}
                        </div>
                      );
                    }); })()}</>}
                </div>
              </>
            )}
          </main></AnimatedPage>
            )} />
            <Route path="*" element={<Navigate to="/quran" replace />} />
          </Routes>
        </div>

        {/* CONTEXT MENU — apparaît sur clic droit / appui long avec une sélection de texte dans un ayat */}
        {selMenu && (
          <>
            <div onClick={() => setSelMenu(null)} onContextMenu={e => { e.preventDefault(); setSelMenu(null); }}
              style={{ position:"fixed", inset:0, zIndex:998 }} />
            <div style={{
              position:"fixed", top:selMenu.y, left:selMenu.x, zIndex:999,
              background:"var(--surface2)", border:"1px solid #c878ff", borderRadius:8,
              boxShadow:"0 6px 20px rgba(0,0,0,.4)", overflow:"hidden", minWidth:200,
              transform:"translate(4px,4px)",
            }}>
              <button onClick={searchSelectionInCollections} style={{
                display:"flex", alignItems:"center", gap:8, width:"100%", padding:"10px 14px",
                background:"transparent", border:"none", color:"var(--text)", fontSize:11,
                letterSpacing:.5, cursor:"pointer", textAlign:"left",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(200,120,255,.12)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                🔍 Rechercher la sélection
              </button>
              <div style={{ padding:"0 14px 8px", fontSize:9, color:"var(--text3)",
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:260, direction:"rtl" }}>
                {selMenu.text}
              </div>
            </div>
          </>
        )}

        {/* COLLECTION MODAL */}
        {showOptionsModal && <OptionsModal onClose={() => setShowOptionsModal(false)} />}
        {collModal && (
          <CollectionModal
            ayat={collModal}
            collections={collections}
            onToggle={toggleAyatInCollection}
            onCreateAndAdd={(name) => {
              dispatch(collectionsActions.createCollectionWithAyat({ name, ayatEntry: collModal }));
            }}
            onClose={() => setCollModal(null)}
          />
        )}

        {/* RAPPEL WIDGET GLOBAL */}
        <div style={{ display: showRappel ? 'block' : 'none' }}>
          <RappelWidget onClose={() => setShowRappel(false)} />
        </div>

        {/* AUDIO PERSISTANTS — toujours montés pour ne jamais interrompre la lecture en changeant de page */}
        <audio ref={silentAudioRef} src={SILENT_WAV} loop style={{ display:"none" }} />
        <audio
          ref={el => {
            mainAudioRef.current = el;
            if (el) el._ayatNum = currentMainAyat?.numberInSurah;
          }}
          src={audioUrl(currentMainAyat)}
          onEnded={handleMainEnded}
          onError={() => {
            // Current bitrate 404s for this reciter → fall back to the next candidate
            // automatically (and remember it), then retry without interrupting playback.
            const next = markBitrateBad(recitatorId);
            if (next != null) {
              setBitrateVersion(v => v + 1);
              loadedAyatIdxRef.current = null;
              // wait one frame so React commits the new `src` (now built from the updated
              // bitrate) before forcing the element to actually load it
              requestAnimationFrame(() => {
                const a = mainAudioRef.current;
                if (!a) return;
                a.load();
                loadedAyatIdxRef.current = mainAyatIdx;
                if (isMainPlaying) playWhenReady();
              });
            }
          }}
          style={{ display: "none" }}
        />

        {/* MAIN PLAYER */}
        {selectedSurah && ayats.length > 0 && (
          <div className="main-player">

            <div className="player-row">
              <div className="player-info">
                <div className="player-surah">{selectedSurah.englishName.toUpperCase()}</div>
                <div className="player-ayah">
                  AYAT {currentMainAyat?.numberInSurah || 1} / {ayats.length}
                  {loopActive && <span style={{ color: "var(--teal)", marginLeft: 8 }}>
                    ↺ {loopStartNum}–{loopEndNum}
                    {loopMax > 0 && <span style={{ color: "var(--text3)" }}> · {loopCount + 1}/{loopMax}</span>}
                  </span>}
                </div>
              </div>

              <div className="player-controls">
                <button className="ctrl-btn" title="Premier verset" onClick={() => {
                  playMainAyat(loopActive ? loopStart : 0); if (isMainPlaying) setTimeout(() => mainAudioRef.current?.play(), 100);
                }} style={{ fontSize: 11 }}>⏮</button>
                <button className="ctrl-btn" onClick={() => {
                  const i = Math.max(loopActive ? loopStart : 0, mainAyatIdx - 1);
                  playMainAyat(i); if (isMainPlaying) setTimeout(() => mainAudioRef.current?.play(), 100);
                }}>◀</button>
                <button className="ctrl-btn play-btn" onClick={() => {
                  if (!isMainPlaying) { playMainAyat(loopActive ? loopStart : mainAyatIdx); setIsMainPlaying(true); }
                  else { setIsMainPlaying(false); setPlayingAyatNum(null); mainAudioRef.current?.pause(); }
                }}>{isMainPlaying ? "⏸" : "▶"}</button>
                <button className="ctrl-btn" onClick={() => {
                  const i = Math.min(loopActive ? loopEnd : ayats.length - 1, mainAyatIdx + 1);
                  playMainAyat(i); if (isMainPlaying) setTimeout(() => mainAudioRef.current?.play(), 100);
                }}>▶</button>
                <button
                  className={`ctrl-btn${loopActive ? " loop-on" : ""}`}
                  title="Activer/désactiver la boucle"
                  onClick={() => { setLoopActive(!loopActive); if (!loopActive) setLoopCount(0); }}
                  style={{ fontSize: 12 }}>↺</button>
                <button
                  className={`ctrl-btn${showLoopBar ? " loop-on" : ""}`}
                  title="Configurer le range de boucle"
                  onClick={() => setShowLoopBar(!showLoopBar)}
                  style={{ fontSize: 11 }}>⚙</button>
                {/* Voice mic shortcut */}
                <button
                  className={`ctrl-btn${listening ? " loop-on" : ""}`}
                  title="Commande vocale"
                  onClick={toggleVoice}
                  style={{ fontSize: 14 }}>🎤</button>
                {/* Reciter picker */}
                <button
                  className={`ctrl-btn reciter-trigger${showRecitPanel ? " loop-on" : ""}`}
                  aria-haspopup="dialog"
                  aria-expanded={showRecitPanel}
                  aria-label={`Choisir le récitateur. Actuel : ${activeRecitator?.label || recitatorId}`}
                  title={`Récitateur : ${activeRecitator?.label || recitatorId}`}
                  onClick={() => { setRecitatorSearch(""); setShowRecitPanel(v => !v); }}>
                  <span>{activeRecitator?.flag || '🎙️'}</span>
                  <span className="reciter-trigger-label">{activeRecitator?.label || 'Récitateur'}</span>
                </button>
              </div>

              {showRecitPanel && createPortal(
                <>
                  <div className="reciter-sheet-backdrop" onClick={() => setShowRecitPanel(false)} aria-hidden="true" />
                  <section className="reciter-sheet" role="dialog" aria-modal="true" aria-labelledby="reciter-sheet-title">
                    <div className="reciter-sheet-header">
                      <div style={{ minWidth:0 }}>
                        <div id="reciter-sheet-title" className="reciter-sheet-title">CHOISIR UN RÉCITATEUR</div>
                        <div className="reciter-sheet-current">Actuel · {activeRecitator?.label || recitatorId}</div>
                      </div>
                      <button className="reciter-sheet-close" onClick={() => setShowRecitPanel(false)} aria-label="Fermer le choix du récitateur">×</button>
                    </div>
                    <input className="reciter-search" type="search" autoFocus value={recitatorSearch}
                      onChange={e => setRecitatorSearch(e.target.value)} placeholder="Rechercher un récitateur" aria-label="Rechercher un récitateur" />
                    <div className="reciter-list">
                      {visibleRecitators.map(r => (
                        <button key={r.id} className={`reciter-option${r.id === recitatorId ? ' selected' : ''}`} onClick={() => {
                          const changed = r.id !== recitatorId;
                          setRecitatorId(r.id);
                          setShowRecitPanel(false);
                          if (changed && mainAudioRef.current) {
                            loadedAyatIdxRef.current = null;
                            if (isMainPlaying) {
                              mainAudioRef.current.load();
                              mainAudioRef.current.play().catch(() => {});
                              loadedAyatIdxRef.current = mainAyatIdx;
                            }
                          }
                        }}>
                          <span className="reciter-option-flag">{r.flag}</span>
                          <span className="reciter-option-name">{r.label}</span>
                          {r.id === recitatorId && <span className="reciter-option-check" aria-label="Sélectionné">✓</span>}
                        </button>
                      ))}
                      {visibleRecitators.length === 0 && <div className="reciter-empty">Aucun récitateur ne correspond à cette recherche.</div>}
                    </div>
                    <div className="reciter-sheet-footer">
                      <span>Débit audio · {bitrate} kbps</span>
                      <button className="reciter-reset" onClick={() => {
                        setReciterBitrate(recitatorId, bitrateOrderFor(recitatorId)[0]);
                        setBitrateVersion(v => v + 1);
                        loadedAyatIdxRef.current = null;
                        if (mainAudioRef.current) {
                          mainAudioRef.current.load();
                          loadedAyatIdxRef.current = mainAyatIdx;
                          if (isMainPlaying) playWhenReady();
                        }
                      }}>Réinitialiser le débit</button>
                    </div>
                  </section>
                </>,
                document.body
              )}

              {(() => {
                const sn = selectedSurah.number;
                const ayatDurations = ayats.map(a => {
                  const ts = timestampsMap[tskey(sn, a.numberInSurah)];
                  if (!ts?.words?.length) return 0;
                  const allChars = ts.words.flatMap(w => w.chars || []);
                  const first = allChars[0], last = allChars[allChars.length - 1];
                  if (!first || !last) return 0;
                  return Math.max(0, (last.end || 0) - (first.start || 0));
                });
                const totalMs = ayatDurations.reduce((s, d) => s + d, 0);
                const fmt = ms => { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };

                if (totalMs <= 0) return (
                  <div className="player-progress">
                    <div className="progress-bar-wrap">
                      {loopActive && ayats.length > 1 && (
                        <div className="progress-range" style={{ left:`${(loopStart/ayats.length)*100}%`, width:`${((Math.min(loopEnd,ayats.length-1)-loopStart+1)/ayats.length)*100}%` }} />
                      )}
                      <div className="progress-bar-fill" style={{ width:`${((mainAyatIdx+1)/ayats.length)*100}%` }} />
                    </div>
                    <span className="progress-text">{mainAyatIdx+1}/{ayats.length}</span>
                  </div>
                );

                const prevMs = ayatDurations.slice(0, mainAyatIdx).reduce((s, d) => s + d, 0);
                const ts = timestampsMap[tskey(sn, currentMainAyat?.numberInSurah)];
                const ayatStartMs = ts?.words?.[0]?.chars?.[0]?.start ?? 0;
                const curMs = Math.max(0, prevMs + (mainCurrentMsRef.current - ayatStartMs));
                const pct = Math.min(100, (curMs / totalMs) * 100);

                // Loop range overlay
                const loopStartMs = ayatDurations.slice(0, loopStart).reduce((s,d)=>s+d,0);
                const loopEndMs   = ayatDurations.slice(0, Math.min(loopEnd,ayats.length-1)+1).reduce((s,d)=>s+d,0);

                return (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'2px 0', width:'100%' }}>
                    <span style={{ fontSize:9, color:'var(--text3)', fontFamily:"'Cinzel',serif", letterSpacing:1, flexShrink:0 }}>{fmt(curMs)}</span>
                    <div style={{ flex:1, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden', cursor:'pointer', position:'relative' }}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const targetMs = (e.clientX - rect.left) / rect.width * totalMs;
                        let acc = 0;
                        for (let i = 0; i < ayats.length; i++) {
                          if (acc + ayatDurations[i] >= targetMs || i === ayats.length - 1) {
                            playMainAyat(i);
                            const tsA = timestampsMap[tskey(sn, ayats[i].numberInSurah)];
                            const aStart = tsA?.words?.[0]?.chars?.[0]?.start ?? 0;
                            setTimeout(() => {
                              if (mainAudioRef.current) {
                                mainAudioRef.current.currentTime = aStart/1000 + (targetMs-acc)/1000;
                                if (isMainPlaying) mainAudioRef.current.play().catch(()=>{});
                              }
                            }, 80);
                            break;
                          }
                          acc += ayatDurations[i];
                        }
                      }}>
                      {loopActive && <div style={{ position:'absolute', left:`${(loopStartMs/totalMs)*100}%`, width:`${((loopEndMs-loopStartMs)/totalMs)*100}%`, height:'100%', background:'rgba(62,184,160,.25)' }} />}
                      <div style={{ height:'100%', width:`${pct}%`, background:'var(--gold)', borderRadius:2, transition:'width .1s linear' }} />
                    </div>
                    <span style={{ fontSize:9, color:'var(--text3)', fontFamily:"'Cinzel',serif", letterSpacing:1, flexShrink:0 }}>{fmt(totalMs)}</span>
                  </div>
                );
              })()}
            </div>

            {/* LOOP CONFIG BAR */}
            {showLoopBar && (
              <div className="loop-bar">
                <span className="loop-label">BOUCLE</span>
                <div className="loop-inputs">
                  <span className="loop-rep-label">DE</span>
                  <input className="loop-input" value={loopStartInput}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1) setLoopStartInput(n); }}
                    onBlur={applyLoopInputs}
                    onKeyDown={e => e.key === 'Enter' && applyLoopInputs()}
                    placeholder="1" />
                  <span className="loop-sep">→</span>
                  <input className="loop-input" value={loopEndInput}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1) setLoopEndInput(n); }}
                    onBlur={applyLoopInputs}
                    onKeyDown={e => e.key === 'Enter' && applyLoopInputs()}
                    placeholder={ayats.length} />
                  <button className="btn-small" onClick={() => {
                    applyLoopInputs(); setLoopActive(true); setLoopCount(0);
                    playMainAyat(ayats.findIndex(a => a.numberInSurah === ((typeof loopStartInput === "number" ? loopStartInput : parseInt(loopStartInput)) || 1)));
                    setIsMainPlaying(true);
                  }}>▶ GO</button>
                </div>

                <div className="loop-rep-wrap">
                  <span className="loop-rep-label">RÉPÉTER</span>
                  <div className="loop-rep-btns">
                    {[0, 2, 3, 5, 10].map(n => (
                      <button key={n} className={`loop-rep-btn${loopMax === n ? ' sel' : ''}`}
                        onClick={() => { setLoopMax(n); setLoopCount(0); }}>
                        {n === 0 ? '∞' : `×${n}`}
                      </button>
                    ))}
                  </div>
                </div>

                {loopActive && (
                  <div className="loop-count-badge">
                    CYCLE <span>{loopCount + 1}{loopMax > 0 ? `/${loopMax}` : ''}</span>
                  </div>
                )}

                <button className="btn-small" style={{ marginLeft: "auto" }}
                  onClick={() => { setLoopActive(false); setLoopCount(0); setShowLoopBar(false); }}>
                  ✕ DÉSACTIVER
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <ArabicKeyboard
        show={showArabicKeyboard}
        onClose={() => { setShowArabicKeyboard(false); try { localStorage.setItem('quran_arabic_keyboard', '0'); } catch {} }}
      />
    </>
    </ArabicKeyboardContext.Provider>
  );
}

// ─── LearningMapPage ──────────────────────────────────────────────────────────
// Visual heatmap of Quran learning progress: all 114 surahs, per-ayat coloring
function LearningMapPage({ surahs, learnData, onNavigate }) {
  const [selectedSns, setSelectedSns] = React.useState(new Set()); // selected surahs
  const [view, setView] = React.useState("surahs"); // "surahs" | "detail"
  const [hoveredSn, setHoveredSn] = React.useState(null);
  const [pageData, setPageData] = React.useState({}); // sn -> [{numberInSurah, page}]

  // Compute per-surah stats
  const surahStats = React.useMemo(() => {
    return surahs.map(s => {
      const total = s.numberOfAyahs;
      const learned = Object.keys(learnData).filter(k => {
        const [sn] = k.split(':').map(Number);
        return sn === s.number && learnData[k]?.learned;
      }).length;
      const perfect = Object.keys(learnData).filter(k => {
        const [sn] = k.split(':').map(Number);
        if (sn !== s.number || !learnData[k]?.learned) return false;
        const attempts = learnData[k]?.writingAttempts || [];
        return attempts.some(a => a.score === 100);
      }).length;
      const questioned = Object.keys(learnData).filter(k => {
        const [sn] = k.split(':').map(Number);
        return sn === s.number && learnData[k]?.questionScores && Object.keys(learnData[k].questionScores).length > 0;
      }).length;
      return { sn: s.number, name: s.name, ename: s.englishName, total, learned, perfect, questioned };
    });
  }, [surahs, learnData]);

  const toggleSn = (sn) => setSelectedSns(prev => {
    const next = new Set(prev);
    if (next.has(sn)) next.delete(sn); else next.add(sn);
    return next;
  });

  // Fetch page mapping when a surah is expanded
  const ensurePageData = React.useCallback((sn) => {
    if (pageData[sn]) return;
    fetchSurahDefault(sn).then(ayahs => {
      setPageData(p => ({ ...p, [sn]: ayahs.map(a => ({ numberInSurah: a.numberInSurah, page: a.page })) }));
    }).catch(() => {});
  }, [pageData]);

  const selectAll = () => setSelectedSns(new Set(surahs.map(s => s.number)));
  const clearAll  = () => setSelectedSns(new Set());

  const totalLearned   = surahStats.reduce((a, s) => a + s.learned, 0);
  const totalAyat      = surahStats.reduce((a, s) => a + s.total, 0);
  const totalPerfect   = surahStats.reduce((a, s) => a + s.perfect, 0);
  const totalQuestion  = surahStats.reduce((a, s) => a + s.questioned, 0);

  const selStats = selectedSns.size > 0
    ? surahStats.filter(s => selectedSns.has(s.sn))
    : null;

  const getAyatColor = (sn, an) => {
    const ld = learnData[`${sn}:${an}`];
    if (!ld?.learned) return { bg: 'var(--surface3)', border: 'var(--border)' };
    const attempts = ld.writingAttempts || [];
    const best = attempts.length ? Math.max(...attempts.map(a => a.score)) : 0;
    const qs = ld.questionScores || {};
    const qKeys = Object.keys(qs);
    const allQCorrect = qKeys.length > 0 && qKeys.every(k => { const arr = qs[k]; return arr[arr.length-1] === 1; });
    if (best === 100 && allQCorrect) return { bg: 'rgba(201,168,76,.4)',  border: 'var(--gold)' };
    if (best === 100)                return { bg: 'rgba(76,175,129,.35)', border: 'var(--green)' };
    if (best >= 70)                  return { bg: 'rgba(62,184,160,.25)', border: 'var(--teal)' };
    if (best > 0)                    return { bg: 'rgba(229,115,115,.2)', border: 'var(--red)' };
    return { bg: 'rgba(255,255,255,.05)', border: 'var(--border2)' };
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'12px 0' }}>
      {/* Global stats */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {[
          { label:'TOTAL CORAN', val:totalAyat, color:'var(--text3)' },
          { label:'APPRIS',      val:totalLearned,  color:'var(--teal2)' },
          { label:'PARFAITS',    val:totalPerfect,  color:'var(--green)' },
          { label:'QUESTIONS',   val:totalQuestion, color:'var(--gold)' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ flex:1, minWidth:70, padding:'8px 10px', borderRadius:8,
            background:'var(--surface2)', border:'1px solid var(--border)', textAlign:'center' }}>
            <div style={{ fontSize:14, fontFamily:"'Cinzel',serif", color, fontWeight:600 }}>{val}</div>
            <div style={{ fontSize:7, letterSpacing:1.5, color:'var(--text3)', marginTop:2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar overall */}
      <div style={{ height:6, borderRadius:3, background:'var(--surface3)', overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${totalAyat ? (totalLearned/totalAyat*100) : 0}%`,
          background:'linear-gradient(90deg,var(--teal),var(--green))', borderRadius:3, transition:'width .5s' }} />
      </div>

      {/* Selection controls */}
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>
          {selectedSns.size > 0 ? `${selectedSns.size} SOURATE${selectedSns.size>1?'S':''} SÉLECTIONNÉE${selectedSns.size>1?'S':''}` : 'CLIQUER POUR SÉLECTIONNER'}
        </div>
        <button onClick={selectAll} style={{ fontSize:7, letterSpacing:1, padding:'2px 8px', borderRadius:10,
          border:'1px solid var(--teal)', background:'rgba(62,184,160,.08)', color:'var(--teal)',
          fontFamily:"'Cinzel',serif", cursor:'pointer' }}>TOUT</button>
        {selectedSns.size > 0 && <button onClick={clearAll} style={{ fontSize:7, letterSpacing:1, padding:'2px 8px', borderRadius:10,
          border:'1px solid var(--border2)', background:'transparent', color:'var(--text3)',
          fontFamily:"'Cinzel',serif", cursor:'pointer' }}>EFFACER</button>}
      </div>

      {/* Surah grid */}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {surahStats.map(({ sn, name, ename, total, learned, perfect }) => {
          const pct = total ? learned / total : 0;
          const pctP = total ? perfect / total : 0;
          const selected = selectedSns.has(sn);
          const hovered  = hoveredSn === sn;
          const si = surahs.find(s => s.number === sn);
          const ayahs = si ? Array.from({ length: si.numberOfAyahs }, (_, i) => i + 1) : [];

          return (
            <div key={sn}
              style={{ borderRadius:9, border:`1px solid ${selected ? 'var(--teal)' : 'var(--border)'}`,
                background: selected ? 'rgba(62,184,160,.04)' : 'var(--surface2)', overflow:'hidden',
                transition:'border-color .15s' }}>
              {/* Surah header row */}
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer' }}
                onClick={() => { toggleSn(sn); ensurePageData(sn); }}
                onMouseEnter={() => { setHoveredSn(sn); ensurePageData(sn); }}
                onMouseLeave={() => setHoveredSn(null)}>
                <div style={{ width:16, height:16, borderRadius:4, flexShrink:0, transition:'all .15s',
                  background: selected ? 'var(--teal)' : 'transparent',
                  border:`1px solid ${selected ? 'var(--teal)' : 'var(--border2)'}`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:10, color:'var(--surface)' }}>{selected ? '✓' : ''}</div>
                <div style={{ fontSize:8, color:'var(--text3)', fontFamily:"'Cinzel',serif", letterSpacing:1, width:18, flexShrink:0 }}>{sn}</div>
                <div style={{ flex:1 }}>
                  {/* Mini progress bar */}
                  <div style={{ height:4, borderRadius:2, background:'var(--surface3)', overflow:'hidden', marginBottom:2 }}>
                    <div style={{ height:'100%', width:`${pct*100}%`, borderRadius:2,
                      background: pct === 1 ? 'var(--gold)' : 'var(--teal)', transition:'width .3s' }} />
                  </div>
                  {pctP > 0 && <div style={{ height:2, borderRadius:1, background:'var(--surface3)', overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${pctP*100}%`, borderRadius:1, background:'var(--green)' }} />
                  </div>}
                </div>
                <div style={{ fontSize:8, color: learned > 0 ? 'var(--teal2)' : 'var(--text3)',
                  fontFamily:"'Cinzel',serif", letterSpacing:.5, minWidth:40, textAlign:'right' }}>
                  {learned}/{total}
                </div>
                <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:16, color:'var(--gold)', direction:'rtl' }}>{name}</div>
              </div>

              {/* Ayat heatmap — compact inline with page badges */}
              {(selected || hovered) && (() => {
                const pd = pageData[sn];
                // Build sorted flat list with page boundary markers
                const items = []; // {type:'badge'|'cell', page?, an?}
                if (pd && pd.length > 0) {
                  let lastPage = null;
                  pd.forEach(({ numberInSurah: an, page }) => {
                    if (page !== lastPage) { items.push({ type:'badge', page }); lastPage = page; }
                    items.push({ type:'cell', an });
                  });
                } else {
                  ayahs.forEach(an => items.push({ type:'cell', an }));
                }
                return (
                  <div style={{ borderTop:'1px solid var(--border)', padding:'8px 12px',
                    display:'flex', flexWrap:'wrap', gap:2, alignItems:'center' }}>
                    {items.map((item, i) => item.type === 'badge'
                      ? <span key={`p${item.page}-${i}`} style={{
                          fontSize:6, letterSpacing:1, color:'#c878ff',
                          fontFamily:"'Cinzel',serif", padding:'0 3px',
                          borderLeft: i > 0 ? '1px solid rgba(200,120,255,.2)' : 'none',
                          marginLeft: i > 0 ? 3 : 0, lineHeight:'18px',
                        }}>P{item.page}</span>
                      : (() => {
                          const { bg, border } = getAyatColor(sn, item.an);
                          return (
                            <div key={item.an}
                              title={`${ename} ${item.an}`}
                              onClick={e => { e.stopPropagation(); onNavigate?.('quran', sn, item.an); }}
                              style={{ width:18, height:18, borderRadius:3, cursor:'pointer',
                                background:bg, border:`1px solid ${border}`,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                fontSize:6, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>
                              {item.an}
                            </div>
                          );
                        })()
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', padding:'4px 0' }}>
        {[
          { bg:'rgba(201,168,76,.4)',  border:'var(--gold)',    label:'Maîtrisé (écrit + questions)' },
          { bg:'rgba(76,175,129,.35)',border:'var(--green)',   label:'Parfait (écriture)' },
          { bg:'rgba(62,184,160,.25)',border:'var(--teal)',    label:'Bon (≥70%)' },
          { bg:'rgba(229,115,115,.2)',border:'var(--red)',     label:'À revoir' },
          { bg:'rgba(255,255,255,.05)',border:'var(--border2)',label:'Non révisé' },
          { bg:'var(--surface3)',     border:'var(--border)',  label:'Non appris' },
        ].map(({ bg, border, label }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:bg, border:`1px solid ${border}`, flexShrink:0 }} />
            <span style={{ fontSize:7, color:'var(--text3)', letterSpacing:.5 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Selected surahs actions */}
      {selectedSns.size > 0 && selStats && (
        <div style={{ padding:'14px', background:'var(--surface2)', border:'1px solid var(--teal)',
          borderRadius:10, display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:8, letterSpacing:2, color:'var(--teal2)', fontFamily:"'Cinzel',serif" }}>
            SÉLECTION — {selStats.reduce((a,s)=>a+s.learned,0)} ayats appris
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div style={{ flex:1, textAlign:'center' }}>
              <div style={{ fontSize:12, color:'var(--green)', fontFamily:"'Cinzel',serif" }}>{selStats.reduce((a,s)=>a+s.perfect,0)}</div>
              <div style={{ fontSize:7, color:'var(--text3)', letterSpacing:1 }}>PARFAITS</div>
            </div>
            <div style={{ flex:1, textAlign:'center' }}>
              <div style={{ fontSize:12, color:'var(--gold)', fontFamily:"'Cinzel',serif" }}>{selStats.reduce((a,s)=>a+s.questioned,0)}</div>
              <div style={{ fontSize:7, color:'var(--text3)', letterSpacing:1 }}>QUESTIONS</div>
            </div>
            <div style={{ flex:1, textAlign:'center' }}>
              <div style={{ fontSize:12, color:'var(--teal2)', fontFamily:"'Cinzel',serif" }}>
                {selStats.reduce((a,s)=>a+s.learned,0)}/{selStats.reduce((a,s)=>a+s.total,0)}
              </div>
              <div style={{ fontSize:7, color:'var(--text3)', letterSpacing:1 }}>APPRIS/TOTAL</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RevisionPage ─────────────────────────────────────────────────────────────
// Page dédiée à la révision de tous les ayats marqués comme appris.
// Pour chaque ayat, on propose l'exercice d'écriture (RevisionEcritureMode)
// directement sur cette page, sans ouvrir le submenu.
function RevisionPage({ learnData, surahs, setLData, onNavigate, initialFilter }) {
  const { surahNum: urlSn, rangeFrom: urlRf, rangeTo: urlRt, qIdx: urlQIdx } = useParams();
  const [filter, setFilter]         = useState(initialFilter || "carte"); // "carte" | "questions"
  const [openSurahs, setOpenSurahs] = useState({});    // surahNum → bool
  const [openAyat,   setOpenAyat]   = useState(null);  // "surahNum:ayatNum" | null
  const [ayatTab,    setAyatTab]    = useState({});    // key -> "ecriture" | "tajweed"

  // ── Data repair: close orphaned reviseHistory entries ──────────────────────
  // Ayats where toRevise=false but reviseHistory still has an item with endDate
  // null (left open by a code path that cleared toRevise without closing it).
  useEffect(() => {
    const now = new Date().toISOString();
    Object.entries(learnData).forEach(([key, val]) => {
      if (val?.toRevise) return; // still active, nothing to fix
      const hist = val?.reviseHistory;
      if (!hist || hist.length === 0) return;
      const openIdx = hist.findIndex(e => !e.endDate);
      if (openIdx === -1) return;
      const [sn, an] = key.split(":").map(Number);
      setLData(sn, an, d => {
        const h = [...(d.reviseHistory || [])];
        const idx = h.findIndex(e => !e.endDate);
        if (idx === -1 || d.toRevise) return { ...d }; // already fixed / re-activated meanwhile — never return the frozen object as-is
        h[idx] = { ...h[idx], endDate: now };
        return { ...d, reviseHistory: h };
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Construire la liste des ayats appris groupés par sourate
  const learnedBySurah = useMemo(() => {
    const map = {};
    Object.entries(learnData).forEach(([key, val]) => {
      if (!val?.learned) return;
      const [sn, an] = key.split(":").map(Number);
      if (!map[sn]) map[sn] = [];
      map[sn].push({ surahNum: sn, ayatNum: an, ld: val });
    });
    // Sort by surah then ayat
    Object.values(map).forEach(arr => arr.sort((a, b) => a.ayatNum - b.ayatNum));
    return map;
  }, [learnData]);

  const surahNums = Object.keys(learnedBySurah).map(Number).sort((a, b) => a - b);

  // Stats globales
  const totalLearned = useMemo(() => Object.values(learnedBySurah).reduce((s, a) => s + a.length, 0), [learnedBySurah]);
  const totalPerfect = useMemo(() =>
    Object.values(learnedBySurah).flat().filter(({ ld }) => {
      const attempts = ld.writingAttempts || [];
      return attempts.some(a => a.score === 100);
    }).length,
  [learnedBySurah]);
  const totalNone = useMemo(() =>
    Object.values(learnedBySurah).flat().filter(({ ld }) => !(ld.writingAttempts?.length > 0)).length,
  [learnedBySurah]);
  const totalToRevise = useMemo(() =>
    Object.values(learnData).filter(ld => ld?.toRevise).length,
  [learnData]);

  // Filtrage par statut de révision
  const getRevStatus = (ld) => {
    const attempts = ld.writingAttempts || [];
    if (attempts.length === 0) return "none";
    const best = Math.max(...attempts.map(a => a.score));
    if (best === 100) return "perfect";
    if (best >= 70)  return "good";
    return "bad";
  };

  const filteredBySurah = useMemo(() => {
    if (filter === "all") return learnedBySurah;
    if (filter === "toRevise") {
      // Include ALL ayats (learned or not) that have toRevise flag
      const out = {};
      Object.entries(learnData).forEach(([key, val]) => {
        if (!val?.toRevise) return;
        const [sn, an] = key.split(":").map(Number);
        if (!out[sn]) out[sn] = [];
        out[sn].push({ surahNum: sn, ayatNum: an, ld: val });
      });
      Object.values(out).forEach(arr => arr.sort((a, b) => a.ayatNum - b.ayatNum));
      return out;
    }
    const out = {};
    surahNums.forEach(sn => {
      const arr = (learnedBySurah[sn] || []).filter(({ ld }) => {
        const st = getRevStatus(ld);
        if (filter === "perfect") return st === "perfect";
        if (filter === "todo")    return st === "bad" || st === "good";
        if (filter === "none")    return st === "none";
        return true;
      });
      if (arr.length > 0) out[sn] = arr;
    });
    return out;
  }, [filter, learnedBySurah, surahNums, learnData]);

  const filteredSurahNums = Object.keys(filteredBySurah).map(Number).sort((a, b) => a - b);

  const toggleSurah = (sn) => setOpenSurahs(p => ({ ...p, [sn]: !p[sn] }));
  const toggleAyat  = (key) => setOpenAyat(p => p === key ? null : key);

  // Récupérer le texte de l'ayat depuis l'API (cache local)
  const [ayatTexts, setAyatTexts] = useState({}); // "sn:an" → text
  useEffect(() => {
    const missing = [];
    filteredSurahNums.forEach(sn => {
      (filteredBySurah[sn] || []).forEach(({ ayatNum }) => {
        const k = `${sn}:${ayatNum}`;
        if (!ayatTexts[k]) missing.push({ sn, an: ayatNum, k });
      });
    });
    if (missing.length === 0) return;
    // Group by surah to batch
    const bySurah = {};
    missing.forEach(({ sn, an, k }) => { if (!bySurah[sn]) bySurah[sn] = []; bySurah[sn].push({ an, k }); });
    Object.entries(bySurah).forEach(([sn, items]) => {
      fetchSurahDefault(Number(sn))
        .then(ayahs => {
          if (!ayahs?.length) return;
          const newTexts = {};
          ayahs.forEach(a => {
            const k = `${sn}:${a.numberInSurah}`;
            newTexts[k] = a.text;
          });
          setAyatTexts(p => ({ ...p, ...newTexts }));
        })
        .catch(() => {});
    });
  }, [filteredSurahNums.join(",")]);

  // Faux objet ayat pour RevisionEcritureMode
  const makeAyat = (sn, an) => ({ numberInSurah: an, text: ayatTexts[`${sn}:${an}`] || "" });

  const statusColor = {
    perfect: "var(--green)",
    good:    "var(--gold)",
    bad:     "var(--red)",
    none:    "var(--border2)",
  };
  const statusLabel = {
    perfect: "✓ PARFAIT",
    good:    "~ BON",
    bad:     "✗ À REVOIR",
    none:    "— NON RÉVISÉ",
  };

  return (
    <div className="rev-page">
      {/* Header */}
      <div className="rev-header-block">
        <div>
          <div className="rev-title">✏ RÉVISION</div>
          <div className="rev-subtitle">EXERCICES D'ÉCRITURE · AYATS APPRIS</div>
        </div>
        <div className="rev-stats-row">
          <div className="rev-stat-pill">
            <div className="rev-stat-num" style={{ color:"var(--gold2)" }}>{totalLearned}</div>
            <div className="rev-stat-label">APPRIS</div>
          </div>
          <div className="rev-stat-pill">
            <div className="rev-stat-num" style={{ color:"var(--green)" }}>{totalPerfect}</div>
            <div className="rev-stat-label">PARFAITS</div>
          </div>
          <div className="rev-stat-pill">
            <div className="rev-stat-num" style={{ color:"var(--text3)" }}>{totalNone}</div>
            <div className="rev-stat-label">À DÉBUTER</div>
          </div>
          {totalToRevise > 0 && (
          <div className="rev-stat-pill" style={{ cursor:'pointer' }} onClick={() => setFilter("toRevise")}>
            <div className="rev-stat-num" style={{ color:"var(--gold2)" }}>{totalToRevise}</div>
            <div className="rev-stat-label">🔖 RÉVISER</div>
          </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="rev-filter-row">
        {[
          { id:"carte",    label:"📊 CARTE" },
          { id:"questions",label:"❓ QUESTIONS" },
        ].map(f => (
          <button key={f.id}
            className={`rev-filter-btn${filter===f.id?" active":""}`}
            onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {filter === "carte" && (
        <LearningMapPage surahs={surahs} learnData={learnData} onNavigate={onNavigate} />
      )}

      {filter === "questions" && (
        <QuestionsModePage surahs={surahs} learnData={learnData} setLData={setLData}
          initialSurahNum={urlSn ? Number(urlSn) : undefined}
          initialRangeFrom={urlRf || undefined}
          initialRangeTo={urlRt || undefined}
          initialQIdx={urlQIdx ? Number(urlQIdx) : 0}
        />
      )}

      {filter !== "questions" && filter !== "carte" && totalLearned === 0 && (
        <div className="rev-empty">
          Aucun ayat appris.<br />
          Marquez des ayats comme appris dans l'onglet CORAN pour les retrouver ici.
        </div>
      )}

      {filter !== "questions" && filter !== "carte" && totalLearned > 0 && filteredSurahNums.length === 0 && (
        <div className="rev-empty">Aucun ayat dans ce filtre.</div>
      )}

      {/* Surah blocks */}
      {(filter !== "questions" && filter !== "carte") && filteredSurahNums.map(sn => {
        const surahInfo  = surahs.find(s => s.number === sn);
        const ayatItems  = filteredBySurah[sn] || [];
        const isOpen     = !!openSurahs[sn];
        const perfectCnt = ayatItems.filter(({ ld }) => getRevStatus(ld) === "perfect").length;
        const pct        = ayatItems.length > 0 ? Math.round((perfectCnt / ayatItems.length) * 100) : 0;

        return (
          <div key={sn} className="rev-surah-block">
            {/* Surah header */}
            <div className="rev-surah-header" onClick={() => toggleSurah(sn)}>
              <div className="rev-surah-num">{sn}</div>
              <div className="rev-surah-name">
                <div className="rev-surah-name-ar">{surahInfo?.name ?? `Sourate ${sn}`}</div>
                <div className="rev-surah-name-en">{surahInfo?.englishName?.toUpperCase() ?? ""}</div>
                <div className="rev-progress-bar" style={{ width: 120, marginTop: 6 }}>
                  <div className="rev-progress-fill" style={{ width:`${pct}%`, background: pct===100?"var(--green)":pct>0?"var(--gold)":"var(--border2)" }} />
                </div>
              </div>
              <div className="rev-surah-badge" style={{ borderColor: pct===100?"var(--green)":"var(--border2)", color: pct===100?"var(--green)":"var(--text3)" }}>
                {perfectCnt}/{ayatItems.length} PARFAIT{perfectCnt!==1?"S":""}
              </div>
              <span style={{ fontSize:12, color:"var(--text3)", marginLeft:4 }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {/* Ayat list */}
            {isOpen && (
              <div className="rev-ayat-grid">
                {ayatItems.map(({ surahNum: sNum, ayatNum: an, ld }) => {
                  const key      = `${sNum}:${an}`;
                  const status   = getRevStatus(ld);
                  const attempts = ld.writingAttempts || [];
                  const best     = attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : null;
                  const isExpanded = openAyat === key;
                  const text     = ayatTexts[key];
                  const ayat     = makeAyat(sNum, an);

                  return (
                    <div key={key} className={`rev-ayat-card${isExpanded?" rev-ayat-active":""}`}>
                      {/* Card header */}
                      <div className="rev-ayat-card-header" onClick={() => toggleAyat(key)}>
                        <div className="rev-ayat-num">{an}</div>
                        <div className="rev-ayat-text-preview">{text || "…"}</div>
                        <div className={`rev-ayat-score-badge ${status}`}>
                          {best !== null ? `${best}%` : statusLabel[status]}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); onNavigate(sNum, an); }}
                          className="btn-small"
                          style={{ fontSize:8, padding:"2px 7px", marginLeft:4, flexShrink:0 }}
                          title="Aller à cet ayat dans le Coran"
                        >↗</button>
                        <span style={{ fontSize:11, color:"var(--text3)", marginLeft:4 }}>{isExpanded?"▲":"▼"}</span>
                      </div>

                      {/* Expanded: tab switcher + exercise */}
                      {isExpanded && (
                        <div className="rev-ayat-body">
                          {/* Tab buttons */}
                          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                            {[["ecriture","✏ RÉVISION"],["tajweed","☪ TAJWEED"]].map(([t,l]) => (
                              <button key={t}
                                onClick={e => { e.stopPropagation(); setAyatTab(p => ({ ...p, [key]: t })); }}
                                style={{ padding:"4px 12px", fontSize:8, letterSpacing:1, fontFamily:"'Cinzel',serif",
                                  cursor:"pointer", borderRadius:6, border:"none",
                                  borderBottom:"2px solid " + ((ayatTab[key]||"ecriture")===t ? "var(--teal)" : "transparent"),
                                  background:(ayatTab[key]||"ecriture")===t ? "rgba(62,184,160,.1)" : "transparent",
                                  color:(ayatTab[key]||"ecriture")===t ? "var(--teal2)" : "var(--text3)",
                                  transition:"all .15s" }}>
                                {l}
                              </button>
                            ))}
                          </div>
                          {text
                            ? <div className="rev-ayat-arabic">{text}</div>
                            : <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>Chargement…</div>
                          }
                          {text && (ayatTab[key]||"ecriture") === "ecriture" && (
                            <RevisionEcritureMode
                              ayat={ayat}
                              surahNum={sNum}
                              ld={ld}
                              setLData={setLData}
                            />
                          )}
                          {text && (ayatTab[key]||"ecriture") === "tajweed" && (
                            <TajweedExercice ayat={ayat} />
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
      })}
    </div>
  );
}

// ─── MemoriseMode ─────────────────────────────────────────────────────────────
// Mastery helpers (exported so surah list can use them)
// Non-letter Quranic marks that must never count as a "letter" for mastery:
// waqf/pause signs, sajda place marker, rub-el-hizb marker, end-of-ayah marker,
// small Quranic annotation ligatures (U+06D6–U+06ED), Arabic-Indic digits
// (juz/hizb/ayah numerals) and ornate ayah-number parentheses.
const QURAN_NON_LETTER_RE = /[\u06D6-\u06ED\u0660-\u0669\u06F0-\u06F9\uFD3E\uFD3F]/;

// Split Arabic text into grapheme clusters (letter + harakat), skipping
// non-letter Quranic annotation marks (juz/hizb/sajda/pause/etc.) entirely —
// they neither form their own cluster nor attach to a neighbouring letter.
function splitArabicClusters(text) {
  if (!text) return [];
  const clusters = [];
  const base = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const diac = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/;
  let cur = '';
  for (const ch of text) {
    if (QURAN_NON_LETTER_RE.test(ch)) { continue; } // ignore entirely — not a letter or harakat
    if (ch === ' ') { if (cur) { clusters.push(cur); cur = ''; } }
    else if (base.test(ch)) { if (cur) clusters.push(cur); cur = ch; }
    else if (diac.test(ch) && cur) { cur += ch; }
    else { if (cur) clusters.push(cur); cur = ch; }
  }
  if (cur) clusters.push(cur);
  return clusters;
}

function computeMastery(ld, ayatText) {
  const toRevise    = ld?.toRevise;
  const words       = ayatText ? ayatText.split(' ').filter(Boolean) : [];
  const totalLetters = words.reduce((s, w) => s + splitArabicClusters(w).length, 0);

  if (totalLetters === 0) return 0;

  let reviseLetters = 0;
  if (toRevise === true) {
    reviseLetters = totalLetters;
  } else if (toRevise && typeof toRevise === 'object') {
    const chars    = toRevise.chars   || {};
    const revWords = toRevise.words   || [];
    reviseLetters += Object.values(chars).reduce((s, arr) => s + arr.length, 0);
    revWords.forEach(wi => {
      if (!chars[wi] && words[wi]) reviseLetters += splitArabicClusters(words[wi]).length;
    });
  }

  const knownLetters = Math.max(0, totalLetters - reviseLetters);
  return Math.round(knownLetters / totalLetters * 100);
}

function masteryColor(pct) {
  if (pct >= 80) return 'var(--green)';
  if (pct >= 50) return 'var(--gold)';
  if (pct > 0)   return 'var(--teal2)';
  return 'var(--border2)';
}

function MasteryBar({ pct, size = 'sm' }) {
  const h = size === 'sm' ? 3 : 5;
  return (
    <div style={{ width:'100%', height:h, background:'var(--surface3)', borderRadius:h, overflow:'hidden' }}>
      <div style={{ height:'100%', width:pct+'%', background:masteryColor(pct), borderRadius:h, transition:'width .4s' }} />
    </div>
  );
}

function MasteryBadge({ pct }) {
  return (
    <span style={{ fontSize:8, letterSpacing:1, padding:'2px 7px', borderRadius:10,
      border:'1px solid '+masteryColor(pct), color:masteryColor(pct),
      fontFamily:"'Cinzel',serif", flexShrink:0 }}>
      {pct}%
    </span>
  );
}

function MasteryDebug({ ld, ayatText }) {
  const [open, setOpen] = React.useState(false);
  if (!ld) return null;

  const toRevise     = ld.toRevise;
  const words        = ayatText ? ayatText.split(' ').filter(Boolean) : [];
  const totalLetters = words.reduce((s, w) => s + splitArabicClusters(w).length, 0);

  let reviseLetters = 0;
  if (toRevise === true) {
    reviseLetters = totalLetters;
  } else if (toRevise && typeof toRevise === 'object') {
    const chars    = toRevise.chars   || {};
    const revWords = toRevise.words   || [];
    reviseLetters += Object.values(chars).reduce((s, arr) => s + arr.length, 0);
    revWords.forEach(wi => { if (!chars[wi] && words[wi]) reviseLetters += splitArabicClusters(words[wi]).length; });
  }

  const knownLetters = Math.max(0, totalLetters - reviseLetters);
  const mastery      = totalLetters > 0 ? Math.round(knownLetters / totalLetters * 100) : 0;

  const rows = [
    { label:'📝 Lettres totales',     val: `${totalLetters}`,                                          color:'var(--text2)' },
    { label:'🔖 Lettres à réviser',   val: `${reviseLetters}`,                                         color: reviseLetters > 0 ? '#ff7eb3' : 'var(--text3)' },
    { label:'✅ Lettres connues',     val: `${knownLetters}`,                                           color:'var(--teal2)' },
    { label:'🎯 MAÎTRISE',            val: `${knownLetters} / ${totalLetters} = ${mastery}%`,           color: masteryColor(mastery), bold: true },
  ];

  return (
    <div style={{ marginTop:6 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ fontSize:7, letterSpacing:1.5, padding:'3px 10px', borderRadius:6, cursor:'pointer',
          fontFamily:"'Cinzel',serif", background:'transparent',
          border:`1px solid ${open ? masteryColor(mastery) : 'rgba(255,255,255,.1)'}`,
          color: open ? masteryColor(mastery) : 'var(--text3)', transition:'all .2s' }}>
        🔬 DEBUG MAÎTRISE {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{ marginTop:6, background:'var(--surface2)', border:'1px solid var(--border)',
          borderRadius:9, overflow:'hidden', fontSize:8 }}>
          {rows.map(({ label, val, color, bold }) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'6px 12px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <span style={{ color:'var(--text3)', letterSpacing:.5 }}>{label}</span>
              <span style={{ color, fontWeight: bold ? 700 : 400, fontFamily: bold ? "'Cinzel',serif" : 'inherit',
                fontSize: bold ? 11 : 8 }}>{val}</span>
            </div>
          ))}
          <div style={{ padding:'8px 12px' }}>
            <MasteryBar pct={mastery} size="lg" />
          </div>
        </div>
      )}
    </div>
  );
}


// ─── TextAnswerInput ─────────────────────────────────────────────
// Text input widget for QuestionsMode non-reconstruct questions.
// - User types their answer in Arabic (or any text)
// - On submit: auto-grades by comparing normalised strings
// - Shows diff word by word on wrong answer
// - onReveal(true|false|null): passes auto-grade result; null = user skipped
function TextAnswerInput({ q, onReveal }) {
  const { activeInput } = useArabicKeyboard();
  const [value,    setValue]    = React.useState('');
  const [graded,   setGraded]   = React.useState(null); // null | true | false
  const [diffWords, setDiffWords] = React.useState(null); // [{word, correct}]
  const inputRef = React.useRef(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    if (!value.trim()) { onReveal(null); return; }
    const userNorm = normalizeArabic(value.trim());
    const corrNorm = normalizeArabic(q.answer.trim());
    const correct  = userNorm === corrNorm;
    // Build word-level diff for wrong answers
    if (!correct) {
      const userWords = value.trim().split(/\s+/);
      const corrWords = q.answer.trim().split(/\s+/);
      const diff = corrWords.map((w, i) => ({
        word: w,
        correct: i < userWords.length && normalizeArabic(userWords[i]) === normalizeArabic(w),
      }));
      setDiffWords(diff);
    }
    setGraded(correct);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (graded === null) submit(); }
  };

  const borderColor = graded === true  ? 'var(--green)'
                    : graded === false ? 'var(--red)'
                    : 'var(--border)';

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:10 }}>
      {/* Input field */}
      <div style={{ position:'relative' }}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => { if (graded === null) setValue(e.target.value); }}
          onKeyDown={handleKey}
          disabled={graded !== null}
          placeholder="كتب إجابتك…"
          rows={2}
          onFocus={e => { if (activeInput) activeInput.current = e.target; }}
          style={{
            width:'100%', boxSizing:'border-box',
            padding:'10px 12px', fontSize:18,
            fontFamily:"'Amiri Quran',serif",
            direction:'rtl', textAlign:'right',
            background:'var(--surface3)',
            border:'1.5px solid ' + borderColor,
            borderRadius:10, color:'var(--text)',
            resize:'none', outline:'none',
            transition:'border-color .25s',
            lineHeight:1.8,
          }}
        />
        {graded !== null && (
          <div style={{ position:'absolute', top:8, left:10, fontSize:16,
            color: graded ? 'var(--green)' : 'var(--red)' }}>
            {graded ? '✓' : '✗'}
          </div>
        )}
      </div>

      {/* Word-level diff on wrong answer */}
      {graded === false && diffWords && (
        <div style={{ padding:'8px 12px', background:'rgba(224,90,90,.06)',
          border:'1px solid var(--red)', borderRadius:8, direction:'rtl' }}>
          <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)',
            direction:'ltr', marginBottom:6 }}>MOT PAR MOT</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
            {diffWords.map((d, i) => (
              <span key={i} style={{
                fontFamily:"'Amiri Quran',serif", fontSize:16,
                padding:'2px 8px', borderRadius:6,
                background: d.correct ? 'rgba(76,175,129,.18)' : 'rgba(224,90,90,.18)',
                border:'1px solid ' + (d.correct ? 'var(--green)' : 'var(--red)'),
                color:'var(--text)',
              }}>{d.word}</span>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {graded === null ? (
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => onReveal(null)}
            style={{ padding:'7px 14px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:'transparent', border:'1px solid var(--border2)', color:'var(--text3)',
              borderRadius:8, cursor:'pointer' }}>
            👁 VOIR
          </button>
          <button onClick={submit} disabled={!value.trim()}
            style={{ flex:1, padding:'9px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background: value.trim() ? 'rgba(201,168,76,.12)' : 'transparent',
              border:'1px solid ' + (value.trim() ? 'var(--gold)' : 'var(--border2)'),
              color: value.trim() ? 'var(--gold2)' : 'var(--text3)',
              borderRadius:8, cursor: value.trim() ? 'pointer' : 'default', transition:'all .2s' }}>
            VALIDER
          </button>
        </div>
      ) : (
        <button onClick={() => onReveal(graded)}
          style={{ padding:'9px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
            background: graded ? 'rgba(76,175,129,.12)' : 'rgba(224,90,90,.08)',
            border:'1px solid ' + (graded ? 'var(--green)' : 'var(--red)'),
            color: graded ? 'var(--green)' : 'var(--red)',
            borderRadius:8, cursor:'pointer', width:'100%' }}>
          {graded ? '✓ CORRECT — VOIR LE VERSET' : '✗ INCORRECT — VOIR LE VERSET'}
        </button>
      )}
    </div>
  );
}


// ─── Arabic word categorizer for ReconstructQuestion ─────────────────────────
// Returns a category label for each Arabic word (approximate, pattern-based).
const ARABIC_WORD_CATS = (() => {
  const n = (s) => {
    if (!s) return '';
    return s
      .replace(/[ٱأإآؤئءٔ]/g, 'ا')   // alef variants
      .replace(/ی/g, 'ي')
      .replace(/[\u0670\u0640]/g, '')  // dagger alef + tatweel
      .replace(/[ـً-ٟؐ-ؚۖ-ۭ\u0870-\u08FF\uFE70-\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Divine names / Allah set
  const ALLAH = new Set(['الله','الرحمن','الرحيم','الملك','القدوس','السلام','المؤمن','المهيمن','العزيز','الجبار','المتكبر','الخالق','البارئ','المصور','الغفور','القهار','ربك','ربه','ربنا','ربكم','إلهكم','إلهنا','إلههم']);

  // Proper nouns — all names of persons, peoples, places, books, angels cited in the Quran
  // Each entry in its base form; normalize() handles diacritics/alef variants at match time
  const PROPER = new Set([
    // ── Prophets (25 named in Quran) ──
    'آدم','ادريس','نوح','هود','صالح','ابراهيم','لوط','اسماعيل','اسحاق','يعقوب',
    'يوسف','شعيب','موسى','هارون','داود','سليمان','ايوب','يونس','ذوالكفل',
    'الياس','اليسع','زكريا','يحيى','عيسى','محمد','احمد',
    // ── Other Quranic persons ──
    'مريم','عمران','فرعون','هامان','قارون','جالوت','طالوت','لقمان',
    'ذوالقرنين','العزيز','ادريس','خضر','ابليس','عزير','لقمان',
    'حابيل','قابيل','اليسع','ارم','عاد','ثمود',
    // ── Angels ──
    'جبريل','جبرائيل','ميكائيل','ميكال','اسرافيل','هاروت','ماروت','مالك',
    // ── Peoples / tribes ──
    'اسرائيل','يهود','نصارى','قريش','اعراب','اصحاب','فرعون',
    'عاد','ثمود','مدين','سبا','ياجوج','ماجوج',
    // ── Places ──
    'مكة','بكة','مدينة','يثرب','طور','سيناء','بابل','مصر','الاحقاف',
    'الرس','ايكة','حجر','بدر','حنين','الاحزاب','تبوك',
    // ── Revealed books ──
    'توراة','انجيل','زبور','صحف',
    // ── Surahs referenced by name in Quran ──
    'الفرقان',
  ]);

  // Pronouns
  const PRON = new Set(['هو','هي','هم','هن','أنت','أنتم','أنتن','نحن','انا','انا','هما','هما','انتما']);

  // Particles / prepositions / conjunctions / negations
  const PART = new Set(['في','من','إلى','على','عن','ب','ل','ك','و','ف','ثم','أن','أنّ','إن','إنّ','ان','ان','لا','ما','لن','لم','لما','إذا','اذا','إذ','اذ','حتى','كي','لكي','قد','سوف','س','هل','أم','أو','ام','بل','لو','لولا','ولو','كم','الذي','التي','الذين','اللواتي','ماذا','متى','كيف','اين','أين','لماذا','عند','مع','بين','دون','تحت','فوق','خلف','امام','وراء','حول','وسط','غير','سوى','إلا','الا','ليس','لكن','لكنّ','لكن','اما','إما','حين','عندما','بعد','قبل','منذ']);

  // Pre-normalize all sets so classify(w) matches normalized input
  const ALLAH_N  = new Set([...ALLAH].map(n));
  const PROPER_N = new Set([...PROPER].map(n));
  // Also build sorted array by length desc for prefix matching
  const PROPER_LIST = [...PROPER_N].sort((a,b) => b.length - a.length);
  const PRON_N   = new Set([...PRON].map(n));
  const PART_N   = new Set([...PART].map(n));

  const isProperNoun = (w) => {
    if (PROPER_N.has(w)) return true;
    // Strip definite article and check
    const wNoAl = w.startsWith('ال') ? w.slice(2) : w;
    if (PROPER_N.has(wNoAl)) return true;
    // Strip vocative prefix يا (appears as يا or merged as first letters يا/يا)
    const wNoYa = w.startsWith('يا') ? w.slice(2) : w.startsWith('يـا') ? w.slice(3) : w;
    if (wNoYa !== w && PROPER_N.has(wNoYa)) return true;
    const wNoYaNoAl = wNoYa.startsWith('ال') ? wNoYa.slice(2) : wNoYa;
    if (wNoYaNoAl !== wNoYa && PROPER_N.has(wNoYaNoAl)) return true;
    // Check if word starts with a proper noun (handles case suffixes like تان، ين، ون)
    for (const p of PROPER_LIST) {
      if (p.length >= 3 && w.startsWith(p) && (w.length - p.length) <= 3) return true;
      if (p.length >= 3 && wNoAl.startsWith(p) && (wNoAl.length - p.length) <= 3) return true;
      if (p.length >= 3 && wNoYa.startsWith(p) && (wNoYa.length - p.length) <= 3) return true;
    }
    return false;
  };

  const classify = (rawWord) => {
    const w = n(rawWord);
    if (!w) return 'autre';

    // Allah / divine names first
    if (ALLAH_N.has(w) || w === 'الله') return 'allah';

    // Proper nouns (before other noun rules)
    if (isProperNoun(w)) return 'propre';

    // Pronouns
    if (PRON_N.has(w)) return 'pronom';

    // Particles (single letter or known set)
    if (PART_N.has(w) || (w.length === 1 && /[فوبلك]/.test(w))) return 'particule';

    // Verb detection: starts with ي / ت / ن / ا (أ normalized) (mudari') or matches madi pattern
    // Strip object pronoun suffixes before testing: هم،هن،ها،كم،كن،نا،ني،ك،ه
    const wNoSuffix = w.replace(/(هم|هن|ها|كم|كن|نا|ني|وا|ك|ه)$/, '');
    const verbRe = /^[يتن][ا-يء-غ]{2,9}$/;
    const verbReA = /^[ا][ن][ا-يء-غ]{1,7}$/; // أَن... imperative/form IV
    if (!w.startsWith('ال') && (verbRe.test(wNoSuffix) || verbRe.test(w) || verbReA.test(wNoSuffix) || verbReA.test(w))) return 'verbe';
    if (!w.startsWith('ال') && w.length === 3) return 'verbe';
    if (!w.startsWith('ال') && !/^[يتناأ]/.test(w)) {
      const madiM = w.match(/(تم|تن|تما|تا|نا|وا|ت)$/);
      if (madiM && (w.length - madiM[0].length) >= 2) return 'verbe';
    }
    // Words with definite article ال = noun
    if (w.startsWith('ال')) return 'nom';

    // Tanwin endings (indefinite nouns): ان، ون، ين
    if (/[ان]$/.test(w) || w.endsWith('ون') || w.endsWith('ين')) return 'nom';

    // Masdar / noun patterns: فِعَال، فُعُول، فَاعِل، مَفْعُول
    if (/^[مف]/.test(w) && w.length >= 4) return 'nom';

    // Default: if longer word, treat as noun; short = particule
    return w.length <= 2 ? 'particule' : 'nom';
  };

  return { classify };
})();

const Q_CAT_LABELS = {
  allah:    { label: 'الله',   color: 'rgba(201,168,76,.18)',   border: 'var(--gold)',   text: 'var(--gold2)' },
  propre:   { label: 'أعلام',  color: 'rgba(100,160,255,.16)',  border: '#64a0ff',       text: '#64a0ff' },
  verbe:    { label: 'أفعال',  color: 'rgba(62,184,160,.14)',   border: 'var(--teal)',   text: 'var(--teal2)' },
  nom:      { label: 'أسماء',  color: 'rgba(111,207,154,.14)',  border: 'var(--green)',  text: 'var(--green)' },
  pronom:   { label: 'ضمائر',  color: 'rgba(200,120,255,.14)',  border: '#c878ff',       text: '#c878ff' },
  particule:{ label: 'حروف',   color: 'rgba(224,90,90,.12)',    border: 'var(--red)',    text: 'var(--red)' },
  autre:    { label: 'أخرى',   color: 'var(--surface3)',        border: 'var(--border2)',text: 'var(--text3)' },
};

// ─── ReconstructQuestion ───────────────────
function ReconstructQuestion({ q, ayatTexts, selectedSn, onAnswer }) {
  const pool = React.useMemo(() => {
    const real = [...q.words];
    const impostorCandidates = [];
    Object.entries(ayatTexts).forEach(([k, txt]) => {
      if (!k.startsWith(selectedSn + ':')) return;
      const num = parseInt(k.split(':')[1]);
      if (num === q.ayatNum) return;
      splitArabicWords(txt).forEach(w => {
        if (!real.includes(w)) impostorCandidates.push(w);
      });
    });
    const impostorCount = Math.min(8, Math.max(2, Math.round(real.length * 0.4)));
    const impostors = [...impostorCandidates].sort(() => Math.random() - 0.5).slice(0, impostorCount);
    return [...real, ...impostors].sort(() => Math.random() - 0.5);
  }, [q.ayatNum]);

  // Classify each pool word and group by category
  const poolByCategory = React.useMemo(() => {
    const realSet = new Set(q.words);
    const groups = {};
    pool.forEach((word, idx) => {
      const cat = ARABIC_WORD_CATS.classify(word);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ word, idx, isReal: realSet.has(word) });
    });
    const ORDER = ['allah', 'propre', 'verbe', 'nom', 'pronom', 'particule', 'autre'];
    return ORDER.filter(c => groups[c]).map(c => ({ cat: c, items: groups[c] }));
  }, [pool]);

  const [picked,     setPicked]     = React.useState([]);
  const [graded,     setGraded]     = React.useState(null);
  const [shake,      setShake]      = React.useState(false);
  const [poolSearch, setPoolSearch] = React.useState('');
  // Cursor = insertion position (0 = before first word, picked.length = after last)
  const [cursor, setCursor] = React.useState(0);

  // Per-position status after grading
  const wordStatuses = React.useMemo(() => {
    if (graded === null) return null;
    return picked.map((poolIdx, pos) => {
      if (pos >= q.words.length) return 'extra';
      return normalizeArabic(pool[poolIdx]) === normalizeArabic(q.words[pos]) ? 'correct' : 'wrong';
    });
  }, [graded, picked, pool]);

  // Per-pool-index status after grading
  const poolStatuses = React.useMemo(() => {
    if (graded === null) return {};
    const m = {};
    picked.forEach((poolIdx, pos) => {
      m[poolIdx] = pos < q.words.length && normalizeArabic(pool[poolIdx]) === normalizeArabic(q.words[pos]) ? 'correct' : 'wrong';
    });
    return m;
  }, [graded, picked]);

  // Insert word at cursor position
  const pickWord = (idx) => {
    if (graded !== null || picked.includes(idx)) return;
    setPicked(p => { const n = [...p]; n.splice(cursor, 0, idx); return n; });
    setCursor(c => c + 1);
  };
  // Remove word at pos, move cursor there
  const unpick = (pos) => {
    if (graded !== null) return;
    setPicked(p => p.filter((_, i) => i !== pos));
    setCursor(pos);
  };
  // Click placed word sets cursor after it (for insertion next to it)
  const moveCursor = (pos) => {
    if (graded !== null) return;
    setCursor(pos + 1);
  };
  const submit = () => {
    if (graded !== null) return;
    const composed = picked.map(i => pool[i]).join(' ').trim();
    const correct = normalizeArabic(composed) === normalizeArabic(q.answer.trim());
    setGraded(correct);
    if (!correct) { setShake(true); setTimeout(() => setShake(false), 600); }
  };
  const reset = () => { setPicked([]); setGraded(null); setShake(false); setCursor(0); };

  const isComplete = picked.length === q.words.length;
  const borderColor = graded === true ? 'var(--green)' : graded === false ? 'var(--red)' : 'var(--border)';

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:12 }}>

      {/* Composition zone — coloured per-word after grading */}
      <div style={{ minHeight:60, padding:'10px 12px', background:'var(--surface3)',
        borderRadius:10, border:'1.5px solid ' + borderColor,
        direction:'rtl', display:'flex', flexWrap:'wrap', alignItems:'center', gap:6,
        transition:'border-color .3s', animation: shake ? 'shake .5s' : 'none' }}>
        {picked.length === 0 ? (
          <React.Fragment>
            {graded === null && (
              <span style={{ display:'inline-block', width:2, height:22, background:'var(--teal)',
                borderRadius:1, animation:'blink 1s step-end infinite', verticalAlign:'middle', marginLeft:2 }} />
            )}
            <span style={{ fontSize:9, color:'var(--text3)', letterSpacing:1, direction:'ltr', marginRight:6 }}>
              Tape les mots dans l&apos;ordre…
            </span>
          </React.Fragment>
        ) : (
          <React.Fragment>
            {/* Cursor at position 0 */}
            {graded === null && cursor === 0 && (
              <span style={{ display:'inline-block', width:2, height:22, background:'var(--teal)',
                borderRadius:1, animation:'blink 1s step-end infinite', verticalAlign:'middle' }} />
            )}
            {picked.map((poolIdx, pos) => {
              const status = wordStatuses?.[pos];
              const bg   = status === 'correct' ? 'rgba(76,175,129,.22)'
                         : status              ? 'rgba(224,90,90,.22)'
                         : 'rgba(62,184,160,.18)';
              const bord = status === 'correct' ? '1px solid var(--green)'
                         : status              ? '1px solid var(--red)'
                         : '1px solid var(--teal2)';
              const icon = status === 'correct' ? ' ✓' : status ? ' ✗' : '';
              return (
                <React.Fragment key={pos}>
                  <span
                    onClick={() => { if (graded === null) { cursor === pos + 1 ? unpick(pos) : moveCursor(pos); } }}
                    title={graded === null ? (cursor === pos + 1 ? 'Cliquer pour retirer' : 'Cliquer pour placer ici') : ''}
                    style={{ fontFamily:"'Amiri Quran',serif", fontSize:18, padding:'3px 10px',
                      borderRadius:7, border:bord, background:bg, color:'var(--text)',
                      cursor: graded === null ? 'pointer' : 'default', transition:'all .2s',
                      outline: graded === null && cursor === pos + 1 ? '2px solid var(--teal)' : 'none' }}>
                    {pool[poolIdx]}
                    {icon && <sup style={{ fontSize:10, marginRight:2,
                      color: status === 'correct' ? 'var(--green)' : 'var(--red)' }}>{icon}</sup>}
                  </span>
                  {/* Cursor after this word */}
                  {graded === null && cursor === pos + 1 && (
                    <span style={{ display:'inline-block', width:2, height:22, background:'var(--teal)',
                      borderRadius:1, animation:'blink 1s step-end infinite', verticalAlign:'middle' }} />
                  )}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        )}
      </div>

      {/* Word pool — categorized always; labels + status colors only after grading */}
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {/* Search bar (before grading only) */}
        {graded === null && (
          <div style={{ position:'relative' }}>
            <input
              value={poolSearch}
              onChange={e => setPoolSearch(e.target.value)}
              placeholder="بحث…"
              style={{ width:'100%', boxSizing:'border-box',
                padding:'7px 30px 7px 10px', fontSize:15,
                fontFamily:"'Amiri Quran',serif", direction:'rtl',
                background:'var(--surface3)', border:'1px solid var(--border2)',
                borderRadius:8, color:'var(--text)', outline:'none' }}
            />
            {poolSearch && (
              <button onClick={() => setPoolSearch('')}
                style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', color:'var(--text3)',
                  fontSize:12, cursor:'pointer', padding:0, lineHeight:1 }}>✕</button>
            )}
          </div>
        )}
        {poolByCategory.filter(({ cat }) => cat !== 'autre').map(({ cat, items }) => {
          const meta = Q_CAT_LABELS[cat] || Q_CAT_LABELS.autre;
          const visibleItems = items.filter(({ word }) =>
            !poolSearch || normalizeArabic(word).includes(normalizeArabic(poolSearch))
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={cat}>
              {/* Category label — always shown */}
              <div style={{ fontSize:7, letterSpacing:2,
                color: graded !== null ? meta.text : 'var(--text3)', opacity: graded !== null ? .85 : .5,
                fontFamily:"'Cinzel',serif", marginBottom:3, paddingRight:4,
                textAlign:'right', direction:'rtl', transition:'color .3s' }}>
                {meta.label}
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4, direction:'rtl' }}>
                {visibleItems.map(({ word, idx, isReal }) => {
                  const used      = picked.includes(idx);
                  const status    = graded !== null ? poolStatuses[idx] : null;
                  const isMissing = graded === false && !used && isReal;
                  // Before grading: uniform teal style. After: coloured by status.
                  const bg   = graded === null
                    ? (used ? 'var(--surface3)' : meta.color)
                    : status === 'correct' ? 'rgba(76,175,129,.18)'
                    : status === 'wrong'   ? 'rgba(224,90,90,.15)'
                    : isMissing            ? 'rgba(201,168,76,.15)'
                    : used                 ? 'var(--surface3)'
                    : meta.color;
                  const bord = graded === null
                    ? (used ? 'var(--border2)' : meta.border)
                    : status === 'correct' ? 'var(--green)'
                    : status === 'wrong'   ? 'var(--red)'
                    : isMissing            ? 'var(--gold)'
                    : used                 ? 'var(--border2)'
                    : meta.border;
                  return (
                    <button key={idx}
                      onClick={() => pickWord(idx)}
                      disabled={used || graded !== null}
                      style={{ fontFamily:"'Amiri Quran',serif", fontSize:17, padding:'5px 12px',
                        borderRadius:8, border:'1px solid ' + bord, background:bg,
                        color:'var(--text)',
                        opacity: used && graded === null ? 0.3 : used && !status ? 0.3 : 1,
                        cursor: used || graded !== null ? 'default' : 'pointer',
                        direction:'rtl', transition:'all .2s',
                        boxShadow: isMissing ? '0 0 0 2px rgba(201,168,76,.3)' : 'none' }}>
                      {word}
                      {isMissing && <sup style={{ fontSize:9, color:'var(--gold)', marginRight:2 }}> ✕</sup>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {/* Impostors (autre) — shown ungrouped, no label, muted */}
        {(() => {
          const autreGroup = poolByCategory.find(({ cat }) => cat === 'autre');
          if (!autreGroup) return null;
          const visibleItems = autreGroup.items.filter(({ word }) =>
            !poolSearch || normalizeArabic(word).includes(normalizeArabic(poolSearch))
          );
          if (visibleItems.length === 0) return null;
          return (
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, direction:'rtl', opacity:.7 }}>
              {visibleItems.map(({ word, idx }) => {
                const used   = picked.includes(idx);
                const status = graded !== null ? poolStatuses[idx] : null;
                const bg   = graded === null
                  ? (used ? 'var(--surface3)' : 'rgba(62,184,160,.10)')
                  : status === 'correct' ? 'rgba(76,175,129,.18)'
                  : status === 'wrong'   ? 'rgba(224,90,90,.15)'
                  : used ? 'var(--surface3)' : 'rgba(62,184,160,.10)';
                const bord = graded === null
                  ? (used ? 'var(--border2)' : 'var(--teal)')
                  : status === 'correct' ? 'var(--green)'
                  : status === 'wrong'   ? 'var(--red)'
                  : used ? 'var(--border2)' : 'var(--teal)';
                return (
                  <button key={idx} onClick={() => pickWord(idx)}
                    disabled={used || graded !== null}
                    style={{ fontFamily:"'Amiri Quran',serif", fontSize:17, padding:'5px 12px',
                      borderRadius:8, border:'1px solid ' + bord, background:bg,
                      color:'var(--text)', opacity: used ? 0.25 : 1,
                      cursor: used || graded !== null ? 'default' : 'pointer',
                      direction:'rtl', transition:'all .2s' }}>
                    {word}
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Correct order — shown only on wrong answer */}
      {graded === false && (
        <div style={{ padding:'8px 12px', background:'rgba(201,168,76,.07)',
          border:'1px solid var(--gold)', borderRadius:8, direction:'rtl' }}>
          <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)',
            direction:'ltr', marginBottom:6 }}>ORDRE CORRECT</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
            {q.words.map((w, i) => {
              const userWord = picked[i] !== undefined ? pool[picked[i]] : null;
              const ok = userWord != null && normalizeArabic(userWord) === normalizeArabic(w);
              return (
                <span key={i} style={{ fontFamily:"'Amiri Quran',serif", fontSize:17,
                  padding:'3px 10px', borderRadius:7,
                  background: ok ? 'rgba(76,175,129,.15)' : 'rgba(201,168,76,.18)',
                  border:'1px solid ' + (ok ? 'var(--green)' : 'var(--gold)'),
                  color:'var(--text)' }}>
                  {w}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {graded === null ? (
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={reset} disabled={picked.length === 0}
            style={{ padding:'7px 14px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:'transparent', border:'1px solid var(--border2)', color:'var(--text3)',
              borderRadius:8, cursor:'pointer', opacity: picked.length===0 ? 0.4 : 1 }}>
            ↺
          </button>
          <button onClick={submit} disabled={!isComplete}
            style={{ flex:1, padding:'9px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background: isComplete ? 'rgba(201,168,76,.12)' : 'transparent',
              border:'1px solid ' + (isComplete ? 'var(--gold)' : 'var(--border2)'),
              color: isComplete ? 'var(--gold2)' : 'var(--text3)',
              borderRadius:8, cursor: isComplete ? 'pointer' : 'default', transition:'all .2s' }}>
            VALIDER ({picked.length}/{q.words.length})
          </button>
        </div>
      ) : (
        <div style={{ display:'flex', gap:8 }}>
          {!graded && (
            <button onClick={reset}
              style={{ padding:'7px 14px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                background:'transparent', border:'1px solid var(--teal)', color:'var(--teal)',
                borderRadius:8, cursor:'pointer' }}>
              ↺ RÉESSAYER
            </button>
          )}
          <button onClick={() => onAnswer(graded)}
            style={{ flex:1, padding:'9px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background: graded ? 'rgba(76,175,129,.12)' : 'rgba(224,90,90,.08)',
              border:'1px solid ' + (graded ? 'var(--green)' : 'var(--red)'),
              color: graded ? 'var(--green)' : 'var(--red)',
              borderRadius:8, cursor:'pointer' }}>
            SUIVANT →
          </button>
        </div>
      )}
    </div>
  );
}
// ─── QAyatPlayer ──────────────────────────────────────────────────────────────
// Interactive ayat display for QuestionsMode:
// - Letter-by-letter highlight driven by local RAF currentMs
// - Click word → play from that word's timestamp
// - Parts shown as colored chips → click to play that range
// - Full-ayat play/pause button
function QAyatPlayer({ ayatText, timestamps, parts, audioUrl, learnData }) {
  const [currentMs,  setCurrentMs]  = React.useState(0);
  const [isPlaying,  setIsPlaying]  = React.useState(false);
  const [rangeEnd,   setRangeEnd]   = React.useState(null);  // ms — null = play to end
  const [rangeStart, setRangeStart] = React.useState(null);
  const audioRef = React.useRef(null);
  const rafRef   = React.useRef(null);
  const containerRef = React.useRef(null);

  const PART_COLORS  = ["rgba(201,168,76,.22)","rgba(62,184,160,.18)","rgba(111,207,154,.18)","rgba(224,90,90,.15)","rgba(200,120,255,.15)"];
  const PART_BORDERS = ["var(--gold)","var(--teal)","var(--green)","var(--red)","#c878ff"];

  // RAF loop — updates char highlight via DOM
  const startRaf = () => {
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      const ms = a.currentTime * 1000;
      setCurrentMs(ms);
      // Apply highlight via DOM
      if (containerRef.current && timestamps?.words) {
        const spans = containerRef.current.querySelectorAll('.char-span');
        let si = 0;
        timestamps.words.forEach(word => {
          const chars = fixChars(word.chars || []);
          chars.forEach(c => {
            if (si < spans.length) {
              const active = ms >= c.start && ms <= c.end;
              const done   = ms > c.end && ms > 0 && (rangeStart == null || c.end > rangeStart);
              const el = spans[si];
              if (active) { el.classList.add('char-active'); el.classList.remove('char-done'); }
              else if (done) { el.classList.add('char-done'); el.classList.remove('char-active'); }
              else { el.classList.remove('char-active','char-done'); }
              si++;
            }
          });
        });
      }
      // Stop at range end
      if (rangeEnd !== null && ms >= rangeEnd) {
        a.pause();
        setIsPlaying(false);
        setRangeEnd(null);
        setRangeStart(null);
        cancelAnimationFrame(rafRef.current);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopRaf = () => { cancelAnimationFrame(rafRef.current); };

  // Clear highlight
  const clearHighlight = () => {
    if (containerRef.current) {
      containerRef.current.querySelectorAll('.char-span').forEach(el => {
        el.classList.remove('char-active','char-done');
      });
    }
  };

  React.useEffect(() => () => { stopRaf(); audioRef.current?.pause(); }, []);

  // Play from a specific time, with optional end time
  const playFrom = (startMs, endMs = null) => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    if (a.src !== audioUrl) a.src = audioUrl;
    a.currentTime = startMs / 1000;
    setRangeEnd(endMs);
    setRangeStart(startMs);
    a.play().then(() => { setIsPlaying(true); startRaf(); }).catch(() => {});
  };

  const toggleFull = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause(); setIsPlaying(false); stopRaf();
    } else {
      playFrom(0, null);
    }
  };

  // Click a word → play from that word's start to word's end
  const onWordClick = (wi) => {
    if (!timestamps?.words?.[wi]) return;
    const word = timestamps.words[wi];
    const chars = fixChars(word.chars || []);
    if (!chars.length) return;
    const startMs = chars[0].start;
    const endMs   = chars[chars.length - 1].end;
    playFrom(startMs, endMs);
  };

  // Click a part → play its word range
  const onPartClick = (part) => {
    if (!timestamps?.words || !part.wordIndices?.length) return;
    const firstW = timestamps.words[part.wordIndices[0]];
    const lastW  = timestamps.words[part.wordIndices[part.wordIndices.length - 1]];
    if (!firstW || !lastW) return;
    const firstChars = fixChars(firstW.chars || []);
    const lastChars  = fixChars(lastW.chars || []);
    if (!firstChars.length || !lastChars.length) return;
    playFrom(firstChars[0].start, lastChars[lastChars.length - 1].end);
  };

  // Build word-to-part map
  const wordPartMap = {};
  (parts || []).forEach((p, pi) => p.wordIndices?.forEach(wi => { wordPartMap[wi] = pi; }));

  const hasTs = !!timestamps?.words;
  const hasParts = (parts || []).length > 0;

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:10 }}>
      <audio ref={audioRef} style={{ display:'none' }}
        onEnded={() => { setIsPlaying(false); setRangeEnd(null); setRangeStart(null); stopRaf(); clearHighlight(); }}
        onPause={() => { if (!audioRef.current?.ended) { setIsPlaying(false); stopRaf(); } }}
      />

      {/* Arabic text + optional play button */}
      <div style={{ padding:'12px 14px', background:'var(--surface3)', borderRadius:10,
        border:'1px solid var(--border2)', direction:'rtl', textAlign:'right',
        position:'relative' }}>
        {/* Play/pause full ayat */}
        {audioUrl && (
          <button onClick={toggleFull}
            style={{ position:'absolute', top:8, left:8, width:30, height:30, borderRadius:'50%',
              border:'none', background: isPlaying && rangeEnd === null ? 'rgba(62,184,160,.3)' : 'rgba(62,184,160,.1)',
              color:'var(--teal2)', fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow: isPlaying && rangeEnd === null ? '0 0 0 2px rgba(62,184,160,.4)' : 'none',
              transition:'all .2s', zIndex:1 }}>
            {isPlaying && rangeEnd === null ? '⏸' : '▶'}
          </button>
        )}
        {/* Clickable words or plain text */}
        {hasTs ? (
          <div className="ayat-arabic" ref={containerRef}>
            {timestamps.words.map((word, wi) => {
              const pi = wordPartMap[wi];
              const part = pi !== undefined ? (parts || [])[pi] : null;
              const chars = fixChars(word.chars || []);
              const isActivePart = isPlaying && rangeStart !== null && part &&
                chars.length > 0 && rangeStart <= chars[0].start;
              const bg     = part ? PART_COLORS[pi % PART_COLORS.length]  : 'transparent';
              const border = part ? `1px solid ${PART_BORDERS[pi % PART_BORDERS.length]}` : 'none';
              return (
                <span key={wi}
                  onClick={() => audioUrl && onWordClick(wi)}
                  style={{
                    background: isActivePart ? 'rgba(62,184,160,.28)' : bg,
                    border, borderRadius: part ? 5 : 0,
                    padding: part ? '1px 4px' : 0,
                    margin: part ? '1px' : 0,
                    cursor: audioUrl ? 'pointer' : 'default',
                    display:'inline',
                    transition:'background .15s',
                  }}>
                  {chars.map((c, ci) => (
                    <span key={ci} className="char-span">{c.char}</span>
                  ))}
                  {wi < timestamps.words.length - 1 ? ' ' : ''}
                </span>
              );
            })}
          </div>
        ) : (
          <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:20, color:'var(--text)', lineHeight:2 }}>
            {ayatText}
          </span>
        )}
      </div>

      {/* Parts as clickable chips */}
      {hasParts && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, direction:'rtl' }}>
          {(parts || []).map((part, pi) => (
            <button key={part.id ?? pi}
              onClick={() => audioUrl ? onPartClick(part) : null}
              style={{ fontFamily:"'Amiri Quran',serif", fontSize:15,
                padding:'4px 10px', borderRadius:7,
                background: PART_COLORS[pi % PART_COLORS.length],
                border:`1px solid ${PART_BORDERS[pi % PART_BORDERS.length]}`,
                color:'var(--text)', cursor: audioUrl ? 'pointer' : 'default',
                direction:'rtl', transition:'all .15s',
                boxShadow: isPlaying && rangeStart !== null ? '0 0 0 2px rgba(62,184,160,.3)' : 'none',
              }}>
              {part.text || (part.wordIndices?.map(i => timestamps?.words?.[i]?.chars?.map(c=>c.char).join('')).join(' '))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Split Arabic text into words, separating attached prefix particles (و ف ب ل)
// so وَٱللَّهُ → ['وَ', 'ٱللَّهُ'] matching the space-split form from quran-simple
function splitArabicWords(text) {
  if (!text) return [];

  const PREFIXES = [
    { p: 'و', alefOnly: false },
    { p: 'ف', alefOnly: false },
    { p: 'ل', alefOnly: false },
    { p: 'ب', alefOnly: true  },
  ];
  const ALEF_VARIANTS = new Set(['ا','أ','إ','آ','ٱ','\u0671','\u0622','\u0623','\u0625']);

  // Zero-width / invisible joiners that should NOT cause word breaks
  const ZW_RE = /[\u2060\uFEFF\u200B\u200C\u200D]/;
  const ZW_STRIP = /[\u2060\uFEFF\u200B\u200C\u200D]/g;

  // Step 1: split on whitespace, then merge tokens around ZW chars
  const rawTokens = text.trim().split(/[ \t\n\r\u00A0\u202F\u2009]+/).filter(t => t.length > 0);

  const merged = [];
  let i = 0;
  while (i < rawTokens.length) {
    const raw = rawTokens[i];
    const tok = raw.replace(ZW_STRIP, '');
    if (!tok) {
      // Purely ZW token → merge previous and next
      if (merged.length > 0 && i + 1 < rawTokens.length) {
        merged[merged.length - 1] += rawTokens[i + 1].replace(ZW_STRIP, '');
        i += 2; continue;
      }
    } else if (ZW_RE.test(raw)) {
      // Token contains ZW (at start, end, or middle)
      // If ZW is at the end, merge with next token
      if (/[\u2060\uFEFF\u200B\u200C\u200D]$/.test(raw) && i + 1 < rawTokens.length) {
        merged.push(tok + rawTokens[i + 1].replace(ZW_STRIP, ''));
        i += 2; continue;
      }
      // If ZW is at the start, merge into previous token
      if (/^[\u2060\uFEFF\u200B\u200C\u200D]/.test(raw) && merged.length > 0) {
        merged[merged.length - 1] += tok;
      } else {
        merged.push(tok);
      }
    } else {
      merged.push(tok);
    }
    i++;
  }

  // Also merge any token that is purely diacritics/starts with dagger alif into the previous token,
  // AND merge any token with only 1 Arabic consonant (incomplete word, e.g. فَ split by newline) with the next
  const COMBINING = /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0870-\u08FF]+$/;
  const STARTS_COMBINING = /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/; // starts with diacritic/dagger alif
  const ARABIC_CONS = /[\u0600-\u063F\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06EE-\u06EF\u06FA-\u06FC\u06FF]/g;
  const isSingleConsonant = (tok) => (tok.match(ARABIC_CONS) || []).length === 1;

  const cleaned = [];
  for (let j = 0; j < merged.length; j++) {
    const tok = merged[j];
    if (cleaned.length > 0 && (COMBINING.test(tok) || STARTS_COMBINING.test(tok))) {
      // Token is purely diacritics OR starts with dagger alif — belongs to previous word
      cleaned[cleaned.length - 1] += tok;
    } else if (isSingleConsonant(tok) && j + 1 < merged.length) {
      // Single consonant token (e.g. فَ from فَضۡلِ split by newline): merge with next
      merged[j + 1] = tok + merged[j + 1];
    } else {
      cleaned.push(tok);
    }
  }

  // Step 3: prefix splitting
  const result = [];
  cleaned.forEach(token => {
    const norm = normalizeArabic(token);
    let split = false;
    for (const { p, alefOnly } of PREFIXES) {
      const rest = norm.slice(p.length);
      if (norm.startsWith(p) && norm.length > 2 && (!alefOnly || ALEF_VARIANTS.has(rest[0]))) {
        let i = 0;
        const originalChars = [...token];
        let letterCount = 0;
        while (i < originalChars.length) {
          const cp = originalChars[i].codePointAt(0);
          const isDiacritic = (cp >= 0x064B && cp <= 0x065F) || cp === 0x0670 || (cp >= 0x0610 && cp <= 0x061A) ||
                              (cp >= 0x06D6 && cp <= 0x06ED) || (cp >= 0x0870 && cp <= 0x08FF);
          if (!isDiacritic) letterCount++;
          i++;
          if (letterCount === 1) {
            while (i < originalChars.length) {
              const cp2 = originalChars[i].codePointAt(0);
              const isDia2 = (cp2 >= 0x064B && cp2 <= 0x065F) || cp2 === 0x0670 || (cp2 >= 0x0610 && cp2 <= 0x061A) ||
                             (cp2 >= 0x06D6 && cp2 <= 0x06ED) || (cp2 >= 0x0870 && cp2 <= 0x08FF);
              if (!isDia2) break;
              i++;
            }
            break;
          }
        }
        if (i < originalChars.length) {
          result.push(originalChars.slice(0, i).join(''));
          result.push(originalChars.slice(i).join(''));
          split = true;
          break;
        }
      }
    }
    if (!split) result.push(token);
  });
  return result;
}

// ─── CompareVerseQuestion ───────────────────────────────────────────────────
// Shows multiple ayat texts (same number, different surahs), user taps to match
function CompareVerseQuestion({ q, onAnswer, globalNums }) {
  const { entries } = q;
  const [playingIdx, setPlayingIdx] = React.useState(null);
  const [progress, setProgress]     = React.useState({});  // idx → 0..1
  const audioRef = React.useRef(null);

  const playEntry = (i, sn, an) => {
    const gn = globalNums?.[`${sn}:${an}`];
    if (!gn) return;
    const url = `${getAudioBase()}/${gn}.mp3`;
    if (playingIdx === i) {
      audioRef.current?.pause();
      setPlayingIdx(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {});
    }
    setPlayingIdx(i);
  };

  React.useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnd  = () => { setPlayingIdx(null); };
    const onTime = () => {
      if (el.duration) setProgress(p => ({ ...p, [playingIdx]: el.currentTime / el.duration }));
    };
    el.addEventListener('ended', onEnd);
    el.addEventListener('timeupdate', onTime);
    return () => { el.removeEventListener('ended', onEnd); el.removeEventListener('timeupdate', onTime); };
  }, [playingIdx]);

  // Shuffle display order
  const shuffled = React.useMemo(() => {
    const arr = [...entries];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [q.id]);

  // Shuffled surah names (to match)
  const shuffledNames = React.useMemo(() => {
    const arr = [...entries.map(e => ({ sn: e.sn, name: e.name }))];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [q.id]);

  const [assignments, setAssignments] = React.useState({}); // textIndex → snAssigned
  const [selected, setSelected] = React.useState(null); // { side: 'text'|'name', index }
  const [checked, setChecked] = React.useState(false);

  const assign = (side, index) => {
    if (checked) return;
    if (!selected) { setSelected({ side, index }); return; }
    if (selected.side === side) { setSelected({ side, index }); return; }
    // Cross-assign
    if (side === 'name' && selected.side === 'text') {
      setAssignments(prev => ({ ...prev, [selected.index]: shuffledNames[index].sn }));
    } else if (side === 'text' && selected.side === 'name') {
      setAssignments(prev => ({ ...prev, [index]: shuffledNames[selected.index].sn }));
    }
    setSelected(null);
  };

  const allAssigned = shuffled.every((_, i) => assignments[i] !== undefined);

  const check = () => {
    setChecked(true);
    const correct = shuffled.every((e, i) => assignments[i] === e.sn);
    onAnswer(correct);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, width:'100%' }}>
      <audio ref={audioRef} style={{ display:'none' }} />
      <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:2, textAlign:'center' }}>
        ASSOCIE CHAQUE TEXTE À SA SOURATE
      </div>
      <div style={{ display:'flex', gap:8 }}>
        {/* Texts column */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
          {shuffled.map((e, i) => {
            const isSelected = selected?.side === 'text' && selected.index === i;
            const assignedSn = assignments[i];
            const assignedName = assignedSn ? shuffledNames.find(n => n.sn === assignedSn)?.name : null;
            const correct = checked && assignedSn === e.sn;
            const wrong   = checked && assignedSn !== undefined && assignedSn !== e.sn;
            const isPlaying = playingIdx === i;
            const hasAudio  = !!(globalNums?.[`${e.sn}:${q.ayatNum}`]);
            return (
              <div key={i}
                style={{ borderRadius:8, cursor:'pointer',
                  border:`1px solid ${isSelected ? 'var(--gold)' : correct ? 'var(--green)' : wrong ? 'var(--red)' : 'var(--border2)'}`,
                  background: isSelected ? 'rgba(201,168,76,.08)' : correct ? 'rgba(76,175,129,.08)' : wrong ? 'rgba(229,115,115,.08)' : 'var(--surface2)',
                  overflow:'hidden' }}>
                {/* Audio bar */}
                {hasAudio && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
                    borderBottom:`1px solid var(--border)`, background:'rgba(0,0,0,.15)', cursor:'pointer' }}
                    onClick={ev => { ev.stopPropagation(); playEntry(i, e.sn, q.ayatNum); }}>
                    <span style={{ fontSize:16, color: isPlaying ? 'var(--teal2)' : 'var(--text3)', flexShrink:0 }}>
                      {isPlaying ? '⏸' : '▶'}
                    </span>
                    <div style={{ flex:1, height:3, borderRadius:2, background:'var(--surface3)', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:2, background:'var(--teal)',
                        width:`${(progress[i] ?? 0) * 100}%`,
                        transition: isPlaying ? 'width .1s linear' : 'width .2s' }} />
                    </div>
                  </div>
                )}
                <div style={{ padding:'8px 10px' }} onClick={() => assign('text', i)}>
                  <div style={{ direction:'rtl', fontFamily:"'Amiri Quran',serif", fontSize:15, lineHeight:1.7, color:'var(--text)' }}>
                    {e.text}
                  </div>
                  {assignedName && (
                    <div style={{ fontSize:7, color: correct ? 'var(--green)' : wrong ? 'var(--red)' : 'var(--gold)',
                      fontFamily:"'Cinzel',serif", letterSpacing:1, direction:'ltr', marginTop:4 }}>
                      {assignedName}{checked && !correct && ` → ${e.name}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Names column */}
        <div style={{ flex:'0 0 auto', display:'flex', flexDirection:'column', gap:6, minWidth:90 }}>
          {shuffledNames.map((nm, i) => {
            const isSelected = selected?.side === 'name' && selected.index === i;
            const used = Object.values(assignments).includes(nm.sn);
            return (
              <div key={i} onClick={() => assign('name', i)}
                style={{ padding:'8px 10px', borderRadius:8, cursor:'pointer', textAlign:'center',
                  border:`1px solid ${isSelected ? 'var(--gold)' : used ? 'var(--teal)' : 'var(--border2)'}`,
                  background: isSelected ? 'rgba(201,168,76,.1)' : used ? 'rgba(62,184,160,.08)' : 'var(--surface2)',
                  fontSize:8, letterSpacing:1, fontFamily:"'Cinzel',serif",
                  color: isSelected ? 'var(--gold2)' : used ? 'var(--teal2)' : 'var(--text3)',
                  opacity: used && !isSelected ? 0.6 : 1 }}>
                {nm.name.toUpperCase()}
              </div>
            );
          })}
        </div>
      </div>
      {!checked && allAssigned && (
        <button onClick={check}
          style={{ padding:'10px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
            background:'rgba(201,168,76,.12)', border:'1px solid var(--gold)', color:'var(--gold2)',
            borderRadius:8, cursor:'pointer' }}>
          ✓ VÉRIFIER
        </button>
      )}
      {checked && (
        <div style={{ textAlign:'center', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
          color: shuffled.every((_,i) => assignments[i] === shuffled[i].sn) ? 'var(--green)' : 'var(--red)',
          padding:'8px', borderRadius:8,
          background: shuffled.every((_,i) => assignments[i] === shuffled[i].sn) ? 'rgba(76,175,129,.08)' : 'rgba(229,115,115,.08)' }}>
          {shuffled.every((_,i) => assignments[i] === shuffled[i].sn) ? '✓ CORRECT' : '✗ INCORRECT'}
        </div>
      )}
    </div>
  );
}


// ─── FindSurahQuestion ────────────────────────────────────────────────────────
function FindSurahQuestion({ q, surahs, onAnswer }) {
  const [chosen, setChosen] = React.useState(null);
  const correct = q.answer;
  const pick = (sn) => {
    if (chosen !== null) return;
    setChosen(String(sn));
    onAnswer(String(sn) === correct);
  };
  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:14, alignItems:'center' }}>
      <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:24, direction:'rtl', textAlign:'center',
        color:'var(--text1)', padding:'14px 18px', background:'var(--surface3)',
        borderRadius:10, border:'1px solid var(--border)', lineHeight:2.2, width:'100%' }}>
        {q.questionData}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', width:'100%' }}>
        {(q.options || []).map(sn => {
          const s = surahs.find(x => x.number === sn);
          const isCorrect = String(sn) === correct;
          const isChosen  = String(sn) === chosen;
          let bg = 'transparent', border = 'var(--border2)', color = 'var(--text2)';
          if (chosen !== null) {
            if (isCorrect)     { bg='rgba(76,175,129,.15)'; border='var(--green)'; color='var(--green)'; }
            else if (isChosen) { bg='rgba(224,90,90,.12)';  border='var(--red)';   color='var(--red)'; }
          }
          return (
            <button key={sn} onClick={() => pick(sn)}
              style={{ padding:'9px 16px', fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif",
                background:bg, border:`1px solid ${border}`, color, borderRadius:8,
                cursor: chosen===null ? 'pointer' : 'default', transition:'all .2s', minWidth:120 }}>
              <span style={{ opacity:.6, marginRight:4 }}>{sn}.</span>{s ? s.englishName : `S.${sn}`}
            </button>
          );
        })}
      </div>
      {chosen !== null && (
        <div style={{ fontSize:9, letterSpacing:1, color: chosen===correct ? 'var(--green)' : 'var(--red)' }}>
          {chosen===correct ? '✓ Correct' : `✗ — ${surahs.find(x=>String(x.number)===correct)?.englishName ?? correct}`}
        </div>
      )}
    </div>
  );
}

// ─── QuranBookPage ────────────────────────────────────────────────────────────
// Inspired by Codrops / billionbd CodePen: hardcover_front + pages + spine
// Structure: <ul class="qbook"> with li.qbook-hc-front, li.qbook-pages,
//            li.qbook-page (flipping leaf), li.qbook-hc-back
const MUSHAF_TOTAL = 604;

function QuranBookPage({ surahs }) {
  const navigate = useNavigate();
  const [spread,    setSpread]    = React.useState(0);    // 0 = cover closed
  const [flipState, setFlipState] = React.useState('idle'); // 'idle'|'fwd'|'bwd'
  const [pageCache, setPageCache] = React.useState({});
  const [inputVal,  setInputVal]  = React.useState('1');
  const [bookOpen,  setBookOpen]  = React.useState(false);
  const [sz,        setSz]        = React.useState({ w: 440, h: 560 });
  const [showSurahMenu, setShowSurahMenu] = React.useState(false);
  const [bookmark,  setBookmark]  = React.useState(() => {
    try { return parseInt(localStorage.getItem('quranbook_bm')) || null; } catch { return null; }
  });

  // Responsive single-page width (book shows one spread = two half-pages)
  React.useEffect(() => {
    const upd = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      // single page half-width; full spread = w*2
      const maxH = vh - 160;
      const maxW = Math.min((vw - 40) / 2, maxH * 0.68, 440);
      setSz({ w: Math.round(maxW), h: Math.round(maxW / 0.68) });
    };
    upd(); window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);

  const rPage = spread === 0 ? null : 2 * spread - 1;
  const lPage = spread === 0 ? null : Math.min(2 * spread, MUSHAF_TOTAL);

  const loadPage = React.useCallback(async (n) => {
    if (!n || n < 1 || n > MUSHAF_TOTAL || pageCache[n] !== undefined) return;
    setPageCache(c => ({ ...c, [n]: null }));
    try {
      const data = await fetchQuranPage(n);
      setPageCache(c => ({ ...c, [n]: data }));
    } catch {
      setPageCache(c => ({ ...c, [n]: [] }));
    }
  }, [pageCache]);

  React.useEffect(() => {
    if (spread === 0) return;
    [rPage, lPage, rPage+2, lPage+2, rPage-2, lPage-2]
      .filter(Boolean).forEach(loadPage);
  }, [spread]); // eslint-disable-line

  React.useEffect(() => {
    if (rPage) setInputVal(String(rPage));
  }, [rPage]);

  // Open book: animate cover swing then go to spread 1
  const openBook = React.useCallback(() => {
    if (bookOpen) return;
    setBookOpen(true);
    setTimeout(() => {
      setSpread(1);
      setFlipState('idle');
    }, 820);
  }, [bookOpen]);

  const closeBook = React.useCallback(() => {
    setBookOpen(false);
    setTimeout(() => setSpread(0), 820);
  }, []);

  const goNext = React.useCallback(async () => {
    if (flipState !== 'idle' || !lPage || lPage >= MUSHAF_TOTAL) return;
    // preload next spread before animating
    const np1 = rPage + 2, np2 = lPage + 2;
    await Promise.all([np1, np2].filter(p => p >= 1 && p <= MUSHAF_TOTAL && pageCache[p] === undefined)
      .map(async p => {
        setPageCache(c => ({ ...c, [p]: null }));
        try { const d = await fetchQuranPage(p); setPageCache(c => ({ ...c, [p]: d })); }
        catch { setPageCache(c => ({ ...c, [p]: [] })); }
      }));
    setFlipState('fwd');
    setTimeout(() => { setSpread(s => s + 1); setFlipState('idle'); }, 720);
  }, [flipState, lPage, rPage, pageCache]);

  const goPrev = React.useCallback(async () => {
    if (flipState !== 'idle' || spread <= 1) return;
    const pp1 = rPage - 2, pp2 = lPage ? lPage - 2 : null;
    await Promise.all([pp1, pp2].filter(p => p && p >= 1 && pageCache[p] === undefined)
      .map(async p => {
        setPageCache(c => ({ ...c, [p]: null }));
        try { const d = await fetchQuranPage(p); setPageCache(c => ({ ...c, [p]: d })); }
        catch { setPageCache(c => ({ ...c, [p]: [] })); }
      }));
    setFlipState('bwd');
    setTimeout(() => { setSpread(s => s - 1); setFlipState('idle'); }, 720);
  }, [flipState, spread, rPage, lPage, pageCache]);

  const jumpTo = (v) => {
    const p = Math.max(1, Math.min(MUSHAF_TOTAL, parseInt(v) || 1));
    setSpread(Math.ceil(p / 2));
    if (!bookOpen) { setBookOpen(true); }
  };

  // Keyboard
  React.useEffect(() => {
    const h = e => {
      if (e.key === 'ArrowLeft')  goNext();
      if (e.key === 'ArrowRight') goPrev();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [goNext, goPrev]);

  // Touch swipe
  const tx = React.useRef(0);

  const isFwd  = flipState === 'fwd';
  const isBwd  = flipState === 'bwd';
  const isFlip = isFwd || isBwd;

  // Page content renderer
  const PageContent = React.useCallback(({ pageNum, side }) => {
    const ayahs = pageCache[pageNum];
    if (!pageNum) return null;
    if (ayahs === undefined || ayahs === null)
      return <div className="qbook-loading-page">القرآن</div>;

    const groups = [];
    (ayahs || []).forEach(a => {
      const last = groups[groups.length - 1];
      if (!last || last.sn !== a.surah.number)
        groups.push({ sn: a.surah.number, name: a.surah.name, eng: a.surah.englishName, ayahs: [] });
      groups[groups.length - 1].ayahs.push(a);
    });

    const fs = Math.max(Math.min(sz.h / 20, sz.w / 14, 16), 10);

    return (
      <div className={`qbook-page-content${side === 'right' ? ' qbook-page-content-right' : ''}`}>
        {groups.map((g, gi) => (
          <React.Fragment key={gi}>
            {g.ayahs[0]?.numberInSurah === 1 && (
              <>
                <div className="qbook-surah-header">
                  {g.eng.toUpperCase()}
                  <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:'1.3em', margin:'0 5px' }}>{g.name}</span>
                </div>
                {g.sn !== 9 && (
                  <div className="qbook-basmala" style={{ fontSize: fs + 1 }}>
                    بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
                  </div>
                )}
              </>
            )}
            <div className="qbook-ayah-text" style={{ fontSize: fs }}>
              {g.ayahs.map(a => (
                <React.Fragment key={a.numberInSurah}>
                  {a.text}<span className="qbook-ayah-num">﴿{a.numberInSurah}﴾</span>{' '}
                </React.Fragment>
              ))}
            </div>
          </React.Fragment>
        ))}
        <div className="qbook-page-num">{pageNum}</div>
      </div>
    );
  }, [pageCache, sz]);

  const spineW = Math.max(Math.round(sz.w * 0.052), 20);
  const totalW = sz.w * 2 + spineW;

  return (
    <div className="qbook-wrapper">

      {/* ── Top bar ── */}
      <div className="qbook-topbar" style={{ maxWidth: totalW + 60 }}>
        <button onClick={() => navigate('/quran')}
          style={{ fontSize:8,letterSpacing:1.5,padding:'4px 12px',fontFamily:"'Cinzel',serif",
            background:'transparent',border:'1px solid rgba(201,168,76,.25)',
            color:'rgba(201,168,76,.55)',borderRadius:6,cursor:'pointer',flexShrink:0 }}>
          ← SOURATES
        </button>

        {/* Surah picker */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <button onClick={() => setShowSurahMenu(v => !v)}
            style={{ fontSize:8,letterSpacing:1.2,padding:'4px 10px',fontFamily:"'Cinzel',serif",
              background:'rgba(201,168,76,.07)',border:'1px solid rgba(201,168,76,.22)',
              color:'rgba(201,168,76,.6)',borderRadius:6,cursor:'pointer' }}>
            SOURATE ▾
          </button>
          {showSurahMenu && (
            <div style={{ position:'absolute',top:'115%',left:0,zIndex:300,minWidth:240,
              background:'#120701',border:'1px solid rgba(201,168,76,.2)',borderRadius:8,
              maxHeight:260,overflowY:'auto',boxShadow:'0 10px 40px rgba(0,0,0,.85)' }}>
              {surahs.map(s => (
                <div key={s.number}
                  onClick={() => { jumpTo(s.startPage || s.number * 2 - 1); setShowSurahMenu(false); }}
                  style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 12px',
                    cursor:'pointer',borderBottom:'1px solid rgba(201,168,76,.05)' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(201,168,76,.1)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{ fontSize:8,color:'rgba(201,168,76,.4)',minWidth:20 }}>{s.number}</span>
                  <span style={{ fontFamily:"'Amiri Quran',serif",fontSize:14,color:'#c9a84c',direction:'rtl' }}>{s.name}</span>
                  <span style={{ fontSize:7,color:'rgba(201,168,76,.35)',marginLeft:'auto' }}>{s.englishName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontFamily:"'Amiri Quran',serif",fontSize:Math.max(sz.w*.044,16),
          color:'rgba(201,168,76,.48)',direction:'rtl',textAlign:'center',flex:1,
          textShadow:'0 0 16px rgba(201,168,76,.2)' }}>
          القرآن الكريم
        </div>

        {/* Bookmark */}
        <button onClick={() => { setBookmark(rPage); if(rPage) localStorage.setItem('quranbook_bm', String(rPage)); }}
          style={{ fontSize:14,background:'transparent',border:'none',cursor:'pointer',flexShrink:0,
            color: bookmark === rPage ? '#c0392b' : 'rgba(201,168,76,.32)' }}>🔖</button>
        {bookmark && rPage && bookmark !== rPage && (
          <button onClick={() => jumpTo(bookmark)}
            style={{ fontSize:8,letterSpacing:1,padding:'4px 8px',fontFamily:"'Cinzel',serif",
              background:'rgba(192,57,43,.14)',border:'1px solid rgba(192,57,43,.28)',
              color:'rgba(220,100,80,.7)',borderRadius:6,cursor:'pointer',flexShrink:0 }}>
            p.{bookmark}
          </button>
        )}

        {/* Page input */}
        {bookOpen && (
          <div style={{ display:'flex',alignItems:'center',gap:4,flexShrink:0 }}>
            <span style={{ fontSize:7,color:'rgba(201,168,76,.4)',fontFamily:"'Cinzel',serif" }}>P.</span>
            <input type="number" value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && jumpTo(inputVal)}
              onBlur={() => jumpTo(inputVal)}
              style={{ width:44,textAlign:'center',background:'transparent',
                border:'1px solid rgba(201,168,76,.22)',borderRadius:6,
                padding:'3px 5px',color:'var(--gold)',fontSize:12,
                fontFamily:"'Cinzel',serif",outline:'none' }} />
            <span style={{ fontSize:7,color:'rgba(201,168,76,.25)',fontFamily:"'Cinzel',serif" }}>/604</span>
          </div>
        )}
      </div>

      {/* ── Book scene ── */}
      <div className="qbook-scene"
        onTouchStart={e => { tx.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - tx.current;
          if (dx < -55) goNext(); if (dx > 55) goPrev();
        }}>

        {/* Ambient glow under book */}
        <div style={{ position:'absolute',bottom:'8%',left:'50%',transform:'translateX(-50%)',
          width:'55%',height:30,pointerEvents:'none',
          background:'radial-gradient(ellipse,rgba(180,110,20,.16) 0%,transparent 70%)' }}/>

        {/* ── THE BOOK ── */}
        <div style={{
          position:'relative',
          width: totalW,
          height: sz.h,
          transformStyle:'preserve-3d',
          transform:'rotateX(4deg)',
          filter:`drop-shadow(0 ${sz.h*.12}px ${sz.h*.16}px rgba(0,0,0,.95)) drop-shadow(0 8px 24px rgba(0,0,0,.6))`,
        }}>

          {/* ── HARDCOVER BACK ── */}
          <ul style={{ listStyle:'none',margin:0,padding:0,
            position:'absolute',top:0,left:0,width:sz.w,height:sz.h,
            transformStyle:'preserve-3d',zIndex:0 }}>
            {/* back board */}
            <li style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
              borderRadius:'3px 0 0 3px',
              background:'linear-gradient(135deg,#200800,#4a1508,#200800)',
              boxShadow:'-4px 0 12px rgba(0,0,0,.5),inset 4px 0 10px rgba(0,0,0,.3)' }}/>
            {/* thickness edge */}
            <li style={{ position:'absolute',top:4,right:-spineW*.35,
              width:spineW*.35, height:'calc(100% - 8px)',
              background:'linear-gradient(to right,#1a0500,#0e0200)',
              borderRadius:'0 2px 2px 0' }}/>
          </ul>

          {/* ── STACKED PAGES (visible fore-edge) ── */}
          <ul style={{ listStyle:'none',margin:0,padding:0,
            position:'absolute',top:3,left:3,
            width: sz.w * 2 + spineW - 6, height: sz.h - 6,
            transformStyle:'preserve-3d',zIndex:1 }}>
            {[0,1,2,3,4].map(k => (
              <li key={k} style={{
                position:'absolute',top:0,left:0,width:'100%',height:'100%',
                borderRadius:'0 2px 2px 0',
                background: ['#ede1bb','#f0e4c0','#f3e7c6','#f6eacc','#f9edd2'][k],
                transform:`translateX(${-k}px)`,
              }}/>
            ))}
          </ul>

          {/* ── LEFT PAGE (even) — always visible under the flipping leaf ── */}
          <div style={{ position:'absolute',top:0,left:0,width:sz.w,height:sz.h,zIndex:2,overflow:'hidden',
            background:'linear-gradient(160deg,#fef9ee,#fdf3d8,#faecc0)',
            borderRadius:'2px 0 0 2px',
            boxShadow:'inset 8px 0 20px rgba(0,0,0,.08)' }}>
            {bookOpen && <PageContent pageNum={isFwd ? lPage + 2 : lPage} side="left" />}
          </div>

          {/* ── RIGHT PAGE (odd) — always visible ── */}
          <div style={{ position:'absolute',top:0,left:sz.w + spineW,width:sz.w,height:sz.h,zIndex:2,
            overflow:'hidden',
            background:'linear-gradient(160deg,#fef9ee,#fdf3d8,#faecc0)',
            borderRadius:'0 2px 2px 0',
            boxShadow:'inset -8px 0 20px rgba(0,0,0,.08)' }}>
            {bookOpen && <PageContent pageNum={isBwd ? rPage - 2 : rPage} side="right" />}
          </div>

          {/* ── SPINE ── */}
          <div style={{ position:'absolute',top:0,left:sz.w,width:spineW,height:sz.h,zIndex:20,
            background:`linear-gradient(to right,#0a0200 0%,#3a1204 18%,#8a3810 34%,#d08c38 50%,#8a3810 66%,#3a1204 82%,#0a0200 100%)`,
            boxShadow:'0 0 18px rgba(0,0,0,.7),inset 0 0 6px rgba(255,195,70,.08)' }}>
            <div style={{ position:'absolute',inset:0,
              background:'repeating-linear-gradient(to bottom,transparent 0,transparent 20px,rgba(255,190,60,.07) 20px,rgba(255,190,60,.07) 21px)' }}/>
          </div>

          {/* ── FLIPPING PAGE ── */}
          {isFlip && (
            <div className={`qbook-page${isFwd ? ' qbook-flip-fwd' : ' qbook-flip-bwd'}`}
              style={{
                position:'absolute',top:0,
                left: isFwd ? 0 : sz.w + spineW,
                width:sz.w,height:sz.h,
                transformOrigin: isFwd ? 'right center' : 'left center',
                transformStyle:'preserve-3d',zIndex:200,
              }}>
              {/* front face */}
              <div className="qbook-page-face">
                <PageContent pageNum={isFwd ? lPage : rPage} side={isFwd ? 'left' : 'right'} />
              </div>
              {/* back face */}
              <div className="qbook-page-face qbook-page-face-back">
                <PageContent pageNum={isFwd ? rPage + 2 : lPage - 2} side={isFwd ? 'right' : 'left'} />
              </div>
            </div>
          )}

          {/* ── HARDCOVER FRONT ── */}
          <ul className={`qbook-hc-front${bookOpen ? ' qbook-open' : ''}`}
            style={{ listStyle:'none',margin:0,padding:0,
              position:'absolute',top:0,
              left: sz.w + spineW,   // cover starts at right half
              width:sz.w,height:sz.h,
              transformStyle:'preserve-3d',
              transformOrigin:'left center',
              transition:'transform .82s cubic-bezier(.645,.045,.355,1)',
              transform: bookOpen ? 'rotateY(-175deg)' : 'rotateY(0deg)',
              zIndex:bookOpen ? 5 : 150,
            }}>
            {/* front face */}
            <li style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
              backfaceVisibility:'hidden',borderRadius:'0 3px 3px 0',overflow:'hidden',
              background:'linear-gradient(135deg,#280b01 0%,#561c05 30%,#8b3210 50%,#561c05 70%,#280b01 100%)',
              boxShadow:'inset -8px 0 24px rgba(0,0,0,.45),inset 0 0 40px rgba(0,0,0,.28)' }}>
              <div className="qbook-cover-design">
                <div className="qbook-medallion">☽</div>
                <div className="qbook-cover-title">القرآن الكريم</div>
                <div className="qbook-cover-sub">THE NOBLE QURAN</div>
                {!bookOpen && (
                  <button className="qbook-open-btn" style={{ marginTop:16 }}
                    onClick={openBook}>
                    OUVRIR LE LIVRE
                  </button>
                )}
              </div>
            </li>
            {/* back face (inside of front cover) */}
            <li style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
              backfaceVisibility:'hidden',transform:'rotateY(180deg)',
              borderRadius:'0 3px 3px 0',overflow:'hidden',
              background:'linear-gradient(to right,#1c0601,#3a1008)',
              display:'flex',alignItems:'center',justifyContent:'center' }}>
              <div style={{ fontFamily:"'Amiri Quran',serif",fontSize:'1.8em',
                color:'rgba(201,168,76,.22)',direction:'rtl' }}>﷽</div>
            </li>
          </ul>

          {/* ── Click zones (when open) ── */}
          {bookOpen && !isFlip && <>
            <div className="qbook-click qbook-click-left"
              style={{ left:0, width:sz.w*.46, height:sz.h, position:'absolute',top:0,zIndex:250,cursor:'pointer' }}
              onClick={goNext} title="Suivant (←)" />
            <div className="qbook-click qbook-click-right"
              style={{ left:sz.w + spineW + sz.w*.54, width:sz.w*.46, height:sz.h, position:'absolute',top:0,zIndex:250,cursor:'pointer' }}
              onClick={goPrev} title="Précédent (→)" />
          </>}

          {/* ── Top & bottom hardcover boards (3D depth illusion) ── */}
          <div style={{ position:'absolute',top:-5,left:0,right:0,height:6,
            background:'linear-gradient(to bottom,#1e0602,#5a1a08)',
            borderRadius:'2px 2px 0 0',boxShadow:'0 -2px 8px rgba(0,0,0,.5)' }}/>
          <div style={{ position:'absolute',bottom:-5,left:0,right:0,height:6,
            background:'linear-gradient(to top,#1e0602,#5a1a08)',
            borderRadius:'0 0 2px 2px',boxShadow:'0 2px 8px rgba(0,0,0,.5)' }}/>
        </div>
      </div>

      {/* ── Bottom nav ── */}
      <div className="qbook-botnav">
        {bookOpen ? (<>
          <button className="qbook-navbtn" onClick={goPrev} disabled={spread <= 1 || isFlip}>
            → PRÉC.
          </button>

          <div style={{ textAlign:'center', minWidth:80 }}>
            <div className="qbook-navlabel">
              {rPage}{lPage && lPage <= MUSHAF_TOTAL ? '–' + lPage : ''}
            </div>
            <div className="qbook-progress">
              <div className="qbook-progress-bar"
                style={{ width:`${rPage ? (rPage/MUSHAF_TOTAL)*100 : 0}%` }}/>
            </div>
          </div>

          <button className="qbook-navbtn" onClick={goNext}
            disabled={!lPage || lPage >= MUSHAF_TOTAL || isFlip}>
            SUIV. ←
          </button>

          <button className="qbook-navbtn" onClick={closeBook}
            style={{ fontSize:8,padding:'5px 12px',opacity:.6 }}>
            ✕ FERMER
          </button>
        </>) : (
          <button className="qbook-navbtn" onClick={openBook}>
            📖 OUVRIR LE LIVRE
          </button>
        )}
      </div>
    </div>
  );
}


// ─── QuranBook3DPage ─────────────────────────────────────────────────────────
// Architecture: single WebGL canvas for all rendering.
// Each page spread is drawn as a WebGL texture (parchment + text composited
// on an offscreen 2D canvas) then mapped through the curl shader.
// No separate 2D overlay — everything in one GL canvas.

const _MUSHAF_PAGES = 604;
const _API3D = "https://api.alquran.cloud/v1";

// ── Vertex shader ─────────────────────────────────────────────────────────────
const _VS3D = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying   vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = vec4(a_pos, 0., 1.); }`;

// ── Page spread fragment shader ───────────────────────────────────────────────
// Renders left+right page textures with:
//  • cylindrical curl with crease highlight + back-face tint
//  • spine groove + gold filament
//  • per-page AO shadow near spine
//  • stacked-pages fore-edge
const _PAGE_FS = `
precision highp float;
varying vec2 v_uv;

uniform sampler2D u_tex;     // current spread texture (both pages)
uniform sampler2D u_texNext; // next spread (shown on back of curling leaf)
uniform float u_curl;        // 0=flat … 1=fully turned
uniform float u_dir;         // +1 = right-page curls forward, -1 = left-page

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

// ── Spine ─────────────────────────────────────────────────────────────────────
vec4 spineColor(float t, float vy){
  vec3 base = mix(vec3(.055,.020,.004), vec3(.095,.038,.009), noise(vec2(t*8.,vy*30.))*.5);
  float gold = exp(-pow((t-.5)*4.8,2.));
  base = mix(base, vec3(.82,.60,.20), gold*.6);
  float gl2  = smoothstep(.007,0.,abs(t-.20)) + smoothstep(.007,0.,abs(t-.80));
  base = mix(base, vec3(.78,.55,.18), gl2*.75);
  base -= smoothstep(.78,1.,fract(vy*58.))*.05;
  float sv = 1.-smoothstep(.82,1.,abs(vy-.5)*2.);
  base *= mix(.55,1.,sv);
  return vec4(base,1.);
}

// ── Cylindrical curl ──────────────────────────────────────────────────────────
void curl(
  in  vec2  pageUV,  // 0..1 within this half-page
  in  float c,       // curl progress 0..1
  in  bool  right,   // is this the right page?
  out vec2  mapped,  // remapped UV into the page texture half
  out float shade,   // darkening factor
  out bool  isBack,  // are we on the back face?
  out float crease   // crease highlight (0..1)
){
  mapped = pageUV; shade = 1.; isBack = false; crease = 0.;
  if(c < .001) return;

  bool curling = (u_dir > 0.) == right;
  if(!curling) return;

  float foldX = u_dir > 0. ? (1. - c) : c;
  float x     = u_dir > 0. ? pageUV.x : (1. - pageUV.x);
  float d     = x - foldX;
  float R     = max(.06, .55 * (1. - c * .65));

  crease = exp(-abs(d) * 180.) * c;

  if(d > 0.){
    // back face
    float ang   = min(d / (R * 3.14159), 1.);
    float flipX = foldX - sin(ang * 3.14159) * R * .55;
    float flipY = pageUV.y + (cos(ang * 3.14159) - 1.) * R * .07;
    mapped  = u_dir > 0. ? vec2(flipX, flipY) : vec2(1.-flipX, flipY);
    mapped  = clamp(mapped, 0., 1.);
    shade   = (.55 + .30 * (1.-c)) * cos(ang * 3.14159 * .4);
    isBack  = true;
  } else {
    // front face bulge
    float t2 = clamp((-d)/(.4*(1.-foldX)+.01),0.,1.);
    float by = sin(t2*3.14159)*c*.035;
    float bx = sin(t2*3.14159)*c*.010;
    mapped = u_dir > 0.
      ? vec2(pageUV.x-bx, pageUV.y+by*(pageUV.y-.5))
      : vec2(pageUV.x+bx, pageUV.y+by*(pageUV.y-.5));
    mapped = clamp(mapped, 0., 1.);
    shade  = .80 + .20*smoothstep(0.,.20,-d);
  }
}

// ── Fore-edge (stacked pages) ─────────────────────────────────────────────────
vec3 foreEdge(vec2 puv, vec3 col, bool right){
  float e = right ? smoothstep(.93,1.,puv.x) : smoothstep(.07,0.,puv.x);
  vec3 edge = vec3(.76,.68,.50);
  col = mix(col, edge, e * .55);
  float lines = fract(puv.y * 140.);
  col -= e * smoothstep(.65,1.,lines) * .045;
  return col;
}

void main(){
  bool  right  = v_uv.x > .5;
  float spW    = .014;
  float sx     = abs(v_uv.x - .5);

  // ── Spine ──────────────────────────────────────────────────────────────────
  if(sx < spW){
    float t = (v_uv.x - (.5-spW)) / (spW*2.);
    gl_FragColor = spineColor(t, v_uv.y);
    return;
  }

  // ── Page UV (0..1 within this half) ────────────────────────────────────────
  vec2 pageUV = right ? vec2((v_uv.x-.5)*2., v_uv.y)
                      : vec2(v_uv.x*2.,       v_uv.y);

  vec2  mapped; float shade; bool isBack; float crease;
  curl(pageUV, u_curl, right, mapped, shade, isBack, crease);

  // ── Sample texture ─────────────────────────────────────────────────────────
  // texture layout: left-half = left page, right-half = right page
  vec2 texUV = right ? vec2(.5 + mapped.x*.5, mapped.y)
                     : vec2(mapped.x*.5,       mapped.y);

  vec4 col;
  bool curling2 = (u_dir > 0.) == right;
  if(isBack && curling2 && u_curl > .01){
    // back face shows next spread
    vec2 nextUV = right ? vec2(.5 + mapped.x*.5, mapped.y)
                        : vec2(mapped.x*.5,       mapped.y);
    col = texture2D(u_texNext, nextUV);
  } else {
    col = texture2D(u_tex, texUV);
  }

  // ── Spine AO ───────────────────────────────────────────────────────────────
  float ao = right ? 1.-.44*exp(-pageUV.x*10.)
                   : 1.-.44*exp(-(1.-pageUV.x)*10.);
  col.rgb *= ao;

  // ── Fore-edge ─────────────────────────────────────────────────────────────
  col.rgb = foreEdge(pageUV, col.rgb, right);

  // ── Back face tint ────────────────────────────────────────────────────────
  if(isBack){
    col.rgb = mix(col.rgb * .70, vec3(.86,.76,.58), .15);
  }

  // ── Curl shade ────────────────────────────────────────────────────────────
  col.rgb *= shade;

  // ── Crease highlight ──────────────────────────────────────────────────────
  col.rgb += vec3(.98,.90,.72) * crease * .65;

  // ── Fold shadow on unturned pages ────────────────────────────────────────
  if(u_curl > .01){
    bool curling3 = (u_dir > 0.) == right;
    if(!isBack){
      float foldX2 = u_dir > 0. ? (1.-u_curl) : u_curl;
      float fx = u_dir > 0. ? pageUV.x : (1.-pageUV.x);
      col.rgb -= .32 * u_curl * exp(-abs(fx-foldX2)*24.) * (1.-float(isBack));
    }
  }

  gl_FragColor = vec4(clamp(col.rgb,0.,1.), 1.);
}`;

// ── Cover shader ──────────────────────────────────────────────────────────────
const _CVR_FS = `
precision highp float;
varying vec2 v_uv;
attribute vec2 a_uv;
uniform float u_time;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<7;i++){v+=a*noise(p);p*=2.1;a*=.48;}return v;}
vec3 gold(float t){ return mix(vec3(.66,.42,.08),vec3(.96,.80,.34),t); }

float rosette(vec2 c, float r, float petals, float t){
  float a=atan(c.y,c.x);
  float petal=.5+.5*cos(petals*a+t);
  return smoothstep(r*.85,r*.05, length(c)-petal*r*.48);
}

void main(){
  float n=fbm(v_uv*7.)*.2+fbm(v_uv*23.+3.)*.08;
  vec3 col=mix(vec3(.040,.015,.003),vec3(.110,.046,.011),n);
  vec2 c=v_uv-.5; float r=length(c),a=atan(c.y,c.x);

  // rings
  for(int k=0;k<5;k++){
    float rk=.40-float(k)*.055; float w=.007-.001*float(k);
    float ring=smoothstep(w*.5,0.,abs(r-rk));
    float sh=.65+.35*sin(float(k)*1.4+u_time*.7+a*4.);
    col=mix(col,gold(sh),ring*(.92-.15*float(k)));
  }

  // inner field
  float inner=smoothstep(.27,.22,r);
  vec3 fillC=mix(vec3(.07,.028,.006),vec3(.13,.055,.014),fbm(c*15.+u_time*.03)*.5);
  float tr=max(
    smoothstep(.035,.0,abs(sin(c.x*26.+u_time*.08)*cos(c.y*26.-.08*u_time)*.4)),
    smoothstep(.035,.0,abs(sin((c.x+c.y)*18.+u_time*.06)*.35))
  )*inner;
  fillC=mix(fillC,gold(.55+.4*sin(r*28.-u_time*1.1+a*3.))*.72,tr);
  col=mix(col,fillC,inner);

  // rosettes
  col=mix(col,gold(.55+.4*sin(u_time*1.4+r*18.)),rosette(c,.20,8.,u_time*.22)*.88);
  col=mix(col,gold(.75+.2*sin(u_time*1.8)),rosette(c,.10,6.,-u_time*.30)*.92);
  col=mix(col,vec3(1.,.94,.62),smoothstep(.020,.0,r));

  // 8-point star
  float star=pow(abs(sin(a*4.+u_time*.18)),3.5);
  col=mix(col,gold(.6+.35*star),star*(1.-smoothstep(.26,.36,r))*smoothstep(.07,.26,r)*.65);

  // corner ornaments
  vec2 co=abs(v_uv-.5)*2.;
  float cscroll=smoothstep(.60,.64,max(co.x,co.y))-smoothstep(.72,.76,max(co.x,co.y));
  col=mix(col,gold(.62+.25*sin(u_time+co.x*4.)),cscroll*.70);
  float cd=(1.-smoothstep(.0,.14,length(co-.82)))*smoothstep(.055,.0,abs(co.x-co.y));
  col=mix(col,gold(.72+.2*sin(u_time*.9)),cd*.88);

  // borders
  vec2 bd=min(v_uv,1.-v_uv);
  float b1=smoothstep(0.,.006,min(bd.x,bd.y))-smoothstep(.006,.014,min(bd.x,bd.y));
  float b2=smoothstep(.018,.022,min(bd.x,bd.y))-smoothstep(.022,.028,min(bd.x,bd.y));
  float b3=smoothstep(.033,.036,min(bd.x,bd.y))-smoothstep(.036,.042,min(bd.x,bd.y));
  float bs=.5+.5*sin(u_time*.5+(v_uv.x+v_uv.y)*7.);
  col=mix(col,gold(.58+.32*bs),b1*.92+b2*.72+b3*.55);

  // vignette
  vec2 dv=v_uv*(1.-v_uv);
  col*=mix(.35,1.,pow(dv.x*dv.y*18.,.27));

  col+=vec3(.92,.80,.44)*exp(-r*r*5.5)*(.11+.05*sin(u_time*1.8));
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

// ── GL helpers ────────────────────────────────────────────────────────────────
function _csh(gl,t,src){
  const s=gl.createShader(t);
  gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}
function _cprog(gl,vs,fs){
  const p=gl.createProgram();
  gl.attachShader(p,_csh(gl,gl.VERTEX_SHADER,vs));
  gl.attachShader(p,_csh(gl,gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p); return p;
}
function _makeTex(gl){
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  // init with 1x1 blank
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([245,235,200,255]));
  return t;
}
function _uploadTex(gl,tex,canvas){
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
}

// ── Offscreen spread canvas renderer ─────────────────────────────────────────
// Draws parchment background + ayat text for both pages side by side
function _renderSpread(leftAyahs, leftPn, rightAyahs, rightPn, W, H){
  const cvs=document.createElement("canvas"); cvs.width=W; cvs.height=H;
  const ctx=cvs.getContext("2d");

  const hw=W/2;

  // ── Parchment background ──────────────────────────────────────────────────
  // We draw it via gradient + noise simulation on 2D canvas
  for(let side=0;side<2;side++){
    const x0=side===0?0:hw;
    ctx.save();
    // base warm ivory
    const g=ctx.createLinearGradient(x0,0,x0+hw,H);
    g.addColorStop(0,  "#fdf8ea");
    g.addColorStop(.4, "#faf2d8");
    g.addColorStop(1,  "#f4e8c0");
    ctx.fillStyle=g;
    ctx.fillRect(x0,0,hw,H);

    // subtle grain via tiny dots (fast approximation)
    ctx.globalAlpha=.055;
    ctx.fillStyle="#8b6030";
    // draw a grid of semi-random dots for grain texture
    const step=3;
    for(let yy=0;yy<H;yy+=step){
      for(let xx=0;xx<hw;xx+=step){
        const v=Math.sin(xx*.71+yy*.53)*Math.cos(xx*.37-yy*.81)*.5+.5;
        if(v>.62){ ctx.fillRect(x0+xx,yy,1,1); }
      }
    }
    // laid lines
    ctx.globalAlpha=.04;
    ctx.fillStyle="#7a5520";
    for(let yy=0;yy<H;yy+=Math.round(H/42)){
      ctx.fillRect(x0,yy,hw,1);
    }
    ctx.globalAlpha=1;
    ctx.restore();

    // edge yellowing
    const ew=ctx.createLinearGradient(x0,0,x0+12,0);
    ew.addColorStop(0,"rgba(140,100,40,.22)"); ew.addColorStop(1,"rgba(140,100,40,0)");
    ctx.fillStyle=ew; ctx.fillRect(x0,0,18,H);
    const ew2=side===0
      ? ctx.createLinearGradient(x0+hw-12,0,x0+hw,0)
      : ctx.createLinearGradient(x0+hw-12,0,x0+hw,0);
    ew2.addColorStop(0,"rgba(140,100,40,0)"); ew2.addColorStop(1,"rgba(140,100,40,.22)");
    ctx.fillStyle=ew2; ctx.fillRect(x0+hw-18,0,18,H);
    const ewt=ctx.createLinearGradient(0,0,0,12);
    ewt.addColorStop(0,"rgba(140,100,40,.18)"); ewt.addColorStop(1,"rgba(140,100,40,0)");
    ctx.fillStyle=ewt; ctx.fillRect(x0,0,hw,14);
    const ewb=ctx.createLinearGradient(0,H-12,0,H);
    ewb.addColorStop(0,"rgba(140,100,40,0)"); ewb.addColorStop(1,"rgba(140,100,40,.18)");
    ctx.fillStyle=ewb; ctx.fillRect(x0,H-14,hw,14);
  }

  // ── Double border on each page ────────────────────────────────────────────
  const gold1="rgba(160,105,22,.55)", gold2="rgba(120,78,15,.35)";
  [[0,hw],[hw,hw]].forEach(([x0,w2])=>{
    const pm=w2*.044, pm2=w2*.060;
    ctx.strokeStyle=gold1; ctx.lineWidth=.9;
    ctx.strokeRect(x0+pm,H*.044,w2-pm*2,H*(1-.088));
    ctx.strokeStyle=gold2; ctx.lineWidth=.65;
    ctx.strokeRect(x0+pm2,H*.060,w2-pm2*2,H*(1-.12));
  });

  // ── Text: right page (odd) on right half, left page (even) on left half ──
  _drawPageText(ctx, rightAyahs, rightPn, hw, 0, hw, H);  // right half
  _drawPageText(ctx, leftAyahs,  leftPn,  0,  0, hw, H);  // left half

  return cvs;
}

function _drawPageText(ctx, ayahs, pn, x0, y0, w, h){
  if(!ayahs||!ayahs.length) return;

  const PAD  = Math.max(w*.078, 9);
  const PADt = Math.max(h*.065, 7);
  const BOT  = h - Math.max(h*.055, 6);
  const TW   = w - PAD*2;

  // Font — scales to available space, clamped for legibility
  const fs  = Math.max(Math.min(h/18.5, w/21, 17), 10);
  const lh  = fs * 1.52;
  const hfs = Math.max(fs*.56, 8);
  const bfs = Math.max(fs*.98, 11);

  // Top ornament rule
  ctx.save();
  ctx.strokeStyle="rgba(139,90,20,.30)"; ctx.lineWidth=.8;
  ctx.beginPath(); ctx.moveTo(x0+PAD*.85,y0+PADt-4); ctx.lineTo(x0+w-PAD*.85,y0+PADt-4); ctx.stroke();
  ctx.restore();

  let y=y0+PADt;

  // Group by surah
  const groups=[];
  (ayahs||[]).forEach(a=>{
    const last=groups[groups.length-1];
    if(!last||last.sn!==a.surah.number)
      groups.push({sn:a.surah.number,name:a.surah.name,eng:a.surah.englishName,ayahs:[]});
    groups[groups.length-1].ayahs.push(a);
  });

  for(const g of groups){
    if(g.ayahs[0]?.numberInSurah===1){
      y+=lh*.22;
      // header band
      ctx.save();
      const grd=ctx.createLinearGradient(x0+PAD,0,x0+w-PAD,0);
      grd.addColorStop(0,"rgba(139,90,20,.0)");
      grd.addColorStop(.3,"rgba(139,90,20,.09)");
      grd.addColorStop(.7,"rgba(139,90,20,.09)");
      grd.addColorStop(1,"rgba(139,90,20,.0)");
      ctx.fillStyle=grd;
      ctx.fillRect(x0+PAD*.7,y,w-PAD*1.4,lh*.92);

      ctx.strokeStyle="rgba(139,90,20,.32)"; ctx.lineWidth=.7;
      ctx.beginPath(); ctx.moveTo(x0+PAD*.75,y); ctx.lineTo(x0+w-PAD*.75,y); ctx.stroke();

      // English name left
      ctx.font=`italic ${hfs}px Georgia,serif`;
      ctx.fillStyle="rgba(65,35,5,.80)";
      ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.direction="ltr";
      ctx.fillText(g.eng.toUpperCase(), x0+PAD*.85, y+lh*.46);

      // Arabic name right
      ctx.font=`${Math.max(hfs*1.3,10)}px 'Amiri Quran','Scheherazade New',serif`;
      ctx.fillStyle="rgba(75,40,6,.82)";
      ctx.textAlign="right"; ctx.textBaseline="middle"; ctx.direction="rtl";
      ctx.fillText(g.name, x0+w-PAD*.85, y+lh*.46);

      y+=lh*.92;
      ctx.strokeStyle="rgba(139,90,20,.32)"; ctx.lineWidth=.7;
      ctx.beginPath(); ctx.moveTo(x0+PAD*.75,y); ctx.lineTo(x0+w-PAD*.75,y); ctx.stroke();
      ctx.restore();
      y+=lh*.22;

      // Basmala
      if(g.sn!==9 && y+bfs*1.5<y0+BOT){
        ctx.save();
        ctx.font=`${bfs}px 'Amiri Quran','Scheherazade New',serif`;
        ctx.fillStyle="rgba(24,10,2,.87)";
        ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.direction="rtl";
        ctx.fillText("\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u0651\u064e\u0647\u0650 \u0671\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0671\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650",
          x0+w/2, y+bfs*.55);
        ctx.restore();
        y+=lh*1.0;
      }
    }

    // Word-wrap ayahs
    ctx.font=`${fs}px 'Amiri Quran','Scheherazade New',serif`;
    const lines=[];
    let cur="";
    for(const a of g.ayahs){
      const words=a.text.split(" ");
      words.forEach((wd,wi)=>{
        const token = wi===words.length-1 ? wd+" ﴿"+a.numberInSurah+"﴾" : wd;
        const test  = cur ? cur+" "+token : token;
        ctx.font=`${fs}px 'Amiri Quran','Scheherazade New',serif`;
        if(ctx.measureText(test).width>TW && cur){ lines.push(cur); cur=token; }
        else cur=test;
      });
    }
    if(cur) lines.push(cur);

    ctx.save();
    ctx.font=`${fs}px 'Amiri Quran','Scheherazade New',serif`;
    ctx.fillStyle="rgba(18,7,2,.91)";
    ctx.direction="rtl"; ctx.textAlign="right"; ctx.textBaseline="alphabetic";
    for(const ln of lines){
      if(y+lh>y0+BOT) break;
      ctx.fillText(ln, x0+w-PAD, y+lh);
      y+=lh;
    }
    ctx.restore();
    y+=lh*.12;
  }

  // Page number + ornament
  const pnfs=Math.max(h*.027,7);
  ctx.save();
  ctx.strokeStyle="rgba(139,90,20,.26)"; ctx.lineWidth=.7;
  ctx.beginPath();
  ctx.moveTo(x0+PAD*.85,y0+BOT+3); ctx.lineTo(x0+w-PAD*.85,y0+BOT+3);
  ctx.stroke();

  const oy=y0+BOT+3+pnfs*1.1;
  const dd=pnfs*.38;
  ctx.fillStyle="rgba(120,78,18,.36)";
  [[x0+w/2-dd*5.5,oy],[x0+w/2+dd*5.5,oy]].forEach(([px2,py2])=>{
    ctx.beginPath();
    ctx.moveTo(px2,py2-dd*.65); ctx.lineTo(px2+dd*.65,py2);
    ctx.lineTo(px2,py2+dd*.65); ctx.lineTo(px2-dd*.65,py2);
    ctx.closePath(); ctx.fill();
  });

  ctx.font=`${pnfs}px 'Cinzel',Georgia,serif`;
  ctx.fillStyle="rgba(108,68,16,.46)";
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(String(pn), x0+w/2, oy);
  ctx.restore();
}

// ── Main component ────────────────────────────────────────────────────────────
function QuranBook3DPage({ surahs }) {
  const navigate = useNavigate();

  const cvs3 = React.useRef(null);  // single WebGL canvas
  const raf3 = React.useRef(null);
  const gl3  = React.useRef(null);
  const glState = React.useRef({
    pageProg: null, coverProg: null,
    buf: null, uvBuf: null,
    texCur: null, texNext: null,
  });

  const pd  = React.useRef({});    // pageNum → ayahs[] (null=loading)
  const tx0 = React.useRef(0);

  const SR = React.useRef({
    curl: 0, targetCurl: 0, dir: 1,
    spread: 0,
    flipping: false,
    time: 0,
    phase: "cover",   // "cover"|"open"
    texDirty: true,   // need to re-upload textures
  });

  const [sp,    setSp]    = React.useState(0);
  const [ph,    setPh]    = React.useState("cover");
  const [smenu, setSmenu] = React.useState(false);
  const [bm,    setBm]    = React.useState(()=>parseInt(localStorage.getItem("q3d_bm")||"0")||0);
  const [sz,    setSz]    = React.useState({w:860,h:522});
  const [ready, setReady] = React.useState(false);

  // Responsive size
  React.useEffect(()=>{
    const u=()=>{
      const vw=window.innerWidth, vh=window.innerHeight;
      const w=Math.min((vw-14)*.97, (vh-85)*1.63, 980);
      setSz({w:Math.round(w), h:Math.round(w/1.63)});
    };
    u(); window.addEventListener("resize",u);
    return()=>window.removeEventListener("resize",u);
  },[]);

  // ── Build and upload spread textures to WebGL ──────────────────────────────
  const uploadSpreadTex = React.useCallback((spread, which="cur")=>{
    const gl=gl3.current; const gls=glState.current;
    if(!gl||spread===0) return;
    const rp=2*spread-1, lp=Math.min(2*spread,_MUSHAF_PAGES);
    const rd=pd.current[rp], ld=pd.current[lp];
    if(!rd||!ld) return;  // not loaded yet
    const cvs=_renderSpread(ld, lp, rd, rp, sz.w, sz.h);
    const tex=which==="cur"?gls.texCur:gls.texNext;
    _uploadTex(gl,tex,cvs);
  },[sz.w, sz.h]);

  // ── Prefetch ──────────────────────────────────────────────────────────────
  const prefetch=React.useCallback(async(spread, onReady)=>{
    if(spread===0) return;
    const pages=[
      2*spread-1, 2*spread,
      2*spread+1, 2*spread+2,
      2*spread-3, 2*spread-2,
    ].filter(p=>p>=1&&p<=_MUSHAF_PAGES);

    const crit=[2*spread-1,2*spread].filter(p=>p>=1&&p<=_MUSHAF_PAGES);

    // load critical first
    await Promise.all(crit.map(async p=>{
      if(pd.current[p]!==undefined) return;
      pd.current[p]=null;
      try{
        const d=await fetch(`${_API3D}/page/${p}/quran-uthmani`).then(r=>r.json()).then(r=>r.data?.ayahs||[]);
        pd.current[p]=d;
      }catch{ pd.current[p]=[]; }
    }));

    if(onReady) onReady();

    // load rest in background
    for(const p of pages){
      if(pd.current[p]!==undefined) continue;
      pd.current[p]=null;
      try{
        const d=await fetch(`${_API3D}/page/${p}/quran-uthmani`).then(r=>r.json()).then(r=>r.data?.ayahs||[]);
        pd.current[p]=d;
      }catch{ pd.current[p]=[]; }
    }
  },[]);

  // ── WebGL init ────────────────────────────────────────────────────────────
  React.useEffect(()=>{
    const cvs=cvs3.current; if(!cvs)return;
    const gl=cvs.getContext("webgl",{antialias:true,alpha:false});
    if(!gl){console.error("WebGL not available");return;}
    gl3.current=gl;

    const gls=glState.current;
    gls.pageProg  = _cprog(gl,_VS3D,_PAGE_FS);
    gls.coverProg = _cprog(gl,_VS3D,_CVR_FS);

    // Full-screen quad
    const verts=new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]);
    const uvs  =new Float32Array([ 0, 1,  1, 1,  0,0,  1, 1, 1,0,  0,0]);
    gls.buf   = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,gls.buf);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);
    gls.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,gls.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER,uvs,gl.STATIC_DRAW);

    gls.texCur  = _makeTex(gl);
    gls.texNext = _makeTex(gl);

    let lastSp=-1, lastW=0, lastH=0;

    const draw=(ts)=>{
      const s=SR.current;
      s.time=ts*.001;

      // smooth curl
      const diff=s.targetCurl-s.curl;
      s.curl+=diff*(diff>0?.15:.18);
      if(Math.abs(diff)<.003){
        s.curl=s.targetCurl;
        if(s.targetCurl===1&&s.flipping){
          s.flipping=false; s.curl=0; s.targetCurl=0;
          s.spread+=s.dir>0?1:-1;
          s.spread=Math.max(1,Math.min(302,s.spread));
          s.texDirty=true;
          setSp(s.spread);
          setReady(false);
          prefetch(s.spread,()=>{
            uploadSpreadTex(s.spread,"cur");
            prefetch(s.spread+1,()=>uploadSpreadTex(s.spread+1,"next"));
            prefetch(s.spread-1,()=>uploadSpreadTex(s.spread-1,"next"));
            setReady(true);
          });
        }
      }

      // re-upload textures when spread changed or canvas resized
      if(s.phase==="open" && (s.spread!==lastSp||sz.w!==lastW||sz.h!==lastH)){
        lastSp=s.spread; lastW=sz.w; lastH=sz.h;
        uploadSpreadTex(s.spread,"cur");
      }

      gl.viewport(0,0,cvs.width,cvs.height);
      gl.clearColor(.028,.012,.003,1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const usePageProg = s.phase==="open";
      const prog = usePageProg ? gls.pageProg : gls.coverProg;
      gl.useProgram(prog);

      // bind vertex pos
      const aPos=gl.getAttribLocation(prog,"a_pos");
      gl.bindBuffer(gl.ARRAY_BUFFER,gls.buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);

      // bind uv (cover shader also has varying v_uv via a_pos*.5+.5, but page shader uses a_uv)
      const aUv=gl.getAttribLocation(prog,"a_uv");
      if(aUv>=0){
        gl.bindBuffer(gl.ARRAY_BUFFER,gls.uvBuf);
        gl.enableVertexAttribArray(aUv);
        gl.vertexAttribPointer(aUv,2,gl.FLOAT,false,0,0);
      }

      gl.uniform1f(gl.getUniformLocation(prog,"u_time"),s.time);

      if(usePageProg){
        gl.uniform1f(gl.getUniformLocation(prog,"u_curl"),s.curl);
        gl.uniform1f(gl.getUniformLocation(prog,"u_dir"),s.dir);

        // texCur → unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,gls.texCur);
        gl.uniform1i(gl.getUniformLocation(prog,"u_tex"),0);

        // texNext → unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D,gls.texNext);
        gl.uniform1i(gl.getUniformLocation(prog,"u_texNext"),1);
      }

      gl.drawArrays(gl.TRIANGLES,0,6);
      raf3.current=requestAnimationFrame(draw);
    };
    raf3.current=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(raf3.current);
  },[]); // eslint-disable-line

  // Resize canvas
  React.useEffect(()=>{
    const c=cvs3.current; if(!c)return;
    c.width=sz.w; c.height=sz.h;
    if(SR.current.phase==="open") uploadSpreadTex(SR.current.spread,"cur");
  },[sz,uploadSpreadTex]);

  // ── Open book ─────────────────────────────────────────────────────────────
  const openBook=React.useCallback(()=>{
    const s=SR.current; if(s.phase!=="cover")return;
    s.spread=1; s.phase="open"; setPh("open"); setSp(1); setReady(false);
    prefetch(1,()=>{
      uploadSpreadTex(1,"cur");
      prefetch(2,()=>uploadSpreadTex(2,"next"));
      setReady(true);
    });
  },[prefetch,uploadSpreadTex]);

  // ── Flip ──────────────────────────────────────────────────────────────────
  const startFlip=React.useCallback((dir)=>{
    const s=SR.current;
    if(s.flipping||s.phase!=="open") return;
    if(dir>0&&2*(s.spread+1)-1>_MUSHAF_PAGES) return;
    if(dir<0&&s.spread<=1) return;

    const next=s.spread+dir;
    const doFlip=()=>{
      // upload next spread to texNext before flipping
      uploadSpreadTex(next,"next");
      s.flipping=true; s.dir=dir; s.curl=0; s.targetCurl=1;
    };

    // ensure next spread is loaded
    const np=[2*next-1,2*next].filter(p=>p>=1&&p<=_MUSHAF_PAGES);
    const missing=np.filter(p=>pd.current[p]===undefined);
    if(missing.length===0){
      doFlip();
    } else {
      Promise.all(missing.map(async p=>{
        if(pd.current[p]!==undefined)return;
        pd.current[p]=null;
        try{
          const d=await fetch(`${_API3D}/page/${p}/quran-uthmani`).then(r=>r.json()).then(r=>r.data?.ayahs||[]);
          pd.current[p]=d;
        }catch{pd.current[p]=[];}
      })).then(doFlip);
    }
  },[uploadSpreadTex]);

  const flipFwd =React.useCallback(()=>startFlip(1), [startFlip]);
  const flipBwd =React.useCallback(()=>startFlip(-1),[startFlip]);

  const jumpTo=React.useCallback((pn)=>{
    const s=SR.current; if(s.phase!=="open")return;
    const p=Math.max(1,Math.min(_MUSHAF_PAGES,parseInt(pn)||1));
    s.spread=Math.ceil(p/2); s.curl=0; s.targetCurl=0; s.flipping=false;
    setSp(s.spread); setReady(false); setSmenu(false);
    prefetch(s.spread,()=>{
      uploadSpreadTex(s.spread,"cur");
      prefetch(s.spread+1,()=>uploadSpreadTex(s.spread+1,"next"));
      setReady(true);
    });
  },[prefetch,uploadSpreadTex]);

  // Keyboard
  React.useEffect(()=>{
    const h=e=>{if(e.key==="ArrowLeft")flipFwd();if(e.key==="ArrowRight")flipBwd();};
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[flipFwd,flipBwd]);

  const rp=2*sp-1, lp=Math.min(2*sp,_MUSHAF_PAGES);
  const BB={
    fontSize:9,letterSpacing:1.6,padding:"6px 14px",
    fontFamily:"'Cinzel',serif",
    background:"rgba(201,168,76,.07)",
    border:"1px solid rgba(201,168,76,.26)",
    color:"rgba(201,168,76,.68)",
    borderRadius:7,cursor:"pointer",transition:"all .18s",
  };
  const BBh=(e,on)=>{
    e.currentTarget.style.background=on?"rgba(201,168,76,.17)":"rgba(201,168,76,.07)";
    e.currentTarget.style.borderColor=on?"rgba(201,168,76,.52)":"rgba(201,168,76,.26)";
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",
      background:"radial-gradient(ellipse at 50% 28%,#1e0d03 0%,#060200 100%)",
      alignItems:"center",justifyContent:"space-between",
      overflow:"hidden",userSelect:"none",fontFamily:"'Cinzel',Georgia,serif"}}>

      {/* ambient floor */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"70%",height:55,pointerEvents:"none",
        background:"radial-gradient(ellipse,rgba(170,105,18,.13) 0%,transparent 70%)"}}/>

      {/* ── Top bar ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",
        maxWidth:sz.w+40,padding:"8px 16px",boxSizing:"border-box",flexShrink:0,
        background:"linear-gradient(to bottom,rgba(0,0,0,.42),transparent)",flexWrap:"wrap"}}>

        <button onClick={()=>navigate("/quran")} style={{...BB,flexShrink:0}}
          onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>← SOURATES</button>

        <div style={{fontFamily:"'Amiri Quran',serif",
          fontSize:Math.max(sz.w*.022,13),
          color:"rgba(201,168,76,.50)",direction:"rtl",flex:1,textAlign:"center",
          textShadow:"0 0 18px rgba(201,168,76,.18)"}}>القرآن الكريم</div>

        {ph==="open"&&<>
          {/* Surah picker */}
          <div style={{position:"relative",flexShrink:0}}>
            <button onClick={()=>setSmenu(v=>!v)} style={BB}
              onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>SOURATE ▾</button>
            {smenu&&(
              <div style={{position:"absolute",top:"115%",right:0,zIndex:200,
                background:"linear-gradient(160deg,#150902,#0d0500)",
                border:"1px solid rgba(201,168,76,.20)",borderRadius:10,
                maxHeight:260,overflowY:"auto",minWidth:220,
                boxShadow:"0 14px 55px rgba(0,0,0,.9)"}}>
                {surahs.map(s=>(
                  <div key={s.number}
                    onClick={()=>jumpTo(s.startPage||(s.number*2-1))}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",
                      cursor:"pointer",borderBottom:"1px solid rgba(201,168,76,.05)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(201,168,76,.1)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{fontSize:8,color:"rgba(201,168,76,.36)",minWidth:18,flexShrink:0}}>{s.number}</span>
                    <span style={{fontFamily:"'Amiri Quran',serif",fontSize:14,color:"#c9a84c",direction:"rtl"}}>{s.name}</span>
                    <span style={{fontSize:7,color:"rgba(201,168,76,.30)",marginLeft:"auto",flexShrink:0}}>{s.englishName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bookmark */}
          <button onClick={()=>{setBm(rp);localStorage.setItem("q3d_bm",String(rp));}}
            style={{...BB,fontSize:13,padding:"3px 7px",flexShrink:0,
              color:bm===rp?"#c0392b":"rgba(201,168,76,.35)"}}>🔖</button>
          {bm>0&&bm!==rp&&(
            <button onClick={()=>jumpTo(bm)} style={{...BB,flexShrink:0}}
              onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>p.{bm}</button>
          )}

          {/* Page jump */}
          <input type="number" defaultValue={rp} key={rp}
            onKeyDown={e=>e.key==="Enter"&&jumpTo(e.target.value)}
            onBlur={e=>jumpTo(e.target.value)}
            style={{width:44,textAlign:"center",background:"rgba(0,0,0,.22)",
              border:"1px solid rgba(201,168,76,.20)",borderRadius:6,
              padding:"4px 4px",color:"#c9a84c",fontSize:11,
              fontFamily:"'Cinzel',serif",outline:"none",flexShrink:0}}/>
          <span style={{fontSize:7,color:"rgba(201,168,76,.26)",flexShrink:0}}>/604</span>

          {/* Loading dot */}
          {!ready&&<div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,
            background:"rgba(201,168,76,.55)",
            animation:"q3dpulse 1s ease-in-out infinite"}}/>}
        </>}
      </div>

      {/* ── Book scene ── */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
        width:"100%",position:"relative"}}
        onTouchStart={e=>{tx0.current=e.touches[0].clientX;}}
        onTouchEnd={e=>{
          const dx=e.changedTouches[0].clientX-tx0.current;
          if(dx<-55)flipFwd(); if(dx>55)flipBwd();
        }}>

        <div style={{perspective:3600,perspectiveOrigin:"50% 38%",
          display:"flex",alignItems:"center",justifyContent:"center",
          width:sz.w+80,height:sz.h+60}}>

          <div style={{position:"relative",width:sz.w,height:sz.h,
            transform:ph==="cover"
              ? "rotateX(8deg) rotateY(-5deg)"
              : "rotateX(5deg) rotateY(0deg)",
            transformStyle:"preserve-3d",
            transition:"transform .7s cubic-bezier(.4,0,.2,1)",
            filter:`drop-shadow(0 ${sz.h*.11}px ${sz.h*.16}px rgba(0,0,0,.97))
                    drop-shadow(0 ${sz.h*.03}px ${sz.h*.05}px rgba(0,0,0,.70))`,
            cursor:ph==="cover"?"pointer":"default"}}
            onClick={ph==="cover"?openBook:undefined}>

            {/* ── Single WebGL canvas — renders everything ── */}
            <canvas ref={cvs3} width={sz.w} height={sz.h}
              style={{position:"absolute",top:0,left:0,display:"block",
                borderRadius:"1px 2px 2px 1px"}}/>

            {/* 3D Spine overlay (DOM element for depth) */}
            {ph==="open"&&(
              <div style={{position:"absolute",top:0,bottom:0,left:"50%",
                width:26,transform:"translateX(-50%) translateZ(1px)",
                zIndex:40,pointerEvents:"none",
                background:"linear-gradient(to right,#060200 0%,#321203 17%,#8a3a0e 33%,#d08c38 50%,#8a3a0e 67%,#321203 83%,#060200 100%)",
                boxShadow:"0 0 22px rgba(0,0,0,.88),inset 0 0 7px rgba(255,195,75,.10)"}}>
                <div style={{position:"absolute",inset:0,background:"repeating-linear-gradient(to bottom,transparent 0,transparent 22px,rgba(255,182,50,.06) 22px,rgba(255,182,50,.06) 23px)"}}/>
                <div style={{position:"absolute",top:0,bottom:0,left:"15%",width:1,background:"rgba(255,205,95,.10)"}}/>
                <div style={{position:"absolute",top:0,bottom:0,right:"15%",width:1,background:"rgba(255,205,95,.10)"}}/>
              </div>
            )}

            {/* Cover boards (top / bottom 3D depth) */}
            <div style={{position:"absolute",top:-6,left:3,right:3,height:7,
              background:"linear-gradient(135deg,#380d04,#7a2b0a,#380d04)",
              borderRadius:"2px 2px 0 0",
              boxShadow:"0 -3px 8px rgba(0,0,0,.65)"}}/>
            <div style={{position:"absolute",bottom:-6,left:3,right:3,height:7,
              background:"linear-gradient(135deg,#380d04,#7a2b0a,#380d04)",
              borderRadius:"0 0 2px 2px",
              boxShadow:"0 3px 8px rgba(0,0,0,.65)"}}/>

            {/* Click zones */}
            {ph==="open"&&<>
              <div onClick={flipBwd}
                style={{position:"absolute",top:0,right:0,width:"45%",height:"100%",
                  zIndex:50,cursor:"pointer"}}
                title="Page précédente (→)"/>
              <div onClick={flipFwd}
                style={{position:"absolute",top:0,left:0,width:"45%",height:"100%",
                  zIndex:50,cursor:"pointer"}}
                title="Page suivante (←)"/>
            </>}

            {/* Cover CTA */}
            {ph==="cover"&&(
              <div style={{position:"absolute",bottom:"19%",left:0,right:0,
                textAlign:"center",zIndex:60,pointerEvents:"none"}}>
                <div style={{display:"inline-block",
                  fontSize:Math.max(sz.w*.009,8),
                  letterSpacing:Math.max(sz.w*.003,2.5),
                  color:"rgba(201,168,76,.72)",
                  border:"1px solid rgba(201,168,76,.24)",
                  padding:`${Math.max(sz.h*.008,4)}px ${Math.max(sz.w*.02,13)}px`,
                  borderRadius:30,background:"rgba(0,0,0,.38)",
                  textShadow:"0 0 14px rgba(201,168,76,.40)",
                  animation:"q3dpulse 2.6s ease-in-out infinite"}}>
                  OUVRIR LE LIVRE
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side arrow hints */}
        {ph==="open"&&<>
          {[{side:"right",dir:-1,char:"›"},{side:"left",dir:1,char:"‹"}].map(({side,dir,char})=>(
            <div key={side}
              onClick={dir>0?flipFwd:flipBwd}
              style={{position:"absolute",[side]:Math.max(sz.w*.004,5),
                top:"50%",transform:"translateY(-50%)",zIndex:100,cursor:"pointer",
                fontSize:Math.max(sz.w*.03,20),color:"rgba(201,168,76,.17)",
                transition:"color .22s,transform .22s",userSelect:"none"}}
              onMouseEnter={e=>{e.currentTarget.style.color="rgba(201,168,76,.65)";e.currentTarget.style.transform="translateY(-50%) scale(1.18)";}}
              onMouseLeave={e=>{e.currentTarget.style.color="rgba(201,168,76,.17)";e.currentTarget.style.transform="translateY(-50%) scale(1)";}}>
              {char}
            </div>
          ))}
        </>}
      </div>

      {/* ── Bottom nav ── */}
      {ph==="open"&&(
        <div style={{display:"flex",alignItems:"center",gap:12,
          padding:"8px 0 14px",flexShrink:0,flexWrap:"wrap",justifyContent:"center"}}>
          <button style={BB} onClick={flipBwd} disabled={sp<=1}
            onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>→ PRÉC.</button>
          <div style={{textAlign:"center",minWidth:80}}>
            <div style={{fontSize:10,letterSpacing:2,color:"rgba(201,168,76,.48)"}}>
              {rp}{lp<=_MUSHAF_PAGES?"–"+lp:""}
            </div>
            <div style={{width:86,height:2,background:"rgba(201,168,76,.10)",
              borderRadius:2,marginTop:4,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:2,
                background:"linear-gradient(to right,#7a3c0a,#c9a84c)",
                width:`${(rp/_MUSHAF_PAGES)*100}%`,transition:"width .5s"}}/>
            </div>
          </div>
          <button style={BB} onClick={flipFwd} disabled={lp>=_MUSHAF_PAGES}
            onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>SUIV. ←</button>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Amiri+Quran&display=swap');
        @keyframes q3dpulse{0%,100%{opacity:.48;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(201,168,76,.22);border-radius:2px}
      `}</style>
    </div>
  );
}



// ─── UnknownWordQuestion ──────────────────────────────────────────────────────
// Shows full ayat with the unknown word replaced by ▢▢▢ — user types the word
function UnknownWordQuestion({ q, onAnswer }) {
  const answerWords = React.useMemo(() => (q.answer || '').split('|').filter(Boolean), [q.answer]);
  const isMulti = answerWords.length > 1;
  const [vals,      setVals]     = React.useState(() => answerWords.map(() => ''));
  const [shaken,    setShaken]   = React.useState(false);
  const [revealed,  setRevealed] = React.useState(false);
  const [checked,   setChecked]  = React.useState(false);
  const [correctArr,setCorrectArr] = React.useState([]); // per-word correctness

  const correct = correctArr.length > 0 && correctArr.every(Boolean);

  const _normQ = s => s.trim().replace(/[ؐ-ًؚ-ٰٟۖ-ۭ\u200c]/g,'').replace(/أ|إ|آ/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي');

  const setValAt = (i, v) => setVals(prev => prev.map((p, pi) => pi === i ? v : p));

  const submit = () => {
    if (vals.some(v => !v.trim())) return;
    const results = answerWords.map((w, i) => _normQ(vals[i]) === _normQ(w));
    if (results.some(r => !r)) { setShaken(true); setTimeout(() => setShaken(false), 500); }
    setCorrectArr(results);
    setChecked(true);
  };

  const reveal = () => { setRevealed(true); setChecked(true); setCorrectArr(answerWords.map(() => false)); };

  const proceed = (removeRevise) => onAnswer(correct, removeRevise);

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:12, alignItems:'center' }}>
      {/* Ayat with masked word(s) */}
      <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:20, direction:'rtl',
        textAlign:'center', color:'var(--text1)', padding:'12px 16px', width:'100%',
        background:'var(--surface3)', borderRadius:9, border:'1px solid var(--border)', lineHeight:2.4 }}>
        {q.questionData}
      </div>

      {!checked ? (
        <>
          <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
            {answerWords.map((_, i) => (
              <input key={i} autoFocus={i === 0} value={vals[i]}
                onChange={e => setValAt(i, e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder={isMulti ? `Mot manquant ${i+1}/${answerWords.length}…` : "Écris le mot arabe manquant…"}
                dir="rtl"
                style={{ width:'100%', padding:'10px 14px', fontSize:18,
                  fontFamily:"'Amiri Quran',serif", direction:'rtl', textAlign:'center',
                  background:'var(--surface3)', border:`1px solid ${shaken?'var(--red)':'var(--border2)'}`,
                  borderRadius:8, color:'var(--text1)', outline:'none',
                  animation: shaken ? 'qshake .4s' : 'none' }} />
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={submit}
              style={{ padding:'8px 22px', background:'var(--teal)', border:'none',
                borderRadius:7, color:'#fff', fontSize:9, letterSpacing:2,
                fontFamily:"'Cinzel',serif", cursor:'pointer' }}>VALIDER</button>
            <button onClick={reveal}
              style={{ padding:'8px 16px', background:'transparent',
                border:'1px solid var(--border2)', borderRadius:7,
                color:'var(--text3)', fontSize:9, letterSpacing:1,
                fontFamily:"'Cinzel',serif", cursor:'pointer' }}>{isMulti ? 'VOIR LES MOTS' : 'VOIR LE MOT'}</button>
          </div>
        </>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%', alignItems:'center' }}>
          {/* Feedback */}
          <div style={{ fontSize:13, fontFamily:"'Cinzel',serif", letterSpacing:1,
            color: correct ? 'var(--green)' : 'var(--red)' }}>
            {correct ? '✓ EXACT !' : revealed ? (isMulti ? '📖 RÉPONSES :' : '📖 RÉPONSE :') : (isMulti ? '✗ Réponses :' : '✗ Réponse :')}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center' }}>
            {answerWords.map((w, i) => (
              <div key={i} style={{ fontFamily:"'Amiri Quran',serif", fontSize:24, direction:'rtl', textAlign:'center',
                padding:'10px 18px', borderRadius:8,
                background: correctArr[i] ? 'rgba(76,175,129,.08)' : 'rgba(201,168,76,.07)',
                border: `1px solid ${correctArr[i] ? 'var(--green)' : 'var(--gold)'}`,
                color: correctArr[i] ? 'var(--green)' : 'var(--gold2)' }}>
                {w}
                {isMulti && <span style={{fontSize:11,marginRight:6}}>{correctArr[i] ? ' ✓' : (revealed ? '' : ' ✗')}</span>}
              </div>
            ))}
          </div>

          {/* If toRevise: ask whether to keep or remove from à-réviser */}
          {q.toRevise ? (
            <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'center', width:'100%' }}>
              <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>
                🔖 RETIRER DE LA LISTE À RÉVISER ?
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => proceed(true)}
                  style={{ padding:'7px 16px', background:'rgba(76,175,129,.1)',
                    border:'1px solid var(--green)', borderRadius:7, color:'var(--green)',
                    fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
                  ✓ OUI — MAÎTRISÉ
                </button>
                <button onClick={() => proceed(false)}
                  style={{ padding:'7px 16px', background:'rgba(255,80,80,.08)',
                    border:'1px solid var(--red)', borderRadius:7, color:'var(--red)',
                    fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
                  🔖 GARDER
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', gap:10 }}>
              {!correct && (
                <button onClick={() => onAnswer(false)}
                  style={{ padding:'7px 18px', background:'rgba(255,80,80,.12)',
                    border:'1px solid var(--red)', borderRadius:7, color:'var(--red)',
                    fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
                  ✗ À REVOIR
                </button>
              )}
              <button onClick={() => onAnswer(correct)}
                style={{ padding:'7px 18px', background: correct ? 'rgba(76,175,129,.12)' : 'rgba(255,255,255,.05)',
                  border:`1px solid ${correct ? 'var(--green)' : 'var(--border2)'}`,
                  borderRadius:7, color: correct ? 'var(--green)' : 'var(--text3)',
                  fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
                {correct ? '✓ CONTINUER' : 'CONTINUER →'}
              </button>
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes qshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}60%{transform:translateX(6px)}80%{transform:translateX(-3px)}}`}</style>
    </div>
  );
}

// ─── UnknownPickQuestion ──────────────────────────────────────────────────────
// Shows full ayat → user picks which words they don't know (multi-select MCQ)
// Correct = selecting exactly the unknown words
function UnknownPickQuestion({ q, onAnswer }) {
  const [selected, setSelected] = React.useState(new Set());
  const [checked,  setChecked]  = React.useState(false);
  const [result,   setResult]   = React.useState(null); // true/false

  const correctSet = new Set((q.answer || '').split('|').filter(Boolean));

  const toggle = (w) => {
    if (checked) return;
    setSelected(prev => {
      const n = new Set(prev);
      n.has(w) ? n.delete(w) : n.add(w);
      return n;
    });
  };

  const check = () => {
    // correct if selected set equals correctSet — empty selection is a valid
    // submission (e.g. no unknown/marked words left), not blocked anymore
    const correct = selected.size === correctSet.size &&
      [...selected].every(w => correctSet.has(w));
    setResult(correct);
    setChecked(true);
  };

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:12, alignItems:'center' }}>
      {/* Full ayat display */}
      <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:20, direction:'rtl',
        textAlign:'center', color:'var(--text1)', padding:'12px 16px', width:'100%',
        background:'var(--surface3)', borderRadius:9, border:'1px solid var(--border)', lineHeight:2.4 }}>
        {q.questionData}
      </div>

      {/* Word chips */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center',
        direction:'rtl', width:'100%' }}>
        {(q.options || []).map((w, i) => {
          const isSel  = selected.has(w);
          const isCorr = checked && correctSet.has(w);
          const isWrong= checked && isSel && !correctSet.has(w);
          const isMissed=checked && !isSel && correctSet.has(w);
          return (
            <button key={i} onClick={() => toggle(w)}
              style={{
                fontFamily:"'Amiri Quran',serif", fontSize:18, direction:'rtl',
                padding:'6px 14px', borderRadius:8, cursor: checked?'default':'pointer',
                border: isCorr  ? '2px solid var(--green)'
                      : isWrong ? '2px solid var(--red)'
                      : isMissed? '2px dashed var(--gold)'
                      : isSel   ? '2px solid var(--teal)'
                      :           '1px solid var(--border2)',
                background: isCorr   ? 'rgba(76,175,129,.15)'
                           : isWrong  ? 'rgba(255,80,80,.12)'
                           : isMissed ? 'rgba(201,168,76,.10)'
                           : isSel    ? 'rgba(62,184,160,.12)'
                           :            'var(--surface3)',
                color:'var(--text1)',
                transition:'all .15s',
              }}>
              {w}
              {isCorr  && <span style={{fontSize:9,marginRight:4,color:'var(--green)'}}> ✓</span>}
              {isWrong && <span style={{fontSize:9,marginRight:4,color:'var(--red)'}}>  ✗</span>}
              {isMissed&& <span style={{fontSize:9,marginRight:4,color:'var(--gold)'}}>  !</span>}
            </button>
          );
        })}
      </div>

      {/* Hint */}
      <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:.5 }}>
        {checked ? '' : q.toRevise
          ? `Sélectionne ${correctSet.size} mot${correctSet.size>1?'s':''} marqué${correctSet.size>1?'s':''} à réviser`
          : `Sélectionne ${correctSet.size} mot${correctSet.size>1?'s':''} inconnu${correctSet.size>1?'s':''}`}
      </div>

      {/* Actions */}
      {!checked ? (
        <button onClick={check}
          style={{ padding:'8px 24px', background:'var(--teal)',
            border:'none', borderRadius:7, color:'#fff',
            fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
            cursor:'pointer', transition:'all .2s' }}>
          VALIDER
        </button>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'center' }}>
          <div style={{ fontSize:11, letterSpacing:1,
            color: result?'var(--green)':'var(--red)',
            fontFamily:"'Cinzel',serif" }}>
            {result ? '✓ EXACT !' : '✗ PAS TOUT À FAIT'}
          </div>
          {!result && (
            <div style={{ color:'var(--text3)', textAlign:'center', direction:'rtl',
              fontFamily:"'Amiri Quran',serif", fontSize:14 }}>
              {correctSet.size === 0
                ? (q.toRevise ? 'Aucun mot marqué à réviser' : 'Aucun mot inconnu')
                : `${q.toRevise ? 'Mots à réviser' : 'Mots inconnus'} : ${[...correctSet].join('  ·  ')}`}
            </div>
          )}
          {/* If toRevise: ask whether to keep or remove from à-réviser */}
          {q.toRevise ? (
            <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'center', width:'100%' }}>
              <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>
                🔖 RETIRER DE LA LISTE À RÉVISER ?
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => onAnswer(result, true)}
                  style={{ padding:'7px 16px', background:'rgba(76,175,129,.1)',
                    border:'1px solid var(--green)', borderRadius:7, color:'var(--green)',
                    fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
                  ✓ OUI — MAÎTRISÉ
                </button>
                <button onClick={() => onAnswer(result, false)}
                  style={{ padding:'7px 16px', background:'rgba(255,80,80,.08)',
                    border:'1px solid var(--red)', borderRadius:7, color:'var(--red)',
                    fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
                  🔖 GARDER
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => onAnswer(result)}
              style={{ padding:'7px 22px', background:'var(--surface3)',
                border:'1px solid var(--border2)', borderRadius:7, color:'var(--text3)',
                fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
              CONTINUER →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── RevisePartQuestion ───────────────────────────────────────────────────────
function RevisePartQuestion({ q, onAnswer }) {
  const [revealed, setRevealed] = React.useState(false);
  const audioRef = React.useRef(null);

  const partWords = q.partText ? q.partText.split(' ').filter(Boolean) : [];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, alignItems:'center', width:'100%' }}>
      {/* Context: full ayat text with part highlighted */}
      {q.questionData && (
        <div style={{ direction:'rtl', fontFamily:"'Amiri Quran',serif", fontSize:17,
          textAlign:'center', lineHeight:1.9, color:'var(--text3)',
          background:'var(--surface3)', borderRadius:8, padding:'10px 14px', width:'100%' }}>
          {q.questionData.split(' ').filter(Boolean).map((w, i) => {
            const partWs = q.partText?.split(' ').filter(Boolean) || [];
            const startIdx = q.questionData.split(' ').filter(Boolean).findIndex((_, si) =>
              q.questionData.split(' ').filter(Boolean).slice(si, si + partWs.length).join(' ') === q.partText
            );
            const inPart = startIdx >= 0 && i >= startIdx && i < startIdx + partWs.length;
            return (
              <span key={i} style={{ color: inPart ? '#c878ff' : 'var(--text3)',
                background: inPart ? 'rgba(200,120,255,.08)' : 'transparent',
                borderRadius:3, padding:'0 2px', marginLeft:4 }}>{w}</span>
            );
          })}
        </div>
      )}

      {!revealed ? (
        <>
          <div style={{ fontSize:9, letterSpacing:1.5, color:'#c878ff', fontFamily:"'Cinzel',serif" }}>
            PARTIE {q.partIdx + 1} · {partWords.length} MOTS
          </div>
          <div style={{ fontSize:9, color:'var(--text3)', textAlign:'center', lineHeight:1.6 }}>
            Récite cette partie de mémoire, puis révèle pour vérifier
          </div>
          <button onClick={() => setRevealed(true)}
            style={{ padding:'8px 28px', background:'rgba(200,120,255,.12)',
              border:'1px solid #c878ff', borderRadius:7, color:'#c878ff',
              fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
            RÉVÉLER
          </button>
        </>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10, alignItems:'center', width:'100%' }}>
          <div style={{ direction:'rtl', fontFamily:"'Amiri Quran',serif", fontSize:22,
            textAlign:'center', lineHeight:2, color:'var(--text1)',
            background:'rgba(200,120,255,.06)', borderRadius:8, padding:'12px 16px', width:'100%',
            border:'1px solid rgba(200,120,255,.2)' }}>
            {q.partText}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => onAnswer(false)}
              style={{ padding:'7px 20px', background:'rgba(229,115,115,.1)',
                border:'1px solid var(--red)', borderRadius:7, color:'var(--red)',
                fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
              ✗ À REVOIR
            </button>
            <button onClick={() => onAnswer(true)}
              style={{ padding:'7px 20px', background:'rgba(76,175,129,.1)',
                border:'1px solid var(--green)', borderRadius:7, color:'var(--green)',
                fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
              ✓ SU
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PageStructureQuestion ────────────────────────────────────────────────────
function PageStructureQuestion({ q, onAnswer, ayatTexts, globalNums, timestamps, sn }) {
  const [input, setInput]   = React.useState('');
  const [checked, setChecked] = React.useState(false);
  const [correct, setCorrect] = React.useState(false);
  const audioRefs = React.useRef({});

  const check = () => {
    const ok = input.trim() === q.answer.trim();
    setCorrect(ok); setChecked(true);
  };

  // Determine which ayat numbers are relevant for this question
  const relevantAyatNums = React.useMemo(() => {
    if (!checked) return [];
    const { subtype, first, last, multi10, multi5 } = q;
    if (subtype === 'first')    return [first];
    if (subtype === 'last')     return [last];
    if (subtype === 'findpage') {
      const m = q.id?.match(/:findpage:(\d+)$/);
      return m ? [parseInt(m[1])] : [];
    }
    if (subtype === 'multi10')  return multi10 || [];
    if (subtype === 'multi5')   return (multi5 || []).filter(n => n % 10 !== 0);
    if (subtype === 'count')    return [first, last].filter(Boolean);
    return [];
  }, [checked, q]);

  const playAyat = (ayatNum) => {
    const globalNum = globalNums?.[`${sn}:${ayatNum}`];
    if (!globalNum) return;
    const url = `${getAudioBase()}/${globalNum}.mp3`;
    let audio = audioRefs.current[ayatNum];
    if (!audio) { audio = new Audio(url); audioRefs.current[ayatNum] = audio; }
    else audio.src = url;
    audio.currentTime = 0; audio.play().catch(() => {});
  };

  // Page summary card
  const Summary = () => (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, justifyContent:'center', marginTop:4 }}>
      {[
        { label:'PAGE',    val: q.page,    color:'#c878ff' },
        { label:'PREMIER', val: q.first,   color:'var(--gold2)' },
        { label:'DERNIER', val: q.last,    color:'var(--gold2)' },
        { label:'NB AYATS',val: q.count,   color:'#5bc8f5' },
        q.hizb != null && { label:'HIZB',  val: q.hizb,    color:'#ffd166' },
        q.juz  != null && { label:'JUZ',   val: q.juz,     color:'#a8edea' },
        q.multi10?.length && { label:'× 10', val: q.multi10.join(', '), color:'#ff9f43' },
        q.multi5?.filter(n=>n%10!==0).length && { label:'× 5', val: q.multi5.filter(n=>n%10!==0).join(', '), color:'#ffeaa7' },
      ].filter(Boolean).map(({ label, val, color }) => (
        <div key={label} style={{ display:'flex', flexDirection:'column', alignItems:'center',
          background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)',
          borderRadius:7, padding:'5px 12px', minWidth:52 }}>
          <div style={{ fontSize:13, fontWeight:700, color, fontFamily:"'Cinzel',serif", lineHeight:1 }}>{val}</div>
          <div style={{ fontSize:7, letterSpacing:1.5, color:'var(--text3)', marginTop:3 }}>{label}</div>
        </div>
      ))}
    </div>
  );

  // Ayat card with text + audio
  const AyatCard = ({ ayatNum }) => {
    const text = ayatTexts?.[`${sn}:${ayatNum}`] || '';
    if (!text) return null;
    return (
      <div style={{ width:'100%', background:'var(--surface3)', border:'1px solid var(--border)',
        borderRadius:9, padding:'10px 14px', display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>
            VERSET {ayatNum}
          </div>
          <button onClick={() => playAyat(ayatNum)}
            style={{ width:30, height:30, borderRadius:'50%', border:'none',
              background:'rgba(62,184,160,.15)', color:'var(--teal2)',
              fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            ▶
          </button>
        </div>
        <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:20, direction:'rtl',
          textAlign:'right', color:'var(--text1)', lineHeight:2 }}>
          {text}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, alignItems:'center', width:'100%' }}>
      {!checked ? (
        <>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && input.trim() && check()}
            placeholder="Votre réponse…"
            style={{ width:'100%', maxWidth:220, textAlign:'center', padding:'9px 12px',
              background:'var(--surface3)', border:'1px solid var(--border2)',
              borderRadius:8, color:'var(--text1)', fontSize:15, outline:'none',
              fontFamily:"'Cinzel',serif" }} />
          <button onClick={check} disabled={!input.trim()}
            style={{ padding:'8px 28px', background: input.trim() ? 'var(--teal)' : 'var(--surface3)',
              border:'none', borderRadius:7, color: input.trim() ? '#fff' : 'var(--text3)',
              fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              cursor: input.trim() ? 'pointer' : 'default', transition:'all .2s' }}>
            VALIDER
          </button>
        </>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10, alignItems:'center', width:'100%' }}>
          <div style={{ fontSize:13, letterSpacing:1, fontFamily:"'Cinzel',serif",
            color: correct ? 'var(--green)' : 'var(--red)' }}>
            {correct ? '✓ EXACT !' : `✗ Réponse : ${q.answer}`}
          </div>
          <Summary />
          {/* Show relevant ayats */}
          {relevantAyatNums.length > 0 && (
            <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:8, marginTop:4 }}>
              <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)', textAlign:'center' }}>VERSETS</div>
              {relevantAyatNums.map(n => <AyatCard key={n} ayatNum={n} />)}
            </div>
          )}
          <button onClick={() => onAnswer(correct)}
            style={{ padding:'7px 22px', background:'var(--surface3)',
              border:'1px solid var(--border2)', borderRadius:7, color:'var(--text3)',
              fontSize:9, letterSpacing:1, fontFamily:"'Cinzel',serif", cursor:'pointer', marginTop:4 }}>
            CONTINUER →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── QuestionsMode ────────────────────────────────────────────────────────────
// Per-ayat questions to test real mastery. Called from MemoriseMode after session
// or standalone. Persists answers in learnData[key].questionScores[questionId][].
function QuestionsMode({ selectedSn, ayatList, surahs, learnData, setLData, ayatTexts, randomize, selectedQTypes, initialQIdx, onQIdxChange, onDone, multiItems, skipCorrect }) {
  // ── Session persistence ──────────────────────────────────────────────────────
  const _items = multiItems || (ayatList||[]).map(n => ({ sn: selectedSn, ayatNum: n }));
  const Q_KEY = multiItems ? `quran_questions_multi_${_items.length}` : `quran_questions_${selectedSn}_${ayatList[0]}_${ayatList[ayatList.length-1]}`;
  const loadQSession  = () => { try { return JSON.parse(localStorage.getItem(Q_KEY)) || null; } catch { return null; } };
  const saveQSession  = (data) => { try { localStorage.setItem(Q_KEY, JSON.stringify(data)); } catch {} };
  const clearQSession = () => { try { localStorage.removeItem(Q_KEY); } catch {} };

  const saved = React.useMemo(() => loadQSession(), []);

  const [results,   setResults]   = React.useState(() => saved?.results ?? []);
  const [revealed,  setRevealed]  = React.useState(false);
  const [done,      setDone]      = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [emptyTimeout, setEmptyTimeout] = React.useState(false);
  const [globalNums, setGlobalNums] = React.useState({}); // numberInSurah -> globalNumber
  const [timestamps, setTimestamps] = React.useState(null); // {ayatNum: tsData}
  const [pageAyatData, setPageAyatData] = React.useState({}); // { sn: [{numberInSurah, page, hizbQuarter}] }
  // Persist the shuffled question order so resume gives same sequence
  const [savedOrder, setSavedOrder] = React.useState(() => saved?.questionOrder ?? null);
  const [currentQId, setCurrentQId] = React.useState(() => saved?.currentQId ?? null);
  const audioRef = React.useRef(null);

  // Load global ayat numbers + timestamps once (mono + multi)
  React.useEffect(() => {
    const sns = multiItems ? [...new Set(multiItems.map(i => i.sn))] : (selectedSn ? [selectedSn] : []);
    sns.forEach(sn => {
      fetchAyats(sn).then(data => {
        const m = {};
        (data?.ayahs || []).forEach(a => { m[`${sn}:${a.numberInSurah}`] = a.number; });
        setGlobalNums(p => ({ ...p, ...m }));
      }).catch(() => {});
      loadTimestampsForSurah(sn, getGlobalRecitator()).then(ts => { if (ts) setTimestamps(p => ({ ...p, [sn]: ts })); }).catch(() => {});
      fetchSurahDefault(sn).then(ayahs => {
        setPageAyatData(p => ({ ...p, [sn]: ayahs.map(a => ({ numberInSurah: a.numberInSurah, page: a.page, hizbQuarter: a.hizbQuarter, juz: a.juz })) }));
      }).catch(() => {});
    });
  }, [selectedSn, multiItems?.length]);

  React.useEffect(() => {
    setRevealed(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setIsPlaying(false);
  }, [currentQId]);

  // Cleanup on unmount
  React.useEffect(() => () => { audioRef.current?.pause(); }, []);

  const surahInfo  = surahs.find(s => s.number === selectedSn);
  const maxAyat    = surahInfo?.numberOfAyahs ?? 1;

  // Build question list: 2 questions per ayat
    const questions = React.useMemo(() => {        const qs = [];

        _items.forEach(({ sn: itemSn, ayatNum }) => {
            const effectiveSn = itemSn ?? selectedSn;
            const rawText = ayatTexts[`${effectiveSn}:${ayatNum}`] || "";
            const text = (() => {
              if (ayatNum === 1 && effectiveSn !== 1 && effectiveSn !== 9 && rawText) {
                const ws = rawText.trim().split(' ');
                const stripD = s => s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');
                if (ws.length > 4 && stripD(ws[0]) === 'بسم') return ws.slice(4).join(' ');
              }
              return rawText;
            })();
            const words = text.split(/\s+/).filter(Boolean);
            const surahObj  = surahs.find(s => s.number === effectiveSn);
            const surahLabel = surahObj ? `${surahObj.englishName} · ${surahObj.name}` : `S.${effectiveSn}`;
            const vLabel = `verset ${ayatNum} · ${surahLabel}`;

            // 1. Premier mot
            if (words.length > 0) {
                qs.push({
                    id: `${effectiveSn}:${ayatNum}:first_word`,
                    sn: effectiveSn, type: "first_word",
                    ayatNum,
                    question: `Quel est le premier mot du ${vLabel} ?`,
                    answer: words[0],
                    hint:
                        words.length > 1
                            ? words.slice(1, 4).join(" ") + (words.length > 4 ? "..." : "")
                            : ""
                });
            }

            // 2. Dernier mot
            if (words.length > 1) {
                qs.push({
                    id: `${effectiveSn}:${ayatNum}:last_word`,
                    sn: effectiveSn, type: "last_word",
                    ayatNum,
                    question: `Quel est le dernier mot du ${vLabel} ?`,
                    answer: words[words.length - 1],
                    hint: words.slice(Math.max(0, words.length - 4), -1).join(" ")
                });
            }

            // 3. Mot manquant
            if (words.length >= 4) {
                const idx = Math.floor(words.length / 2);

                qs.push({
                    id: `${effectiveSn}:${ayatNum}:missing_word`,
                    sn: effectiveSn, type: "missing_word",
                    ayatNum,
                    question: `Quel mot manque dans le ${vLabel} ?`,
                    answer: words[idx],
                    questionData: words
                        .map((w, i) => (i === idx ? "____" : w))
                        .join(" "),
                    hint: words
                        .map((w, i) => (i === idx ? "____" : w))
                        .join(" ")
                });
            }

            // 4. Verset suivant
            if (ayatNum < maxAyat) {
                const nextText = ayatTexts[`${effectiveSn}:${ayatNum + 1}`] || "";
                const nextWords = nextText.split(/\s+/).filter(Boolean);

                if (nextWords.length) {
                    qs.push({
                        id: `${effectiveSn}:${ayatNum}:next_verse`,
                        sn: effectiveSn, type: "next_verse",
                        ayatNum,
                        question: `Quel verset suit le ${vLabel} ?`,
                        answer: String(ayatNum + 1),
                        hint:
                            nextWords.slice(0, 5).join(" ") +
                            (nextWords.length > 5 ? "..." : "")
                    });
                }
            }

            // 5. Verset précédent
            if (ayatNum > 1) {
                const prevText = ayatTexts[`${effectiveSn}:${ayatNum - 1}`] || "";
                const prevWords = prevText.split(/\s+/).filter(Boolean);

                if (prevWords.length) {
                    qs.push({
                        id: `${effectiveSn}:${ayatNum}:previous_verse`,
                        sn: effectiveSn, type: "previous_verse",
                        ayatNum,
                        question: `Quel verset précède le ${vLabel} ?`,
                        answer: String(ayatNum - 1),
                        hint:
                            prevWords.slice(0, 5).join(" ") +
                            (prevWords.length > 5 ? "..." : "")
                    });
                }
            }

            // 6. Numéro du verset
            if (words.length) {
                qs.push({
                    id: `${effectiveSn}:${ayatNum}:verse_number`,
                    sn: effectiveSn, type: "verse_number",
                    ayatNum,
                    question: `Quel est le numéro du ${vLabel.replace(`verset ${ayatNum}`, "verset ci-dessous")} ?`,
                    answer: String(ayatNum),
                    hint: words.slice(0, 6).join(" ")
                });
            }

            // 7. Reconstituer le verset
            if (words.length >= 3) {
                const splitWords = splitArabicWords(text);
                const reconAnswer = splitWords.join(' ');
                qs.push({
                    id: `${effectiveSn}:${ayatNum}:reconstruct`,
                    sn: effectiveSn, type: "reconstruct",
                    ayatNum,
                    question: `Reconstitue le ${vLabel} dans le bon ordre`,
                    answer: reconAnswer,
                    words: splitWords,
                });
            }

            // 8. Trouver le numéro du verset (extrait du milieu)
            if (words.length >= 3) {
                const start = Math.max(1, Math.floor(words.length / 3));
                const end   = Math.min(start + 5, words.length);
                const excerpt = words.slice(start, end).join(' ');
                qs.push({
                    id: `${effectiveSn}:${ayatNum}:find_ayat`,
                    sn: effectiveSn, type: 'find_ayat',
                    ayatNum,
                    question: `Quel est le numéro du verset contenant cet extrait ?`,
                    answer: String(ayatNum),
                    questionData: excerpt,
                    hint: text,
                });
            }

          // unknown_word
          const ldItem = learnData[`${effectiveSn}:${ayatNum}`] || {};
          const unkIndices = (ldItem.unknownWords || []);
          if (unkIndices.length > 0 && words.length > 0) {
            unkIndices.forEach(wi => {
              if (wi >= words.length) return;
              const unkWord = words[wi];
              const masked  = words.map((w, i) => i === wi ? '▢▢▢' : w).join(' ');
              qs.push({ id:`${effectiveSn}:${ayatNum}:unknown_word:${wi}`, sn:effectiveSn, type:'unknown_word', ayatNum,
                question:`Complète le mot inconnu dans le ${vLabel} :`, answer:unkWord, questionData:masked,
                hint:`Position ${wi+1} sur ${words.length}`, wordIndex:wi });
            });
            const unkWords  = unkIndices.filter(i=>i<words.length).map(i=>words[i]);
            const knownWords = words.filter((_,i)=>!unkIndices.includes(i));
            const decoys = knownWords.sort(()=>Math.random()-.5).slice(0,Math.max(2,4-unkWords.length));
            const allOpts = [...unkWords,...decoys].sort(()=>Math.random()-.5);
            qs.push({ id:`${effectiveSn}:${ayatNum}:unknown_pick`, sn:effectiveSn, type:'unknown_pick', ayatNum,
              question:`Quels mots ne connais-tu pas encore dans le ${vLabel} ?`,
              answer:unkWords.join('|'), options:allOpts, questionData:text,
              hint:`${unkWords.length} mot${unkWords.length>1?'s':''} inconnu${unkWords.length>1?'s':''}` });
          }

          // ── À RÉVISER questions ──────────────────────────────────────────────
          const toRevise = ldItem.toRevise;
          if (toRevise && words.length > 0) {
            const revWords = (typeof toRevise==='object' && toRevise.words) || [];
            const revParts = (typeof toRevise==='object' && toRevise.parts) || [];
            const revAll   = toRevise === true;
            if (revWords.length > 0) {
              const validIdx = [...new Set(revWords)].filter(wi => wi < words.length).sort((a,b)=>a-b);
              if (validIdx.length > 0) {
                const masked = words.map((w,i)=>validIdx.includes(i)?'▢▢▢':w).join(' ');
                const answerWords = validIdx.map(wi => words[wi]);
                qs.push({ id:`${effectiveSn}:${ayatNum}:revise_word`, sn:effectiveSn, type:'revise_word', ayatNum,
                  question: validIdx.length > 1
                    ? `🔖 Trouve les ${validIdx.length} mots marqués à réviser dans le ${vLabel} :`
                    : `🔖 Trouve le mot marqué à réviser dans le ${vLabel} :`,
                  answer:answerWords.join('|'), questionData:masked,
                  hint:`${validIdx.length} mot${validIdx.length>1?'s':''} marqué${validIdx.length>1?'s':''} sur ${words.length}`,
                  wordIndices:validIdx, toRevise:true });
              }
            }
            if (revParts.length > 0) {
              (ldItem.parts||[]).forEach(part => {
                if (!revParts.includes(part.id)||!part.text) return;
                const pi = (ldItem.parts||[]).indexOf(part);
                qs.push({ id:`${effectiveSn}:${ayatNum}:revise_part:${part.id}`, sn:effectiveSn, type:'revise_part', ayatNum,
                  question:`🔖 Récite la partie ${pi+1} marquée à réviser dans le ${vLabel} :`,
                  answer:part.text, questionData:text, hint:`${part.wordIndices?.length||'?'} mots`,
                  partText:part.text, partIdx:pi, toRevise:true });
              });
            }
            if (revAll && words.length >= 3) {
              const wi = Math.floor(Math.random()*words.length);
              const masked = words.map((w,i)=>i===wi?'▢▢▢':w).join(' ');
              qs.push({ id:`${effectiveSn}:${ayatNum}:revise_all`, sn:effectiveSn, type:'revise_word', ayatNum,
                question:`🔖 Cet ayat est marqué à réviser — complète le mot manquant :`,
                answer:words[wi], questionData:masked, hint:`Position ${wi+1}/${words.length}`, wordIndex:wi, toRevise:true });
            }
          }
        });

        // ── Multi-sourate: group ayats with same number across surahs ──
        if (multiItems && multiItems.length > 0) {
          const byAyatNum = {};
          multiItems.forEach(({ sn: s, ayatNum: an }) => {
            if (!byAyatNum[an]) byAyatNum[an] = [];
            byAyatNum[an].push(s);
          });
          Object.entries(byAyatNum).forEach(([anStr, sns]) => {
            if (sns.length < 2) return;
            const an = parseInt(anStr);
            // Only create compare question if all surahs have text loaded
            const entries = sns.map(sn => {
              const rawT = ayatTexts[`${sn}:${an}`] || '';
              const text = (() => {
                if (an === 1 && sn !== 1 && sn !== 9 && rawT) {
                  const ws = rawT.trim().split(' ');
                  const stripD = s => s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');
                  if (ws.length > 4 && stripD(ws[0]) === 'بسم') return ws.slice(4).join(' ');
                }
                return rawT;
              })();
              const name = surahs.find(s2 => s2.number === sn)?.englishName ?? `S.${sn}`;
              return { sn, text, name };
            }).filter(e => e.text);
            if (entries.length < 2) return;
            qs.push({
              id: `compare:${an}:${sns.sort().join(',')}`,
              type: 'compare_verse',
              ayatNum: an,
              sn: sns[0],
              multiSns: sns,
              question: `Verset ${an} — associe chaque texte à sa sourate`,
              entries,
              answer: sns.map(sn => `${sn}`).join(','),
            });
          });
        }

        // ── find_surah: excerpt → identify surah (multi-sourate only) ──
        if (multiItems && multiItems.length > 0) {
          const allMultiSns = [...new Set(multiItems.map(i => i.sn))];
          multiItems.forEach(({ sn: s, ayatNum: an }) => {
            const rawT = ayatTexts[`${s}:${an}`] || '';
            if (!rawT) return;
            const ws = rawT.trim().split(/\s+/).filter(Boolean);
            if (ws.length < 3) return;
            const start = Math.max(1, Math.floor(ws.length / 3));
            const end   = Math.min(start + 5, ws.length);
            qs.push({ id:`find_surah:${s}:${an}`, type:'find_surah', sn:s, ayatNum:an,
              question:`À quelle sourate appartient cet extrait ?`, answer:String(s),
              questionData:ws.slice(start,end).join(' '), hint:rawT, options:allMultiSns });
          });
        }

        // ── PAGE STRUCTURE questions ─────────────────────────────────────────
        // Group ayats by page using pageAyatData, generate structural questions per page
        const snSet = [...new Set(_items.map(i => i.sn ?? selectedSn))];
        snSet.forEach(sn => {
          const ayahsMeta = pageAyatData[sn];
          if (!ayahsMeta || ayahsMeta.length === 0) return;
          // restrict to ayats in the session range
          const sessionNums = new Set(_items.filter(i => (i.sn ?? selectedSn) === sn).map(i => i.ayatNum));
          const sessionMeta = ayahsMeta.filter(a => sessionNums.has(a.numberInSurah));
          // group by page
          const byPage = {};
          sessionMeta.forEach(a => {
            if (!a.page) return;
            if (!byPage[a.page]) byPage[a.page] = [];
            byPage[a.page].push(a);
          });
          const surahLabel = surahs.find(s2 => s2.number === sn)?.englishName ?? `S.${sn}`;
          Object.entries(byPage).forEach(([pageStr, pageAyats]) => {
            const page = parseInt(pageStr);
            pageAyats.sort((a,b) => a.numberInSurah - b.numberInSurah);
            const first = pageAyats[0].numberInSurah;
            const last  = pageAyats[pageAyats.length-1].numberInSurah;
            const count = pageAyats.length;
            const hizb  = pageAyats[0].hizbQuarter != null ? Math.ceil(pageAyats[0].hizbQuarter / 4) : null;
            const juz   = pageAyats[0].juz ?? null;
            const multi5  = pageAyats.filter(a => a.numberInSurah % 5 === 0).map(a => a.numberInSurah);
            const multi10 = pageAyats.filter(a => a.numberInSurah % 10 === 0).map(a => a.numberInSurah);
            const base = { sn, page, first, last, count, hizb, juz, multi5, multi10, surahLabel };

            // Q1: premier verset de la page
            qs.push({ id:`ps:${sn}:${page}:first`, type:'page_structure', subtype:'first',
              question:`Quel est le 1er verset de la page ${page} (${surahLabel}) ?`,
              answer: String(first), ...base });

            // Q2: dernier verset de la page
            qs.push({ id:`ps:${sn}:${page}:last`, type:'page_structure', subtype:'last',
              question:`Quel est le dernier verset de la page ${page} (${surahLabel}) ?`,
              answer: String(last), ...base });

            // Q3: nombre d'ayats sur la page
            qs.push({ id:`ps:${sn}:${page}:count`, type:'page_structure', subtype:'count',
              question:`Combien d'ayats sur la page ${page} (${surahLabel}) ?`,
              answer: String(count), ...base });

            // Q4: hizb de la page
            if (hizb != null) qs.push({ id:`ps:${sn}:${page}:hizb`, type:'page_structure', subtype:'hizb',
              question:`À quel hizb appartient la page ${page} (${surahLabel}) ?`,
              answer: String(hizb), ...base });

            // Q5: versets multiples de 10 sur la page
            if (multi10.length > 0) qs.push({ id:`ps:${sn}:${page}:multi10`, type:'page_structure', subtype:'multi10',
              question:`Quels versets multiples de 10 se trouvent sur la page ${page} (${surahLabel}) ?`,
              answer: multi10.join(', '), ...base });

            // Q6: versets multiples de 5 (non-10) sur la page
            const multi5only = multi5.filter(n => n % 10 !== 0);
            if (multi5only.length > 0) qs.push({ id:`ps:${sn}:${page}:multi5`, type:'page_structure', subtype:'multi5',
              question:`Quels versets multiples de 5 (non-10) se trouvent sur la page ${page} (${surahLabel}) ?`,
              answer: multi5only.join(', '), ...base });

            // Q7: sur quelle page se trouve un verset dizaine aléatoire
            if (multi10.length > 0) {
              const pick = multi10[Math.floor(Math.random() * multi10.length)];
              qs.push({ id:`ps:${sn}:${page}:findpage:${pick}`, type:'page_structure', subtype:'findpage',
                question:`Sur quelle page se trouve le verset ${pick} de ${surahLabel} ?`,
                answer: String(page), ...base });
            }
          });
        });

        // Filter by selected types
        const activeTypes = selectedQTypes || null;
        let filtered = activeTypes ? qs.filter(q => activeTypes.has(q.type)) : qs;
        qs.length = 0; filtered.forEach(q => qs.push(q));

        const TYPE_ORDER = ["first_word","last_word","missing_word","next_verse","previous_verse","verse_number","find_ayat","reconstruct","compare_verse","find_surah","unknown_word","unknown_pick","page_structure","revise_word","revise_part"];

        if (randomize) {
          // Restore saved shuffle order only if IDs match exactly
          if (savedOrder && savedOrder.length === qs.length) {
            const savedSet = new Set(savedOrder);
            const qsSet = new Set(qs.map(q => q.id));
            const match = savedSet.size === qsSet.size && [...savedSet].every(id => qsSet.has(id));
            if (match) {
              const byId = {}; qs.forEach(q => { byId[q.id] = q; });
              const reordered = savedOrder.map(id => byId[id]).filter(Boolean);
              qs.length = 0; reordered.forEach(q => qs.push(q));
            } else {
              // Reshuffle
              for (let i = qs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [qs[i], qs[j]] = [qs[j], qs[i]];
              }
            }
          } else {
            for (let i = qs.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [qs[i], qs[j]] = [qs[j], qs[i]];
            }
          }
        } else {
          // Sequential: sort by ayatNum ascending, then by type order
          qs.sort((a, b) => {
            const anDiff = (a.ayatNum ?? 0) - (b.ayatNum ?? 0);
            if (anDiff !== 0) return anDiff;
            return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
          });
        }

        return qs;
    }, [_items, selectedSn, ayatTexts, maxAyat, randomize, selectedQTypes, multiItems, surahs, learnData, pageAyatData]);

  // Persist session whenever qIdx or results change
  React.useEffect(() => {
    if (!questions.length) return;
    const questionOrder = questions.map(q => q.id);
    if (!savedOrder) setSavedOrder(questionOrder);
    saveQSession({ currentQId, results, questionOrder });
  }, [currentQId, results, questions]);


  // Apply skipCorrect filter at render-time so it stays fresh with learnData
  const activeQuestions = React.useMemo(() => {
    if (!skipCorrect) return questions;
    return questions.filter(q => {
      const ld = learnData[`${q.sn ?? selectedSn}:${q.ayatNum}`] || {};
      const scores = ld.questionScores?.[q.id];
      if (!scores || scores.length < 2) return true; // keep if fewer than 2 attempts
      // Skip only if the last 2 answers were both correct
      return !(scores[scores.length - 1] === 1 && scores[scores.length - 2] === 1);
    });
  }, [questions, skipCorrect, learnData, selectedSn]);

  // Track current question by ID (stable across activeQuestions recomputations)
  // Sync currentQId to first question once questions are built (if no saved session)
  React.useEffect(() => {
    if (!currentQId && questions.length > 0) {
      setCurrentQId(questions[initialQIdx ?? 0]?.id ?? questions[0].id);
    }
  }, [questions.length]);

  // Derive qIdx from currentQId within activeQuestions
  const qIdx = React.useMemo(() => {
    if (!currentQId) return 0;
    const idx = activeQuestions.findIndex(q => q.id === currentQId);
    return idx >= 0 ? idx : 0;
  }, [activeQuestions, currentQId]);

  const q = activeQuestions[qIdx] ?? null;

  const answer = (correct, removeRevise = false) => {
    if (!q) return;
    const r = { sn: q.sn ?? selectedSn, ayatNum: q.ayatNum, qId: q.id, correct };
    setResults(prev => [...prev, r]);
    setLData(q.sn ?? selectedSn, q.ayatNum, d => {
      const qs2 = { ...(d.questionScores || {}) };
      delete qs2['undefined'];
      qs2[q.id] = [...(qs2[q.id] || []).slice(-4), correct ? 1 : 0];
      const patch = { ...d, questionScores: qs2 };
      if (removeRevise) {
        patch.toRevise = false;
        const hist = [...(d.reviseHistory || [])];
        const openIdx = hist.findIndex(e => !e.endDate);
        if (openIdx !== -1) {
          hist[openIdx] = { ...hist[openIdx], endDate: new Date().toISOString() };
          patch.reviseHistory = hist;
        }
      }
      return patch;
    });
    // Find next question
    const nextInActive = activeQuestions[qIdx + 1];
    if (nextInActive) {
      setCurrentQId(nextInActive.id);
      onQIdxChange?.(qIdx + 1);
    } else {
      // Check if there are remaining questions in `questions` excluding just-answered correctly
      const remaining = questions.filter(qq => {
        if (qq.id === q.id && correct) return false; // just answered correctly
        const ld = learnData[`${qq.sn ?? selectedSn}:${qq.ayatNum}`] || {};
        const scores = ld.questionScores?.[qq.id];
        if (!scores || !scores.length) return true;
        return scores[scores.length - 1] !== 1;
      });
      if (remaining.length === 0 || !skipCorrect) {
        setDone(true); clearQSession();
      } else {
        // Still some remaining but none after current index — done
        setDone(true); clearQSession();
      }
    }
  };

  // Delay showing empty state to allow async text loading to complete
  React.useEffect(() => {
    if (activeQuestions.length === 0 && _items.length > 0) {
      const t = setTimeout(() => setEmptyTimeout(true), 3000);
      return () => clearTimeout(t);
    } else {
      setEmptyTimeout(false);
    }
  }, [activeQuestions.length, _items.length]);

  // Are texts still loading? (multi: check if any sn has no texts yet)
  const textsLoading = _items.length > 0 && !_items.some(({ sn: s, ayatNum }) => !!(ayatTexts[`${s ?? selectedSn}:${ayatNum}`]));
  const textsLoaded  = _items.some(({ sn: s, ayatNum }) => !!(ayatTexts[`${s ?? selectedSn}:${ayatNum}`]));

  if (activeQuestions.length === 0) {
    if (_items.length === 0) return (
      <div style={{ padding:'20px', textAlign:'center', fontSize:9, color:'var(--text3)', letterSpacing:1 }}>
        AUCUN AYAT APPRIS DANS LA PLAGE SÉLECTIONNÉE
        <button onClick={onDone} style={{ display:'block', margin:'16px auto 0', fontSize:9, letterSpacing:2,
          fontFamily:"'Cinzel',serif", padding:'7px 18px', border:'1px solid var(--border2)',
          background:'transparent', color:'var(--text3)', borderRadius:6, cursor:'pointer' }}>← RETOUR</button>
      </div>
    );
    if (!emptyTimeout) return (
      <div style={{ padding:'30px', textAlign:'center', fontSize:9, color:'var(--text3)', letterSpacing:2, fontFamily:"'Cinzel',serif" }}>
        ⏳ CHARGEMENT DES TEXTES… ({_items.length} ayats, {Object.keys(ayatTexts).filter(k=>k.includes(':')).length} textes)
      </div>
    );
    // Diagnose why activeQuestions is empty
    const isMonoMode = !multiItems || multiItems.length === 0;
    const multiOnlyTypes = ['find_surah','compare_verse'];
    const hasOnlyMultiTypes = selectedQTypes instanceof Set
      && [...selectedQTypes].every(t => multiOnlyTypes.includes(t));
    const allSkipped = textsLoaded && questions.length > 0 && activeQuestions.length === 0;

    return (
      <div style={{ padding:'24px 20px', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
        {/* Case 1: types incompatibles avec le mode mono */}
        {isMonoMode && hasOnlyMultiTypes ? (
          <>
            <div style={{ fontSize:11, color:'var(--gold2)', fontFamily:"'Cinzel',serif", letterSpacing:1 }}>
              TYPE INCOMPATIBLE
            </div>
            <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:.5, maxWidth:280, lineHeight:1.7 }}>
              Les types <strong style={{color:'var(--gold2)'}}>Trouver la sourate</strong> et <strong style={{color:'var(--gold2)'}}>Comparer sourates</strong> nécessitent le mode <strong style={{color:'var(--teal2)'}}>multi-sourates</strong>.
              <br/>Sélectionne d'autres types ou active plusieurs sourates.
            </div>
            <button onClick={onDone} style={{ fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              padding:'7px 18px', border:'1px solid var(--teal)', background:'rgba(62,184,160,.08)',
              color:'var(--teal2)', borderRadius:6, cursor:'pointer' }}>← CHANGER LES TYPES</button>
          </>
        ) : allSkipped ? (
          <>
            {/* Case 2: all questions already correct (skipCorrect filtered them all) */}
            <div style={{ fontSize:22 }}>✓</div>
            <div style={{ fontSize:11, color:'var(--green)', fontFamily:"'Cinzel',serif", letterSpacing:1 }}>
              TOUTES LES QUESTIONS MAÎTRISÉES
            </div>
            <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:.5, maxWidth:260, lineHeight:1.7 }}>
              Les {questions.length} questions de cette plage ont été répondues correctement au moins 2 fois.
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
              <button onClick={() => {
                // reset all questionScores for these items
                _items.forEach(({sn: s, ayatNum: an}) => {
                  setLData(s ?? selectedSn, an, d => ({ ...d, questionScores: {} }));
                });
              }} style={{ fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                padding:'7px 16px', border:'1px solid var(--gold)', background:'rgba(201,168,76,.08)',
                color:'var(--gold2)', borderRadius:6, cursor:'pointer' }}>
                🔄 RÉINITIALISER LES SCORES
              </button>
              <button onClick={onDone} style={{ fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                padding:'7px 16px', border:'1px solid var(--border2)', background:'transparent',
                color:'var(--text3)', borderRadius:6, cursor:'pointer' }}>← RETOUR</button>
            </div>
          </>
        ) : (
          <>
            {/* Case 3: texts not loaded or unknown */}
            <div style={{ fontSize:9, color:'var(--text3)', letterSpacing:1 }}>
              {textsLoaded ? 'Aucune question générée pour cette sélection.' : 'Textes non chargés — réessaie dans un instant.'}
            </div>
            <button onClick={onDone} style={{ fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              padding:'7px 18px', border:'1px solid var(--border2)', background:'transparent',
              color:'var(--text3)', borderRadius:6, cursor:'pointer' }}>← RETOUR</button>
          </>
        )}
      </div>
    );
  }

  if (done) {
    const correct = results.filter(r => r.correct).length;
    const pct = Math.round(correct / results.length * 100);
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:18, padding:'30px 20px' }}>
        <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:24, color:'var(--gold)', direction:'rtl' }}>{multiItems ? `${[...new Set(multiItems.map(i=>i.sn))].length} sourates` : surahInfo?.name}</div>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:48, color:masteryColor(pct), letterSpacing:-2 }}>{pct}%</div>
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)' }}>{correct}/{results.length} CORRECTES</div>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'center', marginTop:4 }}>
          {results.map((r,i) => (
            <div key={i} style={{ width:24, height:24, borderRadius:5, display:'flex', alignItems:'center', justifyContent:'center',
              border:'1px solid '+(r.correct?'var(--green)':'var(--red)'),
              color:r.correct?'var(--green)':'var(--red)', fontSize:9, fontFamily:"'Cinzel',serif" }}>{multiItems ? `${r.sn??''}:${r.ayatNum}` : r.ayatNum}</div>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, marginTop:8 }}>
          <button onClick={() => { clearQSession(); setSavedOrder(null); setCurrentQId(questions[0]?.id ?? null); setResults([]); setRevealed(false); setDone(false); }}
            style={{ padding:'8px 18px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:'transparent', border:'1px solid var(--gold)', color:'var(--gold)', borderRadius:6, cursor:'pointer' }}>↺ REFAIRE</button>
          <button onClick={onDone}
            style={{ padding:'8px 18px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:'transparent', border:'1px solid var(--border2)', color:'var(--text3)', borderRadius:6, cursor:'pointer' }}>✓ TERMINER</button>
        </div>
      </div>
    );
  }

  const progress = activeQuestions.length > 0 ? Math.round(qIdx / activeQuestions.length * 100) : 0;
  const qSn = q?.sn ?? selectedSn;
  const ayatText = ayatTexts[`${qSn}:${q.ayatNum}`] || '';
  const ldQ      = learnData[`${qSn}:${q.ayatNum}`] || {};
  const prevScore = ldQ.questionScores?.[q.id];
  const lastCorrect = prevScore ? prevScore[prevScore.length-1] : null;
  const qAudioUrl = globalNums[`${qSn}:${q.ayatNum}`] ? `${getAudioBase()}/${globalNums[`${qSn}:${q.ayatNum}`]}.mp3` : null;
  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a || !qAudioUrl) return;
    if (isPlaying) { a.pause(); setIsPlaying(false); }
    else { a.src = qAudioUrl; a.play().then(() => setIsPlaying(true)).catch(() => {}); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 0' }}>
      {/* Hidden audio element */}
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} style={{ display:'none' }} />
      {/* Resume banner — shown when restoring a saved session */}
      {saved && qIdx > 0 && !done && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px',
          background:'rgba(62,184,160,.08)', border:'1px solid var(--teal)',
          borderRadius:8, fontSize:8, letterSpacing:1, color:'var(--teal2)' }}>
          <span style={{ flex:1 }}>▶ SESSION REPRISE — QUESTION {qIdx + 1}/{activeQuestions.length}</span>
          <button onClick={() => { clearQSession(); setSavedOrder(null); setCurrentQId(questions[0]?.id ?? null); setResults([]); setRevealed(false); setDone(false); }}
            style={{ fontSize:8, letterSpacing:1, padding:'3px 10px', borderRadius:6, cursor:'pointer',
              fontFamily:"'Cinzel',serif", border:'1px solid var(--border2)',
              background:'transparent', color:'var(--text3)' }}>RECOMMENCER</button>
        </div>
      )}

      {/* Progress */}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <button onClick={onDone} style={{ fontSize:9, letterSpacing:1, padding:'4px 10px', fontFamily:"'Cinzel',serif",
          background:'transparent', border:'1px solid var(--border2)', color:'var(--text3)', borderRadius:6, cursor:'pointer' }}>←</button>
        <div style={{ flex:1, height:4, background:'var(--surface3)', borderRadius:2, overflow:'hidden' }}>
          <div style={{ height:'100%', width:progress+'%', background:'var(--teal)', borderRadius:2, transition:'width .3s' }} />
        </div>
        <div style={{ fontSize:9, color:'var(--text3)', letterSpacing:1, flexShrink:0 }}>{qIdx+1}/{activeQuestions.length}</div>
      </div>
      {/* Card */}
      <div key={qIdx} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, padding:'24px 18px',
        background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12 }}>
        {/* Ayat number + mastery + audio */}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontFamily:"'Cinzel',serif", fontSize:40, fontWeight:700, color:'var(--teal2)', lineHeight:1 }}>{q.ayatNum}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:1 }}>{surahInfo?.englishName?.toUpperCase()}</div>
            <MasteryBadge pct={computeMastery(ldQ)} />
          </div>
          {qAudioUrl && (
            <button onClick={toggleAudio}
              style={{ width:44, height:44, borderRadius:'50%', border:'none',
                background: isPlaying ? 'rgba(62,184,160,.25)' : 'rgba(62,184,160,.1)',
                color:'var(--teal2)', fontSize:19, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow: isPlaying ? '0 0 0 3px rgba(62,184,160,.3)' : 'none',
                transition:'all .2s' }}>
              {isPlaying ? '▊▊' : '▶'}
            </button>
          )}
        </div>
        {/* Question */}
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginBottom:6 }}>QUESTION</div>
          <div style={{ fontSize:11, letterSpacing:1, color:'var(--gold2)', fontFamily:"'Cinzel',serif" }}>{q.question}</div>
              </div>
              {/* Arabic excerpt for find_ayat only — find_surah renders it internally */}
              {q.questionData && q.type !== 'find_surah' && q.type !== 'unknown_word' && q.type !== 'unknown_pick' && q.type !== 'revise_word' && q.type !== 'revise_part' && (
                <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:22, direction:'rtl',
                  textAlign:'center', color:'var(--text1)', padding:'12px 16px',
                  background:'var(--surface3)', borderRadius:9,
                  border:'1px solid var(--border)', lineHeight:2.2, width:'100%' }}>
                  {q.questionData}
                </div>
              )}
        {/* Previous result hint */}
        {lastCorrect !== null && (
          <div style={{ fontSize:8, color:lastCorrect?'var(--green)':'var(--red)', letterSpacing:1 }}>
            {lastCorrect ? '✓ Correct la dernière fois' : '✗ Incorrect la dernière fois'}
          </div>
        )}
        {/* Question type dispatch */}
        {q.type === 'compare_verse' ? (
          <CompareVerseQuestion q={q} onAnswer={answer} globalNums={globalNums} />
        ) : q.type === 'find_surah' ? (
          <FindSurahQuestion q={q} surahs={surahs} onAnswer={answer} />
        ) : q.type === 'reconstruct' ? (
          <ReconstructQuestion
            q={q}
            ayatTexts={ayatTexts}
            selectedSn={qSn}
            onAnswer={answer}
          />
        ) : q.type === 'unknown_word' || q.type === 'revise_word' ? (
          <UnknownWordQuestion key={q.id} q={q} onAnswer={answer} />
        ) : q.type === 'unknown_pick' ? (
          <UnknownPickQuestion key={q.id} q={q} onAnswer={answer} />
        ) : q.type === 'revise_part' ? (
          <RevisePartQuestion key={q.id} q={q} onAnswer={answer} ayatTexts={ayatTexts} globalNums={globalNums} timestamps={timestamps} sn={qSn} />
        ) : q.type === 'page_structure' ? (
          <PageStructureQuestion key={q.id} q={q} onAnswer={answer}
            ayatTexts={ayatTexts} globalNums={globalNums}
            timestamps={timestamps} sn={qSn} />
        ) : !revealed ? (
          <TextAnswerInput
            q={q}
            onReveal={(autoCorrect) => { if (autoCorrect !== null) { answer(autoCorrect); } else { setRevealed(true); } }}
          />
        ) : (
          <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:10 }}>
            {/* Arabic text with parts + timestamps + word/part click audio */}
            <QAyatPlayer
              ayatText={ayatText}
              timestamps={timestamps?.[qSn]?.[q.ayatNum]}
              parts={ldQ?.parts}
              audioUrl={qAudioUrl}
              learnData={ldQ}
            />
            {/* Answer highlight */}
            <div style={{ padding:'10px 14px', background:'rgba(201,168,76,.07)', borderRadius:8,
              border:'1px solid var(--gold)', textAlign:'center' }}>
              <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:1, marginBottom:4 }}>RÉPONSE</div>
              <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:18, color:'var(--gold2)', direction:'rtl' }}>{q.answer}</div>
              {q.hint && <div style={{ fontSize:9, color:'var(--text3)', marginTop:6, direction:'rtl', fontFamily:"'Amiri Quran',serif" }}>{q.hint}</div>}
            </div>
            {/* Self-assess override buttons */}
            <div style={{ display:'flex', gap:10, justifyContent:'center', marginTop:4 }}>
              <button onClick={() => answer(false)}
                style={{ flex:1, padding:'9px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                  background:'rgba(224,90,90,.08)', border:'1px solid var(--red)', color:'var(--red)',
                  borderRadius:8, cursor:'pointer' }}>✗ INCORRECT</button>
              <button onClick={() => answer(true)}
                style={{ flex:1, padding:'9px', fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                  background:'rgba(76,175,129,.12)', border:'1px solid var(--green)', color:'var(--green)',
                  borderRadius:8, cursor:'pointer' }}>✓ CORRECT</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── QuestionsModePage ─────────────────────────────────────────────────────
// Standalone wrapper: surah picker → range picker → type picker → QuestionsMode
function QuestionsModePage({ surahs, learnData, setLData, initialSurahNum, initialRangeFrom, initialRangeTo, initialQIdx }) {
  const Q_PAGE_KEY = 'quran_questions_page_session';
  const loadSession = () => { try { return JSON.parse(localStorage.getItem(Q_PAGE_KEY)) || {}; } catch { return {}; } };
  const saveSession = (d) => { try { localStorage.setItem(Q_PAGE_KEY, JSON.stringify(d)); } catch {} };
  const clearPageSession = () => { try { localStorage.removeItem(Q_PAGE_KEY); } catch {} };

  const ALL_Q_TYPES = ["first_word","last_word","missing_word","next_verse","previous_verse","verse_number","find_ayat","reconstruct","compare_verse","find_surah","unknown_word","unknown_pick","page_structure","revise_word","revise_part"];

  const saved = React.useMemo(() => initialSurahNum ? {} : loadSession(), []);

  const [selectedSn,     setSelectedSn]     = React.useState(initialSurahNum ?? saved.selectedSn ?? null);
  const [rangeFrom,      setRangeFrom]      = React.useState(initialRangeFrom ?? saved.rangeFrom ?? "1");
  const [rangeTo,        setRangeTo]        = React.useState(initialRangeTo ?? saved.rangeTo ?? "");
  const [selectedQTypes, setSelectedQTypes] = React.useState(() => {
    if (saved.selectedQTypes) return new Set(saved.selectedQTypes);
    return new Set(ALL_Q_TYPES);
  });
  const [randomize,      setRandomize]      = React.useState(saved.randomize ?? false);
  const [skipCorrect,    setSkipCorrect]    = React.useState(saved.skipCorrect ?? true);
  const [onlyRevise,     setOnlyRevise]     = React.useState(saved.onlyRevise ?? false);
  const [clickPhase,     setClickPhase]     = React.useState("from"); // "from" | "to"
  const [multiSns,       setMultiSns]       = React.useState(saved.multiSns ?? []);
  const [multiRanges,    setMultiRanges]    = React.useState(saved.multiRanges ?? {}); // { sn: { from, to } }
  const [multiTexts,     setMultiTexts]     = React.useState({});
  const [ayatTexts,      setAyatTexts]      = React.useState({});
  const [qPageData,      setQPageData]      = React.useState({}); // sn -> [{numberInSurah, page}]
  const [showAvancement, setShowAvancement] = React.useState(true);
  const [showPlage,       setShowPlage]      = React.useState(true);

  const ensureQPageData = React.useCallback((sn) => {
    if (!sn || qPageData[sn]) return;
    fetchSurahDefault(sn).then(ayahs => {
      setQPageData(p => ({ ...p, [sn]: ayahs.map(a => ({ numberInSurah: a.numberInSurah, page: a.page })) }));
    }).catch(() => {});
  }, [qPageData]);

  // stage: "surah" | "multi" | "range" | "types" | "session" | "resume"
  const [stage, setStage] = React.useState(() => {
    if (initialSurahNum && initialRangeFrom) return "session";
    if (initialSurahNum) return "range";
    // If we have a saved session config, go to resume screen
    if (saved.selectedSn || (saved.multiSns && saved.multiSns.length > 0)) return "resume";
    return "surah";
  });
  const [started, setStarted] = React.useState(!!(initialSurahNum && initialRangeFrom));
  const qNavigate = useNavigate();

  const availableSurahs = React.useMemo(() =>
    surahs.filter(s => Object.keys(learnData).some(k => k.startsWith(s.number + ":") && learnData[k].learned))
      .sort((a,b) => a.number - b.number),
  [surahs, learnData]);

  const surahInfo = surahs.find(s => s.number === selectedSn);
  const maxAyat   = surahInfo?.numberOfAyahs ?? 1;

  const ayatList = React.useMemo(() => {
    if (!selectedSn) return [];
    const from = Math.max(1, parseInt(rangeFrom) || 1);
    const to   = Math.min(maxAyat, parseInt(rangeTo) || maxAyat);
    const arr = []; for (let i = from; i <= to; i++) arr.push(i);
    return arr;
  }, [selectedSn, surahs, rangeFrom, rangeTo]);

  const multiItems = React.useMemo(() => {
    if (multiSns.length === 0) return null;
    const items = [];
    multiSns.forEach(sn => {
      const si = surahs.find(s => s.number === sn);
      const max = si?.numberOfAyahs ?? 1;
      const r = multiRanges[sn];
      const from = r ? Math.max(1, parseInt(r.from) || 1) : 1;
      const to   = r ? Math.min(max, parseInt(r.to) || max) : max;
      const learned = Object.keys(learnData).filter(k => k.startsWith(sn + ':') && learnData[k].learned);
      learned.forEach(k => {
        const num = parseInt(k.split(':')[1]);
        if (num >= from && num <= to) items.push({ sn, ayatNum: num });
      });
    });
    return items;
  }, [multiSns, multiRanges, surahs, learnData]);

  React.useEffect(() => {
    if (!selectedSn) return;
    const k = String(selectedSn);
    if (ayatTexts[k]) return;
    fetchSurahDefault(selectedSn).then(ayahs => {
      if (!ayahs?.length) return;
      const m = {};
      ayahs.forEach(a => {
        m[`${selectedSn}:${a.numberInSurah}`] = a.text;
        m[`num:${selectedSn}:${a.numberInSurah}`] = a.number;
      });
      setAyatTexts(p => ({ ...p, ...m, [k]: true }));
    }).catch(() => {});
  }, [selectedSn]);

  React.useEffect(() => {
    multiSns.forEach(sn => {
      const k = String(sn);
      if (multiTexts[k]) return;
      fetchSurahDefault(sn).then(ayahs => {
        if (!ayahs?.length) return;
        const m = {};
        ayahs.forEach(a => {
          m[`${sn}:${a.numberInSurah}`] = a.text;
          m[`num:${sn}:${a.numberInSurah}`] = a.number;
        });
        setMultiTexts(p => ({ ...p, ...m, [k]: true }));
      }).catch(() => {});
    });
  }, [multiSns]);

  React.useEffect(() => {
    saveSession({ selectedSn, rangeFrom, rangeTo, multiSns, multiRanges, selectedQTypes: [...selectedQTypes], randomize, skipCorrect, onlyRevise });
  }, [selectedSn, rangeFrom, rangeTo, multiSns, selectedQTypes, randomize, skipCorrect, onlyRevise]);

  // ── Resume screen ──
  if (stage === "resume") {
    const isMulti = multiSns.length > 0;
    const surahInfo2 = surahs.find(s => s.number === selectedSn);
    const resumeLabel = isMulti
      ? `${multiSns.length} sourate${multiSns.length > 1 ? "s" : ""}`
      : surahInfo2
        ? `${surahInfo2.englishName.toUpperCase()} — ${rangeFrom}→${rangeTo || surahInfo2.numberOfAyahs}`
        : null;
    const TYPE_LABELS_SHORT = {
      first_word:"1er mot", last_word:"Dernier mot", missing_word:"Mot manquant",
      next_verse:"Verset suiv.", previous_verse:"Verset préc.",
      verse_number:"N° verset", find_ayat:"Trouver verset", reconstruct:"Reconstituer",
      compare_verse:"Comparer", find_surah:"Trouver sourate",
      unknown_word:"Mot inconnu", unknown_pick:"Mots inconnus", page_structure:"Structure page",
      revise_word:"🔖 Mot(s) à réviser", revise_part:"🔖 Partie à réviser",
    };
    const allTypesSelected = [...selectedQTypes].length === ALL_Q_TYPES.length;
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:16, padding:"28px 0" }}>
        <div style={{ textAlign:"center", display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ fontSize:8, letterSpacing:3, color:"var(--text3)" }}>SESSION PRÉCÉDENTE</div>
          {resumeLabel && (
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:11, color:"var(--gold2)", letterSpacing:1 }}>{resumeLabel}</div>
          )}
          {isMulti && (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"center", marginTop:2 }}>
              {multiSns.map(sn => {
                const si = surahs.find(s => s.number === sn);
                return si ? (
                  <span key={sn} style={{ fontFamily:"'Amiri Quran',serif", fontSize:14, color:"var(--gold)", padding:"2px 6px",
                    background:"rgba(201,168,76,.08)", borderRadius:6, border:"1px solid rgba(201,168,76,.2)" }}>{si.name}</span>
                ) : null;
              })}
            </div>
          )}
          {/* Question types */}
          <div style={{ marginTop:4, display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
            <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>TYPES DE QUESTIONS</div>
            {allTypesSelected ? (
              <div style={{ fontSize:8, color:"var(--teal)", letterSpacing:1, fontFamily:"'Cinzel',serif" }}>TOUS ({ALL_Q_TYPES.length})</div>
            ) : (
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"center" }}>
                {[...selectedQTypes].map(t => (
                  <span key={t} style={{ fontSize:7, letterSpacing:1, padding:"2px 7px",
                    background:"rgba(62,184,160,.08)", border:"1px solid var(--teal)",
                    color:"var(--teal2)", borderRadius:10, fontFamily:"'Cinzel',serif" }}>
                    {TYPE_LABELS_SHORT[t] ?? t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1, marginTop:2 }}>
            {randomize ? "ORDRE ALÉATOIRE" : "ORDRE SÉQUENTIEL"} · {skipCorrect ? "IGNORER CORRECTES" : "TOUTES LES QUESTIONS"}{onlyRevise ? " · 🔖 RÉVISION" : ""}
          </div>
        </div>
        <button onClick={() => {
          // In mono mode, strip types that only work in multi-surah sessions
          if (!isMulti) {
            const multiOnlyT = new Set(['find_surah','compare_verse']);
            const cleaned = new Set([...selectedQTypes].filter(t => !multiOnlyT.has(t)));
            if (cleaned.size === 0) cleaned.add('first_word'); // always keep at least one
            if (cleaned.size !== selectedQTypes.size) setSelectedQTypes(cleaned);
          }
          setStarted(true); setStage("session");
          if (!isMulti) qNavigate(`/revision/questions/${selectedSn}/${rangeFrom}/${rangeTo || (surahInfo2?.numberOfAyahs ?? 1)}/0`);
          else qNavigate("/revision/questions");
        }} style={{ padding:"13px", fontSize:10, letterSpacing:2, fontFamily:"'Cinzel',serif",
          background:"rgba(201,168,76,.12)", border:"1px solid var(--gold)", color:"var(--gold2)",
          borderRadius:9, cursor:"pointer" }}>
          ▶ RELANCER LA SESSION
        </button>
        <button onClick={() => {
          clearPageSession();
          setSelectedSn(null); setRangeFrom("1"); setRangeTo(""); setMultiSns([]);
          setSelectedQTypes(new Set(ALL_Q_TYPES)); setRandomize(false);
          setStage("surah");
        }} style={{ padding:"10px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
          background:"transparent", border:"1px solid var(--border2)", color:"var(--text3)",
          borderRadius:9, cursor:"pointer" }}>
          ＋ NOUVELLE SESSION
        </button>
      </div>
    );
  }

  // ── Surah picker ──
  if (stage === "surah") {
    const toReviseSns = [...new Set(
      Object.entries(learnData)
        .filter(([, v]) => v?.toRevise)
        .map(([k]) => parseInt(k.split(':')[0]))
        .filter(sn => !isNaN(sn))
    )];
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:12, padding:"20px 0" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:9, letterSpacing:3, color:"var(--text3)" }}>CHOISIR UNE SOURATE</div>
          <button onClick={() => { setMultiSns([]); setStage("multi"); }}
            style={{ fontSize:8, letterSpacing:1, padding:"4px 12px", fontFamily:"'Cinzel',serif",
              background:"rgba(62,184,160,.08)", border:"1px solid var(--teal)", color:"var(--teal)", borderRadius:20, cursor:"pointer" }}>
            ＋ MULTI SOURATES
          </button>
        </div>
        {toReviseSns.length > 0 && (
          <button onClick={() => {
            setMultiSns(toReviseSns);
            // set multiRanges to only the toRevise ayats per surah
            const ranges = {};
            toReviseSns.forEach(sn => {
              const ans = Object.entries(learnData)
                .filter(([k, v]) => k.startsWith(sn+':') && v?.toRevise)
                .map(([k]) => parseInt(k.split(':')[1])).filter(n => !isNaN(n)).sort((a,b)=>a-b);
              if (ans.length) ranges[sn] = { from: String(ans[0]), to: String(ans[ans.length-1]) };
            });
            setMultiRanges(ranges);
            setStage("range");
          }}
            style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"12px 16px", borderRadius:10, cursor:"pointer",
              background:"rgba(201,168,76,.08)", border:"1px solid var(--gold)", color:"var(--gold2)" }}>
            <div style={{ display:"flex", flexDirection:"column", gap:2, textAlign:"left" }}>
              <span style={{ fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif" }}>🔖 RÉVISER LES MARQUÉS</span>
              <span style={{ fontSize:7, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
                {Object.values(learnData).filter(v=>v?.toRevise).length} AYAT{Object.values(learnData).filter(v=>v?.toRevise).length>1?'S':''} · {toReviseSns.length} SOURATE{toReviseSns.length>1?'S':''}
              </span>
            </div>
            <span style={{ fontSize:18 }}>→</span>
          </button>
        )}
        {availableSurahs.length === 0 && (
          <div style={{ fontSize:10, color:"var(--text3)", letterSpacing:1 }}>Aucune sourate apprise.</div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {availableSurahs.map(s => {
            const learned = Object.keys(learnData).filter(k => k.startsWith(s.number + ":") && learnData[k].learned).length;
            return (
              <button key={s.number} onClick={() => { setSelectedSn(s.number); setRangeFrom("1"); setRangeTo(""); setStage("range"); }}
                style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 14px", background:"var(--surface2)", border:"1px solid var(--border)",
                  borderRadius:8, cursor:"pointer", textAlign:"left" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                  <span style={{ fontSize:9, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>{s.englishName.toUpperCase()}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:8, color:"var(--teal)", fontFamily:"'Cinzel',serif" }}>{learned} appris</span>
                  <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:18, color:"var(--gold)" }}>{s.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Multi-surah picker ──
  if (stage === "multi") {
    const learnedSns = availableSurahs.filter(s =>
      Object.keys(learnData).some(k => k.startsWith(s.number + ":") && learnData[k].learned)
    );
    const totalItems = multiItems?.length ?? 0;

    const getAyatQScoreForSn = (sn, an) => {
      const ld = learnData[`${sn}:${an}`] || {};
      const qs = ld.questionScores || {};
      const activeTypes = selectedQTypes instanceof Set ? selectedQTypes : new Set(ALL_Q_TYPES);
      const relevantKeys = Object.keys(qs).filter(k => {
        const parts = k.split(':'); if (parts.length < 3) return false;
        return activeTypes.has(parts.slice(2).join(':'));
      });
      if (relevantKeys.length === 0) return null;
      const lastScores = relevantKeys.map(k => { const arr = qs[k]; return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : 0; });
      if (lastScores.every(s => s === 1)) return 1;
      if (lastScores.some(s => s === 1)) return 0.5;
      return 0;
    };

    const setRange = (sn, field, val) =>
      setMultiRanges(prev => ({ ...prev, [sn]: { ...(prev[sn] || {}), [field]: val } }));

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:12, padding:"20px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => setStage("surah")} style={{ fontSize:9, letterSpacing:1, padding:"4px 10px",
            fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)",
            color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>←</button>
          <div style={{ fontSize:9, letterSpacing:3, color:"var(--text3)" }}>MULTI SOURATES</div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={() => setMultiSns(learnedSns.map(s => s.number))}
            style={{ fontSize:8, letterSpacing:1, padding:"3px 10px", borderRadius:20, cursor:"pointer",
              fontFamily:"'Cinzel',serif", border:"1px solid var(--teal)", background:"rgba(62,184,160,.08)", color:"var(--teal)" }}>TOUT</button>
          <button onClick={() => setMultiSns([])}
            style={{ fontSize:8, letterSpacing:1, padding:"3px 10px", borderRadius:20, cursor:"pointer",
              fontFamily:"'Cinzel',serif", border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)" }}>AUCUN</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:"60vh", overflowY:"auto" }}>
          {learnedSns.map(s => {
            const on = multiSns.includes(s.number);
            const maxA = s.numberOfAyahs;
            const r = multiRanges[s.number] || {};
            const rfN = Math.max(1, parseInt(r.from) || 1);
            const rtN = Math.min(maxA, parseInt(r.to) || maxA);
            const learned = Object.keys(learnData).filter(k => k.startsWith(s.number + ":") && learnData[k].learned).length;
            return (
              <div key={s.number} style={{ borderRadius:10, border:"1px solid " + (on ? "var(--teal)" : "var(--border)"),
                background: on ? "rgba(62,184,160,.04)" : "var(--surface2)", overflow:"hidden" }}>
                {/* Header row */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 14px", cursor:"pointer" }}
                  onClick={() => { setMultiSns(prev => on ? prev.filter(n => n !== s.number) : [...prev, s.number]); ensureQPageData(s.number); }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:16, height:16, borderRadius:4, flexShrink:0,
                      background: on ? "var(--teal)" : "transparent",
                      border:"1px solid " + (on ? "var(--teal)" : "var(--border2)"),
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:10, color:"var(--surface)" }}>{on ? "✓" : ""}</div>
                    <span style={{ fontSize:9, letterSpacing:1, color: on ? "var(--teal2)" : "var(--text3)", fontFamily:"'Cinzel',serif" }}>{s.englishName.toUpperCase()}</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:8, color:"var(--teal)", fontFamily:"'Cinzel',serif" }}>{learned} appris</span>
                    <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:16, color:"var(--gold)" }}>{s.name}</span>
                  </div>
                </div>
                {/* Per-surah range + grid (only when selected) */}
                {on && (() => {
                  const pd = qPageData[s.number];
                  // Build by-page map
                  const byPage = {};
                  if (pd?.length) {
                    pd.forEach(({ numberInSurah: an, page }) => {
                      if (!byPage[page]) byPage[page] = [];
                      byPage[page].push(an);
                    });
                  } else {
                    byPage['…'] = Array.from({ length: maxA }, (_, i) => i + 1);
                  }
                  return (
                    <div style={{ borderTop:"1px solid var(--border)", padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                      {/* Compact inline grid with page badges */}
                      <div style={{ display:"flex", flexWrap:"wrap", gap:2, alignItems:"center" }}>
                        {(() => {
                          const items = [];
                          if (pd?.length) {
                            let lastPage = null;
                            pd.forEach(({ numberInSurah: an, page }) => {
                              if (page !== lastPage) { items.push({ type:'badge', page }); lastPage = page; }
                              items.push({ type:'cell', an });
                            });
                          } else { Array.from({ length: maxA }, (_, i) => i+1).forEach(an => items.push({ type:'cell', an })); }
                          return items.map((item, i) => {
                            if (item.type === 'badge') return (
                              <span key={`p${item.page}-${i}`} style={{ fontSize:6, letterSpacing:1, color:'#c878ff',
                                fontFamily:"'Cinzel',serif", padding:'0 3px',
                                borderLeft: i > 0 ? '1px solid rgba(200,120,255,.2)' : 'none',
                                marginLeft: i > 0 ? 3 : 0, lineHeight:'18px' }}>P{item.page}</span>
                            );
                            const an = item.an;
                            const score = getAyatQScoreForSn(s.number, an);
                            const inRange = an >= rfN && an <= rtN;
                            const bg = score === null ? "var(--surface3)" : score >= 1 ? "rgba(76,175,129,.35)" : score >= 0.5 ? "rgba(201,168,76,.3)" : "rgba(229,115,115,.2)";
                            const borderCol = score === null ? "var(--border)" : score >= 1 ? "var(--green)" : score >= 0.5 ? "var(--gold)" : "var(--red)";
                            return (
                              <div key={an}
                                onClick={() => { const cur = multiRanges[s.number]||{}; const curFrom = parseInt(cur.from)||1; if(!cur.from||cur.to){setRange(s.number,'from',String(an));setRange(s.number,'to','');}else if(an<curFrom){setRange(s.number,'from',String(an));}else{setRange(s.number,'to',String(an));} }}
                                title={`${an}${score!==null?(score>=1?" ✓":score>0?" ~":" ✗"):""}`}
                                style={{ width:18, height:18, borderRadius:3, cursor:"pointer", fontSize:6,
                                  fontFamily:"'Cinzel',serif", display:"flex", alignItems:"center", justifyContent:"center",
                                  background: inRange ? bg.replace("var(--surface3)","rgba(201,168,76,.05)") : bg,
                                  border:`1px solid ${inRange?"rgba(201,168,76,.5)":borderCol}`,
                                  boxShadow: inRange ? "0 0 0 1px rgba(201,168,76,.2)" : "none",
                                  color: inRange ? "var(--gold2)" : score===null ? "var(--text3)" : score>=1 ? "var(--green)" : score>=0.5 ? "var(--gold)" : "var(--red)",
                                  transition:"all .1s" }}>
                                {an}
                              </div>
                            );
                          });
                        })()}
                      </div>
                      {/* Range inputs */}
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:7, color:"var(--text3)", letterSpacing:1 }}>DE</span>
                        <input type="number" min="1" max={maxA} value={r.from || ""} placeholder="1"
                          onChange={e => setRange(s.number, 'from', e.target.value)}
                          style={{ width:44, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:5, padding:"4px 5px", color:"var(--text)", fontSize:11, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
                        <span style={{ fontSize:7, color:"var(--text3)" }}>→</span>
                        <input type="number" min="1" max={maxA} value={r.to || ""} placeholder={String(maxA)}
                          onChange={e => setRange(s.number, 'to', e.target.value)}
                          style={{ width:44, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:5, padding:"4px 5px", color:"var(--text)", fontSize:11, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
                        <button onClick={() => setMultiRanges(prev => { const n={...prev}; delete n[s.number]; return n; })}
                          style={{ fontSize:7, letterSpacing:1, padding:"3px 7px", borderRadius:10, cursor:"pointer",
                            fontFamily:"'Cinzel',serif", border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)" }}>RESET</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
        {multiSns.length > 0 && (
          <button onClick={() => setStage("range")}
            style={{ padding:"12px", fontSize:10, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(201,168,76,.12)", border:"1px solid var(--gold)", color:"var(--gold2)",
              borderRadius:9, cursor:"pointer" }}>
            SUIVANT → ({totalItems} ayats)
          </button>
        )}
      </div>
    );
  }

  // ── Range + Type picker (combined) ──
  if (stage === "range") {
    const isMulti = multiSns.length > 0;

    // ── Multi mode: global plage + per-surah grid + types on one screen ──
    if (isMulti) {
      const TYPE_LABELS = {
        first_word:"Premier mot", last_word:"Dernier mot", missing_word:"Mot manquant",
        next_verse:"Verset suivant", previous_verse:"Verset précédent",
        verse_number:"Numéro du verset", find_ayat:"Trouver le verset",
        reconstruct:"Reconstituer", compare_verse:"Comparer sourates",
        find_surah:"Trouver la sourate", page_structure:"Structure de la page",
        revise_word:"🔖 Mot(s) à réviser", revise_part:"🔖 Partie à réviser",
        unknown_word:"Mot inconnu manquant", unknown_pick:"Identifier les mots inconnus",
      };
      const toggle = (t) => setSelectedQTypes(prev => {
        const next = new Set(prev);
        if (next.has(t)) { if (next.size > 1) next.delete(t); } else next.add(t);
        return next;
      });

      // Global plage: compute max ayat across all selected surahs
      const maxAyatGlobal = Math.max(...multiSns.map(sn => surahs.find(s => s.number === sn)?.numberOfAyahs ?? 1));
      const globalFrom = Math.max(1, parseInt(rangeFrom) || 1);
      const globalTo   = Math.min(maxAyatGlobal, parseInt(rangeTo) || maxAyatGlobal);

      // Sync multiRanges to global plage
      const applyGlobal = (f, t) => {
        const ranges = {};
        multiSns.forEach(sn => {
          const max = surahs.find(s => s.number === sn)?.numberOfAyahs ?? 1;
          ranges[sn] = { from: String(Math.max(1, f)), to: String(Math.min(max, t)) };
        });
        setMultiRanges(ranges);
      };

      const getAyatQScoreMulti = (sn, an) => {
        const ld = learnData[`${sn}:${an}`] || {};
        const qs = ld.questionScores || {};
        const activeTypes = selectedQTypes instanceof Set ? selectedQTypes : new Set(ALL_Q_TYPES);
        const keys = Object.keys(qs).filter(k => {
          const p = k.split(':'); if (p.length < 3) return false;
          return activeTypes.has(p.slice(2).join(':'));
        });
        if (!keys.length) return null;
        const last = keys.map(k => { const a = qs[k]; return Array.isArray(a) && a.length ? a[a.length-1] : 0; });
        if (last.every(s => s === 1)) return 1;
        if (last.some(s => s === 1))  return 0.5;
        return 0;
      };

      const totalItems = multiSns.reduce((acc, sn) => {
        const si = surahs.find(s => s.number === sn);
        const max = si?.numberOfAyahs ?? 1;
        const from = Math.max(1, parseInt(multiRanges[sn]?.from) || 1);
        const to   = Math.min(max, parseInt(multiRanges[sn]?.to) || max);
        return acc + (to - from + 1);
      }, 0);

      return (
        <div style={{ display:"flex", flexDirection:"column", gap:12, padding:"16px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={() => setStage("multi")} style={{ fontSize:9, letterSpacing:1, padding:"4px 10px",
              fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)",
              color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>←</button>
            <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
              {multiSns.length} SOURATE{multiSns.length > 1 ? "S" : ""}
            </div>
          </div>

          {/* Global plage */}
          <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>PLAGE (TOUTES LES SOURATES)</div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:7, color:"var(--text3)", letterSpacing:1 }}>DE</span>
              <input type="number" min="1" max={maxAyatGlobal} value={rangeFrom} placeholder="1"
                onChange={e => { setRangeFrom(e.target.value); applyGlobal(parseInt(e.target.value)||1, globalTo); }}
                style={{ width:52, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:5,
                  padding:"5px 6px", color:"var(--text)", fontSize:13, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
              <span style={{ fontSize:7, color:"var(--text3)" }}>→</span>
              <input type="number" min="1" max={maxAyatGlobal} value={rangeTo} placeholder={String(maxAyatGlobal)}
                onChange={e => { setRangeTo(e.target.value); applyGlobal(globalFrom, parseInt(e.target.value)||maxAyatGlobal); }}
                style={{ width:52, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:5,
                  padding:"5px 6px", color:"var(--text)", fontSize:13, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
              <button onClick={() => { setRangeFrom("1"); setRangeTo(""); applyGlobal(1, maxAyatGlobal); }}
                style={{ fontSize:7, padding:"3px 8px", borderRadius:10, cursor:"pointer",
                  border:"1px solid var(--gold)", background:"rgba(201,168,76,.08)", color:"var(--gold)",
                  fontFamily:"'Cinzel',serif", letterSpacing:1 }}>TOUT</button>
            </div>

            {/* Per-surah ayat grids — grouped by page */}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {multiSns.map(sn => {
                const si = surahs.find(s => s.number === sn);
                const max = si?.numberOfAyahs ?? 1;
                const from = Math.max(1, parseInt(multiRanges[sn]?.from) || 1);
                const to   = Math.min(max, parseInt(multiRanges[sn]?.to) || max);
                const pd   = qPageData[sn];
                // group by page
                const byPage = {};
                if (pd?.length) {
                  pd.forEach(({ numberInSurah: an, page }) => { if (!byPage[page]) byPage[page] = []; byPage[page].push(an); });
                } else {
                  byPage['…'] = Array.from({ length: max }, (_, i) => i + 1);
                  ensureQPageData(sn);
                }
                return (
                  <div key={sn}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:7, color:"var(--text3)", letterSpacing:1, fontFamily:"'Cinzel',serif" }}>{si?.englishName.toUpperCase()}</span>
                      <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:13, color:"var(--gold)", direction:"rtl" }}>{si?.name}</span>
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:2, alignItems:"center" }}>
                      {(() => {
                        const items = [];
                        if (pd?.length) {
                          let lastPage = null;
                          pd.forEach(({ numberInSurah: an, page }) => {
                            if (page !== lastPage) { items.push({ type:'badge', page }); lastPage = page; }
                            items.push({ type:'cell', an });
                          });
                        } else { Array.from({ length: max }, (_, i) => i+1).forEach(an => items.push({ type:'cell', an })); }
                        return items.map((item, i) => {
                          if (item.type === 'badge') return (
                            <span key={`p${item.page}-${i}`} style={{ fontSize:6, letterSpacing:1, color:'#c878ff',
                              fontFamily:"'Cinzel',serif", padding:'0 3px',
                              borderLeft: i > 0 ? '1px solid rgba(200,120,255,.2)' : 'none',
                              marginLeft: i > 0 ? 3 : 0, lineHeight:'16px' }}>P{item.page}</span>
                          );
                          const an = item.an;
                          const inRange  = an >= from && an <= to;
                          const ldEntry  = learnData[`${sn}:${an}`] || {};
                          const isRevise = !!ldEntry.toRevise;
                          return (
                            <div key={an} style={{ width:16, height:16, borderRadius:3, fontSize:6, cursor:"default",
                              display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Cinzel',serif",
                              background: isRevise ? "rgba(201,168,76,.18)" : "var(--surface3)",
                              border:`1px solid ${isRevise ? "var(--gold)" : inRange ? "rgba(255,255,255,.15)" : "var(--border)"}`,
                              color: isRevise ? "var(--gold)" : inRange ? "var(--text2)" : "var(--text3)",
                              fontWeight: isRevise ? 700 : 400,
                              boxShadow: isRevise ? "0 0 5px rgba(201,168,76,.3)" : "none" }}>
                              {an}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Types */}
          <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
              <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>TYPES DE QUESTIONS</div>
              <div style={{ display:"flex", gap:4 }}>
                <button onClick={() => setSelectedQTypes(new Set(ALL_Q_TYPES))}
                  style={{ fontSize:7, letterSpacing:1, padding:"2px 7px", borderRadius:20, cursor:"pointer",
                    fontFamily:"'Cinzel',serif", border:"1px solid var(--teal)", background:"rgba(62,184,160,.08)", color:"var(--teal)" }}>TOUT</button>
                <button onClick={() => setSelectedQTypes(new Set(["compare_verse"]))}
                  style={{ fontSize:7, letterSpacing:1, padding:"2px 7px", borderRadius:20, cursor:"pointer",
                    fontFamily:"'Cinzel',serif", border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)" }}>AUCUN</button>
              </div>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {ALL_Q_TYPES.map(t => {
                const on = selectedQTypes.has(t);
                return (
                  <button key={t} onClick={() => toggle(t)}
                    style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 8px",
                      background: on ? "rgba(62,184,160,.10)" : "var(--surface3)",
                      border:"1px solid " + (on ? "var(--teal)" : "var(--border2)"),
                      borderRadius:6, cursor:"pointer", transition:"all .15s" }}>
                    <div style={{ width:12, height:12, borderRadius:3, flexShrink:0,
                      background: on ? "var(--teal)" : "transparent",
                      border:"1px solid " + (on ? "var(--teal)" : "var(--border2)"),
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:8, color:"var(--surface)" }}>{on ? "✓" : ""}</div>
                    <span style={{ fontSize:7, letterSpacing:.5, fontFamily:"'Cinzel',serif",
                      color: on ? "var(--teal2)" : "var(--text3)" }}>{TYPE_LABELS[t]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Options + Launch */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              fontSize:9, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
              <input type="checkbox" checked={randomize} onChange={e => setRandomize(e.target.checked)}
                style={{ accentColor:"var(--teal)", width:14, height:14 }} />
              ORDRE ALÉATOIRE
            </label>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              fontSize:9, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
              <input type="checkbox" checked={skipCorrect} onChange={e => setSkipCorrect(e.target.checked)}
                style={{ accentColor:"var(--gold)", width:14, height:14 }} />
              IGNORER LES DÉJÀ CORRECTES
            </label>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              fontSize:9, letterSpacing:1, color: onlyRevise ? "var(--gold2)" : "var(--text3)", fontFamily:"'Cinzel',serif" }}>
              <input type="checkbox" checked={onlyRevise} onChange={e => setOnlyRevise(e.target.checked)}
                style={{ accentColor:"var(--gold)", width:14, height:14 }} />
              🔖 UNIQUEMENT À RÉVISER{onlyRevise ? ` (${(multiItems||[]).filter(({sn,ayatNum})=>learnData[`${sn}:${ayatNum}`]?.toRevise).length})` : ""}
            </label>
            <button onClick={() => { setStarted(true); setStage("session"); qNavigate("/revision/questions"); }}
              disabled={(multiItems?.length ?? 0) === 0}
              style={{ padding:"12px", fontSize:10, letterSpacing:2, fontFamily:"'Cinzel',serif",
                background: (multiItems?.length ?? 0) > 0 ? "rgba(201,168,76,.12)" : "var(--surface3)",
                border:`1px solid ${(multiItems?.length ?? 0) > 0 ? "var(--gold)" : "var(--border2)"}`,
                color: (multiItems?.length ?? 0) > 0 ? "var(--gold2)" : "var(--text3)",
                borderRadius:9, cursor: (multiItems?.length ?? 0) > 0 ? "pointer" : "default", marginTop:4 }}>
              ❓ LANCER {(multiItems?.length ?? 0) > 0 ? `(${new Set(multiItems.map(i=>`${i.sn}:${i.ayatNum}`)).size} AYAT${multiItems.length > 1 ? 'S' : ''})` : "(AUCUN AYAT APPRIS DANS LA PLAGE)"}
            </button>
          </div>
        </div>
      );
    }

    const rfN = Math.max(1, parseInt(rangeFrom) || 1);
    const rtN = Math.min(maxAyat, parseInt(rangeTo) || maxAyat);

    const getAyatQScore = (an) => {
      const ld = learnData[`${selectedSn}:${an}`] || {};
      const qs = ld.questionScores || {};
      const activeTypes = selectedQTypes instanceof Set ? selectedQTypes : new Set(ALL_Q_TYPES);
      const relevantKeys = Object.keys(qs).filter(k => {
        const parts = k.split(':');
        if (parts.length < 3) return false;
        const type = parts.slice(2).join(':');
        return activeTypes.has(type);
      });
      if (relevantKeys.length === 0) return null;
      const lastScores = relevantKeys.map(k => { const arr = qs[k]; return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : 0; });
      if (lastScores.every(s => s === 1)) return 1;
      if (lastScores.some(s => s === 1)) return 0.5;
      if (lastScores.every(s => s === 0)) return 0;
      return 0.5;
    };

    const handleDotClick = (an) => {
      if (clickPhase === "from") {
        setRangeFrom(String(an)); setRangeTo(""); setClickPhase("to");
      } else {
        if (an < rfN) { setRangeFrom(String(an)); setClickPhase("to"); }
        else { setRangeTo(String(an)); setClickPhase("from"); }
      }
    };

    const TYPE_LABELS = {
      first_word:"Premier mot", last_word:"Dernier mot", missing_word:"Mot manquant",
      next_verse:"Verset suivant", previous_verse:"Verset précédent",
      verse_number:"Numéro du verset", find_ayat:"Trouver le verset",
      reconstruct:"Reconstituer", compare_verse:"Comparer sourates",
      find_surah:"Trouver la sourate",
        unknown_word:"Mot inconnu manquant", unknown_pick:"Identifier les mots inconnus",
    };
    const toggle = (t) => setSelectedQTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) { if (next.size > 1) next.delete(t); } else next.add(t);
      return next;
    });

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:14, padding:"20px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => setStage(multiSns.length > 0 ? "multi" : "surah")} style={{ fontSize:9, letterSpacing:1, padding:"4px 10px",
            fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)",
            color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>←</button>
          <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:20, color:"var(--gold)", direction:"rtl" }}>{multiSns.length > 0 ? `${multiSns.length} sourates` : surahInfo?.name}</span>
          <span style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>{multiSns.length > 0 ? `${multiItems?.length ?? 0} ayats` : `${maxAyat} VERSETS`}</span>
        </div>

        {/* Ayat progress grid — grouped by page */}
        <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden" }}>
          <div onClick={() => setShowAvancement(v => !v)}
            style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", cursor:"pointer" }}>
            <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>AVANCEMENT</div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {showAvancement && <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1 }}>
                {clickPhase === "from" ? "CLIQUER : DÉBUT" : `DÉBUT ${rfN} — CLIQUER : FIN`}
              </div>}
              <span style={{ fontSize:9, color:"var(--text3)" }}>{showAvancement ? '▲' : '▼'}</span>
            </div>
          </div>
          {showAvancement && (
            <div style={{ padding:"0 14px 14px" }}>
              {(() => {
                const pd = qPageData[selectedSn];
                if (!pd) { ensureQPageData(selectedSn); }
                const items = [];
                if (pd?.length) {
                  let lastPage = null;
                  pd.forEach(({ numberInSurah: an, page }) => {
                    if (page !== lastPage) { items.push({ type:'badge', page }); lastPage = page; }
                    items.push({ type:'cell', an });
                  });
                } else { Array.from({ length: maxAyat }, (_, i) => i+1).forEach(an => items.push({ type:'cell', an })); }
                return (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:3, alignItems:'center' }}>
                    {items.map((item, i) => {
                      if (item.type === 'badge') return (
                        <span key={`p${item.page}-${i}`} style={{ fontSize:6, letterSpacing:1, color:'#c878ff',
                          fontFamily:"'Cinzel',serif", padding:'0 3px',
                          borderLeft: i > 0 ? '1px solid rgba(200,120,255,.2)' : 'none',
                          marginLeft: i > 0 ? 3 : 0, lineHeight:'20px' }}>P{item.page}</span>
                      );
                      const an = item.an;
                      const score = getAyatQScore(an); const inRange = an>=rfN&&an<=rtN; const isFrom=an===rfN; const isTo=an===rtN;
                      const ldEntry  = learnData[`${selectedSn}:${an}`] || {};
                      const isRevise = !!ldEntry.toRevise;
                      return (
                        <div key={an} onClick={e=>{e.stopPropagation();handleDotClick(an);}}
                          title={`${an}${isRevise?' 🔖':''}${score===null?'':`  ${score>=1?"✓":score>0?"~":"✗"}`}`}
                          style={{ width:20,height:20,borderRadius:4,cursor:"pointer",
                            background: isRevise ? "rgba(201,168,76,.18)" : "var(--surface3)",
                            border:`1px solid ${isFrom||isTo ? "var(--gold2)" : isRevise ? "var(--gold)" : inRange ? "rgba(255,255,255,.15)" : "var(--border)"}`,
                            boxShadow: isRevise ? "0 0 6px rgba(201,168,76,.35)" : isFrom||isTo ? "0 0 0 2px var(--gold)" : "none",
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:7, color: isRevise ? "var(--gold)" : inRange ? "var(--text2)" : "var(--text3)",
                            fontWeight: isRevise ? 700 : 400,
                            fontFamily:"'Cinzel',serif",transition:"all .1s" }}>
                          {an}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <div style={{ display:"flex", gap:10, marginTop:8, flexWrap:"wrap" }}>
                {[
                  { color:"var(--gold)",    bg:"rgba(201,168,76,.18)", label:"🔖 À réviser" },
                  { color:"rgba(201,168,76,.5)", bg:"var(--surface3)", label:"Dans la plage" },
                  { color:"var(--border)",  bg:"var(--surface3)",      label:"Non sélectionné" },
                ].map(({ color, bg, label }) => (
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ width:10, height:10, borderRadius:2, background:bg, border:`1px solid ${color}` }} />
                    <span style={{ fontSize:7, color:"var(--text3)", letterSpacing:.5 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Range + Types side by side */}
        <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>

          {/* Plage */}
          <div style={{ flex:"0 0 auto", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden" }}>
            <div onClick={() => setShowPlage(v => !v)}
              style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", cursor:"pointer" }}>
              <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>PLAGE</div>
              <span style={{ fontSize:9, color:"var(--text3)" }}>{showPlage ? '▲' : '▼'}</span>
            </div>
            {showPlage && (
            <div style={{ padding:"0 16px 16px", display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"center" }}>
                <span style={{ fontSize:7, letterSpacing:1, color:"var(--text3)" }}>DE</span>
                <input type="number" min="1" max={maxAyat} value={rangeFrom} onChange={e => { setRangeFrom(e.target.value); setClickPhase("to"); }}
                  style={{ width:52, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:6, padding:"5px 6px", color:"var(--text)", fontSize:13, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
              </div>
              <span style={{ color:"var(--text3)", marginTop:12 }}>→</span>
              <div style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"center" }}>
                <span style={{ fontSize:7, letterSpacing:1, color:"var(--text3)" }}>JUSQU'À</span>
                <input type="number" min="1" max={maxAyat} value={rangeTo} placeholder={String(maxAyat)} onChange={e => { setRangeTo(e.target.value); setClickPhase("from"); }}
                  style={{ width:52, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:6, padding:"5px 6px", color:"var(--text)", fontSize:13, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
              </div>
            </div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
              {[5,10,20].map(n => (
                <button key={n} onClick={() => { setRangeFrom("1"); setRangeTo(String(Math.min(n, maxAyat))); setClickPhase("from"); }}
                  style={{ fontSize:7, letterSpacing:1, padding:"3px 7px", borderRadius:20, cursor:"pointer", fontFamily:"'Cinzel',serif",
                    border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)" }}>
                  1→{Math.min(n, maxAyat)}
                </button>
              ))}
              <button onClick={() => { setRangeFrom("1"); setRangeTo(String(maxAyat)); setClickPhase("from"); }}
                style={{ fontSize:7, letterSpacing:1, padding:"3px 7px", borderRadius:20, cursor:"pointer", fontFamily:"'Cinzel',serif",
                  border:"1px solid var(--gold)", background:"rgba(201,168,76,.08)", color:"var(--gold)" }}>TOUS</button>
            </div>
            </div>
            )}
          </div>

          {/* Types */}
          <div style={{ flex:1, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"16px", display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>TYPES</div>
              <div style={{ display:"flex", gap:4 }}>
                <button onClick={() => setSelectedQTypes(new Set(ALL_Q_TYPES))}
                  style={{ fontSize:7, letterSpacing:1, padding:"2px 7px", borderRadius:20, cursor:"pointer",
                    fontFamily:"'Cinzel',serif", border:"1px solid var(--teal)", background:"rgba(62,184,160,.08)", color:"var(--teal)" }}>TOUT</button>
                <button onClick={() => setSelectedQTypes(new Set(["reconstruct"]))}
                  style={{ fontSize:7, letterSpacing:1, padding:"2px 7px", borderRadius:20, cursor:"pointer",
                    fontFamily:"'Cinzel',serif", border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)" }}>AUCUN</button>
              </div>
            </div>
            {ALL_Q_TYPES.map(t => {
              const on = selectedQTypes.has(t);
              // find_surah and compare_verse only work in multi-surah mode
              const multiOnly = t === 'find_surah' || t === 'compare_verse';
              const needsUnknown = t === 'unknown_word' || t === 'unknown_pick';
              // disable unknown types if no ayat in range has unknownWords
              const hasAnyUnknown = (ayatList||[]).some(an => (learnData[`${selectedSn}:${an}`]?.unknownWords||[]).length > 0);
              const disabled  = multiOnly || (needsUnknown && !hasAnyUnknown); // disabled in mono mode
              return (
                <button key={t} onClick={() => !disabled && toggle(t)}
                  title={disabled ? 'Disponible en mode multi-sourates uniquement' : undefined}
                  style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 10px",
                    background: disabled ? "var(--surface2)" : on ? "rgba(62,184,160,.10)" : "var(--surface3)",
                    border:"1px solid " + (disabled ? "var(--border)" : on ? "var(--teal)" : "var(--border2)"),
                    borderRadius:7, cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? .38 : 1,
                    transition:"all .15s", textAlign:"left" }}>
                  <div style={{ width:14, height:14, borderRadius:4, flexShrink:0,
                    background: on && !disabled ? "var(--teal)" : "transparent",
                    border:"1px solid " + (on && !disabled ? "var(--teal)" : "var(--border2)"),
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:9, color:"var(--surface)" }}>
                    {on && !disabled ? "✓" : ""}
                  </div>
                  <span style={{ fontSize:8, letterSpacing:.5, fontFamily:"'Cinzel',serif",
                    color: on && !disabled ? "var(--teal2)" : "var(--text3)" }}>{TYPE_LABELS[t]}
                    {disabled && <span style={{fontSize:6,color:'var(--text3)',marginLeft:4}}>MULTI</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Options + Launch */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
            fontSize:9, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
            <input type="checkbox" checked={randomize} onChange={e => setRandomize(e.target.checked)}
              style={{ accentColor:"var(--teal)", width:14, height:14 }} />
            ORDRE ALÉATOIRE
          </label>
          <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
            fontSize:9, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
            <input type="checkbox" checked={skipCorrect} onChange={e => setSkipCorrect(e.target.checked)}
              style={{ accentColor:"var(--gold)", width:14, height:14 }} />
            IGNORER LES DÉJÀ CORRECTES
          </label>
          <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
            fontSize:9, letterSpacing:1, color: onlyRevise ? "var(--gold2)" : "var(--text3)", fontFamily:"'Cinzel',serif" }}>
            <input type="checkbox" checked={onlyRevise} onChange={e => setOnlyRevise(e.target.checked)}
              style={{ accentColor:"var(--gold)", width:14, height:14 }} />
            🔖 UNIQUEMENT À RÉVISER{onlyRevise ? ` (${ayatList.filter(an => learnData[`${selectedSn}:${an}`]?.toRevise).length})` : ""}
          </label>
          <button onClick={() => {
            setStarted(true); setStage("session");
            if (multiSns.length > 0) qNavigate("/revision/questions");
            else qNavigate(`/revision/questions/${selectedSn}/${rangeFrom}/${rangeTo || maxAyat}/0`);
          }}
            style={{ padding:"12px", fontSize:10, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(201,168,76,.12)", border:"1px solid var(--gold)", color:"var(--gold2)",
              borderRadius:9, cursor:"pointer", marginTop:4 }}>
            {(() => {
              const learnedInRange = ayatList.filter(an => learnData[`${selectedSn}:${an}`]?.learned);
              const toReviseInRange = learnedInRange.filter(an => learnData[`${selectedSn}:${an}`]?.toRevise);
              const uniqueAyats = onlyRevise ? toReviseInRange : learnedInRange;
              const count = uniqueAyats.length;
              return `❓ LANCER (${count} AYAT${count > 1 ? 'S' : ''})`;
            })()}
          </button>
        </div>
      </div>
    );
  }

  // ── Type picker (kept as no-op redirect for back-compat) ──
  if (stage === "types") { setStage("range"); return null; }


  // ── Active session ──
  if (stage === "session" || started) {
    const isMulti = multiSns.length > 0;
    const mergedTexts = isMulti ? { ...ayatTexts, ...multiTexts } : ayatTexts;
    const filteredAyatList  = onlyRevise ? ayatList.filter(an => learnData[`${selectedSn}:${an}`]?.toRevise) : ayatList;
    const filteredMultiItems = onlyRevise ? (multiItems||[]).filter(({sn,ayatNum}) => learnData[`${sn}:${ayatNum}`]?.toRevise) : multiItems;
    return (
      <QuestionsMode
        selectedSn={isMulti ? null : selectedSn}
        ayatList={isMulti ? [] : (filteredAyatList.length ? filteredAyatList : ayatList)}
        multiItems={isMulti ? (filteredMultiItems?.length ? filteredMultiItems : multiItems) : undefined}
        surahs={surahs}
        learnData={learnData}
        setLData={setLData}
        ayatTexts={mergedTexts}
        randomize={randomize}
        selectedQTypes={selectedQTypes}
        initialQIdx={initialQIdx || 0}
        onQIdxChange={isMulti ? undefined : (qi) => qNavigate(`/revision/questions/${selectedSn}/${rangeFrom}/${rangeTo || maxAyat}/${qi}`, { replace: true })}
        onDone={() => { setStarted(false); setStage("resume"); qNavigate("/revision/questions"); }}
        skipCorrect={skipCorrect}
      />
    );
  }
}

function MemoriseMode({ surahs, learnData, setLData, initialSurahNum, initialRangeFrom, initialRangeTo }) {
  // ── Persistence helpers ──
  const MEM_KEY = 'quran_memorise_session';
  const loadSession = () => { try { return JSON.parse(localStorage.getItem(MEM_KEY)) || {}; } catch { return {}; } };
  const saveSession = (data) => { try { localStorage.setItem(MEM_KEY, JSON.stringify(data)); } catch {} };

  const saved = React.useMemo(() => {
    // URL params take priority over saved session
    if (initialSurahNum) return {};
    return loadSession();
  }, []);

  // ── ALL HOOKS FIRST (Rules of Hooks) ──
  const [selectedSn,  setSelectedSn]  = React.useState(initialSurahNum ?? saved.selectedSn  ?? null);
  const [rangeFrom,   setRangeFrom]   = React.useState(initialRangeFrom ?? saved.rangeFrom   ?? "1");
  const [rangeTo,     setRangeTo]     = React.useState(initialRangeTo ?? saved.rangeTo     ?? "");
  const [started,     setStarted]     = React.useState(initialSurahNum ? false : (saved.started ?? false));
  const [idx,         setIdx]         = React.useState(saved.idx         ?? 0);
  const [results,     setResults]     = React.useState(saved.results     ?? []);
  const [step,        setStep]        = React.useState(saved.step        ?? "sens");
  const [ayatTexts,   setAyatTexts]   = React.useState({});
  const [showVerset,  setShowVerset]  = React.useState(false);
  const [showMemo,    setShowMemo]    = React.useState(false);
  const [showInfos,   setShowInfos]   = React.useState(false);
    const [showScore, setShowScore] = React.useState(false);

  const [subMode,     setSubMode]     = React.useState("memorise"); // "memorise" | "multi"
  const [multiSns,    setMultiSns]    = React.useState([]); // selected surah numbers for multi mode
  const [multiList,   setMultiList]   = React.useState([]); // flat list of {sn, ayatNum} for multi session
  const [multiTexts,  setMultiTexts]  = React.useState({});
  const [pickerTextCache, setPickerTextCache] = React.useState({}); // sn → { an: text } — feeds mastery in "CHOISIR UNE SOURATE"
  const memNavigate = useNavigate();

  // Ayat text lookup used for mastery calc (falls back across the two caches this component maintains)
  const getAyatText = React.useCallback((sn, an) =>
    ayatTexts[`${sn}:${an}`] ?? pickerTextCache[sn]?.[an],
  [ayatTexts, pickerTextCache]);

  const availableSurahs = React.useMemo(() =>
    surahs.filter(s => s.numberOfAyahs > 0).sort((a,b) => a.number - b.number),
  [surahs]);

  const ayatList = React.useMemo(() => {
    if (!started || !selectedSn) return [];
    const si = surahs.find(s => s.number === selectedSn);
    const maxN = si?.numberOfAyahs ?? 1;
    const from = Math.max(1, parseInt(rangeFrom) || 1);
    const to   = Math.min(maxN, parseInt(rangeTo) || maxN);
    const arr = []; for (let i = from; i <= to; i++) arr.push(i);
    return arr;
  }, [started, selectedSn, surahs, rangeFrom, rangeTo]);

  React.useEffect(() => {
    saveSession({ selectedSn, rangeFrom, rangeTo, started, idx, results, step });
  }, [selectedSn, rangeFrom, rangeTo, started, idx, results, step]);

  React.useEffect(() => {
    if (!selectedSn) return;
    const k = String(selectedSn);
    if (ayatTexts[k]) return;
    fetchSurahDefault(selectedSn)
      .then(ayahs => {
        if (!ayahs?.length) return;
        const m = {};
        ayahs.forEach(a => {
          m[`${selectedSn}:${a.numberInSurah}`] = a.text;
          m[`num:${selectedSn}:${a.numberInSurah}`] = a.number;
        });
        setAyatTexts(p => ({ ...p, ...m, [k]: true }));
      }).catch(() => {});
  }, [selectedSn]);

  // Lazily fetch ayat text for every surah that has learnData, so the "CHOISIR UNE SOURATE"
  // picker (and any other unopened-surah mastery %) accounts for toRevise instead of showing 0.
  React.useEffect(() => {
    const sns = new Set();
    Object.keys(learnData).forEach(k => {
      const sn = parseInt(k.slice(0, k.indexOf(':')));
      if (!isNaN(sn)) sns.add(sn);
    });
    const toFetch = [...sns].filter(sn => !ayatTexts[String(sn)] && !pickerTextCache[sn]);
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const sn of toFetch) {
        try {
          const ayahs = await fetchSurahDefault(sn);
          if (cancelled) return;
          const map = {};
          (ayahs || []).forEach(a => { map[a.numberInSurah] = a.text; });
          setPickerTextCache(c => c[sn] ? c : { ...c, [sn]: map });
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [learnData]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setShowVerset(false); setShowMemo(false); setShowInfos(false); setShowScore(false);
  }, [idx]);

  // Load texts for all multi-mode surahs
  React.useEffect(() => {
    if (subMode !== "multi") return;
    multiSns.forEach(sn => {
      const k = String(sn);
      if (multiTexts[k]) return;
      fetchSurahDefault(sn).then(ayahs => {
        if (!ayahs?.length) return;
        const m = {};
        ayahs.forEach(a => { m[`${sn}:${a.numberInSurah}`] = a.text; });
        setMultiTexts(p => ({ ...p, ...m, [k]: true }));
      }).catch(() => {});
    });
  }, [subMode, multiSns]);

  // ── Derived values ──
  const surahInfo = surahs.find(s => s.number === selectedSn);
  const maxAyat   = surahInfo?.numberOfAyahs ?? 1;
  const current   = ayatList[idx] ?? null;
  const done      = started && idx >= ayatList.length && ayatList.length > 0;
  const ld        = learnData[`${selectedSn}:${current}`] || {};
  const ayatText      = ayatTexts[`${selectedSn}:${current}`] || "";
  const ayatGlobalNum = ayatTexts[`num:${selectedSn}:${current}`] || null;
  const bestScore = ld.memScores?.length > 0 ? Math.max(...ld.memScores) : null;

  // Surah-level mastery (all ayats in range)
  const surahMastery = React.useMemo(() => {
    if (!selectedSn || ayatList.length === 0) return null;
    const vals = ayatList.map(n => computeMastery(learnData[`${selectedSn}:${n}`] || {}, getAyatText(selectedSn, n)));
    return Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
  }, [selectedSn, ayatList, learnData, getAyatText]);

  const STEPS = [
    { id:"sens",   label:"Je me souviens du SENS",      sub:"Résumé / thème du verset" },
    { id:"mots",   label:"Je me souviens des MOTS",     sub:"Quelques mots clés" },
    { id:"partie", label:"Je me souviens d'une PARTIE", sub:"Un ou plusieurs segments" },
    { id:"entier", label:"Je récite l'AYAT ENTIER",    sub:"De mémoire, sans aide" },
  ];
  const stepIdx = STEPS.findIndex(s => s.id === step);

  const restart = () => { setIdx(0); setResults([]); setStep("sens"); };
  const back    = () => { setStarted(false); setIdx(0); setResults([]); setStep("sens"); saveSession({}); memNavigate(`/revision/memorise/${selectedSn}`); };
  const nextAyat = (score) => {
    // Persist memScore to learnData
    if (selectedSn && current !== null && setLData) {
      setLData(selectedSn, current, d => ({
        ...d, memScores: [...(d.memScores || []).slice(-9), score]
      }));
    }
    setResults(r => [...r, { ayatNum: current, score }]);
    setStep("sens"); setIdx(i => i + 1);
  };

  const toggleBtn = (active, label, onClick) => (
    <button onClick={onClick} style={{ fontSize:8, letterSpacing:1, padding:"4px 11px", borderRadius:20, cursor:"pointer",
      fontFamily:"'Cinzel',serif", border:"1px solid " + (active ? "var(--gold)" : "var(--border2)"),
      background: active ? "rgba(201,168,76,.1)" : "transparent",
      color: active ? "var(--gold2)" : "var(--text3)", transition:"all .15s" }}>
      {label}
    </button>
  );

  // ── Multi-surah mode ──────────────────────────────────────────────────────
  if (subMode === "multi" && !started) {
    const learnedSns = availableSurahs.filter(s =>
      Object.keys(learnData).some(k => k.startsWith(s.number + ":") && learnData[k].learned)
    );
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:14, padding:"16px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <button onClick={() => { setSubMode("memorise"); setSelectedSn(null); }}
            style={{ fontSize:8, letterSpacing:1.5, padding:"4px 10px", borderRadius:6, cursor:"pointer",
              background:"none", border:"1px solid var(--border2)", color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>← RETOUR</button>
          <div style={{ fontSize:9, letterSpacing:3, color:"var(--gold)" }}>QUESTIONS MULTI-SOURATES</div>
        </div>
        <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:.5 }}>
          Sélectionnez les sourates à inclure dans la session de questions
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:4 }}>
          <button onClick={() => setMultiSns(learnedSns.map(s => s.number))}
            style={{ fontSize:8, letterSpacing:1.5, padding:"4px 12px", borderRadius:6, cursor:"pointer",
              background:"rgba(201,168,76,.1)", border:"1px solid var(--gold)", color:"var(--gold2)", fontFamily:"'Cinzel',serif" }}>
            ✓ TOUTES LES APPRISES ({learnedSns.length})
          </button>
          <button onClick={() => setMultiSns([])}
            style={{ fontSize:8, letterSpacing:1.5, padding:"4px 12px", borderRadius:6, cursor:"pointer",
              background:"none", border:"1px solid var(--border2)", color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
            DÉSÉLECTIONNER
          </button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:6 }}>
          {learnedSns.map(s => {
            const sel = multiSns.includes(s.number);
            const learned = Object.keys(learnData).filter(k => k.startsWith(s.number+":") && learnData[k].learned).length;
            return (
              <button key={s.number} onClick={() => setMultiSns(p => sel ? p.filter(n => n !== s.number) : [...p, s.number])}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                  background: sel ? "rgba(201,168,76,.1)" : "var(--surface2)",
                  border:`1px solid ${sel ? "var(--gold)" : "var(--border)"}`,
                  borderRadius:8, cursor:"pointer", textAlign:"left", fontFamily:"'Cinzel',serif" }}>
                <div style={{ width:16, height:16, borderRadius:4, flexShrink:0,
                  border:`2px solid ${sel ? "var(--gold)" : "var(--border2)"}`,
                  background: sel ? "var(--gold)" : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:10 }}>
                  {sel ? "✓" : ""}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:8, letterSpacing:1, color:"var(--text2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {s.number}. {s.englishName}
                  </div>
                  <div style={{ fontSize:7, color:"var(--text3)", marginTop:2 }}>{learned} appris</div>
                </div>
              </button>
            );
          })}
        </div>
        {multiSns.length > 0 && (
          <button onClick={() => {
            // Build shuffled list of learned ayats from selected surahs
            const pool = [];
            for (const sn of multiSns) {
              const si = availableSurahs.find(s => s.number === sn);
              if (!si) continue;
              for (let i = 1; i <= si.numberOfAyahs; i++) {
                if (learnData[`${sn}:${i}`]?.learned) pool.push({ sn, ayatNum: i });
              }
            }
            // Shuffle
            for (let i = pool.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            setMultiList(pool);
            setIdx(0); setResults([]); setStep("sens");
            setStarted(true);
          }}
            style={{ padding:"11px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(201,168,76,.12)", border:"1px solid var(--gold)", color:"var(--gold2)",
              borderRadius:8, cursor:"pointer" }}>
            ▶ DÉMARRER ({multiSns.reduce((t, sn) => t + Object.keys(learnData).filter(k => k.startsWith(sn+":") && learnData[k].learned).length, 0)} ayats)
          </button>
        )}
      </div>
    );
  }

  // Multi-mode session
  if (subMode === "multi" && started) {
    const item = multiList[idx] ?? null;
    const doneMulti = idx >= multiList.length && multiList.length > 0;
    if (doneMulti) return (
      <div style={{ padding:"24px 0", textAlign:"center", display:"flex", flexDirection:"column", gap:16, alignItems:"center" }}>
        <div style={{ fontSize:14, color:"var(--gold)" }}>✓ Session terminée</div>
        <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1.5 }}>{multiList.length} AYATS · {results.filter(r=>r.score>=3).length} RÉUSSIS</div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => { setIdx(0); setResults([]); setStep("sens"); for (let i = multiList.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [multiList[i],multiList[j]]=[multiList[j],multiList[i]]; } }}
            style={{ padding:"9px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(201,168,76,.1)", border:"1px solid var(--gold)", color:"var(--gold2)", borderRadius:8, cursor:"pointer" }}>
            ↺ RECOMMENCER
          </button>
          <button onClick={() => { setStarted(false); setIdx(0); setResults([]); }}
            style={{ padding:"9px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"none", border:"1px solid var(--border2)", color:"var(--text3)", borderRadius:8, cursor:"pointer" }}>
            ← SÉLECTION
          </button>
        </div>
      </div>
    );
    if (!item) return null;
    const mLd = learnData[`${item.sn}:${item.ayatNum}`] || {};
    const mText = multiTexts[`${item.sn}:${item.ayatNum}`] || "";
    const mSurah = availableSurahs.find(s => s.number === item.sn);
    const STEPS = [
      { id:"sens",   label:"Je me souviens du SENS",      sub:"Résumé / thème du verset" },
      { id:"mots",   label:"Je me souviens des MOTS",     sub:"Quelques mots clés" },
      { id:"partie", label:"Je me souviens d'une PARTIE", sub:"Un ou plusieurs segments" },
      { id:"entier", label:"Je récite l'AYAT ENTIER",    sub:"De mémoire, sans aide" },
    ];
    const stepIdx = STEPS.findIndex(s => s.id === step);
    const nextAyatMulti = (score) => {
      if (item.sn && setLData) setLData(item.sn, item.ayatNum, d => ({ ...d, memScores: [...(d.memScores||[]).slice(-9), score] }));
      setResults(r => [...r, { sn: item.sn, ayatNum: item.ayatNum, score }]);
      setStep("sens"); setIdx(i => i + 1);
    };
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0 12px", flexWrap:"wrap" }}>
          <button onClick={() => { setStarted(false); setIdx(0); setResults([]); setStep("sens"); }}
            style={{ fontSize:8, letterSpacing:1, padding:"4px 10px", borderRadius:6, cursor:"pointer",
              background:"none", border:"1px solid var(--border2)", color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>← STOP</button>
          <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)" }}>
            {idx+1}/{multiList.length}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:"auto" }}>
            <span style={{ fontSize:9, color:"var(--gold)", fontFamily:"'Amiri Quran',serif" }}>{mSurah?.name}</span>
            <span style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>{mSurah?.englishName} · {item.ayatNum}</span>
          </div>
        </div>
        {/* Progress */}
        <div style={{ height:3, background:"var(--surface3)", borderRadius:2, marginBottom:12 }}>
          <div style={{ height:"100%", borderRadius:2, background:"var(--gold)", width: `${((idx)/multiList.length)*100}%`, transition:"width .3s" }} />
        </div>
        {/* Steps */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {STEPS.map((s, si) => {
            const active = si === stepIdx;
            const done   = si < stepIdx;
            return (
              <div key={s.id} style={{ padding:"12px 16px", borderRadius:8, border:`1px solid ${active?"var(--gold)":done?"var(--border)":"var(--border)"}`,
                background: active?"rgba(201,168,76,.06)":"transparent", opacity: si > stepIdx ? .4 : 1, transition:"all .2s" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                    border:`2px solid ${active?"var(--gold)":done?"var(--green)":"var(--border2)"}`,
                    background: done?"rgba(76,175,129,.15)":"transparent",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:done?"var(--green)":active?"var(--gold)":"var(--text3)" }}>
                    {done ? "✓" : si+1}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:9, letterSpacing:1, color: active?"var(--gold)":done?"var(--green)":"var(--text2)", fontFamily:"'Cinzel',serif" }}>{s.label}</div>
                    {active && <div style={{ fontSize:8, color:"var(--text3)", marginTop:2 }}>{s.sub}</div>}
                  </div>
                </div>
                {active && (
                  <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:8 }}>
                    {!showVerset && (
                      <button onClick={() => setShowVerset(true)} style={{ fontSize:8, letterSpacing:1.5, padding:"6px 14px", borderRadius:6, cursor:"pointer",
                        background:"rgba(62,184,160,.08)", border:"1px solid var(--teal)", color:"var(--teal2)", fontFamily:"'Cinzel',serif" }}>
                        👁 VOIR L'AYAT
                      </button>
                    )}
                    {showVerset && mText && (
                      <div style={{ direction:"rtl", fontFamily:"'Amiri Quran',serif", fontSize:20, lineHeight:2,
                        padding:"10px 14px", background:"rgba(201,168,76,.06)", borderRadius:8, border:"1px solid rgba(201,168,76,.2)" }}>
                        {mText}
                        <span style={{ fontSize:14, color:"var(--gold)", marginRight:6 }}>﴿{item.ayatNum}﴾</span>
                      </div>
                    )}
                    {mLd.highlight && (
                      <div style={{ direction:"rtl", fontFamily:"'Amiri Quran',serif", fontSize:16, color:"#ffd166",
                        padding:"6px 10px", background:"rgba(255,209,102,.07)", borderRadius:6, border:"1px solid rgba(255,209,102,.2)" }}>
                        {mLd.highlight}
                      </div>
                    )}
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:4 }}>
                      {si < STEPS.length - 1 ? (
                        <>
                          <button onClick={() => setStep(STEPS[si+1].id)} style={{ flex:1, padding:"10px", fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                            background:"rgba(62,184,160,.1)", border:"1px solid var(--teal)", color:"var(--teal2)", borderRadius:8, cursor:"pointer" }}>
                            ÉTAPE SUIVANTE →
                          </button>
                          <button onClick={() => nextAyatMulti(si+1)} style={{ padding:"10px 16px", fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                            background:"transparent", border:"1px solid var(--border2)", color:"var(--text3)", borderRadius:8, cursor:"pointer" }}>
                            TERMINER ICI
                          </button>
                        </>
                      ) : (
                        <button onClick={() => nextAyatMulti(4)} style={{ flex:1, padding:"10px", fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                          background:"rgba(76,175,129,.12)", border:"1px solid var(--green)", color:"var(--green)", borderRadius:8, cursor:"pointer" }}>
                          ✓ AYAT SUIVANT
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Sourate picker ──
  if (!selectedSn) return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, padding:"20px 0" }}>
      <div style={{ display:"flex", gap:10, marginBottom:4, flexWrap:"wrap" }}>
        <div style={{ fontSize:9, letterSpacing:3, color:"var(--gold)" }}>CHOISIR UNE SOURATE</div>
        <button onClick={() => { setSubMode("multi"); setMultiSns([]); setStarted(false); }}
          style={{ fontSize:8, letterSpacing:1.5, padding:"4px 12px", borderRadius:6, cursor:"pointer",
            background:"rgba(62,184,160,.1)", border:"1px solid var(--teal)", color:"var(--teal2)", fontFamily:"'Cinzel',serif" }}>
          ☰ MULTI-SOURATES
        </button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:8 }}>
        {availableSurahs.map(s => {
          const ayatNums = Array.from({length: s.numberOfAyahs}, (_,i) => i+1);
          const vals = ayatNums.map(n => computeMastery(learnData[`${s.number}:${n}`] || {}, getAyatText(s.number, n)));
          const pct  = Math.round(vals.reduce((a,b) => a+b, 0) / (vals.length || 1));
          return (
            <button key={s.number}
              onClick={() => { setSelectedSn(s.number); setRangeFrom("1"); setRangeTo(""); setStarted(false); setIdx(0); setResults([]); setStep("sens"); setSubMode("memorise"); memNavigate(`/revision/memorise/${s.number}`); }}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
                cursor:"pointer", textAlign:"left", transition:"all .15s", fontFamily:"'Cinzel',serif" }}>
              <span style={{ fontSize:9, color:"var(--text3)", width:22 }}>{s.number}</span>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ fontSize:9, letterSpacing:1, color:"var(--text2)" }}>{s.englishName.toUpperCase()}</span>
                <MasteryBar pct={pct} />
              </div>
              <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:16, color:"var(--gold)" }}>{s.name}</span>
            </button>
          );
        })}
      </div>
      {availableSurahs.length === 0 && <div style={{ fontSize:10, color:"var(--text3)", letterSpacing:1 }}>Aucune sourate disponible.</div>}
    </div>
  );

  // ── Range picker ──
  if (!started) {
    const rfN = Math.max(1, parseInt(rangeFrom) || 1);
    const rtN = Math.min(maxAyat, parseInt(rangeTo) || maxAyat);
    const surahVals  = Array.from({length: maxAyat}, (_,i) => computeMastery(learnData[`${selectedSn}:${i+1}`] || {}, getAyatText(selectedSn, i+1)));
    const surahPct   = Math.round(surahVals.reduce((a,b) => a+b, 0) / (surahVals.length || 1));
    const rangeVals  = Array.from({length: Math.max(0, rtN - rfN + 1)}, (_,i) => computeMastery(learnData[`${selectedSn}:${rfN+i}`] || {}, getAyatText(selectedSn, rfN+i)));
    const rangePct   = rangeVals.length > 0 ? Math.round(rangeVals.reduce((a,b) => a+b, 0) / rangeVals.length) : 0;
    const learnedInRange = rangeVals.filter((_,i) => learnData[`${selectedSn}:${rfN+i}`]?.learned).length;
    return (
    <div style={{ display:"flex", flexDirection:"column", gap:20, padding:"20px 0" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={() => { setSelectedSn(null); memNavigate("/revision/memorise"); }} style={{ fontSize:9, letterSpacing:1, padding:"4px 10px", fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)", color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>←</button>
        <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:20, color:"var(--gold)", direction:"rtl" }}>{surahInfo?.name}</span>
        <span style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>{maxAyat} VERSETS</span>
      </div>
      {/* Mastery stats */}
      <div style={{ display:"flex", gap:10 }}>
        {/* Whole surah */}
        <div style={{ flex:1, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>SOURATE ENTIÈRE</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:28, fontWeight:700, color:masteryColor(surahPct), lineHeight:1 }}>{surahPct}%</span>
            <span style={{ fontSize:8, color:"var(--text3)", letterSpacing:1 }}>MAÎTRISE</span>
          </div>
          <MasteryBar pct={surahPct} size="lg" />
          <div style={{ display:"flex", gap:8, marginTop:2 }}>
            {[
              { label:"APPRIS", val: surahVals.filter((_,i) => learnData[`${selectedSn}:${i+1}`]?.learned).length, color:"var(--green)" },
              { label:"MÉM.", val: surahVals.filter((_,i) => (learnData[`${selectedSn}:${i+1}`]?.memScores?.length > 0)).length, color:"var(--gold)" },
              { label:"QUEST.", val: surahVals.filter((_,i) => (learnData[`${selectedSn}:${i+1}`]?.questionScores && Object.keys(learnData[`${selectedSn}:${i+1}`].questionScores).length > 0)).length, color:"var(--teal2)" },
            ].map(({label, val, color}) => (
              <div key={label} style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>
                <span style={{ color, fontFamily:"'Cinzel',serif", fontSize:11 }}>{val}</span> {label}
              </div>
            ))}
          </div>
        </div>
        {/* Selected range */}
        <div style={{ flex:1, background:"var(--surface2)", border:"1px solid "+masteryColor(rangePct), borderRadius:10, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)" }}>PLAGE {rfN}–{rtN}</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:28, fontWeight:700, color:masteryColor(rangePct), lineHeight:1 }}>{rangePct}%</span>
            <span style={{ fontSize:8, color:"var(--text3)", letterSpacing:1 }}>MAÎTRISE</span>
          </div>
          <MasteryBar pct={rangePct} size="lg" />
          <div style={{ display:"flex", gap:8, marginTop:2 }}>
            <div style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>
              <span style={{ color:"var(--green)", fontFamily:"'Cinzel',serif", fontSize:11 }}>{learnedInRange}</span>/{rangeVals.length} APPRIS
            </div>
            <div style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>
              <span style={{ color:"var(--gold)", fontFamily:"'Cinzel',serif", fontSize:11 }}>{rangeVals.filter((_,i) => (learnData[`${selectedSn}:${rfN+i}`]?.memScores?.length > 0)).length}</span> MÉM.
            </div>
          </div>
          {/* Per-ayat mini dots */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:2 }}>
            {rangeVals.map((m, i) => (
              <div key={i} title={`${rfN+i}: ${m}%`} style={{ width:14, height:14, borderRadius:3,
                background: m >= 80 ? "rgba(76,175,129,.3)" : m >= 50 ? "rgba(201,168,76,.25)" : m > 0 ? "rgba(62,184,160,.2)" : "var(--surface3)",
                border:"1px solid "+masteryColor(m),
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:7, color:masteryColor(m), fontFamily:"'Cinzel',serif" }}>
                {rfN+i}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>
        <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>PLAGE DE VERSETS</div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
            <span style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>DE</span>
            <input type="number" min="1" max={maxAyat} value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
              style={{ width:64, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:6, padding:"6px 8px", color:"var(--text)", fontSize:14, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
          </div>
          <span style={{ color:"var(--text3)", marginTop:14 }}>→</span>
          <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
            <span style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>JUSQU'À</span>
            <input type="number" min="1" max={maxAyat} value={rangeTo} placeholder={String(maxAyat)} onChange={e => setRangeTo(e.target.value)}
              style={{ width:64, background:"var(--surface3)", border:"1px solid var(--border2)", borderRadius:6, padding:"6px 8px", color:"var(--text)", fontSize:14, fontFamily:"'Cinzel',serif", textAlign:"center", outline:"none" }} />
          </div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[5,10,20].map(n => (
            <button key={n} onClick={() => { setRangeFrom("1"); setRangeTo(String(Math.min(n, maxAyat))); }}
              style={{ fontSize:8, letterSpacing:1, padding:"4px 10px", borderRadius:20, cursor:"pointer", fontFamily:"'Cinzel',serif",
                border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)" }}>
              1 → {Math.min(n, maxAyat)}
            </button>
          ))}
          <button onClick={() => { setRangeFrom("1"); setRangeTo(String(maxAyat)); }}
            style={{ fontSize:8, letterSpacing:1, padding:"4px 10px", borderRadius:20, cursor:"pointer", fontFamily:"'Cinzel',serif",
              border:"1px solid var(--gold)", background:"rgba(201,168,76,.08)", color:"var(--gold)" }}>TOUS</button>
        </div>
        {/* Sub-mode selection */}
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => { setSubMode("memorise"); setStarted(true); memNavigate(`/revision/memorise/${selectedSn}/${rangeFrom}/${rangeTo || maxAyat}`); }}
            style={{ flex:1, padding:"10px", fontSize:10, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(62,184,160,.1)", border:"1px solid var(--teal)", color:"var(--teal2)", borderRadius:8, cursor:"pointer" }}>
            ▶ MÉMORISER
          </button>
        </div>
      </div>
    </div>
    );
  }

  // ── Session terminée ──
  if (done) {
    const good = results.filter(r => r.score >= 2).length;
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20, padding:"30px 20px" }}>
        <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:28, color:"var(--gold)", direction:"rtl" }}>{surahInfo?.name}</div>
        <div style={{ fontSize:36, fontFamily:"'Cinzel',serif", color: good===results.length?"var(--green)":good>results.length/2?"var(--gold2)":"var(--red)", letterSpacing:-1 }}>{good}/{results.length}</div>
        <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>VERSETS MÉMORISÉS</div>
        {surahMastery !== null && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, width:'100%', maxWidth:220 }}>
            <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:2 }}>MAÎTRISE DE LA PLAGE</div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:28, color:masteryColor(surahMastery) }}>{surahMastery}%</div>
            <MasteryBar pct={surahMastery} size="lg" />
          </div>
        )}
        <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap", justifyContent:"center" }}>
          <button onClick={restart} style={{ padding:"8px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--gold)", color:"var(--gold)", borderRadius:6, cursor:"pointer" }}>↺ RECOMMENCER</button>
          <button onClick={back} style={{ padding:"8px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)", color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>← PLAGE</button>
          <button onClick={() => { setSelectedSn(null); memNavigate("/revision/memorise"); }} style={{ padding:"8px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)", color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>⌂ SOURATES</button>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8, justifyContent:"center" }}>
          {results.map(r => {
            const m = computeMastery(learnData[`${selectedSn}:${r.ayatNum}`] || {}, getAyatText(selectedSn, r.ayatNum));
            return (
              <div key={r.ayatNum} style={{ width:36, height:36, borderRadius:6,
                border:"1px solid " + (r.score>=4?"var(--green)":r.score>=2?"var(--gold)":"var(--red)"),
                display:"flex", flexDirection:'column', alignItems:"center", justifyContent:"center",
                fontSize:9, color:r.score>=4?"var(--green)":r.score>=2?"var(--gold)":"var(--red)",
                fontFamily:"'Cinzel',serif", position:'relative', overflow:'hidden' }}>
                {r.ayatNum}
                <div style={{ position:'absolute', bottom:0, left:0, right:0, height:3,
                  background:masteryColor(m), opacity:.8 }} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Question card ──
  const progress = ayatList.length > 0 ? Math.round((idx / ayatList.length) * 100) : 0;
  const currentMastery = computeMastery(ld, ayatText);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, padding:"16px 0" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={back} style={{ fontSize:9, letterSpacing:1, padding:"4px 10px", fontFamily:"'Cinzel',serif", background:"transparent", border:"1px solid var(--border2)", color:"var(--text3)", borderRadius:6, cursor:"pointer" }}>← {surahInfo?.englishName?.toUpperCase()}</button>
        <div style={{ flex:1, height:4, background:"var(--surface3)", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:progress+"%", background:"var(--gold)", borderRadius:2, transition:"width .3s" }} />
        </div>
        <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1, flexShrink:0 }}>{idx+1}/{ayatList.length}</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"28px 20px", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12 }}>
        <div style={{ fontSize:9, letterSpacing:3, color:"var(--text3)" }}>VERSET</div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontFamily:"'Cinzel',serif", fontSize:72, fontWeight:700, color:"var(--gold2)", lineHeight:1 }}>{current}</div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <MasteryBadge pct={currentMastery} />
          </div>
        </div>
        <div style={{ fontSize:9, letterSpacing:1.5, color:"var(--text3)" }}>{surahInfo?.name ?? ""}</div>
        {/* Toggle buttons */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", marginTop:4 }}>
          {toggleBtn(showVerset, "📖 VERSET",       () => setShowVerset(v => !v))}
          {toggleBtn(showMemo,   "🗒 AIDE MÉMOIRE",  () => setShowMemo(v => !v))}
          {toggleBtn(showInfos,  "ℹ INFOS",          () => setShowInfos(v => !v))}
          {toggleBtn(showScore,  "🏆 MEILLEUR",       () => setShowScore(v => !v))}
        </div>
        {showVerset && (
          <div style={{ width:"100%", padding:"12px 16px", background:"var(--surface3)", borderRadius:8, border:"1px solid var(--border2)", direction:"rtl", textAlign:"right" }}>
            {ayatText
              ? <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:22, color:"var(--text)", lineHeight:2 }}>{ayatText}</span>
              : <span style={{ fontSize:9, color:"var(--text3)" }}>Chargement…</span>}
            {ayatGlobalNum && (
              <div style={{ direction:"ltr", marginTop:10, display:"flex", alignItems:"center", gap:8 }}>
                <audio
                  key={ayatGlobalNum}
                  src={`${getAudioBase()}/${ayatGlobalNum}.mp3`}
                  controls
                  style={{ flex:1, height:32, minWidth:0, accentColor:"var(--gold)", colorScheme:"dark" }}
                />
              </div>
            )}
          </div>
        )}
        {showMemo && (
          <div style={{ width:"100%", padding:"12px 16px", background:"var(--surface3)", borderRadius:8, border:"1px solid var(--border2)", display:"flex", flexDirection:"column", gap:8 }}>
            {ld.highlight && <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>🔑 <span style={{ color:"var(--gold2)", fontFamily:"'Amiri Quran',serif", fontSize:16, direction:"rtl" }}>{ld.highlight}</span></div>}
            {ld.subject   && <div style={{ fontSize:9, color:"var(--text2)", letterSpacing:.5 }}>📌 {ld.subject}</div>}
            {ld.pagePosition && <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>📄 <span style={{ color:"var(--teal2)" }}>{ld.pagePosition?.toUpperCase()}</span></div>}
            {!ld.highlight && !ld.subject && !ld.pagePosition && <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>Aucune note.</div>}
          </div>
        )}
        {showInfos && <MemoriseInfoPanel surahNum={selectedSn} ayatNum={current} />}
        {showScore && (
          <div style={{ width:"100%", padding:"12px 16px", background:"var(--surface3)", borderRadius:8, border:"1px solid var(--border2)", display:"flex", flexDirection:"column", gap:8, alignItems:"center" }}>
            <div style={{ display:'flex', gap:16, alignItems:'center' }}>
              {bestScore !== null
                ? <>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:22, color: bestScore>=4?"var(--green)":bestScore>=2?"var(--gold2)":"var(--red)" }}>{["—","SENS","MOTS","PARTIE","COMPLET"][bestScore] ?? bestScore}</div>
                    <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1 }}>MÉMORISATION</div>
                  </>
                : <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>Pas encore révisé.</div>}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:22, color:masteryColor(currentMastery) }}>{currentMastery}%</div>
                <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:1 }}>MAÎTRISE</div>
              </div>
            </div>
            <MasteryBar pct={currentMastery} size="lg" />
          </div>
        )}
        {/* Step dots */}
        <div style={{ display:"flex", gap:6, marginTop:4 }}>
          {STEPS.map((s,i) => (
            <div key={s.id} style={{ width:8, height:8, borderRadius:"50%",
              background: i < stepIdx ? "var(--green)" : i === stepIdx ? "var(--gold2)" : "var(--surface3)",
              border: "1px solid " + (i < stepIdx ? "var(--green)" : i === stepIdx ? "var(--gold)" : "var(--border2)"),
              transition:"all .2s" }} />
          ))}
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:10, letterSpacing:1.5, color:"var(--gold)", fontFamily:"'Cinzel',serif" }}>{STEPS[stepIdx]?.label}</div>
          <div style={{ fontSize:8, color:"var(--text3)", marginTop:4, letterSpacing:1 }}>{STEPS[stepIdx]?.sub}</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
          <button onClick={() => { if (stepIdx < STEPS.length-1) setStep(STEPS[stepIdx+1].id); else nextAyat(4); }}
            style={{ padding:"9px 22px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(76,175,129,.12)", border:"1px solid var(--green)", color:"var(--green)", borderRadius:8, cursor:"pointer" }}>
            ✓ OUI
          </button>
          <button onClick={() => nextAyat(stepIdx)}
            style={{ padding:"9px 22px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:"rgba(224,90,90,.08)", border:"1px solid var(--red)", color:"var(--red)", borderRadius:8, cursor:"pointer" }}>
            ✗ NON
          </button>
        </div>
        <button onClick={() => nextAyat(STEPS.length)}
          style={{ padding:"7px 22px", fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
            background:"rgba(201,168,76,.1)", border:"1px solid var(--gold)", color:"var(--gold2)",
            borderRadius:20, cursor:"pointer", transition:"all .2s" }}>
          ⚡ JE ME SOUVIENS DE TOUT
        </button>
        {step !== "sens" && (
          <button onClick={() => setStep("sens")}
            style={{ fontSize:8, color:"var(--text3)", background:"transparent", border:"none", cursor:"pointer", letterSpacing:1, fontFamily:"'Cinzel',serif" }}>
            ↺ RECOMMENCER CET AYAT
          </button>
        )}
      </div>
    </div>
  );
}


function MemoriseInfoPanel({ surahNum, ayatNum }) {
  const [meta, setMeta] = React.useState(null);
  React.useEffect(() => {
    let c = false;
    fetchAyahMeta(surahNum, ayatNum).then(d => { if (!c && d) setMeta(d); }).catch(() => {});
    return () => { c = true; };
  }, [surahNum, ayatNum]);
  if (!meta) return <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1, width:"100%", textAlign:"center" }}>Chargement…</div>;
  const rows = [
    ["JUZ",   meta.juz],
    ["PAGE",  meta.page],
    ["HIZB",  Math.ceil(meta.hizbQuarter / 4)],
    ["MANZIL",meta.manzil],
  ];
  return (
    <div style={{ width:"100%", display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
      {rows.map(([l,v]) => (
        <div key={l} style={{ padding:"8px 14px", background:"var(--surface3)", borderRadius:8, border:"1px solid var(--border2)", textAlign:"center", minWidth:60 }}>
          <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1 }}>{l}</div>
          <div style={{ fontFamily:"'Cinzel',serif", fontSize:14, color:"var(--gold2)", marginTop:2 }}>{v}</div>
        </div>
      ))}
      {meta.sajda && <div style={{ padding:"8px 14px", background:"rgba(201,168,76,.08)", borderRadius:8, border:"1px solid var(--gold)", textAlign:"center", minWidth:60 }}><div style={{ fontSize:8, color:"var(--gold)", letterSpacing:1 }}>SAJDA</div><div style={{ fontSize:14, color:"var(--gold2)", marginTop:2 }}>✓</div></div>}
    </div>
  );
}

// ─── RappelWidget — rappel vocal global flottant ─────────────────────────────
// Accessible depuis n'importe quelle page via le bouton dans le header.
function RappelWidget({ onClose }) {
  const [rappelOn,    setRappelOn]    = useState(false);
  const [rappelX,     setRappelX]     = useState(30);
  const [rappelY,     setRappelY]     = useState('');
  const [rappelLang,  setRappelLang]  = useState('ar-SA');
  const [rappelCount, setRappelCount] = useState(0);
  const timerRef  = useRef(null);
  const activeRef = useRef(false);

  const stopRappel = () => {
    activeRef.current = false;
    clearTimeout(timerRef.current);
    clearInterval(keepAliveRef?.current);
    timerRef.current = null;
    window.speechSynthesis?.cancel();
    setRappelOn(false);
  };
  useEffect(() => () => { if (!activeRef.current) stopRappel(); }, []); // eslint-disable-line

  const intervalSecRef = useRef(30);
  const langRef        = useRef('ar-SA');
  const textRef        = useRef('');
  const keepAliveRef   = useRef(null);

  const startRappel = () => {
    if (!rappelY.trim()) return;
    activeRef.current = true;
    intervalSecRef.current = rappelX;
    langRef.current  = rappelLang;
    textRef.current  = rappelY.trim();
    setRappelOn(true);
    setRappelCount(0);

    const ss = window.speechSynthesis;
    if (!ss) return;

    // Keep-alive: Android Chrome pauses TTS after ~15s without a resume()
    keepAliveRef.current = setInterval(() => { if (ss.paused) ss.resume(); }, 5000);

    const scheduleNext = () => {
      if (!activeRef.current) return;
      timerRef.current = setTimeout(() => {
        if (!activeRef.current) return;
        doSpeak();
      }, intervalSecRef.current * 1000);
    };

    const doSpeak = () => {
      if (!activeRef.current) return;
      ss.cancel();
      const utt = new SpeechSynthesisUtterance(textRef.current);
      utt.lang   = langRef.current;
      utt.rate   = 0.85;
      utt.volume = 1;
      utt.onend  = () => { if (activeRef.current) scheduleNext(); };
      utt.onerror = () => { if (activeRef.current) scheduleNext(); };
      ss.speak(utt);
      setRappelCount(c => c + 1);
    };

    doSpeak(); // first speak immediately (called from button click = user gesture ✓)
  };

  // Keep refs in sync with state for use inside closures
  React.useEffect(() => { intervalSecRef.current = rappelX; }, [rappelX]);
  React.useEffect(() => { langRef.current = rappelLang; }, [rappelLang]);
  React.useEffect(() => { textRef.current = rappelY.trim(); }, [rappelY]);

  return (
    <div style={{
      position:'fixed', bottom: 80, right: 16, zIndex: 300,
      background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:'var(--radius)',
      padding:'16px', width: 300, boxShadow:'0 8px 32px rgba(0,0,0,.5)',
      display:'flex', flexDirection:'column', gap:12,
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontSize:10, letterSpacing:2, color:rappelOn?'#ffd166':'var(--text3)', fontFamily:"'Cinzel',serif" }}>
          🔔 RAPPEL VOCAL{rappelOn ? ` · ${rappelCount}×` : ''}
        </div>
        <button onClick={onClose} style={{ fontSize:12, background:'transparent', border:'none', color:'var(--text3)', cursor:'pointer' }}>✕</button>
      </div>

      {/* Texte */}
      <textarea value={rappelY} onChange={e=>setRappelY(e.target.value)} disabled={rappelOn}
        placeholder="Texte à lire périodiquement…" rows={3} dir="rtl"
        style={{ background:'var(--surface3)', border:'1px solid var(--border2)', borderRadius:'var(--radius-sm)',
          padding:'8px 10px', color:'var(--text)', fontSize:16, fontFamily:"'Amiri Quran',serif",
          resize:'vertical', outline:'none', textAlign:'right', opacity:rappelOn?0.6:1, width:'100%' }} />

      {/* Intervalle */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
        {[10,30,60,120,300].map(v => (
          <button key={v} onClick={()=>setRappelX(v)} disabled={rappelOn}
            style={{ fontSize:9, padding:'4px 10px', borderRadius:20, cursor:'pointer', fontFamily:"'Cinzel',serif",
              border:`1px solid ${rappelX===v?'var(--gold)':'var(--border2)'}`,
              background:rappelX===v?'rgba(201,168,76,.12)':'transparent',
              color:rappelX===v?'var(--gold)':'var(--text3)', opacity:rappelOn?0.5:1 }}>
            {v<60?`${v}s`:`${v/60}min`}
          </button>
        ))}
        <input type="number" min="1" value={rappelX} onChange={e=>setRappelX(Math.max(1,parseInt(e.target.value)||1))}
          disabled={rappelOn}
          style={{ width:52, background:'var(--surface3)', border:'1px solid var(--border2)', borderRadius:'var(--radius-sm)',
            padding:'4px 6px', color:'var(--text)', fontSize:10, outline:'none', textAlign:'center', opacity:rappelOn?0.5:1 }} />
      </div>

      {/* Langue */}
      <div style={{ display:'flex', gap:5 }}>
        {[['ar-SA','AR'],['fr-FR','FR'],['en-US','EN']].map(([lang,label]) => (
          <button key={lang} onClick={()=>setRappelLang(lang)} disabled={rappelOn}
            style={{ fontSize:9, padding:'3px 10px', borderRadius:20, cursor:'pointer', fontFamily:"'Cinzel',serif",
              border:`1px solid ${rappelLang===lang?'#5bc8f5':'var(--border2)'}`,
              background:rappelLang===lang?'rgba(91,200,245,.1)':'transparent',
              color:rappelLang===lang?'#5bc8f5':'var(--text3)', opacity:rappelOn?0.5:1 }}>
            {label}
          </button>
        ))}
      </div>

      {/* Toggle */}
      <button onClick={rappelOn ? stopRappel : startRappel} disabled={!rappelY.trim() && !rappelOn}
        style={{ padding:'8px', fontSize:10, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
          background: rappelOn?'rgba(255,107,107,.12)':'rgba(201,168,76,.08)',
          border:`1px solid ${rappelOn?'#ff6b6b':'var(--gold)'}`,
          color: rappelOn?'#ff6b6b':'var(--gold)',
          borderRadius:'var(--radius-sm)', cursor:'pointer',
          opacity:(!rappelY.trim()&&!rappelOn)?0.4:1 }}>
        {rappelOn ? `⏹ ARRÊTER` : '▶ DÉMARRER'}
      </button>
    </div>
  );
}

// ─── ROOT EXPORT — wraps AppInner in Redux Provider ───────────────────────────
// ─── LoginScreen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLoggedIn }) {
  const [mode, setMode]         = useState("login"); // "login" | "register"
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  const handleEmail = async () => {
    setError(null);
    if (!email || !password) { setError("Remplissez tous les champs."); return; }
    setLoading(true);
    try {
      if (mode === "register") {
        const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
        onLoggedIn(cred.user);
      } else {
        const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
        onLoggedIn(cred.user);
      }
    } catch (e) {
      const msgs = {
        "auth/user-not-found":       "Aucun compte avec cet email.",
        "auth/wrong-password":       "Mot de passe incorrect.",
        "auth/email-already-in-use": "Email déjà utilisé.",
        "auth/weak-password":        "Mot de passe trop court (6 car. min).",
        "auth/invalid-email":        "Email invalide.",
        "auth/invalid-credential":   "Email ou mot de passe incorrect.",
      };
      setError(msgs[e.code] || e.message);
    } finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    setError(null); setLoading(true);
    try {
      if (IS_ANDROID) {
        // Capacitor/Android: use native Google Sign-In via @capacitor-firebase/authentication
        // This avoids any WebView redirect / localhost callback issues
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const result = await FirebaseAuthentication.signInWithGoogle();
        // Link native credential to Firebase JS SDK so the rest of the app
        // (Firestore, onAuthStateChanged, etc.) works normally
        const { GoogleAuthProvider: GAP, signInWithCredential } = await import("firebase/auth");
        const credential = GAP.credential(result.credential.idToken);
        const cred = await signInWithCredential(firebaseAuth, credential);
        onLoggedIn(cred.user);
      } else {
        const cred = await signInWithPopup(firebaseAuth, googleProvider);
        onLoggedIn(cred.user);
      }
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user") setError(e.message || String(e));
    } finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight:"100vh", background:"var(--bg)",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'Cinzel',serif", padding:"20px",
    }}>
      <div style={{
        width:"100%", maxWidth:380,
        background:"var(--surface)", border:"1px solid var(--border)",
        borderRadius:16, padding:"36px 28px",
        boxShadow:"0 20px 60px rgba(0,0,0,.5)",
      }}>
        {/* Logo / title */}
        <div style={{textAlign:"center", marginBottom:32}}>
          <div style={{fontSize:36, marginBottom:8}}>☽</div>
          <div style={{fontSize:18, letterSpacing:4, color:"var(--gold)", fontWeight:600}}>QURAN</div>
          <div style={{fontSize:9, letterSpacing:6, color:"var(--text3)", marginTop:4}}>
            {mode === "login" ? "CONNEXION" : "CRÉER UN COMPTE"}
          </div>
        </div>

        {/* Google */}
        <button onClick={handleGoogle} disabled={loading} style={{
          width:"100%", padding:"12px 16px", borderRadius:10,
          border:"1px solid var(--border2)", background:"var(--surface2)",
          color:"var(--text)", fontSize:12, letterSpacing:2,
          cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
          gap:10, marginBottom:20, transition:"border-color .2s",
        }}
          onMouseOver={e=>e.currentTarget.style.borderColor="var(--gold)"}
          onMouseOut={e=>e.currentTarget.style.borderColor="var(--border2)"}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.3-.1-2.6-.4-3.9z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 12 24 12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.2 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.3C9.7 38.9 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.1-2.2 3.9-4 5.2l6.2 5.2C36.5 41.8 44 36 44 24c0-1.3-.1-2.6-.4-3.9z"/>
          </svg>
          CONTINUER AVEC GOOGLE
        </button>

        {/* Divider */}
        <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:20}}>
          <div style={{flex:1, height:1, background:"var(--border)"}}/>
          <span style={{fontSize:9, letterSpacing:2, color:"var(--text3)"}}>OU</span>
          <div style={{flex:1, height:1, background:"var(--border)"}}/>
        </div>

        {/* Name (register only) */}
        {mode === "register" && (
          <input
            placeholder="Prénom (optionnel)"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
          />
        )}

        {/* Email */}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleEmail()}
          style={inputStyle}
        />

        {/* Password */}
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleEmail()}
          style={{ ...inputStyle, marginBottom: 20 }}
        />

        {/* Error */}
        {error && (
          <div style={{
            background:"rgba(224,90,90,.12)", border:"1px solid rgba(224,90,90,.3)",
            borderRadius:8, padding:"10px 14px", fontSize:11, color:"var(--red)",
            marginBottom:16, letterSpacing:.5,
          }}>{error}</div>
        )}

        {/* Submit */}
        <button onClick={handleEmail} disabled={loading} style={{
          width:"100%", padding:"13px 16px", borderRadius:10,
          border:"none", background:"linear-gradient(135deg,var(--gold),var(--gold2))",
          color:"#0c0e14", fontSize:11, letterSpacing:3, fontWeight:700,
          cursor:"pointer", marginBottom:16, fontFamily:"'Cinzel',serif",
          opacity: loading ? .6 : 1, transition:"opacity .2s",
        }}>
          {loading ? "…" : mode === "login" ? "SE CONNECTER" : "CRÉER LE COMPTE"}
        </button>

        {/* Toggle */}
        <div style={{textAlign:"center", fontSize:10, letterSpacing:1, color:"var(--text3)"}}>
          {mode === "login" ? "Pas encore de compte ?" : "Déjà un compte ?"}{" "}
          <span
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
            style={{color:"var(--gold)", cursor:"pointer", letterSpacing:1}}
          >
            {mode === "login" ? "S'inscrire" : "Se connecter"}
          </span>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width:"100%", padding:"12px 14px", borderRadius:10,
  border:"1px solid var(--border2)", background:"var(--surface2)",
  color:"var(--text)", fontSize:13, marginBottom:12,
  outline:"none", boxSizing:"border-box", fontFamily:"inherit",
  letterSpacing:.5,
};

// ─── Sync log (shared mutable ref, no re-render cost) ────────────────────────
const syncLogEntries = []; // max 50 entries, push/shift in place
function addSyncLog(type, msg) {
  const entry = { type, msg, time: new Date().toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }) };
  syncLogEntries.unshift(entry);
  if (syncLogEntries.length > 50) syncLogEntries.length = 50;
  // notify all SyncConsole subscribers
  window.__syncLogListeners?.forEach(fn => fn([...syncLogEntries]));
}

function SyncConsole() {
  const [logs, setLogs] = React.useState([...syncLogEntries]);
  const [open, setOpen] = React.useState(false);

  useEffect(() => {
    if (!window.__syncLogListeners) window.__syncLogListeners = new Set();
    window.__syncLogListeners.add(setLogs);
    return () => window.__syncLogListeners.delete(setLogs);
  }, []);

  const colors = { save:"#6ee7b7", restore:"#93c5fd", error:"#fca5a5", info:"#fde68a", skip:"#94a3b8" };

  return (
    <div style={{ position:"fixed", bottom:60, right:12, zIndex:9999, fontFamily:"monospace", fontSize:10 }}>
      <button onClick={() => setOpen(v => !v)} style={{
        background:"#0f172a", border:"1px solid #334155", color:"#94a3b8",
        borderRadius:8, padding:"4px 10px", cursor:"pointer", fontSize:10,
        boxShadow:"0 2px 8px rgba(0,0,0,.5)"
      }}>☁ {open ? "▾ SYNC LOG" : "▸ SYNC LOG"} {logs.length > 0 && <span style={{color: colors[logs[0]?.type]||"#fff"}}>●</span>}</button>
      {open && (
        <div style={{
          marginTop:4, background:"#0f172a", border:"1px solid #334155",
          borderRadius:8, padding:8, width:320, maxHeight:340,
          overflowY:"auto", boxShadow:"0 4px 20px rgba(0,0,0,.7)"
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{color:"#475569", fontSize:9, letterSpacing:1}}>CLOUD SYNC LOG</span>
            <button onClick={() => { syncLogEntries.length = 0; setLogs([]); }} style={{
              background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:9
            }}>✕ CLEAR</button>
          </div>
          {logs.length === 0 && <div style={{color:"#475569", fontSize:9}}>Aucune activité</div>}
          {logs.map((l, i) => (
            <div key={i} style={{ display:"flex", gap:6, padding:"3px 0", borderBottom:"1px solid #1e293b" }}>
              <span style={{ color:"#475569", minWidth:24 }}>{l.time}</span>
              <span style={{ color: colors[l.type] || "#fff", minWidth:14 }}>
                {l.type==="save"?"↑":l.type==="restore"?"↓":l.type==="error"?"✕":l.type==="skip"?"—":"·"}
              </span>
              <span style={{ color:"#cbd5e1", wordBreak:"break-all" }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OptionsModal ─────────────────────────────────────────────────────────────
function OptionsModal({ onClose }) {
  const dispatch = useDispatch();
  const enableTimestamps      = useSelector(sel.enableTimestamps);
  const enableLetterByLetter  = useSelector(sel.enableLetterByLetter);
  const enableAnimations      = useSelector(sel.enableAnimations);
  const enableHeavyCompute    = useSelector(sel.enableHeavyCompute);
  const showQalqala           = useSelector(sel.showQalqala);
  const showMadd              = useSelector(sel.showMadd);
  const showIzhar             = useSelector(sel.showIzhar);
  const showIdgham            = useSelector(sel.showIdgham);
  const showParts             = useSelector(sel.showParts);
  const spellCheck            = useSelector(sel.spellCheck);
  const announceNum           = useSelector(sel.announceNum);

  const Row = ({ label, desc, on, onToggle, color = "var(--teal2)" }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
      <div style={{ flex:1, paddingRight:12 }}>
        <div style={{ fontSize:10, letterSpacing:1.5, color:"var(--text)", fontFamily:"'Cinzel',serif" }}>{label}</div>
        {desc && <div style={{ fontSize:8, color:"var(--text3)", marginTop:2, letterSpacing:.5, lineHeight:1.5 }}>{desc}</div>}
      </div>
      <div onClick={onToggle} style={{
        width:42, height:24, borderRadius:12, cursor:"pointer", flexShrink:0,
        background: on ? color : "var(--surface3)",
        border:"1px solid " + (on ? color : "var(--border2)"),
        position:"relative", transition:"background .2s",
      }}>
        <div style={{
          position:"absolute", top:3, left: on ? 21 : 3,
          width:16, height:16, borderRadius:"50%",
          background: on ? "#fff" : "var(--text3)",
          transition:"left .2s",
        }} />
      </div>
    </div>
  );

  const Section = ({ title }) => (
    <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)", paddingTop:16, paddingBottom:2 }}>{title}</div>
  );

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:2000,
      background:"rgba(0,0,0,.6)", display:"flex", alignItems:"flex-end",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"var(--surface)", borderRadius:"18px 18px 0 0",
        width:"100%", maxHeight:"85vh", overflowY:"auto",
        boxShadow:"0 -4px 32px rgba(0,0,0,.5)",
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"14px 20px 10px", borderBottom:"1px solid var(--border)",
          position:"sticky", top:0, background:"var(--surface)", zIndex:1 }}>
          <span style={{ fontSize:10, letterSpacing:3, color:"var(--gold2)", fontFamily:"'Cinzel',serif" }}>⚙ OPTIONS</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"0 20px 32px" }}>
          <Section title="PERFORMANCE" />
          <Row label="TIMESTAMPS" desc="Synchronisation audio — désactiver accélère le chargement" on={enableTimestamps} onToggle={() => dispatch(uiActions.toggleEnableTimestamps())} color="var(--teal2)" />
          <Row label="LETTRE PAR LETTRE" desc="Surlignage animé pendant la lecture audio" on={enableLetterByLetter} onToggle={() => dispatch(uiActions.toggleEnableLetterByLetter())} color="#5bc8f5" />
          <Row label="ANIMATIONS" desc="Transitions entre pages" on={enableAnimations} onToggle={() => dispatch(uiActions.toggleEnableAnimations())} color="var(--gold2)" />
          <Row label="CALCULS AVANCÉS" desc="Maîtrise par ayat, stats sourates — désactiver accélère le rendu" on={enableHeavyCompute} onToggle={() => dispatch(uiActions.toggleEnableHeavyCompute())} color="#c878ff" />
          <Section title="TAJWEED" />
          <Row label="QALQALA قلقلة" on={showQalqala} onToggle={() => dispatch(uiActions.toggleQalqala())} color="#5bc8f5" />
          <Row label="MADD مَدّ" on={showMadd} onToggle={() => dispatch(uiActions.toggleMadd())} color="#f09de0" />
          <Row label="IZHAR إظهار" on={showIzhar} onToggle={() => dispatch(uiActions.toggleIzhar())} color="#4caf81" />
          <Row label="IDGHAM إدغام" on={showIdgham} onToggle={() => dispatch(uiActions.toggleIdgham())} color="#ffd166" />
          <Section title="AFFICHAGE" />
          <Row label="PARTIES" desc="Afficher les découpes de mémorisation" on={showParts} onToggle={() => dispatch(uiActions.toggleShowParts())} color="var(--gold2)" />
          <Row label="ORTHOGRAPHE" desc="Vérification en révision écrite" on={spellCheck} onToggle={() => dispatch(uiActions.toggleSpellCheck())} color="var(--gold2)" />
          <Row label="NUMÉROS" desc="Annoncer les numéros d'ayat" on={announceNum} onToggle={() => dispatch(uiActions.toggleAnnounceNum())} color="var(--teal2)" />
        </div>
      </div>
    </div>
  );
}

// ─── CloudSyncManager — auto save/restore Firestore ─────────────────────────
// • onSnapshot  → reçoit les changements en temps réel depuis n'importe quel appareil
// • debounce 4s → pousse les changements locaux vers Firestore
function CloudSyncManager({ uid }) {
  const learnData       = useSelector(sel.learnData);
  const collections     = useSelector(sel.collections, shallowEqual);
  const activity        = useSelector(sel.activity);
  const goals           = useSelector(sel.goals);
  const loopBySurah     = useSelector(sel.loopBySurah);
  const lastAyatBySurah = useSelector(sel.lastAyatBySurah, shallowEqual);
  const revisionMastery = useSelector(s => s.revision.mastery);

  // flag pour ne pas sauvegarder pendant/juste après une restauration
  const isSyncingRef  = React.useRef(false);
  const saveTimerRef  = React.useRef(null);
  const unsubRef      = React.useRef(null);

  // ── helpers ────────────────────────────────────────────────────────────────
  const applyCloudData = React.useCallback((cloudData) => {
    if (!cloudData) return;
    isSyncingRef.current = true;
    addSyncLog("restore", "Données reçues depuis Firestore — fusion en cours…");

    const mergeKey = (key, incoming, base) => {
      if (incoming == null) return base;
      if (key === "quran_learnData")       return mergeLearnData(base || {}, incoming);
      if (key === "quran_activity")        return mergeActivity(base || {}, incoming);
      if (key === "quran_collections")     return mergeCollections(base || [], incoming);
      if (key === "quran_lastAyatBySurah"
       || key === "quran_loopBySurah")     return { ...(base || {}), ...incoming };
      return incoming ?? base;
    };

    for (const key of DATA_KEYS) {
      const incoming = cloudData[key];
      if (incoming == null) continue;
      const rawBase = localStorage.getItem(key);
      let base;
      try { base = rawBase ? JSON.parse(rawBase) : null; } catch { base = null; }
      const merged = mergeKey(key, incoming, base);
      localStorage.setItem(key, JSON.stringify(merged));
    }

    // Patch Redux in one batch
    const get = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
    store.dispatch({ type: "learn/restoreFromCloud",              payload: get("quran_learnData", {}) });
    store.dispatch({ type: "collections/restoreFromCloud",        payload: get("quran_collections", []) });
    store.dispatch({ type: "goals/restoreActivityFromCloud",      payload: get("quran_activity", {}) });
    store.dispatch({ type: "player/restoreLoopBySurahFromCloud",  payload: get("quran_loopBySurah", {}) });
    store.dispatch({ type: "quran/restoreLastAyatFromCloud",      payload: get("quran_lastAyatBySurah", {}) });
    store.dispatch({ type: "revision/restoreFromCloud",           payload: get("quran_revision_mastery", {}) });
    ["dailyAyats","dailyParts","weeklyAyats","targetSurah","targetDate"].forEach(k => {
      const v = get(`quran_goal_${k}`, null);
      if (v != null) store.dispatch(goalsActions.setGoal({ key: k, value: v }));
    });

    addSyncLog("restore", "Redux mis à jour ✓");
    // Libérer le flag après le cycle de rendu pour éviter de sauvegarder nos propres données
    setTimeout(() => { isSyncingRef.current = false; }, 500);
  }, []);

  const pushToCloud = React.useCallback(async () => {
    if (!uid) return;
    addSyncLog("save", "Sauvegarde Firestore en cours…");
    try {
      const data = {};
      for (const key of DATA_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw) { try { data[key] = JSON.parse(raw); } catch { data[key] = raw; } }
      }
      await setDoc(doc(firebaseDb, "userData", uid), {
        data,
        savedAt:  new Date().toISOString(),
        deviceId: getDeviceId(),
        version:  2,
      });
      addSyncLog("save", "✓ Sauvegardé sur Firestore");
    } catch(e) {
      addSyncLog("error", "Erreur sauvegarde : " + (e.message || String(e)));
      console.warn("[CloudSync] push failed", e);
    }
  }, [uid]);

  // ── subscribe to real-time updates ────────────────────────────────────────
  useEffect(() => {
    if (!uid) return;
    const docRef = doc(firebaseDb, "userData", uid);
    const unsub = onSnapshot(docRef, (snap) => {
      if (!snap.exists()) {
        addSyncLog("info", "Aucune donnée cloud pour ce compte");
        return;
      }
      const { data, deviceId, savedAt } = snap.data();
      // Ignorer nos propres writes (même appareil)
      if (deviceId === getDeviceId()) {
        addSyncLog("skip", "Snapshot ignoré (notre propre write)");
        return;
      }
      addSyncLog("restore", `Snapshot reçu depuis ${deviceId || "?"} (${savedAt?.slice(0,16)||"?"})`);
      applyCloudData(data);
    }, (e) => {
      addSyncLog("error", "Snapshot error : " + (e.message || String(e)));
      console.warn("[CloudSync] snapshot error", e);
    });
    unsubRef.current = unsub;
    return () => unsub();
  }, [uid, applyCloudData]);

  // ── debounced push on local changes ───────────────────────────────────────
  useEffect(() => {
    if (!uid) return;
    if (isSyncingRef.current) {
      addSyncLog("skip", "Sauvegarde ignorée (restauration en cours)");
      return;
    }
    clearTimeout(saveTimerRef.current);
    addSyncLog("info", "Changement détecté — sauvegarde dans 4s…");
    saveTimerRef.current = setTimeout(pushToCloud, 4000);
    return () => clearTimeout(saveTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, learnData, collections, activity, goals, loopBySurah, lastAyatBySurah, revisionMastery, pushToCloud]);

  return null;
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]         = useState(undefined); // undefined = checking
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

// ─── GOALS PANEL ─────────────────────────────────────────────────────────────
function GoalsPanel({ goals, todayAct, weeklyTotal, streak, goalAyatsPct, goalPartsPct, weeklyPct, onSetGoal, surahs }) {
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState("");

  const startEdit = (key, val) => { setEditKey(key); setEditVal(String(val ?? "")); };
  const confirmEdit = () => {
    if (editKey === "targetDate" || editKey === "targetSurah") {
      onSetGoal(editKey, editVal || null);
    } else {
      const n = parseInt(editVal);
      if (!isNaN(n) && n >= 0) onSetGoal(editKey, n);
    }
    setEditKey(null);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Streak */}
      <div className="goal-streak">
        <div className="goal-streak-fire">🔥</div>
        <div>
          <div style={{display:"flex",alignItems:"baseline",gap:6}}>
            <div className="goal-streak-num">{streak}</div>
            <div className="goal-streak-label">JOUR{streak!==1?"S":""} DE SUITE</div>
          </div>
          <div style={{fontSize:8,color:"var(--text3)",letterSpacing:1}}>SÉRIE EN COURS</div>
        </div>
      </div>

      {/* Aujourd'hui */}
      <div className="goal-today-box">
        <div className="goal-today-stat">
          <div className="goal-today-val">{todayAct.ayatsRead||0}</div>
          <div className="goal-today-label">AYATS LUS<br/>AUJOURD'HUI</div>
        </div>
        <div className="goal-today-stat">
          <div className="goal-today-val">{todayAct.ayatsLearned||0}</div>
          <div className="goal-today-label">AYATS<br/>APPRIS</div>
        </div>
        <div className="goal-today-stat">
          <div className="goal-today-val">{todayAct.partsLearned||0}</div>
          <div className="goal-today-label">PARTIES<br/>APPRISES</div>
        </div>
      </div>

      {/* Objectifs configurables */}
      <div className="goals-grid">
        {[
          { key:"dailyAyats",  icon:"📖", label:"OBJECTIF QUOTIDIEN",    unit:"ayats/jour",    val:goals.dailyAyats,  pct:goalAyatsPct,  color:"var(--teal)" },
          { key:"dailyParts",  icon:"✂",  label:"PARTIES / JOUR",        unit:"parties/jour",  val:goals.dailyParts,  pct:goalPartsPct,  color:"var(--gold)" },
          { key:"weeklyAyats", icon:"📅", label:"OBJECTIF HEBDOMADAIRE", unit:"ayats/semaine", val:goals.weeklyAyats, pct:weeklyPct,     color:"var(--green2)" },
        ].map(g => (
          <div key={g.key} className="goal-row">
            <div className="goal-icon">{g.icon}</div>
            <div className="goal-info">
              <div className="goal-label">{g.label}</div>
              {editKey === g.key ? (
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <input className="goal-input" type="number" min="0" value={editVal}
                    onChange={e=>setEditVal(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")confirmEdit();if(e.key==="Escape")setEditKey(null);}}
                    autoFocus />
                  <button className="goal-edit-btn" onClick={confirmEdit}>✓</button>
                  <button className="goal-edit-btn" onClick={()=>setEditKey(null)}>✕</button>
                </div>
              ) : (
                <div className="goal-value">{g.val} <span style={{fontSize:9,color:"var(--text3)",fontFamily:"sans-serif",letterSpacing:0}}>{g.unit}</span></div>
              )}
              <div style={{marginTop:6,display:"flex",alignItems:"center",gap:8}}>
                <div className="goal-track">
                  <div className="goal-fill" style={{width:`${Math.round(g.pct*100)}%`,background:g.color}}/>
                </div>
                <div className="goal-pct">{Math.round(g.pct*100)}%</div>
              </div>
            </div>
            {editKey !== g.key && (
              <button className="goal-edit-btn" onClick={()=>startEdit(g.key, g.val)}>✎</button>
            )}
          </div>
        ))}

        {/* Sourate cible */}
        <div className="goal-row">
          <div className="goal-icon">🎯</div>
          <div className="goal-info">
            <div className="goal-label">SOURATE CIBLE</div>
            {editKey === "targetSurah" ? (
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <select value={editVal} onChange={e=>setEditVal(e.target.value)}
                  style={{background:"var(--surface2)",border:"1px solid var(--gold)",borderRadius:6,padding:"4px 8px",color:"var(--text)",fontSize:10,outline:"none",flex:1}}>
                  <option value="">— Aucune —</option>
                  {surahs.map(s=><option key={s.number} value={s.number}>{s.number}. {s.englishName}</option>)}
                </select>
                <button className="goal-edit-btn" onClick={confirmEdit}>✓</button>
                <button className="goal-edit-btn" onClick={()=>setEditKey(null)}>✕</button>
              </div>
            ) : (
              <div className="goal-value">
                {goals.targetSurah ? (surahs.find(s=>s.number===Number(goals.targetSurah))?.englishName || `Sourate ${goals.targetSurah}`) : "—"}
              </div>
            )}
          </div>
          {editKey !== "targetSurah" && <button className="goal-edit-btn" onClick={()=>startEdit("targetSurah", goals.targetSurah||"")}>✎</button>}
        </div>

        {/* Date limite */}
        <div className="goal-row">
          <div className="goal-icon">⏳</div>
          <div className="goal-info">
            <div className="goal-label">DATE LIMITE</div>
            {editKey === "targetDate" ? (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <input type="date" value={editVal} onChange={e=>setEditVal(e.target.value)}
                  style={{background:"var(--surface2)",border:"1px solid var(--gold)",borderRadius:6,padding:"4px 8px",color:"var(--text)",fontSize:10,outline:"none",flex:1}}
                  onKeyDown={e=>{if(e.key==="Enter")confirmEdit();if(e.key==="Escape")setEditKey(null);}}
                  autoFocus />
                <button className="goal-edit-btn" onClick={confirmEdit}>✓</button>
                <button className="goal-edit-btn" onClick={()=>setEditKey(null)}>✕</button>
              </div>
            ) : (
              <div className="goal-value">
                {goals.targetDate
                  ? new Date(goals.targetDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})
                  : "—"}
                {goals.targetDate && (
                  <span style={{fontSize:9,color:"var(--text3)",fontFamily:"sans-serif",letterSpacing:0,marginLeft:8}}>
                    ({Math.ceil((new Date(goals.targetDate)-new Date())/(1000*60*60*24))} j)
                  </span>
                )}
              </div>
            )}
          </div>
          {editKey !== "targetDate" && <button className="goal-edit-btn" onClick={()=>startEdit("targetDate", goals.targetDate||"")}>✎</button>}
        </div>
      </div>
    </div>
  );
}

// ─── ACTIVITY BAR CHART ───────────────────────────────────────────────────────
function ActivityBarChart({ data = [], height = 60, goalLine = 0, onClick, selectedIdx }) {
  if (!data.length) return null;
  const maxVal = Math.max(1, ...data.map(d => (d.read||0) + (d.learned||0)));
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:2, height, padding:"0 2px" }}>
      {data.map((d, i) => {
        const total = (d.read||0) + (d.learned||0);
        const pct = total / maxVal;
        const learnedPct = (d.learned||0) / maxVal;
        const isSelected = selectedIdx === i;
        return (
          <div key={i} title={`${d.label}: ${total}`}
            onClick={() => onClick?.(i, d)}
            style={{ flex:1, height:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end",
              cursor: onClick ? "pointer" : "default", position:"relative" }}>
            {goalLine > 0 && i === 0 && (
              <div style={{ position:"absolute", left:0, right:0, bottom:`${(goalLine/maxVal)*100}%`,
                borderTop:"1px dashed rgba(201,168,76,.35)", zIndex:1 }} />
            )}
            <div style={{ width:"100%", height:`${Math.max(2, pct*100)}%`, borderRadius:"2px 2px 0 0",
              background: total >= goalLine && goalLine > 0
                ? "linear-gradient(180deg,var(--green2),var(--teal2))"
                : isSelected ? "var(--gold2)" : "var(--teal2)",
              opacity: isSelected ? 1 : 0.75, transition:"all .15s",
              boxShadow: isSelected ? "0 0 6px rgba(201,168,76,.4)" : "none" }} />
          </div>
        );
      })}
    </div>
  );
}

// ─── ACTIVITY CALENDAR ────────────────────────────────────────────────────────
function ActivityCalendar({ activity, goals, learnData = {}, surahs = [] }) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);

  const [viewDate,    setViewDate]    = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(null);
  // Period selection: null = single day mode, 'week' | 'custom'
  const [periodMode,    setPeriodMode]   = useState(null); // null | 'week' | 'custom'
  const [rangeStart,    setRangeStart]   = useState(null); // ISO date string
  const [rangeEnd,      setRangeEnd]     = useState(null);
  const [customPicking, setCustomPicking] = useState(false); // clicking first / second date

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells = useMemo(() => {
    const arr = [];
    const startOffset = (firstDay + 6) % 7;
    for (let i = 0; i < startOffset; i++) arr.push({ day: prevMonthDays - startOffset + i + 1, cur: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const act     = activity[dateStr] || {};
      const total   = (act.ayatsRead||0) + (act.ayatsLearned||0);
      const isToday = dateStr === todayStr;
      const goalMet = goals.dailyAyats > 0 && total >= goals.dailyAyats;
      const partial = !goalMet && total > 0;
      const future  = new Date(year, month, d) > today;
      arr.push({ day: d, cur: true, dateStr, act, total, isToday, goalMet, partial, future });
    }
    const remaining = 42 - arr.length;
    for (let i = 1; i <= remaining; i++) arr.push({ day: i, cur: false });
    return arr;
  }, [year, month, firstDay, daysInMonth, prevMonthDays, activity, goals.dailyAyats, todayStr]);

  const monthNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const monthTotal = cells.filter(c=>c.cur&&c.act).reduce((s,c)=>s+(c.total||0),0);
  const activeDays = cells.filter(c=>c.cur&&c.total>0).length;
  const goalDays   = cells.filter(c=>c.cur&&c.goalMet).length;

  // ── Range helpers ──────────────────────────────────────────────────────────
  const setCurrentWeek = () => {
    const d = new Date(todayStr);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    const start = new Date(d); start.setDate(d.getDate() - dow);
    const end   = new Date(start); end.setDate(start.getDate() + 6);
    setRangeStart(start.toISOString().slice(0,10));
    setRangeEnd(end.toISOString().slice(0,10));
    setPeriodMode('week');
    setCustomPicking(false);
    setSelectedDay(null);
  };

  const setLastNDays = (n) => {
    const end   = new Date(todayStr);
    const start = new Date(todayStr); start.setDate(end.getDate() - n + 1);
    setRangeStart(start.toISOString().slice(0,10));
    setRangeEnd(todayStr);
    setPeriodMode('custom');
    setCustomPicking(false);
    setSelectedDay(null);
  };

  const handleCellClick = (c) => {
    if (!c.cur || c.future) return;
    if (periodMode === 'custom' && customPicking) {
      if (!rangeStart) {
        setRangeStart(c.dateStr);
      } else {
        const s = rangeStart <= c.dateStr ? rangeStart : c.dateStr;
        const e = rangeStart <= c.dateStr ? c.dateStr : rangeStart;
        setRangeEnd(e);
        setRangeStart(s);
        setCustomPicking(false);
      }
      return;
    }
    // Single day
    setPeriodMode(null);
    setRangeStart(null); setRangeEnd(null);
    setSelectedDay(d => d === c.dateStr ? null : c.dateStr);
  };

  const isInRange = (dateStr) => {
    if (!rangeStart || !rangeEnd) return false;
    return dateStr >= rangeStart && dateStr <= rangeEnd;
  };

  // ── Range summary data ─────────────────────────────────────────────────────
  const rangeData = useMemo(() => {
    if (!rangeStart || !rangeEnd) return null;
    const days = [];
    const d = new Date(rangeStart);
    while (d.toISOString().slice(0,10) <= rangeEnd) {
      days.push(d.toISOString().slice(0,10));
      d.setDate(d.getDate()+1);
    }
    const totRead    = days.reduce((s,k) => s+(activity[k]?.ayatsRead||0),    0);
    const totLearned = days.reduce((s,k) => s+(activity[k]?.ayatsLearned||0), 0);
    const totParts   = days.reduce((s,k) => s+(activity[k]?.partsLearned||0), 0);
    const activeDays = days.filter(k => (activity[k]?.ayatsRead||0)+(activity[k]?.ayatsLearned||0)>0).length;
    const goalDays   = goals.dailyAyats > 0 ? days.filter(k => (activity[k]?.ayatsRead||0)+(activity[k]?.ayatsLearned||0)>=goals.dailyAyats).length : 0;
    // Ayats updated in range
    const updated = Object.entries(learnData)
      .filter(([,v]) => v.updatedAt?.slice(0,10) >= rangeStart && v.updatedAt?.slice(0,10) <= rangeEnd)
      .map(([k,v]) => { const [sn,an]=k.split(":").map(Number); return { sn,an,v,surahName:surahs.find(s=>s.number===sn)?.englishName||`S${sn}` }; })
      .sort((a,b)=>(b.v.updatedAt||"")>(a.v.updatedAt||"")? 1:-1);
    const chartData = days.map(k => {
      const act = activity[k]||{};
      const d = new Date(k);
      const labels = ["D","L","M","M","J","V","S"];
      return { label:labels[d.getDay()], read:act.ayatsRead||0, learned:act.ayatsLearned||0 };
    });
    return { days, totRead, totLearned, totParts, activeDays, goalDays, updated, chartData };
  }, [rangeStart, rangeEnd, activity, learnData, surahs, goals.dailyAyats]);

  // ── Single day detail ──────────────────────────────────────────────────────
  const dayDetail = useMemo(() => {
    if (!selectedDay) return null;
    const act = activity[selectedDay] || {};
      const updated = Object.entries(learnData)
          .filter(
              ([, v]) =>
                  v.updatedAt?.slice(0, 10) === selectedDay ||
                  v.learnedAt?.slice(0, 10) === selectedDay
          )
          .map(([k, v]) => {
              const [sn, an] = k.split(":").map(Number);

              return {
                  key: k,
                  sn,
                  an,
                  v,
                  surahName:
                      surahs.find(s => s.number === sn)?.englishName || `S${sn}`,
                  surahAr:
                      surahs.find(s => s.number === sn)?.name
              };
          })
          .sort((a, b) => {
              const da = a.v.updatedAt || a.v.learnedAt || "";
              const db = b.v.updatedAt || b.v.learnedAt || "";
              return db.localeCompare(da);
          });
    const fmt = iso => { if(!iso) return ""; const d=new Date(iso); return d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); };
    return { act, updated, fmt };
  }, [selectedDay, learnData, activity, surahs]);

  const btnStyle = (active) => ({
    fontSize:8, letterSpacing:1, padding:"4px 10px", borderRadius:20, cursor:"pointer",
    fontFamily:"'Cinzel',serif", border:`1px solid ${active?"var(--gold)":"var(--border2)"}`,
    background:active?"rgba(201,168,76,.1)":"transparent", color:active?"var(--gold2)":"var(--text3)",
    transition:"all .15s",
  });

  return (
    <div className="dash-card" style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Month nav */}
      <div className="cal-month-nav">
        <button className="cal-nav-btn" onClick={()=>{ setViewDate(new Date(year,month-1,1)); setSelectedDay(null); }}>‹</button>
        <div className="cal-month-title">{monthNames[month]} {year}</div>
        <button className="cal-nav-btn" onClick={()=>{ setViewDate(new Date(year,month+1,1)); setSelectedDay(null); }}
          disabled={year===today.getFullYear()&&month===today.getMonth()}
          style={{opacity:year===today.getFullYear()&&month===today.getMonth()?0.4:1}}>›</button>
      </div>

      {/* Period selector */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:8,letterSpacing:1,color:"var(--text3)"}}>PÉRIODE :</span>
        <button style={btnStyle(false)} onClick={()=>{ setPeriodMode(null);setRangeStart(null);setRangeEnd(null);setCustomPicking(false); }}>Jour</button>
        <button style={btnStyle(periodMode==='week')} onClick={setCurrentWeek}>Semaine</button>
        <button style={btnStyle(false)} onClick={()=>setLastNDays(7)}>7j</button>
        <button style={btnStyle(false)} onClick={()=>setLastNDays(30)}>30j</button>
        <button style={btnStyle(customPicking)}
          onClick={()=>{ setPeriodMode('custom');setRangeStart(null);setRangeEnd(null);setCustomPicking(true);setSelectedDay(null); }}>
          {customPicking ? (rangeStart?"Cliquer fin":"Cliquer début") : "Personnalisé"}
        </button>
        {(rangeStart||rangeEnd) && (
          <button style={{...btnStyle(false),color:"var(--red)",borderColor:"var(--red)"}}
            onClick={()=>{ setRangeStart(null);setRangeEnd(null);setPeriodMode(null);setCustomPicking(false); }}>✕</button>
        )}
      </div>
      {rangeStart && rangeEnd && (
        <div style={{fontSize:8,color:"var(--teal2)",letterSpacing:1}}>
          {rangeStart} → {rangeEnd} · {rangeData?.days.length}j
        </div>
      )}

      {/* Calendar grid */}
      <div className="cal-grid">
        {["L","M","M","J","V","S","D"].map((d,i)=>(
          <div key={i} className="cal-day-name">{d}</div>
        ))}
        {cells.map((c,i)=>{
          let cls = "cal-cell";
          if (!c.cur)         cls += " other-month";
          if (c.isToday)      cls += " today";
          if (c.goalMet)      cls += " goal-reached";
          else if (c.partial) cls += " goal-partial";
          else if (c.total>0) cls += " has-activity";
          const isSelected  = c.cur && c.dateStr === selectedDay;
          const inRange     = c.cur && isInRange(c.dateStr);
          const isRangeEdge = c.cur && (c.dateStr === rangeStart || c.dateStr === rangeEnd);
          return (
            <div key={i} className={cls}
              onClick={() => handleCellClick(c)}
              style={{
                cursor: c.cur && !c.future ? "pointer" : "default",
                background: inRange ? "rgba(201,168,76,.12)" : undefined,
                outline: isSelected || isRangeEdge ? "2px solid var(--gold)" : undefined,
                outlineOffset: -2,
              }}>
              <div className="cal-cell-num" style={{color:c.isToday?"var(--gold)":c.future?"var(--text3)":undefined}}>{c.day}</div>
              {c.cur && c.total > 0 && (
                <div className="cal-cell-dot" style={{background:c.goalMet?"var(--teal)":c.partial?"var(--gold)":"var(--border2)"}}/>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="cal-legend">
        <div className="cal-legend-item"><div className="cal-legend-dot" style={{background:"var(--teal)"}}/> Objectif</div>
        <div className="cal-legend-item"><div className="cal-legend-dot" style={{background:"var(--gold)"}}/> Partielle</div>
        <div className="cal-legend-item"><div className="cal-legend-dot" style={{background:"var(--border2)"}}/> Activité</div>
      </div>

      {/* ── RANGE DETAIL ── */}
      {rangeData && rangeStart && rangeEnd && (
        <div style={{borderTop:"1px solid var(--border)",paddingTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:9,letterSpacing:2,color:"var(--gold2)",fontFamily:"'Cinzel',serif"}}>RÉSUMÉ DE LA PÉRIODE</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              {val:rangeData.totRead,    label:"LUS",     color:"var(--teal2)"},
              {val:rangeData.totLearned, label:"APPRIS",  color:"var(--green)"},
              {val:rangeData.totParts,   label:"PARTIES", color:"var(--gold2)"},
              {val:rangeData.activeDays, label:"JOURS",   color:"var(--text2)"},
              {val:rangeData.goalDays,   label:"OBJECTIFS",color:"var(--green)"},
            ].map((s,i)=>(
              <div key={i} style={{flex:1,minWidth:50,padding:"8px",background:"var(--surface3)",borderRadius:6,textAlign:"center"}}>
                <div style={{fontSize:16,fontFamily:"'Cinzel',serif",color:s.color}}>{s.val}</div>
                <div style={{fontSize:7,letterSpacing:1,color:"var(--text3)"}}>{s.label}</div>
              </div>
            ))}
          </div>
          {rangeData.chartData.length <= 31 && (
            <ActivityBarChart data={rangeData.chartData} height={70} goalLine={goals?.dailyAyats||0} />
          )}
          {rangeData.updated.length > 0 && (
            <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
              <div style={{fontSize:8,letterSpacing:1.5,color:"var(--text3)"}}>AYATS TRAVAILLÉS ({rangeData.updated.length})</div>
              {rangeData.updated.map(({sn,an,v,surahName})=>(
                <div key={`${sn}:${an}`} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:"var(--surface3)",borderRadius:6}}>
                  <div style={{fontSize:9,color:"var(--text3)",width:20,textAlign:"center",fontFamily:"'Cinzel',serif"}}>{an}</div>
                  <div style={{flex:1,fontSize:8,color:"var(--text2)",letterSpacing:.5}}>{surahName}</div>
                  {v.learnedAt?.slice(0,10)>=rangeStart && v.learnedAt?.slice(0,10)<=rangeEnd && <span style={{fontSize:7,padding:"1px 6px",borderRadius:8,background:"rgba(76,175,129,.15)",color:"var(--green)",border:"1px solid var(--green)"}}>✓</span>}
                  <div style={{fontSize:7,color:"var(--text3)"}}>{v.updatedAt?.slice(0,10)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SINGLE DAY DETAIL ── */}
      {selectedDay && dayDetail && (
        <div style={{borderTop:"1px solid var(--border)",paddingTop:14,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:10,letterSpacing:2,color:"var(--gold2)",fontFamily:"'Cinzel',serif"}}>{selectedDay}</div>
            <button onClick={()=>setSelectedDay(null)} style={{fontSize:9,background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer"}}>✕ FERMER</button>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              {val:dayDetail.act.ayatsRead||0,    label:"LUS",    color:"var(--teal2)"},
              {val:dayDetail.act.ayatsLearned||0, label:"APPRIS", color:"var(--green)"},
              {val:dayDetail.act.partsLearned||0, label:"PARTIES",color:"var(--gold2)"},
            ].map((s,i)=>(
              <div key={i} style={{flex:1,padding:"8px",background:"var(--surface3)",borderRadius:6,textAlign:"center"}}>
                <div style={{fontSize:18,fontFamily:"'Cinzel',serif",color:s.color}}>{s.val}</div>
                <div style={{fontSize:7,letterSpacing:1,color:"var(--text3)"}}>{s.label}</div>
              </div>
            ))}
          </div>
          {dayDetail.updated.length > 0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:240,overflowY:"auto"}}>
              {dayDetail.updated.map(({key,sn,an,v,surahName,surahAr})=>(
                <div key={key} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"var(--surface3)",borderRadius:6}}>
                  <div style={{fontSize:9,color:"var(--text3)",width:20,textAlign:"center",fontFamily:"'Cinzel',serif"}}>{an}</div>
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:1}}>
                    <div style={{fontSize:8,letterSpacing:.5,color:"var(--text2)"}}>{surahName}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {v.learnedAt?.slice(0,10)===selectedDay && <span style={{fontSize:7,padding:"1px 6px",borderRadius:8,background:"rgba(76,175,129,.15)",color:"var(--green)",border:"1px solid var(--green)"}}>✓ APPRIS {dayDetail.fmt(v.learnedAt)}</span>}
                      {v.updatedAt?.slice(0,10)===selectedDay && v.learnedAt?.slice(0,10)!==selectedDay && <span style={{fontSize:7,padding:"1px 6px",borderRadius:8,background:"rgba(62,184,160,.1)",color:"var(--teal2)",border:"1px solid var(--teal)"}}>↻ MÀJ {dayDetail.fmt(v.updatedAt)}</span>}
                    </div>
                  </div>
                  {surahAr && <div style={{fontFamily:"'Amiri Quran',serif",fontSize:14,color:"var(--gold)",direction:"rtl"}}>{surahAr}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{fontSize:9,color:"var(--text3)",letterSpacing:1,textAlign:"center",padding:"8px 0"}}>
              {(dayDetail.act.ayatsRead||0)+(dayDetail.act.ayatsLearned||0)>0 ? "Activité enregistrée — pas de détail." : "Aucune activité ce jour."}
            </div>
          )}
        </div>
      )}

      {/* Monthly bar chart */}
      <div style={{borderTop:"1px solid var(--border)",paddingTop:12}}>
        <div style={{fontSize:8,letterSpacing:1.5,color:"var(--text3)",marginBottom:6}}>ACTIVITÉ DU MOIS</div>
        <ActivityBarChart
          data={cells.filter(c=>c.cur).map(c=>({ label:String(c.day), read:c.act?.ayatsRead||0, learned:c.act?.ayatsLearned||0 }))}
          height={70} goalLine={goals.dailyAyats||0}
          onClick={(i,d)=>{ const cell=cells.filter(c=>c.cur)[i]; if(cell&&!cell.future){ setPeriodMode(null);setRangeStart(null);setRangeEnd(null); setSelectedDay(s=>s===cell.dateStr?null:cell.dateStr); } }}
          selectedIdx={selectedDay?cells.filter(c=>c.cur).findIndex(c=>c.dateStr===selectedDay):null}
        />
        <div style={{display:"flex",gap:12,paddingTop:8,flexWrap:"wrap"}}>
          {[{val:activeDays,label:"JOURS ACTIFS"},{val:goalDays,label:"OBJECTIFS"},{val:monthTotal,label:"AYATS"}].map((s,i)=>(
            <div key={i} style={{flex:1,minWidth:60,textAlign:"center"}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:14,color:"var(--gold2)"}}>{s.val}</div>
              <div style={{fontSize:7,letterSpacing:1,color:"var(--text3)"}}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// ─── DASHBOARD PAGE ────────────────────────────────────────────────────────────

function DonutChart({ pct, color, size = 80, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(pct, 1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{transition:"stroke-dasharray .8s ease"}}/>
    </svg>
  );
}

function MiniBarChart({ data, color }) {
  if (!data?.length) return null;
  const max = Math.max(...data, 1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:3,height:36}}>
      {data.map((v,i) => (
        <div key={i} style={{flex:1,background:v>0?color:"var(--surface3)",borderRadius:"2px 2px 0 0",
          height:`${Math.max(4,(v/max)*100)}%`,opacity:i===data.length-1?1:.6,transition:"height .4s"}}/>
      ))}
    </div>
  );
}

// ─── KpiWidget ────────────────────────────────────────────────────────────────
function KpiWidget({ totalLearned, totalRead, totalWords, totalParts, learnedParts, learnedSurahs, activeSurahs, pctAyats, entries, surahs, onNavigate }) {
  const kpis = [
    { label:"VERSETS APPRIS",   val:totalLearned,  color:"var(--gold2)" },
    { label:"LECTURES",         val:totalRead,     color:"var(--teal2)" },
    { label:"MOTS MÉMORISÉS",   val:totalWords,    color:"var(--green2)" },
    { label:"PARTIES CRÉÉES",   val:totalParts,    color:"var(--text2)" },
    { label:"PARTIES APPRISES", val:learnedParts,  color:"var(--teal2)" },
    { label:"SOURATES 100%",    val:learnedSurahs, color:"var(--gold2)" },
  ];
  return (
    <div className="dash-card">
      <div className="dash-kpi-row">
        {kpis.map(k => (
          <div key={k.label} className="dash-kpi" style={{"--kpi-color":k.color}}>
            <div className="dash-kpi-val">{k.val}</div>
            <div className="dash-kpi-label">{k.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPage({ learnData, surahs, onNavigate, goals, activity, onSetGoal, onRecordActivity }) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // ── Compute stats from learnData ──
  const entries = useMemo(() => Object.entries(learnData), [learnData]);

  const totalLearned   = useMemo(() => entries.filter(([,v]) => v.learned).length,       [entries]);
  const totalRead      = useMemo(() => entries.reduce((s,[,v]) => s+(v.readCount||0), 0),[entries]);
  const totalParts     = useMemo(() => entries.reduce((s,[,v]) => s+(v.parts?.length||0), 0),       [entries]);
  const learnedParts   = useMemo(() => entries.reduce((s,[,v]) => s+(v.parts?.filter(p=>p.learned).length||0), 0), [entries]);
  const totalWords     = useMemo(() => entries.reduce((s,[,v]) => s+Object.keys(v.wordsLearned||{}).filter(k=>v.wordsLearned[k]).length, 0), [entries]);

  // Timestamp-based analytics
  const recentlyLearned = useMemo(() => entries
    .filter(([,v]) => v.learnedAt)
    .sort(([,a],[,b]) => (b.learnedAt > a.learnedAt ? 1 : -1))
    .slice(0, 5), [entries]);

  const recentlyUpdated = entries
    .filter(([,v]) => v.updatedAt)
    .sort(([,a],[,b]) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, 3);

  // Weekly progress using timestamps
  const now7 = new Date(); now7.setDate(now7.getDate() - 7);
  const learnedThisWeek = entries.filter(([,v]) => v.learnedAt && new Date(v.learnedAt) > now7).length;
  const updatedThisWeek = entries.filter(([,v]) => v.updatedAt && new Date(v.updatedAt) > now7).length;

  const surahProgress = useMemo(() => {
    const sp = {};
    entries.forEach(([key, v]) => {
      const [sNum] = key.split(":").map(Number);
      if (!sp[sNum]) sp[sNum] = { learned:0, total:0, read:0 };
      sp[sNum].total++;
      if (v.learned) sp[sNum].learned++;
      sp[sNum].read += v.readCount||0;
    });
    return sp;
  }, [entries]);

  const learnedSurahs = useMemo(() => Object.entries(surahProgress).filter(([,d]) => d.learned > 0 && d.learned === d.total).length, [surahProgress]);

  const activeSurahs = useMemo(() => Object.entries(surahProgress)
    .map(([num, d]) => {
      const meta = surahs.find(s=>s.number===Number(num));
      return { num:Number(num), ...d, pct: d.total>0?d.learned/d.total:0, meta };
    })
    .sort((a,b) => b.read - a.read)
    .slice(0, 8), [surahProgress, surahs]);

  const topLearned = useMemo(() => [...activeSurahs].sort((a,b)=>b.pct-a.pct).slice(0,5), [activeSurahs]);

  const heatmap = useMemo(() => Array.from({length:49},(_,i)=>{
    const d2 = new Date(); d2.setDate(d2.getDate() - (48-i));
    const k = d2.toISOString().slice(0,10);
    const a = activity[k] || {};
    return (a.ayatsRead||0) + (a.ayatsLearned||0);
  }), [activity]);

  const hasActivity = totalRead > 0;

  const weekBars7 = useMemo(() => Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().slice(0,10);
    const act = activity[dateStr] || {};
    const dayNames = ["D","L","M","M","J","V","S"];
    return { label: dayNames[d.getDay()], read: act.ayatsRead||0, learned: act.ayatsLearned||0 };
  }), [activity]);

  const meccan   = activeSurahs.filter(a=>a.meta?.revelationType==="Meccan").length;
  const medinan  = activeSurahs.filter(a=>a.meta?.revelationType==="Medinan").length;
  const totalAyats = 6236;
  const pctAyats   = totalAyats > 0 ? totalLearned / totalAyats : 0;

  const recentActivity = useMemo(() => entries
    .filter(([,v]) => (v.readCount||0) > 0)
    .slice(-6).reverse()
    .map(([key, v]) => {
      const [sNum, aNum] = key.split(":").map(Number);
      const meta = surahs.find(s=>s.number===sNum);
      return { sNum, aNum, readCount:v.readCount, learned:v.learned, surahName: meta?.englishName||`S${sNum}` };
    }), [entries, surahs]);

  const isEmpty = entries.length === 0;

  // ── Objectifs du jour (live — depend on activity + goals) ──
  const todayStr2 = useMemo(() => new Date().toISOString().slice(0,10), []);
  const todayAct = useMemo(() => activity[todayStr2] || { ayatsRead:0, partsLearned:0, ayatsLearned:0 }, [activity, todayStr2]);
  const goalAyatsPct = useMemo(() => goals.dailyAyats > 0 ? Math.min(1, todayAct.ayatsRead   / goals.dailyAyats) : 0, [todayAct, goals.dailyAyats]);
  const goalPartsPct = useMemo(() => goals.dailyParts > 0 ? Math.min(1, todayAct.partsLearned / goals.dailyParts) : 0, [todayAct, goals.dailyParts]);

  const streak = useMemo(() => {
    let s = 0;
    const d = new Date();
    while (true) {
      const k = d.toISOString().slice(0,10);
      const a = activity[k];
      if (!a || (a.ayatsRead||0) + (a.ayatsLearned||0) === 0) { if (s === 0) { d.setDate(d.getDate()-1); if (!activity[d.toISOString().slice(0,10)]) break; } else break; }
      else s++;
      d.setDate(d.getDate()-1);
      if (s > 365) break;
    }
    return s;
  }, [activity]);

  const weeklyTotal = useMemo(() => Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return (activity[d.toISOString().slice(0,10)]?.ayatsRead || 0);
  }).reduce((a,b) => a+b, 0), [activity]);
  const weeklyPct = useMemo(() => goals.weeklyAyats > 0 ? Math.min(1, weeklyTotal / goals.weeklyAyats) : 0, [weeklyTotal, goals.weeklyAyats]);


  // ── Dashboard layout (drag/resize/add/remove) ──────────────────────────────
  const ALL_WIDGETS = [
    { id:"kpis",       label:"VUE D'ENSEMBLE",          defaultSize:2 },
    { id:"objectifs",  label:"OBJECTIFS",                defaultSize:1 },
    { id:"calendrier", label:"CALENDRIER D'ACTIVITÉ",    defaultSize:1 },
    { id:"sourates",   label:"SOURATES ÉTUDIÉES",        defaultSize:1 },
    { id:"repartition",label:"RÉPARTITION",              defaultSize:1 },
    { id:"week",       label:"7 DERNIERS JOURS",         defaultSize:1 },
    { id:"heatmap",    label:"HEATMAP 7 SEMAINES",       defaultSize:2 },
    { id:"recents",    label:"ACTIVITÉ RÉCENTE",         defaultSize:1 },
    { id:"top",        label:"TOP SOURATES",             defaultSize:1 },
    { id:"timeline",   label:"TIMELINE",                 defaultSize:2 },
    { id:"citation",   label:"CITATION",                 defaultSize:2 },
    { id:"export",     label:"EXPORT / IMPORT",          defaultSize:2 },
  ];

  const loadLayout = () => {
    try {
      const s = localStorage.getItem("quran_dash_layout");
      if (s) return JSON.parse(s);
    } catch {}
    return ALL_WIDGETS.map(w => ({ id: w.id, visible: true, size: w.defaultSize }));
  };

  const [layout,    setLayout]    = useState(() => loadLayout());
  const [editMode,  setEditMode]  = useState(false);
  const [dragIdx,   setDragIdx]   = useState(null);
  const [dragOver,  setDragOver]  = useState(null);

  const saveLayout = (l) => {
    setLayout(l);
    try { localStorage.setItem("quran_dash_layout", JSON.stringify(l)); } catch {}
  };

  const toggleVisible = (id) => saveLayout(layout.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  const toggleSize    = (id) => saveLayout(layout.map(w => w.id === id ? { ...w, size: w.size === 2 ? 1 : 2 } : w));
  const moveUp        = (idx) => { if (idx === 0) return; const l=[...layout]; [l[idx-1],l[idx]]=[l[idx],l[idx-1]]; saveLayout(l); };
  const moveDown      = (idx) => { if (idx>=layout.length-1) return; const l=[...layout]; [l[idx],l[idx+1]]=[l[idx+1],l[idx]]; saveLayout(l); };
  const resetLayout   = () => saveLayout(ALL_WIDGETS.map(w => ({ id: w.id, visible: true, size: w.defaultSize })));

  const onDragStart   = (i) => setDragIdx(i);
  const onDragEnter   = (i) => setDragOver(i);
  const onDragEnd     = () => {
    if (dragIdx !== null && dragOver !== null && dragIdx !== dragOver) {
      const l = [...layout]; const [item] = l.splice(dragIdx, 1); l.splice(dragOver, 0, item);
      saveLayout(l);
    }
    setDragIdx(null); setDragOver(null);
  };

  // ── Mastery timeline ──────────────────────────────────────────────────────────
  const [masteryTimelineSn, setMasteryTimelineSn] = useState(null); // null = all

  const masteryTimeline = useMemo(() => {
    const days = 30;
    const points = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      // Count ayats whose learnedAt <= dateStr and no open revise session after dateStr
      let learned = 0, total = 0;
      for (const [key, v] of Object.entries(learnData)) {
        const [sn] = key.split(':').map(Number);
        if (masteryTimelineSn && sn !== masteryTimelineSn) continue;
        if (!v.learnedAt) continue;
        total++;
        if (v.learnedAt.slice(0, 10) <= dateStr) {
          // Check if revise session was open on this date (deducts mastery)
          const hist = v.reviseHistory || [];
          const openOnDate = hist.some(e => {
            const start = e.startDate?.slice(0, 10);
            const end   = e.endDate?.slice(0, 10);
            return start && start <= dateStr && (!end || end > dateStr);
          });
          if (!openOnDate) learned++;
        }
      }
      points.push({ date: dateStr, label: d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }), learned, total, pct: total > 0 ? Math.round(learned / total * 100) : 0 });
    }
    return points;
  }, [learnData, masteryTimelineSn]);

  const masteryTimelineSurahNums = useMemo(() => {
    const sns = [...new Set(Object.keys(learnData).map(k => parseInt(k.split(':')[0])))].filter(Boolean).sort((a,b)=>a-b);
    return sns;
  }, [learnData]);

  const renderWidget = (id) => {
    switch(id) {
      case "kpis": return <KpiWidget
        totalLearned={totalLearned} totalRead={totalRead} totalWords={totalWords}
        totalParts={totalParts} learnedParts={learnedParts} learnedSurahs={learnedSurahs}
        activeSurahs={activeSurahs} pctAyats={pctAyats} entries={entries} surahs={surahs}
        onNavigate={onNavigate}
      />;
      case "objectifs": return (
        <GoalsPanel goals={goals} todayAct={todayAct} weeklyTotal={weeklyTotal} streak={streak}
          goalAyatsPct={goalAyatsPct} goalPartsPct={goalPartsPct} weeklyPct={weeklyPct}
          onSetGoal={onSetGoal} surahs={surahs} />
      );
      case "calendrier": return (
        <ActivityCalendar activity={activity} goals={goals} learnData={learnData} surahs={surahs} />
      );
      case "sourates": return (
        <div className="dash-card">
          {activeSurahs.length === 0 ? <div className="dash-empty-hint">Aucune sourate étudiée</div>
          : activeSurahs.map((a,i)=>(
            <div key={i} className="dash-surah-bar" onClick={()=>onNavigate(a.num)}>
              <div className="dash-surah-num">{a.num}</div>
              <div className="dash-surah-name">{a.meta?.englishName||`Sourate ${a.num}`}</div>
              <div className="dash-surah-ar">{a.meta?.name||""}</div>
              <div className="dash-bar-track"><div className="dash-bar-fill" style={{width:`${Math.round(a.pct*100)}%`}}/></div>
              <div className="dash-bar-pct">{Math.round(a.pct*100)}%</div>
            </div>
          ))}
        </div>
      );
      case "repartition": return (
        <div className="dash-card">
          <div className="dash-donut-wrap">
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{position:"relative",width:80,height:80}}>
                <DonutChart pct={pctAyats} color="var(--green2)" size={80} stroke={9}/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"'Cinzel',serif",fontSize:14,fontWeight:700,color:"var(--green2)"}}>
                  {Math.round(pctAyats*100)}%
                </div>
              </div>
              <div className="dash-ring-label">AYATS</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,flex:1}}>
              {[
                {label:"Appris",   val:totalLearned, color:"var(--green2)"},
                {label:"En cours", val:entries.filter(([,v])=>!v.learned&&(v.readCount||0)>0).length, color:"var(--gold2)"},
                {label:"Non lus",  val:Math.max(0,6236-totalLearned-entries.filter(([,v])=>!v.learned&&(v.readCount||0)>0).length), color:"var(--border2)"},
              ].map((l,i)=>(
                <div key={i} className="dash-legend-item">
                  <div className="dash-legend-dot" style={{background:l.color}}/>
                  <span>{l.label}</span>
                  <span style={{marginLeft:"auto",fontFamily:"'Cinzel',serif",color:l.color}}>{l.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
      case "week": return (
        <div className="dash-card">
          <ActivityBarChart data={weekBars7} height={50} goalLine={goals?.dailyAyats||0} />
        </div>
      );
      case "heatmap": return (
        <div className="dash-card">
          <div className="dash-heatmap">
            {heatmap.map((v,i)=>{
              const intensity = hasActivity ? Math.min(v/4,1) : 0;
              return <div key={i} className="dash-heatmap-cell"
                style={{background:intensity>0?`rgba(62,184,160,${0.1+intensity*0.75})`:"var(--surface3)",
                  borderColor:intensity>0?"rgba(62,184,160,.3)":"var(--border)"}}
                title={`${v} lecture(s)`}/>;
            })}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,justifyContent:"flex-end"}}>
            <div style={{fontSize:8,color:"var(--text3)",letterSpacing:1}}>MOINS</div>
            {[0,.2,.4,.7,1].map((v,i)=>(
              <div key={i} style={{width:10,height:10,borderRadius:2,
                background:v>0?`rgba(62,184,160,${0.1+v*0.75})`:"var(--surface3)",border:"1px solid rgba(62,184,160,.2)"}}/>
            ))}
            <div style={{fontSize:8,color:"var(--text3)",letterSpacing:1}}>PLUS</div>
          </div>
        </div>
      );
      case "recents": return (
        <div className="dash-card">
          {recentActivity.length===0 ? <div className="dash-empty-hint">Aucune activité enregistrée</div>
          : recentActivity.map((a,i)=>(
            <div key={i} className="dash-activity-row">
              <div className="dash-activity-dot" style={{background:a.learned?"var(--green2)":"var(--gold2)"}}/>
              <div className="dash-activity-text">
                <span style={{color:"var(--gold)",fontFamily:"'Cinzel',serif",fontSize:9}}>{a.surahName.toUpperCase()}</span>
                {" · "}Ayat {a.aNum}
                {a.learned && <span style={{marginLeft:6,color:"var(--green2)",fontSize:9}}>✓ APPRIS</span>}
              </div>
              <div className="dash-activity-time">{a.readCount}×</div>
            </div>
          ))}
        </div>
      );
      case "top": return (
        <div className="dash-card">
          {topLearned.length===0 ? <div className="dash-empty-hint">Aucun ayat appris</div>
          : topLearned.map((a,i)=>(
            <div key={i} className="dash-surah-bar" onClick={()=>onNavigate(a.num)}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"var(--surface3)",border:"1px solid var(--border)",
                display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:8,color:"var(--gold)",flexShrink:0}}>{i+1}</div>
              <div className="dash-surah-name">{a.meta?.englishName||`S${a.num}`}</div>
              <div className="dash-surah-ar">{a.meta?.name||""}</div>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:10,color:"var(--green2)",flexShrink:0}}>{a.learned}/{a.total}</div>
            </div>
          ))}
        </div>
      );
      case "timeline": return (() => {
        const W = 100, H = 60;
        const pts = masteryTimeline;
        // Y domain driven by the actual data range (percent mastery)
        const yMin = Math.min(...pts.map(p => p.pct));
        const yMax = Math.max(...pts.map(p => p.pct));
        const yRange = (yMax - yMin) || 1;
        // SVG polyline points
        const toX = (i) => (i / (pts.length - 1)) * W;
        const toY = (pct) => H - ((pct - yMin) / yRange) * H;
        const yTicks = [0, .25, .5, .75, 1].map(f => yMin + f * yRange);
        const linePoints = pts.map((p, i) => `${toX(i)},${toY(p.pct)}`).join(' ');
        const fillPoints = `0,${H} ` + pts.map((p,i) => `${toX(i)},${toY(p.pct)}`).join(' ') + ` ${W},${H}`;
        const latest = pts[pts.length - 1];
        const first  = pts[0];
        const delta  = latest.pct - first.pct;

        return (
          <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px',
            background:'var(--surface2)', borderRadius:12, border:'1px solid var(--border)' }}>
            {/* Header + surah selector */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)' }}>MAÎTRISE DANS LE TEMPS</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                  <span style={{ fontSize:28, fontFamily:"'Cinzel',serif", color: masteryColor(latest.pct) }}>{latest.pct}%</span>
                  <span style={{ fontSize:9, color: delta >= 0 ? 'var(--green)' : 'var(--red)',
                    letterSpacing:1 }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% / 30j</span>
                </div>
              </div>
              {/* Surah filter */}
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', maxWidth:260 }}>
                <button onClick={() => setMasteryTimelineSn(null)} style={{
                  fontSize:7, letterSpacing:1, padding:'2px 8px', borderRadius:4, cursor:'pointer',
                  fontFamily:"'Cinzel',serif",
                  background: masteryTimelineSn === null ? 'rgba(201,168,76,.15)' : 'transparent',
                  border:`1px solid ${masteryTimelineSn === null ? 'var(--gold)' : 'rgba(255,255,255,.1)'}`,
                  color: masteryTimelineSn === null ? 'var(--gold)' : 'var(--text3)' }}>TOUT</button>
                {masteryTimelineSurahNums.slice(0, 10).map(sn => {
                  const s = surahs.find(x => x.number === sn);
                  return (
                    <button key={sn} onClick={() => setMasteryTimelineSn(sn === masteryTimelineSn ? null : sn)} style={{
                      fontSize:7, letterSpacing:1, padding:'2px 8px', borderRadius:4, cursor:'pointer',
                      fontFamily:"'Cinzel',serif",
                      background: masteryTimelineSn === sn ? `rgba(${masteryColor(latest.pct)}, .1)` : 'transparent',
                      border:`1px solid ${masteryTimelineSn === sn ? masteryColor(latest.pct) : 'rgba(255,255,255,.1)'}`,
                      color: masteryTimelineSn === sn ? masteryColor(latest.pct) : 'var(--text3)' }}>
                      {s?.name || `S${sn}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chart: Y-axis (% mastery) + SVG */}
            <div style={{ display:'flex', gap:6 }}>
              {/* Y-axis labels (percent mastery) */}
              <div style={{ display:'flex', flexDirection:'column', justifyContent:'space-between',
                height:90, flexShrink:0, textAlign:'right' }}>
                {yTicks.slice().reverse().map((v,i) => (
                  <span key={i} style={{ fontSize:6, color:'var(--text3)', letterSpacing:.5,
                    fontFamily:"'Cinzel',serif" }}>{Math.round(v)}%</span>
                ))}
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ flex:1, width:'100%', height:90, overflow:'visible' }}
                preserveAspectRatio="none">
                {/* Grid lines at each y-tick (data-driven min/max) */}
                {yTicks.map((v,i) => (
                  <line key={i} x1="0" y1={toY(v)} x2={W} y2={toY(v)}
                    stroke="rgba(255,255,255,.05)" strokeWidth=".5" />
                ))}
                {/* Fill area */}
                <polygon points={fillPoints}
                  fill={`${masteryColor(latest.pct)}22`} />
                {/* Line */}
                <polyline points={linePoints}
                  fill="none" stroke={masteryColor(latest.pct)} strokeWidth="1.2"
                  strokeLinecap="round" strokeLinejoin="round" />
                {/* Dots every 5 days */}
                {pts.filter((_,i) => i % 5 === 0 || i === pts.length-1).map((p,_,arr) => {
                  const i = pts.indexOf(p);
                  return (
                    <circle key={i} cx={toX(i)} cy={toY(p.pct)} r="1.5"
                      fill={masteryColor(p.pct)} />
                  );
                })}
              </svg>
            </div>

            {/* X-axis labels */}
            <div style={{ display:'flex', gap:6, marginTop:-8 }}>
              <div style={{ width:22, flexShrink:0 }} />
              <div style={{ flex:1, display:'flex', justifyContent:'space-between' }}>
                {pts.filter((_,i) => i % 7 === 0 || i === pts.length-1).map((p,i) => (
                  <div key={i} style={{ fontSize:6, color:'var(--text3)', letterSpacing:.5 }}>{p.label}</div>
                ))}
              </div>
            </div>

            {/* Recent learned */}
            {recentlyLearned.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)' }}>DERNIERS AYATS APPRIS</div>
                {recentlyLearned.map(([key,v]) => {
                  const [sn,an] = key.split(':').map(Number);
                  const sname = surahs.find(s=>s.number===sn)?.englishName||`S${sn}`;
                  const d2 = new Date(v.learnedAt);
                  return (
                    <div key={key} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
                      background:'var(--surface3)', borderRadius:6 }}>
                      <div style={{ fontSize:9, color:'var(--green)', fontFamily:"'Cinzel',serif", flexShrink:0, width:28 }}>{an}</div>
                      <div style={{ flex:1, fontSize:8, color:'var(--text2)', letterSpacing:.5 }}>{sname}</div>
                      <div style={{ fontSize:7, color:'var(--text3)' }}>{d2.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })();
      case "citation": return (
        <div style={{padding:"20px",background:"rgba(201,168,76,.04)",border:"1px solid rgba(201,168,76,.12)",borderRadius:12,textAlign:"center",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontFamily:"'Amiri Quran',serif",fontSize:24,color:"var(--gold)",opacity:.8,direction:"rtl"}}>خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ</div>
          <div style={{fontSize:9,letterSpacing:1.5,color:"var(--text3)"}}>« LE MEILLEUR D'ENTRE VOUS EST CELUI QUI APPREND LE CORAN ET L'ENSEIGNE » — AL-BUKHARI</div>
        </div>
      );
      case "export": return <ExportImport />;
      default: return null;
    }
  };

  const visibleLayout = layout.filter(w => w.visible);
  const hiddenLayout  = layout.filter(w => !w.visible);

  return (
    <main className="main" style={{background:"var(--bg)"}}>
      {/* Header */}
      <div style={{padding:"14px 28px 14px",borderBottom:"1px solid var(--border)",flexShrink:0,
        display:"flex",alignItems:"center",gap:16,
        background:"linear-gradient(180deg,var(--surface),var(--bg))"}}>
        <div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:13,letterSpacing:3,color:"var(--gold2)"}}>TABLEAU DE BORD</div>
          <div style={{fontSize:9,letterSpacing:2,color:"var(--text3)",marginTop:2}}>
            {today.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase()}
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>setEditMode(v=>!v)} style={{
            fontSize:8,letterSpacing:2,padding:"5px 12px",fontFamily:"'Cinzel',serif",
            background:editMode?"rgba(201,168,76,.15)":"transparent",
            border:`1px solid ${editMode?"var(--gold)":"var(--border2)"}`,
            color:editMode?"var(--gold2)":"var(--text3)",borderRadius:6,cursor:"pointer"
          }}>{editMode ? "✓ TERMINER" : "✏ PERSONNALISER"}</button>
          {editMode && <button onClick={resetLayout} style={{fontSize:8,letterSpacing:1,padding:"5px 10px",fontFamily:"'Cinzel',serif",background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)",borderRadius:6,cursor:"pointer"}}>↺ RESET</button>}
          <div style={{fontFamily:"'Amiri Quran',serif",fontSize:20,color:"var(--gold)",opacity:.7,direction:"rtl"}}>وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا</div>
        </div>
      </div>

      <div className="dash-page">
        {isEmpty && (
          <div style={{padding:"28px 20px",background:"rgba(201,168,76,.04)",border:"1px solid rgba(201,168,76,.15)",borderRadius:12,textAlign:"center"}}>
            <div style={{fontFamily:"'Amiri Quran',serif",fontSize:32,color:"var(--gold)",opacity:.5,direction:"rtl",marginBottom:10}}>بِسْمِ اللَّهِ</div>
            <div style={{fontSize:10,letterSpacing:2,color:"var(--text2)"}}>COMMENCEZ VOTRE APPRENTISSAGE DANS L'ONGLET CORAN</div>
          </div>
        )}

        {/* ── Hidden widgets panel (edit mode) ── */}
        {editMode && hiddenLayout.length > 0 && (
          <div style={{padding:"12px",background:"rgba(201,168,76,.05)",border:"1px dashed var(--gold)",borderRadius:8,display:"flex",flexWrap:"wrap",gap:6}}>
            <div style={{width:"100%",fontSize:8,letterSpacing:1.5,color:"var(--text3)",marginBottom:4}}>WIDGETS MASQUÉS — cliquer pour afficher</div>
            {hiddenLayout.map(w => (
              <button key={w.id} onClick={()=>toggleVisible(w.id)} style={{
                fontSize:8,letterSpacing:1,padding:"4px 12px",fontFamily:"'Cinzel',serif",
                background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--text3)",borderRadius:20,cursor:"pointer"
              }}>+ {ALL_WIDGETS.find(a=>a.id===w.id)?.label || w.id}</button>
            ))}
          </div>
        )}

        {/* ── Widget grid ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,320px),1fr))",gap:16,alignItems:"start"}}>
          {visibleLayout.map((w, wi) => {
            const meta   = ALL_WIDGETS.find(a => a.id === w.id);
            const isDragging = dragIdx === wi;
            const isOver     = dragOver === wi;
            return (
              <div key={w.id}
                className="dash-widget-cell"
                draggable={editMode}
                onDragStart={()=>onDragStart(wi)}
                onDragEnter={()=>onDragEnter(wi)}
                onDragEnd={onDragEnd}
                onDragOver={e=>e.preventDefault()}
                style={{
                  gridColumn: w.size === 2 ? "1 / -1" : "auto",
                  opacity: isDragging ? .4 : 1,
                  outline: isOver && !isDragging ? "2px dashed var(--gold)" : "none",
                  outlineOffset: 3,
                  transition: "opacity .15s",
                  position: "relative",
                }}>
                {/* Edit overlay header */}
                {editMode && (
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                    <div style={{cursor:"grab",fontSize:14,color:"var(--text3)",padding:"0 4px",userSelect:"none"}}>⠿</div>
                    <div style={{flex:1,fontSize:8,letterSpacing:1.5,color:"var(--gold2)",fontFamily:"'Cinzel',serif"}}>{meta?.label}</div>
                    <button onClick={()=>toggleSize(w.id)} title={w.size===2?"Réduire":"Agrandir"}
                      style={{fontSize:9,padding:"2px 8px",background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)",borderRadius:4,cursor:"pointer"}}>
                      {w.size===2 ? "⊡" : "⊞"}
                    </button>
                    <button onClick={()=>moveUp(wi)} disabled={wi===0}
                      style={{fontSize:9,padding:"2px 6px",background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)",borderRadius:4,cursor:"pointer",opacity:wi===0?.4:1}}>↑</button>
                    <button onClick={()=>moveDown(wi)} disabled={wi===visibleLayout.length-1}
                      style={{fontSize:9,padding:"2px 6px",background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)",borderRadius:4,cursor:"pointer",opacity:wi===visibleLayout.length-1?.4:1}}>↓</button>
                    <button onClick={()=>toggleVisible(w.id)}
                      style={{fontSize:9,padding:"2px 8px",background:"rgba(224,90,90,.1)",border:"1px solid var(--red)",color:"var(--red)",borderRadius:4,cursor:"pointer"}}>✕</button>
                  </div>
                )}
                {!editMode && <div className="dash-section-title">{meta?.label}</div>}
                {renderWidget(w.id)}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// ─── OfflineLoader ────────────────────────────────────────────────────────────
function OfflineLoader() {
  const [status,   setStatus]   = React.useState(null); // null | 'running' | 'done' | 'error'
  const [progress, setProgress] = React.useState({ done: 0, total: 0, current: '' });
  const abortRef = React.useRef(false);

  const handleLoad = async () => {
    abortRef.current = false;
    setStatus('running');
    setProgress({ done: 0, total: 0, current: '' });

    const TOTAL_SURAHS = 114;
    // Step counts: surahs list(1) + ayats per surah(114) + text per surah(114) + timestamps(114) = 343
    const total = 1 + TOTAL_SURAHS * 3;
    let done = 0;

    const tick = (label) => {
      done++;
      setProgress({ done, total, current: label });
    };

    try {
      // 1. Surahs list
      tick('Liste des sourates…');
      await fetchSurahs();
      if (abortRef.current) { setStatus(null); return; }

      for (let n = 1; n <= TOTAL_SURAHS; n++) {
        if (abortRef.current) { setStatus(null); return; }
        const name = `Sourate ${n}`;

        // 2. Ayats (text + audio numbers)
        tick(`${name} — ayats`);
        try { await fetchAyats(n); } catch {}

        if (abortRef.current) { setStatus(null); return; }

        // 3. Text (concordance)
        tick(`${name} — texte`);
        try { await fetchSurahSimple(n); } catch {}

        if (abortRef.current) { setStatus(null); return; }

        // 4. Timestamps
        tick(`${name} — timestamps`);
        try { await loadTimestampsForSurah(n, getGlobalRecitator()); } catch {}

        if (abortRef.current) { setStatus(null); return; }

        // 5. Audio pre-cache via Service Worker
        tick(`${name} — audio`);
        try {
          const ayatData = await fetchAyats(n);
          const ayahs = ayatData?.ayahs || [];
          const sw = navigator.serviceWorker?.controller;
          if (sw && ayahs.length) {
            sw.postMessage({ type: 'PRECACHE_AUDIO', urls: ayahs.map(a => `${getAudioBase()}/${a.number}.mp3`) });
          }
        } catch {}
      }

      setStatus('done');
      setProgress(p => ({ ...p, current: 'Toutes les ressources chargées ✓' }));
    } catch (e) {
      setStatus('error');
      setProgress(p => ({ ...p, current: 'Erreur : ' + (e.message || String(e)) }));
    }
  };

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const running = status === 'running';

  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:10, overflow:"hidden", marginTop:8 }}>
      <div style={{ padding:"12px 14px", background:"var(--surface2)", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>📥 MODE HORS LIGNE</div>
            <div style={{ fontSize:8, color:"var(--text3)", marginTop:3, letterSpacing:.5 }}>
              Pré-charge les 114 sourates, textes et timestamps en IDB
            </div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {running && (
              <button onClick={() => { abortRef.current = true; }} style={{
                padding:"7px 14px", fontSize:8, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                background:"rgba(224,90,90,.1)", border:"1px solid var(--red)", color:"var(--red)",
                borderRadius:8, cursor:"pointer",
              }}>✕ STOP</button>
            )}
            <button onClick={handleLoad} disabled={running} style={{
              padding:"7px 18px", fontSize:8, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background: running ? "rgba(62,184,160,.05)" : "rgba(62,184,160,.1)",
              border:"1px solid var(--teal)", color:"var(--teal2)",
              borderRadius:8, cursor: running ? "default" : "pointer",
              opacity: running ? .7 : 1,
            }}>{running ? "…" : status === 'done' ? "↺ RECHARGER" : "⬇ CHARGER"}</button>
          </div>
        </div>

        {(running || status === 'done' || status === 'error') && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ height:4, background:"var(--surface3)", borderRadius:2, overflow:"hidden" }}>
              <div style={{
                height:"100%", borderRadius:2, transition:"width .3s",
                width: pct + "%",
                background: status === 'error' ? "var(--red)" : status === 'done' ? "var(--green)" : "var(--teal)",
              }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:.5 }}>{progress.current}</div>
              <div style={{ fontSize:8, color: status === 'done' ? "var(--green)" : "var(--text3)", fontFamily:"monospace" }}>
                {progress.done}/{progress.total}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ExportImport ────────────────────────────────────────────────────────────
const DATA_KEYS = [
  "quran_learnData", "quran_collections", "quran_activity",
  "quran_loopBySurah", "quran_lastAyatBySurah",
  "quran_goal_dailyAyats", "quran_goal_dailyParts", "quran_goal_weeklyAyats",
  "quran_goal_targetSurah", "quran_goal_targetDate",
  "quran_revision_mastery",
];

function getDeviceId() {
  let id = localStorage.getItem("quran_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2,10) + "_" + Date.now().toString(36);
    localStorage.setItem("quran_device_id", id);
  }
  return id;
}

// Deep merge two learnData objects using updatedAt timestamps for conflict resolution
function mergeLearnData(base, incoming) {
  const out = { ...base };
  for (const [key, val] of Object.entries(incoming)) {
    if (!out[key]) { out[key] = val; continue; }
    const b = out[key];
    // Newer updatedAt wins for scalar fields
    const bNewer = (b.updatedAt || "") >= (val.updatedAt || "");
    const winner = bNewer ? b : val;
    const loser  = bNewer ? val : b;
    // Merge parts: ALWAYS union of both sides — never drop a part from either device
    // For each id: newer createdAt/updatedAt wins for data, learned=true always wins
    const partsMap = {};
    for (const p of [...(b.parts || []), ...(val.parts || [])]) {
      if (!partsMap[p.id]) {
        partsMap[p.id] = p;
      } else {
        const existing = partsMap[p.id];
        const pNewer = (p.updatedAt||p.createdAt||"") >= (existing.updatedAt||existing.createdAt||"");
        const pw = pNewer ? p : existing;
        partsMap[p.id] = { ...existing, ...pw, learned: !!(p.learned || existing.learned) };
      }
    }
    // Merge recitAttempts: concat + dedupe by date
    const attemptsMap = {};
    for (const a of [...(b.recitAttempts||[]), ...(val.recitAttempts||[])]) attemptsMap[a.date] = a;
    // Merge wordsLearned: true wins
    const wl = { ...(b.wordsLearned||{}), ...(val.wordsLearned||{}) };
    for (const k of Object.keys(b.wordsLearned||{})) if (b.wordsLearned[k]) wl[k] = true;
    out[key] = {
      ...loser, ...winner,
      learned:      b.learned || val.learned,
      learnedAt:    b.learnedAt || val.learnedAt,
      createdAt:    b.createdAt && val.createdAt ? (b.createdAt < val.createdAt ? b.createdAt : val.createdAt) : (b.createdAt || val.createdAt),
      updatedAt:    b.updatedAt && val.updatedAt ? (b.updatedAt > val.updatedAt ? b.updatedAt : val.updatedAt) : (b.updatedAt || val.updatedAt),
      readCount:    Math.max(b.readCount||0, val.readCount||0),
      parts:        Object.values(partsMap),
      recitAttempts:Object.values(attemptsMap).sort((a,z) => a.date < z.date ? -1 : 1).slice(-50),
      wordsLearned: wl,
    };
  }
  return out;
}

function mergeActivity(base, incoming) {
  const out = { ...base };
  for (const [date, v] of Object.entries(incoming)) {
    if (!out[date]) { out[date] = v; continue; }
    const bNewer = (out[date].updatedAt || "") >= (v.updatedAt || "");
    out[date] = {
      ayatsRead:    Math.max(out[date].ayatsRead||0,    v.ayatsRead||0),
      partsLearned: Math.max(out[date].partsLearned||0, v.partsLearned||0),
      ayatsLearned: Math.max(out[date].ayatsLearned||0, v.ayatsLearned||0),
      createdAt:    out[date].createdAt || v.createdAt,
      updatedAt:    bNewer ? out[date].updatedAt : v.updatedAt,
    };
  }
  return out;
}

function mergeCollections(base, incoming) {
  const out = base.map(c => ({ ...c }));
  for (const col of incoming) {
    const existing = out.find(c => c.id === col.id);
    if (!existing) { out.push({ ...col }); continue; }
    // Merge ayats: dedupe by surahNum:ayatNum
    const ayatKeys = new Set(existing.ayats.map(a => `${a.surahNum}:${a.ayatNum}`));
    for (const a of col.ayats) {
      const k = `${a.surahNum}:${a.ayatNum}`;
      if (!ayatKeys.has(k)) { existing.ayats.push(a); ayatKeys.add(k); }
    }
  }
  return out;
}

function ExportImport() {
  const [open,      setOpen]      = React.useState(false);
  const [status,    setStatus]    = React.useState(null);
  const [importing, setImporting] = React.useState(false);
  const [cloudStatus, setCloudStatus] = React.useState(null);
  const [cloudSaving,   setCloudSaving]   = React.useState(false);
  const [cloudRestoring, setCloudRestoring] = React.useState(false);
  const fileRef = React.useRef();

  // ── helpers ──────────────────────────────────────────────────────────
  const getCurrentUserId = () => firebaseAuth.currentUser?.uid || null;

  const handleExport = () => {
    const payload = {
      version:  2,
      deviceId: getDeviceId(),
      exportedAt: new Date().toISOString(),
      data: {},
    };
    for (const key of DATA_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) { try { payload.data[key] = JSON.parse(raw); } catch { payload.data[key] = raw; } }
    }
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `quran_backup_${getDeviceId()}_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ type:"ok", msg:"Export téléchargé ✓" });
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload?.data) throw new Error("Format invalide");

      const myId = getDeviceId();
      let merged = 0;

      for (const key of DATA_KEYS) {
        const incoming = payload.data[key];
        if (incoming == null) continue;
        const rawBase = localStorage.getItem(key);
        let base;
        try { base = rawBase ? JSON.parse(rawBase) : null; } catch { base = null; }

        let result;
        if (key === "quran_learnData") {
          result = mergeLearnData(base || {}, incoming);
        } else if (key === "quran_activity") {
          result = mergeActivity(base || {}, incoming);
        } else if (key === "quran_collections") {
          result = mergeCollections(base || [], incoming);
        } else if (key === "quran_lastAyatBySurah" || key === "quran_loopBySurah") {
          result = { ...(base||{}), ...incoming };
        } else {
          result = base ?? incoming;
        }
        localStorage.setItem(key, JSON.stringify(result));
        merged++;
      }

      // ── Backup avant fusion ──
      const backupPayload = { version:2, deviceId: myId, exportedAt: new Date().toISOString(), isBackup: true, data: {} };
      for (const k of DATA_KEYS) { const r = localStorage.getItem(k); if (r) { try { backupPayload.data[k] = JSON.parse(r); } catch { backupPayload.data[k] = r; } } }
      const backupBlob = new Blob([JSON.stringify(backupPayload, null, 2)], { type:"application/json" });
      const backupUrl  = URL.createObjectURL(backupBlob);
      const backupA    = document.createElement("a");
      backupA.href     = backupUrl;
      backupA.download = `quran_BACKUP_avant_import_${myId}_${new Date().toISOString().slice(0,10)}.json`;
      backupA.click();
      URL.revokeObjectURL(backupUrl);

      // Track import history
      const history = JSON.parse(localStorage.getItem("quran_import_history") || "[]");
      history.push({ from: payload.deviceId || "?", importedAt: new Date().toISOString(), myId, keys: merged });
      localStorage.setItem("quran_import_history", JSON.stringify(history.slice(-20)));

      setStatus({ type:"ok", msg: `Fusion OK — ${merged} clés importées depuis ${payload.deviceId || "?"} (${payload.exportedAt?.slice(0,10) || "?"})` });
      setTimeout(() => window.location.reload(), 1200);
    } catch(err) {
      setStatus({ type:"err", msg: "Erreur : " + err.message });
    }
    setImporting(false);
    e.target.value = "";
  };

  // ── Cloud Sync ──────────────────────────────────────────────────────
  const handleCloudSave = async () => {
    const uid = getCurrentUserId();
    if (!uid) { setCloudStatus({ type:"err", msg:"Non connecté." }); return; }
    setCloudSaving(true);
    setCloudStatus(null);
    try {
      const data = {};
      for (const key of DATA_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw) { try { data[key] = JSON.parse(raw); } catch { data[key] = raw; } }
      }
      const docRef = doc(firebaseDb, "userData", uid);
      await setDoc(docRef, {
        data,
        savedAt: new Date().toISOString(),
        deviceId: getDeviceId(),
        version: 2,
      });
      setCloudStatus({ type:"ok", msg:"Sauvegardé sur le cloud ✓ — " + new Date().toLocaleTimeString("fr-FR") });
    } catch(err) {
      setCloudStatus({ type:"err", msg:"Erreur cloud : " + err.message });
    }
    setCloudSaving(false);
  };

  const handleCloudRestore = async () => {
    const uid = getCurrentUserId();
    if (!uid) { setCloudStatus({ type:"err", msg:"Non connecté." }); return; }
    setCloudRestoring(true);
    setCloudStatus(null);
    try {
      const docRef = doc(firebaseDb, "userData", uid);
      const snap   = await getDoc(docRef);
      if (!snap.exists()) {
        setCloudStatus({ type:"err", msg:"Aucune sauvegarde cloud trouvée pour ce compte." });
        setCloudRestoring(false);
        return;
      }
      const { data, savedAt } = snap.data();
      if (!data) throw new Error("Données cloud invalides.");

      let merged = 0;
      for (const key of DATA_KEYS) {
        const incoming = data[key];
        if (incoming == null) continue;
        const rawBase = localStorage.getItem(key);
        let base;
        try { base = rawBase ? JSON.parse(rawBase) : null; } catch { base = null; }
        let result;
        if (key === "quran_learnData") {
          result = mergeLearnData(base || {}, incoming);
        } else if (key === "quran_activity") {
          result = mergeActivity(base || {}, incoming);
        } else if (key === "quran_collections") {
          result = mergeCollections(base || [], incoming);
        } else if (key === "quran_lastAyatBySurah" || key === "quran_loopBySurah") {
          result = { ...(base||{}), ...incoming };
        } else {
          result = incoming ?? base;
        }
        localStorage.setItem(key, JSON.stringify(result));
        merged++;
      }
      setCloudStatus({ type:"ok", msg:`Restauré depuis le cloud ✓ (sauvegarde du ${savedAt?.slice(0,10) || "?"})` });
      setTimeout(() => window.location.reload(), 1500);
    } catch(err) {
      setCloudStatus({ type:"err", msg:"Erreur cloud : " + err.message });
    }
    setCloudRestoring(false);
  };

  const history = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem("quran_import_history") || "[]"); } catch { return []; }
  }, [open]);

  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:10, overflow:"hidden" }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 14px", background:"var(--surface2)", border:"none", cursor:"pointer", fontFamily:"'Cinzel',serif"
      }}>
        <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>💾 EXPORT / IMPORT / CLOUD</span>
        <span style={{ fontSize:10, color:"var(--text3)", display:"inline-block", transform: open?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s" }}>▾</span>
      </button>

      {open && (
        <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ fontSize:8, letterSpacing:1, color:"var(--text3)" }}>
            APPAREIL · <span style={{ color:"var(--gold2)", fontFamily:"monospace" }}>{getDeviceId()}</span>
          </div>

          {/* ── Local export / import ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)" }}>FICHIER LOCAL</div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <button onClick={handleExport} style={{
                padding:"9px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                background:"rgba(62,184,160,.1)", border:"1px solid var(--teal)", color:"var(--teal2)",
                borderRadius:8, cursor:"pointer"
              }}>⬇ EXPORTER</button>
              <button onClick={() => fileRef.current?.click()} disabled={importing} style={{
                padding:"9px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                background:"rgba(201,168,76,.1)", border:"1px solid var(--gold)", color:"var(--gold2)",
                borderRadius:8, cursor:"pointer", opacity: importing ? .6 : 1
              }}>{importing ? "…" : "⬆ IMPORTER & FUSIONNER"}</button>
              <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display:"none" }} />
            </div>
            {status && (
              <div style={{ fontSize:8, letterSpacing:1, padding:"8px 12px", borderRadius:6,
                background: status.type==="ok" ? "rgba(76,175,129,.1)" : "rgba(224,90,90,.1)",
                border: "1px solid " + (status.type==="ok" ? "var(--green)" : "var(--red)"),
                color: status.type==="ok" ? "var(--green)" : "var(--red)" }}>
                {status.msg}
              </div>
            )}
          </div>

          {/* ── Cloud sync ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:8, paddingTop:8, borderTop:"1px solid var(--border)" }}>
            <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)" }}>☁ SAUVEGARDE CLOUD (FIRESTORE)</div>
            <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:.5, lineHeight:1.6 }}>
              Sauvegarde liée à votre compte · <span style={{ color:"var(--gold2)", fontFamily:"monospace" }}>{firebaseAuth.currentUser?.email || "—"}</span>
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <button onClick={handleCloudSave} disabled={cloudSaving || cloudRestoring} style={{
                padding:"9px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                background:"rgba(100,120,255,.1)", border:"1px solid #6478ff", color:"#8fa0ff",
                borderRadius:8, cursor:"pointer", opacity: (cloudSaving||cloudRestoring) ? .6 : 1
              }}>{cloudSaving ? "…" : "☁ SAUVEGARDER"}</button>
              <button onClick={handleCloudRestore} disabled={cloudSaving || cloudRestoring} style={{
                padding:"9px 20px", fontSize:9, letterSpacing:2, fontFamily:"'Cinzel',serif",
                background:"rgba(255,160,80,.1)", border:"1px solid #ffa050", color:"#ffb870",
                borderRadius:8, cursor:"pointer", opacity: (cloudSaving||cloudRestoring) ? .6 : 1
              }}>{cloudRestoring ? "…" : "⬇ RESTAURER"}</button>
            </div>
            {cloudStatus && (
              <div style={{ fontSize:8, letterSpacing:1, padding:"8px 12px", borderRadius:6,
                background: cloudStatus.type==="ok" ? "rgba(76,175,129,.1)" : "rgba(224,90,90,.1)",
                border: "1px solid " + (cloudStatus.type==="ok" ? "var(--green)" : "var(--red)"),
                color: cloudStatus.type==="ok" ? "var(--green)" : "var(--red)" }}>
                {cloudStatus.msg}
              </div>
            )}
          </div>

          <OfflineLoader />

          {history.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)" }}>HISTORIQUE IMPORTS</div>
              {[...history].reverse().map((h,i) => (
                <div key={i} style={{ fontSize:8, color:"var(--text3)", display:"flex", gap:8, padding:"4px 8px", background:"var(--surface3)", borderRadius:4 }}>
                  <span style={{ color:"var(--gold2)", fontFamily:"monospace" }}>{h.from?.slice(0,16)}</span>
                  <span>{h.importedAt?.slice(0,16).replace("T"," ")}</span>
                  <span style={{ color:"var(--teal2)" }}>{h.keys} clés</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PRONONCIATION PAGE ───────────────────────────────────────────────────────

const ARABIC_LETTERS = [
  { letter:"ب", name:"Ba",  trans:"b",  isolated:"ب", initial:"بـ", medial:"ـبـ", final:"ـب", makhraj:"Lèvres", tip:"Bi-labiale occlusive sonore. Lèvres fermées, air expulsé." },
  { letter:"ت", name:"Ta",  trans:"t",  isolated:"ت", initial:"تـ", medial:"ـتـ", final:"ـت", makhraj:"Dents+langue", tip:"Apico-dentale. Pointe de la langue touche les dents supérieures." },
  { letter:"ث", name:"Tha", trans:"th", isolated:"ث", initial:"ثـ", medial:"ـثـ", final:"ـث", makhraj:"Dents+langue", tip:"Comme le 'th' anglais dans 'think'. Langue entre les dents." },
  { letter:"ج", name:"Jîm", trans:"j",  isolated:"ج", initial:"جـ", medial:"ـجـ", final:"ـج", makhraj:"Palais", tip:"Palatale. Son 'dj' profond, palais médian." },
  { letter:"ح", name:"Ḥa",  trans:"ḥ",  isolated:"ح", initial:"حـ", medial:"ـحـ", final:"ـح", makhraj:"Gorge", tip:"Fricative pharyngale sourde. Souffle chaud depuis la gorge, sans voix." },
  { letter:"خ", name:"Kha", trans:"kh", isolated:"خ", initial:"خـ", medial:"ـخـ", final:"ـخ", makhraj:"Gorge", tip:"Comme le 'j' espagnol ou le 'ch' allemand dans 'Bach'." },
  { letter:"د", name:"Dal", trans:"d",  isolated:"د", initial:"دـ", medial:"ـدـ", final:"ـد", makhraj:"Dents+langue", tip:"Apico-dentale sonore. Comme 'd' français mais contre les dents." },
  { letter:"ذ", name:"Dhal",trans:"dh", isolated:"ذ", initial:"ذـ", medial:"ـذـ", final:"ـذ", makhraj:"Dents+langue", tip:"Comme le 'th' anglais dans 'this'. Langue entre les dents, avec voix." },
  { letter:"ر", name:"Ra",  trans:"r",  isolated:"ر", initial:"رـ", medial:"ـرـ", final:"ـر", makhraj:"Langue", tip:"Roulé apical. Pointe de la langue vibre contre les alvéoles." },
  { letter:"ز", name:"Zay", trans:"z",  isolated:"ز", initial:"زـ", medial:"ـزـ", final:"ـز", makhraj:"Dents+langue", tip:"Sifflante sonore. Identique au 'z' français." },
  { letter:"س", name:"Sîn", trans:"s",  isolated:"س", initial:"سـ", medial:"ـسـ", final:"ـس", makhraj:"Dents+langue", tip:"Sifflante sourde fine. Langue derrière les dents, pas d'emphase." },
  { letter:"ش", name:"Chîn",trans:"sh", isolated:"ش", initial:"شـ", medial:"ـشـ", final:"ـش", makhraj:"Palais", tip:"Chuintante comme 'ch' en français. Palais antérieur." },
  { letter:"ص", name:"Ṣad", trans:"ṣ",  isolated:"ص", initial:"صـ", medial:"ـصـ", final:"ـص", makhraj:"Dents+langue", tip:"'S' emphatique. Langue basse, gorge contractée, son grave." },
  { letter:"ض", name:"Ḍad", trans:"ḍ",  isolated:"ض", initial:"ضـ", medial:"ـضـ", final:"ـض", makhraj:"Langue", tip:"Latérale emphatique unique à l'arabe. Bords de la langue touche les molaires." },
  { letter:"ط", name:"Ṭa",  trans:"ṭ",  isolated:"ط", initial:"طـ", medial:"ـطـ", final:"ـط", makhraj:"Dents+langue", tip:"'T' emphatique. Langue contre les dents supérieures, gorge contractée." },
  { letter:"ظ", name:"Ẓa",  trans:"ẓ",  isolated:"ظ", initial:"ظـ", medial:"ـظـ", final:"ـظ", makhraj:"Dents+langue", tip:"'Dh' emphatique. Comme ذ mais avec emphase, son grave et profond." },
  { letter:"ع", name:"Ayn", trans:"ʿ",  isolated:"ع", initial:"عـ", medial:"ـعـ", final:"ـع", makhraj:"Gorge", tip:"Pharyngale sonore. Constriction pharyngale, son vocalique profond." },
  { letter:"غ", name:"Ghayn",trans:"gh",isolated:"غ", initial:"غـ", medial:"ـغـ", final:"ـغ", makhraj:"Gorge", tip:"Uvulaire fricative sonore. Comme un 'r' parisien ou guttural." },
  { letter:"ف", name:"Fa",  trans:"f",  isolated:"ف", initial:"فـ", medial:"ـفـ", final:"ـف", makhraj:"Lèvres+dents", tip:"Labiodentale sourde. Identique au 'f' français." },
  { letter:"ق", name:"Qaf", trans:"q",  isolated:"ق", initial:"قـ", medial:"ـقـ", final:"ـق", makhraj:"Gorge", tip:"Occlusive uvulaire sourde. Plus en arrière que 'k', depuis la luette." },
  { letter:"ك", name:"Kaf", trans:"k",  isolated:"ك", initial:"كـ", medial:"ـكـ", final:"ـك", makhraj:"Palais", tip:"Vélaire sourde. Identique au 'k' français." },
  { letter:"ل", name:"Lam", trans:"l",  isolated:"ل", initial:"لـ", medial:"ـلـ", final:"ـل", makhraj:"Langue", tip:"Latérale alvéolaire. Identique au 'l' français mais plus clair." },
  { letter:"م", name:"Mîm", trans:"m",  isolated:"م", initial:"مـ", medial:"ـمـ", final:"ـم", makhraj:"Lèvres", tip:"Nasale bi-labiale. Identique au 'm' français." },
  { letter:"ن", name:"Nûn", trans:"n",  isolated:"ن", initial:"نـ", medial:"ـنـ", final:"ـن", makhraj:"Langue", tip:"Nasale alvéolaire. Identique au 'n' français." },
  { letter:"ه", name:"Ha",  trans:"h",  isolated:"ه", initial:"هـ", medial:"ـهـ", final:"ـه", makhraj:"Gorge", tip:"Glottale. Souffle doux depuis la gorge, comme un soupir." },
  { letter:"و", name:"Waw", trans:"w/û",isolated:"و", initial:"وـ", medial:"ـوـ", final:"ـو", makhraj:"Lèvres", tip:"Semi-consonne ou voyelle longue 'OU'. Lèvres arrondies." },
  { letter:"ي", name:"Ya",  trans:"y/î",isolated:"ي", initial:"يـ", medial:"ـيـ", final:"ـي", makhraj:"Palais", tip:"Semi-consonne ou voyelle longue 'I'. Palais antérieur." },
  { letter:"ا", name:"Alif",trans:"â/ā",isolated:"ا", initial:"اـ", medial:"ـاـ", final:"ـا", makhraj:"Gorge", tip:"Voyelle longue 'A' ou support de hamza. Ouverte centrale." },
  { letter:"أ", name:"Hamza",trans:"ʾ", isolated:"أ", initial:"أـ", medial:"ـأـ", final:"ـأ", makhraj:"Gorge", tip:"Occlusive glottale. Coupure de la voix, comme dans 'oh oh!'." },
];

const HARAKATS = [
  { arabic:"بَ", name:"Fatḥa",     sign:"َ",  desc:"Voyelle courte A",    color:"var(--gold2)",  synth:"ba" },
  { arabic:"بِ", name:"Kasra",     sign:"ِ",  desc:"Voyelle courte I",    color:"var(--teal2)",  synth:"bi" },
  { arabic:"بُ", name:"Ḍamma",     sign:"ُ",  desc:"Voyelle courte OU",   color:"var(--green2)", synth:"bou" },
  { arabic:"بْ", name:"Soukoun",   sign:"ْ",  desc:"Consonne sans voyelle",color:"var(--text2)",  synth:"b" },
  { arabic:"بّ", name:"Chadda",    sign:"ّ",  desc:"Consonne doublée",    color:"var(--red)",    synth:"bb" },
  { arabic:"بً", name:"Tanwîn Fatḥ",sign:"ً",desc:"AN final (indéfini)",  color:"var(--gold)",   synth:"ban" },
  { arabic:"بٍ", name:"Tanwîn Kasr",sign:"ٍ",desc:"IN final (indéfini)",  color:"var(--teal)",   synth:"bin" },
  { arabic:"بٌ", name:"Tanwîn Ḍamm",sign:"ٌ",desc:"OUN final (indéfini)", color:"var(--green)",  synth:"boun" },
  { arabic:"آ",  name:"Madda",     sign:"ٓ",  desc:"Alif avec allongement",color:"var(--gold3)",  synth:"aa" },
];

function PrononciationPage() {
  const [tab, setTab]           = useState("lettres"); // lettres | harakat | tajwid
  const [selected, setSelected] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const synthRef = useRef(null);

  const speak = (text, id, lang = "ar-SA") => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang;
    utt.rate = 0.6;
    utt.pitch = 1;
    setPlayingId(id);
    utt.onend  = () => setPlayingId(null);
    utt.onerror= () => setPlayingId(null);
    synthRef.current = utt;
    window.speechSynthesis.speak(utt);
  };

  const stopSpeak = () => {
    window.speechSynthesis?.cancel();
    setPlayingId(null);
  };

  const sel = selected !== null ? ARABIC_LETTERS[selected] : null;

  return (
    <main className="main" style={{background:"var(--bg)"}}>
      <div style={{padding:"14px 28px 0",borderBottom:"1px solid var(--border)",flexShrink:0,display:"flex",alignItems:"center",gap:12,background:"linear-gradient(180deg,var(--surface),var(--bg))"}}>
        <div style={{fontFamily:"'Amiri Quran',serif",fontSize:22,color:"var(--gold)",direction:"rtl",opacity:.8}}>الحروف العربية</div>
        <div style={{flex:1}}/>
        <div style={{fontSize:9,letterSpacing:2,color:"var(--text3)"}}>CLIQUEZ · ÉCOUTEZ · PRATIQUEZ</div>
      </div>

      <div style={{padding:"0 28px",borderBottom:"1px solid var(--border)",flexShrink:0,background:"var(--surface)"}}>
        <div className="pronon-nav-tabs">
          {[["lettres","🔤 LETTRES"],["harakat","◌ VOYELLES & SIGNES"],["tajwid","📚 TAJWID"]].map(([k,label])=>(
            <button key={k} className={`pronon-nav-tab${tab===k?" active":""}`} onClick={()=>{setTab(k);setSelected(null);stopSpeak();}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pronon-page">
        {/* ── LETTRES TAB ── */}
        {tab==="lettres" && (
          <div className="pronon-two-col">
            <div>
              <div className="pronon-section-title">LES 29 LETTRES DE L'ALPHABET ARABE</div>
              <div className="pronon-grid">
                {ARABIC_LETTERS.map((l, i) => (
                  <div key={i}
                    className={`pronon-card${selected===i?" selected":""}${playingId===`letter-${i}`?" playing":""}`}
                    onClick={() => { setSelected(i); speak(l.letter, `letter-${i}`); }}>
                    <div className="pronon-letter">{l.letter}</div>
                    <div className="pronon-letter-name">{l.name.toUpperCase()}</div>
                    <div className="pronon-letter-trans">/{l.trans}/</div>
                    {playingId===`letter-${i}` && (
                      <div style={{position:"absolute",top:6,right:6,width:6,height:6,borderRadius:"50%",background:"var(--teal)",animation:"pulse-dot 1s infinite"}}/>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              {sel ? (
                <div className="pronon-detail-panel">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div className="pronon-makhraj-tag">📍 {sel.makhraj}</div>
                    <button
                      className={`pronon-play-btn${playingId===`letter-${selected}`?" playing":""}`}
                      onClick={()=>playingId===`letter-${selected}`?stopSpeak():speak(sel.letter,`letter-${selected}`)}>
                      {playingId===`letter-${selected}`?"⏹ STOP":"▶ ÉCOUTER"}
                    </button>
                  </div>
                  <div className="pronon-detail-letter">{sel.letter}</div>
                  <div className="pronon-detail-name">{sel.name.toUpperCase()} · /{sel.trans}/</div>

                  <div className="pronon-section-title" style={{marginBottom:8}}>FORMES SELON LA POSITION</div>
                  <div className="pronon-detail-forms">
                    {[["Isolée",sel.isolated],["Initiale",sel.initial],["Médiane",sel.medial],["Finale",sel.final]].map(([pos,form])=>(
                      <div key={pos} className="pronon-form-item"
                        onClick={()=>speak(form,`form-${pos}`)}>
                        <div className="pronon-form-arabic">{form}</div>
                        <div className="pronon-form-label">{pos.toUpperCase()}</div>
                      </div>
                    ))}
                  </div>

                  <div className="pronon-section-title" style={{marginBottom:8}}>AVEC VOYELLES</div>
                  <div className="pronon-detail-harakats">
                    {HARAKATS.slice(0,4).map((h, hi) => {
                      const withH = sel.letter + h.sign;
                      const pid = `detail-h-${selected}-${hi}`;
                      return (
                        <div key={hi} className={`pronon-detail-hbtn${playingId===pid?" playing":""}`}
                          onClick={()=>speak(withH, pid)}>
                          <div className="pronon-detail-hbtn-arabic">{withH}</div>
                          <div className="pronon-detail-hbtn-name">{h.name.toUpperCase()}</div>
                          <div className="pronon-detail-hbtn-desc">{h.desc}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pronon-tip-box">
                    💡 <strong>Articulation :</strong> {sel.tip}
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"300px",gap:16,color:"var(--text3)"}}>
                  <div style={{fontFamily:"'Amiri Quran',serif",fontSize:48,opacity:.3,direction:"rtl"}}>ب ت ث</div>
                  <div style={{fontSize:10,letterSpacing:2}}>CLIQUEZ SUR UNE LETTRE</div>
                  <div style={{fontSize:9,letterSpacing:1,color:"var(--text3)",opacity:.7}}>POUR VOIR LES DÉTAILS ET ÉCOUTER</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── HARAKAT TAB ── */}
        {tab==="harakat" && (
          <>
            <div>
              <div className="pronon-section-title">VOYELLES COURTES (حَرَكَات)</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
                {HARAKATS.map((h, hi) => (
                  <div key={hi}
                    className={`pronon-harakat-btn${playingId===`harak-${hi}`?" playing":""}`}
                    onClick={()=>speak(h.arabic,`harak-${hi}`)}>
                    <div className="pronon-harakat-arabic" style={{color:h.color}}>{h.arabic}</div>
                    <div className="pronon-harakat-name">{h.name.toUpperCase()}</div>
                    <div className="pronon-harakat-desc">{h.desc}</div>
                    {playingId===`harak-${hi}` && <div style={{fontSize:8,color:"var(--teal)",letterSpacing:1,marginTop:2}}>▶ EN COURS</div>}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="pronon-section-title">ENTRAÎNEMENT AVEC ب (Ba)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                {HARAKATS.map((h, hi) => {
                  const pid = `train-${hi}`;
                  return (
                    <div key={hi}
                      style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"14px 18px",
                        background:playingId===pid?"rgba(62,184,160,.08)":"var(--surface2)",
                        border:`1px solid ${playingId===pid?"var(--teal)":"var(--border)"}`,
                        borderRadius:10,cursor:"pointer",transition:"all .2s",minWidth:90}}
                      onClick={()=>speak("ب"+h.sign,"train-"+hi)}>
                      <div style={{fontFamily:"'Amiri Quran',serif",fontSize:34,color:h.color,direction:"rtl"}}>{"ب"+h.sign}</div>
                      <div style={{fontSize:8,letterSpacing:1,color:"var(--text3)",fontFamily:"'Cinzel',serif"}}>{h.name.toUpperCase()}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="pronon-section-title">VOYELLES LONGUES (حُرُوف الْمَدّ)</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                {[
                  {arabic:"بَا", name:"Alif + Fatḥa", desc:"Son 'Â' long (ex: كَافِرُون)", color:"var(--gold2)", synth:"بَا"},
                  {arabic:"بِي", name:"Ya + Kasra",   desc:"Son 'Î' long (ex: كِيلَ)", color:"var(--teal2)", synth:"بِي"},
                  {arabic:"بُو", name:"Waw + Ḍamma",  desc:"Son 'Û' long (ex: نُوحٌ)", color:"var(--green2)", synth:"بُو"},
                ].map((v,vi)=>(
                  <div key={vi}
                    style={{flex:"1 1 140px",display:"flex",flexDirection:"column",alignItems:"center",gap:8,
                      padding:"18px",background:"var(--surface2)",border:`1px solid ${playingId===`long-${vi}`?"var(--teal)":"var(--border)"}`,
                      borderRadius:10,cursor:"pointer",transition:"all .2s"}}
                    onClick={()=>speak(v.synth,`long-${vi}`)}>
                    <div style={{fontFamily:"'Amiri Quran',serif",fontSize:36,color:v.color,direction:"rtl"}}>{v.arabic}</div>
                    <div style={{fontSize:9,letterSpacing:1.5,color:"var(--text2)",fontFamily:"'Cinzel',serif"}}>{v.name.toUpperCase()}</div>
                    <div style={{fontSize:9,color:"var(--text3)",textAlign:"center"}}>{v.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── TAJWID TAB ── */}
        {tab==="tajwid" && (
          <>
            <div>
              <div className="pronon-section-title">RÈGLES DE BASE DU TAJWID (تجويد)</div>
              {[
                {name:"NUN SAKIN & TANWÎN — Iẓhâr (إظهار)",arabic:"أَنْعَمْتَ",desc:"Prononciation claire du Nûn quand il est suivi de ء ه ع غ ح خ. On entend le 'n' distinctement.", color:"var(--gold)"},
                {name:"NUN SAKIN & TANWÎN — Idghâm (إدغام)",arabic:"مَنْ يَعْمَلُ",desc:"Fusion du Nûn dans la lettre suivante (ي ن م و ل ر). Le 'n' disparaît dans la consonne suivante.", color:"var(--teal)"},
                {name:"NUN SAKIN & TANWÎN — Iqlab (إقلاب)",arabic:"أَنْبِيَاء",desc:"Transformation du Nûn en Mîm nasale devant la lettre ب. 'nb' devient 'm' nasal.", color:"var(--green)"},
                {name:"NUN SAKIN & TANWÎN — Ikhfâ (إخفاء)",arabic:"مَنْ كَانَ",desc:"Nasalisation partielle du Nûn devant 15 lettres. Son intermédiaire entre Iẓhâr et Idghâm.", color:"var(--gold2)"},
                {name:"MADD — Allongement naturel (مَدّ طَبِيعِي)",arabic:"قَالَ",desc:"Allongement de 2 temps sur ا و ي quand précédé de sa voyelle correspondante.", color:"var(--teal2)"},
                {name:"MADD — Allongement obligatoire (مَدّ وَاجِب)",arabic:"جَاءَ",desc:"Allongement de 4-5 temps quand les lettres de madd sont suivies d'une hamza dans le même mot.", color:"var(--gold3)"},
                {name:"QALQALAH (قَلْقَلَة)",arabic:"يَقْطَعُ",desc:"Légère vibration sur les lettres ق ط ب ج د portant un soukoun. Son rebondissant.", color:"var(--red)"},
              ].map((rule,ri)=>(
                <div key={ri} style={{marginBottom:12,padding:"14px 18px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,borderLeft:`3px solid ${rule.color}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:9,letterSpacing:1.5,color:rule.color,flex:1}}>{rule.name}</div>
                    <div
                      style={{fontFamily:"'Amiri Quran',serif",fontSize:22,color:"var(--gold2)",direction:"rtl",cursor:"pointer",padding:"4px 10px",background:playingId===`tajwid-${ri}`?"rgba(62,184,160,.1)":"var(--surface3)",borderRadius:6,border:`1px solid ${playingId===`tajwid-${ri}`?"var(--teal)":"var(--border2)"}`}}
                      onClick={()=>speak(rule.arabic,`tajwid-${ri}`)}>
                      {rule.arabic}
                    </div>
                  </div>
                  <div style={{fontSize:10,color:"var(--text2)",lineHeight:1.6}}>{rule.desc}</div>
                </div>
              ))}
            </div>

            <div className="pronon-tip-box" style={{marginTop:4}}>
              🎓 <strong>Conseil :</strong> Cliquez sur les exemples arabes pour les entendre. Pour une maîtrise complète du tajwid, pratiquez avec un récitateur qualifié et utilisez la page Coran pour écouter Al-Afasy.
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ─── AYAT COLLECTIONS TAB (inside submenu) ───────────────────────────────────
function AyatCollectionsTab({ surahNum, ayatNum, collections, ayatInCollections, onOpenModal }) {
  const inColls = collections.filter(c => ayatInCollections?.includes(c.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--text3)", flex: 1 }}>
          {inColls.length === 0 ? "CET AYAT N'EST DANS AUCUNE COLLECTION" : `DANS ${inColls.length} COLLECTION${inColls.length > 1 ? "S" : ""}`}
        </div>
        <button className="btn-primary" onClick={onOpenModal}>🗂 GÉRER LES COLLECTIONS</button>
      </div>
      {inColls.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {inColls.map(c => (
            <div key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(200,120,255,.4)", background: "rgba(200,120,255,.08)", fontSize: 9, letterSpacing: 1, color: "#c878ff" }}>
              🗂 {c.name}
            </div>
          ))}
        </div>
      )}
      {collections.length === 0 && (
        <div style={{ fontSize: 9, color: "var(--text3)", letterSpacing: 1, padding: "4px 0" }}>
          Aucune collection — créez-en une depuis la page COLLECTIONS ou en cliquant sur GÉRER
        </div>
      )}
    </div>
  );
}

// ─── COLLECTION MODAL ─────────────────────────────────────────────────────────
function CollectionModal({ ayat, collections, onToggle, onCreateAndAdd, onClose }) {
  const [newName, setNewName] = useState("");
  const key = `${ayat.surahNum}:${ayat.ayatNum}`;

  const isInColl = (c) => c.ayats.some(a => `${a.surahNum}:${a.ayatNum}` === key);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateAndAdd(newName);
    setNewName("");
  };

  return (
    <div className="coll-modal-overlay" onClick={onClose}>
      <div className="coll-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="coll-modal-title">AJOUTER AUX COLLECTIONS</div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <div className="coll-modal-subtitle">{ayat.text?.slice(0, 80)}{ayat.text?.length > 80 ? "…" : ""}</div>
        <div style={{ fontSize: 9, letterSpacing: 1, color: "var(--text3)" }}>
          {ayat.surahEn?.toUpperCase()} · AYAT {ayat.ayatNum}
        </div>

        {collections.length === 0 ? (
          <div style={{ fontSize: 10, color: "var(--text3)", letterSpacing: 1, textAlign: "center", padding: "8px 0" }}>
            Aucune collection — créez-en une ci-dessous
          </div>
        ) : (
          <div className="coll-modal-list">
            {collections.map(c => (
              <div key={c.id} className={`coll-modal-item${isInColl(c) ? " selected" : ""}`}
                onClick={() => onToggle(c.id, ayat)}>
                <div className="coll-modal-check">{isInColl(c) ? "✓" : ""}</div>
                <div className="coll-modal-item-name">{c.name}</div>
                <div className="coll-modal-item-count">{c.ayats.length} ayat{c.ayats.length > 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>
        )}

        <div className="coll-modal-new">
          <input
            className="coll-input" placeholder="NOUVELLE COLLECTION..."
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={handleCreate} disabled={!newName.trim()}>+ CRÉER</button>
        </div>

        <div className="coll-modal-actions">
          <button className="btn-primary active" onClick={onClose}>FERMER</button>
        </div>
      </div>
    </div>
  );
}

// ─── COLLECTIONS PAGE ─────────────────────────────────────────────────────────
// CollectionAyatRow: renders a single collection ayat exactly like the Quran page
function CollectionAyatRow({ entry, collId, learnData, setLData, onToggleAyat, onOpenCollModal, ayatInCollectionsFn, collections, showQalqala, showMadd, showIzhar, showIdgham }) {
  const [isOpen, setIsOpen]           = useState(false);
  const [submenuMode, setSubmenuMode] = useState("lecture");
  const [partSelectStep, setPartSelectStep]   = useState(null);
  const [partSelectStart, setPartSelectStart] = useState(null);
  const [isSelecting, setIsSelecting]         = useState(false);
  const [localPlaying, setLocalPlaying]       = useState(null);
  const [playingPart, setPlayingPart]         = useState(null);
  const [partCurrentMs, setPartCurrentMs]     = useState(0);
  const audioRef    = useRef(null);
  const partAudioRef= useRef(null);
  const partRafRef  = useRef(null);

  const audioUrl = `${getAudioBase()}/${entry.number}.mp3`;
  const ld = learnData[`${entry.surahNum}:${entry.ayatNum}`] || { learned: false, readCount: 0, parts: [], wordsLearned: {} };

  const stopPartRaf = () => { if (partRafRef.current) { cancelAnimationFrame(partRafRef.current); partRafRef.current = null; } };
  const startPartRaf = () => {
    stopPartRaf();
    const tick = () => {
      if (partAudioRef.current) setPartCurrentMs(partAudioRef.current.currentTime * 1000);
      partRafRef.current = requestAnimationFrame(tick);
    };
    partRafRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => stopPartRaf(), []);

  const PART_COLORS  = ["rgba(201,168,76,.22)","rgba(62,184,160,.18)","rgba(111,207,154,.18)","rgba(224,90,90,.15)","rgba(200,120,255,.15)"];
  const PART_BORDERS = ["var(--gold)","var(--teal)","var(--green)","var(--red)","#c878ff"];
  const wordPartMap  = {};
  (ld.parts || []).forEach((p, pi) => p.wordIndices?.forEach(wi => { wordPartMap[wi] = pi; }));
  const wordsInParts = new Set(Object.keys(wordPartMap).map(Number));
  const nextAvail    = wordsInParts.size > 0 ? Math.max(...wordsInParts) + 1 : 0;
  const ayatWords    = entry.text ? entry.text.split(" ").filter(Boolean) : [];

  const playPartInline = (part) => {
    const url = audioUrl;
    if (!url || !part.wordIndices?.length) return;
    const audio = partAudioRef.current;
    if (!audio) return;
    if (playingPart?.partId === part.id) {
      audio.pause(); setPlayingPart(null); setPartCurrentMs(0); stopPartRaf(); return;
    }
    audio.src = url;
    const startMs = 0; const endMs = 999999; // no timestamps in collection view
    audio.currentTime = 0;
    audio.play().catch(() => {});
    setPlayingPart({ partId: part.id });
    startPartRaf();
  };

  const handleInlineWordClick = (e, wi) => {
    e.stopPropagation();
    if (!isSelecting) return;
    if (partSelectStep === 'start') {
      if (wi < nextAvail) return;
      setPartSelectStart(wi);
      setPartSelectStep('end');
    } else if (partSelectStep === 'end') {
      if (partSelectStart === null) return;
      const from = Math.min(partSelectStart, wi);
      const to   = Math.max(partSelectStart, wi);
      const clampedFrom = Math.max(from, nextAvail);
      const indices = []; for (let i = clampedFrom; i <= to; i++) indices.push(i);
      if (indices.length === 0) return;
      setLData(entry.surahNum, entry.ayatNum, d => ({
        ...d, parts: [...(d.parts || []), { id: Date.now(), wordIndices: indices, text: indices.map(i => ayatWords[i]).join(" "), learned: !!d.learned }]
      }));
      const newNext = to + 1;
      if (newNext < ayatWords.length) { setPartSelectStart(null); setPartSelectStep('start'); }
      else { setIsSelecting(false); setPartSelectStep(null); setPartSelectStart(null); }
    }
  };

  const renderAyatText = () => {
    const showWordButtons = isSelecting;
    const showPartColors  = !isSelecting && showParts && Object.keys(wordPartMap).length > 0;

    if (showWordButtons) {
      return (
        <div className="ayat-arabic" style={{ cursor: "default" }}>
          {ayatWords.map((w, wi) => {
            const inExistingPart = wordsInParts.has(wi);
            const pi = wordPartMap[wi];
            const isLearned = pi !== undefined && (ld.parts || [])[pi]?.learned;
            const isPast    = wi < nextAvail;
            const isStart   = partSelectStep === 'end' && wi === partSelectStart;
            let bg = "transparent", border = "var(--border)", color = "var(--text2)", cursor = "pointer";
            if (isPast || inExistingPart) {
              bg = isLearned ? "rgba(76,175,129,.15)" : PART_COLORS[pi % PART_COLORS.length] ?? "rgba(62,184,160,.1)";
              border = isLearned ? "var(--green)" : PART_BORDERS[pi % PART_BORDERS.length] ?? "var(--teal)";
              color = "var(--text2)"; cursor = "default";
            } else if (isStart) {
              bg = "rgba(201,168,76,.25)"; border = "var(--gold2)"; color = "var(--gold2)";
            } else if (partSelectStep === 'start') {
              bg = "rgba(201,168,76,.04)"; border = "rgba(201,168,76,.5)"; color = "var(--gold)";
            } else {
              bg = "rgba(62,184,160,.05)"; border = "rgba(62,184,160,.5)"; color = "var(--teal2)";
            }
            return (
              <span key={wi} onClick={e => handleInlineWordClick(e, wi)} style={{
                display:"inline-block",margin:"2px 3px",padding:"2px 5px",borderRadius:5,
                border:`1px solid ${border}`,background:bg,color,cursor,transition:"all .12s",
                fontFamily:"'Amiri Quran',serif",
              }}>{w}</span>
            );
          })}
        </div>
      );
    }
    if (showPartColors) {
      const segments = [];
      let cur = null;
      ayatWords.forEach((w, wi) => {
        const pi = wordPartMap[wi];
        if (cur && cur.pi === pi) { cur.words.push(w); cur.indices.push(wi); }
        else { cur = { pi, words: [w], indices: [wi] }; segments.push(cur); }
      });
      return (
        <div className="ayat-arabic">
          {segments.map((seg, si) => {
            if (seg.pi === undefined) return <span key={si}>{seg.words.join(" ")} </span>;
            const part = (ld.parts || [])[seg.pi];
            const isLearned = part?.learned;
            const isThisPartPlaying = playingPart?.partId === part?.id;
            return (
              <span key={si}
                onClick={e => { e.stopPropagation(); if (part) playPartInline(part); }}
                style={{
                  display:"inline-block",background:isThisPartPlaying?"rgba(62,184,160,.28)":isLearned?"rgba(76,175,129,.18)":PART_COLORS[seg.pi % PART_COLORS.length],
                  borderRadius:5,padding:"1px 6px",margin:"2px 2px",
                  outline:`1px solid ${isThisPartPlaying?"var(--teal2)":isLearned?"var(--green)":PART_BORDERS[seg.pi % PART_BORDERS.length]}`,
                  cursor:"pointer",transition:"all .15s",
                }}>{seg.words.join(" ")}</span>
            );
          })}
        </div>
      );
    }
    return (
      <div className="ayat-arabic">
        {(showQalqala || showMadd)
          ? (() => { const arr = [...entry.text]; return arr.map((ch, i) => {
              const q = showQalqala && isQalqala(arr, i);
              const mt = showMadd ? getMaddType(arr, i) : null;
              const iz = showIzhar && isIzhar(arr, i);
              const id = showIdgham && isIdgham(arr, i);
              return q ? <span key={i} style={{color:'#5bc8f5',textShadow:'0 0 6px rgba(91,200,245,.5)'}}>{ch}</span>
                   : mt==='muttasil' ? <span key={i} style={{color:'#ff7eb3',textShadow:'0 0 8px rgba(255,126,179,.6)',fontWeight:600}}>{ch}</span>
                   : mt==='normal'   ? <span key={i} style={{color:'#f09de0',textShadow:'0 0 6px rgba(240,157,224,.5)'}}>{ch}</span>
                   : iz              ? <span key={i} style={{color:'#4caf81',textShadow:'0 0 6px rgba(76,175,129,.5)'}}>{ch}</span>
                   : id              ? <span key={i} style={{color:'#ffd166',textShadow:'0 0 6px rgba(255,209,102,.5)'}}>{ch}</span>
                   : <span key={i}>{ch}</span>;
            }); })()
          : entry.text}
      </div>
    );
  };

  const inCollIds = ayatInCollectionsFn ? ayatInCollectionsFn(entry.surahNum, entry.ayatNum) : [];
  const surahInfo = SURAH_INFO.find(s => s.n === entry.surahNum);

  return (
    <div
      className={`ayat-row${ld.learned ? " learned" : ""}${isSelecting ? " selecting" : ""}`}
      style={isSelecting ? { borderLeft: "2px solid var(--gold)", background: "rgba(201,168,76,0.04)" } : {}}
    >
      <audio ref={partAudioRef} style={{ display: "none" }}
        onEnded={() => { setTimeout(() => { setPlayingPart(null); setPartCurrentMs(0); stopPartRaf(); }, 250); }} />

      {/* Selection hint */}
      {isSelecting && (
        <div style={{ display:"flex",alignItems:"center",gap:10,padding:"6px 22px 2px",background:"rgba(201,168,76,.05)" }}>
          <span style={{ fontSize:9,letterSpacing:1.5,color:partSelectStep==='start'?"var(--gold2)":"var(--teal2)",fontFamily:"'Cinzel',serif" }}>
            {partSelectStep==='start' ? "① CLIQUEZ LE PREMIER MOT" : `② CLIQUEZ LE DERNIER MOT — début : `}
            {partSelectStep==='end' && partSelectStart !== null && (
              <span style={{ fontFamily:"'Amiri Quran',serif",fontSize:15,color:"var(--gold2)",marginRight:4 }}>{ayatWords[partSelectStart]}</span>
            )}
          </span>
          <button onClick={e => { e.stopPropagation(); setIsSelecting(false); setPartSelectStep(null); setPartSelectStart(null); }}
            style={{ marginLeft:"auto",fontSize:9,letterSpacing:1,padding:"3px 8px",border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",cursor:"pointer",borderRadius:4,fontFamily:"'Cinzel',serif" }}>
            ANNULER
          </button>
        </div>
      )}

      <div className={`ayat-main${ld.learned ? "" : ""}`}
        onClick={() => { if (isSelecting) return; setIsOpen(o => !o); if (!isOpen) setSubmenuMode("lecture"); }}>
        {/* Left: surah badge + ayat number */}
        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3,flexShrink:0 }}>
          <div style={{ fontSize:7,letterSpacing:.5,color:"var(--text3)",textAlign:"center",maxWidth:36,lineHeight:1.2 }}>
            {surahInfo?.en?.slice(0,6) || `S${entry.surahNum}`}
          </div>
          <div className="ayat-number-badge">{entry.ayatNum}</div>
        </div>
        {renderAyatText()}
        <div style={{ display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end",flexShrink:0 }}>
          {ld.learned && <div className="ayat-learned-badge">✓ APPRIS</div>}
        </div>
      </div>

      {isOpen && (
        <Submenu
          ayat={{ numberInSurah: entry.ayatNum, text: entry.text, number: entry.number }}
          surahNum={entry.surahNum}
          ld={ld}
          setLData={setLData}
          submenuMode={submenuMode}
          setSubmenuMode={setSubmenuMode}
          audioUrl={audioUrl}
          isMainPlaying={false}
          timestamps={null}
          onLoadTimestamps={() => {}}
          onUpdateTimestamps={() => {}}
          onLocalPlay={(ms) => setLocalPlaying(ms != null ? { currentMs: ms } : null)}
          partSelectAyat={isSelecting ? entry.ayatNum : null}
          partSelectStep={partSelectStep}
          onStartPartCreate={() => { setIsSelecting(true); setPartSelectStep('start'); setPartSelectStart(null); }}
          collections={collections}
          ayatInCollections={inCollIds}
          onOpenCollModal={() => onOpenCollModal({ surahNum: entry.surahNum, surahEn: surahInfo?.en || `Sourate ${entry.surahNum}`, ayatNum: entry.ayatNum, text: entry.text, number: entry.number })}
        />
      )}
    </div>
  );
}

function CollectionsPage({ collections, learnData, setLData, onCreateCollection, onDeleteCollection, onToggleAyat, onOpenCollModal, ayatInCollectionsFn, surahs, onNavigate, showQalqala, showMadd, showIzhar, showIdgham, initialSearchQuery, onConsumeSearchQuery }) {
  const [newName, setNewName]   = useState("");
  const [openId, setOpenId]     = useState(null);
  const searchQuerySnapshot     = useRef(initialSearchQuery || "").current;
  const [tab, setTab]           = useState(searchQuerySnapshot ? "search" : "collections");

  // Arriving here via "Rechercher la sélection" — jump straight to the search tab
  useEffect(() => {
    if (searchQuerySnapshot) onConsumeSearchQuery?.();
  }, []); // eslint-disable-line
  const [searchQ, setSearchQ]   = useState("");
  const [searchMode, setSearchMode] = useState("ayat"); // "ayat" | "page" | "hizb"
  const [metaCache, setMetaCache]   = useState({});     // key "s:a" → {page, hizbQuarter}
  const [metaLoading, setMetaLoading] = useState(false);
  const [partGroupSurah, setPartGroupSurah] = useState("all"); // "all" | surahNum

  // Collect all unique ayats across collections
  const allEntries = useMemo(() => {
    const seen = new Set();
    const arr = [];
    collections.forEach(coll => {
      coll.ayats.forEach(a => {
        const k = `${a.surahNum}:${a.ayatNum}`;
        if (!seen.has(k)) { seen.add(k); arr.push(a); }
      });
    });
    return arr;
  }, [collections]);

  // Fetch page/hizb metadata for all ayats when switching to search
  useEffect(() => {
    if (tab !== "nav") return;
    const missing = allEntries.filter(a => !metaCache[`${a.surahNum}:${a.ayatNum}`]);
    if (missing.length === 0) return;
    setMetaLoading(true);
    // Batch: fetch per surah then map
    const bySurah = {};
    missing.forEach(a => { if (!bySurah[a.surahNum]) bySurah[a.surahNum] = []; bySurah[a.surahNum].push(a.ayatNum); });
    const fetches = Object.entries(bySurah).map(([sn]) =>
      fetchSurahDefault(Number(sn)).then(ayahs => {
          const newMeta = {};
          ayahs.forEach(ay => {
            newMeta[`${sn}:${ay.numberInSurah}`] = { page: ay.page, hizbQuarter: ay.hizbQuarter };
          });
          return newMeta;
        }).catch(() => ({}))
    );
    Promise.all(fetches).then(results => {
      const merged = Object.assign({}, ...results);
      setMetaCache(c => ({ ...c, ...merged }));
      setMetaLoading(false);
    });
  }, [tab, allEntries.length]); // eslint-disable-line

  // Filter entries
  const filteredEntries = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return allEntries;
    const n = parseInt(q);
    return allEntries.filter(a => {
      const meta = metaCache[`${a.surahNum}:${a.ayatNum}`];
      if (searchMode === "ayat")  return a.ayatNum === n;
      if (searchMode === "page")  return meta?.page === n;
      if (searchMode === "hizb")  return meta?.hizbQuarter != null && Math.ceil(meta.hizbQuarter / 4) === n;
      return false;
    });
  }, [searchQ, searchMode, allEntries, metaCache]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateCollection(newName);
    setNewName("");
  };

  const totalAyats = collections.reduce((s, c) => s + c.ayats.length, 0);

  return (
    <main className="main" style={{ background:"var(--bg)", display:"flex", flexDirection:"column" }}>
      <div style={{ flexShrink:0, borderBottom:"1px solid var(--border)", background:"linear-gradient(180deg,var(--surface),var(--bg))" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 20px 0" }}>
          <div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:12, letterSpacing:3, color:"#c878ff" }}>COLLECTIONS &amp; RECHERCHE</div>
            <div style={{ fontSize:9, letterSpacing:1.5, color:"var(--text3)", marginTop:1 }}>
              {collections.length} COLL. · {totalAyats} AYAT{totalAyats!==1?"S":""}
            </div>
          </div>
          <div style={{ marginLeft:"auto", fontFamily:"'Amiri Quran',serif", fontSize:18, color:"#c878ff", opacity:.5, direction:"rtl" }}>مَجْمُوعَاتٌ</div>
        </div>
        <div style={{ display:"flex", paddingLeft:4 }}>
          {[["collections","🗂 COLLECTIONS"],["parties","🔗 PARTIES SIMILAIRES"],["nav","🔎 FILTRER COLLECTION"],["search","🔍 RECHERCHE CORAN"]].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              fontFamily:"'Cinzel',serif", fontSize:9, letterSpacing:1.5, padding:"7px 16px",
              background:"transparent", border:"none", cursor:"pointer", transition:"all .2s",
              borderBottom: tab===id ? "2px solid #c878ff" : "2px solid transparent",
              color: tab===id ? "#c878ff" : "var(--text3)",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "collections" && (
        <div className="collections-page">
          <div className="coll-top-bar">
            <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)", flexShrink:0 }}>NOUVELLE COLLECTION</div>
            <div className="coll-create-form">
              <input className="coll-input" placeholder="NOM DE LA COLLECTION..."
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key==="Enter" && handleCreate()} />
              <button className="btn-primary" onClick={handleCreate} disabled={!newName.trim()}>+ CRÉER</button>
            </div>
          </div>
          {collections.length === 0 && (
            <div className="coll-empty">
              <div className="coll-empty-arabic">مَجْمُوعَة</div>
              <div className="coll-empty-msg">
                CRÉEZ UNE COLLECTION CI-DESSUS<br/>
                AJOUTEZ DES AYATS DEPUIS LE CORAN<br/>
                OU VIA 🔍 RECHERCHE CORAN
              </div>
            </div>
          )}
          <div className="coll-list">
            {collections.map(coll => {
              const isOpen = openId === coll.id;
              return (
                <div key={coll.id} className="coll-card">
                  <div className="coll-card-header" onClick={() => setOpenId(isOpen ? null : coll.id)}>
                    <div className="coll-card-icon">🗂</div>
                    <div className="coll-card-name">{coll.name}</div>
                    <div className="coll-card-count">{coll.ayats.length} AYAT{coll.ayats.length!==1?"S":""}</div>
                    <div className="coll-card-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn-small" style={{ color:"var(--red)", borderColor:"var(--red)" }}
                        onClick={() => { if(window.confirm(`Supprimer "${coll.name}" ?`)) onDeleteCollection(coll.id); }}>✕</button>
                    </div>
                    <div className={`coll-card-chevron${isOpen?" open":""}`}>▶</div>
                  </div>
                  {isOpen && (
                    <div className="coll-ayat-list" style={{ padding:0 }}>
                      {coll.ayats.length === 0 && (
                        <div style={{ padding:"16px 18px", fontSize:10, color:"var(--text3)", letterSpacing:1 }}>
                          AUCUN AYAT — ajoutez-en depuis le Coran ou via Recherche
                        </div>
                      )}
                      {coll.ayats.map(a => (
                        <CollectionAyatRow
                          key={`${a.surahNum}-${a.ayatNum}`}
                          entry={a} collId={coll.id}
                          learnData={learnData} setLData={setLData}
                          onToggleAyat={onToggleAyat} onOpenCollModal={onOpenCollModal}
                          ayatInCollectionsFn={ayatInCollectionsFn} collections={collections}
                          showQalqala={showQalqala}
                          showMadd={showMadd}
                          showIzhar={showIzhar}
                          showIdgham={showIdgham}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "parties" && (() => {
        // Build groups of ayats that share the same part text (normalized)
        const _normP = s => s?.trim().replace(/[\u064B-\u065F\u0670]/g,'').replace(/أ|إ|آ/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي') || '';
        // Gather all (surahNum, ayatNum, part) from learnData
        const entries = [];
        for (const [key, ld] of Object.entries(learnData)) {
          if (!ld?.parts?.length) continue;
          const [sn, an] = key.split(':').map(Number);
          if (partGroupSurah !== "all" && sn !== Number(partGroupSurah)) continue;
          ld.parts.forEach((p, pi) => {
            if (p.text) entries.push({ sn, an, pi, partText: p.text, normText: _normP(p.text) });
          });
        }
        // Group by normalized text
        const groups = {};
        entries.forEach(e => {
          if (!groups[e.normText]) groups[e.normText] = { text: e.partText, items: [] };
          groups[e.normText].items.push(e);
        });
        // Only keep groups with 2+ entries
        const multiGroups = Object.values(groups).filter(g => g.items.length >= 2).sort((a,b) => b.items.length - a.items.length);
        const surahNums = [...new Set(Object.keys(learnData).map(k => parseInt(k.split(':')[0])))].filter(Boolean).sort((a,b)=>a-b);

        return (
          <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:12, overflowY:'auto' }}>
            {/* Filter by surah */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>SOURATE :</span>
              {[{ val:'all', label:'TOUTES' }, ...surahNums.map(n => ({ val:String(n), label:`S.${n}` }))].map(({ val, label }) => (
                <button key={val} onClick={() => setPartGroupSurah(val)} style={{
                  fontSize:8, letterSpacing:1, padding:'3px 10px', borderRadius:5, cursor:'pointer',
                  fontFamily:"'Cinzel',serif",
                  background: partGroupSurah===val ? 'rgba(200,120,255,.15)' : 'transparent',
                  border:`1px solid ${partGroupSurah===val ? '#c878ff' : 'rgba(255,255,255,.1)'}`,
                  color: partGroupSurah===val ? '#c878ff' : 'var(--text3)' }}>
                  {label}
                </button>
              ))}
            </div>

            {multiGroups.length === 0
              ? <div style={{ color:'var(--text3)', fontSize:9, letterSpacing:1, textAlign:'center', padding:'32px 0' }}>
                  Aucune partie partagée entre plusieurs ayats
                </div>
              : multiGroups.map((group, gi) => (
                <div key={gi} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
                  {/* Part text */}
                  <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', direction:'rtl',
                    fontFamily:"'Amiri Quran',serif", fontSize:18, color:'var(--gold2)',
                    background:'rgba(201,168,76,.05)', lineHeight:2 }}>
                    {group.text}
                  </div>
                  {/* Ayats sharing this part */}
                  <div style={{ padding:'8px 14px', display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                    <span style={{ fontSize:7, letterSpacing:1.5, color:'var(--text3)', fontFamily:"'Cinzel',serif", flexShrink:0 }}>
                      {group.items.length} AYAT{group.items.length>1?'S':''}
                    </span>
                    {group.items.map(({ sn, an, pi }) => {
                      const surah = surahs.find(s => s.number === sn);
                      return (
                        <button key={`${sn}:${an}:${pi}`}
                          onClick={() => onNavigate?.('quran', sn, an)}
                          style={{ fontSize:9, letterSpacing:1, padding:'4px 10px', borderRadius:6,
                            fontFamily:"'Cinzel',serif", cursor:'pointer',
                            background:'rgba(200,120,255,.08)', border:'1px solid rgba(200,120,255,.3)',
                            color:'#c878ff' }}>
                          {surah?.englishName || `S.${sn}`} · {an} <span style={{ fontSize:7, opacity:.6 }}>P.{pi+1}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            }
          </div>
        );
      })()}
      {tab === "nav" && (
        <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0 }}>
          <div className="coll-search-bar">
            <input className="coll-search-input" placeholder={searchMode==="ayat"?"N° AYAT":searchMode==="page"?"N° PAGE":"N° HIZB"}
              value={searchQ} onChange={e => setSearchQ(e.target.value)} type="number" min="1" />
            {[["ayat","AYAT"],["page","PAGE"],["hizb","HIZB"]].map(([m,l]) => (
              <button key={m} className={`coll-search-chip${searchMode===m?" active":""}`} onClick={() => { setSearchMode(m); setSearchQ(""); }}>{l}</button>
            ))}
          </div>
          {metaLoading && (
            <div style={{ padding:"12px 20px", fontSize:10, letterSpacing:1, color:"var(--text3)" }}>CHARGEMENT MÉTADONNÉES...</div>
          )}
          <div className="coll-search-results">
            {!searchQ.trim() && !metaLoading && (
              <div style={{ padding:"20px", fontSize:10, letterSpacing:1, color:"var(--text3)", textAlign:"center" }}>
                ENTREZ UN NUMÉRO POUR FILTRER LES {allEntries.length} AYATS DE VOS COLLECTIONS
              </div>
            )}
            {filteredEntries.map(a => {
              const meta = metaCache[`${a.surahNum}:${a.ayatNum}`];
              const surahInfo = SURAH_INFO.find(s => s.n === a.surahNum);
              const hizb = meta?.hizbQuarter != null ? Math.ceil(meta.hizbQuarter / 4) : null;
              return (
                <div key={`${a.surahNum}:${a.ayatNum}`} className="coll-search-result-item"
                  onClick={() => onNavigate(a.surahNum, a.ayatNum)}>
                  <div style={{ flexShrink:0, display:"flex", flexDirection:"column", gap:3, alignItems:"center", minWidth:40 }}>
                    <div style={{ width:32, height:32, border:"1px solid #c878ff", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#c878ff", fontFamily:"Cinzel,serif" }}>{a.ayatNum}</div>
                    {meta && <div style={{ fontSize:8, letterSpacing:1, color:"var(--text3)", textAlign:"center" }}>P.{meta.page}{hizb?` H${hizb}`:""}</div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="coll-search-meta">{surahInfo?.en || `S.${a.surahNum}`} · AYAT {a.ayatNum}</div>
                    <div className="coll-search-arabic">{a.text}</div>
                  </div>
                  {onOpenCollModal && (
                    <button style={{ flexShrink:0, padding:"4px 10px", fontSize:9, fontFamily:"Cinzel,serif", letterSpacing:1, background:"transparent", border:"1px solid #c878ff", color:"#c878ff", borderRadius:"var(--radius-sm)", cursor:"pointer" }}
                      onClick={e => { e.stopPropagation(); onOpenCollModal({ surahNum: a.surahNum, surahEn: surahInfo?.en||"", ayatNum: a.ayatNum, text: a.text, number: a.ayatNum }); }}>+ COLL</button>
                  )}
                </div>
              );
            })}
            {searchQ.trim() && filteredEntries.length === 0 && !metaLoading && (
              <div style={{ padding:"20px", fontSize:10, letterSpacing:1, color:"var(--text3)", textAlign:"center" }}>AUCUN AYAT TROUVÉ</div>
            )}
          </div>
        </div>
      )}

      {tab === "search" && (
        <ConcordancePage
          surahs={surahs} collections={collections}
          onOpenCollModal={onOpenCollModal}
          ayatInCollectionsFn={ayatInCollectionsFn}
          onNavigate={onNavigate}
          initialQuery={searchQuerySnapshot}
        />
      )}
    </main>
  );
}


// ─── InfoMode ─────────────────────────────────────────────────────────────────
const ARABIC_ROOTS = {
  'الله': 'Allah', 'رحمن': 'Miséricordieux', 'رحيم': 'Très Miséricordieux',
  'حمد': 'Louange', 'رب': 'Seigneur', 'عالم': 'Monde/Univers',
  'ملك': 'Roi/Maître', 'يوم': 'Jour', 'دين': 'Jugement/Religion',
  'عبد': 'Adorer/Serviteur', 'استعن': 'Implorer aide', 'هدي': 'Guide',
  'صراط': 'Chemin/Voie', 'مستقيم': 'Droit', 'نعم': 'Bienfait',
  'غضب': 'Colère', 'ضلل': 'Égaré', 'قلب': 'Cœur', 'نفس': 'Âme',
  'سمع': 'Entendre', 'بصر': 'Voir', 'علم': 'Savoir/Science',
  'كتب': 'Écriture/Livre', 'آمن': 'Croire', 'صلح': 'Bien/Vertu',
};
function stripDiacritics(s) {
  return s.replace(/[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/g, '');
}
function wordTranslit(w) {
  const clean = stripDiacritics(w);
  for (const [k,v] of Object.entries(ARABIC_ROOTS)) {
    if (clean.includes(k)) return v;
  }
  return null;
}
function calcDifficulty(text, ld) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const clean = stripDiacritics(text);
  const uniqueLetters = new Set([...clean].filter(c => c >= '\u0621' && c <= '\u064A')).size;
  const qCount = [...text].filter((c,i,a) => QALQALA_LETTERS.has(c) && (a[i+1]===SUKUN||i===a.length-1)).length;
  const hasMadd = MADD_MARK.size > 0 && [...text].some(c => MADD_MARK.has(c));
  let score = 0;
  score += Math.min(words.length / 3, 3);
  score += Math.min(uniqueLetters / 8, 2);
  score += qCount * 0.5;
  score += hasMadd ? 0.5 : 0;
  if (score < 2) return { level: 1, label: 'FACILE', color: '#4caf81', bar: 20 };
  if (score < 4) return { level: 2, label: 'MODÉRÉ', color: '#ffd166', bar: 50 };
  if (score < 6) return { level: 3, label: 'INTERMÉDIAIRE', color: '#ff9f43', bar: 75 };
  return { level: 4, label: 'AVANCÉ', color: '#ff6b6b', bar: 100 };
}
function calcPhase(ld) {
  if (!ld) return { label: 'NON COMMENCÉ', color: 'var(--text3)', step: 0 };
  if (ld.learned) return { label: 'MAÎTRISÉ ✓', color: '#4caf81', step: 4 };
  const partsCount = ld.parts?.length || 0;
  const allPartsLearned = partsCount > 0 && ld.parts.every(p => p.learned);
  if (allPartsLearned) return { label: 'PARTIES MAÎTRISÉES', color: '#ffd166', step: 3 };
  if (partsCount > 0) return { label: 'EN DÉCOUPAGE', color: '#ff9f43', step: 2 };
  if ((ld.readCount||0) > 0) return { label: 'EN LECTURE', color: '#5bc8f5', step: 1 };
  return { label: 'NON COMMENCÉ', color: 'var(--text3)', step: 0 };
}
// Split a word into grapheme clusters (letter + combining diacritics)
function splitArabicChars(word) {
  const clusters = [];
  const base = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const diac  = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/;
  let cur = '';
  for (const ch of word) {
    if (base.test(ch)) {
      if (cur) clusters.push(cur);
      cur = ch;
    } else if (diac.test(ch) && cur) {
      cur += ch;
    } else {
      if (cur) clusters.push(cur);
      cur = ch;
    }
  }
  if (cur) clusters.push(cur);
  return clusters;
}

// Shared toRevise state/actions (ayat / words / chars / parts) with history tracking.
// Used by ToRevisePanel and DecouverteMode so the marking logic lives in one place.
function useToRevise(ld, surahNum, ayatNum, setLData) {
  const saveWithHistory = (nextRevise, prevRevise) => {
    const now = new Date().toISOString();
    setLData(surahNum, ayatNum, d => {
      const hist = [...(d.reviseHistory || [])];
      const wasActive = !!prevRevise;
      const willBeActive = !!nextRevise;

      if (!wasActive && willBeActive) {
        // Starting a new revise session
        hist.push({
          startDate: now,
          endDate: null,
          words: typeof nextRevise === 'object' ? (nextRevise.words || []) : 'all',
          parts: typeof nextRevise === 'object' ? (nextRevise.parts || []) : [],
          chars: typeof nextRevise === 'object' ? (nextRevise.chars || {}) : {},
        });
      } else if (wasActive && !willBeActive) {
        // Closing current session — find the last open entry
        const lastOpen = [...hist].reverse().findIndex(e => !e.endDate);
        if (lastOpen >= 0) {
          const idx = hist.length - 1 - lastOpen;
          hist[idx] = { ...hist[idx], endDate: now };
        }
      } else if (wasActive && willBeActive) {
        // Update the current open entry's selection
        const lastOpen = [...hist].reverse().findIndex(e => !e.endDate);
        if (lastOpen >= 0) {
          const idx = hist.length - 1 - lastOpen;
          hist[idx] = {
            ...hist[idx],
            words: typeof nextRevise === 'object' ? (nextRevise.words || []) : 'all',
            parts: typeof nextRevise === 'object' ? (nextRevise.parts || []) : [],
            chars: typeof nextRevise === 'object' ? (nextRevise.chars || {}) : {},
          };
        } else {
          // No open entry, create one
          hist.push({
            startDate: now, endDate: null,
            words: typeof nextRevise === 'object' ? (nextRevise.words || []) : 'all',
            parts: typeof nextRevise === 'object' ? (nextRevise.parts || []) : [],
            chars: typeof nextRevise === 'object' ? (nextRevise.chars || {}) : {},
          });
        }
      }
      return { ...d, toRevise: nextRevise, reviseHistory: hist };
    });
  };

  const revise   = ld?.toRevise;
  const isActive = !!revise;
  const selWords = (revise && typeof revise === 'object') ? (revise.words || []) : [];
  const selParts = (revise && typeof revise === 'object') ? (revise.parts || []) : [];
  const selChars = (revise && typeof revise === 'object') ? (revise.chars || {}) : {};

  const toggleAll = () => saveWithHistory(isActive ? false : true, revise);

  const toggleWord = (i) => {
    const cur = typeof revise === 'object' ? revise : {};
    const prev = cur.words || [];
    const next = prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i];
    const nextParts = cur.parts || [];
    const nextChars = { ...(cur.chars || {}) };
    if (prev.includes(i)) delete nextChars[i];
    const nextRevise = next.length === 0 && nextParts.length === 0 ? false : { ...cur, words: next, chars: nextChars };
    saveWithHistory(nextRevise, revise);
    return prev.includes(i); // true if word WAS selected (i.e. we just removed it)
  };

  const toggleChar = (wi, ci) => {
    const cur      = typeof revise === 'object' ? revise : {};
    const prev     = (cur.chars || {})[wi] || [];
    const next     = prev.includes(ci) ? prev.filter(x => x !== ci) : [...prev, ci];
    const newChars = { ...(cur.chars || {}), [wi]: next };
    if (next.length === 0) delete newChars[wi];
    const prevWords = cur.words || [];
    let newWords = prevWords;
    if (next.length > 0 && !prevWords.includes(wi)) newWords = [...prevWords, wi];
    if (next.length === 0 && prevWords.includes(wi))  newWords = prevWords.filter(x => x !== wi);
    const nextParts = cur.parts || [];
    const isEmpty = newWords.length === 0 && nextParts.length === 0 && Object.keys(newChars).length === 0;
    saveWithHistory(isEmpty ? false : { ...cur, words: newWords, chars: newChars }, revise);
  };

  const togglePart = (pid) => {
    const cur = typeof revise === 'object' ? revise : {};
    const prev = cur.parts || [];
    const next = prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid];
    const nextWords = cur.words || [];
    const nextRevise = next.length === 0 && nextWords.length === 0 ? false : { ...cur, parts: next };
    saveWithHistory(nextRevise, revise);
  };

  return { revise, isActive, selWords, selParts, selChars, toggleAll, toggleWord, toggleChar, togglePart };
}

// ─── ToRevisePanel ────────────────────────────────────────────────────────────
// Let user mark whole ayat, specific words, and/or specific parties for revision
function ToRevisePanel({ ayat, surahNum, ld, setLData }) {
  const [expandedWord, setExpandedWord] = React.useState(null);

  const { revise, isActive, selWords, selParts, selChars, toggleAll, toggleWord: toggleWordBase, toggleChar, togglePart } =
    useToRevise(ld, surahNum, ayat.numberInSurah, setLData);

  const ayatWords = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
  const parts     = ld?.parts || [];

  const toggleWord = (i) => {
    const wasSelected = toggleWordBase(i);
    if (wasSelected && expandedWord === i) setExpandedWord(null);
  };

  const splitChars = splitArabicChars;

  const gold = 'var(--gold)'; const gold2 = 'var(--gold2)';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'14px 16px' }}>
      {/* Global toggle */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)' }}>🔖 MARQUER À RÉVISER</div>
        <button onClick={toggleAll} style={{
          fontSize:8, letterSpacing:1.5, padding:'4px 12px', borderRadius:6, cursor:'pointer',
          fontFamily:"'Cinzel',serif", transition:'all .2s',
          background: isActive ? 'rgba(201,168,76,.15)' : 'transparent',
          border: `1px solid ${isActive ? gold : 'rgba(255,255,255,.15)'}`,
          color: isActive ? gold2 : 'var(--text3)',
        }}>{isActive ? '✓ MARQUÉ — RETIRER' : "MARQUER TOUT L'AYAT"}</button>
      </div>

      {/* Word selection + char drill-down */}
      {ayatWords.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)' }}>MOTS · LETTRES · HARAKAT</div>
          {/* Word buttons */}
          <div style={{ direction:'rtl', display:'flex', flexWrap:'wrap', gap:6 }}>
            {ayatWords.map((w, i) => {
              const sel     = selWords.includes(i);
              const expanded= expandedWord === i;
              const charSel = selChars[i] || [];
              return (
                <div key={i} style={{ display:'flex', alignItems:'stretch', borderRadius:6, overflow:'hidden',
                  border:`1px solid ${expanded ? '#5bc8f5' : sel ? gold : 'rgba(255,255,255,.1)'}`,
                  background: sel ? 'rgba(201,168,76,.15)' : 'rgba(255,255,255,.03)' }}>
                  <button onClick={() => toggleWord(i)} style={{
                    fontFamily:"'Amiri Quran',serif", fontSize:18, padding:'4px 10px',
                    background:'transparent', border:'none', cursor:'pointer',
                    color: sel ? gold2 : 'var(--text2)' }}>{w}</button>
                  <button onClick={() => setExpandedWord(expanded ? null : i)}
                    style={{ padding:'0 7px', cursor:'pointer', border:'none',
                      background: expanded ? 'rgba(91,200,245,.15)' : charSel.length > 0 ? 'rgba(91,200,245,.08)' : 'rgba(255,255,255,.04)',
                      borderLeft:'1px solid rgba(255,255,255,.08)',
                      color: expanded || charSel.length > 0 ? '#5bc8f5' : 'var(--text3)',
                      fontSize:8, display:'flex', alignItems:'center' }}>
                    {charSel.length > 0 ? charSel.length : ''}{expanded ? '▲' : '▾'}
                  </button>
                </div>
              );
            })}
          </div>
          {/* Inline char picker — shown below word row when a word is expanded */}
          {expandedWord !== null && (() => {
            const wi      = expandedWord;
            const w       = ayatWords[wi] || '';
            const clusters= splitChars(w);
            const charSel = selChars[wi] || [];
            return (
              <div style={{ direction:'rtl', display:'flex', flexWrap:'wrap', gap:4,
                padding:'8px 10px', background:'rgba(91,200,245,.06)',
                border:'1px solid rgba(91,200,245,.2)', borderRadius:8 }}>
                <div style={{ width:'100%', fontSize:7, letterSpacing:1.5, color:'#5bc8f5',
                  fontFamily:"'Cinzel',serif", marginBottom:4, textAlign:'right' }}>
                  LETTRES DE : {w}
                </div>
                {clusters.map((c, ci) => {
                  const cSel = charSel.includes(ci);
                  return (
                    <button key={ci} onClick={() => toggleChar(wi, ci)} style={{
                      fontFamily:"'Amiri Quran',serif", fontSize:22,
                      padding:'4px 8px', minWidth:34, borderRadius:6, cursor:'pointer',
                      background: cSel ? 'rgba(91,200,245,.2)' : 'rgba(255,255,255,.05)',
                      border:`1px solid ${cSel ? '#5bc8f5' : 'rgba(255,255,255,.12)'}`,
                      color: cSel ? '#5bc8f5' : 'var(--text1)',
                      boxShadow: cSel ? '0 0 6px rgba(91,200,245,.35)' : 'none',
                      transition:'all .12s' }}>{c}</button>
                  );
                })}
                <button onClick={() => setExpandedWord(null)}
                  style={{ marginRight:'auto', fontSize:7, padding:'4px 8px', borderRadius:5,
                    background:'transparent', border:'1px solid rgba(255,255,255,.1)',
                    color:'var(--text3)', cursor:'pointer', fontFamily:"'Cinzel',serif",
                    letterSpacing:1 }}>✕ FERMER</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Parts selection */}
      {parts.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)' }}>PARTIES SPÉCIFIQUES</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {parts.map((p, pi) => {
              const sel = selParts.includes(p.id);
              return (
                <button key={p.id} onClick={() => togglePart(p.id)} style={{
                  fontSize:8, letterSpacing:1, padding:'5px 12px', borderRadius:6,
                  cursor:'pointer', transition:'all .15s', fontFamily:"'Cinzel',serif",
                  background: sel ? 'rgba(200,120,255,.15)' : 'rgba(255,255,255,.03)',
                  border:`1px solid ${sel ? '#c878ff' : 'rgba(255,255,255,.1)'}`,
                  color: sel ? '#c878ff' : 'var(--text2)',
                }}>
                  PARTIE {pi+1}{sel && <span style={{ marginRight:4 }}> ✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary */}
      {isActive && (
        <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:1, borderTop:'1px solid var(--border)', paddingTop:8 }}>
          {typeof revise === 'object'
            ? [
                selWords.length > 0 && `${selWords.length} mot${selWords.length>1?'s':''}`,
                Object.keys(selChars).length > 0 && `${Object.values(selChars).reduce((s,a)=>s+a.length,0)} lettre${Object.values(selChars).reduce((s,a)=>s+a.length,0)>1?'s':''}`,
                selParts.length > 0 && `${selParts.length} partie${selParts.length>1?'s':''}`,
              ].filter(Boolean).join(' · ') || 'Aucune sélection'
            : 'Ayat entier marqué'}
        </div>
      )}

      {/* Revise history */}
      {(ld?.reviseHistory || []).length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6, borderTop:'1px solid var(--border)', paddingTop:10 }}>
          <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)' }}>HISTORIQUE</div>
          {[...(ld.reviseHistory)].reverse().map((entry, i) => {
            const start = entry.startDate ? new Date(entry.startDate) : null;
            const end   = entry.endDate   ? new Date(entry.endDate)   : null;
            const fmt   = (d) => d ? d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '…';
            const wLabel = entry.words === 'all' ? 'ayat entier' : Array.isArray(entry.words) && entry.words.length > 0 ? `${entry.words.length} mot${entry.words.length>1?'s':''}` : null;
            const pLabel = Array.isArray(entry.parts) && entry.parts.length > 0 ? `${entry.parts.length} partie${entry.parts.length>1?'s':''}` : null;
            const cCount = entry.chars ? Object.values(entry.chars).reduce((s,a)=>s+a.length,0) : 0;
            const cLabel = cCount > 0 ? `${cCount} lettre${cCount>1?'s':''}` : null;
            const tags = [wLabel, pLabel, cLabel].filter(Boolean);
            return (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start',
                padding:'6px 8px', background:'var(--surface3)',
                borderRadius:6, border:'1px solid var(--border)',
                opacity: end ? .65 : 1 }}>
                <div style={{ fontSize:7, color: end ? 'var(--text3)' : '#ff9f43',
                  fontFamily:"'Cinzel',serif", letterSpacing:.5, flexShrink:0, lineHeight:1.6 }}>
                  {end ? '✓' : '🔖'}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:2, flex:1 }}>
                  <div style={{ fontSize:7, color:'var(--text3)', lineHeight:1.4 }}>
                    {fmt(start)} {end ? `→ ${fmt(end)}` : '→ en cours'}
                  </div>
                  {tags.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                      {tags.map(t => (
                        <span key={t} style={{ fontSize:6, letterSpacing:1, padding:'1px 5px',
                          borderRadius:4, background:'rgba(255,255,255,.05)',
                          border:'1px solid rgba(255,255,255,.1)', color:'var(--text2)' }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoMode({ ayat, ld, setLData, surahNum }) {
  const words = ayat.text.trim().split(/\s+/).filter(Boolean);
  const diff  = calcDifficulty(ayat.text, ld);
  const phase = calcPhase(ld);
  const vocab = words.map(w => ({ ar: w, fr: wordTranslit(w) })).filter(v => v.fr);
  const PHASES = ['NON COMMENCÉ','EN LECTURE','EN DÉCOUPAGE','PARTIES MAÎTRISÉES','MAÎTRISÉ'];

  const USER_DIFFICULTIES = ['FACILE','MOYEN','DIFFICILE','TRÈS DIFFICILE'];
  const USER_DIFF_COLORS  = ['#4caf81','#ffd166','#ff9f43','#ff6b6b'];
  const USER_PHASES = ['À COMMENCER','EN COURS','À RÉVISER','MAÎTRISÉ','EN PAUSE'];
  const USER_PHASE_COLORS = ['var(--text3)','#5bc8f5','#ffd166','#4caf81','#ff9f43'];

  const userDiff  = ld?.userDifficulty ?? null;
  const userPhase = ld?.userPhase ?? null;

  const setUserDiff  = (v) => setLData(surahNum, ayat.numberInSurah, d => ({ ...d, userDifficulty: d.userDifficulty === v ? null : v }));
  const setUserPhase = (v) => setLData(surahNum, ayat.numberInSurah, d => ({ ...d, userPhase: d.userPhase === v ? null : v }));

  return (
    <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:16 }}>
      {/* Difficulté auto */}
      <div>
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginBottom:8 }}>DIFFICULTÉ (AUTO)</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, height:4, background:'var(--surface3)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ width:`${diff.bar}%`, height:'100%', background:diff.color, borderRadius:2, transition:'width .4s' }} />
          </div>
          <div style={{ fontSize:9, letterSpacing:1.5, color:diff.color, minWidth:90, textAlign:'right' }}>{diff.label}</div>
        </div>
        <div style={{ display:'flex', gap:12, marginTop:8 }}>
          {[
            { label:'MOTS', val: words.length },
            { label:'LETTRES UNIQUES', val: new Set([...stripDiacritics(ayat.text)].filter(c=>c>='\u0621'&&c<='\u064A')).size },
            { label:'LECTURES', val: ld?.readCount||0 },
          ].map(({label,val}) => (
            <div key={label} style={{ flex:1, background:'var(--surface2)', borderRadius:'var(--radius-sm)', padding:'6px 10px', textAlign:'center' }}>
              <div style={{ fontSize:16, color:'var(--gold)', fontFamily:"'Cinzel',serif" }}>{val}</div>
              <div style={{ fontSize:7, letterSpacing:1.5, color:'var(--text3)', marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>
        {/* User difficulty */}
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginTop:12, marginBottom:6 }}>MON NIVEAU DE DIFFICULTÉ</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {USER_DIFFICULTIES.map((d,i) => (
            <button key={d} onClick={() => setUserDiff(d)}
              style={{ fontSize:8, letterSpacing:1, padding:'5px 11px', borderRadius:20,
                border:`1px solid ${userDiff===d ? USER_DIFF_COLORS[i] : 'var(--border2)'}`,
                background: userDiff===d ? `${USER_DIFF_COLORS[i]}22` : 'transparent',
                color: userDiff===d ? USER_DIFF_COLORS[i] : 'var(--text3)',
                cursor:'pointer', transition:'all .2s', fontFamily:"'Cinzel',serif" }}>
              {d}
            </button>
          ))}
        </div>
        {userDiff && <div style={{ fontSize:8, color:'var(--text3)', marginTop:4 }}>Sélectionné : <span style={{ color: USER_DIFF_COLORS[USER_DIFFICULTIES.indexOf(userDiff)] }}>{userDiff}</span> · Cliquer à nouveau pour retirer</div>}
      </div>

      {/* Phase auto */}
      <div>
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginBottom:8 }}>PHASE (AUTO)</div>
        <div style={{ display:'flex', gap:4 }}>
          {PHASES.map((p, i) => (
            <div key={i} title={p} style={{ flex:1, height:6, borderRadius:3,
              background: i <= phase.step ? phase.color : 'var(--surface3)',
              opacity: i <= phase.step ? 1 : 0.3, transition:'background .3s' }} />
          ))}
        </div>
        <div style={{ fontSize:9, letterSpacing:1.5, color:phase.color, marginTop:6 }}>{phase.label}</div>
        {(ld?.parts?.length||0) > 0 && (
          <div style={{ fontSize:8, color:'var(--text3)', marginTop:4 }}>
            {ld.parts.filter(p=>p.learned).length}/{ld.parts.length} PARTIES APPRISES
          </div>
        )}
        {/* User phase */}
        <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginTop:12, marginBottom:6 }}>MA PHASE D'APPRENTISSAGE</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {USER_PHASES.map((p,i) => (
            <button key={p} onClick={() => setUserPhase(p)}
              style={{ fontSize:8, letterSpacing:1, padding:'5px 11px', borderRadius:20,
                border:`1px solid ${userPhase===p ? USER_PHASE_COLORS[i] : 'var(--border2)'}`,
                background: userPhase===p ? `${USER_PHASE_COLORS[i]}22` : 'transparent',
                color: userPhase===p ? USER_PHASE_COLORS[i] : 'var(--text3)',
                cursor:'pointer', transition:'all .2s', fontFamily:"'Cinzel',serif" }}>
              {p}
            </button>
          ))}
        </div>
        {userPhase && <div style={{ fontSize:8, color:'var(--text3)', marginTop:4 }}>Sélectionné : <span style={{ color: USER_PHASE_COLORS[USER_PHASES.indexOf(userPhase)] }}>{userPhase}</span> · Cliquer à nouveau pour retirer</div>}
      </div>

      {/* Vocabulaire */}
      {vocab.length > 0 && (
        <div>
          <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginBottom:8 }}>VOCABULAIRE CLÉ</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {vocab.map(({ar,fr},i) => (
              <div key={i} style={{ background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:'var(--radius-sm)', padding:'5px 10px', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:16, color:'var(--gold)', direction:'rtl' }}>{ar}</div>
                <div style={{ fontSize:8, letterSpacing:1, color:'var(--text3)' }}>{fr}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mastery debug */}
      <MasteryDebug ld={ld} ayatText={ayat.text} />
    </div>
  );
}


// ─── AideMemoireMode ──────────────────────────────────────────────────────────
// Sajda ayats (surahNum:ayatNum)
const SAJDA_AYATS = new Set([
  "7:206","13:15","16:50","17:109","19:58","22:18","22:77",
  "25:60","27:26","32:15","38:24","41:38","53:62","84:21","96:19"
]);
const PAGE_POSITION_LABELS = [
  { key: null,    label: 'NON DÉFINI',   color: 'var(--text3)' },
  { key: 'start', label: 'DÉBUT',        color: '#4caf81' },
  { key: 'mid',   label: 'MILIEU',       color: '#5bc8f5' },
  { key: 'end',   label: 'FIN',          color: '#ffd166' },
];

function AideMemoireMode({ ayat, surahNum, ld, setLData, clickMode, setClickMode, spellCheck = true }) {
  const [meta, setMeta] = useState(null); // { page, hizbQuarter, juz, manzil, ruku, sajda }
  const [metaError, setMetaError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAyahMeta(surahNum, ayat.numberInSurah)
      .then(a => {
        if (cancelled) return;
        if (a) setMeta({
          page: a.page, hizbQuarter: a.hizbQuarter, juz: a.juz,
          manzil: a.manzil, ruku: a.ruku, sajda: a.sajda,
        });
        else setMetaError(true);
      })
      .catch(() => { if (!cancelled) setMetaError(true); });
    return () => { cancelled = true; };
  }, [surahNum, ayat.numberInSurah]);

  const isSajdaAyat = SAJDA_AYATS.has(`${surahNum}:${ayat.numberInSurah}`);
  const hizb = meta ? Math.ceil(meta.hizbQuarter / 4) : null;
  const hizbQ = meta ? ((meta.hizbQuarter - 1) % 4) + 1 : null;
  const hizbQLabels = ['¼ début','½ milieu','¾ fin','fin'];

  // User data
  const pagePos  = ld?.pagePosition  ?? null;
  const subject  = ld?.subject       ?? '';
  const highlight= ld?.highlight     ?? '';
  const [editSubject,   setEditSubject]   = useState(false);
  const [subjectVal,   setSubjectVal]   = useState(ld?.subject||'');

  const save = (key, val) => setLData(surahNum, ayat.numberInSurah, d => ({ ...d, [key]: val }));

  // Toggle a word in the highlight set by index
  const highlightIndices = useMemo(() => {
    const set = new Set();
    if (!highlight?.trim()) return set;
    highlight.trim().split(/\s+/).forEach(w => {
      const norm = normalizeAr(w);
      ayat.text.split(' ').forEach((aw, i) => { if (normalizeAr(aw) === norm) set.add(i); });
    });
    return set;
  }, [highlight, ayat.text]);

  const toggleHighlightWord = (idx) => {
    const words = ayat.text.split(' ');
    const newSet = new Set(highlightIndices);
    newSet.has(idx) ? newSet.delete(idx) : newSet.add(idx);
    const newHighlight = [...newSet].map(i => words[i]).join(' ') || null;
    save('highlight', newHighlight);
  };

  // Highlight words in text — words are now clickable
  const unknownSet = useMemo(() => new Set(ld?.unknownWords||[]), [ld?.unknownWords]);

  const renderHighlighted = (clickable = false) => {
    const arr = ayat.text.split(' ');
    return (
      <span style={{fontFamily:"'Amiri Quran',serif",fontSize:22,direction:'rtl',lineHeight:1.8}}>
        {arr.map((w,i) => {
          const norm = normalizeAr(w);
          const hit  = highlightIndices.has(i) || (highlight?.trim() && highlight.trim().split(/\s+/).some(hw => normalizeAr(hw) && norm.includes(normalizeAr(hw)) && !clickable));
          const unk  = unknownSet.has(i);
          return (
            <span key={i}
              onClick={clickable ? () => toggleHighlightWord(i) : undefined}
              style={{
                color: unk ? '#ff7eb3' : hit ? '#ffd166' : 'var(--gold)',
                textShadow: unk ? '0 0 8px rgba(255,126,179,.5)' : hit ? '0 0 8px rgba(255,209,102,.6)' : 'none',
                cursor: clickable ? 'pointer' : 'default',
                borderRadius: (clickable || unk) ? 4 : 0,
                padding: (clickable || unk) ? '0 2px' : 0,
                background: unk ? 'rgba(255,126,179,.12)' : clickable && hit ? 'rgba(255,209,102,.12)' : 'transparent',
                display: 'inline',
                textDecoration: unk ? 'underline dotted #ff7eb3' : 'none',
              }}>
              {w}{i<arr.length-1?' ':''}
            </span>
          );
        })}
      </span>
    );
  };

  const chip = (active, color, onClick, label, key) => (
    <button key={key ?? label} onClick={onClick} style={{
      fontSize:8, letterSpacing:1, padding:'5px 11px', borderRadius:20, cursor:'pointer',
      border:`1px solid ${active ? color : 'var(--border2)'}`,
      background: active ? `${color}22` : 'transparent',
      color: active ? color : 'var(--text3)',
      fontFamily:"'Cinzel',serif", transition:'all .2s'
    }}>{label}</button>
  );

  return (
    <div style={{padding:'14px 16px',display:'flex',flexDirection:'column',gap:16}}>

      {/* Métadonnées Mushaf */}
      <div>
        <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)',marginBottom:8}}>POSITION DANS LE MUSHAF</div>
        {!meta && !metaError && <div style={{fontSize:9,color:'var(--text3)'}}>Chargement…</div>}
        {metaError && <div style={{fontSize:9,color:'#ff6b6b'}}>Impossible de charger les métadonnées</div>}
        {meta && (
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {[
              {label:'PAGE',  val:meta.page,        color:'#c878ff'},
              {label:'JUZ',   val:meta.juz,          color:'#5bc8f5'},
              {label:'HIZB',  val:hizb,              color:'#ffd166'},
              {label:'¼ HIZB',val:hizbQ ? `${hizbQ}/4 — ${hizbQLabels[hizbQ-1]}` : null, color:'#ff9f43'},
              {label:'MANZIL',val:meta.manzil,       color:'#4caf81'},
              {label:'RUKÛ',  val:meta.ruku,         color:'#f09de0'},
            ].filter(m=>m.val!=null).map(({label,val,color})=>(
              <div key={label} style={{background:'var(--surface3)',borderRadius:'var(--radius-sm)',padding:'6px 12px',textAlign:'center',minWidth:64}}>
                <div style={{fontSize:14,color,fontFamily:"'Cinzel',serif",fontWeight:700}}>{val}</div>
                <div style={{fontSize:7,letterSpacing:1.5,color:'var(--text3)',marginTop:2}}>{label}</div>
              </div>
            ))}
            {isSajdaAyat && (
              <div style={{background:'rgba(255,126,179,.12)',border:'1px solid #ff7eb3',borderRadius:'var(--radius-sm)',padding:'6px 12px',textAlign:'center',alignSelf:'flex-start'}}>
                <div style={{fontSize:12,color:'#ff7eb3'}}>سجدة</div>
                <div style={{fontSize:7,letterSpacing:1.5,color:'#ff7eb3',marginTop:2}}>SAJDA</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Position dans la page */}
      <div>
        <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)',marginBottom:6}}>POSITION DANS LA PAGE</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {PAGE_POSITION_LABELS.filter(p=>p.key!==null).map(({key,label,color})=>
            chip(pagePos===key, color, ()=>save('pagePosition', pagePos===key?null:key), label)
          )}
        </div>
        {pagePos && <div style={{fontSize:8,color:'var(--text3)',marginTop:4}}>
          Position : <span style={{color:PAGE_POSITION_LABELS.find(p=>p.key===pagePos)?.color}}>{PAGE_POSITION_LABELS.find(p=>p.key===pagePos)?.label}</span>
        </div>}
      </div>

      {/* Sujet */}
      <div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
          <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)'}}>SUJET</div>
          <button onClick={()=>{setEditSubject(!editSubject);setSubjectVal(ld?.subject||'');}}
            style={{fontSize:8,letterSpacing:1,padding:'3px 10px',border:'1px solid var(--border2)',background:'transparent',color:'var(--text3)',borderRadius:12,cursor:'pointer',fontFamily:"'Cinzel',serif"}}>
            {editSubject?'FERMER':'MODIFIER'}
          </button>
        </div>
        {editSubject ? (
          <div style={{display:'flex',gap:6}}>
            <input value={subjectVal} onChange={e=>setSubjectVal(e.target.value)} spellCheck={spellCheck} lang="fr"
              placeholder="ex: Tawakkul, Dua, Jugement dernier…"
              style={{flex:1,background:'var(--surface2)',border:'1px solid var(--border2)',borderRadius:'var(--radius-sm)',padding:'6px 10px',color:'var(--text)',fontSize:11,fontFamily:'sans-serif',outline:'none'}}/>
            <button onClick={()=>{save('subject',subjectVal.trim()||null);setEditSubject(false);}}
              style={{padding:'6px 14px',fontSize:9,letterSpacing:1,fontFamily:"'Cinzel',serif",background:'transparent',border:'1px solid var(--gold)',color:'var(--gold)',borderRadius:'var(--radius-sm)',cursor:'pointer'}}>
              OK
            </button>
          </div>
        ) : (
          <div style={{fontSize:12,color:subject?'var(--text2)':'var(--text3)',fontStyle:subject?'normal':'italic'}}>
            {subject||'Aucun sujet défini'}
          </div>
        )}
      </div>

    </div>
  );
}


// ─── RevisionEcritureMode ─────────────────────────────────────────────────────
function RevisionEcritureMode({ ayat, surahNum, ld, setLData, spellCheck = false }) {
  const { activeInput: arabicActiveInput } = useArabicKeyboard();
  // Persisted attempts: ld.writingAttempts = [{ date, text, score, correct }]
  const attempts  = ld?.writingAttempts || [];
  const [input, setInput]   = useState('');
  const [result, setResult] = useState(null); // { score, expected, typed, diff }
  const [showRef, setShowRef] = useState(false);
  const [phase, setPhase]   = useState('write'); // 'write' | 'result'

  const saveAttempt = (attempt) =>
    setLData(surahNum, ayat.numberInSurah, d => ({
      ...d,
      writingAttempts: [...(d.writingAttempts || []).slice(-19), attempt],
    }));

  const normalizeW = s => s.replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, '').trim();

  const checkAnswer = () => {
    const typed    = input.trim();
    const expected = ayat.text.trim();
    if (!typed) return;

    const tWords = normalizeW(typed).split(/\s+/).filter(Boolean);
    const eWords = normalizeW(expected).split(/\s+/).filter(Boolean);
    const correct = tWords.filter((w, i) => w === eWords[i]).length;
    const score   = eWords.length > 0 ? Math.round((correct / eWords.length) * 100) : 0;

    // Word-level diff
    const diff = eWords.map((w, i) => ({
      word: w,
      typed: tWords[i] || '',
      ok: tWords[i] === w,
    }));

    const attempt = { date: new Date().toISOString(), text: typed, score, correct, total: eWords.length };
    saveAttempt(attempt);
    setResult({ score, diff, expected, typed, correct, total: eWords.length });
    setPhase('result');
  };

  const reset = () => { setInput(''); setResult(null); setPhase('write'); setShowRef(false); };

  const scoreColor = result
    ? result.score === 100 ? '#4caf81' : result.score >= 70 ? '#ffd166' : result.score >= 40 ? '#ff9f43' : '#ff6b6b'
    : 'var(--gold)';

  return (
    <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:14 }}>

      {phase === 'write' && (
        <>
          {/* Hint toggle */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)' }}>RÉCRIRE L'AYAT DE MÉMOIRE</div>
            <button onClick={()=>setShowRef(v=>!v)}
              style={{ fontSize:8, letterSpacing:1, padding:'3px 10px', border:`1px solid ${showRef?'var(--gold)':'var(--border2)'}`,
                background:'transparent', color:showRef?'var(--gold)':'var(--text3)', borderRadius:12, cursor:'pointer', fontFamily:"'Cinzel',serif" }}>
              {showRef ? 'CACHER' : 'AFFICHER'}
            </button>
          </div>

          {showRef && (
            <div style={{ background:'var(--surface2)', borderRadius:'var(--radius-sm)', padding:'10px 14px',
              fontFamily:"'Amiri Quran',serif", fontSize:22, direction:'rtl', textAlign:'right', color:'var(--gold)', lineHeight:1.8, opacity:.7 }}>
              {ayat.text}
            </div>
          )}

          <textarea spellCheck={spellCheck} lang="fr"
            onFocus={e => { if (arabicActiveInput) arabicActiveInput.current = e.target; }}
            value={input}
            onChange={e => setInput(e.target.value)}
            dir="rtl"
            placeholder="اكتب الآية من الذاكرة…"
            rows={4}
            style={{ background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:'var(--radius-sm)',
              padding:'10px 12px', color:'var(--text)', fontSize:20, fontFamily:"'Amiri Quran',serif",
              direction:'rtl', textAlign:'right', resize:'vertical', outline:'none', lineHeight:1.8,
              transition:'border-color .2s' }}
          />

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={checkAnswer} disabled={!input.trim()}
              style={{ flex:1, padding:'8px 20px', fontSize:10, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                background:'transparent', border:'1px solid var(--gold)', color:'var(--gold)',
                borderRadius:'var(--radius-sm)', cursor:'pointer', opacity: input.trim()?1:0.4, transition:'all .2s' }}>
              VÉRIFIER
            </button>
            <button onClick={() => { setLData(surahNum, ayat.numberInSurah, d=>({...d,learned:true})); reset(); }}
              style={{ flex:1, padding:'8px 20px', fontSize:10, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                background:'rgba(76,175,129,.1)', border:'1px solid #4caf81', color:'#4caf81',
                borderRadius:'var(--radius-sm)', cursor:'pointer', transition:'all .2s' }}>
              ✓ JE ME SOUVIENS
            </button>
          </div>
        </>
      )}

      {phase === 'result' && result && (
        <>
          {/* Score */}
          <div style={{ textAlign:'center', padding:'8px 0' }}>
            <div style={{ fontSize:36, fontFamily:"'Cinzel',serif", color:scoreColor, lineHeight:1 }}>{result.score}%</div>
            <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginTop:4 }}>
              {result.correct}/{result.total} MOTS CORRECTS
            </div>
            <div style={{ height:4, background:'var(--surface3)', borderRadius:2, marginTop:10, overflow:'hidden' }}>
              <div style={{ width:`${result.score}%`, height:'100%', background:scoreColor, borderRadius:2, transition:'width .5s' }}/>
            </div>
          </div>

          {/* Word diff */}
          <div>
            <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginBottom:8 }}>COMPARAISON MOT PAR MOT</div>
            <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:17, direction:'rtl', textAlign:'right', lineHeight:2.2, flexWrap:'wrap', display:'flex', gap:4, justifyContent:'flex-end' }}>
              {result.diff.map((item, i) => (
                <span key={i} style={{ position:'relative', padding:'2px 4px', borderRadius:4,
                  background: item.ok ? 'rgba(76,175,129,.15)' : 'rgba(255,107,107,.15)',
                  border: `1px solid ${item.ok ? '#4caf81' : '#ff6b6b'}22`,
                  color: item.ok ? '#4caf81' : '#ff6b6b' }}>
                  {item.ok ? item.word : (
                    <span>
                      <span style={{ textDecoration:'line-through', opacity:.5 }}>{item.typed||'—'}</span>
                      {' '}
                      <span style={{ color:'#4caf81' }}>{item.word}</span>
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={reset}
              style={{ flex:1, padding:'7px', fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                background:'transparent', border:'1px solid var(--gold)', color:'var(--gold)',
                borderRadius:'var(--radius-sm)', cursor:'pointer' }}>
              RÉESSAYER
            </button>
            {result.score === 100 && (
              <button onClick={()=>setLData(surahNum, ayat.numberInSurah, d=>({...d,learned:true}))}
                style={{ flex:1, padding:'7px', fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                  background:'rgba(76,175,129,.12)', border:'1px solid #4caf81', color:'#4caf81',
                  borderRadius:'var(--radius-sm)', cursor:'pointer' }}>
                ✓ MARQUER APPRIS
              </button>
            )}
          </div>
        </>
      )}

      {/* Historique */}
      {attempts.length > 0 && (
        <div>
          <div style={{ fontSize:9, letterSpacing:2, color:'var(--text3)', marginBottom:6 }}>HISTORIQUE ({attempts.length})</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {[...attempts].reverse().map((a, i) => {
              const c = a.score===100?'#4caf81':a.score>=70?'#ffd166':a.score>=40?'#ff9f43':'#ff6b6b';
              return (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
                  background:'var(--surface2)', borderRadius:'var(--radius-sm)', border:`1px solid ${c}22` }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', border:`1px solid ${c}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:c, fontFamily:"'Cinzel',serif", flexShrink:0 }}>{a.score}%</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:8, color:'var(--text3)', marginBottom:2 }}>{a.correct}/{a.total} mots</div>
                    <div style={{ fontSize:9, color:'var(--text3)' }}>{new Date(a.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AnimatedPage wrapper ────────────────────────────────────────────────────
function AnimatedPage({ children, pageKey }) {
  const enableAnim = useSelector(sel.enableAnimations);
  return <div key={pageKey} className={enableAnim ? "page-anim" : undefined}>{children}</div>;
}

// ─── AnimatedSubmenu wrapper ─────────────────────────────────────────────────
function AnimatedSubmenu({ isOpen, children }) {
  if (!isOpen) return null;
  return <div className="submenu-anim-wrap">{children}</div>;
}

// ─── TajweedExercice ───────────────────────────────────────────────────────────
const TAJWEED_RULES = [
  { id:'qalqala', label:'Qalqala', labelAr:'قلقلة', color:'#5bc8f5',
    desc:'Rebond sur ق ط ب ج د avec sukun ou en waqf' },
  { id:'madd',    label:'Madd',    labelAr:'مَدّ',   color:'#f09de0',
    desc:'Allongement sur les lettres de prolongation' },
  { id:'izhar',   label:'Izhar',   labelAr:'إظهار',  color:'#4caf81',
    desc:'Prononciation claire du nûn sâkin / tanwîn avant ء ه ع غ ح خ' },
  { id:'idgham',  label:'Idgham',  labelAr:'إدغام',  color:'#ffd166',
    desc:'Assimilation du nûn sâkin / tanwîn avant ي ن م و ل ر' },
];

function TajweedExercice({ ayat }) {
  const [mode,       setMode]       = React.useState('detect');  // 'detect' | 'match'
  const [selected,   setSelected]   = React.useState(null);      // { type:'rule'|'char', id }
  const [answered,   setAnswered]   = React.useState({});        // { 'charIdx:ruleId': true|false }
  const [score,      setScore]      = React.useState(null);

  // ── Scan the ayat text and collect all tajweed occurrences ─────────────────
  const findings = React.useMemo(() => {
    const text = ayat.text || '';
    const arr  = [...text];
    const results = []; // { idx, char, ruleId, wordIdx }
    let wordIdx = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === ' ') { wordIdx++; continue; }
      if (isQalqala(arr, i))          results.push({ idx:i, char:arr[i], ruleId:'qalqala', wordIdx });
      if (getMaddType(arr, i))         results.push({ idx:i, char:arr[i], ruleId:'madd',    wordIdx });
      if (isIzhar(arr, i))             results.push({ idx:i, char:arr[i], ruleId:'izhar',   wordIdx });
      if (isIdgham(arr, i))            results.push({ idx:i, char:arr[i], ruleId:'idgham',  wordIdx });
    }
    return results;
  }, [ayat.text]);

  const foundRules = React.useMemo(() =>
    [...new Set(findings.map(f => f.ruleId))].map(id => TAJWEED_RULES.find(r => r.id === id)),
  [findings]);

  // ── Build shuffled exercise pairs ─────────────────────────────────────────
  const exercisePairs = React.useMemo(() => {
    if (findings.length === 0) return [];
    // Dedupe: one entry per (char, ruleId)
    const seen = new Set();
    const pairs = [];
    for (const f of findings) {
      const key = `${f.char}:${f.ruleId}`;
      if (!seen.has(key)) { seen.add(key); pairs.push(f); }
    }
    return pairs;
  }, [findings]);

  const shuffledChars = React.useMemo(() => [...exercisePairs].sort(() => Math.random() - .5), [exercisePairs]);
  const shuffledRules = React.useMemo(() => [...foundRules].sort(() => Math.random() - .5), [foundRules]);

  const handleSelect = (type, id) => {
    if (mode !== 'match') return;
    if (!selected) { setSelected({ type, id }); return; }
    if (selected.type === type) { setSelected({ type, id }); return; }
    // Check match
    const ruleId = type === 'rule' ? id : selected.id;
    const charId = type === 'char' ? id : selected.id;
    const correct = exercisePairs.some(p => `${p.char}:${p.idx}` === charId && p.ruleId === ruleId);
    setAnswered(prev => ({ ...prev, [`${charId}::${ruleId}`]: correct }));
    setSelected(null);
  };

  const totalPairs   = exercisePairs.length;
  const answeredCount = Object.keys(answered).length;
  const correctCount  = Object.values(answered).filter(Boolean).length;

  const isCharAnswered = (charId) => Object.keys(answered).some(k => k.startsWith(charId + '::'));
  const isRuleAnswered = (ruleId) => exercisePairs.filter(p => p.ruleId === ruleId)
    .every(p => Object.keys(answered).some(k => k.startsWith(`${p.char}:${p.idx}::${ruleId}`)));

  const ruleColor = (id) => TAJWEED_RULES.find(r => r.id === id)?.color || '#fff';

  // ── Detect mode: show annotated text ──────────────────────────────────────
  const renderAnnotated = () => {
    const text = ayat.text || '';
    const arr  = [...text];
    const words = text.split(' ');
    return (
      <div style={{ direction:'rtl', lineHeight:2.2, fontSize:22, fontFamily:'Scheherazade New, serif',
        padding:'12px 0', letterSpacing:1 }}>
        {words.map((word, wi) => {
          const wArr = [...word];
          return (
            <span key={wi} style={{ display:'inline', marginLeft:8 }}>
              {wArr.map((ch, ci) => {
                const absIdx = [...text.slice(0, text.split(' ').slice(0, wi).join(' ').length + (wi > 0 ? 1 : 0))].length + ci;
                const rule = findings.find(f => f.idx === absIdx);
                const color = rule ? ruleColor(rule.ruleId) : undefined;
                return <span key={ci} style={{
                  color, textShadow: color ? `0 0 8px ${color}66` : undefined,
                  borderBottom: color ? `2px solid ${color}` : undefined,
                }}>{ch}</span>;
              })}
            </span>
          );
        })}
      </div>
    );
  };

  if (findings.length === 0) return (
    <div style={{ padding:16, textAlign:'center', color:'var(--text3)', fontSize:9, letterSpacing:1.5 }}>
      Aucune règle tajweed détectée dans cet ayat.
    </div>
  );

  return (
    <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:14 }}>
      {/* Mode tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)' }}>
        {[['detect','🔍 DÉTECTER'],['match','🎯 EXERCICE']].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setSelected(null); setAnswered({}); setScore(null); }}
            style={{ padding:'8px 16px', fontSize:8, letterSpacing:2, fontFamily:"'Cinzel',serif",
              background:'none', border:'none', cursor:'pointer',
              borderBottom: mode===m ? '2px solid var(--gold)' : '2px solid transparent',
              color: mode===m ? 'var(--gold)' : 'var(--text3)',
            }}>{label}</button>
        ))}
      </div>

      {mode === 'detect' ? (
        <>
          {renderAnnotated()}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {foundRules.map(rule => {
              const chars = [...new Set(findings.filter(f => f.ruleId === rule.id).map(f => f.char))];
              return (
                <div key={rule.id} style={{ display:'flex', alignItems:'flex-start', gap:10,
                  padding:'8px 12px', borderRadius:8, border:`1px solid ${rule.color}33`,
                  background:`${rule.color}11` }}>
                  <div style={{ minWidth:6, marginTop:4, width:6, height:6, borderRadius:'50%',
                    background:rule.color, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:2 }}>
                      <span style={{ fontSize:9, letterSpacing:1.5, color:rule.color, fontFamily:"'Cinzel',serif" }}>{rule.label}</span>
                      <span style={{ fontSize:14, color:rule.color, fontFamily:'Scheherazade New, serif' }}>{rule.labelAr}</span>
                    </div>
                    <div style={{ fontSize:8, color:'var(--text3)', marginBottom:4 }}>{rule.desc}</div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {chars.map(ch => (
                        <span key={ch} style={{ fontSize:18, color:rule.color, fontFamily:'Scheherazade New, serif',
                          padding:'2px 8px', borderRadius:6, border:`1px solid ${rule.color}55`,
                          background:`${rule.color}18` }}>{ch}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize:8, color:'var(--text3)', letterSpacing:.5 }}>
            Associez chaque lettre à sa règle tajweed · {correctCount}/{totalPairs} correct{correctCount > 1 ? 's' : ''}
          </div>

          {/* Letters */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)' }}>LETTRES</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, direction:'rtl' }}>
              {shuffledChars.map(p => {
                const charId = `${p.char}:${p.idx}`;
                const isSelected = selected?.type === 'char' && selected.id === charId;
                const ans = Object.entries(answered).find(([k]) => k.startsWith(charId + '::'));
                const color = ans ? (ans[1] ? '#4caf81' : '#e05a5a') : ruleColor(p.ruleId);
                return (
                  <button key={charId} onClick={() => handleSelect('char', charId)}
                    style={{ fontSize:22, fontFamily:'Scheherazade New, serif',
                      padding:'6px 14px', borderRadius:8, cursor: ans ? 'default' : 'pointer',
                      border:`2px solid ${isSelected ? 'var(--gold)' : ans ? color : 'var(--border2)'}`,
                      background: isSelected ? 'rgba(201,168,76,.12)' : ans ? `${color}22` : 'var(--surface2)',
                      color: ans ? color : 'var(--text)',
                      transition:'all .15s',
                    }}>{p.char}</button>
                );
              })}
            </div>
          </div>

          {/* Rules */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)' }}>RÈGLES</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {shuffledRules.map(rule => {
                const isSelected = selected?.type === 'rule' && selected.id === rule.id;
                const done = isRuleAnswered(rule.id);
                return (
                  <button key={rule.id} onClick={() => handleSelect('rule', rule.id)}
                    style={{ fontSize:9, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                      padding:'8px 16px', borderRadius:8, cursor: done ? 'default' : 'pointer',
                      border:`2px solid ${isSelected ? 'var(--gold)' : done ? rule.color : 'var(--border2)'}`,
                      background: isSelected ? 'rgba(201,168,76,.12)' : done ? `${rule.color}22` : 'var(--surface2)',
                      color: done ? rule.color : isSelected ? 'var(--gold)' : 'var(--text2)',
                      transition:'all .15s', display:'flex', alignItems:'center', gap:6,
                    }}>
                    <span style={{ fontSize:14, fontFamily:'Scheherazade New, serif' }}>{rule.labelAr}</span>
                    {rule.label}
                  </button>
                );
              })}
            </div>
          </div>

          {answeredCount === totalPairs && (
            <div style={{ padding:'10px 14px', borderRadius:8, textAlign:'center',
              background: correctCount === totalPairs ? 'rgba(76,175,129,.1)' : 'rgba(224,90,90,.08)',
              border:`1px solid ${correctCount === totalPairs ? 'var(--green)' : 'var(--red)'}` }}>
              <div style={{ fontSize:12, color: correctCount === totalPairs ? 'var(--green)' : 'var(--red)' }}>
                {correctCount === totalPairs ? '✓ Parfait !' : `${correctCount}/${totalPairs}`}
              </div>
              <button onClick={() => { setAnswered({}); setSelected(null); }}
                style={{ marginTop:6, fontSize:8, letterSpacing:1.5, fontFamily:"'Cinzel',serif",
                  padding:'5px 14px', borderRadius:6, background:'none', cursor:'pointer',
                  border:'1px solid var(--border2)', color:'var(--text3)' }}>↺ RECOMMENCER</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Submenu({ ayat, surahNum, ld, setLData, submenuMode, setSubmenuMode, audioUrl, isMainPlaying, timestamps, onLoadTimestamps, onUpdateTimestamps, onLocalPlay, partSelectAyat, partSelectStep, onStartPartCreate, collections, ayatInCollections, onOpenCollModal, aideMemoireClickMode, setAideMemoireClickMode, spellCheck, onSetLoop, ayatLoopActive }) {
  return (
    <div className="submenu" onClick={e => e.stopPropagation()}>

      <div className="submenu-header">
        <button className={`mode-btn${submenuMode === "lecture" ? " active" : ""}`} onClick={() => setSubmenuMode("lecture")}>LECTURE</button>
        <button className={`mode-btn${submenuMode === "decouverte" ? " active" : ""}`} onClick={() => setSubmenuMode("decouverte")}>👁 DÉCOUVERTE</button>
        <button className={`mode-btn${submenuMode === "apprentissage" ? " active" : ""}`} onClick={() => setSubmenuMode("apprentissage")}>APPRENTISSAGE</button>
        <button
          className={`mode-btn${submenuMode === "collections" ? " active" : ""}`}
          onClick={() => setSubmenuMode("collections")}
          style={submenuMode !== "collections" && ayatInCollections?.length > 0 ? { color: "#c878ff" } : {}}
        >
          🗂 COLLECTIONS{ayatInCollections?.length > 0 ? ` (${ayatInCollections.length})` : ""}
        </button>
        <button className={`mode-btn${submenuMode === "infos" ? " active" : ""}`} onClick={() => setSubmenuMode("infos")}>ℹ INFOS</button>
        <button className={`mode-btn${submenuMode === "memoire" ? " active" : ""}`} onClick={() => setSubmenuMode("memoire")}>📖 AIDE MÉMOIRE</button>
        <button className={`mode-btn${submenuMode === "tajweed" ? " active" : ""}`} onClick={() => setSubmenuMode("tajweed")}>☪ TAJWEED</button>
        <button
          onClick={() => setSubmenuMode(submenuMode === 'reviser' ? 'lecture' : 'reviser')}
          title={ld.toRevise ? "Modifier marquage à réviser" : "Marquer à réviser"}
          style={{
            flexShrink:0, padding:"6px 10px", fontSize:13, cursor:"pointer",
            background: ld.toRevise ? "rgba(201,168,76,.12)" : submenuMode === 'reviser' ? "rgba(255,255,255,.05)" : "transparent",
            border:"none", borderBottom: ld.toRevise ? "2px solid var(--gold)" : submenuMode === 'reviser' ? "2px solid var(--text3)" : "2px solid transparent",
            color: ld.toRevise ? "var(--gold2)" : submenuMode === 'reviser' ? "var(--text2)" : "var(--text3)",
            transition:"all .15s",
          }}>🔖</button>
        <button onClick={() => onSetLoop?.()} style={{
          flexShrink:0, padding:"6px 10px", fontSize:14, cursor:"pointer",
          background: ayatLoopActive ? "rgba(62,184,160,.12)" : "transparent",
          border: "none", borderBottom: ayatLoopActive ? "2px solid var(--teal)" : "2px solid transparent",
          color: ayatLoopActive ? "var(--teal2)" : "var(--text3)",
          transition:"all .15s",
        }} title="Lire en boucle">↺</button>
      </div>
      <div className="submenu-content">
        {submenuMode === "lecture"
          ? <LectureMode ayat={ayat} surahNum={surahNum} audioUrl={audioUrl} isMainPlaying={isMainPlaying} timestamps={timestamps} onLoadTimestamps={onLoadTimestamps} onUpdateTimestamps={onUpdateTimestamps} onLocalPlay={onLocalPlay} />
          : submenuMode === "decouverte"
          ? <DecouverteMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} audioUrl={audioUrl} timestamps={timestamps} />
          : submenuMode === "apprentissage"
          ? <ApprentissageMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} timestamps={timestamps} audioUrl={audioUrl}
              isSelectingThisAyat={partSelectAyat === ayat.numberInSurah}
              partSelectStep={partSelectStep}
              onStartPartCreate={onStartPartCreate}
              clickMode={aideMemoireClickMode} setClickMode={setAideMemoireClickMode} />
          : submenuMode === "infos"
          ? <InfoMode ayat={ayat} ld={ld} setLData={setLData} surahNum={surahNum} />
          : submenuMode === "memoire"
          ? <AideMemoireMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} clickMode={aideMemoireClickMode} setClickMode={setAideMemoireClickMode} spellCheck={spellCheck} />
          : submenuMode === "revision"
          ? <RevisionEcritureMode ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} spellCheck={spellCheck} />
          : submenuMode === "tajweed"
          ? <TajweedExercice ayat={ayat} />
          : submenuMode === "reviser"
          ? <ToRevisePanel ayat={ayat} surahNum={surahNum} ld={ld} setLData={setLData} />
          : <AyatCollectionsTab
              surahNum={surahNum} ayatNum={ayat.numberInSurah}
              collections={collections}
              ayatInCollections={ayatInCollections}
              onOpenModal={onOpenCollModal}
            />
        }
      </div>

    </div>
  );
}

function EditorWords({ editTs, currentMs, setCharField, captureStart, captureEnd, onSave, onReset, isDiacritic, audioRef }) {
  const [openWords, setOpenWords] = useState({});
  const [playingChar, setPlayingChar] = useState(null); // {wi,ci}
  const toggle = wi => setOpenWords(p => ({ ...p, [wi]: !p[wi] }));

  const playChar = (wi, ci, c) => {
    const audio = audioRef?.current;
    if (!audio) return;
    // Stop if already playing this char
    if (playingChar?.wi === wi && playingChar?.ci === ci) {
      audio.pause(); setPlayingChar(null); return;
    }
    const startSec = c.start / 1000;
    const endSec   = c.end   / 1000;
    if (startSec === endSec) return; // degenerate
    audio.currentTime = startSec;
    audio.play().catch(() => {});
    setPlayingChar({ wi, ci });
    const check = () => {
      if (audio.currentTime >= endSec) {
        audio.pause(); setPlayingChar(null);
        audio.removeEventListener('timeupdate', check);
      }
    };
    audio.addEventListener('timeupdate', check);
    audio.addEventListener('ended', () => { setPlayingChar(null); audio.removeEventListener('timeupdate', check); }, { once: true });
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--text3)", marginBottom: 8, fontFamily: "'Cinzel',serif" }}>
        CLIQUEZ ▶ POUR ÉCOUTER LA LETTRE · ⊙ POUR CAPTURER LA POSITION AUDIO
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
        {editTs.words.map((word, wi) => {
          const isOpen   = !!openWords[wi];
          const wordText = word.chars?.map(c => c.char).join("") ?? "";
          const hasActive = word.chars?.some(c => currentMs >= c.start && currentMs <= c.end);
          return (
            <div key={wi} style={{ border: `1px solid ${hasActive ? "var(--gold)" : "var(--border)"}`, borderRadius: 6, transition: "border-color .15s" }}>
              {/* Toggle header — sticky */}
              <button onClick={() => toggle(wi)} style={{ width: "100%", background: hasActive ? "rgba(201,168,76,.08)" : "var(--surface3)", border: "none", padding: "6px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", position: "sticky", top: 0, zIndex: 2, borderBottom: isOpen ? "1px solid var(--border)" : "none" }}>
                <span style={{ fontFamily: "'Amiri Quran',serif", fontSize: 20, direction: "rtl", flex: 1, lineHeight: 1.6 }}>
                  {fixChars(word.chars || []).map((c, ci) => {
                    const active = currentMs >= c.start && currentMs <= c.end;
                    const done   = currentMs > c.end && currentMs > 0 && c.end > 0;
                    const isCharPlaying2 = playingChar?.wi === wi && playingChar?.ci === ci;
                    return (
                      <span key={ci} className={`char-span${isCharPlaying2 ? " char-active" : active ? " char-active" : done ? " char-done" : ""}`}>{c.char}</span>
                    );
                  })}
                </span>
                <span style={{ fontSize: 8, color: "var(--text3)", letterSpacing: 1, fontFamily: "'Cinzel',serif" }}>MOT {wi + 1} · {word.chars?.length ?? 0} LETTRES</span>
                <span style={{ fontSize: 10, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</span>
              </button>
              {/* Chars rows */}
              {isOpen && (
                <div style={{ padding: "6px 10px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
                  {(word.chars || []).map((c, ci) => {
                    const active       = currentMs >= c.start && currentMs <= c.end;
                    const isDiac       = isDiacritic(c.char);
                    const isDegenerate = !isDiac && c.start === c.end;
                    const isDisabled   = isDiac || isDegenerate;
                    const isCharPlaying = playingChar?.wi === wi && playingChar?.ci === ci;
                    return (
                      <div key={ci} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 4, background: active ? "rgba(201,168,76,.07)" : isCharPlaying ? "rgba(62,184,160,.07)" : "transparent", opacity: isDisabled ? 0.4 : 1 }}>
                        {/* Play/pause button */}
                        <button onClick={() => playChar(wi, ci, c)} disabled={isDegenerate || isDiac}
                          style={{ width: 22, height: 22, borderRadius: "50%", border: `1px solid ${isCharPlaying ? "var(--red)" : "var(--teal)"}`, background: "transparent", color: isCharPlaying ? "var(--red)" : "var(--teal)", cursor: isDegenerate || isDiac ? "default" : "pointer", fontSize: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {isCharPlaying ? "⏸" : "▶"}
                        </button>
                        <span style={{ fontFamily: "'Amiri Quran',serif", fontSize: 20, minWidth: 24, textAlign: "center", color: active ? "var(--gold2)" : isCharPlaying ? "var(--teal2)" : isDisabled ? "var(--text3)" : "var(--text2)" }}>{c.char}</span>
                        <span style={{ fontSize: 8, color: "var(--text3)", letterSpacing: 1, width: 30 }}>START</span>
                        <button onClick={() => captureStart(wi, ci)} disabled={isDiac} style={{ fontSize: 9, padding: "2px 5px", border: "1px solid var(--teal)", background: "transparent", color: isDiac ? "var(--text3)" : "var(--teal)", borderRadius: 3, cursor: isDiac ? "default" : "pointer" }}>⊙</button>
                        <input type="number" value={c.start} onChange={e => setCharField(wi, ci, 'start', e.target.value)} disabled={isDiac}
                          style={{ width: 62, fontSize: 10, padding: "2px 4px", background: "var(--surface3)", border: `1px solid ${isDegenerate ? "var(--red)" : "var(--border2)"}`, borderRadius: 3, color: "var(--text2)", fontFamily: "monospace", opacity: isDiac ? 0.5 : 1 }} />
                        <span style={{ fontSize: 8, color: "var(--text3)", letterSpacing: 1, width: 24 }}>END</span>
                        <button onClick={() => captureEnd(wi, ci)} disabled={isDiac} style={{ fontSize: 9, padding: "2px 5px", border: "1px solid var(--gold)", background: "transparent", color: isDiac ? "var(--text3)" : "var(--gold)", borderRadius: 3, cursor: isDiac ? "default" : "pointer" }}>⊙</button>
                        <input type="number" value={c.end} onChange={e => setCharField(wi, ci, 'end', e.target.value)} disabled={isDiac}
                          style={{ width: 62, fontSize: 10, padding: "2px 4px", background: "var(--surface3)", border: `1px solid ${isDegenerate ? "var(--red)" : "var(--border2)"}`, borderRadius: 3, color: "var(--text2)", fontFamily: "monospace", opacity: isDiac ? 0.5 : 1 }} />
                        {active && !isCharPlaying && <span style={{ fontSize: 8, color: "var(--gold2)" }}>●</span>}
                        {isDiac && <span style={{ fontSize: 7, color: "var(--text3)" }}>~</span>}
                        {isDegenerate && <span style={{ fontSize: 7, color: "var(--red)" }}>!</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn-primary" onClick={onSave}>💾 SAUVEGARDER + EXPORTER JSON</button>
        <button className="btn-small" onClick={onReset}>↺ RÉINITIALISER</button>
      </div>
    </div>
  );
}

// ─── IndexedDB helpers for voice recordings ──────────────────────────────────
// Recordings are blobs — can't go in Redux. Use IndexedDB.
const DB_NAME = "QuranRecordings";
const DB_VER  = 1;
const STORE   = "recordings";

function openRecDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = () => rej(req.error);
  });
}
async function saveRecording(rec) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function loadRecordings(ayatKey) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res((req.result || []).filter(r => r.ayatKey === ayatKey));
    req.onerror   = () => rej(req.error);
  });
}
async function deleteRecording(id) {
  const db = await openRecDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

// ─── MiniAudioPlayer ──────────────────────────────────────────────────────────
function MiniAudioPlayer({ src, color = "var(--gold2)", label = null }) {
  const ref  = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur,     setCur]     = useState(0);
  const [dur,     setDur]     = useState(0);
  const rafRef = useRef(null);

  const tick = () => {
    if (ref.current) setCur(ref.current.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  };

  const toggle = () => {
    if (!ref.current) return;
    if (ref.current.paused) { ref.current.play(); setPlaying(true); rafRef.current = requestAnimationFrame(tick); }
    else { ref.current.pause(); setPlaying(false); cancelAnimationFrame(rafRef.current); }
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
  const pct = dur > 0 ? Math.min(1, cur / dur) : 0;

  const seek = (e) => {
    if (!ref.current || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    ref.current.currentTime = Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
  };

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
      background:"var(--surface3)", borderRadius:8, border:"1px solid var(--border2)" }}>
      <audio ref={ref} src={src}
        onLoadedMetadata={() => setDur(ref.current?.duration || 0)}
        onEnded={() => { setPlaying(false); cancelAnimationFrame(rafRef.current); setCur(0); }}
        style={{ display:"none" }} />
      <button onClick={toggle} style={{
        width:30, height:30, borderRadius:"50%", border:`1px solid ${color}`,
        background: playing ? `${color}22` : "transparent",
        color, fontSize:11, cursor:"pointer", display:"flex",
        alignItems:"center", justifyContent:"center", flexShrink:0,
      }}>{playing ? "⏸" : "▶"}</button>
      {label && <span style={{ fontSize:8, letterSpacing:1, color:"var(--text3)", flexShrink:0 }}>{label}</span>}
      <div onClick={seek} style={{ flex:1, height:4, background:"var(--surface2)",
        borderRadius:2, cursor:"pointer", overflow:"hidden", position:"relative" }}>
        <div style={{ position:"absolute", left:0, top:0, bottom:0,
          width:`${pct*100}%`, background:color, borderRadius:2, transition:"width .1s linear" }}/>
      </div>
      <span style={{ fontSize:8, color:"var(--text3)", flexShrink:0, fontFamily:"'Cinzel',serif" }}>
        {fmt(cur)}<span style={{color:"var(--border2)"}}>/</span>{fmt(dur)}
      </span>
    </div>
  );
}

// ─── ComparePlayer ────────────────────────────────────────────────────────────
function ComparePlayer({ userSrc, refSrc }) {
  const userRef = useRef(null);
  const refRef  = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [userT,   setUserT]     = useState(0);
  const [refT,    setRefT]      = useState(0);
  const [userDur, setUserDur]   = useState(0);
  const [refDur,  setRefDur]    = useState(0);
  const rafRef  = useRef(null);

  const tick = () => {
    if (userRef.current) setUserT(userRef.current.currentTime);
    if (refRef.current)  setRefT(refRef.current.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  };

  const playBoth = () => {
    if (!userRef.current || !refRef.current) return;
    userRef.current.currentTime = 0;
    refRef.current.currentTime  = 0;
    userRef.current.play().catch(()=>{});
    refRef.current.play().catch(()=>{});
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pauseBoth = () => {
    userRef.current?.pause();
    refRef.current?.pause();
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const stopBoth = () => {
    pauseBoth();
    if (userRef.current) userRef.current.currentTime = 0;
    if (refRef.current)  refRef.current.currentTime  = 0;
    setUserT(0); setRefT(0);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const handleEnded = () => {
    if (userRef.current?.ended && refRef.current?.ended) {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    }
  };

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
  const progBar = (t, dur, color) => (
    <div style={{height:3,background:"var(--surface3)",borderRadius:2,overflow:"hidden",flex:1}}>
      <div style={{height:"100%",width:`${dur>0?Math.min(1,t/dur)*100:0}%`,background:color,borderRadius:2,transition:"width .1s linear"}}/>
    </div>
  );

  return (
    <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:10,background:"var(--surface2)",borderRadius:8,border:"1px solid var(--border)"}}>
      {/* Hidden audio elements */}
      <audio ref={userRef} src={userSrc} onLoadedMetadata={()=>setUserDur(userRef.current?.duration||0)} onEnded={handleEnded} />
      <audio ref={refRef}  src={refSrc}  onLoadedMetadata={()=>setRefDur(refRef.current?.duration||0)}   onEnded={handleEnded} />

      {/* Sync play controls */}
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={playing ? pauseBoth : playBoth} style={{
          width:36,height:36,borderRadius:"50%",border:"none",cursor:"pointer",
          background:playing?"rgba(255,126,179,.15)":"rgba(62,184,160,.15)",
          color:playing?"#ff7eb3":"var(--teal2)",fontSize:14,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}>{playing ? "⏸" : "▶"}</button>
        <button onClick={stopBoth} style={{
          width:28,height:28,borderRadius:"50%",border:"1px solid var(--border2)",cursor:"pointer",
          background:"transparent",color:"var(--text3)",fontSize:11,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}>⏹</button>
        <span style={{fontSize:8,letterSpacing:1.5,color:"var(--gold2)",fontFamily:"'Cinzel',serif"}}>ÉCOUTE SIMULTANÉE</span>
      </div>

      {/* User track */}
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:8,letterSpacing:1,color:"var(--teal2)",flexShrink:0}}>🎙 MOI</span>
          {progBar(userT, userDur, "var(--teal)")}
          <span style={{fontSize:7,color:"var(--text3)",flexShrink:0}}>{fmt(userT)}/{fmt(userDur)}</span>
        </div>
      </div>

      {/* Ref track */}
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:8,letterSpacing:1,color:"var(--gold2)",flexShrink:0}}>📖 REF</span>
          {progBar(refT, refDur, "var(--gold)")}
          <span style={{fontSize:7,color:"var(--text3)",flexShrink:0}}>{fmt(refT)}/{fmt(refDur)}</span>
        </div>
      </div>

      {/* Individual controls */}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <MiniAudioPlayer src={userSrc} color="var(--teal2)" label="🎙 MOI" />
        <MiniAudioPlayer src={refSrc}  color="var(--gold2)" label="📖 REF" />
      </div>
    </div>
  );
}

// ─── VoiceRecorder sub-component ─────────────────────────────────────────────
function VoiceRecorder({ ayat, surahNum, originalAudioUrl, localAudioRef }) {
  const ayatKey = `${surahNum}:${ayat.numberInSurah}`;
  const [recordings, setRecordings] = useState([]);
  const [isRecording, setIsRecording]     = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [expandedId, setExpandedId]       = useState(null);
  const [compareId, setCompareId]         = useState(null);
  const [micGain, setMicGain]             = useState(4.0); // amplification micro
  const audioRecRef   = useRef(null);
  const timerRef      = useRef(null);
  const startTimeRef  = useRef(0);

  useEffect(() => {
    loadRecordings(ayatKey).then(setRecordings).catch(() => {});
  }, [ayatKey]);

  useEffect(() => () => { audioRecRef.current?.release(); }, []);

  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const startRec = async () => {
    try {
      // Sur Android, pauser le player HTML avant de prendre le micro (conflit hardware)
      if (IS_ANDROID) { try { localAudioRef?.current?.pause(); } catch {} }
      const arec = createAudioRecorder();
      audioRecRef.current = arec;
      await arec.start(micGain);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 200);
    } catch (err) {
      console.error("[VoiceRecorder] startRec:", err);
      alert("Impossible d'accéder au microphone : " + (err.message || err));
    }
  };

  const stopRec = async () => {
    clearInterval(timerRef.current);
    setIsRecording(false);
    try {
      const url = await audioRecRef.current?.stop();
      audioRecRef.current = null;
      if (!url) return;

      // createAudioRecorder retourne toujours une URL lisible par la WebView
      // (convertFileSrc sur Android, blob: URL sur web)
      let blob;
      try { const r = await fetch(url); blob = await r.blob(); }
      catch { return; }
      if (!blob || blob.size === 0) return;

      const duration = Date.now() - startTimeRef.current;
      const id = Date.now();
      const rec = { id, ayatKey, date: new Date().toISOString(), duration, mimeType: blob.type, blob };
      await saveRecording(rec);
      const updated = await loadRecordings(ayatKey);
      setRecordings(updated);
      setExpandedId(id);
    } catch (err) {
      console.error("[VoiceRecorder] stopRec:", err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Supprimer cet enregistrement ?")) return;
    await deleteRecording(id);
    setRecordings(r => r.filter(x => x.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (compareId  === id) setCompareId(null);
  };

  const getBlobUrl = (rec) => {
    if (!rec._blobUrl) rec._blobUrl = URL.createObjectURL(rec.blob);
    return rec._blobUrl;
  };

  return (
    <div className="rec-wrap">
      {/* Gain slider */}
      {!isRecording && (
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"4px 0"}}>
          <span style={{fontSize:8,letterSpacing:1,color:"var(--text3)",fontFamily:"'Cinzel',serif",flexShrink:0}}>🎤 GAIN</span>
          <input type="range" min="1" max="8" step="0.5" value={micGain}
            onChange={e=>setMicGain(Number(e.target.value))}
            style={{flex:1,accentColor:"var(--teal)"}} />
          <span style={{fontSize:9,color:"var(--teal2)",fontFamily:"'Cinzel',serif",width:28,textAlign:"right"}}>{micGain}×</span>
        </div>
      )}

      {/* Record button */}
      <button
        className={`rec-btn ${isRecording ? "recording" : "idle"}`}
        onClick={isRecording ? stopRec : startRec}
      >
        <div className="rec-dot" />
        {isRecording
          ? <><span className="rec-timer">{fmtTime(elapsed)}</span><span>ARRÊTER L'ENREGISTREMENT</span></>
          : "🎙 ENREGISTRER MA RÉCITATION"
        }
      </button>

      {recordings.length === 0 && !isRecording && (
        <div style={{ textAlign:"center", fontSize:9, letterSpacing:1.5, color:"var(--text3)", padding:"12px 0" }}>
          Aucun enregistrement — appuyez sur le bouton pour commencer
        </div>
      )}

      {/* Recordings list */}
      {recordings.length > 0 && (
        <div className="rec-list">
          <div style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>
            {recordings.length} ENREGISTREMENT{recordings.length > 1 ? "S" : ""}
          </div>
          {[...recordings].reverse().map((rec, i) => {
            const isExpanded = expandedId === rec.id;
            const isCompare  = compareId  === rec.id;
            return (
              <div key={rec.id} className="rec-item">
                <div className="rec-item-header">
                  <div className="rec-item-icon">🎙</div>
                  <div className="rec-item-info">
                    <div className="rec-item-date">
                      {new Date(rec.date).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })}
                    </div>
                    <div className="rec-item-dur">{fmtTime(rec.duration)}</div>
                  </div>
                  <div className="rec-item-actions">
                    <button className="btn-small"
                      onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                      style={isExpanded ? { borderColor:"var(--teal)", color:"var(--teal2)" } : {}}>
                      {isExpanded ? "▲" : "▶ ÉCOUTER"}
                    </button>
                    <button className="btn-small"
                      onClick={() => setCompareId(isCompare ? null : rec.id)}
                      style={isCompare ? { borderColor:"var(--gold)", color:"var(--gold2)" } : {}}>
                      ⇌ COMPARER
                    </button>
                    <button className="btn-small"
                      onClick={() => handleDelete(rec.id)}
                      style={{ borderColor:"var(--red)", color:"var(--red)" }}>✕</button>
                  </div>
                </div>

                {/* Player */}
                {isExpanded && <MiniAudioPlayer src={getBlobUrl(rec)} color="var(--teal2)" />}

                {/* Compare side-by-side */}
                {isCompare && (
                  <ComparePlayer userSrc={getBlobUrl(rec)} refSrc={originalAudioUrl} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DecouverteMode ────────────────────────────────────────────────────────────
// Words hidden with RTL order numbers; clicking word N reveals all words 1→N
// A word can also be marked (or drilled down to letter level) as "à réviser".
function DecouverteMode({ ayat, surahNum, ld, setLData, audioUrl, timestamps }) {
  const words = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
  const [revealedUpTo, setRevealedUpTo] = React.useState(-1); // index of last revealed word
  const [markMode, setMarkMode]         = React.useState(false); // toggles 🔖 marking UI
  const [expandedWord, setExpandedWord] = React.useState(null);  // letter drill-down
  const [playingWord, setPlayingWord]   = React.useState(null);  // index currently playing
  const audioRef = React.useRef(null);
  const seqTokenRef = React.useRef(0); // cancels a stale sequential playback when superseded

  const hasToRevise = !!setLData;
  const { isActive, selWords, selChars, toggleWord: toggleWordBase, toggleChar } =
    useToRevise(ld, surahNum, ayat.numberInSurah, setLData);

  const toggleWord = (i) => {
    const wasSelected = toggleWordBase(i);
    if (wasSelected && expandedWord === i) setExpandedWord(null);
  };

  // Play the audio segment for a single word, using forced-alignment timestamps.
  // Resolves once the word's segment has finished (or immediately if it can't play).
  const hasTs = !!timestamps?.words;
  const playWordAsync = (i, myToken) => {
    return new Promise(resolve => {
      const a = audioRef.current;
      const word = timestamps?.words?.[i];
      if (!a || !audioUrl || !word) { resolve(); return; }
      const chars = fixChars(word.chars || []);
      if (!chars.length) { resolve(); return; }
      const startMs = chars[0].start;
      const endMs   = chars[chars.length - 1].end;
      if (a.src !== audioUrl) a.src = audioUrl;
      a.currentTime = startMs / 1000;
      setPlayingWord(i);
      a.play().then(() => {
        const checkEnd = () => {
          if (!audioRef.current || seqTokenRef.current !== myToken) { resolve(); return; }
          if (audioRef.current.currentTime * 1000 >= endMs) {
            audioRef.current.pause();
            resolve();
            return;
          }
          requestAnimationFrame(checkEnd);
        };
        requestAnimationFrame(checkEnd);
      }).catch(() => resolve());
    });
  };

  // Play words fromIdx..toIdx in reading order, one after another.
  // A newer call cancels any sequence still in flight.
  const playWordsSequential = async (fromIdx, toIdx) => {
    seqTokenRef.current += 1;
    const myToken = seqTokenRef.current;
    for (let i = fromIdx; i <= toIdx; i++) {
      if (seqTokenRef.current !== myToken) return;
      await playWordAsync(i, myToken);
      if (seqTokenRef.current !== myToken) return;
    }
    setPlayingWord(null);
  };

  React.useEffect(() => () => { seqTokenRef.current += 1; audioRef.current?.pause(); }, []);

  // In RTL the first word rendered (index 0) is the rightmost → that's the first word read
  // words[0] = first word in reading order, so displayed number = i + 1
  const displayNum = (i) => i + 1;
  const isRevealed = (i) => i <= revealedUpTo;

  const revealNext = () => setRevealedUpTo(v => Math.min(v + 1, words.length - 1));
  const reset      = () => setRevealedUpTo(-1);
  const revealAll  = () => setRevealedUpTo(words.length - 1);

  const revealed   = revealedUpTo + 1;
  const hidden     = words.length - revealed;
  const allShown   = revealedUpTo >= words.length - 1;

  const gold = 'var(--gold)'; const gold2 = 'var(--gold2)';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'14px 16px' }}>
      <audio ref={audioRef} style={{ display:'none' }}
        onEnded={() => setPlayingWord(null)}
        onPause={() => setPlayingWord(p => audioRef.current?.ended ? null : p)}
      />

      {/* Mark-to-revise toggle */}
      {hasToRevise && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:8, letterSpacing:1.5, color:'var(--text3)' }}>
            {markMode ? 'CLIQUEZ UN MOT RÉVÉLÉ POUR LE MARQUER' : ''}
          </div>
          <button onClick={() => { setMarkMode(v => !v); setExpandedWord(null); }} style={{
            marginRight:'auto', marginLeft: markMode ? 0 : 'auto',
            fontSize:8, letterSpacing:1.5, padding:'4px 12px', borderRadius:6, cursor:'pointer',
            fontFamily:"'Cinzel',serif", transition:'all .2s',
            background: markMode ? 'rgba(201,168,76,.15)' : isActive ? 'rgba(201,168,76,.08)' : 'transparent',
            border: `1px solid ${markMode || isActive ? gold : 'rgba(255,255,255,.15)'}`,
            color: markMode || isActive ? gold2 : 'var(--text3)',
          }}>{markMode ? '✕ TERMINER' : isActive ? '🔖 MARQUÉ — MODIFIER' : '🔖 MARQUER MOTS/LETTRES'}</button>
        </div>
      )}

      {/* Word display */}
      <div style={{ direction:'rtl', fontFamily:"'Amiri Quran',serif",
        lineHeight:2.4, textAlign:'center', padding:'12px 10px',
        background:'var(--surface3)', borderRadius:10, border:'1px solid var(--border)',
        display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', alignItems:'flex-end' }}>
        {words.map((w, i) => {
          const rev     = isRevealed(i);
          const num     = displayNum(i);
          const marked  = selWords.includes(i);
          const charSel = selChars[i] || [];
          const expanded= expandedWord === i;
          const playing = playingWord === i;
          const handleClick = () => {
            if (markMode) { if (rev) toggleWord(i); return; }
            if (!rev) {
              const fromIdx = revealedUpTo + 1; // first word newly revealed by this click
              setRevealedUpTo(i);
              if (hasTs && audioUrl) playWordsSequential(fromIdx, i);
            } else if (hasTs && audioUrl) {
              playWordsSequential(i, i);
            }
          };
          return (
            <span key={i}
              onClick={handleClick}
              style={{ display:'inline-flex', flexDirection:'column', alignItems:'center',
                gap:2, cursor: markMode ? (rev ? 'pointer' : 'default') : (hasTs && audioUrl) || !rev ? 'pointer' : 'default', userSelect:'none' }}>
              <span style={{
                display:'inline-block', padding:'2px 8px', borderRadius:6,
                fontFamily:"'Amiri Quran',serif", fontSize: rev ? 22 : 20,
                color: rev ? (marked ? gold2 : playing ? 'var(--teal2)' : 'var(--text1)') : 'transparent',
                background: rev ? (marked ? 'rgba(201,168,76,.15)' : playing ? 'rgba(62,184,160,.15)' : 'rgba(255,255,255,.03)') : 'rgba(255,255,255,.07)',
                border: rev ? `1px solid ${marked ? gold : playing ? 'var(--teal)' : 'rgba(255,255,255,.06)'}` : '1px solid rgba(255,255,255,.18)',
                minWidth: rev ? 0 : 34, textAlign:'center',
                boxShadow: marked ? '0 0 6px rgba(201,168,76,.3)' : playing ? '0 0 6px rgba(62,184,160,.35)' : 'none',
                transition:'all .25s',
              }}>{rev ? w : '▪▪▪'}</span>
              <span style={{ display:'flex', alignItems:'center', gap:3 }}>
                <span style={{ fontSize:7, letterSpacing:.5, lineHeight:1,
                  color: marked ? gold2 : rev ? 'rgba(255,255,255,.18)' : 'var(--teal2)',
                  fontFamily:"'Cinzel',serif" }}>{num}</span>
                {markMode && rev && (
                  <span onClick={e => { e.stopPropagation(); setExpandedWord(expanded ? null : i); }}
                    style={{ fontSize:7, color: charSel.length > 0 || expanded ? '#5bc8f5' : 'var(--text3)',
                      cursor:'pointer' }}>
                    {charSel.length > 0 ? charSel.length : '▾'}
                  </span>
                )}
              </span>
            </span>
          );
        })}
      </div>

      {/* Inline letter picker for the expanded word (mark mode only) */}
      {markMode && expandedWord !== null && (() => {
        const wi       = expandedWord;
        const w        = words[wi] || '';
        const clusters = splitArabicChars(w);
        const charSel  = selChars[wi] || [];
        return (
          <div style={{ direction:'rtl', display:'flex', flexWrap:'wrap', gap:4,
            padding:'8px 10px', background:'rgba(91,200,245,.06)',
            border:'1px solid rgba(91,200,245,.2)', borderRadius:8 }}>
            <div style={{ width:'100%', fontSize:7, letterSpacing:1.5, color:'#5bc8f5',
              fontFamily:"'Cinzel',serif", marginBottom:4, textAlign:'right' }}>
              LETTRES DE : {w}
            </div>
            {clusters.map((c, ci) => {
              const cSel = charSel.includes(ci);
              return (
                <button key={ci} onClick={() => toggleChar(wi, ci)} style={{
                  fontFamily:"'Amiri Quran',serif", fontSize:22,
                  padding:'4px 8px', minWidth:34, borderRadius:6, cursor:'pointer',
                  background: cSel ? 'rgba(91,200,245,.2)' : 'rgba(255,255,255,.05)',
                  border:`1px solid ${cSel ? '#5bc8f5' : 'rgba(255,255,255,.12)'}`,
                  color: cSel ? '#5bc8f5' : 'var(--text1)',
                  boxShadow: cSel ? '0 0 6px rgba(91,200,245,.35)' : 'none',
                  transition:'all .12s' }}>{c}</button>
              );
            })}
            <button onClick={() => setExpandedWord(null)}
              style={{ marginRight:'auto', fontSize:7, padding:'4px 8px', borderRadius:5,
                background:'transparent', border:'1px solid rgba(255,255,255,.1)',
                color:'var(--text3)', cursor:'pointer', fontFamily:"'Cinzel',serif",
                letterSpacing:1 }}>✕ FERMER</button>
          </div>
        );
      })()}

      {/* Progress bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ flex:1, height:4, borderRadius:2, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
          <div style={{ width:`${(revealed/words.length)*100}%`, height:'100%',
            background:'var(--teal)', transition:'width .3s', borderRadius:2 }} />
        </div>
        <span style={{ fontSize:8, letterSpacing:1, color:'var(--text3)', flexShrink:0,
          fontFamily:"'Cinzel',serif" }}>{revealed}/{words.length}</span>
      </div>

      {/* Controls */}
      <div style={{ display:'flex', gap:8 }}>
        {!allShown ? (
          <button onClick={revealNext}
            style={{ flex:1, padding:'10px', background:'var(--teal)', border:'none',
              borderRadius:8, color:'#fff', fontSize:9, letterSpacing:2,
              fontFamily:"'Cinzel',serif", cursor:'pointer' }}>
            ▶ SUIVANT · {hidden} MOT{hidden>1?'S':''}
          </button>
        ) : (
          <div style={{ flex:1, textAlign:'center', fontSize:9, letterSpacing:2,
            color:'var(--green)', fontFamily:"'Cinzel',serif", padding:'10px' }}>✓ COMPLET</div>
        )}
        <button onClick={reset}
          style={{ padding:'10px 14px', background:'transparent',
            border:'1px solid var(--border2)', borderRadius:8,
            color:'var(--text3)', fontSize:13, cursor:'pointer' }}>↺</button>
        {!allShown && (
          <button onClick={revealAll}
            style={{ padding:'10px 14px', background:'transparent',
              border:'1px solid var(--border2)', borderRadius:8,
              color:'var(--text3)', fontSize:9, letterSpacing:1,
              fontFamily:"'Cinzel',serif", cursor:'pointer' }}>TOUT</button>
        )}
      </div>
    </div>
  );
}

function LectureMode({ ayat, surahNum, audioUrl, isMainPlaying, timestamps, onLoadTimestamps, onUpdateTimestamps, onLocalPlay }) {
  const audioRef  = useRef(null);
  const rafRef    = useRef(null);
  const [lectureTab, setLectureTab]         = useState("listen"); // "listen" | "record"
  const [currentMs, setCurrentMs]   = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [editTs, setEditTs] = useState(null);
  useEffect(() => { if (timestamps) setEditTs(JSON.parse(JSON.stringify(timestamps))); }, [timestamps]);

  const stop    = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } onLocalPlay?.(null); };
  useEffect(() => { if (isMainPlaying && audioRef.current) { audioRef.current.pause(); stop(); } }, [isMainPlaying]);
  const onPlay  = () => {
    const tick = () => {
      if (audioRef.current) {
        const ms = audioRef.current.currentTime * 1000;
        setCurrentMs(ms);
        onLocalPlay?.(ms);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const onPause = () => stop();
  const onEnded = () => { stop(); setCurrentMs(0); };

  const handleFile = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { try { onLoadTimestamps(JSON.parse(ev.target.result)); } catch { alert("JSON invalide"); } };
    r.readAsText(f);
  };

  const isDiacritic = ch => /[\u064B-\u065F\u0670]/.test(ch);

  const setCharField = (wi, ci, field, val) => {
    setEditTs(prev => {
      const next  = JSON.parse(JSON.stringify(prev));
      const chars = next.words[wi].chars;
      chars[ci][field] = Number(val);
      if (field === 'end') {
        let j = ci + 1;
        while (j < chars.length && isDiacritic(chars[j].char)) { chars[j].start = Number(val); chars[j].end = Number(val); j++; }
        if (j < chars.length && !isDiacritic(chars[j].char)) chars[j].start = Number(val);
      }
      if (field === 'start') {
        if (isDiacritic(chars[ci].char)) {
          let j = ci - 1;
          while (j >= 0 && isDiacritic(chars[j].char)) j--;
          if (j >= 0) { chars[j].start = Number(val); }
        } else {
          let j = ci - 1;
          while (j >= 0 && isDiacritic(chars[j].char)) j--;
          if (j >= 0) chars[j].end = Number(val);
        }
      }
      return next;
    });
  };

  const captureStart = (wi, ci) => {
    const ms = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setCharField(wi, ci, 'start', ms);
  };
  const captureEnd = (wi, ci) => {
    const ms = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setCharField(wi, ci, 'end', ms);
  };

  const saveAndExport = () => {
    onUpdateTimestamps(editTs);
    const blob = new Blob([JSON.stringify(editTs, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `timestamps_ayat_${ayat.numberInSurah}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const ts = showEditor ? editTs : timestamps;

  const [localPlaying, setLocalPlaying] = useState(false);
  const [localCurrentMs, setLocalCurrentMs] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);

  const handlePlay2 = () => { setLocalPlaying(true); onPlay(); };
  const handlePause2 = () => { setLocalPlaying(false); onPause(); };
  const handleEnded2 = () => { setLocalPlaying(false); onEnded(); setLocalCurrentMs(0); };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  };

  const seek = (e) => {
    if (!audioRef.current || !localDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * (localDuration / 1000);
  };

  const fmt = ms => {
    if (!ms) return "0:00";
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  };

  const pct = localDuration > 0 ? Math.min(1, localCurrentMs / localDuration) : 0;

  // Keep localCurrentMs in sync with onPlay tick
  const origOnPlay = onPlay;
  const onPlay2 = () => {
    const tick = () => {
      if (audioRef.current) {
        const ms = audioRef.current.currentTime * 1000;
        setLocalCurrentMs(ms);
        onLocalPlay?.(ms);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Tab bar */}
      <div style={{ display:"flex", gap:6 }}>
        {[["listen","📖 ÉCOUTER"],["record","🎙 ENREGISTRER"]].map(([id,label])=>(
          <button key={id} onClick={() => setLectureTab(id)} style={{
            fontSize:8, letterSpacing:2, padding:"5px 14px", fontFamily:"'Cinzel',serif",
            background: lectureTab===id ? "rgba(201,168,76,.12)" : "transparent",
            border: `1px solid ${lectureTab===id ? "var(--gold)" : "var(--border2)"}`,
            color: lectureTab===id ? "var(--gold2)" : "var(--text3)",
            borderRadius:6, cursor:"pointer", transition:"all .15s",
          }}>{label}</button>
        ))}
      </div>

      {lectureTab === "listen" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)", fontFamily:"'Cinzel',serif" }}>
              AYAT {ayat.numberInSurah}
            </div>
            {timestamps && (
              <button onClick={() => setShowEditor(s => !s)} style={{
                fontSize:7, letterSpacing:1, padding:"3px 10px", fontFamily:"'Cinzel',serif",
                background: showEditor ? "rgba(201,168,76,.1)" : "transparent",
                border:`1px solid ${showEditor?"var(--gold)":"var(--border2)"}`,
                color: showEditor ? "var(--gold2)" : "var(--text3)",
                borderRadius:4, cursor:"pointer",
              }}>{showEditor ? "✕ FERMER ÉDITEUR" : "✏ TIMESTAMPS"}</button>
            )}
          </div>

          {/* Custom player */}
          <div style={{
            background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
            padding:"12px 14px", display:"flex", flexDirection:"column", gap:10,
          }}>
            {/* Hidden native audio */}
            <audio ref={audioRef} src={audioUrl}
              onPlay={onPlay2} onPause={handlePause2} onEnded={handleEnded2}
              onLoadedMetadata={() => setLocalDuration((audioRef.current?.duration||0)*1000)}
              onTimeUpdate={() => setLocalCurrentMs((audioRef.current?.currentTime||0)*1000)}
              style={{ display:"none" }} />

            {/* Progress bar */}
            <div onClick={seek} style={{
              height:4, background:"var(--surface3)", borderRadius:2, cursor:"pointer",
              position:"relative", overflow:"hidden",
            }}>
              <div style={{
                position:"absolute", left:0, top:0, bottom:0,
                width:`${pct*100}%`, background:"var(--gold)",
                borderRadius:2, transition:"width .1s linear",
              }}/>
            </div>

            {/* Controls row */}
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              {/* Play/pause */}
              <button onClick={togglePlay} style={{
                width:36, height:36, borderRadius:"50%",
                background: localPlaying ? "rgba(201,168,76,.15)" : "rgba(62,184,160,.12)",
                border:`1px solid ${localPlaying ? "var(--gold)" : "var(--teal)"}`,
                color: localPlaying ? "var(--gold2)" : "var(--teal2)",
                fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0, transition:"all .15s",
              }}>{localPlaying ? "⏸" : "▶"}</button>

              {/* Time */}
              <div style={{ fontSize:8, letterSpacing:1, color:"var(--text3)", fontFamily:"'Cinzel',serif", flexShrink:0 }}>
                {fmt(localCurrentMs)} / {fmt(localDuration)}
              </div>

              {/* Spacer */}
              <div style={{ flex:1 }}/>

              {/* TS load if none */}
              {!timestamps && (
                <label style={{ cursor:"pointer" }}>
                  <input type="file" accept=".json" onChange={handleFile} style={{ display:"none" }} />
                  <span style={{ fontSize:7, letterSpacing:1, padding:"3px 10px",
                    border:"1px solid var(--border2)", borderRadius:4, color:"var(--text3)",
                    fontFamily:"'Cinzel',serif", whiteSpace:"nowrap" }}>📂 TS</span>
                </label>
              )}
              {timestamps && <div style={{ fontSize:7, color:"var(--teal2)", letterSpacing:1 }}>⚡ TS</div>}
            </div>
          </div>

          {/* TS editor */}
          {showEditor && editTs?.words && (
            <EditorWords editTs={editTs} currentMs={localCurrentMs} setCharField={setCharField}
              captureStart={captureStart} captureEnd={captureEnd}
              onSave={saveAndExport} onReset={() => setEditTs(JSON.parse(JSON.stringify(timestamps)))}
              isDiacritic={isDiacritic} audioRef={audioRef} />
          )}
        </div>
      )}

      {lectureTab === "record" && (
        <VoiceRecorder
          ayat={ayat}
          surahNum={surahNum}
          originalAudioUrl={audioUrl}
          localAudioRef={audioRef}
        />
      )}
    </div>
  );
}

// ─── Normalise Arabic text for comparison ────────────────────────────────────
// Step 1 : unify all alef/hamza variants BEFORE stripping diacritics
//   ٱ (wasl \u0671) → special marker W so we can detect it as silent later
//   أ إ آ ء ؤ ئ → ا  (all treated as plain alef for phonetic matching)
// Step 2 : strip tashkeel, tatweel, extra spaces
function normalizeArabic(str) {
  if (!str) return "";
  return str
    // ── Letter unification ───────────────────────────────────────────────────
    // Unify ALL alef/hamza variants → plain alef ا
    .replace(/[\u0671\u0623\u0625\u0622\u0624\u0626]/g, "\u0627")
    // Farsi Yeh ی (\u06CC) → Arabic Yeh ي (\u064A)
    .replace(/\u06CC/g, "\u064A")
    // Heh Goal ہ (\u06C1) / Heh Doachashmee ھ (\u06BE) → Heh ه (\u0647)
    .replace(/[\u06C1\u06BE]/g, "\u0647")
    // Teh Marbuta Goal ۃ (\u06C3) → Teh Marbuta ة (\u0629)
    .replace(/\u06C3/g, "\u0629")
    // ── Dagger alif expansion ───────────────────────────────────────────────
    // ىٰ (alef maqsura + dagger alif) → ا  BEFORE dagger alif expansion
    .replace(/\u0649\u0670/g, "\u0627")
    // Dagger alif ٰ (\u0670): remove diacritics between base letter and ٰ, then expand
    .replace(/([\u0600-\u06FF])[\u064B-\u065F]+([\u0670])/g, "$1$2")
    .replace(/([^\u0627\u0020])(\u0670)/g, "$1\u0627")
    .replace(/\u0670/g, "")
    // ── Alef maqsura ى rules (BEFORE diacritic stripping) ──────────────────
    .replace(/\u0649(?=[\u0600-\u06FF])/g, "\u064A")
    // ىا → ا
    .replace(/\u0649\u0627/g, "\u0627")
    // final ى after fatha or tanwin fath → ا (e.g. هُدًى، عَلَى)
    .replace(/[\u064E\u064B]\u0649(\s|$)/g, "\u0627$1")
    .replace(/[\u064E\u064B]\u0649$/g, "\u0627")
    // final ى after kasra/damma → ي (e.g. فِى = في)
    .replace(/[\u0650\u064F]\u0649(\s|$)/g, "\u064A$1")
    .replace(/[\u0650\u064F]\u0649$/g, "\u064A")
    // all other final ى (bare, no vowel) → ا
    .replace(/\u0649(\s|$)/g, "\u0627$1")
    .replace(/\u0649$/g, "\u0627")
    // ── Strip all diacritics and Quranic annotation marks ───────────────────
    // Standard tashkeel (\u064B-\u065F) + kashida (\u0640)
    .replace(/[\u0640\u064B-\u065F]/g, "")
    // Quranic marks block 1: \u0610-\u061A
    .replace(/[\u0610-\u061A]/g, "")
    // Quranic marks block 2: \u06D6-\u06ED
    .replace(/[\u06D6-\u06ED]/g, "")
    // Quranic Extended Supplement \u0870-\u08FF (incl. \u08F0-\u08F4 open tanwin/vowels)
    .replace(/[\u0870-\u08FF]/g, "")
    // Arabic Presentation Forms that slip through: \uFB50-\uFDFF, \uFE70-\uFEFF
    .replace(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Silent letter detection ──────────────────────────────────────────────────
// Rules applied on the NORMALISED word (after normalizeArabic).
// Returns a Set of char indices that are silent (shown in gold, not penalised).

// Map of words with well-known silent letters (key = normalised form)
const SILENT_WORD_MAP = {
  // ال + noun : leading ا is hamza wasl → silent when preceded by another word
  // (handled generically below via \u0671 detection on raw word)
  "ذلك":    new Set([1]),   // silent ل : pronounced "zaalik"
  "داود":   new Set([2]),   // silent و : pronounced "daawud"
  "طاوس":   new Set([2]),   // silent و
  "اسم":    new Set([0]),   // hamza wasl in بِسْمِ
};

// ─── Hamza wasl vowel at sentence start ──────────────────────────────────────
// Returns the vowel to expect when hamza wasl is pronounced (first word of sentence):
//   'fatha'  (اَ) → word starts with ال (definite article)
//   'damma'  (اُ) → 3rd letter of raw word carries a damma  ُ  (ُ)
//   'kasra'  (اِ) → default (most verb forms, masdar, etc.)
function getWaslVowel(rawWord) {
  // Remove initial ا/ٱ to inspect the rest
  const body = rawWord.replace(/^[اٱ]/, '');
  // Rule 1 : starts with لا or لْ → definite article → fatha
  if (/^ل[اَُِْ]/.test(body) || /^لل/.test(body)) return 'fatha';
  // Rule 2 : 3rd letter of the original word (index 2) carries damma ُ (ُ)
  // The 3rd letter = rawWord[2] but diacritics may sit between letters.
  // Walk char by char skipping diacritics to find the 3rd base letter.
  const DIACRITICS = /[ً-ٟؐ-ؚۖ-ۜ۟-۪ۤۧۨ-ۭ]/;
  let letterCount = 0;
  for (let i = 0; i < rawWord.length; i++) {
    if (!DIACRITICS.test(rawWord[i])) letterCount++;
    if (letterCount === 3) {
      // Check if any diacritic immediately after this base letter is damma
      let j = i + 1;
      while (j < rawWord.length && DIACRITICS.test(rawWord[j])) {
        if (rawWord[j] === 'ُ') return 'damma'; // ُ
        j++;
      }
      break;
    }
  }
  // Rule 3 : default → kasra
  return 'kasra';
}

// wordIndex : 0 = first word of sentence (after pause/start) → wasl is PRONOUNCED
function getSilentIndices(normWord, rawWord, wordIndex = 0) {
  const silent = new Set();
  const isFirstWord = (wordIndex === 0);

  // Rule 1 : explicit word map
  if (SILENT_WORD_MAP[normWord]) return SILENT_WORD_MAP[normWord];

  // Rule 2 : Hamza wasl (ٱ \u0671) at position 0
  // SILENT in connected speech (wordIndex > 0).
  // At sentence start (wordIndex === 0) it is PRONOUNCED — not marked silent.
  if (rawWord && rawWord[0] === '\u0671' && !isFirstWord) {
    silent.add(0);
  }

  // Rule 3 : ال definite article – leading ا/ٱ is wasl
  // SILENT in connected speech, PRONOUNCED if first word of sentence.
  if (/^\u0627\u0644/.test(normWord) && !isFirstWord) {
    const firstRaw = rawWord ? rawWord[0] : '';
    if (firstRaw === '\u0671' || firstRaw === '\u0627') {
      silent.add(0);
    }
  }

  // Rule 4 : ألف الفارقة — trailing ا after plural واو — ALWAYS silent
  if (/\u0648\u0627$/.test(normWord) && normWord.length > 2) {
    silent.add(normWord.length - 1);
  }

  return silent;
}

// ─── Character-level diff within a word ──────────────────────────────────────
// Returns array of {char, status: 'ok'|'err'|'miss'|'silent'}
// ─── Character-level Levenshtein alignment ───────────────────────────────────
// Returns aligned pairs [{refChar, gotChar, op}]
// op: 'match' | 'sub' | 'ins' | 'del'
// ─── Arabic phonetic proximity ────────────────────────────────────────────────
// Cost 0   = identical
// Cost 0.3 = very close  (same articulation point, only emphasis/voicing differs)
// Cost 0.6 = close       (same broad category: stops, fricatives, gutturals…)
// Cost 1   = unrelated   (default)
//
// Groups based on makhraj (articulation point) and sifa (manner):
//   Emphatic pairs     س↔ص  ز↔ظ  د↔ض  ت↔ط   → 0.3
//   Voiced pairs      ب↔پ  ك↔ق  ف↔ب         → 0.4 (partial)
//   Gutturals         ع↔غ  ح↔خ  ه↔ح  ء↔ع   → 0.3
//   Sibilants         س↔ش  ز↔س  ص↔ض         → 0.4
//   Laterals/nasals   ل↔ن  م↔ن              → 0.5
//   Alef variants     ا↔ء  ا↔ع              → 0.4
const PHONO_PAIRS = new Map();
function addPair(a, b, cost) {
  PHONO_PAIRS.set(a + b, cost);
  PHONO_PAIRS.set(b + a, cost);
}
// Emphatic ↔ non-emphatic (same makhraj, only tafkhim differs) — very close
addPair('س','ص', 0.3);  addPair('ز','ظ', 0.3);  addPair('ز','ض', 0.35);
addPair('د','ض', 0.3);  addPair('ت','ط', 0.3);   addPair('ذ','ظ', 0.3);
// Gutturals / pharyngeals
addPair('ع','غ', 0.3);  addPair('ح','خ', 0.3);   addPair('ه','ح', 0.35);
addPair('ة','ه', 0.1);
addPair('ا','ع', 0.4);
// Sibilants
addPair('س','ش', 0.4);  addPair('ز','س', 0.4);   addPair('ص','ض', 0.4);
// Stops
addPair('ك','ق', 0.4);  addPair('ب','ف', 0.45);  addPair('ت','د', 0.4);
addPair('ك','خ', 0.45);
// Nasals / liquids
addPair('م','ن', 0.5);  addPair('ل','ن', 0.5);   addPair('ل','ر', 0.45);
// Semivowels
addPair('و','ب', 0.5);  addPair('ي','ء', 0.45);
// Lam shamsiyya: ل assimilates into solar letters — treat as near
['ت','ث','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ن'].forEach(c => addPair('ل', c, 0.3));

// Solar letters (lam assimilates into them in ال)
const SOLAR_LETTERS = new Set(['ت','ث','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ل','ن']);

function phonoCost(a, b) {
  if (a === b) return 0;
  return PHONO_PAIRS.get(a + b) ?? 1;
}

// Phonetic closeness threshold: cost ≤ this → status 'near' instead of 'err'
const NEAR_THRESHOLD = 0.5;

function levenshteinChars(refChars, gotChars) {
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

// Remove assimilated lam from a word string (لا → لا kept; لت → ت for solar)
// Used to pre-process user input for comparison when ref has lam shamsiyya
function removeSolarLam(word) {
  // Match ال or ل at start followed by solar letter
  return word.replace(/^(ا?ل)([تثدذرزسشصضطظلن])/u, '$2');
}

// Check if a word starts with al- + solar letter
function hasSolarLam(word) {
  return /^ا?ل[تثدذرزسشصضطظلن]/u.test(word);
}

function diffWord(refRaw, gotRaw, wordIndex = 0) {
  if (!refRaw) return [];
  if (!gotRaw) gotRaw = '';

  // Solar/lunar lam rule: if ref has ال+solar, allow user to omit/assimilate the lam
  const refHasSolar = hasSolarLam(normalizeArabic(refRaw));
  if (refHasSolar) {
    const gotN = normalizeArabic(gotRaw);
    const refStripped = removeSolarLam(normalizeArabic(refRaw));
    const gotStripped = removeSolarLam(gotN);
    // If user said the word without lam (assimilated), treat lam as silent/ok
    if (refStripped === gotStripped || normalizeArabic(refRaw) === gotStripped) {
      // Build result: mark the lam char as 'near' (accepted), rest as ok
      const refCharsDisplay = [...normalizeArabic(refRaw)];
      return refCharsDisplay.map((ch, i) => {
        const isSolarLamPos = i === 1 && ch === 'ل' && SOLAR_LETTERS.has(refCharsDisplay[i+1]);
        const isAlefPos = i === 0 && ch === 'ا';
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

  // Build rawSegments: one entry per base letter with its trailing diacritics
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

  // Separate phonetic (non-silent) ref chars and build index mapping
  // phoneticIndices[i] = original refN index of the i-th phonetic char
  const phoneticIndices = [];
  const phoneticRefChars = [];
  for (let i = 0; i < refN.length; i++) {
    if (!silent.has(i)) {
      phoneticIndices.push(i);
      phoneticRefChars.push(refN[i]);
    }
  }

  // Strip silent trailing chars from gotN too (alef al-fariqa واو جماعة)
  let gotNPhonetic = gotN;
  if (silent.has(refN.length - 1) && gotNPhonetic.endsWith(refN[refN.length - 1])) {
    gotNPhonetic = gotNPhonetic.slice(0, -1);
  }

  // Levenshtein alignment on phonetic chars vs got chars
  const gotChars = [...gotNPhonetic];
  const alignment = levenshteinChars(phoneticRefChars, gotChars);

  // Build a map: refN index → status (only for non-silent chars)
  // alignment entries with op='del' map to a ref char with no got match
  const statusMap = new Map(); // refN index → 'ok'|'err'|'miss'
  let phoneticPtr = 0;
  for (const a of alignment) {
    if (a.op === 'ins') continue; // no ref char to map to
    const refIdx = phoneticIndices[phoneticPtr++];
    if (refIdx === undefined) break;
    statusMap.set(refIdx, {
      status: a.op === 'match' ? 'ok'   :
              a.op === 'near'  ? 'near' :
              a.op === 'del'   ? 'miss' : 'err',
      cost: a.cost ?? 1
    });
  }

  // Rebuild result array using rawSegments for display (keeps diacritics)
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

// ─── Levenshtein word-level alignment ────────────────────────────────────────
// Words are considered "equal" if their edit distance ≤ 1 char (handles ٰ alef drift)
function wordEditDist(a, b) {
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

function levenshteinAlign(refWords, userWords) {
  const R = refWords.length, U = userWords.length;
  const dp = Array.from({ length: R + 1 }, (_, r) =>
    Array.from({ length: U + 1 }, (_, u) => (r === 0 ? u : u === 0 ? r : 0))
  );
  for (let r = 1; r <= R; r++) {
    for (let u = 1; u <= U; u++) {
      const dist = wordEditDist(refWords[r-1], userWords[u-1]);
      const eq   = dist <= 1; // allow 1-char difference (ٰ drift, hamza variants)
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
      // Prefer del/ins over sub when all options have equal cost
      // This ensures a single user word aligns with the FIRST ref word, not the last
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
    // Fallback: take diagonal (sub/match)
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

function compareRecitation(refText, userText) {
  if (!refText || !userText) return { wordResults: [], score: 0 };
  const QURANIC_MARKS = /[\u06D6-\u06ED\u0610-\u061A\u0600-\u0605\u0615]/g;
  const clean = s => s.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ');
  const refWords  = clean(refText).split(' ').map(w => w.replace(QURANIC_MARKS, '')).filter(Boolean);
  const userWords = clean(userText).split(' ').filter(Boolean);

  // Levenshtein alignment
  const aligned = levenshteinAlign(refWords, userWords);

  // Penalty weights (in "virtual wrong chars" added to the denominator/numerator)
  // sub  : slight mismatch — char-level diff already handles most of it, small extra
  // del  : user skipped the word entirely — moderate penalty on top of all-miss chars
  // ins  : user added a word not in ref — strongest penalty
  const PENALTY = { sub: 0.5, del: 1.5, ins: 3 };

  let totalPoints = 0, earnedPoints = 0;
  let refIdx = 0;

  // Count insertions separately — repetitions (word already in ref) are excluded
  const refWordsNorm = refWords.map(normalizeArabic);
  const insertions = aligned.filter(a => {
    if (a.op !== 'ins') return false;
    const n = normalizeArabic(a.user);
    return !refWordsNorm.includes(n); // repetition → not penalised
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

      // Char-level points — 'near' (similar letters) gets full credit, same as 'ok'
      const scored  = chars.filter(c => c.status !== 'silent');
      const okCount = scored.reduce((acc, c) => {
        if (c.status === 'ok' || c.status === 'near') return acc + 1; // no penalty for similar letters
        return acc;
      }, 0);
      totalPoints  += scored.length;
      earnedPoints += okCount;

      // Word-level penalty only for deletions (skipped words); sub uses char diff only
      if (a.op === 'del') {
        totalPoints  += PENALTY.del;
      }

      const wordOk = a.op === 'match';
      return { ref: a.ref, user: a.user, op: a.op, chars, wordOk };
    });

  // Insertion penalty: each extra word costs PENALTY.ins virtual points
  totalPoints  += insertions.length * PENALTY.ins;
  // (no earned points for insertions)

  const score = totalPoints > 0 ? Math.max(0, Math.round((earnedPoints / totalPoints) * 100)) : 0;
  return { wordResults, score, insertions };
}

function RecitationChecker({ ayat, saveScore, attempts }) {
  const { activeInput: arabicActiveInput } = useArabicKeyboard();
  const [typedText, setTypedText]       = useState("");
  const [transcript, setTranscript]     = useState("");
  const [recResult, setRecResult]       = useState(null);
  const [recording, setRecording]       = useState(false);
  const [showDebug, setShowDebug]       = useState(false);
  const [inputMode, setInputMode]       = useState('mic');
  const [userAudioUrl, setUserAudioUrl] = useState(null);
  const [recitOpen, setRecitOpen]       = useState(false);
  const [histOpen, setHistOpen]         = useState(false);

  // ── Refs — même architecture que toggleVoice/spawnRecognition ──
  const shouldRef      = useRef(false);   // true = session doit rester active
  const isStartingRef  = useRef(false);   // verrou anti-overlap
  const recInstanceRef = useRef(null);    // instance SR active
  const audioRecRef    = useRef(null);    // createAudioRecorder() instance
  const restartTimerRef= useRef(null);    // setTimeout de respawn
  const contFailsRef   = useRef(0);       // échecs consecutive de continuous:true
  const finalTextRef   = useRef("");      // accumule les résultats finaux entre sessions

  const refText = ayat.text || "";

  // ── Nettoyage au démontage ──
  useEffect(() => () => {
    clearTimeout(restartTimerRef.current);
    if (userAudioUrl) URL.revokeObjectURL(userAudioUrl);
    audioRecRef.current?.release();
  }, []); // eslint-disable-line

  const clearRestartTimer = () => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
  };

  // ── Callback résultat — traite un transcript final ──
  const handleTranscript = useCallback((text) => {
    if (!text?.trim()) return;
    finalTextRef.current = (finalTextRef.current + " " + text).trim();
    setTranscript(finalTextRef.current);
    const res = compareRecitation(refText, finalTextRef.current);
    const r = { ...res, source: 'mic' };
    setRecResult(r);
    saveScore?.({ score: r.score, source: 'mic', date: new Date().toISOString() });
  }, [refText]);

  // ── Bridge Android natif (même pattern que QuranApp.onSpeechResult) ──
  useEffect(() => {
    window.RecitApp = window.RecitApp || {};
    window.RecitApp.onSpeechResult = (text) => {
      handleTranscript(text);
      if (shouldRef.current) {
        try { window.Android?.startSpeechRecognition('ar-SA'); } catch {}
      } else {
        setRecording(false);
      }
    };
    window.RecitApp.onSpeechError = () => {
      if (shouldRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          try { window.Android?.startSpeechRecognition('ar-SA'); } catch {}
        }, 700);
      } else {
        setRecording(false);
      }
    };
    return () => {
      clearTimeout(restartTimerRef.current);
      if (window.RecitApp) { window.RecitApp.onSpeechResult = null; window.RecitApp.onSpeechError = null; }
    };
  }, [handleTranscript]);

  // ── spawnRecognition — même logique que le code de commande vocale ──
  const spawnRecognition = useCallback((useContinuous) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !shouldRef.current || isStartingRef.current) return;

    // Détruire l'instance précédente proprement (empêche les callbacks zombies)
    if (recInstanceRef.current) {
      try {
        recInstanceRef.current.onend    = null;
        recInstanceRef.current.onerror  = null;
        recInstanceRef.current.onresult = null;
        recInstanceRef.current.abort();
      } catch {}
      recInstanceRef.current = null;
    }

    isStartingRef.current = true;
    const rec = new SR();
    rec.lang            = 'ar-SA';
    rec.continuous      = useContinuous;
    rec.interimResults  = false;
    rec.maxAlternatives = 1;
    recInstanceRef.current = rec;

    rec.onstart = () => {
      isStartingRef.current = false;
      if (useContinuous) contFailsRef.current = 0;
      setRecording(true);
    };

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handleTranscript(e.results[i][0].transcript.trim());
      }
    };

    rec.onerror = (e) => {
      isStartingRef.current = false;
      clearRestartTimer();

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        shouldRef.current = false;
        setRecording(false);
        alert("Microphone refusé — vérifiez les permissions.");
        return;
      }

      if (e.error === 'aborted') {
        if (!shouldRef.current) { setRecording(false); return; }
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 400);
        return;
      }

      if (e.error === 'audio-capture') {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 1200);
        return;
      }

      if (e.error === 'network') {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 2500);
        return;
      }

      if (shouldRef.current) {
        restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 350);
      }
    };

    rec.onend = () => {
      isStartingRef.current = false;

      if (!shouldRef.current) {
        // Arrêt voulu — SR a libéré le micro, on peut maintenant enregistrer
        setRecording(false);
        if (IS_ANDROID && !audioRecRef.current) {
          // Lancer un enregistrement court pour capturer la récitation rejouée ou vide
          // (sur Android on ne peut pas enregistrer en parallèle de la SR)
          // → rien à faire ici, le flux audio SR n'est pas capturable a posteriori
        }
        return;
      }

      if (useContinuous) {
        contFailsRef.current += 1;
        clearRestartTimer();
        if (contFailsRef.current >= 2) {
          restartTimerRef.current = setTimeout(() => spawnRecognition(false), 300);
        } else {
          restartTimerRef.current = setTimeout(() => spawnRecognition(true), 300);
        }
      } else {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => spawnRecognition(false), 200);
      }
    };

    try {
      rec.start();
    } catch(err) {
      isStartingRef.current = false;
      restartTimerRef.current = setTimeout(() => spawnRecognition(useContinuous), 600);
    }
  }, [handleTranscript]);

  // ── Bouton micro — toggle démarrage/arrêt ──
  const toggleMic = useCallback(() => {
    if (shouldRef.current) {
      // ── ARRÊT ──
      shouldRef.current = false;
      clearRestartTimer();
      isStartingRef.current = false;

      if (recInstanceRef.current) {
        try {
          recInstanceRef.current.onend    = null;
          recInstanceRef.current.onerror  = null;
          recInstanceRef.current.abort();
        } catch {}
        recInstanceRef.current = null;
      }
      try { window.Android?.stopSpeechRecognition(); } catch {}

      // Récupérer l'audio enregistré (web seulement — sur Android audioRecRef est null)
      if (audioRecRef.current) {
        audioRecRef.current.stop().then(url => {
          audioRecRef.current = null;
          if (url) setUserAudioUrl(url);
        }).catch(() => { audioRecRef.current = null; });
      }

      setRecording(false);
    } else {
      // ── DÉMARRAGE ──
      shouldRef.current = true;
      contFailsRef.current = 0;
      finalTextRef.current = "";
      setTranscript("");
      setRecResult(null);
      if (userAudioUrl) { URL.revokeObjectURL(userAudioUrl); setUserAudioUrl(null); }

      // NE PAS démarrer CapacitorAudioRecorder en même temps que SpeechRecognition sur Android :
      // les deux se battent pour le hardware micro → SR reçoit onstart puis onend immédiat sans onresult.
      // L'enregistrement audio est désactivé sur Android (IS_ANDROID), actif uniquement sur web.
      if (!IS_ANDROID) {
        const arec = createAudioRecorder();
        audioRecRef.current = arec;
        arec.start().catch(e => {
          audioRecRef.current = null;
        });
      }

      // Couche 1 : bridge Android natif
      if (window.Android && typeof window.Android.startSpeechRecognition === 'function') {
        setRecording(true);
        try {
          window.Android.startSpeechRecognition('ar-SA');
        } catch {
          spawnRecognition(false);
        }
      } else if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        // Sessions courtes directement — continuous:true ne fonctionne pas sur Android WebView
        spawnRecognition(IS_ANDROID ? false : true);
      } else {
        shouldRef.current = false;
        alert("Reconnaissance vocale non supportée dans ce navigateur.");
      }
    }
  }, [spawnRecognition, userAudioUrl]);

  const checkTyped = () => {
    if (!typedText.trim()) return;
    const res = compareRecitation(refText, typedText.trim());
    const r = { ...res, source: 'text' };
    setRecResult(r);
    saveScore?.({ score: r.score, source: 'text', date: new Date().toISOString() });
  };

  const reset = () => {
    if (shouldRef.current) {
      shouldRef.current = false;
      clearRestartTimer();
      isStartingRef.current = false;
      if (recInstanceRef.current) {
        try { recInstanceRef.current.onend = null; recInstanceRef.current.onerror = null; recInstanceRef.current.abort(); } catch {}
        recInstanceRef.current = null;
      }
      try { window.Android?.stopSpeechRecognition(); } catch {}
      audioRecRef.current?.stop().catch(() => {});
      audioRecRef.current = null;
      setRecording(false);
    }
    finalTextRef.current = "";
    if (userAudioUrl) { URL.revokeObjectURL(userAudioUrl); setUserAudioUrl(null); }
    setTypedText(""); setTranscript(""); setRecResult(null);
  };

  const scoreClass = !recResult ? "" : recResult.score === 100 ? "perfect" : recResult.score >= 70 ? "good" : "bad";

  const bestScore = attempts?.length > 0 ? Math.max(...attempts.map(a => a.score)) : null;

  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginTop:8 }}>
      {/* Toggleable header */}
      <button onClick={() => setRecitOpen(v => !v)} style={{
        width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"8px 12px", background:"var(--surface2)", border:"none", cursor:"pointer",
        fontFamily:"'Cinzel',serif",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>🎙 CORRECTION DE RÉCITATION</span>
          {bestScore !== null && (
            <span style={{ fontSize:8, padding:"2px 8px", borderRadius:10,
              background: bestScore===100?"rgba(76,175,129,.15)":bestScore>=70?"rgba(201,168,76,.1)":"rgba(224,90,90,.1)",
              color: bestScore===100?"var(--green)":bestScore>=70?"var(--gold2)":"var(--red)",
              border:"1px solid "+(bestScore===100?"var(--green)":bestScore>=70?"var(--gold)":"var(--red)") }}>
              {bestScore}%
            </span>
          )}
        </div>
        <span style={{ fontSize:10, color:"var(--text3)", transition:"transform .2s",
          display:"inline-block", transform: recitOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>

      {recitOpen && <div className="recit-section">
      {/* Reset button row */}
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:4 }}>
        {recResult && (
          <button className="btn-small" onClick={reset} style={{fontSize:9,letterSpacing:1}}>↺ RÉINITIALISER</button>
        )}
      </div>

      {/* Mode tabs */}
      <div className="recit-tabs">
        <button className={`recit-tab${inputMode==='mic'?' active':''}`} onClick={()=>setInputMode('mic')}>🎤 VOIX</button>
        <button className={`recit-tab${inputMode==='text'?' active':''}`} onClick={()=>setInputMode('text')}>✏️ TEXTE</button>
      </div>

      {/* Mic mode */}
      {inputMode === 'mic' && (
        <div>
      {/* Panneau debug visible sur device — désactivé en prod */}
            <div style={{margin:'6px 0',padding:'6px 10px',background:'rgba(0,0,0,.5)',border:'1px solid var(--border2)',borderRadius:6,fontFamily:'monospace',fontSize:10,color:'var(--gold2)',lineHeight:1.7,maxHeight:160,overflowY:'auto'}}>
            </div>
          
          <div className={`recit-mic-zone${recording?' active':''}`}>
            <div className={`recit-mic-circle${recording?' recording':''}`} onClick={toggleMic}
              role="button" aria-label={recording?'Arrêter':'Commencer'}>
              {recording ? '⏹' : '🎤'}
            </div>
            <div className={`recit-mic-label${recording?' recording':''}`}>
              {recording ? 'ÉCOUTE EN COURS…' : 'APPUYER POUR RÉCITER'}
            </div>
            {/* Live transcript */}
            <div className={`recit-live-box${transcript?' has-text':''}`} style={{width:'100%'}}>
              {transcript
                ? transcript
                : <div className="recit-live-placeholder">Le texte reconnu apparaîtra ici</div>}
            </div>
          </div>
          {/* Réécouter l'enregistrement */}
          {userAudioUrl && !recording && (
            <div style={{marginTop:8,padding:'8px 12px',background:'rgba(62,184,160,.06)',border:'1px solid rgba(62,184,160,.3)',borderRadius:8,display:'flex',flexDirection:'column',gap:6}}>
              <div style={{fontSize:9,letterSpacing:1.5,color:'var(--teal2)',fontFamily:"'Cinzel',serif"}}>🎧 RÉÉCOUTER MA RÉCITATION</div>
              <audio controls src={userAudioUrl} style={{width:'100%',height:36}} />
            </div>
          )}
        </div>
      )}

      {/* Text mode */}
      {inputMode === 'text' && (
        <div>
          <textarea
            className="recit-textarea" spellCheck={false}
            onFocus={e => { if (arabicActiveInput) arabicActiveInput.current = e.target; }}
            rows={3}
            placeholder="اكتب الآية هنا…"
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            autoComplete="off"
          />
          <div className="recit-actions">
            <button className="btn-primary" onClick={checkTyped} disabled={!typedText.trim()}>VÉRIFIER</button>
            {typedText && <button className="btn-small" onClick={()=>setTypedText('')}>EFFACER</button>}
          </div>
        </div>
      )}

      {/* Result */}
      {recResult && (
        <div style={{marginTop:16}}>

          {/* Score ring */}
          <div className="recit-score-ring">
            <div className="recit-score-arc">
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="6"/>
                <circle cx="40" cy="40" r="34" fill="none"
                  stroke={recResult.score===100?'var(--green2)':recResult.score>=70?'var(--gold2)':'var(--red)'}
                  strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${2*Math.PI*34}`}
                  strokeDashoffset={`${2*Math.PI*34*(1-recResult.score/100)}`}
                  style={{transition:'stroke-dashoffset .6s ease'}}
                />
              </svg>
              <div className={`recit-score-arc-num ${scoreClass}`}>{recResult.score}%</div>
            </div>
            <div className={`recit-score-label ${scoreClass}`}>
              {recResult.score===100?'✓ PARFAIT':recResult.score>=70?'~ BON':'✗ À REVOIR'}
            </div>
          </div>

          {/* Word-by-word comparison table */}
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {recResult.wordResults.filter(wr=>wr.op!=='ins').map((wr, wi) => {
              const wordOk = wr.wordOk;
              const isDel  = wr.op==='del';
              const borderCol = isDel?'var(--red)':wordOk?'rgba(76,175,129,.3)':'rgba(224,90,90,.3)';
              const bgCol     = isDel?'rgba(224,90,90,.05)':wordOk?'rgba(76,175,129,.05)':'rgba(224,90,90,.05)';

              // ── Build corrected user display ──────────────────────────────
              const MADD = /[\u0627\u0648\u064A\u0649\u0670]/; // ا و ي ى ٰ
              const DIAC_RE = /[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g;

              const normAlifWaw = s => normalizeArabic(s || '');

              const refNorm5 = normAlifWaw(wr.ref  || '');
              const userRaw5 = normAlifWaw(wr.user || '');

              // Strip diacritics for manipulation
              const strip = s => s.replace(DIAC_RE,'');
              const refStripped  = strip(refNorm5);
              const userStripped = strip(userRaw5);

              // Rule 4: ه→ة at end of word
              let correctedUser = userStripped;
              if (refStripped.endsWith('ة') && correctedUser.endsWith('ه')) {
                correctedUser = correctedUser.slice(0,-1) + 'ة';
              }

              // Rule 2+3: replace near/err chars with ref char, remove misplaced madd
              // Build char-level mapping from diffWord on corrected strings
              const refN = normalizeArabic(refNorm5);
              const userN = normalizeArabic(correctedUser);

              // For display: reconstruct corrected user word char by char
              // using the alignment: near → show ref char (green); err → show ref char (amber); miss → add ref char (blue)
              let displayParts = [];
              if (!isDel && wr.chars && wr.chars.length > 0) {
                const userChars = [...userN].filter(c => !/[\u064B-\u065F\u0670]/.test(c));
                let userIdx = 0;
                for (const c of wr.chars) {
                  if (c.status === 'silent') continue;
                  const userCh = userChars[userIdx] ?? null;
                  if (c.status === 'ok' || c.status === 'near') {
                    // show what user actually said
                    if (userCh) displayParts.push({ ch: userCh, color: c.status === 'ok' ? 'var(--green2)' : 'var(--gold2)' });
                    userIdx++;
                  } else if (c.status === 'miss') {
                    // user omitted this char — show dash in teal
                    displayParts.push({ ch: '–', color: 'var(--teal2)', added: true });
                    // don't advance userIdx
                  } else {
                    // err — show what user said in red
                    if (userCh) displayParts.push({ ch: userCh, color: 'var(--red)', under: true });
                    userIdx++;
                  }
                }
              }

              return (
                <div key={wi} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',
                  background:bgCol,border:`1px solid ${borderCol}`,borderRadius:'var(--radius-sm)'}}>
                  {/* Référence */}
                  <div style={{flex:1,fontFamily:"'Amiri Quran',serif",fontSize:20,direction:'rtl',textAlign:'right',lineHeight:1.7}}>
                    {wr.chars.map((c,ci)=>(
                      <span key={ci} className={
                        c.status==='ok'?'recit-char-ok':
                        c.status==='near'?'recit-char-near':
                        c.status==='miss'?'recit-char-miss':
                        c.status==='silent'?'recit-char-silent':
                        'recit-char-err'
                      }>{normAlifWaw(c.char).replace(DIAC_RE,'')}{c.waslVowel?(c.waslVowel==='fatha'?'َ':c.waslVowel==='damma'?'ُ':'ِ'):''}</span>
                    ))}
                  </div>
                  {/* Séparateur */}
                  <div style={{width:1,alignSelf:'stretch',background:'var(--border2)',flexShrink:0}}/>
                  {/* Utilisateur corrigé */}
                  <div style={{flex:1,fontFamily:"'Amiri Quran',serif",fontSize:18,direction:'rtl',textAlign:'right',lineHeight:1.7}}>
                    {isDel
                      ? <span style={{fontSize:10,letterSpacing:1,color:'var(--red)',fontFamily:"'Cinzel',serif"}}>MANQUANT</span>
                      : displayParts.length > 0
                        ? displayParts.map((p,pi)=>(
                            <span key={pi} style={{
                              color:p.color,
                              textDecoration:p.added?'underline dotted':'p.under'?'underline wavy':'none',
                              textDecorationColor:p.color,
                              fontStyle:p.added?'italic':'normal',
                            }}>{p.ch}</span>
                          ))
                        : <span style={{color:'var(--text3)',fontSize:10,fontFamily:"'Cinzel',serif"}}>—</span>
                    }
                  </div>
                  {/* Icône */}
                  <div style={{fontSize:13,flexShrink:0,width:18,textAlign:'center',color:isDel?'var(--red)':wordOk?'var(--green2)':'var(--gold2)'}}>
                    {isDel?'✗':wordOk?'✓':'~'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Insertions */}
          {recResult.insertions?.length>0&&(
            <div style={{marginTop:8,padding:'6px 10px',background:'rgba(62,184,160,.06)',
              border:'1px solid var(--teal)',borderRadius:6,fontSize:11}}>
              <span style={{color:'var(--teal)',letterSpacing:1,fontSize:9}}>MOTS AJOUTÉS (pénalité ×3) · </span>
              {recResult.insertions.map((a,i)=>(
                <span key={i} style={{fontFamily:"'Amiri Quran',serif",fontSize:16,
                  color:'var(--teal)',marginLeft:8,direction:'rtl'}}>{a.user}</span>
              ))}
            </div>
          )}

          {/* Debug toggle */}
          <div className="recit-debug-toggle">
            <button className="btn-small" onClick={()=>setShowDebug(v=>!v)}
              style={{fontSize:9,letterSpacing:1,width:'100%'}}>
              {showDebug?'▲ MASQUER DEBUG':'▼ TABLEAU DE DÉBOGAGE'}
            </button>
          </div>

          {showDebug&&(
            <div style={{marginTop:8,overflowX:'auto'}}>
              <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)',marginBottom:6,fontFamily:"'Cinzel',serif"}}>
                DÉTAIL MOT PAR MOT · LETTRE PAR LETTRE
              </div>
              <table className="recit-debug-table">
                <thead>
                  <tr>{['#','OP','RÉFÉRENCE','UTILISATEUR','NORM REF','NORM USER','LETTRES'].map(h=>(
                    <th key={h}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {recResult.wordResults.map((wr,wi)=>(
                    <tr key={wi} style={{background:wr.wordOk?'rgba(76,175,129,.04)':'rgba(224,90,90,.04)'}}>
                      <td style={{color:'var(--text3)'}}>{wi}</td>
                      <td style={{fontWeight:700,color:
                        wr.op==='match'?'var(--green2)':wr.op==='del'?'var(--red)':
                        wr.op==='ins'?'var(--teal)':'var(--gold2)'}}>{wr.op||'—'}</td>
                      <td style={{fontFamily:"'Amiri Quran',serif",fontSize:15,direction:'rtl'}}>{wr.ref||'—'}</td>
                      <td style={{fontFamily:"'Amiri Quran',serif",fontSize:15,direction:'rtl',color:wr.user?'var(--text)':'var(--text3)'}}>
                        {wr.user||<em style={{fontSize:9}}>manquant</em>}</td>
                      <td style={{color:'var(--gold2)',direction:'rtl',fontSize:13}}>{normalizeArabic(wr.ref)}</td>
                      <td style={{color:'var(--teal)',direction:'rtl',fontSize:13}}>{normalizeArabic(wr.user)||<em style={{fontSize:9,color:'var(--text3)'}}>vide</em>}</td>
                      <td>
                        <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                          {wr.chars.map((c,ci)=>(
                            <span key={ci} style={{
                              display:'inline-flex',flexDirection:'column',alignItems:'center',
                              gap:1,padding:'2px 4px',borderRadius:3,minWidth:24,
                              background:
                                c.status==='ok'    ?'rgba(76,175,129,.12)':
                                c.status==='near'  ?'rgba(232,160,32,.12)':
                                c.status==='silent'?'rgba(212,175,55,.1)':
                                c.status==='miss'  ?'rgba(100,100,100,.1)':
                                                    'rgba(224,90,90,.12)',
                              border:'1px solid '+(
                                c.status==='ok'    ?'var(--green2)':
                                c.status==='near'  ?'#e8a020':
                                c.status==='silent'?'var(--gold)':
                                c.status==='miss'  ?'var(--border2)':
                                                    'var(--red)')
                            }}>
                              <span style={{fontFamily:"'Amiri Quran',serif",fontSize:15,direction:'rtl',color:
                                c.status==='ok'    ?'var(--green2)':
                                c.status==='near'  ?'#e8a020':
                                c.status==='silent'?'var(--gold)':
                                c.status==='miss'  ?'var(--text3)':
                                                    'var(--red)'
                              }}>{c.char}</span>
                              <span style={{fontSize:7,color:'var(--text3)',whiteSpace:'nowrap'}}>
                                {c.status==='silent'?'muette':c.status}
                                {c.status==='near'?` (${Math.round((1-(c.cost??0.4))*100)}%)`:''}
                                {c.waslVowel?` [${c.waslVowel}]`:''}
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recResult.insertions?.length>0&&(
                <div style={{marginTop:6,padding:'5px 8px',background:'rgba(62,184,160,.06)',
                  border:'1px solid var(--teal)',borderRadius:4,fontSize:10}}>
                  <span style={{color:'var(--teal)',letterSpacing:1,fontSize:8}}>MOTS AJOUTÉS (pénalité ×3) · </span>
                  {recResult.insertions.map((a,i)=>(
                    <span key={i} style={{fontFamily:"'Amiri Quran',serif",fontSize:14,color:'var(--teal)',marginLeft:6}}>{a.user}</span>
                  ))}
                </div>
              )}
              <div style={{marginTop:6,fontSize:9,color:'var(--text3)',lineHeight:1.8,fontFamily:"'Cinzel',serif",letterSpacing:.5}}>
                PÉNALITÉS : <span style={{color:'var(--gold2)'}}>SUB +0.5</span> ·{' '}
                <span style={{color:'var(--red)'}}>DEL +1.5</span> ·{' '}
                <span style={{color:'var(--teal)'}}>INS +3.0</span>
              </div>
            </div>
          )}
        </div>
      )}
      {attempts?.length > 0 && (
        <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginTop:8 }}>
          <button onClick={() => setHistOpen(v => !v)} style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"7px 12px", background:"var(--surface2)", border:"none", cursor:"pointer",
            fontFamily:"'Cinzel',serif",
          }}>
            <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>HISTORIQUE · {attempts.length}</span>
            <span style={{ fontSize:10, color:"var(--text3)", transition:"transform .2s",
              display:"inline-block", transform: histOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
          </button>
          {histOpen && (
            <div style={{ padding:"8px", display:"flex", flexDirection:"column", gap:4 }}>
              {[...attempts].reverse().map((a,i)=>{
                const c=a.score===100?'var(--green2)':a.score>=70?'var(--gold2)':a.score>=40?'#ff9f43':'var(--red)';
                return(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'var(--surface3)',borderRadius:'var(--radius-sm)',border:`1px solid ${c}22`}}>
                    <div style={{width:34,height:34,borderRadius:'50%',border:`1px solid ${c}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:c,fontFamily:"'Cinzel',serif",flexShrink:0}}>{a.score}%</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:8,color:'var(--text3)',marginBottom:1}}>{a.source==='mic'?'🎤 VOIX':'✏ TEXTE'}</div>
                      <div style={{fontSize:8,color:'var(--text3)'}}>{new Date(a.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                    </div>
                    <div style={{fontSize:18,flexShrink:0}}>{a.score===100?'✓':a.score>=70?'~':'✗'}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </div>}
    </div>
  );
} // ─── lecteur inline pour une partie ────────────────────────
function PartAudioPlayer({ part, words, timestamps, audioUrl, autoPlay, hideText }) {
  const audioRef   = useRef(null);
  const rafRef     = useRef(null);
  const [playing, setPlaying]     = useState(false);
  const [looping, setLooping]     = useState(true);
  const [currentMs, setCurrentMs] = useState(0);

  const timeRange = useMemo(() => {
    if (!timestamps?.words || !part.wordIndices?.length) return null;
    const tsWords = timestamps.words;
    const idx     = part.wordIndices;
    const first   = tsWords[idx[0]];
    const last    = tsWords[idx[idx.length - 1]];
    if (!first || !last) return null;
    const startMs = first.chars?.[0]?.start ?? null;
    const endMs   = last.chars?.[last.chars.length - 1]?.end ?? null;
    if (startMs == null || endMs == null) return null;
    return { startMs, endMs };
  }, [timestamps, part.wordIndices]);

  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setCurrentMs(0);
    stopRaf();
  }, [stopRaf]);

  const play = useCallback((loop, fromMs) => {
    const audio = audioRef.current;
    if (!audio || !timeRange) return;
    const startAt = fromMs ?? timeRange.startMs;
    audio.currentTime = startAt / 1000;
    audio.play().catch(() => {});
    setPlaying(true);
    stopRaf();
    const tick = () => {
      if (!audioRef.current) return;
      const ms = audioRef.current.currentTime * 1000;
      setCurrentMs(ms);
      if (ms >= timeRange.endMs) {
        if (loop) {
          audioRef.current.currentTime = timeRange.startMs / 1000;
          audioRef.current.play().catch(() => {});
          rafRef.current = requestAnimationFrame(tick);
        } else {
          stop();
        }
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [timeRange, stop, stopRaf]);

  const playFromWord = useCallback((wi) => {
    if (!timestamps?.words) return;
    const tsWord = timestamps.words[wi];
    const fromMs = tsWord?.chars?.[0]?.start ?? null;
    if (fromMs == null) return;
    stop();
    setTimeout(() => play(looping, fromMs), 20);
  }, [timestamps, play, stop, looping]);

  useEffect(() => () => { stopRaf(); audioRef.current?.pause(); }, [stopRaf]);

  // auto-start when mounted with autoPlay prop
  useEffect(() => { if (autoPlay && timeRange) { setTimeout(() => play(true), 80); } }, [autoPlay, !!timeRange]);

  if (!timeRange) return (
    <div style={{ fontSize:8, color:"var(--text3)", letterSpacing:1, padding:"4px 0" }}>
      Aucun timestamp — chargez un fichier JSON dans l'onglet ÉCOUTER
    </div>
  );

  const durationMs = timeRange.endMs - timeRange.startMs;
  const progress   = durationMs > 0 ? Math.min(1, Math.max(0, (currentMs - timeRange.startMs) / durationMs)) : 0;

  return (
    <div>
      <audio ref={audioRef} src={audioUrl} style={{ display:"none" }}
        onEnded={() => { if (!looping) stop(); }} />
      <div className="part-player-inline">
        {/* Play/Stop */}
        <button
          className={`part-player-btn ${playing ? "stop" : "play"}`}
          onClick={() => playing ? stop() : play(looping)}
          title={playing ? "Arrêter" : "Lire cette partie"}>
          {playing ? "⏹" : "▶"}
        </button>
        {/* Loop */}
        <button
          className={`part-player-btn ${looping ? "loop-on" : "loop-off"}`}
          onClick={() => {
            const nl = !looping;
            setLooping(nl);
            if (playing) { stop(); setTimeout(() => play(nl), 40); }
          }}
          title={looping ? "Boucle activée" : "Activer la boucle"}>
          🔁
        </button>
        {/* Char highlight */}
        <div className="part-player-chars" style={ hideText ? { filter:'blur(6px)', userSelect:'none', pointerEvents:'none', opacity:.4 } : {} }>
          {timestamps?.words
            ? part.wordIndices.map((wi, ii) => {
                const tsWord = timestamps.words[wi];
                return (
                  <span key={ii} onClick={() => playFromWord(wi)} style={{ cursor:"pointer" }}>
                    {fixChars(tsWord?.chars || [{ char: words[wi] || "", start:0, end:0 }]).map((c, ci) => {
                      const active = playing && currentMs >= c.start && currentMs <= c.end;
                      const done   = playing && currentMs > c.end;
                      return <span key={ci} className={`char-span${active?" char-active":done?" char-done":""}`}>{c.char}</span>;
                    })}
                    {ii < part.wordIndices.length - 1 ? " " : ""}
                  </span>
                );
              })
            : <span>{part.text}</span>
          }
        </div>
        {/* Duration */}
        <span className="part-player-dur">{(durationMs / 1000).toFixed(1)}s</span>
      </div>
      {/* Progress bar */}
      {playing && (
        <div className="part-player-progress">
          <div className="part-player-progress-fill" style={{ width:`${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── CreatePartFromAudio — crée une partie en marquant début/fin sur l'audio ──
// Affiche le lecteur audio + les mots de l'ayat avec la zone sélectionnée.
// Quand startMs et endMs sont définis, calcule les mots couverts via timestamps
// et crée la partie automatiquement.
function CreatePartFromAudio({ ayat, timestamps, audioUrl, existingWordIndices, initialSeekMs, onCreatePart }) {
  const audioRef    = useRef(null);
  const rafRef      = useRef(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying]     = useState(false);
  const [startMs, setStartMs]     = useState(null);
  const [endMs,   setEndMs]       = useState(null);

  const words = ayat.text ? ayat.text.split(" ").filter(Boolean) : [];

  const stopRaf = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  const onPlay  = () => {
    const tick = () => {
      if (audioRef.current) setCurrentMs(audioRef.current.currentTime * 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    setPlaying(true);
  };
  const onPause = () => { stopRaf(); setPlaying(false); };
  const onEnded = () => { stopRaf(); setPlaying(false); };

  useEffect(() => () => stopRaf(), []);

  // Seek au bon endroit à l'ouverture et quand la position initiale change
  useEffect(() => {
    if (initialSeekMs == null || !audioRef.current) return;
    audioRef.current.currentTime = initialSeekMs / 1000;
    setCurrentMs(initialSeekMs);
  }, [initialSeekMs]);

  // Calcule les indices de mots couverts par [startMs, endMs]
  const coveredIndices = useMemo(() => {
    if (startMs == null || endMs == null || !timestamps?.words) return [];
    return timestamps.words
      .map((w, wi) => {
        const ws = w.chars?.[0]?.start ?? null;
        const we = w.chars?.[w.chars.length - 1]?.end ?? null;
        if (ws == null || we == null) return null;
        // Un mot est couvert s'il chevauche [startMs, endMs]
        if (we < startMs || ws > endMs) return null;
        return wi;
      })
      .filter(wi => wi !== null && !existingWordIndices.has(wi));
  }, [startMs, endMs, timestamps, existingWordIndices]);

  const fmtMs = (ms) => ms == null ? "--:--.---"
    : `${String(Math.floor(ms / 60000)).padStart(2,"0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2,"0")}.${String(Math.floor(ms % 1000)).padStart(3,"0")}`;

  const captureStart = () => setStartMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));
  const captureEnd   = () => setEndMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));

  const canCreate = coveredIndices.length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    const text = coveredIndices.map(wi => words[wi]).join(" ");
    const newStart = endMs ?? 0;
    onCreatePart({ wordIndices: coveredIndices, text });
    setStartMs(newStart);
    setEndMs(null);
    if (audioRef.current) {
      audioRef.current.currentTime = newStart / 1000;
      setCurrentMs(newStart);
    }
  };

  return (
    <div className="cpa-wrap">
      <div className="cpa-title">✂ CRÉER UNE PARTIE VIA L'AUDIO</div>

      {/* Lecteur audio */}
      <audio
        ref={audioRef} controls src={audioUrl}
        style={{ width:"100%", marginBottom:2 }}
        onPlay={onPlay} onPause={onPause} onEnded={onEnded}
      />

      {/* Marqueurs début / fin */}
      <div className="cpa-controls">
        <div className="cpa-marker">
          <div className="cpa-marker-label">DÉBUT</div>
          <div className={`cpa-marker-time${startMs != null ? " set" : ""}`}>{fmtMs(startMs)}</div>
          <button className="cpa-btn-capture" onClick={captureStart}>
            ⬤ MARQUER
          </button>
        </div>
        <div style={{ fontSize:18, color:"var(--border2)", alignSelf:"center" }}>→</div>
        <div className="cpa-marker">
          <div className="cpa-marker-label">FIN</div>
          <div className={`cpa-marker-time${endMs != null ? " set" : ""}`}>{fmtMs(endMs)}</div>
          <button className="cpa-btn-capture" onClick={captureEnd}>
            ⬤ MARQUER
          </button>
        </div>
        <button className="cpa-btn-capture"
          onClick={() => { setStartMs(null); setEndMs(null); }}
          style={{ borderColor:"var(--border2)", color:"var(--text3)", background:"transparent" }}>
          ↺ RESET
        </button>
      </div>

      {/* Prévisualisation mots couverts */}
      {timestamps?.words && (
        <div className="cpa-preview">
          {words.map((w, wi) => {
            const inRange   = coveredIndices.includes(wi);
            const isExist   = existingWordIndices.has(wi);
            return (
              <span key={wi} className={`cpa-preview-word${inRange ? " in-range" : ""}`}
                style={isExist ? { opacity:.35 } : {}}>
                {w}{" "}
              </span>
            );
          })}
        </div>
      )}
      {startMs != null && endMs != null && coveredIndices.length === 0 && timestamps?.words && (
        <div style={{ fontSize:9, color:"var(--red)", letterSpacing:1 }}>
          Aucun mot dans cet intervalle — ajustez les marqueurs
        </div>
      )}
      {!timestamps?.words && (
        <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1 }}>
          ⚠ Chargez d'abord un fichier de timestamps dans l'onglet ÉCOUTER
        </div>
      )}

      <button className="cpa-create-btn" onClick={handleCreate} disabled={!canCreate}>
        + CRÉER LA PARTIE ({coveredIndices.length} mot{coveredIndices.length !== 1 ? "s" : ""})
      </button>
    </div>
  );
}

function PartItem({ part, pi, words, timestamps, audioUrl, update }) {
  const [learningStep, setLearningStep] = useState(0); // 0=idle 1=écoute(audio+texte) 2=mémo(audio sans texte) 3=récit
  const fakeAyat = useMemo(() => ({ text: part.text, numberInSurah: part.id }), [part.text, part.id]);

  const STEPS = [
    { label: '① ÉCOUTER',   color: '#5bc8f5', bg: 'rgba(91,200,245,.12)' },
    { label: '② MÉMORISER', color: '#ffd166', bg: 'rgba(255,209,102,.12)' },
    { label: '③ RÉCITER',   color: '#c878ff', bg: 'rgba(200,120,255,.12)' },
    { label: '↺ RESET',     color: 'var(--text3)', bg: 'transparent' },
  ];
  const btnStep = learningStep < 3 ? STEPS[learningStep] : STEPS[3];
  const advance = () => setLearningStep(s => s >= 3 ? 0 : s + 1);

  return (
    <div className={`part-item${part.learned ? " part-learned" : ""}`}>
      <div className="part-header">
        <div className="part-label">PARTIE {pi + 1} · {part.wordIndices?.length} MOTS</div>
        <button onClick={advance} style={{
          fontSize:8, letterSpacing:1, padding:'3px 10px', borderRadius:6, cursor:'pointer',
          fontFamily:"'Cinzel',serif", transition:'all .2s',
          background: btnStep.bg, border:`1px solid ${btnStep.color}`, color: btnStep.color,
        }}>{btnStep.label}</button>
        <button className={`btn-small${part.learned ? " done" : ""}`}
          onClick={() => update(d => ({ ...d, parts: d.parts.map(p => p.id === part.id ? { ...p, learned: !p.learned } : p) }))}>
          {part.learned ? "✓" : "APPRIS"}
        </button>
        <button className="btn-small" style={{ color:"var(--red)", borderColor:"var(--red)" }}
          onClick={() => update(d => ({ ...d, parts: d.parts.filter(p => p.id !== part.id) }))}>✕</button>
      </div>

      {/* Progress bar steps 1-3 */}
      {learningStep > 0 && (
        <div style={{ display:'flex', gap:4, padding:'4px 12px 0' }}>
          {STEPS.slice(0,3).map((s,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, transition:'background .3s',
              background: i < learningStep ? s.color : 'rgba(255,255,255,.08)' }} />
          ))}
        </div>
      )}

      {/* Audio player — always shown except step 3 */}
      {learningStep < 3 && (
        <div style={{ padding: learningStep === 0 ? "0 12px 10px" : "6px 12px 6px" }}>
          <PartAudioPlayer
            key={`step-${learningStep}`}
            part={part} words={words} timestamps={timestamps} audioUrl={audioUrl}
            autoPlay={learningStep > 0}
            hideText={learningStep === 2}
          />
        </div>
      )}

      {/* Step 2: masked hint */}
      {learningStep === 2 && (
        <div style={{ margin:'0 12px 8px', padding:'8px', borderRadius:6,
          background:'rgba(255,209,102,.04)', border:'1px dashed rgba(255,209,102,.2)',
          textAlign:'center', fontSize:8, letterSpacing:2, color:'rgba(255,209,102,.35)',
          fontFamily:"'Cinzel',serif" }}>
          TEXTE MASQUÉ — RÉCITEZ DE MÉMOIRE
        </div>
      )}

      {/* Step 3: recitation checker */}
      {learningStep === 3 && (
        <div style={{ padding:"4px 12px 12px" }}>
          <RecitationChecker ayat={fakeAyat} attempts={part.recitAttempts||[]} saveScore={s => update(d => ({
            ...d, parts: d.parts.map(p => {
              if (p.id !== part.id) return p;
              const prev    = p.recitAttempts || [];
              const merged  = [...prev, s];
              const bestIdx = merged.reduce((bi, a, i) => a.score > merged[bi].score ? i : bi, 0);
              const kept    = [...new Set([0, bestIdx, merged.length-1])].sort((a,b)=>a-b).map(i => merged[i]);
              return { ...p, recitAttempts: kept, ...(s.score === 100 ? { learned: true } : {}) };
            })
          }))} />
        </div>
      )}
    </div>
  );
}

function ApprentissageMode({ ayat, surahNum, ld, setLData, timestamps, audioUrl, isSelectingThisAyat, partSelectStep, onStartPartCreate, clickMode, setClickMode }) {
  const words  = ayat.text ? ayat.text.split(" ").filter(Boolean) : [];
  const update = fn => setLData(surahNum, ayat.numberInSurah, fn);
  const allWordsLearned = words.length > 0 && words.every((_, i) => ld.wordsLearned?.[i]);
  const allPartsLearned = ld.parts?.length > 0 && ld.parts.every(p => p.learned);
  useEffect(() => { if ((allWordsLearned || allPartsLearned) && !ld.learned) update(d => ({ ...d, learned: true })); }, [allWordsLearned, allPartsLearned]);

  const [showCreateAudio, setShowCreateAudio] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);

  const wordsInParts = useMemo(() => {
    const s = new Set();
    (ld.parts || []).forEach(p => p.wordIndices?.forEach(i => s.add(i)));
    return s;
  }, [ld.parts]);

  const nextAvailStart = wordsInParts.size > 0 ? Math.max(...[...wordsInParts]) + 1 : 0;
  const allWordsAssigned = nextAvailStart >= words.length;

  // startMs du prochain découpage = endMs du dernier mot de la dernière partie
  const lastPartEndMs = useMemo(() => {
    if (!timestamps?.words || wordsInParts.size === 0) return null;
    const maxIdx = Math.max(...[...wordsInParts]);
    const w = timestamps.words[maxIdx];
    if (!w) return null;
    return w.chars?.[w.chars.length - 1]?.end ?? null;
  }, [timestamps, wordsInParts]);

  const handleCreateFromAudio = ({ wordIndices, text }) => {
    update(d => ({ ...d, parts: [...(d.parts || []), { id: Date.now(), wordIndices, text, learned: !!d.learned }] }));
  };

  return (
    <div className="learn-section">
      <div className="learn-status-row">
        <div className={`learn-stat${ld.learned ? " learned-stat" : ""}`}>STATUT <span className="val">{ld.learned ? "✓ APPRIS" : "EN COURS"}</span></div>
        <div className="learn-stat">LECTURES <span className="val">{ld.readCount || 0}</span></div>
        <button className={`btn-primary${ld.learned ? " active" : ""}`} onClick={() => update(d => {
          const newLearned = !d.learned;
          return {
            ...d,
            learned: newLearned,
            parts: newLearned ? (d.parts || []).map(p => ({ ...p, learned: true })) : d.parts,
          };
        })}>{ld.learned ? "✓ APPRIS" : "MARQUER COMME APPRIS"}</button>
        {ld.parts?.length > 0 &&
          <button className="btn-small" onClick={() => update(d => ({ ...d, parts: [], wordsLearned: {} }))}>RÉINITIALISER</button>}
      </div>

      <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        {/* Collapsible header */}
        <button onClick={() => setPartsOpen(v => !v)} style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"8px 12px", background:"var(--surface2)", border:"none", cursor:"pointer",
          fontFamily:"'Cinzel',serif"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:9, letterSpacing:2, color:"var(--text3)" }}>PARTIES</span>
            {ld.parts?.length > 0 && (
              <span style={{ fontSize:8, padding:"2px 8px", borderRadius:10,
                background: allPartsLearned ? "rgba(76,175,129,.15)" : "rgba(201,168,76,.1)",
                color: allPartsLearned ? "var(--green)" : "var(--gold2)",
                border:"1px solid " + (allPartsLearned ? "var(--green)" : "var(--gold)") }}>
                {ld.parts.filter(p=>p.learned).length}/{ld.parts.length}
              </span>
            )}
          </div>
          <span style={{ fontSize:10, color:"var(--text3)", transition:"transform .2s",
            display:"inline-block", transform: partsOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
        </button>

        {partsOpen && (
          <div style={{ padding:"12px", display:"flex", flexDirection:"column", gap:8 }}>
            {/* Buttons row */}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {!isSelectingThisAyat && !allWordsAssigned && (
                <button className="btn-small" onClick={onStartPartCreate}>
                  ✂ DÉCOUPER PAR MOTS
                </button>
              )}
              {audioUrl && (
                <button className="btn-small"
                  style={showCreateAudio ? { borderColor:"var(--gold)", color:"var(--gold2)" } : {}}
                  onClick={() => setShowCreateAudio(v => !v)}>
                  🎵 CRÉER VIA AUDIO
                </button>
              )}
            </div>

            {isSelectingThisAyat && (
              <div style={{ fontSize: 9, letterSpacing: 1.5, color: partSelectStep === 'start' ? "var(--gold2)" : "var(--teal2)", fontFamily: "'Cinzel',serif", padding: "4px 0" }}>
                {partSelectStep === 'start' ? "① Cliquez le premier mot sur l'ayat ↑" : "② Cliquez le dernier mot sur l'ayat ↑"}
              </div>
            )}
            {allWordsAssigned && ld.parts?.length > 0 && (
              <div style={{ fontSize: 9, color: "var(--green)", letterSpacing: 1 }}>✓ Tous les mots sont découpés</div>
            )}

            {showCreateAudio && (
              <CreatePartFromAudio
                ayat={ayat}
                timestamps={timestamps}
                audioUrl={audioUrl}
                existingWordIndices={wordsInParts}
                initialSeekMs={lastPartEndMs}
                onCreatePart={handleCreateFromAudio}
              />
            )}

            {(ld.parts || []).map((part, pi) => (
              <PartItem key={part.id} part={part} pi={pi} words={words} timestamps={timestamps} audioUrl={audioUrl} update={update} />
            ))}
            {ld.parts?.length === 0 && !isSelectingThisAyat && !showCreateAudio && (
              <div style={{ fontSize: 9, color: "var(--text3)", letterSpacing: 1 }}>
                Aucune partie — utilisez ✂ DÉCOUPER PAR MOTS ou 🎵 CRÉER VIA AUDIO
              </div>
            )}
          </div>
        )}
      </div>
      <RecitationChecker ayat={ayat} attempts={ld.recitAttempts||[]} saveScore={s => update(d => ({ ...d, recitAttempts: [...(d.recitAttempts||[]).slice(-49), s], ...(s.score === 100 ? { learned: true } : {}) }))} />

      {/* MOTS À SURLIGNER */}
      <div style={{display:'flex',flexDirection:'column',gap:8,padding:'12px 14px',borderTop:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)'}}>MOTS À SURLIGNER</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setClickMode?.(clickMode==='highlight'?null:'highlight')} style={{
              fontSize:8,letterSpacing:1,padding:'3px 10px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
              background:clickMode==='highlight'?'rgba(255,209,102,.15)':'transparent',
              border:`1px solid ${clickMode==='highlight'?'var(--gold)':'var(--border2)'}`,
              color:clickMode==='highlight'?'var(--gold2)':'var(--text3)',
            }}>{clickMode==='highlight' ? '✕ DÉSACTIVER' : "✏ CLIQUER SUR L'AYAT"}</button>
            {ld?.highlight?.trim() && (
              <button onClick={()=>setLData(surahNum,ayat.numberInSurah,d=>({...d,highlight:''}))} style={{
                fontSize:8,letterSpacing:1,padding:'3px 8px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
                background:'transparent',border:'1px solid var(--border2)',color:'var(--text3)',
              }}>✕</button>
            )}
          </div>
        </div>
        {clickMode==='highlight' && (
          <div style={{fontSize:8,color:'var(--teal2)',letterSpacing:1,padding:'4px 8px',background:'rgba(62,184,160,.08)',borderRadius:6,border:'1px solid var(--teal)'}}>
            ↑ Cliquez sur les mots dans l'ayat ci-dessus
          </div>
        )}
        {ld?.highlight?.trim() ? (
          <div style={{direction:'rtl',fontFamily:"'Amiri Quran',serif",fontSize:18,color:'#ffd166',letterSpacing:.5,padding:'6px 10px',background:'rgba(255,209,102,.07)',borderRadius:6,border:'1px solid rgba(255,209,102,.2)'}}>
            {ld.highlight}
          </div>
        ) : (
          <div style={{fontSize:9,color:'var(--text3)',fontStyle:'italic'}}>Aucun mot sélectionné</div>
        )}
      </div>

      {/* MOTS INCONNUS */}
      <div style={{display:'flex',flexDirection:'column',gap:8,padding:'12px 14px',borderTop:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:9,letterSpacing:2,color:'var(--text3)'}}>MOTS INCONNUS</div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button onClick={()=>setClickMode?.(clickMode==='unknown'?null:'unknown')} style={{
              fontSize:8,letterSpacing:1,padding:'3px 10px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
              background:clickMode==='unknown'?'rgba(255,126,179,.15)':'transparent',
              border:`1px solid ${clickMode==='unknown'?'#ff7eb3':'var(--border2)'}`,
              color:clickMode==='unknown'?'#ff7eb3':'var(--text3)',
            }}>{clickMode==='unknown' ? '✕ DÉSACTIVER' : "✏ CLIQUER SUR L'AYAT"}</button>
            {(ld?.unknownWords||[]).length > 0 && (
              <button onClick={()=>setLData(surahNum,ayat.numberInSurah,d=>({...d,unknownWords:[]}))} style={{
                fontSize:8,letterSpacing:1,padding:'3px 8px',fontFamily:"'Cinzel',serif",cursor:'pointer',borderRadius:6,
                background:'transparent',border:'1px solid var(--border2)',color:'var(--text3)',
              }}>✕</button>
            )}
          </div>
        </div>
        {clickMode==='unknown' && (
          <div style={{fontSize:8,color:'#ff7eb3',letterSpacing:1,padding:'4px 8px',background:'rgba(255,126,179,.08)',borderRadius:6,border:'1px solid rgba(255,126,179,.3)'}}>
            ↑ Cliquez sur les mots inconnus dans l'ayat ci-dessus
          </div>
        )}
        {(() => {
          const ayatWords2 = ayat.text ? ayat.text.split(' ').filter(Boolean) : [];
          const unkSet = new Set(ld?.unknownWords || []);
          if (unkSet.size === 0) return <div style={{fontSize:9,color:'var(--text3)',fontStyle:'italic'}}>Aucun mot inconnu marqué</div>;
          // Build roots of selected unknown words
          const unkNorms = new Set([...unkSet].map(i => arabicRoot(ayatWords2[i] || '')).filter(Boolean));
          // Detect all indices with the same root
          const autoSet = new Set();
          ayatWords2.forEach((w, i) => { if (!unkSet.has(i) && unkNorms.has(arabicRoot(w))) autoSet.add(i); });
          const allUnk = new Set([...unkSet, ...autoSet]);
          return (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{direction:'rtl',fontFamily:"'Amiri Quran',serif",fontSize:18,lineHeight:1.8}}>
                {ayatWords2.map((w, i) => {
                  const manual = unkSet.has(i);
                  const auto   = !manual && autoSet.has(i);
                  if (!manual && !auto) return null;
                  return (
                    <span key={i} style={{display:'inline-block',margin:'2px 4px',padding:'2px 6px',borderRadius:5,
                      background: auto ? 'rgba(255,126,179,.07)' : 'rgba(255,126,179,.15)',
                      border: `1px solid ${auto ? 'rgba(255,126,179,.25)' : 'rgba(255,126,179,.4)'}`,
                      color:'#ff7eb3', opacity: auto ? 0.7 : 1,
                      textDecoration:'underline dotted #ff7eb3',
                      position:'relative',
                    }}>
                      {w}
                      {auto && <span style={{position:'absolute',top:-6,right:2,fontSize:6,letterSpacing:.5,color:'rgba(255,126,179,.6)',fontFamily:"'Cinzel',serif"}}>AUTO</span>}
                    </span>
                  );
                })}
              </div>
              {autoSet.size > 0 && (
                <div style={{fontSize:8,color:'rgba(255,126,179,.6)',letterSpacing:1,fontFamily:"'Cinzel',serif"}}>
                  +{autoSet.size} AUTRE{autoSet.size>1?'S':''} OCCURRENCE{autoSet.size>1?'S':''} DÉTECTÉE{autoSet.size>1?'S':''}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
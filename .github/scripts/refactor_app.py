from pathlib import Path
import re

APP = Path("src/App.jsx")
text = APP.read_text(encoding="utf-8")

# Safe extraction from the refactor baseline: keep App.jsx behavior while moving infrastructure.
if (
    'from "./services/firebase"' in text
    and 'from "./services/audioRecorder"' in text
    and '@capgo/capacitor-audio-recorder' not in text
    and '// ─── Android / Capacitor detection' not in text
):
    print("App.jsx refactor already applied")
    raise SystemExit(0)

text, count = re.subn(
    r'^import \{ CapacitorAudioRecorder \} from [\'\"]@capgo/capacitor-audio-recorder[\'\"];\n',
    '', text, count=1, flags=re.MULTILINE,
)
if count != 1:
    raise SystemExit("Expected CapacitorAudioRecorder import exactly once")

firebase_block = re.compile(
    r'^import \{ initializeApp \} from "firebase/app";\n'
    r'import \{\n'
    r'  getAuth,\n'
    r'  onAuthStateChanged,\n'
    r'  signInWithEmailAndPassword,\n'
    r'  createUserWithEmailAndPassword,\n'
    r'  signInWithPopup,\n'
    r'  signInWithRedirect,\n'
    r'  getRedirectResult,\n'
    r'  GoogleAuthProvider,\n'
    r'  signOut,\n'
    r'  updateProfile,\n'
    r'} from "firebase/auth";\n'
    r'import \{\n'
    r'  getFirestore,\n'
    r'  doc,\n'
    r'  setDoc,\n'
    r'  onSnapshot,\n'
    r'} from "firebase/firestore";\n\n'
    r'// ─── Firebase config ─────────────────────────────────────────────────────────\n'
    r'// Replace with your actual Firebase project config\n'
    r'const firebaseConfig = \{.*?\n\};\n'
    r'const firebaseApp\s*= initializeApp\(firebaseConfig\);\n'
    r'const firebaseAuth\s*= getAuth\(firebaseApp\);\n'
    r'const firebaseDb\s*= getFirestore\(firebaseApp\);\n'
    r'const googleProvider = new GoogleAuthProvider\(\);\n\n',
    re.MULTILINE | re.DOTALL,
)
replacement = '''import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";
import { firebaseAuth, firebaseDb, googleProvider } from "./services/firebase";
import { createAudioRecorder, IS_ANDROID } from "./services/audioRecorder";

'''
text, count = firebase_block.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit("Expected Firebase initialization block exactly once")

recorder_block = re.compile(
    r'^// ─── Android / Capacitor detection ───────────────────────────────────────────\n'
    r'.*?'
    r'^}\n\n\n(?=// ─── SURAH NAME MAP)',
    re.MULTILINE | re.DOTALL,
)
text, count = recorder_block.subn('', text, count=1)
if count != 1:
    raise SystemExit("Expected audio recorder implementation exactly once")

APP.write_text(text, encoding="utf-8")
print("App.jsx refactor applied successfully")

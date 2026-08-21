from pathlib import Path
import re

APP = Path("src/App.jsx")
text = APP.read_text(encoding="utf-8")

# Remove the Capacitor recorder import; the implementation moves to the service.
text, count = re.subn(
    r'^import \{ CapacitorAudioRecorder \} from [\'\"]@capgo/capacitor-audio-recorder[\'\"];\n',
    '',
    text,
    count=1,
    flags=re.MULTILINE,
)
if count != 1:
    raise SystemExit("Expected CapacitorAudioRecorder import exactly once")

# Replace Firebase initialization with the extracted service import while preserving
# the Firebase auth/firestore function imports used by App.jsx.
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

replacement = '''import {\n  getAuth,\n  onAuthStateChanged,\n  signInWithEmailAndPassword,\n  createUserWithEmailAndPassword,\n  signInWithPopup,\n  signInWithRedirect,\n  getRedirectResult,\n  signOut,\n  updateProfile,\n} from "firebase/auth";\nimport {\n  doc,\n  setDoc,\n  onSnapshot,\n} from "firebase/firestore";\nimport { firebaseAuth, firebaseDb, googleProvider } from "./services/firebase";\nimport { createAudioRecorder } from "./services/audioRecorder";\n\n'''
text, count = firebase_block.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit("Expected Firebase initialization block exactly once")

# Extract the recorder implementation. The next section is a stable anchor in App.jsx.
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

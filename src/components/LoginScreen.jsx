import React, { useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth, googleProvider } from "../services/firebase";
import "./LoginScreen.css";

export default function LoginScreen({ onLoggedIn }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error,      setError]      = useState(null);
  const [loading,    setLoading]    = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        }
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      }
      onLoggedIn?.();
    } catch (err) {
      console.error("[LoginScreen]", err);
      let msg = err.message;
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        msg = "Email ou mot de passe incorrect.";
      } else if (err.code === "auth/email-already-in-use") {
        msg = "Un compte existe déjà avec cet email.";
      } else if (err.code === "auth/weak-password") {
        msg = "Le mot de passe doit faire au moins 6 caractères.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithRedirect(firebaseAuth, googleProvider);
    } catch (err) {
      console.error("[LoginGoogle]", err);
      setError(err.message);
      setLoading(false);
    }
  };

  const handleDemo = () => {
    onLoggedIn?.({ uid: "demo-user", email: "demo@example.com", displayName: "Visiteur" });
  };

  return (
    <div style={{
      minHeight:"100vh", background:"var(--bg)", display:"flex",
      alignItems:"center", justifyContent:"center", padding:20,
    }}>
      <div style={{
        width:"100%", maxWidth:380, background:"var(--surface2)",
        border:"1px solid var(--border2)", borderRadius:16, padding:28,
        boxShadow:"0 16px 48px rgba(0,0,0,.5)", display:"flex",
        flexDirection:"column", gap:20,
      }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"'Amiri Quran',serif", fontSize:32, color:"var(--gold2)" }}>القرآن الكريم</div>
          <div style={{ fontSize:11, letterSpacing:3, color:"var(--gold)", fontFamily:"'Cinzel',serif", marginTop:4 }}>
            QURÂN STUDY
          </div>
          <div style={{ fontSize:9, color:"var(--text3)", marginTop:4 }}>
            {isRegister ? "Créer un compte de synchronisation" : "Connectez-vous pour synchroniser vos données"}
          </div>
        </div>

        {error && (
          <div style={{
            padding:"10px 14px", background:"rgba(224,90,90,.12)",
            border:"1px solid var(--red)", borderRadius:8, color:"var(--red)",
            fontSize:10, lineHeight:1.5, textAlign:"center",
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {isRegister && (
            <div>
              <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)", marginBottom:4, fontFamily:"'Cinzel',serif" }}>
                NOM / PSEUDO
              </div>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Votre nom"
                style={{
                  width:"100%", background:"var(--surface3)", border:"1px solid var(--border2)",
                  borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:12, outline:"none",
                }}
              />
            </div>
          )}

          <div>
            <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)", marginBottom:4, fontFamily:"'Cinzel',serif" }}>
              EMAIL
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="votre@email.com"
              style={{
                width:"100%", background:"var(--surface3)", border:"1px solid var(--border2)",
                borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:12, outline:"none",
              }}
            />
          </div>

          <div>
            <div style={{ fontSize:8, letterSpacing:1.5, color:"var(--text3)", marginBottom:4, fontFamily:"'Cinzel',serif" }}>
              MOT DE PASSE
            </div>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width:"100%", background:"var(--surface3)", border:"1px solid var(--border2)",
                borderRadius:8, padding:"10px 12px", color:"var(--text)", fontSize:12, outline:"none",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width:"100%", padding:"12px", marginTop:8, fontSize:10 }}
          >
            {loading ? "CHARGEMENT…" : isRegister ? "S'INSCRIRE" : "SE CONNECTER"}
          </button>
        </form>

        <div style={{ display:"flex", alignItems:"center", gap:12, color:"var(--text3)", fontSize:9 }}>
          <div style={{ flex:1, height:1, background:"var(--border)" }} />
          <span>OU</span>
          <div style={{ flex:1, height:1, background:"var(--border)" }} />
        </div>

        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            width:"100%", padding:"10px 14px", background:"var(--surface3)",
            border:"1px solid var(--border2)", borderRadius:8, color:"var(--text)",
            fontFamily:"'Cinzel',serif", fontSize:10, letterSpacing:1, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:10,
            transition:"all .2s",
          }}
        >
          <span style={{ fontSize:14 }}>🌐</span> Continuer avec Google
        </button>

        <button
          onClick={handleDemo}
          style={{
            width:"100%", padding:"10px 14px", background:"rgba(201,168,76,.1)",
            border:"1px solid var(--gold)", borderRadius:8, color:"var(--gold2)",
            fontFamily:"'Cinzel',serif", fontSize:10, letterSpacing:1, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            transition:"all .2s",
          }}
        >
          <span>☽</span> Continuer sans compte (Mode démo)
        </button>

        <div style={{ textAlign:"center", marginTop:4 }}>
          <button
            onClick={() => { setIsRegister(!isRegister); setError(null); }}
            style={{ background:"none", border:"none", color:"var(--gold2)", fontSize:9, cursor:"pointer", letterSpacing:1, fontFamily:"'Cinzel',serif" }}
          >
            {isRegister ? "Déjà un compte ? Se connecter" : "Pas encore de compte ? S'inscrire"}
          </button>
        </div>
      </div>
    </div>
  );
}

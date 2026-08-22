import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { sel, uiActions } from "../store";

export default function OptionsModal({ onClose }) {
  const dispatch = useDispatch();
  const enableTimestamps = useSelector(sel.enableTimestamps);
  const enableLetterByLetter = useSelector(sel.enableLetterByLetter);
  const enableAnimations = useSelector(sel.enableAnimations);
  const enableHeavyCompute = useSelector(sel.enableHeavyCompute);
  const showQalqala = useSelector(sel.showQalqala);
  const showMadd = useSelector(sel.showMadd);
  const showIzhar = useSelector(sel.showIzhar);
  const showIdgham = useSelector(sel.showIdgham);
  const showParts = useSelector(sel.showParts);
  const spellCheck = useSelector(sel.spellCheck);
  const announceNum = useSelector(sel.announceNum);

  const Row = ({ label, desc, on, onToggle, color = "var(--teal2)" }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
      <div style={{ flex:1, paddingRight:12 }}>
        <div style={{ fontSize:10, letterSpacing:1.5, color:"var(--text)", fontFamily:"'Cinzel',serif" }}>{label}</div>
        {desc && <div style={{ fontSize:8, color:"var(--text3)", marginTop:2, letterSpacing:.5, lineHeight:1.5 }}>{desc}</div>}
      </div>
      <div onClick={onToggle} style={{ width:42, height:24, borderRadius:12, cursor:"pointer", flexShrink:0, background:on ? color : "var(--surface3)", border:"1px solid " + (on ? color : "var(--border2)"), position:"relative", transition:"background .2s" }}>
        <div style={{ position:"absolute", top:3, left:on ? 21 : 3, width:16, height:16, borderRadius:"50%", background:on ? "white" : "var(--text3)", transition:"left .2s" }} />
      </div>
    </div>
  );

  const Section = ({ title }) => (
    <div style={{ fontSize:8, letterSpacing:2, color:"var(--text3)", margin:"18px 0 4px", fontFamily:"'Cinzel',serif" }}>{title}</div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="options-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:"1px solid var(--border)" }}>
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

import React from "react";

/**
 * Header account dropdown.
 *
 * The header owns visibility state and Firebase actions; this component only
 * renders the account menu and forwards user interactions to its parent.
 */
export default function HeaderUserMenu({
  currentUser,
  showArabicKeyboard,
  toggleKeyboard,
  showRappel,
  setShowRappel,
  setShowOptionsModal,
  setShowUserMenu,
  onSignOut,
}) {
  return (
    <div className="header-user-menu">
      <div className="user-menu-header">
        <div className="user-menu-name">{currentUser.displayName || "Utilisateur"}</div>
        <div className="user-menu-email">{currentUser.email || ""}</div>
      </div>

      <button className="user-menu-item" onClick={() => { toggleKeyboard(); setShowUserMenu(false); }}>
        <div className="menu-left"><span>⌨️</span><span>Clavier Arabe</span></div>
        <span className={`user-menu-badge ${showArabicKeyboard ? "on" : "off"}`}>
          {showArabicKeyboard ? "ON" : "OFF"}
        </span>
      </button>

      <button className="user-menu-item" onClick={() => { setShowRappel(v => !v); setShowUserMenu(false); }}>
        <div className="menu-left"><span>🔔</span><span>Rappel Vocal</span></div>
        <span className={`user-menu-badge ${showRappel ? "on" : "off"}`}>
          {showRappel ? "ON" : "OFF"}
        </span>
      </button>

      <button className="user-menu-item" onClick={() => { setShowOptionsModal(true); setShowUserMenu(false); }}>
        <div className="menu-left"><span>⚙</span><span>Paramètres &amp; Sync</span></div>
      </button>

      <button className="user-menu-item logout" onClick={() => { setShowUserMenu(false); onSignOut(); }}>
        <div className="menu-left"><span>⏏</span><span>Se déconnecter</span></div>
      </button>
    </div>
  );
}

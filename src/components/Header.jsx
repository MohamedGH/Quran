import React from "react";

/**
 * Application header.
 *
 * Logic remains owned by App; this component only receives state and handlers.
 * This keeps the refactor behaviour-preserving.
 */
export default function Header({
  sidebarOpen,
  setSidebarOpen,
  activePage,
  setActivePage,
  listening,
  toggleVoice,
  showArabicKeyboard,
  setShowArabicKeyboard,
  showRappel,
  setShowRappel,
  showUserMenu,
  setShowUserMenu,
  showOptionsModal,
  setShowOptionsModal,
  currentUser,
  onSignOut,
  userMenuRef,
}) {
  const navItems = [
    { id: "quran", icon: "📖", label: "CORAN" },
    { id: "prononciation", icon: "🔤", label: "PRONON." },
    { id: "dashboard", icon: "📊", label: "DASH" },
    { id: "collections", icon: "🗂", label: "COLL." },
    { id: "revision", icon: "✏", label: "RÉVISION" },
  ];

  const toggleKeyboard = () => setShowArabicKeyboard(v => {
    const next = !v;
    try { localStorage.setItem("quran_arabic_keyboard", next ? "1" : "0"); } catch {}
    return next;
  });

  return (
    <header className="header">
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
        <div className="header-logo" onClick={() => setActivePage("quran")} title="Accueil Coran">
          <span>QUR<span className="logo-highlight">ÂN</span></span>
          <span className="header-subtitle">STUDY</span>
        </div>
      </div>

      <nav className="header-nav" aria-label="Navigation principale">
        {navItems.map(({ id, icon, label }) => (
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

      <div className="header-actions" ref={userMenuRef}>
        <button
          className="voice-btn desktop-only-action"
          onClick={toggleKeyboard}
          title={showArabicKeyboard ? "Masquer clavier arabe" : "Afficher clavier arabe"}
          style={{
            background: showArabicKeyboard ? "rgba(62,184,160,.18)" : undefined,
            borderColor: showArabicKeyboard ? "var(--teal)" : undefined,
            color: showArabicKeyboard ? "var(--teal2)" : undefined,
          }}
        >⌨️</button>

        <button
          className={`voice-btn${listening ? " listening" : ""}`}
          onClick={toggleVoice}
          title={listening ? "Arrêter écoute vocale" : "Commande vocale"}
        >🎤</button>

        <button
          className="voice-btn desktop-only-action"
          onClick={() => setShowRappel(v => !v)}
          title="Rappel vocal"
          style={{
            background: showRappel ? "rgba(201,168,76,.18)" : undefined,
            borderColor: showRappel ? "rgba(201,168,76,.5)" : undefined,
            color: showRappel ? "var(--gold2)" : undefined,
          }}
        >🔔</button>

        {currentUser && (
          <div style={{ position: "relative" }}>
            <button
              className={`header-user-btn${showUserMenu ? " active" : ""}`}
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

            {showUserMenu && (
              <div className="header-user-menu">
                <div className="user-menu-header">
                  <div className="user-menu-name">{currentUser.displayName || "Utilisateur"}</div>
                  <div className="user-menu-email">{currentUser.email || ""}</div>
                </div>

                <button className="user-menu-item" onClick={() => { toggleKeyboard(); setShowUserMenu(false); }}>
                  <div className="menu-left"><span>⌨️</span><span>Clavier Arabe</span></div>
                  <span className={`user-menu-badge ${showArabicKeyboard ? "on" : "off"}`}>{showArabicKeyboard ? "ON" : "OFF"}</span>
                </button>

                <button className="user-menu-item" onClick={() => { setShowRappel(v => !v); setShowUserMenu(false); }}>
                  <div className="menu-left"><span>🔔</span><span>Rappel Vocal</span></div>
                  <span className={`user-menu-badge ${showRappel ? "on" : "off"}`}>{showRappel ? "ON" : "OFF"}</span>
                </button>

                <button className="user-menu-item" onClick={() => { setShowOptionsModal(true); setShowUserMenu(false); }}>
                  <div className="menu-left"><span>⚙</span><span>Paramètres &amp; Sync</span></div>
                </button>

                <button className="user-menu-item logout" onClick={() => { setShowUserMenu(false); onSignOut(); }}>
                  <div className="menu-left"><span>⏏</span><span>Se déconnecter</span></div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

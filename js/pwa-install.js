// ══════════════════════════════════════════════════════
//  pwa-install.js  —  FacturaPro
//  Système d'installation PWA universel
//
//  Fonctionnalités :
//  [1] Bouton d'installation dans la topbar (desktop/tablet)
//  [2] Banner bottom-sheet sur mobile (iOS + Android)
//  [3] Détection plateforme : Android, iOS, desktop
//  [4] Guide iOS custom (pas de beforeinstallprompt sur Safari)
//  [5] Respect du "déjà installé" (standalone mode)
//  [6] Persistence du refus (30 jours)
//  [7] Badge animé sur le bouton topbar
// ══════════════════════════════════════════════════════

"use strict";

(function () {

  // ── Constantes ──────────────────────────────────────
  const STORAGE_KEY_DISMISSED = "fp_pwa_dismissed_until";
  const DISMISS_DAYS          = 30; // ne plus montrer pendant X jours après refus

  // ── État ────────────────────────────────────────────
  let _deferredPrompt  = null; // event beforeinstallprompt
  let _platform        = detectPlatform();
  let _alreadyInstalled = isStandalone();

  // ──────────────────────────────────────────────────
  //  DÉTECTION PLATEFORME
  // ──────────────────────────────────────────────────

  function detectPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipod/.test(ua))                        return "ios-phone";
    if (/ipad/.test(ua) || (navigator.maxTouchPoints > 1 && /mac/.test(ua))) return "ios-tablet";
    if (/android.*mobile/.test(ua))                    return "android-phone";
    if (/android/.test(ua))                            return "android-tablet";
    if (/windows|macintosh|linux/.test(ua))            return "desktop";
    return "unknown";
  }

  function isIOS()     { return _platform.startsWith("ios"); }
  function isMobile()  { return _platform.includes("phone"); }
  function isTablet()  { return _platform.includes("tablet"); }
  function isDesktop() { return _platform === "desktop"; }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true // iOS Safari
    );
  }

  function wasDismissed() {
    const until = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (!until) return false;
    return new Date() < new Date(until);
  }

  function markDismissed() {
    const until = new Date();
    until.setDate(until.getDate() + DISMISS_DAYS);
    localStorage.setItem(STORAGE_KEY_DISMISSED, until.toISOString());
  }

  // ──────────────────────────────────────────────────
  //  ÉCOUTE beforeinstallprompt (Chrome/Edge/Samsung)
  // ──────────────────────────────────────────────────

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    if (!_alreadyInstalled && !wasDismissed()) {
      renderInstallUI();
    }
  });

  // Déjà installé → rien à faire
  window.addEventListener("appinstalled", () => {
    _alreadyInstalled = true;
    removeAllInstallUI();
    toast("✅ FacturaPro installé avec succès !", "ok");
    console.log("[PWA] Application installée");
  });

  // ──────────────────────────────────────────────────
  //  POINT D'ENTRÉE PRINCIPAL
  //  Appelé après domContentLoaded si pas de beforeinstallprompt
  //  (iOS, ou navigateur qui ne supporte pas l'event)
  // ──────────────────────────────────────────────────

  function init() {
    if (_alreadyInstalled) return; // déjà en mode standalone
    if (wasDismissed())    return; // l'utilisateur a refusé récemment

    // iOS : pas d'event beforeinstallprompt → afficher quand même l'aide
    if (isIOS() && !_deferredPrompt) {
      // Petit délai pour laisser l'app se charger
      setTimeout(renderInstallUI, 3000);
    }

    // Injecter le bouton topbar (toujours, sera caché si inutile)
    injectTopbarButton();
  }

  // ──────────────────────────────────────────────────
  //  CHOIX D'UI SELON LA PLATEFORME
  // ──────────────────────────────────────────────────

  function renderInstallUI() {
    if (_alreadyInstalled) return;
    injectTopbarButton();
    if (isMobile()) {
      showMobileBanner();
    } else if (isTablet()) {
      showTabletBanner();
    } else {
      // Desktop : le bouton topbar suffit + mini toast discret
      showDesktopHint();
    }
  }

  function removeAllInstallUI() {
    document.getElementById("pwa-topbar-btn")?.remove();
    document.getElementById("pwa-mobile-banner")?.remove();
    document.getElementById("pwa-modal")?.remove();
    document.getElementById("pwa-desktop-hint")?.remove();
  }

  // ──────────────────────────────────────────────────
  //  BOUTON TOPBAR (desktop + tablet + injecté partout)
  // ──────────────────────────────────────────────────

  function injectTopbarButton() {
    if (document.getElementById("pwa-topbar-btn")) return;

    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    const btn = document.createElement("button");
    btn.id        = "pwa-topbar-btn";
    btn.className = "pwa-topbar-btn";
    btn.title     = "Installer FacturaPro sur cet appareil";
    btn.innerHTML = `
      <span class="pwa-btn-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v13M8 11l4 4 4-4"/>
          <path d="M20 16v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4"/>
        </svg>
      </span>
      <span class="pwa-btn-label">Installer</span>
      <span class="pwa-btn-badge" aria-hidden="true"></span>
    `;
    btn.addEventListener("click", handleInstallClick);

    // Insérer avant le topbar-user
    const userEl = topbar.querySelector(".topbar-user");
    if (userEl) topbar.insertBefore(btn, userEl);
    else topbar.appendChild(btn);

    // Animation d'apparition
    requestAnimationFrame(() => btn.classList.add("pwa-btn-visible"));
  }

  // ──────────────────────────────────────────────────
  //  BANNER MOBILE (Android / iOS Phone)
  //  Bottom-sheet qui glisse du bas
  // ──────────────────────────────────────────────────

  function showMobileBanner() {
    if (document.getElementById("pwa-mobile-banner")) return;

    const isIOSDevice = isIOS();

    const banner = document.createElement("div");
    banner.id        = "pwa-mobile-banner";
    banner.className = "pwa-mobile-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Installer FacturaPro");
    banner.innerHTML = `
      <div class="pwa-banner-drag-handle" id="pwa-drag-handle"></div>
      <div class="pwa-banner-inner">
        <div class="pwa-banner-app">
          <div class="pwa-banner-icon">🧾</div>
          <div class="pwa-banner-info">
            <div class="pwa-banner-name">FacturaPro</div>
            <div class="pwa-banner-desc">Facturation hors ligne · Rapide · Gratuit</div>
            <div class="pwa-banner-stars">
              ★★★★★ <span>Application professionnelle</span>
            </div>
          </div>
        </div>
        ${isIOSDevice ? `
          <div class="pwa-ios-guide">
            <div class="pwa-ios-step">
              <div class="pwa-ios-step-num">1</div>
              <div class="pwa-ios-step-text">
                Appuie sur <strong>Partager</strong>
                <span class="pwa-ios-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
                </span>
                en bas de Safari
              </div>
            </div>
            <div class="pwa-ios-step">
              <div class="pwa-ios-step-num">2</div>
              <div class="pwa-ios-step-text">Sélectionne <strong>Sur l'écran d'accueil</strong> <span class="pwa-ios-icon">＋</span></div>
            </div>
            <div class="pwa-ios-step">
              <div class="pwa-ios-step-num">3</div>
              <div class="pwa-ios-step-text">Appuie sur <strong>Ajouter</strong> — c'est tout !</div>
            </div>
          </div>
        ` : `
          <div class="pwa-banner-features">
            <div class="pwa-feature-pill">⚡ Hors ligne</div>
            <div class="pwa-feature-pill">📥 PDF instantané</div>
            <div class="pwa-feature-pill">🚀 Ultra rapide</div>
          </div>
        `}
        <div class="pwa-banner-actions">
          ${isIOSDevice ? `
            <button class="pwa-banner-got-it" onclick="window.pwaInstall.dismissMobile()">J'ai compris !</button>
          ` : `
            <button class="pwa-banner-install" onclick="window.pwaInstall.triggerInstall()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13M8 11l4 4 4-4"/><path d="M20 16v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4"/></svg>
              Installer l'app
            </button>
            <button class="pwa-banner-dismiss" onclick="window.pwaInstall.dismissMobile()">Plus tard</button>
          `}
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Swipe to dismiss (drag vers le bas)
    setupSwipeToDismiss(banner);

    // Animation d'entrée
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add("pwa-banner-visible"));
    });
  }

  // ──────────────────────────────────────────────────
  //  BANNER TABLET (bottom modal plus large)
  // ──────────────────────────────────────────────────

  function showTabletBanner() {
    // Tablette : modal centré bottom (pas plein écran)
    if (document.getElementById("pwa-mobile-banner")) return;

    const isIOSDevice = isIOS();
    const banner = document.createElement("div");
    banner.id        = "pwa-mobile-banner";
    banner.className = "pwa-mobile-banner pwa-tablet-banner";
    banner.setAttribute("role", "dialog");
    banner.innerHTML = `
      <div class="pwa-banner-inner">
        <button class="pwa-banner-close-x" onclick="window.pwaInstall.dismissMobile()" aria-label="Fermer">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <div class="pwa-tablet-layout">
          <div class="pwa-banner-icon pwa-banner-icon-lg">🧾</div>
          <div class="pwa-tablet-content">
            <div class="pwa-banner-name pwa-tablet-title">Installer FacturaPro</div>
            <div class="pwa-tablet-subtitle">Accédez à votre application de facturation même hors ligne, directement depuis votre écran d'accueil.</div>
            <div class="pwa-banner-features pwa-tablet-features">
              <div class="pwa-feature-pill">⚡ Hors ligne</div>
              <div class="pwa-feature-pill">📥 PDF instantané</div>
              <div class="pwa-feature-pill">🔔 Notifications</div>
              <div class="pwa-feature-pill">🚀 Démarrage rapide</div>
            </div>
            ${isIOSDevice ? `
              <div class="pwa-ios-guide pwa-ios-guide-inline">
                <div class="pwa-ios-step"><div class="pwa-ios-step-num">1</div><div class="pwa-ios-step-text">Bouton <strong>Partager</strong> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg> dans Safari</div></div>
                <div class="pwa-ios-step"><div class="pwa-ios-step-num">2</div><div class="pwa-ios-step-text"><strong>Sur l'écran d'accueil</strong> ＋</div></div>
                <div class="pwa-ios-step"><div class="pwa-ios-step-num">3</div><div class="pwa-ios-step-text">Tap <strong>Ajouter</strong></div></div>
              </div>
              <button class="pwa-banner-got-it" onclick="window.pwaInstall.dismissMobile()">Compris !</button>
            ` : `
              <div class="pwa-tablet-actions">
                <button class="pwa-banner-install" onclick="window.pwaInstall.triggerInstall()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13M8 11l4 4 4-4"/><path d="M20 16v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4"/></svg>
                  Installer maintenant
                </button>
                <button class="pwa-banner-dismiss" onclick="window.pwaInstall.dismissMobile()">Pas maintenant</button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add("pwa-banner-visible"));
    });
  }

  // ──────────────────────────────────────────────────
  //  HINT DESKTOP (toast discret)
  // ──────────────────────────────────────────────────

  function showDesktopHint() {
    if (document.getElementById("pwa-desktop-hint")) return;

    const hint = document.createElement("div");
    hint.id        = "pwa-desktop-hint";
    hint.className = "pwa-desktop-hint";
    hint.innerHTML = `
      <div class="pwa-desktop-hint-inner">
        <span class="pwa-hint-icon">💡</span>
        <span class="pwa-hint-text">Installe FacturaPro pour un accès rapide depuis ton bureau</span>
        <button class="pwa-hint-install-btn" onclick="window.pwaInstall.triggerInstall()">Installer</button>
        <button class="pwa-hint-close" onclick="window.pwaInstall.dismissDesktopHint()" aria-label="Fermer">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(hint);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => hint.classList.add("pwa-hint-visible"));
    });

    // Auto-dismiss après 10s
    setTimeout(() => dismissDesktopHint(), 10000);
  }

  // ──────────────────────────────────────────────────
  //  MODAL CONFIRMATION POST-INSTALL
  // ──────────────────────────────────────────────────

  function showSuccessModal() {
    const modal = document.createElement("div");
    modal.id        = "pwa-success-modal";
    modal.className = "pwa-success-modal";
    modal.innerHTML = `
      <div class="pwa-success-inner">
        <div class="pwa-success-icon">🎉</div>
        <div class="pwa-success-title">Installation réussie !</div>
        <div class="pwa-success-text">FacturaPro est maintenant installé. Tu peux l'ouvrir depuis ton écran d'accueil.</div>
        <button class="pwa-success-btn" onclick="document.getElementById('pwa-success-modal').remove()">Super !</button>
      </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("pwa-modal-visible"));
    });
    setTimeout(() => modal?.remove(), 6000);
  }

  // ──────────────────────────────────────────────────
  //  ACTIONS
  // ──────────────────────────────────────────────────

  async function triggerInstall() {
    if (!_deferredPrompt) {
      // iOS ou navigateur sans support → montrer le guide
      if (isIOS()) showMobileBanner();
      return;
    }
    try {
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      console.log("[PWA] Choix utilisateur :", outcome);
      if (outcome === "accepted") {
        removeAllInstallUI();
        showSuccessModal();
      } else {
        markDismissed();
        dismissMobile();
      }
    } catch (e) {
      console.error("[PWA] Erreur installation :", e);
    }
    _deferredPrompt = null;
  }

  function dismissMobile() {
    const banner = document.getElementById("pwa-mobile-banner");
    if (banner) {
      banner.classList.remove("pwa-banner-visible");
      banner.classList.add("pwa-banner-hiding");
      setTimeout(() => banner?.remove(), 400);
    }
    markDismissed();
  }

  function dismissDesktopHint() {
    const hint = document.getElementById("pwa-desktop-hint");
    if (hint) {
      hint.classList.remove("pwa-hint-visible");
      setTimeout(() => hint?.remove(), 300);
    }
    markDismissed();
  }

  function handleInstallClick() {
    if (_deferredPrompt) {
      triggerInstall();
    } else if (isIOS()) {
      showMobileBanner();
    } else {
      // Navigateur sans support natif → info
      toast("💡 Utilise Chrome ou Edge pour installer FacturaPro", "info");
    }
  }

  // ──────────────────────────────────────────────────
  //  SWIPE TO DISMISS (mobile)
  // ──────────────────────────────────────────────────

  function setupSwipeToDismiss(el) {
    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    const handle = el.querySelector("#pwa-drag-handle") ?? el;

    handle.addEventListener("touchstart", (e) => {
      startY   = e.touches[0].clientY;
      isDragging = true;
    }, { passive: true });

    handle.addEventListener("touchmove", (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const delta = Math.max(0, currentY - startY);
      el.style.transform = `translateY(${delta}px)`;
      el.style.transition = "none";
    }, { passive: true });

    handle.addEventListener("touchend", () => {
      isDragging = false;
      el.style.transition = "";
      const delta = currentY - startY;
      if (delta > 80) {
        dismissMobile();
      } else {
        el.style.transform = "";
      }
    });
  }

  // ──────────────────────────────────────────────────
  //  API PUBLIQUE
  // ──────────────────────────────────────────────────

  window.pwaInstall = {
    triggerInstall,
    dismissMobile,
    dismissDesktopHint,
    getInfo: () => ({
      platform:    _platform,
      standalone:  _alreadyInstalled,
      canInstall:  !!_deferredPrompt,
      isDismissed: wasDismissed(),
    }),
  };

  // ──────────────────────────────────────────────────
  //  INIT au chargement DOM
  // ──────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // DOM déjà prêt (script chargé en defer/async)
    setTimeout(init, 500);
  }

})();
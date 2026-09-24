// ══════════════════════════════════════════════════════
//  app.js  —  FacturaPro  v6
//
//  NOUVEAUTÉS v6 :
//  [PWA FIX] Enregistrement du Service Worker RETIRÉ
//      d'ici → déplacé dans js/pwa-install.js, exécuté
//      dès le chargement de la page (pas après le login).
//      Raison : Chrome exige que le SW contrôle déjà la
//      page pour déclencher beforeinstallprompt. En
//      l'enregistrant seulement après connexion, la PWA
//      n'était jamais installable pour un visiteur qui
//      regardait l'écran de login.
//
//  NOUVEAUTÉS v5 (conservées) :
//  [A] Authentification Google (GoogleAuthProvider)
//  [B] seConnecterAvecGoogle() avec popup + redirect fallback
//  [C] Initialisation automatique des settings pour
//      les nouveaux comptes Google (première connexion)
//  [D] getRedirectResult() géré au démarrage
//      → Vercel/Safari ne bloquent pas le retour OAuth
//  [E] Helper settingsRef() — isolation par uid
//      (chaque utilisateur a ses propres données)
//
//  CORRECTIONS conservées depuis v4 :
//  [A] Utilitaires dans utils.js (global)
//  [B] enablePersistence() activé → offline OK
//  [C] allVentes exposé globalement (window.allVentes)
//  [D] Listener hash URL → shortcuts PWA
//  [E] Guard allProduits chargé avant autocomplete
//  [F] Toutes dates converties via toDateObj()
//  [G] Sanitisation données client pour jsPDF
// ══════════════════════════════════════════════════════

"use strict";

// ─────────────────────────────────────────────────────
//  ÉTAT GLOBAL
// ─────────────────────────────────────────────────────
window.currentUser  = null;
window.lignes       = [];
window.docType      = "facture";
window.entreprise   = {};
window.config       = {};
window.allVentes    = [];
let _saving         = false;

// ─────────────────────────────────────────────────────
//  [FIX P1-1/2] CONTEXTE BOUTIQUE — propriétaire / gérant / caissier
//  Déplacé ici (depuis index.html) pour que la résolution du
//  contexte fasse partie du flux natif de connexion, au lieu de
//  dépendre de l'ordre de chargement des <script> pour être
//  écrasée à temps. C'est désormais app.js — la source de vérité
//  pour onUserConnected — qui résout et applique le shopUid.
//
//  Modèle : shopId = uid du propriétaire de la boutique.
//  staff_index/{staffUid} = { shopId, role, email, nom } indique
//  à quelle boutique appartient un caissier/gérant.
// ─────────────────────────────────────────────────────

window.activeShopUid = null;
window.userRole      = 'owner';

window._shopUid = function _shopUid(){
  return window.activeShopUid || window.currentUser?.uid;
};

async function _resolveShopContext(user) {
  window.activeShopUid = user.uid;
  window.userRole      = 'owner';
  try {
    const snap = await db.collection('staff_index').doc(user.uid).get();
    if (snap.exists) {
      const d = snap.data();
      window.activeShopUid = d.shopId;
      window.userRole      = d.role || 'caissier';
    }
  } catch (e) {
    console.warn('[Équipe] résolution du contexte échouée :', e.message);
  }
}

// ─────────────────────────────────────────────────────
//  [FIX E] HELPER — chemins Firestore isolés par boutique
//  Chaque commerçant (et son équipe) a ses propres settings/counter
// ─────────────────────────────────────────────────────

function settingsRef(doc) {
  const uid = window._shopUid();
  return db.collection("users").doc(uid)
           .collection("settings").doc(doc);
}

// ─────────────────────────────────────────────────────
//  NAVIGATION — vues
// ─────────────────────────────────────────────────────

// [FIX] Vues autorisées par rôle — SOURCE UNIQUE DE VÉRITÉ. Utilisée
// ici pour bloquer l'accès direct à une vue (peu importe comment on
// y arrive : clic, hash d'URL laissé par une session précédente sur
// un appareil partagé, ou appel direct), ET par _applyRoleRestrictions
// (index.html) pour savoir quels boutons du menu masquer. Avant, les
// deux étaient gérés séparément — les boutons étaient bien cachés,
// mais rien n'empêchait d'afficher la vue elle-même (ex: caissier qui
// hérite d'un onglet #parametres resté dans l'URL).
// owner : absent de la liste = aucune restriction (toutes les vues).
window.VUES_PAR_ROLE = {
  caissier: ["dashboard", "nouvelle-vente", "historique"],
  gerant:   ["dashboard", "nouvelle-vente", "historique", "credits", "catalogue"],
};

window.showView = function showView(id, btn) {
  const role       = window.userRole || "owner";
  const autorisees = window.VUES_PAR_ROLE[role];
  if (autorisees && !autorisees.includes(id)) {
    toast("⛔ Cette section n'est pas accessible avec votre rôle.", "err");
    id  = "dashboard";
    btn = document.querySelector('.sb-item[data-view="dashboard"]');
  }

  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const view = document.getElementById(`view-${id}`);
  if (view) view.classList.add("active");
  document.querySelectorAll(".sb-item").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const titles = {
    dashboard:        "Tableau de bord",
    "nouvelle-vente": "Nouvelle vente",
    historique:       "Historique des ventes",
    credits:          "Crédits & Ardoises",
    catalogue:        "Catalogue produits",
    parametres:       "Paramètres",
    // [FIX] Consolidés ici depuis deux surcharges de showView() dans
    // shop.js qui fixaient ce titre en se basant sur l'id DEMANDÉ à
    // l'origine plutôt que sur l'id RÉELLEMENT affiché après le
    // contrôle de rôle ci-dessus — un caissier qui tentait d'accéder
    // à "Équipe" voyait le tableau de bord s'afficher (correct) mais
    // avec le titre "Caissiers & Gérants" en haut (trompeur). En
    // utilisant la même variable "id", déjà remplacée par "dashboard"
    // le cas échéant, le titre correspond toujours à ce qui s'affiche.
    team:                 "Caissiers & Gérants",
    "admin-utilisateurs": "Administration",
  };
  const el = document.getElementById("topbar-title");
  if (el) el.textContent = titles[id] ?? id;

  // [FIX] Consolidé depuis shop.js — même raison que ci-dessus : ne
  // charger la liste de l'équipe que si "team" est réellement affiché
  // (et jamais pour un rôle qui n'y a pas accès, même par défense en
  // profondeur en plus du contrôle de rôle déjà appliqué plus haut).
  if (id === "team" && window.userRole === "owner" && typeof _teamLoadMembers === "function") {
    _teamLoadMembers();
  }

  if (id === "dashboard")  chargerDashboard();
  if (id === "historique") chargerHistorique();
  if (id === "credits")    chargerCredits();
  if (id === "catalogue")  chargerCatalogue();
};

// [SOFT] Menu "Plus" (mobile) — regroupe Équipe/Paramètres/
// Administration derrière un seul onglet plutôt que d'en ajouter
// un par fonctionnalité, pour que la barre du bas reste légère.
window.togglePlusMenu = function togglePlusMenu(e) {
  e?.stopPropagation();
  const adminBtn = document.getElementById("sb-item-admin");
  const adminEntry = document.getElementById("plus-sheet-admin");
  if (adminEntry) {
    adminEntry.style.display = (adminBtn && !adminBtn.classList.contains("hidden")) ? "flex" : "none";
  }
  document.getElementById("plus-sheet-overlay")?.classList.add("active");
  document.getElementById("plus-sheet")?.classList.add("active");
};

window.fermerPlusMenu = function fermerPlusMenu() {
  document.getElementById("plus-sheet-overlay")?.classList.remove("active");
  document.getElementById("plus-sheet")?.classList.remove("active");
};

window._plusNaviguer = function _plusNaviguer(id) {
  fermerPlusMenu();
  showView(id, document.querySelector(`.sb-item[data-view="${id}"]`));
};

// ─────────────────────────────────────────────────────
//  ROUTING HASH — shortcuts PWA
// ─────────────────────────────────────────────────────

function handleHashRoute() {
  const hash    = window.location.hash.replace("#", "").trim();
  const allowed = ["dashboard","nouvelle-vente","historique","credits","catalogue","parametres"];
  if (!hash || !allowed.includes(hash)) return;
  const btn = document.querySelector(`.sb-item[data-view="${hash}"]`);
  showView(hash, btn);
}

window.addEventListener("hashchange", handleHashRoute);

// ─────────────────────────────────────────────────────
//  VALIDATION FORMULAIRE
// ─────────────────────────────────────────────────────

// [FIX P5] Version consolidée — remplace l'ancienne validation
// "quasi nulle" (< 1% du total) qui laissait passer une vente de
// 50 000 F CFA "payée" avec seulement 10 000 F reçus. Cette
// version (qui vivait en double dans index.html) bloque tout
// montant reçu inférieur au total, sauf en paiement "À crédit".
function validerFormulaire() {
  const lignesValides = window.lignes.filter(l =>
    l.des.trim() !== "" && l.prix > 0 && l.qte > 0
  );
  if (!lignesValides.length)
    return { ok: false, msg: "❌ Ajoute au moins un article avec une désignation et un prix." };

  const { total } = calcRecap();
  if (total <= 0 && window.docType !== "devis")
    return { ok: false, msg: "❌ Le total de la vente doit être supérieur à zéro." };

  if (window.docType !== "devis") {
    const paiement = document.getElementById("v-paiement")?.value ?? "especes";
    const mRecu    = parseFloat(document.getElementById("v-montant-recu")?.value) || 0;

    if (paiement !== "credit" && Math.round(mRecu) < Math.round(total)) {
      return {
        ok: false,
        msg: `❌ Le montant reçu (${fmt(mRecu)}) est inférieur au total (${fmt(total)}). `
           + `Choisis "À crédit" si le client ne paie pas tout maintenant.`,
      };
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────
//  APRÈS CONNEXION RÉUSSIE — initialisation app
//
//  FIX BUG 1 — Chargement Google infini :
//  - loader(false) + bouton Google reset immédiatement
//  - flag _appInitDone évite le double appel
//    (onAuthStateChanged peut se déclencher 2x avec popup)
//
//  FIX BUG 2 — Produits fréquents vides au POS :
//  - chargerCatalogue() attendu AVANT posInit()
//    pour que window.allProduits soit prêt
// ─────────────────────────────────────────────────────

let _appInitDone = false;

// ─────────────────────────────────────────────────────
//  SESSION UNIQUE — un seul appareil connecté par compte
//  users/{uid}/settings/session = { sessionId, device, at }
//  Une nouvelle connexion prend la place de l'ancienne ;
//  l'ancien appareil est déconnecté automatiquement.
// ─────────────────────────────────────────────────────
let _sessionUnsub = null;
let _mySid = null;

function _sessionRef(uid) {
  return db.collection("users").doc(uid).collection("settings").doc("session");
}

function _stopSession() {
  if (_sessionUnsub) { try { _sessionUnsub(); } catch (e) {} _sessionUnsub = null; }
  _mySid = null;
}

async function _kickSession() {
  _stopSession();
  _appInitDone = false;
  try { await auth.signOut(); } catch (e) {}
  const errEl = document.getElementById("login-error");
  if (errEl) {
    errEl.textContent   = "Ce compte a été ouvert sur un autre appareil. Tu as été déconnecté.";
    errEl.style.display = "block";
  }
  loader(false);
}

// Retourne false si cet appareil n'est plus la session active.
async function _initSession(user) {
  _stopSession();
  const key   = "fp_sid_" + user.uid;
  const fresh = sessionStorage.getItem("fp_fresh") === "1";   // connexion volontaire
  sessionStorage.removeItem("fp_fresh");
  try {
    const ref  = _sessionRef(user.uid);
    const mine = localStorage.getItem(key);
    if (!fresh) {                       // simple rechargement de la page
      const snap   = await ref.get();
      const remote = snap.exists ? snap.data().sessionId : null;
      if (remote && remote !== mine) { await _kickSession(); return false; }
      if (remote && remote === mine) _mySid = mine;
    }
    if (!_mySid) {                      // nouvelle connexion → prend la place
      _mySid = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(key, _mySid);
      await ref.set({
        sessionId: _mySid,
        device:    (navigator.userAgent || "").slice(0, 120),
        at:        firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    const sid = _mySid;
    _sessionUnsub = ref.onSnapshot(snap => {
      const d = snap.exists ? snap.data() : null;
      if (d && d.sessionId && d.sessionId !== sid && !snap.metadata.hasPendingWrites) _kickSession();
    }, () => {});
  } catch (e) {
    console.warn("[Session] contrôle appareil unique indisponible :", e.message);
  }
  return true;
}

async function onUserConnected(user) {
  // Guard : éviter le double appel popup + onAuthStateChanged
  if (_appInitDone && window.currentUser?.uid === user.uid) return;
  _appInitDone = true;
  window.currentUser = user;

  // Un seul appareil par compte
  if (!(await _initSession(user))) return;

  // [FIX P1-1/2] Résoudre le contexte boutique EN PREMIER — avant
  // le moindre chargement de settings/catalogue/ventes. Tout ce qui
  // suit (settingsRef, chargerCatalogue, etc.) dépend de _shopUid().
  await _resolveShopContext(user);

  // Masquer login IMMÉDIATEMENT — stoppe le spinner visible
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  // [FIX BUG 1] Couper le loader et le spinner du bouton Google
  loader(false);
  const btnGoogle = document.getElementById("btn-google");
  if (btnGoogle) btnGoogle.classList.remove("loading");

  // Afficher nom / email dans la topbar
  const el = document.getElementById("topbar-user");
  if (el) el.textContent = user.displayName || user.email;

  // Charger settings en parallèle (plus rapide)
  await Promise.all([
    chargerEntreprise(),
    chargerConfig(),
    initSettingsPourNouvelUtilisateur(user),
  ]);

  // [FIX BUG 2] Catalogue chargé AVANT posInit()
  // → allProduits est disponible quand posRefreshQuick() s'exécute
  await chargerCatalogue();

  // Dashboard (fire-and-forget)
  chargerDashboard();

  // POS — allProduits est maintenant rempli
  if (typeof posInit === "function") posInit();

  updateBadgeCredits();
  handleHashRoute();

  // [FIX P1-1/2] Appliquer les restrictions d'UI selon le rôle
  // (caissier/gérant/owner) une fois le contexte boutique connu.
  if (typeof _applyRoleRestrictions === "function") _applyRoleRestrictions();
  if (window.userRole === "owner" && typeof _teamLoadMembers === "function") _teamLoadMembers();

  // [PWA FIX] Le Service Worker n'est PLUS enregistré ici.
  // Il est désormais enregistré dans js/pwa-install.js dès
  // le chargement de la page (window "load"), avant même
  // que l'utilisateur se connecte. Cela permet à Chrome de
  // déclencher beforeinstallprompt correctement, ce qui ne
  // pouvait pas arriver tant que le SW n'était actif qu'après
  // authentification.
}

// ─────────────────────────────────────────────────────
//  [C] INIT SETTINGS PREMIER UTILISATEUR GOOGLE
//  Si c'est la toute première connexion, on crée
//  des settings vides pour éviter les crashes
// ─────────────────────────────────────────────────────

async function initSettingsPourNouvelUtilisateur(user) {
  try {
    const snap = await settingsRef("entreprise").get();
    if (!snap.exists) {
      // Première connexion — pré-remplir avec infos Google
      const defaultEntreprise = {
        nom:      user.displayName || "",
        slogan:   "",
        tel:      "",
        tel2:     "",
        email:    user.email || "",
        web:      "",
        adresse:  "",
        ville:    "",
        pays:     "Togo",
        devise:   "F CFA",
        rc:       "",
        nif:      "",
        logoUrl:  user.photoURL || "",
      };
      await settingsRef("entreprise").set(defaultEntreprise);
      window.entreprise = defaultEntreprise;

      const defaultConfig = {
        format:       "thermal",
        devisePos:    "after",
        devise:       "F CFA",
        showLogo:     true,
        showCompany:  true,
        showDate:     true,
        showRef:      false,
        showRendu:    true,
        showTva:      false,
        tvaRate:      18,
        showSign:     false,
        headerText:   "",
        footerThanks: "Merci pour votre achat !",
        footerLegal:  "Articles non repris ni échangés.",
      };
      await settingsRef("config").set(defaultConfig);
      window.config = defaultConfig;

      // Mettre à jour la prévisualisation si on est sur l'onglet paramètres
      if (typeof updatePreviewEntreprise === "function") updatePreviewEntreprise();

      toast("👋 Bienvenue ! Complète tes infos dans Paramètres.", "info", 5000);
    }
  } catch (e) {
    console.warn("initSettingsPourNouvelUtilisateur:", e);
  }
}

// ─────────────────────────────────────────────────────
//  AUTHENTIFICATION — État
// ─────────────────────────────────────────────────────

auth.onAuthStateChanged(async user => {
  if (user) {
    await onUserConnected(user);
  } else {
    window.currentUser = null;
    _stopSession();
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }
});

// ─────────────────────────────────────────────────────
//  [D] GÉRER LE RETOUR REDIRECT GOOGLE (Vercel/Safari)
//  Sur mobile Safari et certains navigateurs,
//  signInWithPopup est bloqué → on utilise redirect
//  getRedirectResult() récupère le résultat au retour
// ─────────────────────────────────────────────────────

// getRedirectResult — retour après signInWithRedirect (Safari/mobile)
// onAuthStateChanged gère automatiquement la connexion réussie.
// On ne montre une erreur QUE si c'est une vraie erreur (pas "pas de redirect en cours").
auth.getRedirectResult().then(result => {
  if (result && result.user) {
    console.log("[Auth] Retour redirect Google OK :", result.user.email);
    // onAuthStateChanged prend le relai — rien à faire ici
  }
}).catch(err => {
  const ignoredCodes = [
    "auth/no-current-user",
    "auth/null-user",
    "auth/cancelled-popup-request",
  ];
  if (!ignoredCodes.includes(err.code)) {
    console.error("[Auth] getRedirectResult error:", err.code, err.message);
    // Afficher l'erreur uniquement si l'écran de login est visible
    const loginScreen = document.getElementById("login-screen");
    const errEl       = document.getElementById("login-error");
    if (errEl && loginScreen && !loginScreen.classList.contains("hidden")) {
      errEl.textContent   = "Erreur Google : " + (_authErrorMsg(err.code) || err.message);
      errEl.style.display = "block";
    }
  }
  // Dans tous les cas : couper le loader
  loader(false);
  const btnGoogle = document.getElementById("btn-google");
  if (btnGoogle) btnGoogle.classList.remove("loading");
});

// ─────────────────────────────────────────────────────
//  CONNEXION EMAIL / MOT DE PASSE
// ─────────────────────────────────────────────────────

async function seConnecter() {
  const email = document.getElementById("l-email").value.trim();
  const pwd   = document.getElementById("l-pwd").value;
  const errEl = document.getElementById("login-error");
  errEl.classList.remove("login-success");
  errEl.style.display = "none";

  if (!email || !pwd) {
    errEl.textContent   = "Remplis tous les champs.";
    errEl.style.display = "block";
    return;
  }
  loader(true);
  try {
    sessionStorage.setItem("fp_fresh", "1");
    await auth.signInWithEmailAndPassword(email, pwd);
  } catch (e) {
    errEl.textContent   = _authErrorMsg(e.code) || e.message;
    errEl.style.display = "block";
  }
  loader(false);
}

window.seConnecter = seConnecter;

["l-email", "l-pwd"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") seConnecter();
  });
});

// ─────────────────────────────────────────────────────
//  [NOUVEAU] MOT DE PASSE OUBLIÉ
//  Firebase Authentication envoie lui-même l'email de
//  réinitialisation (lien sécurisé, expire après un délai) —
//  aucun serveur ni configuration SMTP à gérer côté app.
// ─────────────────────────────────────────────────────

window.afficherResetPassword = function afficherResetPassword() {
  const errEl = document.getElementById("login-error");
  errEl.classList.remove("login-success");
  errEl.style.display = "none";
  document.getElementById("login-normal-fields").classList.add("hidden");
  document.getElementById("reset-pwd-panel").classList.remove("hidden");
  // Pré-remplir avec l'email déjà saisi, pour ne pas le retaper
  const emailDeja = document.getElementById("l-email")?.value.trim();
  const champReset = document.getElementById("reset-email");
  if (champReset) champReset.value = emailDeja || "";
};

window.masquerResetPassword = function masquerResetPassword() {
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  document.getElementById("reset-pwd-panel").classList.add("hidden");
  document.getElementById("login-normal-fields").classList.remove("hidden");
};

window.envoyerResetPassword = async function envoyerResetPassword() {
  const email = document.getElementById("reset-email").value.trim();
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";

  if (!email) {
    errEl.textContent   = "Indique ton adresse email.";
    errEl.style.display = "block";
    return;
  }

  loader(true);
  try {
    await auth.sendPasswordResetEmail(email);
    // [Sécurité] Toujours le même message, que l'email existe ou
    // non — ne jamais révéler si une adresse a un compte ou pas.
    masquerResetPassword();
    errEl.classList.add("login-success");
    errEl.textContent   = "📩 Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé.";
    errEl.style.display = "block";
  } catch (e) {
    errEl.classList.remove("login-success");
    if (e.code === "auth/invalid-email") {
      errEl.textContent = "Adresse email invalide.";
    } else if (e.code === "auth/user-not-found") {
      // Même message que le succès, pour ne pas révéler l'absence de compte
      masquerResetPassword();
      errEl.classList.add("login-success");
      errEl.textContent = "📩 Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé.";
      errEl.style.display = "block";
      loader(false);
      return;
    } else {
      errEl.textContent = _authErrorMsg(e.code) || e.message;
    }
    errEl.style.display = "block";
  }
  loader(false);
};

document.getElementById("reset-email")?.addEventListener("keydown", e => {
  if (e.key === "Enter") envoyerResetPassword();
});

// ─────────────────────────────────────────────────────
//  [B] CONNEXION GOOGLE
//  Essaie popup en premier (desktop Chrome/Edge)
//  Fallback automatique sur redirect (Safari/mobile)
// ─────────────────────────────────────────────────────

window.seConnecterAvecGoogle = async function seConnecterAvecGoogle() {
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";

  // Reset du flag pour permettre une nouvelle connexion
  _appInitDone = false;

  sessionStorage.setItem("fp_fresh", "1");
  const provider = new firebase.auth.GoogleAuthProvider();
  // Forcer la sélection de compte même si déjà connecté
  provider.setCustomParameters({ prompt: "select_account" });

  loader(true);
  try {
    // Tentative popup (desktop, Chrome Android)
    await auth.signInWithPopup(provider);
    // onAuthStateChanged prend le relai — loader(false) appelé dans onUserConnected
  } catch (popupErr) {
    console.warn("[Auth] Popup bloqué, tentative redirect :", popupErr.code);

    // Popup bloqué (Safari, WebView, certains mobiles) → redirect
    if (
      popupErr.code === "auth/popup-blocked"         ||
      popupErr.code === "auth/popup-closed-by-user"  ||
      popupErr.code === "auth/cancelled-popup-request"
    ) {
      try {
        // La page va se recharger — getRedirectResult() gère le retour
        await auth.signInWithRedirect(provider);
      } catch (redirectErr) {
        loader(false);
        errEl.textContent   = _authErrorMsg(redirectErr.code) || redirectErr.message;
        errEl.style.display = "block";
      }
    } else {
      loader(false);
      errEl.textContent   = _authErrorMsg(popupErr.code) || popupErr.message;
      errEl.style.display = "block";
    }
  }
  // loader(false) n'est PAS appelé ici en cas de succès popup
  // car onAuthStateChanged masque l'écran de login
};

// ─────────────────────────────────────────────────────
//  DÉCONNEXION
// ─────────────────────────────────────────────────────

window.seDeconnecter = () => auth.signOut();

// ─────────────────────────────────────────────────────
//  MESSAGES D'ERREUR AUTH
// ─────────────────────────────────────────────────────

function _authErrorMsg(code) {
  const msgs = {
    "auth/invalid-email":           "Adresse email invalide.",
    "auth/user-not-found":          "Aucun compte avec cet email.",
    "auth/wrong-password":          "Mot de passe incorrect.",
    "auth/invalid-credential":      "Email ou mot de passe incorrect.",
    "auth/too-many-requests":       "Trop de tentatives. Réessaie plus tard.",
    "auth/account-exists-with-different-credential":
      "Un compte existe déjà avec cet email. Connecte-toi avec email/mot de passe.",
    "auth/network-request-failed":  "Problème de connexion réseau.",
    "auth/user-disabled":           "Ce compte a été désactivé.",
    "auth/popup-blocked":           "Le popup a été bloqué par le navigateur.",
    "auth/cancelled-popup-request": "Connexion annulée.",
  };
  return msgs[code] ?? null;
}

// ─────────────────────────────────────────────────────
//  PARAMÈTRES — CHARGEMENT
// ─────────────────────────────────────────────────────

async function chargerEntreprise() {
  try {
    const snap = await settingsRef("entreprise").get();
    if (snap.exists) {
      window.entreprise = snap.data();
      remplirChampsEntreprise();
      if (typeof updatePreviewEntreprise === "function") updatePreviewEntreprise();
    }
  } catch (e) { console.error("chargerEntreprise:", e); }
}

async function chargerConfig() {
  try {
    const snap = await settingsRef("config").get();
    if (snap.exists) {
      window.config = snap.data();
      remplirChampsConfig();
    }
  } catch (e) { console.error("chargerConfig:", e); }
}

function remplirChampsEntreprise() {
  const map = {
    "p-nom":"nom","p-slogan":"slogan","p-tel":"tel","p-tel2":"tel2",
    "p-email":"email","p-web":"web","p-adresse":"adresse","p-ville":"ville",
    "p-pays":"pays","p-devise":"devise","p-rc":"rc","p-nif":"nif","p-logo-url":"logoUrl",
  };
  for (const [elId, key] of Object.entries(map)) {
    const el = document.getElementById(elId);
    if (el) el.value = window.entreprise[key] ?? "";
  }
  if (typeof updateLogoPreview === "function") updateLogoPreview();
  if (typeof updatePreviewEntreprise === "function") updatePreviewEntreprise();
}

function remplirChampsConfig() {
  const cfg = window.config;
  const checkMap = {
    "p-show-logo":    "showLogo",
    "p-show-company": "showCompany",
    "p-show-date":    "showDate",
    "p-show-ref":     "showRef",
    "p-show-rendu":   "showRendu",
    "p-show-tva":     "showTva",
    "p-show-sign":    "showSign",
  };
  for (const [elId, key] of Object.entries(checkMap)) {
    const el = document.getElementById(elId);
    if (el) el.checked = cfg[key] !== false;
  }
  if (cfg.tvaRate)   document.getElementById("p-tva-rate").value = cfg.tvaRate;
  if (cfg.format)    setChipValue("format-chips",     cfg.format,    "p-format");
  if (cfg.devisePos) setChipValue("devise-pos-chips", cfg.devisePos, "p-devise-pos");

  const textMap = {
    "p-header":        "headerText",
    "p-footer-thanks": "footerThanks",
    "p-footer-legal":  "footerLegal",
    "p-signature-url": "signatureUrl",
    "p-cachet-url":    "cachetUrl",
  };
  for (const [elId, key] of Object.entries(textMap)) {
    const el = document.getElementById(elId);
    if (el && cfg[key]) el.value = cfg[key];
  }

  const tvaLbl = document.getElementById("tva-pct-label");
  if (tvaLbl) tvaLbl.textContent = `Taux : ${cfg.tvaRate ?? 18} %`;

  // Mise à jour preview signature et toggle visibilité
  if (typeof updateSignaturePreview === "function") updateSignaturePreview();
  if (typeof toggleSignatureUpload  === "function") toggleSignatureUpload();

  const dev = cfg.devise ?? window.entreprise.devise ?? "F CFA";
  ["stat-devise","stat-devise2"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = dev;
  });
}

window.updateLogoPreview = function updateLogoPreview() {
  const url  = document.getElementById("p-logo-url")?.value.trim();
  const wrap = document.getElementById("logo-preview-wrap");
  if (!wrap) return;
  wrap.innerHTML = url
    ? `<img src="${escHtml(url)}" alt="Logo" onerror="this.parentNode.innerHTML='🏪'">`
    : "🏪";
};

window.updatePreviewEntreprise = function updatePreviewEntreprise() {
  const nom = document.getElementById("p-nom")?.value     ?? window.entreprise.nom     ?? "Nom entreprise";
  const tel = document.getElementById("p-tel")?.value     ?? window.entreprise.tel     ?? "";
  const em  = document.getElementById("p-email")?.value   ?? window.entreprise.email   ?? "";
  const adr = document.getElementById("p-adresse")?.value ?? window.entreprise.adresse ?? "";
  const nomEl  = document.getElementById("prev-nom");
  const infoEl = document.getElementById("prev-info");
  if (nomEl)  nomEl.textContent = nom;
  if (infoEl) infoEl.innerHTML  = [tel, em, adr].filter(Boolean).join(" · ") || "Téléphone · Email · Adresse";
  if (typeof updateLogoPreview === "function") updateLogoPreview();
};

["p-nom","p-tel","p-email","p-adresse"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", updatePreviewEntreprise);
});

window.sauvegarderEntreprise = async function sauvegarderEntreprise() {
  const g = id => document.getElementById(id)?.value.trim() ?? "";
  const data = {
    nom:     g("p-nom"),    slogan:  g("p-slogan"),
    tel:     g("p-tel"),    tel2:    g("p-tel2"),
    email:   g("p-email"),  web:     g("p-web"),
    adresse: g("p-adresse"),ville:   g("p-ville"),
    pays:    g("p-pays"),   devise:  g("p-devise") || "F CFA",
    rc:      g("p-rc"),     nif:     g("p-nif"),
    logoUrl: g("p-logo-url"),
  };
  if (!data.nom) { toast("Le nom de l'entreprise est obligatoire.", "err"); return; }
  loader(true);
  try {
    await settingsRef("entreprise").set(data);
    window.entreprise = data;
    if (typeof updatePreviewEntreprise === "function") updatePreviewEntreprise();
    toast("✅ Informations enregistrées !");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.sauvegarderConfig = async function sauvegarderConfig() {
  const chk = id => document.getElementById(id)?.checked ?? false;
  const val = id => document.getElementById(id)?.value.trim() ?? "";
  const data = {
    format:       val("p-format")     || "thermal",
    devisePos:    val("p-devise-pos") || "after",
    devise:       val("p-devise")     || window.entreprise.devise || "F CFA",
    showLogo:     chk("p-show-logo"),
    showCompany:  chk("p-show-company"),
    showDate:     chk("p-show-date"),
    showRef:      chk("p-show-ref"),
    showRendu:    chk("p-show-rendu"),
    showTva:      chk("p-show-tva"),
    tvaRate:      parseFloat(val("p-tva-rate")) || 18,
    showSign:     chk("p-show-sign"),
    headerText:   val("p-header"),
    footerThanks: val("p-footer-thanks"),
    footerLegal:  val("p-footer-legal"),
    // Signature — conservée si déjà présente, sinon lue depuis l'input
    signatureUrl: val("p-signature-url") || window.config?.signatureUrl || "",
    cachetUrl:    val("p-cachet-url")    || window.config?.cachetUrl    || "",
  };
  loader(true);
  try {
    await settingsRef("config").set(data);
    window.config = data;
    remplirChampsConfig();
    toast("✅ Configuration enregistrée !");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.changerMotDePasse = async function changerMotDePasse() {
  const p1 = document.getElementById("p-pwd-new")?.value;
  const p2 = document.getElementById("p-pwd-confirm")?.value;
  if (!p1)           { toast("Saisis un nouveau mot de passe.", "err"); return; }
  if (p1 !== p2)     { toast("Les mots de passe ne correspondent pas.", "err"); return; }
  if (p1.length < 6) { toast("Mot de passe trop court (min 6).", "err"); return; }

  // Vérifier si l'utilisateur est connecté via Google
  const isGoogleUser = window.currentUser?.providerData
    ?.some(p => p.providerId === "google.com");
  if (isGoogleUser) {
    toast("Les comptes Google n'ont pas de mot de passe FacturaPro.", "info");
    return;
  }

  loader(true);
  try {
    await window.currentUser.updatePassword(p1);
    toast("✅ Mot de passe mis à jour !");
    ["p-pwd-new","p-pwd-confirm"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
  } catch (e) { toast("Reconnecte-toi et réessaie.", "err"); }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  CHANGER L'EMAIL (compte email + mot de passe)
//  Firebase envoie un lien de confirmation à la NOUVELLE adresse ;
//  l'email ne change qu'après le clic sur ce lien. Même uid → mêmes données.
// ─────────────────────────────────────────────────────
window.changerEmail = async function changerEmail() {
  const nouvel = document.getElementById("p-email-new")?.value.trim().toLowerCase();
  const pwd    = document.getElementById("p-email-pwd")?.value;
  const user   = window.currentUser;
  if (!user) return;
  if (!nouvel || !pwd) { toast("Saisis le nouvel email et ton mot de passe actuel.", "err"); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nouvel)) { toast("Adresse email invalide.", "err"); return; }
  if (nouvel === (user.email || "").toLowerCase()) { toast("C'est déjà ton adresse actuelle.", "info"); return; }
  if (!user.providerData?.some(p => p.providerId === "password")) {
    toast("Ce compte se connecte avec Google : l'email est géré par Google.", "info");
    return;
  }
  loader(true);
  try {
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, pwd);
    await user.reauthenticateWithCredential(cred);
    await user.verifyBeforeUpdateEmail(nouvel);
    toast("📧 Lien envoyé à " + nouvel + ". Ouvre ta boîte mail et clique dessus pour confirmer.", "info", 9000);
    ["p-email-new", "p-email-pwd"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  } catch (e) {
    const msgs = {
      "auth/wrong-password":      "Mot de passe incorrect.",
      "auth/invalid-credential":  "Mot de passe incorrect.",
      "auth/email-already-in-use": "Cette adresse est déjà utilisée par un autre compte.",
      "auth/invalid-email":       "Adresse email invalide.",
      "auth/too-many-requests":   "Trop de tentatives. Réessaie plus tard.",
      "auth/requires-recent-login": "Reconnecte-toi puis réessaie.",
    };
    toast(msgs[e.code] || ("Erreur : " + (e.message || e.code)), "err");
  }
  loader(false);
};

window.selectChip = function selectChip(btn, groupId, inputId) {
  document.querySelectorAll(`#${groupId} .option-chip`).forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const el = document.getElementById(inputId);
  if (el) el.value = btn.dataset.val;
};

function setChipValue(groupId, val, inputId) {
  document.querySelectorAll(`#${groupId} .option-chip`).forEach(b => {
    b.classList.toggle("active", b.dataset.val === val);
  });
  const el = document.getElementById(inputId);
  if (el) el.value = val;
}

// ─────────────────────────────────────────────────────
//  TYPE DE DOCUMENT
// ─────────────────────────────────────────────────────

window.setDocType = function setDocType(type, btn) {
  window.docType = type;
  document.querySelectorAll(".doc-type-btn").forEach(b => b.classList.remove("active"));
  btn?.classList.add("active");
  const el = document.getElementById("montant-recu-group");
  if (el) el.style.display = type === "devis" ? "none" : "";
};

// ─────────────────────────────────────────────────────
//  LIGNES — stubs compatibilité POS cartes
// ─────────────────────────────────────────────────────

window.ajouterLigne    = function() { if (typeof posAddCard === "function") posAddCard(); };
window.calcLigne       = function() {};
window.supprimerLigne  = function() {};

// ─────────────────────────────────────────────────────
//  CALCUL RÉCAPITULATIF
// ─────────────────────────────────────────────────────

window.calcRecap = function calcRecap() {
  const cfg      = window.config;
  const ent      = window.entreprise;
  const dev      = cfg.devise    ?? ent.devise ?? "F CFA";
  const pos      = cfg.devisePos ?? "after";
  const fmtLocal = n => {
    const s = Math.round(Number(n ?? 0)).toLocaleString("fr-FR");
    return pos === "before" ? `${dev}\u00A0${s}` : `${s}\u00A0${dev}`;
  };

  const remisePct = parseFloat(document.getElementById("opt-remise")?.value) || 0;
  const applyTva  = document.getElementById("opt-tva")?.checked || false;
  const tvaRate   = parseFloat(document.getElementById("p-tva-rate")?.value ?? cfg.tvaRate ?? 18);

  const ht       = window.lignes.reduce((acc, l) => acc + l.qte * l.prix * (1 - l.remise / 100), 0);
  const remiseMt = ht * remisePct / 100;
  const base     = ht - remiseMt;
  const tvaMt    = applyTva ? base * tvaRate / 100 : 0;
  const total    = base + tvaMt;

  const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? "" : "none"; };

  set("r-ht",     fmtLocal(ht));
  set("r-tva",    fmtLocal(tvaMt));
  set("r-remise", `-${fmtLocal(remiseMt)}`);
  set("r-total",  fmtLocal(total));
  show("r-tva-row",    applyTva);
  show("r-remise-row", remisePct > 0);

  const mRecu = parseFloat(document.getElementById("v-montant-recu")?.value) || 0;
  if (mRecu > 0 && window.docType !== "devis") {
    show("r-rendu-row", true);
    const rendu   = mRecu - total;
    const renduEl = document.getElementById("r-rendu");
    if (renduEl) {
      renduEl.textContent = fmtLocal(rendu);
      renduEl.style.color = rendu < 0 ? "var(--red)" : "var(--green)";
    }
  } else {
    show("r-rendu-row", false);
  }

  return { ht, remiseMt, tvaMt, total, tvaRate, remise: remisePct, applyTva };
};

// ─────────────────────────────────────────────────────
//  BUILD VENTE DATA
// ─────────────────────────────────────────────────────

function buildVenteData() {
  const { ht, remiseMt, tvaMt, total, tvaRate, remise, applyTva } = calcRecap();
  return {
    type:        window.docType,
    numero:      null,
    date:        new Date(),
    client: {
      nom:     document.getElementById("v-client-nom")?.value.trim()     ?? "",
      tel:     document.getElementById("v-client-tel")?.value.trim()     ?? "",
      email:   document.getElementById("v-client-email")?.value.trim()   ?? "",
      adresse: document.getElementById("v-client-adresse")?.value.trim() ?? "",
    },
    lignes:      window.lignes.map(l => ({ ...l })),
    paiement:    document.getElementById("v-paiement")?.value ?? "especes",
    montantRecu: parseFloat(document.getElementById("v-montant-recu")?.value) || 0,
    note:        document.getElementById("v-note")?.value.trim() ?? "",
    ht, remiseMt, tvaMt, total, tvaRate, remise, applyTva,
    devise:    window.config.devise    ?? window.entreprise.devise ?? "F CFA",
    devisePos: window.config.devisePos ?? "after",
  };
}

// ─────────────────────────────────────────────────────
//  ACTIONS VENTE
//  [FIX] Enregistrer/PDF/Imprimer persistaient chacune leur
//  propre appel à persisterVente() — cliquer sur "Enregistrer"
//  PUIS sur "PDF" créait deux ventes distinctes (double
//  décrémentation de stock, deux numéros de facture) pour une
//  seule opération perçue par l'utilisateur.
//
//  Solution : dès qu'une vente est enregistrée avec succès, un
//  popup de confirmation s'ouvre et VERROUILLE le formulaire
//  (l'overlay bloque tout clic sur le formulaire en dessous).
//  Les boutons Imprimer/PDF du popup réutilisent la vente déjà
//  enregistrée (aucun nouvel appel à persisterVente). Impossible
//  d'enregistrer une deuxième vente sans cliquer explicitement
//  sur "Nouvelle vente", qui déverrouille et vide le formulaire.
// ─────────────────────────────────────────────────────

let _venteEnCoursConfirmee = null; // vente déjà persistée, en attente d'action dans le popup

async function _finaliserVente(actionApres) {
  // Le formulaire est verrouillé tant que le popup de confirmation
  // est ouvert — ce garde-fou ne devrait normalement jamais servir,
  // mais protège si jamais l'overlay est contourné (raccourci
  // clavier, appel direct, etc.)
  if (_venteEnCoursConfirmee) return;

  const v = validerFormulaire();
  if (!v.ok) { toast(v.msg, "err"); return; }
  if (_saving) { toast("Sauvegarde en cours…", "info"); return; }

  const saved = await persisterVente(buildVenteData());
  if (!saved) return;

  _venteEnCoursConfirmee = saved;
  _ouvrirModalVenteConfirmee(saved, actionApres);
}

function _ouvrirModalVenteConfirmee(saved, actionApres) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("vc-numero", saved.numero ?? "");
  set("vc-total", fmt(saved.total ?? 0));
  document.getElementById("modal-vente-confirmee")?.classList.add("active");

  if (actionApres === "imprimer") {
    try {
      imprimerDocument(saved, window.entreprise, window.config);
      setTimeout(() => toast("🖨️ Dialogue d'impression ouvert"), 400);
    } catch (e) { toast("Erreur impression : " + e.message, "err"); }
  } else if (actionApres === "pdf") {
    try {
      const nom = genererPDF(saved, window.entreprise, window.config);
      toast(`📥 PDF prêt : ${nom}`);
    } catch (e) { toast("Erreur PDF : " + e.message, "err"); }
  }
}

window.vcImprimer = function vcImprimer() {
  if (!_venteEnCoursConfirmee) return;
  try {
    imprimerDocument(_venteEnCoursConfirmee, window.entreprise, window.config);
    setTimeout(() => toast("🖨️ Dialogue d'impression ouvert"), 400);
  } catch (e) { toast("Erreur impression : " + e.message, "err"); }
};

window.vcGenererPDF = function vcGenererPDF() {
  if (!_venteEnCoursConfirmee) return;
  try {
    const nom = genererPDF(_venteEnCoursConfirmee, window.entreprise, window.config);
    toast(`📥 PDF prêt : ${nom}`);
  } catch (e) { toast("Erreur PDF : " + e.message, "err"); }
};

window.vcNouvelleVente = function vcNouvelleVente() {
  document.getElementById("modal-vente-confirmee")?.classList.remove("active");
  _venteEnCoursConfirmee = null;
  resetForm();
};

window.actionImprimer = function actionImprimer() {
  _finaliserVente("imprimer");
};

window.actionGenererPDF = function actionGenererPDF(fromModal, venteDataOverride) {
  // PDF d'une vente déjà existante (depuis l'historique, par
  // exemple) — rien à enregistrer, on génère directement.
  if (venteDataOverride) {
    try {
      const nom = genererPDF(venteDataOverride, window.entreprise, window.config);
      toast(`📥 PDF prêt : ${nom}`);
    } catch (e) { toast("Erreur PDF : " + e.message, "err"); }
    return;
  }
  _finaliserVente("pdf");
};

window.sauvegarderSeulement = function sauvegarderSeulement() {
  _finaliserVente("save");
};

window.resetForm = function resetForm() {
  ["v-client-nom","v-client-tel","v-client-email","v-client-adresse",
   "v-note","v-montant-recu","opt-remise"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const tvaEl = document.getElementById("opt-tva");
  if (tvaEl) tvaEl.checked = window.config.showTva ?? false;
  window.lignes = [];
  // [FIX] Une "nouvelle vente" doit pouvoir être enregistrée à
  // nouveau — on oublie la vente précédemment confirmée.
  _venteEnCoursConfirmee = null;
  setDocType("facture", document.querySelector(".doc-type-btn"));
  calcRecap();
};

// ─────────────────────────────────────────────────────
//  PERSISTANCE — TRANSACTION FIRESTORE ATOMIQUE
//  [FIX P1-3/P2-4/P5] Version consolidée (déplacée depuis
//  index.html, seule version réellement active) :
//  - la vente ET la décrémentation du stock sont dans la MÊME
//    transaction Firestore (atomicité : tout réussit ou rien)
//  - les quantités sont regroupées par produitId avant de
//    calculer le nouveau stock (une vente avec 2 lignes du même
//    produit décrémente bien la somme des deux, pas une seule)
// ─────────────────────────────────────────────────────

async function persisterVente(data) {
  if (!window.currentUser) { toast("Non connecté.", "err"); return null; }
  _saving = true;
  loader(true);
  let savedData = null;
  try {
    const counterRef = settingsRef("counter");
    const ventesRef  = db.collection("ventes");
    const lignes     = data.lignes || [];
    const isDevis    = data.type === 'devis';

    // Regrouper les quantités par produitId (Map = un seul total
    // par produit, même si plusieurs lignes le référencent).
    const qteParProduit = new Map();
    if (!isDevis) {
      lignes.forEach(l => {
        if (l.produitId && l.qte > 0) {
          qteParProduit.set(l.produitId, (qteParProduit.get(l.produitId) || 0) + l.qte);
        }
      });
    }
    const produitIds  = [...qteParProduit.keys()];
    const produitRefs = produitIds.map(id => db.collection('produits').doc(id));

    await db.runTransaction(async transaction => {
      // Règle Firestore : TOUTES les lectures avant la première écriture.
      const counterSnap  = await transaction.get(counterRef);
      const produitSnaps = await Promise.all(produitRefs.map(ref => transaction.get(ref)));

      const currentVal = counterSnap.exists ? (counterSnap.data().val ?? 0) : 0;
      const newVal     = currentVal + 1;
      const numero     = genNumero(data.type, newVal);

      const toSave = {
        ...data,
        numero,
        date:      firebase.firestore.Timestamp.fromDate(data.date),
        uid:       window._shopUid(),
        creePar:   window.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // [FIX P1] Vérifier le stock disponible AVANT toute écriture.
      // Si une seule ligne dépasse le stock, toute la vente est
      // rejetée (pas de vente "partiellement" enregistrée).
      produitSnaps.forEach((snap, i) => {
        if (!snap.exists) return;
        const stockActuel = snap.data().stock;
        if (stockActuel === null || stockActuel === undefined) return;
        const qte = qteParProduit.get(produitIds[i]);
        if (qte > stockActuel) {
          const nom = snap.data().nom || "ce produit";
          throw new Error(
            `Stock insuffisant pour "${nom}" (disponible : ${stockActuel}, demandé : ${qte}).`
          );
        }
      });

      const newRef = ventesRef.doc();
      transaction.set(newRef, toSave);
      transaction.set(counterRef, { val: newVal }, { merge: true });

      // Stock décrémenté ici, dans la même transaction — si ça
      // échoue, toute la transaction (vente incluse) est annulée.
      // [FIX P1/P2-6] Chaque décrémentation génère aussi un
      // mouvement de stock traçable (qui, quand, combien, pourquoi).
      produitSnaps.forEach((snap, i) => {
        if (!snap.exists) return;
        const stockActuel = snap.data().stock;
        if (stockActuel === null || stockActuel === undefined) return;
        const qte          = qteParProduit.get(produitIds[i]);
        const nouveauStock = stockActuel - qte;
        transaction.update(produitRefs[i], { stock: nouveauStock });

        const mvtRef = db.collection("mouvements_stock").doc();
        transaction.set(mvtRef, {
          produitId:   produitIds[i],
          produitNom:  snap.data().nom || "",
          type:        "sortie",
          quantite:    qte,
          stockAvant:  stockActuel,
          stockApres:  nouveauStock,
          motif:       `Vente ${numero}`,
          venteId:     newRef.id,
          userId:      window.currentUser.uid,
          shopId:      window._shopUid(),
          createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      savedData = { ...data, numero, id: newRef.id };
    });

    toast("✅ Vente enregistrée !");
    window.allVentes = [
      { ...savedData, date: firebase.firestore.Timestamp.fromDate(data.date) },
      ...window.allVentes,
    ];
    chargerDashboard();
    updateBadgeCredits();
    if (produitRefs.length && typeof chargerCatalogue === 'function') chargerCatalogue();
  } catch (e) {
    // [FIX P1] Message dédié pour le rejet "stock insuffisant"
    // (pas de préfixe "Erreur sauvegarde" trompeur dans ce cas).
    if (e.message?.startsWith("Stock insuffisant")) {
      toast("⚠️ " + e.message, "err");
    } else {
      toast("Erreur sauvegarde : " + e.message, "err");
    }
    console.error("persisterVente:", e);
    savedData = null;
  } finally {
    _saving = false;
    loader(false);
  }
  return savedData;
}

// ─────────────────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────────────────

async function chargerDashboard() {
  if (!window.currentUser) return;
  try {
    const snap = await db.collection("ventes")
      .where("uid", "==", window._shopUid())
      .get();

    const ventes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDateObj(b.createdAt ?? b.date) - toDateObj(a.createdAt ?? a.date));

    window.allVentes = ventes;

    const now       = new Date();
    const debutJour = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    let nJour = 0, caJour = 0, nMois = 0, caMois = 0;
    ventes.forEach(v => {
      const d = toDateObj(v.date);
      if (d >= debutJour) { nJour++; caJour += v.total ?? 0; }
      if (d >= debutMois) { nMois++; caMois += v.total ?? 0; }
    });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("stat-jour",    nJour);
    set("stat-mois",    nMois);
    set("stat-ca-jour", Math.round(caJour).toLocaleString("fr-FR"));
    set("stat-ca-mois", Math.round(caMois).toLocaleString("fr-FR"));

    renderRecentList(ventes.slice(0, 8));
    updateBadgeCredits();
  } catch (e) { console.error("chargerDashboard:", e); }
}

function renderRecentList(ventes) {
  const tbody   = document.getElementById("dash-recent-list");
  if (!tbody) return;
  const typeLbl = { facture:"Facture", recu:"Reçu", devis:"Devis" };
  if (!ventes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucune vente enregistrée</td></tr>';
    return;
  }
  tbody.innerHTML = ventes.map(v => `
    <tr>
      <td class="mono">${escHtml(v.numero ?? "—")}</td>
      <td>${escHtml(v.client?.nom ?? "") || '<em style="color:var(--ink-muted)">Anonyme</em>'}</td>
      <td><span class="badge badge-${v.type ?? "facture"}">${typeLbl[v.type] ?? v.type}</span></td>
      <td class="mono">${fmt(v.total)}</td>
      <td style="color:var(--ink-muted);font-size:12px;">${fmtDate(v.date)}</td>
      <td>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="ouvrirDetail('${v.id}')">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
            <path d="M10 9v5M10 7v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </td>
    </tr>`).join("");
}

// ─────────────────────────────────────────────────────
//  HISTORIQUE
//  [FIX P5] Version consolidée : c'était la seule réellement
//  active (celle qui vivait dans index.html et écrasait la
//  version paginée ci-dessous). La pagination par page de 50
//  (HIST_PAGE_SIZE / "Charger plus") n'était donc plus utilisée
//  depuis l'introduction du multi-utilisateur — à réactiver
//  plus tard si le volume de ventes le justifie.
// ─────────────────────────────────────────────────────

window.chargerHistorique = async function chargerHistorique() {
  if (!window.currentUser) return;
  loader(true);
  try {
    const snap = await db.collection("ventes")
      .where("uid", "==", window._shopUid())
      .get();
    window.allVentes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDateObj(b.createdAt ?? b.date) - toDateObj(a.createdAt ?? a.date));
    filtrerHistorique();
    const container = document.getElementById("hist-charger-plus");
    if (container) {
      const nb = window.allVentes.length;
      container.innerHTML = `<div style="text-align:center;padding:10px;font-size:12px;color:var(--ink-muted);">${nb} vente${nb > 1 ? "s" : ""} au total</div>`;
    }
  } catch (e) {
    toast("Erreur chargement : " + e.message, "err");
  }
  loader(false);
};


window.filtrerHistorique = function filtrerHistorique() {
  // [FIX] Normalisation accents + casse pour la recherche
  const _norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const q     = _norm(document.getElementById("hist-search")?.value ?? "");
  const typeF     = document.getElementById("hist-type-filter")?.value ?? "";
  const dateDebut = document.getElementById("hist-date-debut")?.value ?? "";
  const dateFin   = document.getElementById("hist-date-fin")?.value   ?? "";

  let result = window.allVentes;
  if (q) result = result.filter(v =>
    _norm(v.numero      ?? "").includes(q) ||
    _norm(v.client?.nom ?? "").includes(q) ||
    _norm(v.client?.tel ?? "").includes(q)
  );
  if (typeF) result = result.filter(v => v.type === typeF);
  if (dateDebut) {
    const d0 = new Date(dateDebut + "T00:00:00");
    result = result.filter(v => toDateObj(v.date) >= d0);
  }
  if (dateFin) {
    const d1 = new Date(dateFin + "T23:59:59");
    result = result.filter(v => toDateObj(v.date) <= d1);
  }
  renderHistorique(result);
  updateTotalBar(result);
};

window.rechercherHistorique = function() { filtrerHistorique(); };

window.setPeriode = function setPeriode(periode, btn) {
  document.querySelectorAll(".chip[data-periode]").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  const now    = new Date();
  const pad    = n => String(n).padStart(2, "0");
  const toISO  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const debutInput = document.getElementById("hist-date-debut");
  const finInput   = document.getElementById("hist-date-fin");
  if (!debutInput || !finInput) return;

  if (!periode) {
    debutInput.value = ""; finInput.value = "";
  } else if (periode === "today") {
    debutInput.value = toISO(now); finInput.value = toISO(now);
  } else if (periode === "week") {
    const d7 = new Date(now); d7.setDate(d7.getDate() - 6);
    debutInput.value = toISO(d7); finInput.value = toISO(now);
  } else if (periode === "month") {
    debutInput.value = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
    finInput.value   = toISO(now);
  } else if (periode === "lastmonth") {
    const lm  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lme = new Date(now.getFullYear(), now.getMonth(), 0);
    debutInput.value = toISO(lm); finInput.value = toISO(lme);
  }
  filtrerHistorique();
};

window.resetFiltresHistorique = function resetFiltresHistorique() {
  ["hist-search","hist-date-debut","hist-date-fin"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const sel = document.getElementById("hist-type-filter");
  if (sel) sel.value = "";
  document.querySelectorAll(".chip[data-periode]").forEach(b => {
    b.classList.toggle("active", b.dataset.periode === "");
  });
  filtrerHistorique();
};

function updateTotalBar(ventes) {
  const bar = document.getElementById("hist-total-bar");
  const lbl = document.getElementById("hist-total-label");
  const val = document.getElementById("hist-total-val");
  if (!bar || !lbl || !val) return;
  if (!ventes.length) { bar.style.display = "none"; return; }
  const total = ventes.reduce((s, v) => s + (v.total ?? 0), 0);
  bar.style.display = "flex";
  lbl.textContent   = `${ventes.length} document${ventes.length > 1 ? "s" : ""} affiché${ventes.length > 1 ? "s" : ""}`;
  val.textContent   = fmt(total);
}

function renderHistorique(ventes) {
  const tbody   = document.getElementById("hist-list");
  if (!tbody) return;
  const typeLbl = { facture:"Facture", recu:"Reçu", devis:"Devis" };
  const pmodes  = {
    especes:"💵 Espèces", mobile_money:"📱 Mobile Money",
    virement:"🏦 Virement", cheque:"📋 Chèque", credit:"💳 Crédit",
  };

  if (!ventes.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Aucune vente pour ces critères.</td></tr>';
    return;
  }

  tbody.innerHTML = ventes.map(v => {
    const isAnnulee = v.annulee === true;
    const rowStyle  = isAnnulee ? 'opacity:.55;' : '';
    const numStyle  = isAnnulee ? 'text-decoration:line-through;' : '';
    const badge     = isAnnulee
      ? '<span class="badge" style="background:var(--red-bg);color:var(--red);">Annulée</span>'
      : `<span class="badge badge-${v.type ?? "facture"}">${typeLbl[v.type] ?? v.type}</span>`;
    const actionBtns = isAnnulee
      ? `<span style="font-size:11px;color:var(--ink-muted);padding:4px 6px;">${v.annuleeRaison ? escHtml(v.annuleeRaison).slice(0,30) : 'Annulée'}</span>`
      : `
          <button class="btn btn-ghost btn-sm btn-icon" title="Voir" onclick="ouvrirDetail('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 4C6 4 2.5 7 1 10c1.5 3 5 6 9 6s7.5-3 9-6c-1.5-3-5-6-9-6z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" title="Imprimer" onclick="reimprimerVente('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </button>
          <button class="btn btn-primary btn-sm btn-icon" title="PDF" onclick="retelechargerPDF('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
          </button>
          <button class="btn btn-sm btn-icon" style="background:var(--red-bg);color:var(--red);" title="Annuler" onclick="supprimerVente('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M6 4v1H3v1h14V5h-3V4H6zM5 7v10h10V7H5zm3 2h1v6H8V9zm3 0h1v6h-1V9z" fill="currentColor"/></svg>
          </button>`;
    return `
    <tr style="${rowStyle}">
      <td class="mono" style="${numStyle}">${escHtml(v.numero ?? "—")}</td>
      <td>${escHtml(v.client?.nom ?? "") || '<span style="color:var(--ink-muted)">—</span>'}</td>
      <td>${badge}</td>
      <td style="font-size:12px;">${pmodes[v.paiement] ?? v.paiement ?? "—"}</td>
      <td class="mono" style="font-weight:600;">${fmt(v.total)}</td>
      <td style="color:var(--ink-muted);font-size:12px;">${fmtDate(v.date)}</td>
      <td><div style="display:flex;gap:4px;align-items:center;">${actionBtns}</div></td>
    </tr>`;
  }).join("");
}

window.supprimerVente = async function supprimerVente(id) {
  const v = window.allVentes.find(x => x.id === id);
  if (!v) { toast("Vente introuvable.", "err"); return; }

  // Demander la raison de l'annulation
  const raison = prompt(
    `Annuler la vente ${v.numero ?? ""} ?\n\n` +
    `La vente ne sera PAS supprimée définitivement — elle sera marquée comme annulée, ` +
    `le stock des produits vendus sera restitué, et elle restera visible dans l'historique.\n\n` +
    `Raison de l'annulation (optionnel) :`
  );

  // null = l'utilisateur a cliqué Annuler dans le prompt
  if (raison === null) return;
  const raisonFinale = raison.trim() || "Aucune raison précisée";

  loader(true);
  try {
    const venteRef = db.collection("ventes").doc(id);

    // [FIX P1-4] Annulation + restitution du stock dans UNE SEULE
    // transaction : soit tout réussit, soit rien n'est écrit.
    // La vente est relue depuis Firestore (pas depuis le cache local)
    // pour empêcher une double annulation en cas de double-clic ou
    // d'action simultanée par deux membres de l'équipe.
    await db.runTransaction(async transaction => {
      const venteSnap = await transaction.get(venteRef);
      if (!venteSnap.exists) throw new Error("Vente introuvable.");
      const venteData = venteSnap.data();
      if (venteData.annulee === true) throw new Error("Cette vente est déjà annulée.");

      const lignes = venteData.lignes || [];
      const qteParProduit = new Map();
      if (venteData.type !== 'devis') {
        lignes.forEach(l => {
          if (l.produitId && l.qte > 0) {
            qteParProduit.set(l.produitId, (qteParProduit.get(l.produitId) || 0) + l.qte);
          }
        });
      }
      const produitIds  = [...qteParProduit.keys()];
      const produitRefs = produitIds.map(pid => db.collection('produits').doc(pid));

      // Règle Firestore : toutes les lectures avant la première écriture.
      const produitSnaps = await Promise.all(produitRefs.map(ref => transaction.get(ref)));

      transaction.update(venteRef, {
        annulee:       true,
        annuleeLe:     firebase.firestore.FieldValue.serverTimestamp(),
        annuleeRaison: raisonFinale,
        annuleePar:    window.currentUser.uid,
      });

      // Restituer le stock de chaque produit concerné.
      // [FIX P2-6] Chaque restitution génère un mouvement de stock.
      produitSnaps.forEach((snap, i) => {
        if (!snap.exists) return;
        const stockActuel = snap.data().stock;
        if (stockActuel === null || stockActuel === undefined) return;
        const qte          = qteParProduit.get(produitIds[i]);
        const nouveauStock = stockActuel + qte;
        transaction.update(produitRefs[i], { stock: nouveauStock });

        const mvtRef = db.collection("mouvements_stock").doc();
        transaction.set(mvtRef, {
          produitId:   produitIds[i],
          produitNom:  snap.data().nom || "",
          type:        "annulation",
          quantite:    qte,
          stockAvant:  stockActuel,
          stockApres:  nouveauStock,
          motif:       `Annulation vente ${venteData.numero ?? ""} — ${raisonFinale}`,
          venteId:     id,
          userId:      window.currentUser.uid,
          shopId:      venteData.uid,
          createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
    });

    // Mettre à jour le cache local
    const idx = window.allVentes.findIndex(x => x.id === id);
    if (idx !== -1) {
      window.allVentes[idx] = {
        ...window.allVentes[idx],
        annulee: true,
        annuleeLe: firebase.firestore.Timestamp.fromDate(new Date()),
        annuleeRaison: raisonFinale,
      };
    }

    filtrerHistorique();
    chargerDashboard();
    if (typeof chargerCatalogue === 'function') chargerCatalogue();
    toast("Vente annulée — stock restitué, conservée dans l'historique.");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.reimprimerVente = function reimprimerVente(id) {
  const v = window.allVentes.find(x => x.id === id);
  if (!v) { toast("Vente introuvable.", "err"); return; }
  try {
    imprimerDocument({ ...v, date: toDateObj(v.date) }, window.entreprise, window.config);
    setTimeout(() => toast("🖨️ Dialogue d'impression ouvert"), 400);
  } catch (e) { toast("Erreur impression : " + e.message, "err"); }
};

window.retelechargerPDF = function retelechargerPDF(id) {
  const v = window.allVentes.find(x => x.id === id);
  if (!v) { toast("Vente introuvable.", "err"); return; }
  try {
    const nom = genererPDF({ ...v, date: toDateObj(v.date) }, window.entreprise, window.config);
    toast(`📥 PDF : ${nom}`);
  } catch (e) { toast("Erreur PDF : " + e.message, "err"); }
};

// ─────────────────────────────────────────────────────
//  BADGE CRÉDITS
// ─────────────────────────────────────────────────────

window.updateBadgeCredits = function updateBadgeCredits() {
  try {
    const nbEncours = window.allVentes.filter(v =>
      v.paiement === "credit" && !v.solde
    ).length;
    const badge = document.getElementById("sb-credits-badge");
    if (badge) {
      badge.style.display = nbEncours > 0 ? "inline-block" : "none";
      badge.textContent   = nbEncours > 9 ? "9+" : String(nbEncours);
    }
  } catch (e) { console.warn("updateBadgeCredits:", e); }
};

// ─────────────────────────────────────────────────────
//  MODAL DÉTAIL VENTE
// ─────────────────────────────────────────────────────

window.ouvrirDetail = function ouvrirDetail(id) {
  const v = window.allVentes.find(x => x.id === id);
  if (!v) return;

  const typeLbl = { facture:"Facture", recu:"Reçu", devis:"Devis" };
  const pmodes  = { especes:"Espèces", mobile_money:"Mobile Money",
                    virement:"Virement", cheque:"Chèque", credit:"Crédit" };

  document.getElementById("modal-detail-title").textContent =
    `${typeLbl[v.type] ?? v.type} — ${v.numero ?? ""}`;

  const lignesHtml = (v.lignes ?? []).map(l => `
    <tr>
      <td style="padding:7px 10px;">${escHtml(l.des ?? "—")}</td>
      <td style="padding:7px 10px;text-align:center;">${l.qte}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;">${Math.round(l.prix).toLocaleString("fr-FR")}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;">
        ${Math.round(l.qte * l.prix * (1 - (l.remise ?? 0) / 100)).toLocaleString("fr-FR")}
      </td>
    </tr>`).join("");

  document.getElementById("modal-detail-body").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div style="background:var(--bg);border-radius:8px;padding:12px;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:5px;">Client</div>
        <div style="font-weight:600;">${escHtml(v.client?.nom ?? "Anonyme")}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${escHtml(v.client?.tel ?? "")}</div>
        ${v.client?.email ? `<div style="font-size:12px;color:var(--ink-soft);">${escHtml(v.client.email)}</div>` : ""}
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:12px;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:5px;">Paiement</div>
        <div style="font-weight:600;">${pmodes[v.paiement] ?? v.paiement ?? "—"}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${fmtDate(v.date)}</div>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
        <thead><tr style="background:var(--bg);">
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:var(--ink-muted);">Article</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:var(--ink-muted);">Qté</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;color:var(--ink-muted);">P.U.</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;color:var(--ink-muted);">Total</th>
        </tr></thead>
        <tbody>${lignesHtml}</tbody>
      </table>
    </div>
    <div style="background:var(--copper-bg);border:1px solid var(--copper-brd);border-radius:10px;padding:14px;text-align:right;">
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:4px;">TOTAL</div>
      <div style="font-family:'DM Serif Display',serif;font-size:26px;color:var(--copper);">${fmt(v.total)}</div>
      ${v.montantRecu > 0 ? `
        <div style="font-size:12px;color:var(--ink-soft);margin-top:5px;">Reçu : ${fmt(v.montantRecu)}</div>
        <div style="font-size:13px;font-weight:700;color:${(v.montantRecu - v.total) >= 0 ? "var(--green)" : "var(--red)"};">
          Rendu : ${fmt(v.montantRecu - v.total)}
        </div>` : ""}
    </div>
    ${v.note ? `<div style="margin-top:10px;padding:10px 14px;background:var(--bg);border-radius:8px;font-size:12px;color:var(--ink-muted);"><strong>Note :</strong> ${escHtml(v.note)}</div>` : ""}
  `;

  const venteData = { ...v, date: toDateObj(v.date) };
  const printBtn  = document.getElementById("modal-print-btn");
  const pdfBtn    = document.getElementById("modal-pdf-btn");
  if (printBtn) {
    printBtn.style.display = "";
    printBtn.onclick = () => {
      try { imprimerDocument(venteData, window.entreprise, window.config); }
      catch (e) { toast("Erreur : " + e.message, "err"); }
    };
  }
  if (pdfBtn) {
    pdfBtn.style.display = "";
    pdfBtn.onclick = () => actionGenererPDF(true, venteData);
  }

  document.getElementById("modal-detail").classList.add("active");
};

window.fermerModal = function fermerModal() {
  document.getElementById("modal-detail").classList.remove("active");
};

document.getElementById("modal-detail")?.addEventListener("click", function(e) {
  if (e.target === this) fermerModal();
});

// ─────────────────────────────────────────────────────
//  EXPORT CSV
// ─────────────────────────────────────────────────────

window.exporterExcel = function exporterExcel() {
  const ventes = window.allVentes;
  if (!ventes.length) { toast("Aucune donnée.", "info"); return; }
  const rows = ventes.map(v => ({
    "Numéro":    v.numero      ?? "",
    "Type":      v.type        ?? "",
    "Client":    v.client?.nom ?? "",
    "Téléphone": v.client?.tel ?? "",
    "Paiement":  v.paiement    ?? "",
    "Total":     v.total       ?? 0,
    "Date":      fmtDate(v.date),
    "Note":      v.note        ?? "",
  }));
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(";"),
    ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g,'""')}"`).join(";")),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `ventes_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("✅ Export CSV téléchargé !");
};
// ══════════════════════════════════════════════════════
//  shop.js  —  FacturaPro
//
//  [FIX P3] Logique métier extraite de index.html — c'était le
//  plus gros morceau de code JS encore embarqué directement dans
//  la page HTML (près de 1000 lignes), difficile à retrouver et
//  à faire évoluer séparément du reste.
//
//  Contenu : thèmes, équipe (création/suppression de comptes
//  caissier/gérant, restrictions par rôle), paramètres de
//  l'entreprise (identité, logo, signature, cachet, textes des
//  documents), sécurité du compte, POS (sélection de produits
//  dans la vente), et modales associées.
//
//  Chargé après app.js et avant pwa-install.js, exactement à la
//  même place que l'ancien <script> inline — même ordre
//  d'exécution, même portée globale (script classique, pas de
//  module), aucun changement de comportement.
// ══════════════════════════════════════════════════════

/* ═══════════════════════════════════════════════════════
   THÈMES — bascule rapide + sélection multi-thèmes
   ═══════════════════════════════════════════════════════ */

function _syncThemeIcon(theme){
  const btn = document.getElementById('theme-toggle-btn');
  if(!btn) return;
  const isDark = theme !== 'light';
  btn.querySelector('.icon-sun').style.display  = isDark ? 'none' : '';
  btn.querySelector('.icon-moon').style.display = isDark ? '' : 'none';
}

// Bascule rapide clair <-> dernier thème sombre utilisé (par défaut "dark")
window.toggleTheme = function(){
  const cur  = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'light' ? (localStorage.getItem('fp_last_dark') || 'dark') : 'light';
  setTheme(next);
};

// Sélection explicite d'un thème (utilisé aussi par les chips Paramètres)
window.setTheme = function(theme, btn){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fp_theme', theme);
  if (theme !== 'light') localStorage.setItem('fp_last_dark', theme);
  _syncThemeIcon(theme);

  document.querySelectorAll('#theme-chips .option-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme));

  // Sync Firestore pour retrouver le thème sur un autre appareil
  if (window.currentUser?.uid) {
    db.collection("users").doc(window.currentUser.uid)
      .collection("settings").doc("config")
      .set({ theme }, { merge: true }).catch(()=>{});
  }
};

document.addEventListener('DOMContentLoaded', function(){
  const t = document.documentElement.getAttribute('data-theme') || 'light';
  _syncThemeIcon(t);
  document.querySelectorAll('#theme-chips .option-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
});

// Restaure le thème sauvegardé côté Firestore à la connexion
auth.onAuthStateChanged(function(user){
  if (!user) return;
  db.collection("users").doc(user.uid).collection("settings").doc("config").get()
    .then(function(snap){
      if (snap.exists && snap.data().theme) {
        const saved = snap.data().theme;
        const local = localStorage.getItem('fp_theme');
        // Le choix local (déjà appliqué par l'anti-flash) prime tant que
        // l'utilisateur ne s'est pas connecté depuis un autre appareil.
        if (saved !== local) setTheme(saved);
      }
    }).catch(function(){});
});

/* ═══════════════════════════════════════════════════════
   ADMINISTRATION — création de comptes commerçants
   sans passer par la console Firebase.

   PRÉ-REQUIS (à faire une seule fois, voir explication à côté) :
   1. Un document Firestore admins/{votre-uid} (n'importe quel champ)
   2. Cette règle ajoutée dans firestore.rules :
      match /admins/{uid} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }

   PRINCIPE :
   On ouvre une 2e instance Firebase ("Secondary") en parallèle de la
   session admin. createUserWithEmailAndPassword() sur cette instance
   connecte automatiquement ce nouvel utilisateur — mais UNIQUEMENT
   dans l'instance secondaire, donc la session admin (instance
   principale) n'est jamais touchée. On en profite pour pré-remplir
   les settings du nouveau compte (autorisé car on est authentifié
   en tant que lui dans l'app secondaire), puis on se déconnecte de
   l'instance secondaire et on revient à l'admin.
   ═══════════════════════════════════════════════════════ */

let _secondaryApp = null;
function _getSecondaryApp(){
  if (_secondaryApp) return _secondaryApp;
  _secondaryApp = firebase.apps.find(a => a.name === 'Secondary')
    || firebase.initializeApp(FIREBASE_CONFIG, 'Secondary');
  return _secondaryApp;
}

window.isAdmin = false;

async function _checkAdminStatus(user){
  try {
    const snap = await db.collection('admins').doc(user.uid).get();
    window.isAdmin = snap.exists;
  } catch(e) { window.isAdmin = false; }
  const sec  = document.getElementById('sb-section-admin');
  const item = document.getElementById('sb-item-admin');
  if (sec)  sec.classList.toggle('hidden', !window.isAdmin);
  if (item) item.classList.toggle('hidden', !window.isAdmin);
  if (window.isAdmin) _adminLoadUsersList();
}

auth.onAuthStateChanged(user => { if (user) _checkAdminStatus(user); });

window.adminCreerUtilisateur = async function(){
  const email  = document.getElementById('adm-email')?.value.trim();
  const pwd    = document.getElementById('adm-pwd')?.value;
  const nomEnt = document.getElementById('adm-nom-entreprise')?.value.trim();
  const tel    = document.getElementById('adm-tel')?.value.trim();

  if (!email || !pwd) { toast('Email et mot de passe requis.', 'err'); return; }
  if (pwd.length < 6)  { toast('Mot de passe trop court (min 6 caractères).', 'err'); return; }

  loader(true);
  try {
    const secApp  = _getSecondaryApp();
    const secAuth = secApp.auth();
    const secDb   = secApp.firestore();

    const cred   = await secAuth.createUserWithEmailAndPassword(email, pwd);
    const newUid = cred.user.uid;

    await secDb.collection('users').doc(newUid).collection('settings').doc('entreprise').set({
      nom: nomEnt || '', slogan: '', tel: tel || '', tel2: '', email,
      web: '', adresse: '', ville: '', pays: 'Togo', devise: 'F CFA',
      rc: '', nif: '', logoUrl: '',
    });
    await secDb.collection('users').doc(newUid).collection('settings').doc('config').set({
      format: 'thermal', devisePos: 'after', devise: 'F CFA',
      showLogo: true, showCompany: true, showDate: true, showRef: false,
      showRendu: true, showTva: false, tvaRate: 18, showSign: false,
      headerText: '', footerThanks: 'Merci pour votre achat !',
      footerLegal: 'Articles non repris ni échangés.',
    });

    // Se déconnecter de l'app secondaire — la session admin n'a jamais bougé
    await secAuth.signOut();

    // Garder une trace côté admin (autorisé : c'est son propre document)
    await db.collection('users').doc(window.currentUser.uid)
      .collection('settings').doc('team').set({
        accounts: firebase.firestore.FieldValue.arrayUnion({
          uid: newUid, email, nomEntreprise: nomEnt || '', tel: tel || '',
          createdAt: new Date().toISOString(),
        }),
      }, { merge: true });

    toast('✅ Compte créé pour ' + email);
    ['adm-email','adm-pwd','adm-nom-entreprise','adm-tel'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    _adminLoadUsersList();
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Cet email est déjà utilisé par un autre compte.',
      'auth/invalid-email': 'Adresse email invalide.',
      'auth/weak-password': 'Mot de passe trop faible.',
    };
    toast('Erreur : ' + (msgs[e.code] || e.message || e), 'err');
  }
  loader(false);
};

async function _adminLoadUsersList(){
  const tbody = document.getElementById('adm-users-list');
  if (!tbody || !window.currentUser) return;
  try {
    const snap = await db.collection('users').doc(window.currentUser.uid)
      .collection('settings').doc('team').get();
    const accounts = (snap.exists && snap.data().accounts) || [];
    if (!accounts.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Aucun compte créé pour le moment.</td></tr>';
      return;
    }
    tbody.innerHTML = accounts.slice().reverse().map(a => `
      <tr>
        <td>${escHtml(a.email || '—')}</td>
        <td>${escHtml(a.nomEntreprise || '—')}</td>
        <td>${escHtml(a.tel || '—')}</td>
        <td style="color:var(--ink-muted);font-size:12px;">${a.createdAt ? new Date(a.createdAt).toLocaleDateString('fr-FR') : '—'}</td>
      </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Erreur de chargement.</td></tr>';
  }
}

// [FIX] Titre "Administration" : consolidé dans app.js (titles map
// de showView), qui reflète l'id RÉELLEMENT affiché après contrôle
// de rôle — l'ancienne surcharge ici se basait sur l'id demandé à
// l'origine, ce qui pouvait afficher un titre incorrect si l'accès
// était refusé et redirigé vers le tableau de bord.

/* ═══════════════════════════════════════════════════════
   ÉQUIPE — comptes caissiers/gérants séparés par boutique

   Modèle : shopId = uid du propriétaire (aucune migration
   nécessaire, tes données existantes restent valides).
   staff_index/{staffUid} = { shopId, role, email, nom }
   indique à quelle boutique appartient chaque membre.

   [FIX P1-1/2] _shopUid(), activeShopUid, userRole et la
   résolution du contexte (_resolveShopContext) vivent
   maintenant dans app.js, appelés dès le tout début de
   onUserConnected — donc plus besoin de les redéfinir ni de
   surcharger onUserConnected ici. Ce fichier ne garde que les
   fonctions UI propres à l'écran "Équipe" (restrictions par
   rôle, liste des membres) ; app.js les appelle lui-même via
   un hook (typeof _applyRoleRestrictions === "function", etc.)
   une fois le contexte boutique connu.
   ═══════════════════════════════════════════════════════ */

function _applyRoleRestrictions(){
  const role = window.userRole || 'owner';
  document.querySelectorAll('.sb-item[data-view]').forEach(el => {
    if (el.id !== 'sb-item-admin') el.classList.remove('hidden');
  });

  // [FIX] Dérivé de window.VUES_PAR_ROLE (app.js) — la même liste
  // qui bloque l'accès direct dans showView(). Un seul endroit à
  // modifier si les permissions changent un jour.
  const autorisees = window.VUES_PAR_ROLE?.[role];
  if (autorisees) {
    document.querySelectorAll('.sb-item[data-view]').forEach(el => {
      if (!autorisees.includes(el.dataset.view)) el.classList.add('hidden');
    });
  }
  if (role !== 'owner') {
    document.getElementById('sb-item-team')?.classList.add('hidden');
    document.getElementById('sb-section-team')?.classList.add('hidden');
    // [SOFT] Le bouton "Plus" (mobile) ne sert qu'à regrouper
    // Équipe/Paramètres/Administration — inutile pour un rôle qui
    // n'y a de toute façon pas accès.
    document.getElementById('sb-item-plus')?.classList.add('hidden');
  }
  // "Équipe" reste réservé au propriétaire (owner)

  // [FIX STOCK-CAISSIER] Le caissier voit le catalogue (donc le
  // stock disponible) mais en LECTURE SEULE : pas de création /
  // modification / suppression de produit, pas de ravitaillement
  // (les seules actions qui changent le stock autrement qu'en
  // vendant). Les cartes produit elles-mêmes sont rendues sans les
  // boutons Modifier/Supprimer par renderCatalogue() (catalogue.js),
  // qui teste aussi window.userRole.
  const catalogueEnLectureSeule = (role === 'caissier');
  ['btn-ravitaillement', 'btn-historique-ravitaillement', 'btn-nouveau-produit'].forEach(id => {
    document.getElementById(id)?.classList.toggle('hidden', catalogueEnLectureSeule);
  });
}

/* [FIX P5] chargerCatalogue() et sauvegarderProduit() : la
   redéfinition ici a été supprimée — catalogue.js utilise déjà
   window._shopUid() nativement (voir js/catalogue.js). Garder une
   seule version évite qu'une correction future dans catalogue.js
   soit silencieusement ignorée parce qu'écrasée ici. */

/* [FIX P5] chargerDashboard() et chargerCredits() : redéfinitions
   supprimées ici — app.js et credits.js utilisent déjà
   window._shopUid() nativement, les deux versions étaient
   devenues strictement identiques. chargerHistorique() a été
   déplacée dans app.js (voir note dans app.js : la pagination
   d'origine avait été perdue en écrasant la fonction ici, à
   vérifier si tu veux la restaurer). */

/* [FIX P5] validerFormulaire() : redéfinition supprimée — la
   validation du paiement (montant reçu vs total, sauf "À crédit")
   vit maintenant directement dans app.js, seule source. */

/* [FIX P5] persisterVente() : redéfinition supprimée — la version
   avec vente + décrémentation de stock dans la même transaction
   vit maintenant directement dans app.js, seule source. */

// [FIX] Titre "Caissiers & Gérants" et chargement de la liste de
// l'équipe : consolidés dans app.js (voir showView) — même raison
// que pour "Administration" ci-dessus.

/* ── Créer un accès caissier/gérant ── */
window.teamCreerMembre = async function(){
  const email = document.getElementById('team-email')?.value.trim();
  const pwd   = document.getElementById('team-pwd')?.value;
  const nom   = document.getElementById('team-nom')?.value.trim();
  const role  = document.getElementById('team-role')?.value || 'caissier';

  if (!email || !pwd) { toast('Email et mot de passe requis.', 'err'); return; }
  if (pwd.length < 6)  { toast('Mot de passe trop court (min 6 caractères).', 'err'); return; }

  loader(true);
  try {
    const secApp  = _getSecondaryApp();
    const secAuth = secApp.auth();
    const cred    = await secAuth.createUserWithEmailAndPassword(email, pwd);
    const newUid  = cred.user.uid;
    await secAuth.signOut();

    await db.collection('staff_index').doc(newUid).set({
      shopId: window.currentUser.uid,
      role, email, nom: nom || '',
      createdAt: new Date().toISOString(),
    });

    toast('✅ Accès créé pour ' + email);
    ['team-email','team-pwd','team-nom'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    _teamLoadMembers();
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Cet email est déjà utilisé par un autre compte.',
      'auth/invalid-email': 'Adresse email invalide.',
      'auth/weak-password': 'Mot de passe trop faible.',
    };
    toast('Erreur : ' + (msgs[e.code] || e.message || e), 'err');
  }
  loader(false);
};

async function _teamLoadMembers(){
  const tbody = document.getElementById('team-members-list');
  if (!tbody || !window.currentUser) return;
  try {
    const snap = await db.collection('staff_index').where('shopId', '==', window.currentUser.uid).get();
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Aucun caissier ou gérant pour le moment.</td></tr>';
      return;
    }
    const roleLbl = { caissier: 'Caissier', gerant: 'Gérant' };
    tbody.innerHTML = snap.docs.map(d => {
      const m = d.data();
      return `<tr>
        <td>${escHtml(m.nom || '—')}</td>
        <td>${escHtml(m.email || '—')}</td>
        <td><span class="badge" style="background:var(--copper-bg);color:var(--copper);">${roleLbl[m.role] || m.role}</span></td>
        <td style="color:var(--ink-muted);font-size:12px;">${m.createdAt ? new Date(m.createdAt).toLocaleDateString('fr-FR') : '—'}</td>
        <td><button class="btn btn-sm" style="background:var(--red-bg);color:var(--red);" onclick="teamRetirerAcces('${d.id}')">Retirer l'accès</button></td>
      </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Erreur de chargement.</td></tr>';
  }
}

window.teamRetirerAcces = async function(staffUid){
  if (!confirm("Retirer l'accès de ce membre à la boutique ?\n\nSon compte existera toujours mais il ne pourra plus voir aucune donnée de la boutique.")) return;
  loader(true);
  try {
    await db.collection('staff_index').doc(staffUid).delete();
    toast('Accès retiré.');
    _teamLoadMembers();
  } catch(e) { toast('Erreur : ' + e.message, 'err'); }
  loader(false);
};

/* [SUPPRIMÉ] _decrementerStock() — fusionnée directement dans
   persisterVente() ci-dessus (même transaction que la vente). */

/* ═══════════════════════════════════════════════════════
   MISE À JOUR UI UTILISATEUR
   Appelée par app.js via onUserConnected

   [PWA FIX] Le bloc PWA (install + service worker) a été
   retiré d'ici. Il vit maintenant entièrement dans
   js/pwa-install.js, chargé en toute fin de page, et
   s'exécute dès le chargement (pas après connexion).
   ═══════════════════════════════════════════════════════ */

// Surcharge de onUserConnected pour mettre à jour l'UI
const _origOnUserConnected = window.onUserConnected;
// app.js expose onUserConnected — on étend avec l'UI
auth.onAuthStateChanged(user => {
  if (!user) return;
  _updateUserUI(user);
  _updateSecurityTab(user);
});

function _updateUserUI(user) {
  const name   = user.displayName || user.email?.split("@")[0] || "Utilisateur";
  const email  = user.email || "";
  const photo  = user.photoURL;
  const initiale = name.charAt(0).toUpperCase();

  // Topbar
  const topbarUser   = document.getElementById("topbar-user");
  const topbarAvatar = document.getElementById("topbar-avatar");
  if (topbarUser)   topbarUser.textContent = name;
  if (topbarAvatar) {
    if (photo) {
      topbarAvatar.innerHTML = `<img src="${photo}" alt="${initiale}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      topbarAvatar.textContent = initiale;
    }
  }

  // Sidebar footer
  const sbName   = document.getElementById("sb-user-name");
  const sbEmail  = document.getElementById("sb-user-email");
  const sbAvatar = document.getElementById("sb-avatar");
  if (sbName)   sbName.textContent  = name;
  if (sbEmail)  sbEmail.textContent = email;
  if (sbAvatar) {
    if (photo) {
      sbAvatar.innerHTML = `<img src="${photo}" alt="${initiale}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      sbAvatar.textContent = initiale;
    }
  }
}

function _updateSecurityTab(user) {
  const isGoogle = user.providerData?.some(p => p.providerId === "google.com");
  const badge    = document.getElementById("google-account-badge");
  const form     = document.getElementById("password-change-form");
  if (badge) badge.style.display  = isGoogle ? "flex" : "none";
  if (form)  form.style.display   = isGoogle ? "none" : "block";
}

/* ═══════════════════════════════════════════════════════
   ÉTAT BOUTON GOOGLE (spinner pendant chargement)
   ═══════════════════════════════════════════════════════ */
const _origSeConnecterAvecGoogle = window.seConnecterAvecGoogle;
window.seConnecterAvecGoogle = async function() {
  const btn = document.getElementById("btn-google");
  if (btn) btn.classList.add("loading");
  try {
    await _origSeConnecterAvecGoogle();
  } finally {
    // Si la page ne se recharge pas (popup annulé), on retire le spinner
    setTimeout(() => { if (btn) btn.classList.remove("loading"); }, 3000);
  }
};

/* ═══════════════════════════════════════════════════════
   POS — Système de cartes (identique à la version originale)
   ═══════════════════════════════════════════════════════ */
(function(){
'use strict';

let _pcCount = 0;

window.posInit = function(){
  _pcCount = 0;
  document.getElementById('pos-cards').innerHTML = '';
  posAddCard();
  posRefreshQuick();
};

window.posAddCard = function(){
  _pcCount++;
  const idx = _pcCount;
  const container = document.getElementById('pos-cards');
  if(!container) return null;

  const card = document.createElement('div');
  card.className = 'pos-card';
  card.dataset.idx = idx;
  card.innerHTML = `
    <div class="pc-head">
      <div class="pc-search-wrap">
        <input type="text" class="pc-search" placeholder="Rechercher un article du catalogue…" autocomplete="off" spellcheck="false">
        <input type="hidden" class="pc-pid">
        <div class="pc-dropdown" id="pc-dd-${idx}"></div>
      </div>
      <button type="button" class="pc-del" onclick="posDelCard(${idx})" title="Retirer">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="pc-body">
      <div class="pc-input-group">
        <span class="pc-input-lbl">Quantité</span>
        <input type="number" class="pc-input pc-qty" value="1" min="1" step="1">
      </div>
      <div class="pc-input-group">
        <span class="pc-input-lbl">Prix unit. (F CFA)</span>
        <input type="number" class="pc-input pc-prix" value="" min="0" step="1" placeholder="0">
      </div>
      <div class="pc-total-box">
        <div class="pc-total-lbl">Total ligne</div>
        <div class="pc-total-val pc-lt">0 F CFA</div>
      </div>
    </div>
    <div class="pc-stock-row">
      <span class="pc-stock-badge ok">
        <svg width="10" height="10" viewBox="0 0 20 20" fill="none"><path d="M4 10l5 5 7-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Stock : <span class="pc-sv">—</span>
      </span>
    </div>`;

  container.appendChild(card);
  _pcBind(card, idx);
  requestAnimationFrame(()=> card.querySelector('.pc-search')?.focus());
  return card;
};

function _pcBind(card, idx){
  const search = card.querySelector('.pc-search');
  const dd     = card.querySelector('.pc-dropdown');
  const qty    = card.querySelector('.pc-qty');
  const prix   = card.querySelector('.pc-prix');
  let _t = null;

  search.addEventListener('input', function(){
    clearTimeout(_t);
    const q = this.value.trim();
    if(q.length < 1){ _pcClose(dd); return; }
    _t = setTimeout(()=> _pcSearch(card, q, dd), 200);
  });
  search.addEventListener('focus', function(){
    if(this.value.trim().length >= 1) _pcSearch(card, this.value.trim(), dd);
  });
  search.addEventListener('keydown', function(e){
    const items = dd.querySelectorAll('.pc-item:not(.pc-disabled)');
    const cur   = dd.querySelector('.pc-item.pc-focused');
    let fi = -1;
    items.forEach((it,i)=>{ if(it===cur) fi=i; });
    if(e.key==='ArrowDown'){ e.preventDefault(); const next=items[fi+1]??items[0]; if(next){cur?.classList.remove('pc-focused');next.classList.add('pc-focused');next.scrollIntoView({block:'nearest'});} }
    else if(e.key==='ArrowUp'){ e.preventDefault(); const prev=items[fi-1]??items[items.length-1]; if(prev){cur?.classList.remove('pc-focused');prev.classList.add('pc-focused');prev.scrollIntoView({block:'nearest'});} }
    else if(e.key==='Enter'){ e.preventDefault(); cur?.click(); }
    else if(e.key==='Escape'){ _pcClose(dd); }
  });
  qty.addEventListener('input',  ()=> _pcCalc(card));
  prix.addEventListener('input', ()=> _pcCalc(card));
  document.addEventListener('click', function(e){ if(!card.contains(e.target)) _pcClose(dd); });
}

function _normalize(s){
  return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

function _pcSearch(card, q, dd){
  const produits = window.allProduits ?? [];
  if(!produits.length){
    dd.innerHTML = '<div class="pc-empty">Catalogue vide — ajoute des produits d\'abord.</div>';
    dd.classList.add('open'); return;
  }
  // Normalisation accents + casse : "ciment" trouve "Ciment Portland"
  const term = _normalize(q);
  const res = produits.filter(p =>
    _normalize(p.nom      ).includes(term)||
    _normalize(p.ref      ).includes(term)||
    _normalize(p.categorie).includes(term)
  ).slice(0,8);
  _pcRender(card, res, q, dd);
}

function _pcRender(card, results, q, dd){
  if(!results.length){
    dd.innerHTML = `<div class="pc-empty">Aucun résultat pour "<strong>${escHtml(q)}</strong>"</div>`;
    dd.classList.add('open'); return;
  }
  const hl = txt => {
    if(!q) return escHtml(txt);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    return escHtml(txt).replace(re, '<mark class="pc-hl">$1</mark>');
  };
  dd.innerHTML = results.map(p => {
    const stock = p.stock??0;
    const sCls  = stock<=0?'out':stock<=5?'low':'';
    const sLbl  = stock<=0?'⚠️ Rupture':`Stock : ${stock}`;
    const dis   = stock<=0?'pc-disabled':'';
    return `<div class="pc-item ${dis}" data-id="${p.id}" data-nom="${escHtml(p.nom)}" data-prix="${p.prix}" data-stock="${stock}">
      <div class="pc-item-left">
        <div class="pc-item-name">${hl(p.nom)}</div>
        ${p.ref?`<div class="pc-item-ref">Réf : ${hl(p.ref)}</div>`:''}
        ${p.categorie?`<div class="pc-item-ref">${escHtml(p.categorie)}</div>`:''}
      </div>
      <div class="pc-item-right">
        <div class="pc-item-prix">${Math.round(p.prix).toLocaleString('fr-FR')} F</div>
        <div class="pc-item-stock ${sCls}">${sLbl}</div>
      </div>
    </div>`;
  }).join('');
  dd.querySelectorAll('.pc-item:not(.pc-disabled)').forEach(item => {
    item.addEventListener('mousedown', function(e){
      e.preventDefault();
      _pcSelect(card, {id:this.dataset.id,nom:this.dataset.nom,prix:parseFloat(this.dataset.prix),stock:parseInt(this.dataset.stock)});
    });
  });
  dd.classList.add('open');
}

function _pcClose(dd){ dd.classList.remove('open'); }

function _pcSelect(card, data){
  card.querySelector('.pc-search').value = data.nom;
  card.querySelector('.pc-pid').value    = data.id;
  card.querySelector('.pc-prix').value   = data.prix;
  const stockRow   = card.querySelector('.pc-stock-row');
  const stockBadge = card.querySelector('.pc-stock-badge');
  const stockVal   = card.querySelector('.pc-sv');
  stockVal.textContent = data.stock;
  stockBadge.className = 'pc-stock-badge '+(data.stock<=0?'out':data.stock<=5?'low':'ok');
  stockRow.style.display = '';
  const qtyEl = card.querySelector('.pc-qty');
  qtyEl.max = data.stock;
  if(parseInt(qtyEl.value)>data.stock) qtyEl.value=data.stock;
  _pcCalc(card);
  _pcClose(card.querySelector('.pc-dropdown'));
  card.classList.add('pc-highlight');
  setTimeout(()=>card.classList.remove('pc-highlight'),500);
  setTimeout(()=>qtyEl.select(),60);
}

function _pcCalc(card){
  const qty  = parseFloat(card.querySelector('.pc-qty').value)||0;
  const prix = parseFloat(card.querySelector('.pc-prix').value)||0;
  card.querySelector('.pc-lt').textContent = Math.round(qty*prix).toLocaleString('fr-FR')+' F CFA';
  _pcGrand();
}

function _pcGrand(){
  let total=0, count=0;
  document.querySelectorAll('#pos-cards .pos-card').forEach(c=>{
    const qty=parseFloat(c.querySelector('.pc-qty')?.value)||0;
    const prix=parseFloat(c.querySelector('.pc-prix')?.value)||0;
    if(qty>0&&prix>0){total+=qty*prix;count++;}
  });
  const elH=document.getElementById('pos-grand-total');
  if(elH) elH.textContent=Math.round(total).toLocaleString('fr-FR')+' F CFA';
  const elC=document.getElementById('pos-items-count');
  if(elC) elC.textContent=count+' article(s)';
  _pcSyncLignes();
  if(typeof calcRecap==='function') calcRecap();
}

function _pcSyncLignes(){
  window.lignes=[];
  document.querySelectorAll('#pos-cards .pos-card').forEach((c,i)=>{
    const des=c.querySelector('.pc-search')?.value.trim()??'';
    const prix=parseFloat(c.querySelector('.pc-prix')?.value)||0;
    const qte=parseFloat(c.querySelector('.pc-qty')?.value)||0;
    // [FIX] .pc-pid (l'ID du produit choisi dans le catalogue) n'était
    // jamais lu ici : chaque resynchronisation de window.lignes perdait
    // le lien vers le produit, donc le stock n'était jamais décrémenté.
    const pid=c.querySelector('.pc-pid')?.value || undefined;
    if(des||prix>0) window.lignes.push({id:Date.now()+i,des,prix,qte,remise:0,produitId:pid});
  });
}

window.posDelCard = function(idx){
  const all=document.querySelectorAll('#pos-cards .pos-card');
  if(all.length<=1){
    const c=all[0];
    c.querySelector('.pc-search').value='';
    c.querySelector('.pc-pid').value='';
    c.querySelector('.pc-qty').value=1;
    c.querySelector('.pc-prix').value='';
    c.querySelector('.pc-lt').textContent='0 F CFA';
    c.querySelector('.pc-stock-row').style.display='none';
    _pcGrand(); return;
  }
  const card=document.querySelector(`#pos-cards .pos-card[data-idx="${idx}"]`);
  if(!card) return;
  card.style.transition='opacity .2s,transform .2s';
  card.style.opacity='0';card.style.transform='translateX(-16px)';
  setTimeout(()=>{card.remove();_pcGrand();},220);
};

window.posQuickAdd = function(produit){
  const existing=Array.from(document.querySelectorAll('#pos-cards .pos-card'))
    .find(c=>c.querySelector('.pc-pid').value===String(produit.id));
  if(existing){
    const qi=existing.querySelector('.pc-qty');
    const max=parseInt(qi.max)||9999;
    if(parseInt(qi.value)<max){qi.value=parseInt(qi.value)+1;_pcCalc(existing);existing.classList.add('pc-highlight');setTimeout(()=>existing.classList.remove('pc-highlight'),500);}
    else toast('Stock maximum atteint','err');
    return;
  }
  const empty=Array.from(document.querySelectorAll('#pos-cards .pos-card')).find(c=>!c.querySelector('.pc-pid').value);
  if(empty){_pcSelect(empty,produit);empty.scrollIntoView({behavior:'smooth',block:'nearest'});}
  else{const newCard=posAddCard();setTimeout(()=>{_pcSelect(newCard,produit);newCard?.scrollIntoView({behavior:'smooth',block:'nearest'});},80);}
};

window.posRefreshQuick = function(){
  const produits=(window.allProduits??[]).filter(p=>(p.stock??0)>0).slice(0,12);
  const panel=document.getElementById('pos-quick-panel');
  const grid=document.getElementById('pos-quick-grid');
  if(!panel||!grid) return;
  if(!produits.length){panel.style.display='none';return;}
  panel.style.display='';
  grid.innerHTML=produits.map(p=>
    `<button type="button" class="qp-btn" onclick='posQuickAdd(${JSON.stringify({id:p.id,nom:p.nom,prix:p.prix,stock:p.stock??0})})'>${escHtml(p.nom.length>20?p.nom.slice(0,20)+'…':p.nom)}</button>`
  ).join('');
};

window.posSetExact = function(){
  try{const {total}=calcRecap();const el=document.getElementById('v-montant-recu');if(el){el.value=Math.round(total);calcRecap();}}catch(e){}
};
window.posAddMontant = function(n){const el=document.getElementById('v-montant-recu');if(el){el.value=(parseFloat(el.value)||0)+n;calcRecap();}};

window.switchTab = function(id, btn){
  document.querySelectorAll('.settings-tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.settings-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  btn?.classList.add('active');
};

window.updatePreviewEntreprise = function(){
  const g=id=>(document.getElementById(id)?.value??'').trim();
  const showRow=(rowId,valId,val)=>{const row=document.getElementById(rowId);const el=document.getElementById(valId);if(!row)return;if(val){row.style.display='';if(el)el.textContent=val;}else{row.style.display='none';}};
  const nom=g('p-nom')||'Nom entreprise';
  const slogan=g('p-slogan');const tel=g('p-tel');const email=g('p-email');
  const adr=[g('p-adresse'),g('p-ville'),g('p-pays')].filter(Boolean).join(', ');
  const web=g('p-web');const rc=g('p-rc');const nif=g('p-nif');
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  s('prev-nom',nom);s('prev-slogan',slogan);
  showRow('prev-row-tel','prev-tel',tel);showRow('prev-row-email','prev-email',email);
  showRow('prev-row-adr','prev-adr',adr);showRow('prev-row-web','prev-web',web);
  const fiscalContent=document.getElementById('prev-fiscal-content');
  const fiscalEmpty=document.getElementById('prev-fiscal-empty');
  if(fiscalContent){
    if(rc||nif){
      if(fiscalEmpty)fiscalEmpty.style.display='none';
      let html='';
      if(rc)html+=`<div class="fiscal-badge"><svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M9 2H5a1 1 0 00-1 1v14a1 1 0 001 1h10a1 1 0 001-1V8l-5-6z" stroke="currentColor" stroke-width="1.5"/></svg><strong>RC :</strong>&nbsp;${escHtml(rc)}</div>`;
      if(nif)html+=`<div class="fiscal-badge"><svg width="13" height="13" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 8h6M7 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><strong>NIF :</strong>&nbsp;${escHtml(nif)}</div>`;
      fiscalContent.querySelectorAll('.fiscal-badge').forEach(el=>el.remove());
      fiscalContent.insertAdjacentHTML('beforeend',html);
    }else{
      fiscalContent.querySelectorAll('.fiscal-badge').forEach(el=>el.remove());
      if(fiscalEmpty)fiscalEmpty.style.display='';
    }
  }
  updateLogoPreview();
};

window.updateLogoPreview = function(){
  const url=document.getElementById('p-logo-url')?.value.trim();
  const wrap=document.getElementById('logo-preview-wrap');
  if(!wrap)return;
  wrap.innerHTML=url?`<img src="${escHtml(url)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentNode.innerHTML='<svg width=38 height=38 viewBox=0 0 24 24 fill=none><path d=M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z stroke=rgba(255,255,255,.6) stroke-width=1.5/></svg>'">`:'<svg width="38" height="38" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="rgba(255,255,255,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="9 22 9 12 15 12 15 22" stroke="rgba(255,255,255,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
};

const _origReset=window.resetForm;
window.resetForm=function(){
  if(typeof _origReset==='function')_origReset();
  document.getElementById('pos-cards').innerHTML='';
  _pcCount=0;posAddCard();
};

/* ── Logo upload (Cloudinary) ── */
const CLOUDINARY_CLOUD_NAME    = "dl3bs1azn";
const CLOUDINARY_UPLOAD_PRESET = "facturapro_logos";

function _setLogoThumb(url){const wrap=document.getElementById('logo-thumb-wrap');if(!wrap)return;wrap.innerHTML=url?`<img src="${escHtml(url)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentNode.innerHTML='📷'">`:'';}
function _setLogoStatus(msg,color){const el=document.getElementById('logo-upload-status');if(!el)return;el.innerHTML=msg;el.style.color=color||'var(--ink-muted)';}
function _setLogoProgress(pct){const wrap=document.getElementById('logo-progress-wrap');const bar=document.getElementById('logo-progress-bar');const lbl=document.getElementById('logo-progress-pct');if(!wrap)return;if(pct===null){wrap.style.display='none';return;}wrap.style.display='';if(bar)bar.style.width=pct+'%';if(lbl)lbl.textContent=Math.round(pct)+'%';}
function _applyLogoUrl(url){const urlInput=document.getElementById('p-logo-url');if(urlInput)urlInput.value=url;_setLogoThumb(url);const sideWrap=document.getElementById('logo-preview-wrap');if(sideWrap){sideWrap.innerHTML=url?`<img src="${escHtml(url)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentNode.innerHTML='📷'">`:'';}};
async function _saveLogoToFirestore(url){try{const uid=window._shopUid();if(!uid)return;await db.collection("users").doc(uid).collection("settings").doc("entreprise").set({logoUrl:url},{merge:true});window.entreprise={...(window.entreprise||{}),logoUrl:url};toast('✅ Logo sauvegardé !');}catch(e){toast('Logo uploadé, erreur Firestore : '+e.message,'err');}}
async function _doUploadLogo(file){
  if(!file)return;
  const allowed=['image/jpeg','image/png','image/svg+xml','image/webp'];
  if(!allowed.includes(file.type)){toast('Format non supporté.','err');return;}
  if(file.size>2*1024*1024){toast('Fichier trop lourd (max 2 Mo).','err');return;}
  const reader=new FileReader();reader.onload=e=>_setLogoThumb(e.target.result);reader.readAsDataURL(file);
  if(!CLOUDINARY_CLOUD_NAME||!CLOUDINARY_UPLOAD_PRESET){const note=document.getElementById('cloudinary-setup-note');if(note)note.style.display='';_setLogoStatus('⚠️ Cloudinary non configuré.','var(--amber)');const det=document.getElementById('logo-url-details');if(det)det.open=true;return;}
  _setLogoStatus('⬆️ Envoi vers Cloudinary…','var(--copper)');_setLogoProgress(0);
  try{
    const formData=new FormData();formData.append('file',file);formData.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);
    if(window._shopUid())formData.append('folder',`facturapro/${window._shopUid()}`);
    formData.append('tags','facturapro,logo');
    const url=`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.upload.addEventListener('progress',e=>{if(e.lengthComputable)_setLogoProgress((e.loaded/e.total)*100);});
      xhr.addEventListener('load',()=>{if(xhr.status>=200&&xhr.status<300){try{const res=JSON.parse(xhr.responseText);resolve(res.secure_url||res.url);}catch{reject(new Error('Réponse invalide'));}}else{try{const err=JSON.parse(xhr.responseText);reject(new Error(err.error?.message||`HTTP ${xhr.status}`));}catch{reject(new Error(`HTTP ${xhr.status}`));}}});
      xhr.addEventListener('error',()=>reject(new Error('Erreur réseau')));
      xhr.timeout=30000;xhr.open('POST',url);xhr.send(formData);
    }).then(async logoUrl=>{_setLogoProgress(null);_setLogoStatus('✅ Logo enregistré !','var(--green)');_applyLogoUrl(logoUrl);await _saveLogoToFirestore(logoUrl);});
  }catch(e){_setLogoProgress(null);_setLogoStatus('❌ '+e.message,'var(--red)');toast('Erreur upload : '+e.message,'err');const det=document.getElementById('logo-url-details');if(det)det.open=true;}
}
window.handleLogoFileSelect=function(event){const file=event.target.files?.[0];if(file)_doUploadLogo(file);event.target.value='';};
window.handleLogoDrop=function(event){const file=event.dataTransfer.files?.[0];if(file)_doUploadLogo(file);};
document.getElementById('p-logo-url')?.addEventListener('input',function(){_applyLogoUrl(this.value.trim()||'');});

/* ═══════════════════════════════════════════════════
   SIGNATURE & CACHET — Fonctions génériques
   ═══════════════════════════════════════════════ */

const CLOUD  = "dl3bs1azn";
const PRESET = "facturapro_logos";

// Toggle visibilité section upload
window.toggleSignatureUpload = function() {
  const show = document.getElementById('p-show-sign')?.checked;
  const section = document.getElementById('signature-upload-section');
  if (section) section.style.display = show ? '' : 'none';
};

// Mettre à jour un aperçu image depuis une URL input
window.updateImgPreview = function(inputId, wrapId, delBtnId) {
  const url  = document.getElementById(inputId)?.value.trim();
  const wrap = document.getElementById(wrapId);
  const del  = document.getElementById(delBtnId);
  if (!wrap) return;
  if (url) {
    wrap.innerHTML = `<img src="${escHtml(url)}" alt="img"
      style="max-width:100%;max-height:100%;object-fit:contain;"
      onerror="this.parentNode.textContent='Image invalide'">`;
    if (del) del.style.display = '';
  } else {
    wrap.textContent = wrapId.includes('cachet') ? 'Aperçu cachet' : 'Aperçu signature';
    if (del) del.style.display = 'none';
  }
};

// Alias pour app.js (remplir champs config)
window.updateSignaturePreview = function() {
  updateImgPreview('p-signature-url','sign-preview-wrap','sign-delete-btn');
  updateImgPreview('p-cachet-url','cachet-preview-wrap','cachet-delete-btn');
};

// Supprimer une image de la config
window.supprimerImageConfig = async function(configKey, wrapId, delBtnId, inputId) {
  const input = document.getElementById(inputId);
  if (input) input.value = '';
  updateImgPreview(inputId, wrapId, delBtnId);
  try {
    const uid = window._shopUid();
    if (uid) {
      await db.collection("users").doc(uid)
        .collection("settings").doc("config")
        .set({ [configKey]: '' }, { merge: true });
      if (window.config) window.config[configKey] = '';
      toast('Image supprimée.');
    }
  } catch(e) { toast('Erreur : ' + e.message, 'err'); }
};

// Upload générique vers Cloudinary
window.handleImageUpload = async function(
  event, configKey,
  wrapId, delBtnId,
  barId, txtId, progWrapId, statusId, inputId
) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  if (file.size > 2*1024*1024) { toast('Fichier trop lourd (max 2 Mo).','err'); return; }

  // Prévisualisation locale immédiate
  const reader = new FileReader();
  reader.onload = e => {
    const wrap = document.getElementById(wrapId);
    if (wrap) wrap.innerHTML = `<img src="${e.target.result}"
      style="max-width:100%;max-height:100%;object-fit:contain;">`;
  };
  reader.readAsDataURL(file);

  const statusEl  = document.getElementById(statusId);
  const progWrapEl= document.getElementById(progWrapId);
  const barEl     = document.getElementById(barId);
  const txtEl     = document.getElementById(txtId);

  if (statusEl)   { statusEl.textContent = '⬆️ Upload…'; statusEl.style.color = 'var(--copper)'; }
  if (progWrapEl)   progWrapEl.style.display = '';

  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', PRESET);
    const uid = window._shopUid();
    if (uid) fd.append('folder', `facturapro/${uid}/${configKey}`);
    fd.append('tags', `facturapro,${configKey}`);

    const url = await new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded/e.total)*100);
          if (barEl) barEl.style.width = pct+'%';
          if (txtEl) txtEl.textContent = pct+'%';
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const r = JSON.parse(xhr.responseText);
          res(r.secure_url || r.url);
        } else { rej(new Error('HTTP '+xhr.status)); }
      });
      xhr.addEventListener('error', ()=>rej(new Error('Erreur réseau')));
      xhr.timeout = 30000;
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
      xhr.send(fd);
    });

    // Appliquer URL dans l'input
    const inp = document.getElementById(inputId);
    if (inp) inp.value = url;
    updateImgPreview(inputId, wrapId, delBtnId);

    // Sauvegarder Firestore
    if (uid) {
      await db.collection("users").doc(uid)
        .collection("settings").doc("config")
        .set({ [configKey]: url }, { merge: true });
      if (window.config) window.config[configKey] = url;
    }
    if (statusEl) { statusEl.textContent = '✅ Enregistré !'; statusEl.style.color = 'var(--green)'; }
    toast('✅ Image uploadée !');

  } catch(e) {
    if (statusEl) { statusEl.textContent = '❌ '+e.message; statusEl.style.color = 'var(--red)'; }
    toast('Erreur : '+e.message, 'err');
  } finally {
    if (progWrapEl) progWrapEl.style.display = 'none';
    if (barEl) barEl.style.width = '0%';
  }
};

// Sync URL manuelles
document.getElementById('p-signature-url')?.addEventListener('input',
  ()=>updateImgPreview('p-signature-url','sign-preview-wrap','sign-delete-btn'));
document.getElementById('p-cachet-url')?.addEventListener('input',
  ()=>updateImgPreview('p-cachet-url','cachet-preview-wrap','cachet-delete-btn'));

})();

// ══════════════════════════════════════════════════════
//  app.js  —  FacturaPro  v4
//
//  CORRECTIONS v4 (par rapport à v3) :
//  [A] Utilitaires déplacés dans utils.js (global)
//  [B] enablePersistence() activé → offline OK
//  [C] step="1" sur prix (entier F CFA), step="0.001" qté
//  [D] allVentes exposé globalement (window.allVentes)
//      → credits.js réutilise le cache, zéro re-lecture
//  [E] Listener hash URL → shortcuts PWA fonctionnels
//  [F] Guard allProduits chargé avant autocomplete
//  [G] Toutes dates converties via toDateObj() avant
//      .toLocaleDateString() → plus de crash Timestamp
//  [H] Sanitisation données client pour jsPDF
//  [I] Gestion offline via enablePersistence()
// ══════════════════════════════════════════════════════

"use strict";

// ─────────────────────────────────────────────────────
//  ÉTAT GLOBAL (exposé sur window pour inter-modules)
// ─────────────────────────────────────────────────────
window.currentUser  = null;
window.lignes       = [];
window.docType      = "facture";
window.entreprise   = {};
window.config       = {};
window.allVentes    = [];   // [FIX D] cache global partagé avec credits.js
let _saving         = false;

// Persistence activée dans firebase-config.js (avant utils.js)

// ─────────────────────────────────────────────────────
//  NAVIGATION — vues
// ─────────────────────────────────────────────────────

window.showView = function showView(id, btn) {
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
  };
  const el = document.getElementById("topbar-title");
  if (el) el.textContent = titles[id] ?? id;

  // Déclencher les chargements selon la vue
  if (id === "dashboard")        chargerDashboard();
  if (id === "historique")       chargerHistorique();
  if (id === "credits")          chargerCredits();
  if (id === "catalogue")        chargerCatalogue();
};

// ─────────────────────────────────────────────────────
//  [FIX E] ROUTING HASH — shortcuts PWA
//  /#nouvelle-vente, /#historique, etc.
// ─────────────────────────────────────────────────────

function handleHashRoute() {
  const hash = window.location.hash.replace("#", "").trim();
  const allowed = ["dashboard", "nouvelle-vente", "historique", "credits", "catalogue", "parametres"];
  if (!hash || !allowed.includes(hash)) return;
  const btn = document.querySelector(`.sb-item[data-view="${hash}"]`);
  showView(hash, btn);
}

window.addEventListener("hashchange", handleHashRoute);

// ─────────────────────────────────────────────────────
//  VALIDATION FORMULAIRE
// ─────────────────────────────────────────────────────

function validerFormulaire() {
  const lignesValides = window.lignes.filter(l =>
    l.des.trim() !== "" && l.prix > 0 && l.qte > 0
  );
  if (!lignesValides.length)
    return { ok: false, msg: "❌ Ajoute au moins un article avec une désignation et un prix." };

  const { total } = calcRecap();
  if (total <= 0 && window.docType !== "devis")
    return { ok: false, msg: "❌ Le total de la vente doit être supérieur à zéro." };

  const mRecu = parseFloat(document.getElementById("v-montant-recu")?.value) || 0;
  if (mRecu > 0 && mRecu < total * 0.01)
    return { ok: false, msg: "❌ Le montant reçu semble trop faible par rapport au total." };

  return { ok: true };
}

// ─────────────────────────────────────────────────────
//  AUTHENTIFICATION
// ─────────────────────────────────────────────────────

auth.onAuthStateChanged(user => {
  if (user) {
    window.currentUser = user;
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    const el = document.getElementById("topbar-user");
    if (el) el.textContent = user.email;
    chargerEntreprise();
    chargerConfig();
    chargerDashboard();
    // Initialiser le système POS cartes (défini dans index.html)
    if (typeof posInit === "function") posInit();
    updateBadgeCredits();
    // Route initiale depuis le hash
    handleHashRoute();
    // PWA Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(e => console.warn("SW:", e));
    }
  } else {
    window.currentUser = null;
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }
});

async function seConnecter() {
  const email = document.getElementById("l-email").value.trim();
  const pwd   = document.getElementById("l-pwd").value;
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  if (!email || !pwd) {
    errEl.textContent   = "Remplis tous les champs.";
    errEl.style.display = "block";
    return;
  }
  loader(true);
  try {
    await auth.signInWithEmailAndPassword(email, pwd);
  } catch (e) {
    const msgs = {
      "auth/invalid-email":      "Adresse email invalide.",
      "auth/user-not-found":     "Aucun compte avec cet email.",
      "auth/wrong-password":     "Mot de passe incorrect.",
      "auth/invalid-credential": "Email ou mot de passe incorrect.",
      "auth/too-many-requests":  "Trop de tentatives. Réessaie plus tard.",
    };
    errEl.textContent   = msgs[e.code] ?? e.message;
    errEl.style.display = "block";
  }
  loader(false);
}

window.seConnecter    = seConnecter;
window.seDeconnecter  = () => auth.signOut();

["l-email", "l-pwd"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") seConnecter();
  });
});

// ─────────────────────────────────────────────────────
//  PARAMÈTRES — CHARGEMENT
// ─────────────────────────────────────────────────────

async function chargerEntreprise() {
  try {
    const snap = await db.collection("settings").doc("entreprise").get();
    if (snap.exists) {
      window.entreprise = snap.data();
      remplirChampsEntreprise();
      updatePreviewEntreprise();
    }
  } catch (e) { console.error("chargerEntreprise:", e); }
}

async function chargerConfig() {
  try {
    const snap = await db.collection("settings").doc("config").get();
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
  updateLogoPreview();
  // Mettre à jour la prévisualisation latérale (définie dans index.html)
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

  const textMap = { "p-header":"headerText","p-footer-thanks":"footerThanks","p-footer-legal":"footerLegal" };
  for (const [elId, key] of Object.entries(textMap)) {
    const el = document.getElementById(elId);
    if (el && cfg[key]) el.value = cfg[key];
  }

  const tvaLbl = document.getElementById("tva-pct-label");
  if (tvaLbl) tvaLbl.textContent = `Taux : ${cfg.tvaRate ?? 18} %`;

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
  updateLogoPreview();
};

["p-nom","p-tel","p-email","p-adresse"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", updatePreviewEntreprise);
});

window.sauvegarderEntreprise = async function sauvegarderEntreprise() {
  const g = id => document.getElementById(id)?.value.trim() ?? "";
  const data = {
    nom:g("p-nom"),slogan:g("p-slogan"),tel:g("p-tel"),tel2:g("p-tel2"),
    email:g("p-email"),web:g("p-web"),adresse:g("p-adresse"),ville:g("p-ville"),
    pays:g("p-pays"),devise:g("p-devise")||"F CFA",rc:g("p-rc"),nif:g("p-nif"),logoUrl:g("p-logo-url"),
  };
  if (!data.nom) { toast("Le nom de l'entreprise est obligatoire.", "err"); return; }
  loader(true);
  try {
    await db.collection("settings").doc("entreprise").set(data);
    window.entreprise = data;
    updatePreviewEntreprise();
    toast("✅ Informations enregistrées !");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.sauvegarderConfig = async function sauvegarderConfig() {
  const chk = id => document.getElementById(id)?.checked ?? false;
  const val = id => document.getElementById(id)?.value.trim() ?? "";
  const data = {
    format:       val("p-format")    || "thermal",
    devisePos:    val("p-devise-pos")|| "after",
    devise:       val("p-devise")    || window.entreprise.devise || "F CFA",
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
  };
  loader(true);
  try {
    await db.collection("settings").doc("config").set(data);
    window.config = data;
    remplirChampsConfig();
    toast("✅ Configuration enregistrée !");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.changerMotDePasse = async function changerMotDePasse() {
  const p1 = document.getElementById("p-pwd-new")?.value;
  const p2 = document.getElementById("p-pwd-confirm")?.value;
  if (!p1)        { toast("Saisis un nouveau mot de passe.", "err"); return; }
  if (p1 !== p2)  { toast("Les mots de passe ne correspondent pas.", "err"); return; }
  if (p1.length < 6) { toast("Mot de passe trop court (min 6).", "err"); return; }
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
//  LIGNES ARTICLES
//  [FIX C] step="1" pour prix entier, step="0.001" pour qté
//  [FIX F] Guard allProduits avant autocomplete
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
//  LIGNES — Le nouveau système POS cartes (index.html)
//  gère window.lignes directement via _pcSyncLignes().
//  Ces fonctions sont conservées comme stubs de compatibilité.
// ─────────────────────────────────────────────────────

window.ajouterLigne = function ajouterLigne() {
  // No-op : les cartes POS dans index.html gèrent les lignes
  if (typeof posAddCard === "function") posAddCard();
};

window.calcLigne = function calcLigne(i) {
  // No-op : calcul géré par _pcCalc() dans index.html
};

window.supprimerLigne = function supprimerLigne(i) {
  // No-op : suppression gérée par posDelCard() dans index.html
};

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
    type:    window.docType,
    numero:  null, // attribué par persisterVente()
    date:    new Date(),
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
// ─────────────────────────────────────────────────────

window.actionImprimer = async function actionImprimer() {
  const v = validerFormulaire();
  if (!v.ok) { toast(v.msg, "err"); return; }
  if (_saving) { toast("Sauvegarde en cours…", "info"); return; }
  const saved = await persisterVente(buildVenteData());
  if (!saved) return;
  try {
    // [FIX G] date déjà un objet Date dans saved
    imprimerDocument(saved, window.entreprise, window.config);
    setTimeout(() => toast("🖨️ Dialogue d'impression ouvert"), 400);
  } catch (e) { toast("Erreur impression : " + e.message, "err"); }
};

window.actionGenererPDF = async function actionGenererPDF(fromModal, venteDataOverride) {
  if (venteDataOverride) {
    try {
      const nom = genererPDF(venteDataOverride, window.entreprise, window.config);
      toast(`📥 PDF prêt : ${nom}`);
    }
    catch (e) { toast("Erreur PDF : " + e.message, "err"); }
    return;
  }
  const v = validerFormulaire();
  if (!v.ok) { toast(v.msg, "err"); return; }
  if (_saving) { toast("Sauvegarde en cours…", "info"); return; }
  const saved = await persisterVente(buildVenteData());
  if (!saved) return;
  try {
    const nom = genererPDF(saved, window.entreprise, window.config);
    toast(`📥 PDF prêt : ${nom}`);
  }
  catch (e) { toast("Erreur PDF : " + e.message, "err"); }
};

window.sauvegarderSeulement = async function sauvegarderSeulement() {
  const v = validerFormulaire();
  if (!v.ok) { toast(v.msg, "err"); return; }
  if (_saving) { toast("Sauvegarde en cours…", "info"); return; }
  await persisterVente(buildVenteData());
};

window.resetForm = function resetForm() {
  ["v-client-nom","v-client-tel","v-client-email","v-client-adresse",
   "v-note","v-montant-recu","opt-remise"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const tvaEl = document.getElementById("opt-tva");
  if (tvaEl) tvaEl.checked = window.config.showTva ?? false;
  window.lignes = [];
  // Le système POS cartes (index.html inline) override cette fonction
  // et réinitialise ses propres cartes. Ici on reset juste le type et le récap.
  setDocType("facture", document.querySelector(".doc-type-btn"));
  calcRecap();
};

// ─────────────────────────────────────────────────────
//  PERSISTANCE — TRANSACTION FIRESTORE ATOMIQUE
// ─────────────────────────────────────────────────────

async function persisterVente(data) {
  if (!window.currentUser) { toast("Non connecté.", "err"); return null; }
  _saving = true;
  loader(true);
  let savedData = null;
  try {
    const counterRef = db.collection("settings").doc("counter");
    const ventesRef  = db.collection("ventes");

    await db.runTransaction(async transaction => {
      const counterSnap = await transaction.get(counterRef);
      const currentVal  = counterSnap.exists ? (counterSnap.data().val ?? 0) : 0;
      const newVal      = currentVal + 1;
      const numero      = genNumero(data.type, newVal);

      const toSave = {
        ...data,
        numero,
        date:      firebase.firestore.Timestamp.fromDate(data.date),
        uid:       window.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      const newRef = ventesRef.doc();
      transaction.set(newRef, toSave);
      transaction.set(counterRef, { val: newVal }, { merge: true });
      savedData = { ...data, numero, id: newRef.id };
    });

    toast("✅ Vente enregistrée !");
    // [FIX D] Mettre à jour le cache global
    window.allVentes = [{ ...savedData, date: firebase.firestore.Timestamp.fromDate(data.date) }, ...window.allVentes];
    chargerDashboard();
    updateBadgeCredits();
  } catch (e) {
    toast("Erreur sauvegarde : " + e.message, "err");
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
      .where("uid", "==", window.currentUser.uid)
      .get();

    const ventes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDateObj(b.createdAt ?? b.date) - toDateObj(a.createdAt ?? a.date));

    // [FIX D] Mettre à jour le cache global partagé
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
// ─────────────────────────────────────────────────────

window.chargerHistorique = async function chargerHistorique() {
  if (!window.currentUser) return;
  loader(true);
  try {
    const snap = await db.collection("ventes")
      .where("uid", "==", window.currentUser.uid)
      .get();

    window.allVentes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDateObj(b.createdAt ?? b.date) - toDateObj(a.createdAt ?? a.date));

    filtrerHistorique();
  } catch (e) { toast("Erreur chargement : " + e.message, "err"); }
  loader(false);
};

window.filtrerHistorique = function filtrerHistorique() {
  const q         = (document.getElementById("hist-search")?.value ?? "").toLowerCase().trim();
  const typeF     = document.getElementById("hist-type-filter")?.value ?? "";
  const dateDebut = document.getElementById("hist-date-debut")?.value ?? "";
  const dateFin   = document.getElementById("hist-date-fin")?.value   ?? "";

  let result = window.allVentes;

  if (q) result = result.filter(v =>
    (v.numero      ?? "").toLowerCase().includes(q) ||
    (v.client?.nom ?? "").toLowerCase().includes(q) ||
    (v.client?.tel ?? "").toLowerCase().includes(q)
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

window.rechercherHistorique = function rechercherHistorique() {
  filtrerHistorique();
};

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

  tbody.innerHTML = ventes.map(v => `
    <tr>
      <td class="mono">${escHtml(v.numero ?? "—")}</td>
      <td>${escHtml(v.client?.nom ?? "") || '<span style="color:var(--ink-muted)">—</span>'}</td>
      <td><span class="badge badge-${v.type ?? "facture"}">${typeLbl[v.type] ?? v.type}</span></td>
      <td style="font-size:12px;">${pmodes[v.paiement] ?? v.paiement ?? "—"}</td>
      <td class="mono" style="font-weight:600;">${fmt(v.total)}</td>
      <td style="color:var(--ink-muted);font-size:12px;">${fmtDate(v.date)}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-sm btn-icon" title="Voir" onclick="ouvrirDetail('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 4C6 4 2.5 7 1 10c1.5 3 5 6 9 6s7.5-3 9-6c-1.5-3-5-6-9-6z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" title="Imprimer" onclick="reimprimerVente('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </button>
          <button class="btn btn-primary btn-sm btn-icon" title="PDF" onclick="retelechargerPDF('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
          </button>
          <button class="btn btn-sm btn-icon" style="background:var(--red-bg);color:var(--red);" title="Supprimer" onclick="supprimerVente('${v.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M6 4v1H3v1h14V5h-3V4H6zM5 7v10h10V7H5zm3 2h1v6H8V9zm3 0h1v6h-1V9z" fill="currentColor"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join("");
}

window.supprimerVente = async function supprimerVente(id) {
  if (!confirm("Supprimer cette vente définitivement ?")) return;
  loader(true);
  try {
    await db.collection("ventes").doc(id).delete();
    window.allVentes = window.allVentes.filter(v => v.id !== id);
    filtrerHistorique();
    chargerDashboard();
    toast("Vente supprimée.");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.reimprimerVente = function reimprimerVente(id) {
  const v = window.allVentes.find(x => x.id === id);
  if (!v) { toast("Vente introuvable.", "err"); return; }
  try {
    // [FIX G] Conversion Timestamp → Date avant impression
    imprimerDocument({ ...v, date: toDateObj(v.date) }, window.entreprise, window.config);
    setTimeout(() => toast("🖨️ Dialogue d'impression ouvert"), 400);
  } catch (e) { toast("Erreur impression : " + e.message, "err"); }
};

window.retelechargerPDF = function retelechargerPDF(id) {
  const v = window.allVentes.find(x => x.id === id);
  if (!v) { toast("Vente introuvable.", "err"); return; }
  try {
    // [FIX G] Conversion Timestamp → Date avant PDF
    const nom = genererPDF({ ...v, date: toDateObj(v.date) }, window.entreprise, window.config);
    toast(`📥 PDF : ${nom}`);
  } catch (e) { toast("Erreur PDF : " + e.message, "err"); }
};

// ─────────────────────────────────────────────────────
//  BADGE CRÉDITS
//  [FIX D] Réutilise window.allVentes — pas de re-lecture
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
  const pmodes  = { especes:"Espèces", mobile_money:"Mobile Money", virement:"Virement", cheque:"Chèque", credit:"Crédit" };

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

  // [FIX G] Conversion Timestamp → Date avant impression/PDF
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
    "Numéro":   v.numero      ?? "",
    "Type":     v.type        ?? "",
    "Client":   v.client?.nom ?? "",
    "Téléphone":v.client?.tel ?? "",
    "Paiement": v.paiement    ?? "",
    "Total":    v.total       ?? 0,
    "Date":     fmtDate(v.date),
    "Note":     v.note        ?? "",
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
// ══════════════════════════════════════════════════════
//  catalogue.js  —  FacturaPro
//  Gestion du catalogue produits
//
//  CORRECTIONS v4 :
//  [A] allProduits exposé sur window (partagé avec app.js)
//  [B] Autocomplete re-branché après chargement catalogue
//  [C] orderBy retiré → requête simple (un seul .where)
//  [D] Pas de dépendance sur fmt/escHtml locaux (utils.js)
//  [E] stock transféré correctement vers la ligne de vente
// ══════════════════════════════════════════════════════

"use strict";

// [FIX A] Exposé sur window pour que app.js puisse y accéder
window.allProduits = [];
window.catalogueLoaded = false;

// ─────────────────────────────────────────────────────
//  CHARGEMENT
//  [FIX C] Suppression de orderBy("nom") → requête simple
//          Tri fait côté client pour éviter index composite
// ─────────────────────────────────────────────────────

window.chargerCatalogue = async function chargerCatalogue() {
  if (!window.currentUser) return;
  loader(true);
  try {
    const snap = await db.collection("produits")
      .where("uid", "==", window._shopUid())
      .get();

    window.allProduits = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? "", "fr"));
    window.catalogueLoaded = true;

    renderCatalogue(window.allProduits);
    renderAlertesStock();

    // Mettre à jour les produits rapides dans la vue vente (POS inline)
    if (typeof posRefreshQuick === "function") posRefreshQuick();
  } catch (e) {
    toast("Erreur chargement catalogue : " + e.message, "err");
  }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  [NOUVEAU — ALERTES STOCK] Panel dashboard + badge nav "Produits".
//  Rupture = stock ≤ 0. Stock bas = stock > 0 et ≤ seuil (voir
//  seuilAlerteProduit ci-dessus).
// ─────────────────────────────────────────────────────

window.allerVersProduits = function allerVersProduits() {
  showView("catalogue", document.querySelector('.sb-item[data-view="catalogue"]'));
};

function renderAlertesStock() {
  const panel = document.getElementById("panel-alertes-stock");
  const body  = document.getElementById("alertes-stock-body");
  const badge = document.getElementById("sb-catalogue-badge");
  if (!panel || !body) return;

  const alertes = (window.allProduits || [])
    .filter(p => p.stock !== null && p.stock !== undefined)
    .filter(p => window.estEnRupture(p) || window.estStockBas(p))
    .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));

  if (badge) {
    badge.style.display = alertes.length ? "inline-block" : "none";
    badge.textContent = alertes.length > 9 ? "9+" : String(alertes.length);
  }

  if (!alertes.length) { panel.style.display = "none"; body.innerHTML = ""; return; }
  panel.style.display = "";

  body.innerHTML = alertes.map(p => {
    const rupture = window.estEnRupture(p);
    const couleur = rupture ? "var(--red)" : "#b45309";
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 20px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:600;font-size:13.5px;">${escHtml(p.nom)}</div>
        <div style="font-size:12px;color:${couleur};">${rupture ? "Rupture de stock" : "Stock bas"} — ${p.stock} en stock${p.pcsParCarton > 1 ? ` (${fmtStockCartons(p.stock, p.pcsParCarton)})` : ""}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="allerVersProduits()">Voir</button>
    </div>`;
  }).join("");
}
window.renderAlertesStock = renderAlertesStock;

// ─────────────────────────────────────────────────────
//  RENDU LISTE
// ─────────────────────────────────────────────────────

function renderCatalogue(produits) {
  const grid = document.getElementById("catalogue-grid");
  if (!grid) return;

  if (!produits.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div style="font-size:32px;margin-bottom:10px;">📦</div>
        Aucun produit dans le catalogue.<br>
        <span style="font-size:12px;">Ajoute ton premier produit avec le bouton ci-dessus.</span>
      </div>`;
    return;
  }

  // [FIX STOCK-CAISSIER] Le caissier consulte le catalogue (donc le
  // stock) en lecture seule : ni les boutons Modifier/Supprimer, ni
  // les actions qui changent le stock autrement qu'en vendant ne
  // sont rendus dans sa carte produit.
  const lectureSeuleStock = (window.userRole === "caissier");

  grid.innerHTML = produits.map(p => `
    <div class="produit-card">
      <div class="produit-card-head">
        <div>
          <div class="produit-nom">${escHtml(p.nom)}</div>
          ${p.ref ? `<div class="produit-ref">Réf : ${escHtml(p.ref)}</div>` : ""}
        </div>
        ${lectureSeuleStock ? "" : `
        <div class="produit-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="Modifier" onclick="ouvrirModalProduit('${p.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn btn-sm btn-icon" style="background:var(--red-bg);color:var(--red);" title="Supprimer" onclick="supprimerProduit('${p.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M6 4v1H3v1h14V5h-3V4H6zM5 7v10h10V7H5zm3 2h1v6H8V9zm3 0h1v6h-1V9z" fill="currentColor"/>
            </svg>
          </button>
        </div>`}
      </div>
      <div class="produit-prix">${fmt(p.prix)}${p.pcsParCarton > 1 ? `<span style="font-size:11px;opacity:.6;font-weight:400;"> / pièce</span>` : ""}</div>
      ${p.pcsParCarton > 1 ? `<div style="font-size:12px;opacity:.8;margin-top:-4px;">📦 Carton de ${p.pcsParCarton} : <strong>${fmt(window.prixCarton(p))}</strong>${p.remiseCartonPct > 0 ? ` <span style="opacity:.7;">(-${p.remiseCartonPct}%)</span>` : ""}</div>` : ""}
      ${p.categorie ? `<div class="produit-cat">${escHtml(p.categorie)}</div>` : ""}
      ${p.description ? `<div class="produit-desc">${escHtml(p.description)}</div>` : ""}
      ${p.stock !== null && p.stock !== undefined
      ? (() => {
          const rupture = window.estEnRupture(p), bas = !rupture && window.estStockBas(p);
          const couleur = rupture ? "var(--red)" : bas ? "#b45309" : "inherit";
          const prefix  = rupture ? "🔴 " : bas ? "🟠 " : "📦 ";
          return `<div class="produit-stock" style="color:${couleur};">${prefix}Stock : <strong>${p.stock}</strong>${p.pcsParCarton > 1 ? ` <span style="opacity:.75;">(${fmtStockCartons(p.stock, p.pcsParCarton)})</span>` : ""}${rupture ? " — rupture" : bas ? " — stock bas" : ""}</div>`;
        })()
      : ""}
      ${p.pcsParCarton > 1 ? `
      <div style="display:flex;gap:6px;margin-top:10px;">
        <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center;" onclick="ajouterProduitALaVente('${p.id}','piece')">Au détail</button>
        <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center;" onclick="ajouterProduitALaVente('${p.id}','carton')">Par carton</button>
      </div>` : `
      <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center;margin-top:10px;"
        onclick="ajouterProduitALaVente('${p.id}')">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
          <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Ajouter à la vente
      </button>`}
    </div>`).join("");
}

// ─────────────────────────────────────────────────────
//  RECHERCHE
// ─────────────────────────────────────────────────────

window.rechercherCatalogue = function rechercherCatalogue(q) {
  const term = q.toLowerCase().trim();
  if (!term) { renderCatalogue(window.allProduits); return; }
  const res = window.allProduits.filter(p =>
    (p.nom ?? "").toLowerCase().includes(term) ||
    (p.ref ?? "").toLowerCase().includes(term) ||
    (p.categorie ?? "").toLowerCase().includes(term) ||
    (p.description ?? "").toLowerCase().includes(term)
  );
  renderCatalogue(res);
};

// ─────────────────────────────────────────────────────
//  MODAL AJOUT / MODIFICATION
// ─────────────────────────────────────────────────────

let _editingProduitId = null;

// ── Cartons : le stock est TOUJOURS compté en pièces ──
window.fmtStockCartons = function fmtStockCartons(stock, pcs) {
  if (!pcs || pcs <= 1 || stock === null || stock === undefined) return "";
  const cartons = Math.floor(stock / pcs), reste = stock - cartons * pcs;
  const s = n => (n > 1 ? "s" : "");
  return cartons + " carton" + s(cartons) + (reste ? " + " + reste + " pièce" + s(reste) : "");
};

// ─────────────────────────────────────────────────────
//  [NOUVEAU — VENTE PAR CARTON] Prix carton = prix pièce × nb de
//  pièces, avec une remise en % (remiseCartonPct) appliquée dessus.
//  Ex : pièce à 500, carton de 12, remise 10% → carton à 5 400.
// ─────────────────────────────────────────────────────

window.prixCarton = function prixCarton(p) {
  const pcs    = (p?.pcsParCarton > 1) ? p.pcsParCarton : 1;
  const remise = (p?.remiseCartonPct > 0) ? p.remiseCartonPct : 0;
  const brut   = (p?.prix ?? 0) * pcs;
  return Math.round(brut * (1 - remise / 100));
};

// ─────────────────────────────────────────────────────
//  [NOUVEAU — CARTON OUVERT] Pièces réellement disponibles à la
//  vente au détail : le "reste" naturel (stock non multiple d'un
//  carton complet) + les pièces d'un carton déjà ouvert (brouillon
//  actif, voir js/brouillons.js) mais pas encore validées en vente.
//  → Permet de savoir s'il faut proposer d'ouvrir un nouveau carton.
// ─────────────────────────────────────────────────────

window.piecesEnVracDisponibles = function piecesEnVracDisponibles(p) {
  const stock = p?.stock ?? 0;
  const pcs   = (p?.pcsParCarton > 1) ? p.pcsParCarton : 1;
  if (pcs <= 1) return stock;
  const naturel  = stock % pcs;
  const b        = (typeof window.brouillonActifPour === "function") ? window.brouillonActifPour(p.id) : null;
  const ouvert   = b ? Math.max(0, (b.pcsInitiales ?? 0) - (b.pcsVendues ?? 0)) : 0;
  return naturel + ouvert;
};

// ─────────────────────────────────────────────────────
//  [NOUVEAU — ALERTES STOCK] Seuil en dessous duquel un produit est
//  considéré "stock bas". Si le gérant n'a rien configuré
//  (seuilAlerte), on prend un défaut raisonnable : un carton entier
//  pour un produit vendu par carton, sinon 5 pièces.
// ─────────────────────────────────────────────────────

window.seuilAlerteProduit = function seuilAlerteProduit(p) {
  if (p?.seuilAlerte > 0) return p.seuilAlerte;
  return (p?.pcsParCarton > 1) ? p.pcsParCarton : 5;
};

window.estStockBas = function estStockBas(p) {
  const stock = p?.stock;
  if (stock === null || stock === undefined) return false;
  return stock > 0 && stock <= window.seuilAlerteProduit(p);
};
window.estEnRupture = function estEnRupture(p) {
  return p?.stock !== null && p?.stock !== undefined && p.stock <= 0;
};

// [NOUVEAU] Export CSV du catalogue (produits + stock), pour la
// comptabilité ou un inventaire externe.
window.exporterCatalogueCSV = function exporterCatalogueCSV() {
  const rows = (window.allProduits || []).map(p => ({
    "Nom": p.nom ?? "",
    "Référence": p.ref ?? "",
    "Catégorie": p.categorie ?? "",
    "Prix pièce": p.prix ?? 0,
    "Pièces par carton": p.pcsParCarton ?? "",
    "Remise carton (%)": p.remiseCartonPct ?? "",
    "Prix carton": p.pcsParCarton > 1 ? window.prixCarton(p) : "",
    "Stock (pièces)": (p.stock === null || p.stock === undefined) ? "" : p.stock,
    "Statut": window.estEnRupture(p) ? "Rupture" : (window.estStockBas(p) ? "Stock bas" : "OK"),
  }));
  exporterVersCSV(rows, "catalogue");
};

window.majDetailStockProduit = function majDetailStockProduit() {
  const el = document.getElementById("mp-stock-detail");
  const stock = parseFloat(document.getElementById("mp-stock")?.value);
  const pcs   = parseInt(document.getElementById("mp-pcs")?.value);
  if (el) el.textContent = (!isNaN(stock) && pcs > 1) ? "= " + fmtStockCartons(stock, pcs) : "";

  // [NOUVEAU] Aperçu en direct du prix carton (prix pièce × pcs,
  // remisé du % saisi) pendant que le gérant renseigne le produit.
  const previewEl = document.getElementById("mp-prix-carton-detail");
  if (previewEl) {
    const prix   = parseFloat(document.getElementById("mp-prix")?.value);
    const remise = parseFloat(document.getElementById("mp-remise-carton")?.value) || 0;
    if (!isNaN(prix) && pcs > 1) {
      const pc = Math.round(prix * pcs * (1 - remise / 100));
      previewEl.textContent = `= carton à ${pc.toLocaleString("fr-FR")} F CFA` + (remise > 0 ? ` (-${remise}%)` : "");
    } else {
      previewEl.textContent = "";
    }
  }
};

// [FIX STOCK-CAISSIER] Garde-fou : le caissier ne doit jamais pouvoir
// créer/modifier/supprimer un produit ni son stock, même en
// contournant l'UI (ex. appel direct depuis la console). Les règles
// de sécurité Firestore restent le vrai rempart côté serveur — ceci
// est une protection côté client en complément.
function _bloquerSiCaissier() {
  if (window.userRole === "caissier") {
    toast("⛔ Action réservée au gérant ou au propriétaire.", "err");
    return true;
  }
  return false;
}

window.ouvrirModalProduit = function ouvrirModalProduit(id) {
  if (_bloquerSiCaissier()) return;
  _editingProduitId = id ?? null;
  const p = id ? window.allProduits.find(x => x.id === id) : null;

  document.getElementById("modal-produit-title").textContent =
    p ? "Modifier le produit" : "Nouveau produit";

  document.getElementById("mp-nom").value = p?.nom ?? "";
  document.getElementById("mp-ref").value = p?.ref ?? "";
  document.getElementById("mp-prix").value = p?.prix ?? "";
  document.getElementById("mp-categorie").value = p?.categorie ?? "";
  document.getElementById("mp-description").value = p?.description ?? "";
  document.getElementById("mp-stock").value = (p?.stock !== undefined && p?.stock !== null) ? p.stock : "";
  document.getElementById("mp-pcs").value = p?.pcsParCarton ?? "";
  document.getElementById("mp-remise-carton").value = p?.remiseCartonPct ?? "";
  document.getElementById("mp-seuil-alerte").value = p?.seuilAlerte ?? "";
  majDetailStockProduit();

  document.getElementById("modal-produit").classList.add("active");
  setTimeout(() => document.getElementById("mp-nom").focus(), 100);
};

window.fermerModalProduit = function fermerModalProduit() {
  document.getElementById("modal-produit").classList.remove("active");
  _editingProduitId = null;
};

window.sauvegarderProduit = async function sauvegarderProduit() {
  if (_bloquerSiCaissier()) return;
  const nom = document.getElementById("mp-nom").value.trim();
  const prix = parseFloat(document.getElementById("mp-prix").value);
  if (!nom) { toast("Le nom du produit est obligatoire.", "err"); return; }
  if (isNaN(prix) || prix < 0) { toast("Le prix est invalide.", "err"); return; }

  const stockRaw = document.getElementById("mp-stock").value;
  const data = {
    nom,
    ref: document.getElementById("mp-ref").value.trim(),
    prix,
    categorie: document.getElementById("mp-categorie").value.trim(),
    description: document.getElementById("mp-description").value.trim(),
    // [FIX E] stock correctement conservé (null si vide)
    stock: stockRaw !== "" ? parseFloat(stockRaw) : null,
    pcsParCarton: (parseInt(document.getElementById("mp-pcs")?.value) > 1) ? parseInt(document.getElementById("mp-pcs").value) : null,
    // [NOUVEAU] Remise (%) appliquée au prix carton (prix pièce × pcs).
    remiseCartonPct: (parseFloat(document.getElementById("mp-remise-carton")?.value) > 0)
      ? parseFloat(document.getElementById("mp-remise-carton").value) : null,
    // [NOUVEAU] Seuil d'alerte stock personnalisé (sinon défaut auto,
    // voir seuilAlerteProduit()).
    seuilAlerte: (parseFloat(document.getElementById("mp-seuil-alerte")?.value) > 0)
      ? parseFloat(document.getElementById("mp-seuil-alerte").value) : null,
    uid: window._shopUid(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  loader(true);
  try {
    if (_editingProduitId) {
      // [FIX P2-6] Si le stock change à l'édition, on logue un
      // mouvement "ajustement" — dans la même transaction que la
      // mise à jour, pour comparer un stockAvant qui vient d'être
      // relu (pas une valeur en cache côté client, potentiellement
      // périmée).
      const produitRef = db.collection("produits").doc(_editingProduitId);
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(produitRef);
        const stockAvant = snap.exists ? snap.data().stock : null;

        transaction.update(produitRef, data);

        const stockApres = data.stock;
        if (stockAvant !== stockApres && stockAvant !== undefined) {
          const mvtRef = db.collection("mouvements_stock").doc();
          transaction.set(mvtRef, {
            produitId:  _editingProduitId,
            produitNom: nom,
            type:       "ajustement",
            quantite:   (stockApres ?? 0) - (stockAvant ?? 0),
            stockAvant: stockAvant ?? 0,
            stockApres: stockApres ?? 0,
            motif:      "Modification manuelle du produit",
            venteId:    null,
            userId:     window.currentUser.uid,
            shopId:     window._shopUid(),
            createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      toast("✅ Produit mis à jour !");
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const newRef = await db.collection("produits").add(data);
      // [FIX P2-6] Stock initial d'un nouveau produit = mouvement "entrée"
      if (data.stock !== null && data.stock > 0) {
        await db.collection("mouvements_stock").add({
          produitId:  newRef.id,
          produitNom: nom,
          type:       "entree",
          quantite:   data.stock,
          stockAvant: 0,
          stockApres: data.stock,
          motif:      "Création du produit — stock initial",
          venteId:    null,
          userId:     window.currentUser.uid,
          shopId:     window._shopUid(),
          createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      toast("✅ Produit ajouté au catalogue !");
    }
    fermerModalProduit();
    await chargerCatalogue();
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.supprimerProduit = async function supprimerProduit(id) {
  if (_bloquerSiCaissier()) return;
  if (!confirm("Supprimer ce produit du catalogue ?")) return;
  loader(true);
  try {
    await db.collection("produits").doc(id).delete();
    window.allProduits = window.allProduits.filter(p => p.id !== id);
    renderCatalogue(window.allProduits);
    toast("Produit supprimé.");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  AJOUTER UN PRODUIT CATALOGUE À LA VENTE
//  [FIX] Appelée depuis le bouton "Ajouter à la vente" de
//  chaque carte produit du catalogue. Rebranchée sur le
//  système de cartes POS actuel (posQuickAdd) — l'ancienne
//  version manipulait directement window.lignes et appelait
//  renderLignes(), une fonction qui n'existe plus depuis le
//  passage à l'UI en cartes (#pos-cards). Résultat : le clic
//  ne faisait strictement rien (erreur silencieuse en console).
// ─────────────────────────────────────────────────────

window.ajouterProduitALaVente = function ajouterProduitALaVente(id, unite) {
  unite = unite === "carton" ? "carton" : "piece";
  const p = window.allProduits.find(x => x.id === id);
  if (!p) return;

  if ((p.stock ?? 0) <= 0) {
    toast(`⚠️ "${p.nom}" est en rupture de stock.`, "err");
    return;
  }

  const pcs = (p.pcsParCarton > 1) ? p.pcsParCarton : 1;

  // ── Vente par carton entier : prix carton, décrément en pièces ──
  if (unite === "carton") {
    if ((p.stock ?? 0) < pcs) {
      toast(`⚠️ Pas de carton complet disponible pour "${p.nom}".`, "err");
      return;
    }
    const btnVente = document.querySelector('.sb-item[data-view="nouvelle-vente"]');
    showView("nouvelle-vente", btnVente);
    if (typeof posQuickAdd === "function") {
      posQuickAdd({
        id: p.id, nom: p.nom, prix: p.prix, stock: p.stock ?? 0,
        unite: "carton", pcsParCarton: pcs, remiseCartonPct: p.remiseCartonPct ?? 0,
      });
      toast(`✅ Carton de "${p.nom}" ajouté à la vente`);
    }
    return;
  }

  // ── Vente au détail (pièce) ──
  // [FIX CARTON-OUVERT] S'il ne reste plus de pièces en vrac (tout
  // est encore emballé en cartons fermés), on propose d'ouvrir un
  // carton plutôt que de bloquer la vente. L'ouverture crée un
  // brouillon (js/brouillons.js) — la vente au détail se fait ensuite
  // depuis la page "Cartons ouverts", pas directement ici.
  const enVrac = window.piecesEnVracDisponibles(p);
  if (enVrac <= 0 && pcs > 1 && (p.stock ?? 0) >= pcs) {
    if (confirm(`Il ne reste que des cartons fermés pour "${p.nom}".\nOuvrir un carton de ${pcs} pièces pour le vendre au détail ?`)) {
      if (typeof window.ouvrirCartonPourProduit === "function") window.ouvrirCartonPourProduit(p.id);
    }
    return;
  }
  if (enVrac <= 0) {
    toast(`⚠️ "${p.nom}" est en rupture de stock au détail.`, "err");
    return;
  }

  const btnVente = document.querySelector('.sb-item[data-view="nouvelle-vente"]');
  showView("nouvelle-vente", btnVente);

  if (typeof posQuickAdd === "function") {
    posQuickAdd({ id: p.id, nom: p.nom, prix: p.prix, stock: enVrac, unite: "piece", pcsParCarton: pcs });
    toast(`✅ "${p.nom}" ajouté à la vente`);
  } else {
    toast("Erreur : impossible d'ajouter le produit à la vente.", "err");
  }
};
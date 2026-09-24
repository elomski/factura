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

    // Mettre à jour les produits rapides dans la vue vente (POS inline)
    if (typeof posRefreshQuick === "function") posRefreshQuick();
  } catch (e) {
    toast("Erreur chargement catalogue : " + e.message, "err");
  }
  loader(false);
};

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

  grid.innerHTML = produits.map(p => `
    <div class="produit-card">
      <div class="produit-card-head">
        <div>
          <div class="produit-nom">${escHtml(p.nom)}</div>
          ${p.ref ? `<div class="produit-ref">Réf : ${escHtml(p.ref)}</div>` : ""}
        </div>
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
        </div>
      </div>
      <div class="produit-prix">${fmt(p.prix)}</div>
      ${p.categorie ? `<div class="produit-cat">${escHtml(p.categorie)}</div>` : ""}
      ${p.description ? `<div class="produit-desc">${escHtml(p.description)}</div>` : ""}
      ${p.stock !== null && p.stock !== undefined
      ? `<div class="produit-stock">📦 Stock : <strong>${p.stock}</strong>${p.pcsParCarton > 1 ? ` <span style="opacity:.75;">(${fmtStockCartons(p.stock, p.pcsParCarton)})</span>` : ""}</div>`
      : ""}
      <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center;margin-top:10px;"
        onclick="ajouterProduitALaVente('${p.id}')">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
          <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Ajouter à la vente
      </button>
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

window.majDetailStockProduit = function majDetailStockProduit() {
  const el = document.getElementById("mp-stock-detail");
  if (!el) return;
  const stock = parseFloat(document.getElementById("mp-stock")?.value);
  const pcs   = parseInt(document.getElementById("mp-pcs")?.value);
  el.textContent = (!isNaN(stock) && pcs > 1) ? "= " + fmtStockCartons(stock, pcs) : "";
};

window.ouvrirModalProduit = function ouvrirModalProduit(id) {
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
  majDetailStockProduit();

  document.getElementById("modal-produit").classList.add("active");
  setTimeout(() => document.getElementById("mp-nom").focus(), 100);
};

window.fermerModalProduit = function fermerModalProduit() {
  document.getElementById("modal-produit").classList.remove("active");
  _editingProduitId = null;
};

window.sauvegarderProduit = async function sauvegarderProduit() {
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

window.ajouterProduitALaVente = function ajouterProduitALaVente(id) {
  const p = window.allProduits.find(x => x.id === id);
  if (!p) return;

  if ((p.stock ?? 0) <= 0) {
    toast(`⚠️ "${p.nom}" est en rupture de stock.`, "err");
    return;
  }

  const btnVente = document.querySelector('.sb-item[data-view="nouvelle-vente"]');
  showView("nouvelle-vente", btnVente);

  if (typeof posQuickAdd === "function") {
    posQuickAdd({ id: p.id, nom: p.nom, prix: p.prix, stock: p.stock ?? 0 });
    toast(`✅ "${p.nom}" ajouté à la vente`);
  } else {
    toast("Erreur : impossible d'ajouter le produit à la vente.", "err");
  }
};
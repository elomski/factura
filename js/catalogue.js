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
window.allProduits     = [];
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
      .where("uid", "==", window.currentUser.uid)
      .get();

    window.allProduits     = snap.docs
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
        ? `<div class="produit-stock">📦 Stock : <strong>${p.stock}</strong></div>`
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
    (p.nom         ?? "").toLowerCase().includes(term) ||
    (p.ref         ?? "").toLowerCase().includes(term) ||
    (p.categorie   ?? "").toLowerCase().includes(term) ||
    (p.description ?? "").toLowerCase().includes(term)
  );
  renderCatalogue(res);
};

// ─────────────────────────────────────────────────────
//  MODAL AJOUT / MODIFICATION
// ─────────────────────────────────────────────────────

let _editingProduitId = null;

window.ouvrirModalProduit = function ouvrirModalProduit(id) {
  _editingProduitId = id ?? null;
  const p = id ? window.allProduits.find(x => x.id === id) : null;

  document.getElementById("modal-produit-title").textContent =
    p ? "Modifier le produit" : "Nouveau produit";

  document.getElementById("mp-nom").value         = p?.nom         ?? "";
  document.getElementById("mp-ref").value         = p?.ref         ?? "";
  document.getElementById("mp-prix").value        = p?.prix        ?? "";
  document.getElementById("mp-categorie").value   = p?.categorie   ?? "";
  document.getElementById("mp-description").value = p?.description ?? "";
  document.getElementById("mp-stock").value       = (p?.stock !== undefined && p?.stock !== null) ? p.stock : "";

  document.getElementById("modal-produit").classList.add("active");
  setTimeout(() => document.getElementById("mp-nom").focus(), 100);
};

window.fermerModalProduit = function fermerModalProduit() {
  document.getElementById("modal-produit").classList.remove("active");
  _editingProduitId = null;
};

window.sauvegarderProduit = async function sauvegarderProduit() {
  const nom  = document.getElementById("mp-nom").value.trim();
  const prix = parseFloat(document.getElementById("mp-prix").value);
  if (!nom)                    { toast("Le nom du produit est obligatoire.", "err"); return; }
  if (isNaN(prix) || prix < 0) { toast("Le prix est invalide.", "err"); return; }

  const stockRaw = document.getElementById("mp-stock").value;
  const data = {
    nom,
    ref:         document.getElementById("mp-ref").value.trim(),
    prix,
    categorie:   document.getElementById("mp-categorie").value.trim(),
    description: document.getElementById("mp-description").value.trim(),
    // [FIX E] stock correctement conservé (null si vide)
    stock:       stockRaw !== "" ? parseFloat(stockRaw) : null,
    uid:         window.currentUser.uid,
    updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
  };

  loader(true);
  try {
    if (_editingProduitId) {
      await db.collection("produits").doc(_editingProduitId).update(data);
      toast("✅ Produit mis à jour !");
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("produits").add(data);
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
//  [FIX E] Transfert de stock dans la ligne (indicatif)
// ─────────────────────────────────────────────────────

window.ajouterProduitALaVente = function ajouterProduitALaVente(id) {
  const p = window.allProduits.find(x => x.id === id);
  if (!p) return;

  const btnVente = document.querySelector('.sb-item[data-view="nouvelle-vente"]');
  showView("nouvelle-vente", btnVente);

  const ligneVide = window.lignes.findIndex(l => l.des === "" && l.prix === 0);
  if (ligneVide >= 0) {
    window.lignes[ligneVide].des    = p.nom;
    window.lignes[ligneVide].prix   = p.prix;
    window.lignes[ligneVide].qte    = 1;
    window.lignes[ligneVide].remise = 0;
    // [FIX E] stocker la ref produit pour info stock
    window.lignes[ligneVide].produitId = p.id;
  } else {
    window.lignes.push({
      id:        Date.now(),
      des:       p.nom,
      prix:      p.prix,
      qte:       1,
      remise:    0,
      produitId: p.id,
    });
  }
  renderLignes();
  toast(`✅ "${p.nom}" ajouté à la vente`);
};

// ─────────────────────────────────────────────────────
//  AUTOCOMPLÉTION DANS LES LIGNES ARTICLES
//  [FIX] Sélecteur relatif au TR parent (pas body)
//        pour que le dropdown s'affiche correctement
// ─────────────────────────────────────────────────────

window.setupAutocompleteLigne = function setupAutocompleteLigne(input, ligneIndex) {
  // Guard : catalogue non chargé
  if (!window.allProduits?.length) return;

  let dropEl = null;

  function fermerDropdown() {
    if (dropEl) { dropEl.remove(); dropEl = null; }
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    fermerDropdown();
    if (q.length < 1) return;

    const matches = window.allProduits.filter(p =>
      (p.nom ?? "").toLowerCase().includes(q) ||
      (p.ref ?? "").toLowerCase().includes(q)
    ).slice(0, 6);

    if (!matches.length) return;

    // Positionner relativement à la cellule td.td-des
    const cell = input.closest("td");
    if (!cell) return;
    cell.style.position = "relative";

    dropEl = document.createElement("div");
    dropEl.className  = "autocomplete-drop";
    dropEl.style.cssText = [
      "position:absolute",
      "z-index:500",
      "background:var(--surface)",
      "border:1.5px solid var(--copper)",
      "border-radius:8px",
      "box-shadow:0 8px 24px rgba(28,23,18,.12)",
      "min-width:260px",
      "max-height:220px",
      "overflow-y:auto",
      "top:100%",
      "left:0",
    ].join(";");

    matches.forEach(p => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      item.style.cssText =
        "padding:9px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);";
      item.innerHTML = `
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--ink);">${escHtml(p.nom)}</div>
          ${p.ref ? `<div style="font-size:10px;color:var(--ink-muted);">Réf : ${escHtml(p.ref)}</div>` : ""}
          ${(p.stock !== null && p.stock !== undefined)
            ? `<div style="font-size:10px;color:var(--ink-muted);">Stock : ${p.stock}</div>`
            : ""}
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--copper);font-family:'DM Mono',monospace;">${fmt(p.prix)}</div>`;

      item.addEventListener("mousedown", e => {
        e.preventDefault();
        // Sécurité : vérifier que l'index est toujours valide
        if (ligneIndex < window.lignes.length) {
          window.lignes[ligneIndex].des       = p.nom;
          window.lignes[ligneIndex].prix      = p.prix;
          window.lignes[ligneIndex].produitId = p.id;
          renderLignes();
        }
        fermerDropdown();
      });
      item.addEventListener("mouseover", () => { item.style.background = "var(--bg)"; });
      item.addEventListener("mouseout",  () => { item.style.background = ""; });
      dropEl.appendChild(item);
    });

    cell.appendChild(dropEl);
  });

  input.addEventListener("blur", () => setTimeout(fermerDropdown, 150));
};
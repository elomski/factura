// ══════════════════════════════════════════════════════
//  catalogue.js  —  FacturaPro  v2
//
//  [FIX] Zéro index composite Firestore :
//        Requête unique sur uid → tri alphabétique côté client
//  [FIX] Autocomplétion dans les lignes articles
//  [FIX] Ajout rapide depuis la fiche produit → vue vente
// ══════════════════════════════════════════════════════

"use strict";

let allProduits     = [];
let catalogueLoaded = false;

// ─────────────────────────────────────────────────────
//  CHARGEMENT
//  ✅ UN SEUL .where() → pas d'index composite requis
//     Le tri alphabétique se fait côté client
// ─────────────────────────────────────────────────────

async function chargerCatalogue() {
  if (!currentUser) return;
  loader(true);
  try {
    const snap = await db.collection("produits")
      .where("uid", "==", currentUser.uid)
      .get();

    // Tri alphabétique côté client
    allProduits = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));

    catalogueLoaded = true;
    renderCatalogue(allProduits);
  } catch (e) {
    toast("Erreur chargement catalogue : " + e.message, "err");
    console.error("chargerCatalogue:", e);
  }
  loader(false);
}

// ─────────────────────────────────────────────────────
//  RENDU GRILLE
// ─────────────────────────────────────────────────────

function renderCatalogue(produits) {
  const grid = document.getElementById("catalogue-grid");
  if (!grid) return;

  if (!produits.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;padding:48px 20px;">
        <div style="font-size:40px;margin-bottom:12px;">📦</div>
        <div style="font-weight:600;color:var(--ink-mid);margin-bottom:6px;">Catalogue vide</div>
        <div style="font-size:12px;color:var(--ink-muted);">
          Clique sur <strong>Nouveau produit</strong> pour ajouter ton premier article.
        </div>
      </div>`;
    return;
  }

  grid.innerHTML = produits.map(p => `
    <div class="produit-card">
      <div class="produit-card-head">
        <div style="flex:1;min-width:0;">
          <div class="produit-nom">${escHtml(p.nom)}</div>
          ${p.ref ? `<div class="produit-ref">Réf : ${escHtml(p.ref)}</div>` : ""}
          ${p.categorie ? `<div class="produit-cat">${escHtml(p.categorie)}</div>` : ""}
        </div>
        <div class="produit-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="Modifier"
            onclick="ouvrirModalProduit('${p.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn btn-sm btn-icon" style="background:var(--red-bg);color:var(--red);"
            title="Supprimer" onclick="supprimerProduit('${p.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M6 4v1H3v1h14V5h-3V4H6zM5 7v10h10V7H5zm3 2h1v6H8V9zm3 0h1v6h-1V9z"
                fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="produit-prix">${fmt(p.prix)}</div>

      ${p.stock !== null && p.stock !== undefined
        ? `<div style="font-size:11px;color:${p.stock > 0 ? "var(--green)" : "var(--red)"};margin-top:2px;">
             ${p.stock > 0 ? `📦 Stock : ${p.stock}` : "⚠️ Rupture de stock"}
           </div>`
        : ""}

      ${p.description
        ? `<div class="produit-desc">${escHtml(p.description)}</div>`
        : ""}

      <button class="btn btn-primary btn-sm"
        style="width:100%;justify-content:center;margin-top:10px;"
        onclick="ajouterProduitALaVente('${p.id}')">
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
          <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Ajouter à la vente
      </button>
    </div>`).join("");
}

// ─────────────────────────────────────────────────────
//  RECHERCHE — filtre côté client
// ─────────────────────────────────────────────────────

function rechercherCatalogue(q) {
  const term = q.toLowerCase().trim();
  if (!term) { renderCatalogue(allProduits); return; }
  const res = allProduits.filter(p =>
    (p.nom         || "").toLowerCase().includes(term) ||
    (p.ref         || "").toLowerCase().includes(term) ||
    (p.categorie   || "").toLowerCase().includes(term) ||
    (p.description || "").toLowerCase().includes(term)
  );
  renderCatalogue(res);
}

// ─────────────────────────────────────────────────────
//  MODAL AJOUT / MODIFICATION
// ─────────────────────────────────────────────────────

let _editingProduitId = null;

function ouvrirModalProduit(id) {
  _editingProduitId = id || null;
  const p = id ? allProduits.find(x => x.id === id) : null;

  const titleEl = document.getElementById("modal-produit-title");
  if (titleEl) titleEl.textContent = p ? "Modifier le produit" : "Nouveau produit";

  const fields = {
    "mp-nom": p?.nom || "", "mp-ref": p?.ref || "",
    "mp-prix": p?.prix || "", "mp-categorie": p?.categorie || "",
    "mp-description": p?.description || "",
    "mp-stock": p?.stock !== undefined && p?.stock !== null ? p.stock : "",
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  document.getElementById("modal-produit").classList.add("active");
  setTimeout(() => document.getElementById("mp-nom")?.focus(), 120);
}

function fermerModalProduit() {
  document.getElementById("modal-produit").classList.remove("active");
  _editingProduitId = null;
}

// Enter dans le modal produit → sauvegarder
document.getElementById("modal-produit")?.addEventListener("keydown", e => {
  if (e.key === "Escape") fermerModalProduit();
});

async function sauvegarderProduit() {
  const nom  = document.getElementById("mp-nom")?.value.trim();
  const prix = parseFloat(document.getElementById("mp-prix")?.value);

  if (!nom)             { toast("Le nom du produit est obligatoire.", "err"); return; }
  if (isNaN(prix) || prix < 0) { toast("Le prix est invalide.", "err"); return; }

  const stockVal = document.getElementById("mp-stock")?.value;
  const data = {
    nom,
    ref:         document.getElementById("mp-ref")?.value.trim()         || "",
    prix,
    categorie:   document.getElementById("mp-categorie")?.value.trim()   || "",
    description: document.getElementById("mp-description")?.value.trim() || "",
    stock:       stockVal !== "" ? parseFloat(stockVal) : null,
    uid:         currentUser.uid,
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
    chargerCatalogue();
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
}

async function supprimerProduit(id) {
  if (!confirm("Supprimer ce produit du catalogue ?")) return;
  loader(true);
  try {
    await db.collection("produits").doc(id).delete();
    allProduits = allProduits.filter(p => p.id !== id);
    renderCatalogue(allProduits);
    toast("Produit supprimé.");
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
}

// ─────────────────────────────────────────────────────
//  AJOUTER UN PRODUIT CATALOGUE À LA VENTE
// ─────────────────────────────────────────────────────

function ajouterProduitALaVente(id) {
  const p = allProduits.find(x => x.id === id);
  if (!p) return;

  // Naviguer vers la vue Nouvelle Vente
  const btnVente = document.querySelector('.sb-item[onclick*="nouvelle-vente"]');
  showView("nouvelle-vente", btnVente);

  // Chercher une ligne vide existante
  const ligneVide = lignes.findIndex(l => l.des.trim() === "" && l.prix === 0);
  if (ligneVide >= 0) {
    lignes[ligneVide].des    = p.nom;
    lignes[ligneVide].prix   = p.prix;
    lignes[ligneVide].qte    = 1;
    lignes[ligneVide].remise = 0;
  } else {
    lignes.push({ id: Date.now(), des: p.nom, prix: p.prix, qte: 1, remise: 0 });
  }
  renderLignes();
  calcRecap();
  toast(`✅ "${p.nom}" ajouté à la vente`);
}

// ─────────────────────────────────────────────────────
//  AUTOCOMPLÉTION DANS LES LIGNES ARTICLES
// ─────────────────────────────────────────────────────

function setupAutocompleteLigne(input, ligneIndex) {
  let dropEl = null;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    fermerDrop();
    if (q.length < 1 || !allProduits.length) return;

    const matches = allProduits
      .filter(p => p.nom.toLowerCase().includes(q) || (p.ref || "").toLowerCase().includes(q))
      .slice(0, 7);
    if (!matches.length) return;

    // Calcul position relative au conteneur lignes-body
    const tbody = document.getElementById("lignes-body");
    if (!tbody) return;

    dropEl = document.createElement("div");
    dropEl.className = "autocomplete-drop";

    const rect  = input.getBoundingClientRect();
    const tRect = tbody.getBoundingClientRect();

    Object.assign(dropEl.style, {
      position: "fixed",
      top:      `${rect.bottom + 4}px`,
      left:     `${rect.left}px`,
      width:    `${Math.max(rect.width, 280)}px`,
      zIndex:   "600",
      background: "var(--surface)",
      border:   "1.5px solid var(--copper)",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(28,23,18,.12)",
      maxHeight: "220px",
      overflowY: "auto",
    });

    matches.forEach(p => {
      const item = document.createElement("div");
      Object.assign(item.style, {
        padding: "9px 12px", cursor: "pointer",
        display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: "1px solid var(--border)",
        fontSize: "13px",
      });
      item.innerHTML = `
        <div>
          <div style="font-weight:600;color:var(--ink);">${escHtml(p.nom)}</div>
          ${p.ref ? `<div style="font-size:10px;color:var(--ink-muted);">Réf : ${escHtml(p.ref)}</div>` : ""}
        </div>
        <div style="font-weight:700;color:var(--copper);font-family:'DM Mono',monospace;white-space:nowrap;margin-left:10px;">
          ${fmt(p.prix)}
        </div>`;

      item.addEventListener("mouseover",  () => item.style.background = "var(--bg)");
      item.addEventListener("mouseout",   () => item.style.background = "");
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        lignes[ligneIndex].des  = p.nom;
        lignes[ligneIndex].prix = p.prix;
        renderLignes();
        fermerDrop();
      });
      dropEl.appendChild(item);
    });

    document.body.appendChild(dropEl);
  });

  input.addEventListener("blur",   () => setTimeout(fermerDrop, 160));
  input.addEventListener("keydown", e => { if (e.key === "Escape") fermerDrop(); });

  function fermerDrop() {
    if (dropEl) { dropEl.remove(); dropEl = null; }
  }
}
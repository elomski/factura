// ══════════════════════════════════════════════════════
//  brouillons.js  —  FacturaPro
//  "Cartons ouverts" — vente au détail d'un carton
//
//  PRINCIPE :
//  Un produit vendu par carton peut n'avoir en stock que des
//  cartons fermés (aucune pièce en vrac). Pour vendre au détail
//  dans ce cas, la caissière "ouvre" un carton (voir
//  ajouterProduitALaVente dans catalogue.js, qui propose
//  automatiquement l'ouverture). Cela crée un BROUILLON :
//  une mini-liste provisoire des pièces vendues une à une depuis
//  ce carton, que la caissière valide à la fin pour la transformer
//  en une vraie vente (décrément du stock réel + numéro de reçu).
//
//  Le stock du produit (toujours compté en pièces, voir
//  catalogue.js) N'EST PAS touché tant que le brouillon n'est pas
//  validé — ouvrir un carton ne fait que le "déballer" mentalement,
//  ça ne fait sortir aucune pièce du magasin.
//
//  Une seule brouillon "ouvert" à la fois par produit.
// ══════════════════════════════════════════════════════

"use strict";

window.allBrouillons = [];
let _brouillonAValider = null;

// ─────────────────────────────────────────────────────
//  CHARGEMENT
// ─────────────────────────────────────────────────────

window.chargerBrouillons = async function chargerBrouillons() {
  if (!window.currentUser) return;
  loader(true);
  try {
    const snap = await db.collection("brouillons_carton")
      .where("shopId", "==", window._shopUid())
      .where("statut", "==", "ouvert")
      .get();

    window.allBrouillons = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDateObj(b.createdAt) - toDateObj(a.createdAt));

    renderBrouillons();
    updateBadgeBrouillons();
  } catch (e) {
    toast("Erreur chargement des cartons ouverts : " + e.message, "err");
    console.error("chargerBrouillons:", e);
  }
  loader(false);
};

// [NOUVEAU] Consulté par catalogue.js (piecesEnVracDisponibles) pour
// savoir si un carton est déjà ouvert pour un produit donné.
window.brouillonActifPour = function brouillonActifPour(produitId) {
  return (window.allBrouillons || []).find(b => b.produitId === produitId && b.statut === "ouvert") || null;
};

function updateBadgeBrouillons() {
  const nb = (window.allBrouillons || []).length;
  const badge = document.getElementById("sb-brouillons-badge");
  if (badge) {
    badge.style.display = nb > 0 ? "inline-block" : "none";
    badge.textContent = nb > 9 ? "9+" : String(nb);
  }
}

// ─────────────────────────────────────────────────────
//  OUVRIR UN CARTON
//  Appelée automatiquement depuis catalogue.js quand il ne reste
//  plus de pièces en vrac, ou manuellement depuis la page Brouillons.
// ─────────────────────────────────────────────────────

window.ouvrirCartonPourProduit = async function ouvrirCartonPourProduit(produitId) {
  if (!window.currentUser) return;
  const p = (window.allProduits || []).find(x => x.id === produitId);
  if (!p) { toast("Produit introuvable.", "err"); return; }

  const pcs = (p.pcsParCarton > 1) ? p.pcsParCarton : null;
  if (!pcs) { toast("Ce produit ne se vend pas par carton.", "err"); return; }
  if ((p.stock ?? 0) < pcs) { toast(`Pas de carton complet disponible pour "${p.nom}".`, "err"); return; }

  if (window.brouillonActifPour(produitId)) {
    toast("Un carton est déjà ouvert pour ce produit — valide-le avant d'en ouvrir un autre.", "err");
    showView("brouillons", document.querySelector('.sb-item[data-view="brouillons"]'));
    return;
  }

  loader(true);
  try {
    const data = {
      shopId: window._shopUid(),
      produitId: p.id,
      produitNom: p.nom,
      pcsParCarton: pcs,
      prixPiece: p.prix,
      remiseCartonPct: p.remiseCartonPct ?? null,
      pcsInitiales: pcs,
      pcsVendues: 0,
      lignes: [],
      statut: "ouvert",
      ouvertPar: window.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection("brouillons_carton").add(data);

    window.allBrouillons = [{ id: docRef.id, ...data, createdAt: new Date() }, ...window.allBrouillons];
    renderBrouillons();
    updateBadgeBrouillons();
    toast(`📦 Carton de "${p.nom}" ouvert — ${pcs} pièce(s) disponibles au détail.`);
    showView("brouillons", document.querySelector('.sb-item[data-view="brouillons"]'));
  } catch (e) {
    toast("Erreur ouverture carton : " + e.message, "err");
  }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  AJOUTER / RETIRER UNE LIGNE (vente au détail depuis le carton)
// ─────────────────────────────────────────────────────

window.ajouterLigneBrouillon = async function ajouterLigneBrouillon(brouillonId) {
  const b = (window.allBrouillons || []).find(x => x.id === brouillonId);
  if (!b) return;

  const qteEl  = document.getElementById(`bl-qte-${brouillonId}`);
  const prixEl = document.getElementById(`bl-prix-${brouillonId}`);
  const qte    = parseFloat(qteEl?.value);
  const prix   = parseFloat(prixEl?.value);
  const restantes = b.pcsInitiales - b.pcsVendues;

  if (isNaN(qte) || qte <= 0) { toast("Quantité invalide.", "err"); return; }
  if (qte > restantes) { toast(`Il ne reste que ${restantes} pièce(s) dans ce carton.`, "err"); return; }
  if (isNaN(prix) || prix < 0) { toast("Prix invalide.", "err"); return; }

  const ligne = { id: Date.now(), qte, prix };

  loader(true);
  try {
    await db.collection("brouillons_carton").doc(brouillonId).update({
      lignes: firebase.firestore.FieldValue.arrayUnion(ligne),
      pcsVendues: b.pcsVendues + qte,
    });
    b.lignes = [...(b.lignes || []), ligne];
    b.pcsVendues += qte;
    if (qteEl) qteEl.value = "";
    renderBrouillons();
    if (b.pcsInitiales - b.pcsVendues <= 0) {
      toast("✅ Carton entièrement vendu — pense à valider le brouillon !");
    }
  } catch (e) {
    toast("Erreur : " + e.message, "err");
  }
  loader(false);
};

window.supprimerLigneBrouillon = async function supprimerLigneBrouillon(brouillonId, ligneId) {
  const b = (window.allBrouillons || []).find(x => x.id === brouillonId);
  if (!b) return;
  const ligne = (b.lignes || []).find(l => l.id === ligneId);
  if (!ligne) return;
  if (!confirm("Retirer cette ligne du brouillon ?")) return;

  loader(true);
  try {
    await db.collection("brouillons_carton").doc(brouillonId).update({
      lignes: firebase.firestore.FieldValue.arrayRemove(ligne),
      pcsVendues: b.pcsVendues - ligne.qte,
    });
    b.lignes = b.lignes.filter(l => l.id !== ligneId);
    b.pcsVendues -= ligne.qte;
    renderBrouillons();
  } catch (e) {
    toast("Erreur : " + e.message, "err");
  }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  ANNULER UN BROUILLON (aucun impact stock — rien n'a encore
//  été décrémenté)
// ─────────────────────────────────────────────────────

window.annulerBrouillon = async function annulerBrouillon(brouillonId) {
  const b = (window.allBrouillons || []).find(x => x.id === brouillonId);
  if (!b) return;
  const msg = (b.lignes || []).length
    ? "Ce carton contient des ventes non validées. Tout annuler et fermer le carton ?"
    : "Annuler ce carton ouvert ?";
  if (!confirm(msg)) return;

  loader(true);
  try {
    await db.collection("brouillons_carton").doc(brouillonId).delete();
    window.allBrouillons = window.allBrouillons.filter(x => x.id !== brouillonId);
    renderBrouillons();
    updateBadgeBrouillons();
    toast("Carton fermé sans vente.");
  } catch (e) {
    toast("Erreur : " + e.message, "err");
  }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  VALIDER — transforme le brouillon en vraie vente
//  (transaction atomique : vente + décrément stock + mouvement,
//  même schéma que persisterVente() dans app.js)
// ─────────────────────────────────────────────────────

window.ouvrirModalValiderBrouillon = function ouvrirModalValiderBrouillon(brouillonId) {
  const b = (window.allBrouillons || []).find(x => x.id === brouillonId);
  if (!b) return;
  if (!(b.lignes || []).length) { toast("Ajoute au moins une ligne avant de valider.", "err"); return; }

  _brouillonAValider = brouillonId;
  const total = (b.lignes || []).reduce((s, l) => s + l.qte * l.prix, 0);
  const recapEl = document.getElementById("mv-brouillon-recap");
  if (recapEl) recapEl.textContent = `${b.produitNom} — ${b.pcsVendues} pièce(s) — ${fmt(total)}`;
  document.getElementById("modal-valider-brouillon")?.classList.add("active");
};

window.fermerModalValiderBrouillon = function fermerModalValiderBrouillon() {
  document.getElementById("modal-valider-brouillon")?.classList.remove("active");
  _brouillonAValider = null;
};

window.confirmerValidationBrouillon = async function confirmerValidationBrouillon() {
  const brouillonId = _brouillonAValider;
  const b = (window.allBrouillons || []).find(x => x.id === brouillonId);
  if (!b) return;
  const paiement = document.getElementById("mv-paiement")?.value || "especes";

  loader(true);
  try {
    const totalPieces  = b.pcsVendues;
    const totalMontant = (b.lignes || []).reduce((s, l) => s + l.qte * l.prix, 0);

    const counterRef   = settingsRef("counter");
    const produitRef   = db.collection("produits").doc(b.produitId);
    const brouillonRef = db.collection("brouillons_carton").doc(brouillonId);
    const ventesRef    = db.collection("ventes");

    let numero = null, venteId = null;

    // [DURCI] La création de la vente (+ décrément stock + mouvement)
    // reste une transaction atomique — c'est le cœur financier, il ne
    // doit jamais y avoir de vente sans stock décrémenté ou l'inverse.
    // En revanche, marquer le brouillon "valide" se fait dans un
    // DEUXIÈME appel, une fois la vente réellement commitée en base.
    // Raison technique : la règle Firestore qui autorise ce passage à
    // "valide" vérifie exists() sur la vente référencée — et exists()
    // dans une transaction ne voit que l'état de la base AVANT cette
    // transaction, jamais ses propres écritures en cours. Le faire en
    // un seul bloc aurait fait échouer la validation à coup sûr.
    await db.runTransaction(async transaction => {
      // Lectures d'abord (règle Firestore).
      const counterSnap  = await transaction.get(counterRef);
      const produitSnap  = await transaction.get(produitRef);

      const currentVal = counterSnap.exists ? (counterSnap.data().val ?? 0) : 0;
      const newVal     = currentVal + 1;
      numero = genNumero("recu", newVal);

      const stockActuel = produitSnap.exists ? (produitSnap.data().stock ?? 0) : 0;
      if (totalPieces > stockActuel) {
        throw new Error(`Stock insuffisant pour "${b.produitNom}" (disponible : ${stockActuel}, vendu au détail : ${totalPieces}).`);
      }
      const nouveauStock = stockActuel - totalPieces;

      const venteRef = ventesRef.doc();
      venteId = venteRef.id;
      transaction.set(venteRef, {
        type: "recu",
        numero,
        date: firebase.firestore.Timestamp.fromDate(new Date()),
        client: { nom: "", tel: "", email: "", adresse: "" },
        lignes: (b.lignes || []).map(l => ({
          id: l.id, des: `${b.produitNom} (détail)`, prix: l.prix, qte: l.qte, remise: 0, produitId: b.produitId,
        })),
        paiement,
        montantRecu: totalMontant,
        note: "Vente au détail depuis un carton ouvert",
        ht: totalMontant, remiseMt: 0, tvaMt: 0, total: totalMontant, tvaRate: 0, remise: 0, applyTva: false,
        devise: window.config.devise ?? window.entreprise.devise ?? "F CFA",
        devisePos: window.config.devisePos ?? "after",
        uid: window._shopUid(),
        creePar: window.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        brouillonId,
      });
      transaction.set(counterRef, { val: newVal }, { merge: true });
      transaction.update(produitRef, { stock: nouveauStock });

      const mvtRef = db.collection("mouvements_stock").doc();
      transaction.set(mvtRef, {
        produitId:  b.produitId,
        produitNom: b.produitNom,
        type:       "sortie",
        quantite:   totalPieces,
        stockAvant: stockActuel,
        stockApres: nouveauStock,
        motif:      `Vente au détail (carton ouvert) — ${numero}`,
        venteId,
        userId:     window.currentUser.uid,
        shopId:     window._shopUid(),
        createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Étape 2, une fois la vente commitée : marquer le brouillon comme
    // validé. Si cette étape échoue (réseau coupé pile à ce moment,
    // par ex.), la vente et le stock sont déjà corrects — seul le
    // brouillon resterait affiché "ouvert" à tort, une anomalie
    // visible et sans impact financier, pas une perte d'argent.
    await brouillonRef.update({
      statut:        "valide",
      valideAt:      firebase.firestore.FieldValue.serverTimestamp(),
      valideVenteId: venteId,
    });

    toast(`✅ Brouillon validé — vente ${numero} enregistrée !`);
    window.allBrouillons = window.allBrouillons.filter(x => x.id !== brouillonId);
    fermerModalValiderBrouillon();
    renderBrouillons();
    updateBadgeBrouillons();
    if (typeof chargerCatalogue === "function") chargerCatalogue();
    if (typeof chargerDashboard === "function") chargerDashboard();
  } catch (e) {
    toast("Erreur validation : " + e.message, "err");
    console.error("confirmerValidationBrouillon:", e);
  }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  RENDU
// ─────────────────────────────────────────────────────

function renderBrouillons() {
  const grid = document.getElementById("brouillons-grid");
  if (!grid) return;
  const list = window.allBrouillons || [];

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div style="font-size:32px;margin-bottom:10px;">📦</div>
        Aucun carton ouvert pour le moment.<br>
        <span style="font-size:12px;">Depuis le catalogue, choisis "Au détail" sur un produit dont il ne reste que des cartons fermés.</span>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(b => {
    const restantes    = b.pcsInitiales - b.pcsVendues;
    const totalMontant = (b.lignes || []).reduce((s, l) => s + l.qte * l.prix, 0);
    const lignesHtml = (b.lignes || []).map(l => `
      <tr>
        <td style="padding:5px 8px;">${l.qte}</td>
        <td style="padding:5px 8px;">${fmt(l.prix)}</td>
        <td style="padding:5px 8px;font-weight:600;">${fmt(l.qte * l.prix)}</td>
        <td style="padding:5px 8px;text-align:right;">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="supprimerLigneBrouillon('${b.id}', ${l.id})" title="Retirer">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </td>
      </tr>`).join("");

    return `
    <div class="produit-card">
      <div class="produit-card-head">
        <div>
          <div class="produit-nom">${escHtml(b.produitNom)}</div>
          <div class="produit-ref">Carton ouvert — <strong>${restantes}</strong> / ${b.pcsInitiales} pièce(s) restantes</div>
        </div>
      </div>

      ${lignesHtml
        ? `<table class="hist-table" style="margin:10px 0;width:100%;"><thead><tr><th>Qté</th><th>P.U.</th><th>Total</th><th></th></tr></thead><tbody>${lignesHtml}</tbody></table>`
        : `<div style="font-size:12px;opacity:.65;margin:10px 0;">Aucune vente enregistrée pour l'instant dans ce carton.</div>`}

      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">
        <input type="number" id="bl-qte-${b.id}" class="fc" placeholder="Qté" min="1" max="${restantes}" step="1" style="width:70px;">
        <input type="number" id="bl-prix-${b.id}" class="fc" placeholder="Prix" min="0" step="1" value="${b.prixPiece}" style="width:100px;">
        <button class="btn btn-ghost btn-sm" onclick="ajouterLigneBrouillon('${b.id}')" ${restantes <= 0 ? "disabled" : ""}>+ Ajouter</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:13px;opacity:.75;">Total du brouillon : <strong>${fmt(totalMontant)}</strong></div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="annulerBrouillon('${b.id}')">Annuler</button>
          <button class="btn btn-primary btn-sm" onclick="ouvrirModalValiderBrouillon('${b.id}')">Valider</button>
        </div>
      </div>
    </div>`;
  }).join("");
}
window.renderBrouillons = renderBrouillons;

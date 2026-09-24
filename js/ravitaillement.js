// ══════════════════════════════════════════════════════
//  ravitaillement.js  —  FacturaPro
//
//  Ravitaillement / approvisionnement du catalogue.
//  Un ravitaillement :
//   - augmente le stock des produits reçus
//   - génère un mouvement de stock "entree" par article
//     (traçabilité : qui, quand, combien, pourquoi)
//   - est enregistré dans la collection `ravitaillements`
//     avec sa propre numérotation (RAV-AAMM-XXXX)
//   - produit un PDF (bon de ravitaillement) à la fin
//
//  Toutes les écritures (produits + mouvements_stock +
//  ravitaillement + compteur) se font dans UNE SEULE
//  transaction Firestore.
// ══════════════════════════════════════════════════════
"use strict";

let _ravSaving = false;

window.ouvrirModalRavitaillement = function ouvrirModalRavitaillement() {
  document.getElementById("rav-fournisseur").value = "";
  document.getElementById("rav-note").value = "";
  document.getElementById("rav-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("rav-lignes").innerHTML = "";
  _ravAjouterLigne();
  document.getElementById("modal-ravitaillement").classList.add("active");
};

window.fermerModalRavitaillement = function fermerModalRavitaillement() {
  document.getElementById("modal-ravitaillement").classList.remove("active");
};

let _ravRowSeq = 0;
const _RAV_NOUVEAU = "__nouveau__";

window._ravAjouterLigne = function _ravAjouterLigne() {
  const container = document.getElementById("rav-lignes");
  const rowId = "rav-row-" + (++_ravRowSeq);

  const options = (window.allProduits || [])
    .slice()
    .sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? "", "fr"))
    .map(p => `<option value="${p.id}">${escHtml(p.nom)}</option>`)
    .join("");

  const row = document.createElement("div");
  row.dataset.ravRow = rowId;
  row.className = "rav-row";
  row.innerHTML = `
    <div class="fg rav-f-produit" style="margin:0;">
      <label class="flabel">Produit</label>
      <select class="fc rav-produit" onchange="_ravSurChangementProduit(this)">
        <option value="${_RAV_NOUVEAU}">➕ Nouveau produit (pas encore au catalogue)</option>
        ${options}
      </select>
      <div class="rav-nouveau-fields" style="display:none;margin-top:6px;gap:6px;">
        <input type="text" class="fc rav-nouveau-nom" placeholder="Nom du nouveau produit">
        <input type="number" class="fc rav-nouveau-prixvente" placeholder="Prix de vente" min="0" step="1">
      </div>
      <div class="rav-unit-box" style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;">
        <select class="fc rav-unite" style="width:auto;" onchange="_ravSurChangementUnite(this)">
          <option value="piece">Saisie en pièces</option>
          <option value="carton">Saisie en cartons</option>
        </select>
        <span class="rav-pcs-wrap" style="display:none;align-items:center;gap:4px;font-size:12px;">
          <input type="number" class="fc rav-pcs" min="1" step="1" placeholder="12" style="width:64px;" oninput="_ravRecalculerTotal()"> pièces/carton
        </span>
        <span class="rav-conv" style="font-size:12px;opacity:.75;"></span>
      </div>
    </div>
    <div class="fg rav-f-qte" style="margin:0;">
      <label class="flabel">Qté reçue</label>
      <input type="number" class="fc rav-qte" value="1" min="1" step="1" oninput="_ravRecalculerTotal()">
    </div>
    <div class="fg rav-f-prix" style="margin:0;">
      <label class="flabel">P.U. achat</label>
      <input type="number" class="fc rav-prix" value="0" min="0" step="1" oninput="_ravRecalculerTotal()">
    </div>
    <button type="button" class="btn btn-ghost rav-f-del" style="padding:0;height:34px;" onclick="_ravSupprimerLigne(this)">✕</button>
  `;
  container.appendChild(row);
  // Une ligne fraîchement ajoutée pointe directement vers "Nouveau
  // produit" — on affiche tout de suite les champs correspondants.
  _ravSurChangementProduit(row.querySelector(".rav-produit"));
};

window._ravSurChangementProduit = function _ravSurChangementProduit(select) {
  const champs = select.closest("[data-rav-row]").querySelector(".rav-nouveau-fields");
  champs.style.display = select.value === _RAV_NOUVEAU ? "grid" : "none";
  const rowEl = select.closest("[data-rav-row]");
  const prod  = (window.allProduits || []).find(x => x.id === select.value);
  const pcsEl = rowEl.querySelector(".rav-pcs");
  if (prod && prod.pcsParCarton > 1 && pcsEl) pcsEl.value = prod.pcsParCarton;
  _ravRecalculerTotal();
};

window._ravSurChangementUnite = function _ravSurChangementUnite(select) {
  const row = select.closest("[data-rav-row]");
  row.querySelector(".rav-pcs-wrap").style.display = select.value === "carton" ? "inline-flex" : "none";
  _ravRecalculerTotal();
};

window._ravSupprimerLigne = function _ravSupprimerLigne(btn) {
  const container = document.getElementById("rav-lignes");
  if (container.children.length <= 1) {
    toast("Il faut garder au moins un article.", "err");
    return;
  }
  btn.closest("[data-rav-row]").remove();
  _ravRecalculerTotal();
};

window._ravRecalculerTotal = function _ravRecalculerTotal() {
  const rows = document.querySelectorAll("#rav-lignes [data-rav-row]");
  let total = 0;
  rows.forEach(row => {
    const qte  = parseFloat(row.querySelector(".rav-qte").value) || 0;
    const prix = parseFloat(row.querySelector(".rav-prix").value) || 0;
    total += qte * prix;
    const unite = row.querySelector(".rav-unite")?.value;
    const pcs   = parseFloat(row.querySelector(".rav-pcs")?.value) || 0;
    const conv  = row.querySelector(".rav-conv");
    if (conv) conv.textContent = (unite === "carton" && pcs > 0 && qte > 0) ? "= " + (qte * pcs) + " pièces" : "";
  });
  const el = document.getElementById("rav-total");
  if (el) el.textContent = Math.round(total).toLocaleString("fr-FR");
};

function _ravLireLignes() {
  const rows = document.querySelectorAll("#rav-lignes [data-rav-row]");
  const existantes = []; // produits déjà au catalogue
  const nouvelles   = []; // produits à créer en même temps que le ravitaillement
  let erreur = null;
  rows.forEach(row => {
    const selectEl   = row.querySelector(".rav-produit");
    const produitId  = selectEl.value;
    const qteSaisie  = parseFloat(row.querySelector(".rav-qte").value) || 0;
    const prixSaisi  = parseFloat(row.querySelector(".rav-prix").value) || 0;
    if (qteSaisie <= 0) return;

    // Cartons → tout est converti en PIÈCES (le stock est toujours en pièces).
    // En mode carton, "P.U. achat" = prix d'un carton.
    const enCarton = row.querySelector(".rav-unite")?.value === "carton";
    const pcs      = parseInt(row.querySelector(".rav-pcs")?.value) || 0;
    if (enCarton && pcs < 1) { erreur = "Indique le nombre de pièces par carton."; return; }
    const qte          = enCarton ? qteSaisie * pcs : qteSaisie;
    const prixUnitaire = enCarton ? prixSaisi / pcs : prixSaisi;   // prix d'une pièce
    const total        = qteSaisie * prixSaisi;
    const extra        = { pcsParCarton: pcs > 1 ? pcs : null, cartons: enCarton ? qteSaisie : null };

    if (produitId === _RAV_NOUVEAU) {
      const nom       = row.querySelector(".rav-nouveau-nom")?.value.trim();
      const prixVente = parseFloat(row.querySelector(".rav-nouveau-prixvente")?.value) || 0;
      if (!nom) return; // ligne "nouveau produit" incomplète — ignorée silencieusement
      nouvelles.push({ produitNom: nom, prixVente, qte, prixUnitaire, total, ...extra });
    } else if (produitId) {
      const produitNom = selectEl.selectedOptions[0]?.textContent || "";
      existantes.push({ produitId, produitNom, qte, prixUnitaire, total, ...extra });
    }
  });
  return { existantes, nouvelles, erreur };
}

window.enregistrerRavitaillement = async function enregistrerRavitaillement() {
  if (_ravSaving) return;

  const { existantes, nouvelles, erreur } = _ravLireLignes();
  if (erreur) { toast(erreur, "err"); return; }
  if (!existantes.length && !nouvelles.length) {
    toast("Ajoute au moins un article avec une quantité valide (et un nom pour un nouveau produit).", "err");
    return;
  }

  // Regrouper les produits déjà au catalogue par produitId (au cas
  // où le même produit est sélectionné sur deux lignes).
  const parProduit = new Map();
  existantes.forEach(l => {
    const prev = parProduit.get(l.produitId);
    if (prev) { prev.qte += l.qte; prev.total += l.total; }
    else parProduit.set(l.produitId, { ...l });
  });
  const lignesExistantes = [...parProduit.values()];

  const fournisseur = document.getElementById("rav-fournisseur").value.trim();
  const dateStr = document.getElementById("rav-date").value || new Date().toISOString().slice(0, 10);
  const note = document.getElementById("rav-note").value.trim();
  const totalAchat = lignesExistantes.reduce((s, l) => s + l.total, 0)
                    + nouvelles.reduce((s, l) => s + l.total, 0);

  _ravSaving = true;
  loader(true);
  let savedData = null;
  try {
    const counterRef  = settingsRef("counter");
    const ravRef      = db.collection("ravitaillements").doc();
    const produitRefs = lignesExistantes.map(l => db.collection("produits").doc(l.produitId));
    // Un ID généré à l'avance pour chaque nouveau produit : on en a
    // besoin pour écrire le mouvement de stock ET la ligne du
    // ravitaillement AVANT que le produit existe réellement.
    const nouveauxRefs = nouvelles.map(() => db.collection("produits").doc());

    await db.runTransaction(async transaction => {
      // Toutes les lectures avant la première écriture — seuls les
      // produits déjà existants ont besoin d'être lus (pour connaître
      // leur stock actuel) ; les nouveaux n'existent pas encore.
      const counterSnap  = await transaction.get(counterRef);
      const produitSnaps = await Promise.all(produitRefs.map(ref => transaction.get(ref)));

      const currentVal = counterSnap.exists ? (counterSnap.data().valRavitaillement ?? 0) : 0;
      const newVal     = currentVal + 1;
      const now        = new Date();
      const numero     = "RAV-" + String(now.getFullYear()).slice(2) +
                          String(now.getMonth() + 1).padStart(2, "0") + "-" +
                          String(newVal).padStart(4, "0");
      const shopUid    = window._shopUid();
      const motifBase  = `Ravitaillement ${numero}` + (fournisseur ? ` — ${fournisseur}` : "");

      // ── Produits déjà au catalogue : stock existant + qte reçue ──
      const lignesFinales = [];
      produitSnaps.forEach((snap, i) => {
        const ligne = lignesExistantes[i];
        if (!snap.exists) return;
        const stockAvant = snap.data().stock ?? 0;
        const stockApres = stockAvant + ligne.qte;
        transaction.update(produitRefs[i], { stock: stockApres, ...(ligne.pcsParCarton ? { pcsParCarton: ligne.pcsParCarton } : {}) });

        transaction.set(db.collection("mouvements_stock").doc(), {
          produitId: ligne.produitId, produitNom: snap.data().nom || ligne.produitNom,
          type: "entree", quantite: ligne.qte, stockAvant, stockApres,
          motif: motifBase, venteId: null, ravitaillementId: ravRef.id,
          userId: window.currentUser.uid, shopId: shopUid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        lignesFinales.push({
          produitId: ligne.produitId, produitNom: ligne.produitNom,
          qte: ligne.qte, prixUnitaire: ligne.prixUnitaire, total: ligne.total,
          pcsParCarton: ligne.pcsParCarton ?? null, cartons: ligne.cartons ?? null,
        });
      });

      // ── Nouveaux produits : création + stock initial = qte reçue ──
      nouvelles.forEach((ligne, i) => {
        const ref = nouveauxRefs[i];
        transaction.set(ref, {
          nom: ligne.produitNom, ref: "", categorie: "", description: "",
          prix: ligne.prixVente, stock: ligne.qte, pcsParCarton: ligne.pcsParCarton ?? null, uid: shopUid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        transaction.set(db.collection("mouvements_stock").doc(), {
          produitId: ref.id, produitNom: ligne.produitNom,
          type: "entree", quantite: ligne.qte, stockAvant: 0, stockApres: ligne.qte,
          motif: motifBase + " (nouveau produit)", venteId: null, ravitaillementId: ravRef.id,
          userId: window.currentUser.uid, shopId: shopUid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        lignesFinales.push({
          produitId: ref.id, produitNom: ligne.produitNom,
          qte: ligne.qte, prixUnitaire: ligne.prixUnitaire, total: ligne.total,
          pcsParCarton: ligne.pcsParCarton ?? null, cartons: ligne.cartons ?? null,
        });
      });

      const toSave = {
        numero, fournisseur, note, dateStr,
        date: firebase.firestore.Timestamp.fromDate(new Date(dateStr + "T12:00:00")),
        lignes: lignesFinales, totalAchat,
        uid: shopUid, creePar: window.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      transaction.set(ravRef, toSave);
      transaction.set(counterRef, { valRavitaillement: newVal }, { merge: true });

      savedData = { ...toSave, id: ravRef.id, date: new Date(dateStr + "T12:00:00") };
    });

    toast("✅ Ravitaillement enregistré — stock mis à jour !");
    fermerModalRavitaillement();
    if (typeof chargerCatalogue === "function") await chargerCatalogue();

    // Génération du PDF juste après l'enregistrement réussi
    try {
      const nom = genererPDFRavitaillement(savedData, window.entreprise || {});
      toast(`📥 PDF prêt : ${nom}`);
    } catch (e) {
      toast("Ravitaillement enregistré, mais le PDF a échoué : " + e.message, "err");
    }
  } catch (e) {
    toast("Erreur : " + e.message, "err");
  } finally {
    _ravSaving = false;
    loader(false);
  }
};

// ══════════════════════════════════════════════════════
//  HISTORIQUE DES RAVITAILLEMENTS
//  Pour retrouver un bon déjà enregistré (aujourd'hui ou avant)
//  et retirer son PDF sans avoir à tout re-saisir.
// ══════════════════════════════════════════════════════

window._ravHistorique = [];

window.ouvrirHistoriqueRavitaillements = async function ouvrirHistoriqueRavitaillements() {
  document.getElementById("modal-historique-rav").classList.add("active");
  const container = document.getElementById("rav-hist-liste");
  container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-muted);font-size:13px;">Chargement…</div>`;

  try {
    let snap;
    try {
      snap = await db.collection("ravitaillements")
        .where("uid", "==", window._shopUid())
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
    } catch (e) {
      // Repli si l'index composite (uid + createdAt) n'existe pas
      // encore côté Firestore — même logique que pour l'historique
      // des ventes.
      snap = await db.collection("ravitaillements")
        .where("uid", "==", window._shopUid())
        .get();
    }

    window._ravHistorique = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDateObj(b.createdAt ?? b.date) - toDateObj(a.createdAt ?? a.date));

    _renderHistoriqueRavitaillements();
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);font-size:13px;">Erreur : ${escHtml(e.message)}</div>`;
  }
};

window.fermerHistoriqueRavitaillements = function fermerHistoriqueRavitaillements() {
  document.getElementById("modal-historique-rav").classList.remove("active");
};

function _renderHistoriqueRavitaillements() {
  const container = document.getElementById("rav-hist-liste");
  const liste = window._ravHistorique;

  if (!liste.length) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--ink-muted);font-size:13px;">Aucun ravitaillement enregistré pour l'instant.</div>`;
    return;
  }

  container.innerHTML = liste.map(r => {
    const d = toDateObj(r.date);
    const dStr = String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
    const nbArticles = (r.lignes || []).length;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 4px;border-bottom:1px solid var(--border);gap:8px;">
        <div style="min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--ink);">${escHtml(r.numero ?? "—")}</div>
          <div style="font-size:11.5px;color:var(--ink-muted);">
            ${dStr}${r.fournisseur ? " · " + escHtml(r.fournisseur) : ""} · ${nbArticles} article${nbArticles > 1 ? "s" : ""}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="font-weight:700;font-family:'DM Mono',monospace;font-size:13px;color:var(--copper);">${fmt(r.totalAchat ?? 0)}</span>
          <button class="btn btn-ghost btn-sm btn-icon" title="Télécharger le PDF" onclick="_ravReimprimer('${r.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
          </button>
        </div>
      </div>`;
  }).join("");
}

window._ravReimprimer = function _ravReimprimer(id) {
  const r = window._ravHistorique.find(x => x.id === id);
  if (!r) { toast("Ravitaillement introuvable.", "err"); return; }
  try {
    const nom = genererPDFRavitaillement({ ...r, date: toDateObj(r.date) }, window.entreprise || {});
    toast(`📥 PDF prêt : ${nom}`);
  } catch (e) {
    toast("Erreur PDF : " + e.message, "err");
  }
};

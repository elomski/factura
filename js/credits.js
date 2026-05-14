// ══════════════════════════════════════════════════════
//  credits.js  —  FacturaPro  v2
//
//  [FIX] Zéro index composite Firestore :
//        - Requête unique uid → filtre paiement côté client
//        - Sous-coll paiements sans orderBy → tri client
//  [FIX] Rendu monnaie : affichage uniquement si montantRecu
//        >= total ; sinon badge rouge "Insuffisant"
// ══════════════════════════════════════════════════════

"use strict";

let allCredits    = [];
let filtreCredits = "encours"; // "tous" | "encours" | "solde"

// ─────────────────────────────────────────────────────
//  CHARGEMENT
//  ✅ UN SEUL .where(uid) — filtre "credit" côté client
//     Sous-collection paiements sans orderBy → tri client
// ─────────────────────────────────────────────────────

async function chargerCredits() {
  if (!currentUser) return;
  loader(true);
  try {
    // Charger TOUTES les ventes du user → filtrer "credit" en JS
    const snap = await db.collection("ventes")
      .where("uid", "==", currentUser.uid)
      .get();

    const ventesCredit = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(v => v.paiement === "credit")
      .sort((a, b) => toDateObj(b.createdAt || b.date) - toDateObj(a.createdAt || a.date));

    // Charger les paiements partiels sans orderBy
    allCredits = await Promise.all(ventesCredit.map(async v => {
      try {
        // ✅ Pas de .orderBy() sur la sous-collection → pas d'index requis
        const pSnap = await db.collection("ventes").doc(v.id)
          .collection("paiements")
          .get();

        // Tri par date côté client
        const paiements = pSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toDateObj(a.date) - toDateObj(b.date));

        const totalPaye    = paiements.reduce((s, p) => s + (p.montant || 0), 0);
        const soldeRestant = Math.max(0, (v.total || 0) - totalPaye);
        return { ...v, paiements, totalPaye, soldeRestant, solde: soldeRestant <= 0.01 };
      } catch (e) {
        // Erreur sur une sous-collection spécifique → on continue
        console.warn("Erreur paiements vente", v.id, e.message);
        return { ...v, paiements: [], totalPaye: 0, soldeRestant: v.total || 0, solde: false };
      }
    }));

    renderCredits();
    updateStatsCredits();
    _updateBadgeCreditsSidebar();
  } catch (e) {
    toast("Erreur chargement crédits : " + e.message, "err");
    console.error("chargerCredits:", e);
  }
  loader(false);
}

// Badge sidebar mis à jour localement (sans requête supplémentaire)
function _updateBadgeCreditsSidebar() {
  const nbEncours = allCredits.filter(c => !c.solde).length;
  const badge = document.getElementById("sb-credits-badge");
  if (badge) {
    badge.style.display = nbEncours > 0 ? "inline-block" : "none";
    badge.textContent   = nbEncours > 9 ? "9+" : String(nbEncours);
  }
}

// ─────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────

function updateStatsCredits() {
  const encours = allCredits.filter(c => !c.solde);
  const totalDu = encours.reduce((s, c) => s + c.soldeRestant, 0);
  const nbClients = new Set(encours.map(c => c.client?.nom || "?")).size;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("cr-stat-nb",      encours.length);
  set("cr-stat-total",   Number(totalDu).toLocaleString("fr-FR"));
  set("cr-stat-clients", nbClients);
  set("cr-stat-soldes",  allCredits.filter(c => c.solde).length);
}

// ─────────────────────────────────────────────────────
//  RENDU TABLE
// ─────────────────────────────────────────────────────

function renderCredits() {
  const tbody = document.getElementById("credits-list");
  if (!tbody) return;

  let filtered = allCredits;
  if (filtreCredits === "encours") filtered = allCredits.filter(c => !c.solde);
  if (filtreCredits === "solde")   filtered = allCredits.filter(c =>  c.solde);

  const q = (document.getElementById("cr-search")?.value || "").toLowerCase().trim();
  if (q) filtered = filtered.filter(c =>
    (c.client?.nom || "").toLowerCase().includes(q) ||
    (c.client?.tel || "").toLowerCase().includes(q) ||
    (c.numero      || "").toLowerCase().includes(q)
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">
      ${filtreCredits === "encours" ? "🎉 Aucune ardoise en cours !" : "Aucun crédit trouvé."}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const pct = c.total > 0 ? Math.min(100, (c.totalPaye / c.total) * 100) : 0;
    const statutBadge = c.solde
      ? `<span class="badge" style="background:var(--green-bg);color:var(--green);">✓ Soldé</span>`
      : `<span class="badge" style="background:var(--amber-bg);color:var(--amber);">En cours</span>`;

    return `<tr>
      <td>
        <div style="font-weight:600;">${escHtml(c.client?.nom || "Anonyme")}</div>
        <div style="font-size:11px;color:var(--ink-muted);">${escHtml(c.client?.tel || "")}</div>
      </td>
      <td class="mono" style="font-size:12px;">${escHtml(c.numero || "—")}</td>
      <td class="mono" style="font-weight:600;">${fmt(c.total)}</td>
      <td>
        <div class="mono" style="font-weight:600;color:var(--green);">${fmt(c.totalPaye)}</div>
        <div style="background:var(--border);border-radius:4px;height:5px;margin-top:4px;overflow:hidden;">
          <div style="background:var(--green);height:5px;width:${pct.toFixed(0)}%;border-radius:4px;"></div>
        </div>
      </td>
      <td class="mono" style="font-weight:700;color:${c.solde ? "var(--green)" : "var(--red)"};">
        ${c.solde ? "—" : fmt(c.soldeRestant)}
      </td>
      <td>${statutBadge}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${!c.solde ? `
            <button class="btn btn-green btn-sm" onclick="ouvrirModalPaiement('${c.id}')">
              💰 Payer
            </button>
            <button class="btn btn-ghost btn-sm" onclick="marquerSolde('${c.id}')">
              ✓ Solder
            </button>` : ""}
          <button class="btn btn-ghost btn-sm btn-icon" onclick="ouvrirDetailCredit('${c.id}')">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10 9v5M10 7v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function filtrerCredits(filtre) {
  filtreCredits = filtre;
  document.querySelectorAll(".cr-filtre-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filtre === filtre);
  });
  renderCredits();
}

// ─────────────────────────────────────────────────────
//  MODAL PAIEMENT PARTIEL
//  [FIX] Rendu monnaie : affiché uniquement si montant >= total
//        Sinon → badge rouge "Insuffisant"
// ─────────────────────────────────────────────────────

let _creditEnCours = null;

function ouvrirModalPaiement(ventId) {
  const c = allCredits.find(x => x.id === ventId);
  if (!c) return;
  _creditEnCours = c;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("mp-cr-client",  c.client?.nom || "Anonyme");
  set("mp-cr-total",   fmt(c.total));
  set("mp-cr-paye",    fmt(c.totalPaye));
  set("mp-cr-restant", fmt(c.soldeRestant));

  const montantInput = document.getElementById("mp-cr-montant");
  const noteInput    = document.getElementById("mp-cr-note");
  const dateInput    = document.getElementById("mp-cr-date");
  if (montantInput) montantInput.value = "";
  if (noteInput)    noteInput.value    = "";
  if (dateInput)    dateInput.value    = new Date().toISOString().slice(0, 10);

  // Historique paiements
  const hist = document.getElementById("mp-cr-historique");
  if (hist) {
    hist.innerHTML = c.paiements?.length
      ? c.paiements.map(p => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;
               border-bottom:1px solid var(--border);font-size:12px;">
            <span style="color:var(--ink-soft);">
              ${p.date?.toDate ? p.date.toDate().toLocaleDateString("fr-FR") : p.dateStr || "—"}
            </span>
            <span style="font-weight:700;color:var(--green);font-family:'DM Mono',monospace;">
              +${fmt(p.montant)}
            </span>
            ${p.note ? `<span style="color:var(--ink-muted);font-style:italic;">${escHtml(p.note)}</span>` : ""}
          </div>`).join("")
      : `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;text-align:center;padding:10px;">
           Aucun paiement enregistré.
         </div>`;
  }

  // Reset l'indicateur de rendu monnaie
  _updateRenduPaiement();

  document.getElementById("modal-paiement").classList.add("active");
  setTimeout(() => montantInput?.focus(), 120);
}

/**
 * [FIX] Calcule et affiche le rendu monnaie dans le modal paiement
 *  - Si montant saisi < solde restant → badge rouge "Insuffisant"
 *  - Si montant saisi = solde restant → badge vert "Solde exact ✓"
 *  - Si montant saisi > solde restant → affiche le rendu en vert
 */
function _updateRenduPaiement() {
  const montantInput = document.getElementById("mp-cr-montant");
  const renduEl      = document.getElementById("mp-cr-rendu");
  if (!renduEl || !_creditEnCours) return;

  const montant = parseFloat(montantInput?.value) || 0;
  const solde   = _creditEnCours.soldeRestant;

  if (montant <= 0) {
    renduEl.style.display = "none";
    return;
  }

  renduEl.style.display = "flex";

  if (montant < solde) {
    // Insuffisant — on indique ce qu'il manque
    const manque = solde - montant;
    renduEl.innerHTML = `
      <span style="color:var(--red);font-weight:600;">
        ❌ Insuffisant — Il manque ${fmt(manque)}
      </span>`;
    renduEl.style.background = "var(--red-bg)";
  } else if (Math.abs(montant - solde) < 0.01) {
    // Exact
    renduEl.innerHTML = `
      <span style="color:var(--green);font-weight:700;">✅ Montant exact — Ardoise soldée</span>`;
    renduEl.style.background = "var(--green-bg)";
  } else {
    // Supérieur → rendu monnaie
    const rendu = montant - solde;
    renduEl.innerHTML = `
      <span style="color:var(--ink-soft);">Rendu monnaie</span>
      <span style="color:var(--green);font-weight:700;font-family:'DM Mono',monospace;">
        ${fmt(rendu)}
      </span>`;
    renduEl.style.background = "var(--green-bg)";
  }
}

// Brancher le calcul en live sur l'input montant
document.getElementById("mp-cr-montant")?.addEventListener("input", _updateRenduPaiement);

function fermerModalPaiement() {
  document.getElementById("modal-paiement").classList.remove("active");
  _creditEnCours = null;
}

async function enregistrerPaiement() {
  if (!_creditEnCours) return;
  const montant = parseFloat(document.getElementById("mp-cr-montant")?.value);
  const note    = document.getElementById("mp-cr-note")?.value.trim() || "";
  const dateStr = document.getElementById("mp-cr-date")?.value || new Date().toISOString().slice(0,10);

  if (!montant || montant <= 0) {
    toast("Saisis un montant valide.", "err"); return;
  }
  if (montant > _creditEnCours.soldeRestant + 0.01) {
    // On accepte le surplus — il sera rendu comme monnaie
    // Mais on plafonne l'enregistrement au solde restant
    const confirmSurplus = confirm(
      `Le montant saisi (${fmt(montant)}) dépasse le solde (${fmt(_creditEnCours.soldeRestant)}).\n` +
      `Rendu monnaie : ${fmt(montant - _creditEnCours.soldeRestant)}\n\nConfirmer ?`
    );
    if (!confirmSurplus) return;
  }

  loader(true);
  try {
    const pRef = db.collection("ventes").doc(_creditEnCours.id).collection("paiements");
    await pRef.add({
      montant:   Math.min(montant, _creditEnCours.soldeRestant), // on enregistre au max le solde dû
      note,
      dateStr,
      date:      firebase.firestore.Timestamp.fromDate(new Date(dateStr + "T12:00:00")),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    const nouveauSolde = _creditEnCours.soldeRestant - Math.min(montant, _creditEnCours.soldeRestant);
    if (nouveauSolde <= 0.01) {
      await db.collection("ventes").doc(_creditEnCours.id).update({ solde: true });
      toast("✅ Paiement enregistré — Ardoise soldée ! 🎉");
    } else {
      toast(`✅ ${fmt(Math.min(montant, _creditEnCours.soldeRestant))} enregistré. Reste : ${fmt(nouveauSolde)}`);
    }

    fermerModalPaiement();
    chargerCredits();
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
}

async function marquerSolde(ventId) {
  if (!confirm("Marquer cette ardoise comme entièrement soldée ?")) return;
  loader(true);
  try {
    const c = allCredits.find(x => x.id === ventId);
    if (c && c.soldeRestant > 0.01) {
      await db.collection("ventes").doc(ventId).collection("paiements").add({
        montant:   c.soldeRestant,
        note:      "Solde final",
        dateStr:   new Date().toISOString().slice(0, 10),
        date:      firebase.firestore.Timestamp.fromDate(new Date()),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    await db.collection("ventes").doc(ventId).update({ solde: true });
    toast("✅ Ardoise soldée !");
    chargerCredits();
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
}

// ─────────────────────────────────────────────────────
//  MODAL DÉTAIL CRÉDIT
// ─────────────────────────────────────────────────────

function ouvrirDetailCredit(ventId) {
  const c = allCredits.find(x => x.id === ventId);
  if (!c) return;

  document.getElementById("modal-detail-title").textContent =
    `Ardoise — ${c.client?.nom || "Anonyme"}`;

  const lignesHtml = (c.lignes || []).map(l => `
    <tr>
      <td style="padding:6px 10px;">${escHtml(l.des || "—")}</td>
      <td style="padding:6px 10px;text-align:center;">${l.qte}</td>
      <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;">
        ${Number(l.prix).toLocaleString("fr-FR")}
      </td>
      <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;">
        ${Number(l.qte * l.prix * (1 - (l.remise || 0) / 100)).toLocaleString("fr-FR")}
      </td>
    </tr>`).join("");

  const paiementsHtml = c.paiements?.length
    ? c.paiements.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;
             padding:8px 12px;background:var(--green-bg);border-radius:6px;margin-bottom:5px;">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--green);">+${fmt(p.montant)}</div>
            ${p.note ? `<div style="font-size:11px;color:var(--ink-muted);">${escHtml(p.note)}</div>` : ""}
          </div>
          <div style="font-size:11px;color:var(--ink-muted);">
            ${p.date?.toDate ? p.date.toDate().toLocaleDateString("fr-FR") : p.dateStr || ""}
          </div>
        </div>`).join("")
    : `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;">Aucun paiement.</div>`;

  document.getElementById("modal-detail-body").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div style="background:var(--bg);border-radius:8px;padding:12px;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:5px;">Client</div>
        <div style="font-weight:600;">${escHtml(c.client?.nom || "—")}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${escHtml(c.client?.tel || "")}</div>
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:12px;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:5px;">Facture</div>
        <div style="font-weight:600;font-family:'DM Mono',monospace;">${escHtml(c.numero || "—")}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${fmtDate(c.date)}</div>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
        <thead><tr style="background:var(--bg);">
          <th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--ink-muted);">Article</th>
          <th style="padding:7px 10px;text-align:center;font-size:10px;color:var(--ink-muted);">Qté</th>
          <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--ink-muted);">P.U.</th>
          <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--ink-muted);">Total</th>
        </tr></thead>
        <tbody>${lignesHtml}</tbody>
      </table>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
      <div style="background:var(--bg);border-radius:8px;padding:11px;text-align:center;">
        <div style="font-size:10px;color:var(--ink-muted);margin-bottom:3px;">TOTAL</div>
        <div style="font-weight:700;font-family:'DM Mono',monospace;">${fmt(c.total)}</div>
      </div>
      <div style="background:var(--green-bg);border-radius:8px;padding:11px;text-align:center;">
        <div style="font-size:10px;color:var(--ink-muted);margin-bottom:3px;">PAYÉ</div>
        <div style="font-weight:700;color:var(--green);font-family:'DM Mono',monospace;">${fmt(c.totalPaye)}</div>
      </div>
      <div style="background:var(--red-bg);border-radius:8px;padding:11px;text-align:center;">
        <div style="font-size:10px;color:var(--ink-muted);margin-bottom:3px;">RESTE</div>
        <div style="font-weight:700;color:${c.solde ? "var(--green)" : "var(--red)"};font-family:'DM Mono',monospace;">
          ${c.solde ? "Soldé ✓" : fmt(c.soldeRestant)}
        </div>
      </div>
    </div>
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:8px;">
      Historique des paiements
    </div>
    ${paiementsHtml}
  `;

  // Masquer les boutons Print/PDF dans le modal (c'est un crédit, pas une facture standard)
  const printBtn = document.getElementById("modal-print-btn");
  const pdfBtn   = document.getElementById("modal-pdf-btn");
  if (printBtn) printBtn.style.display = "none";
  if (pdfBtn)   pdfBtn.style.display   = "none";

  document.getElementById("modal-detail").classList.add("active");
}

// ─────────────────────────────────────────────────────
//  EXPORT CSV
// ─────────────────────────────────────────────────────

function exporterCreditsCSV() {
  if (!allCredits.length) { toast("Aucune donnée.", "info"); return; }
  const rows = allCredits.map(c => ({
    "Numéro":    c.numero      || "",
    "Client":    c.client?.nom || "",
    "Téléphone": c.client?.tel || "",
    "Total":     c.total       || 0,
    "Payé":      c.totalPaye   || 0,
    "Reste":     c.soldeRestant || 0,
    "Statut":    c.solde ? "Soldé" : "En cours",
    "Date":      fmtDate(c.date),
  }));
  const headers = Object.keys(rows[0]);
  const csv     = [
    headers.join(";"),
    ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g, '""')}"`).join(";")),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `credits_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast("✅ Export CSV crédits téléchargé !");
}
// ══════════════════════════════════════════════════════
//  credits.js  —  FacturaPro
//  Suivi des ventes à crédit / ardoise
//
//  CORRECTIONS v4 :
//  [A] Réutilise window.allVentes au lieu de re-lire Firestore
//      → zéro latence supplémentaire, zéro désynchronisation
//  [B] Suppression de orderBy("createdAt") → requête simple
//  [C] Dépendance sur utils.js uniquement (fmt, escHtml, etc.)
//  [D] toDateObj() utilisé partout → plus de crash Timestamp
// ══════════════════════════════════════════════════════

"use strict";

let allCredits = [];
let filtreCredits = "encours"; // "tous" | "encours" | "solde"

// ─────────────────────────────────────────────────────
//  CHARGEMENT
//  [FIX A] On filtre window.allVentes (déjà en cache)
//          au lieu de relire Firestore
//  [FIX B] Requête simple si on doit recharger
// ─────────────────────────────────────────────────────

window.chargerCredits = async function chargerCredits() {
  if (!window.currentUser) return;
  loader(true);
  try {
    // Si allVentes n'est pas encore chargé, le charger maintenant
    if (!window.allVentes?.length) {
      const snap = await db.collection("ventes")
        .where("uid", "==", window.currentUser.uid)
        .get();
      window.allVentes = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toDateObj(b.createdAt ?? b.date) - toDateObj(a.createdAt ?? a.date));
    }

    // [FIX A] Filtrer les crédits depuis le cache
    const ventesCredit = window.allVentes.filter(v => v.paiement === "credit");

    // Charger les paiements partiels pour chaque vente à crédit
    allCredits = await Promise.all(ventesCredit.map(async v => {
      // [FIX B] orderBy("date") retiré → un seul .where dans la sous-collection
      const pSnap = await db.collection("ventes").doc(v.id)
        .collection("paiements")
        .get();

      const paiements = pSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toDateObj(a.date) - toDateObj(b.date)); // tri client

      const totalPaye = paiements.reduce((s, p) => s + (p.montant ?? 0), 0);
      const soldeRestant = (v.total ?? 0) - totalPaye;
      const estSolde = v.solde === true || soldeRestant <= 0.01;

      return {
        ...v,
        paiements,
        totalPaye,
        soldeRestant: Math.max(0, soldeRestant),
        solde: estSolde,
      };
    }));

    renderCredits();
    updateStatsCredits();
    // Mettre à jour le badge sidebar
    if (typeof updateBadgeCredits === "function") updateBadgeCredits();

  } catch (e) {
    toast("Erreur chargement crédits : " + e.message, "err");
    console.error("chargerCredits:", e);
  }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────

function updateStatsCredits() {
  const encours = allCredits.filter(c => !c.solde);
  const totalDu = encours.reduce((s, c) => s + c.soldeRestant, 0);
  const nbClients = new Set(encours.map(c => c.client?.nom ?? "?")).size;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("cr-stat-nb", encours.length);
  set("cr-stat-total", Math.round(totalDu).toLocaleString("fr-FR"));
  set("cr-stat-clients", nbClients);
  set("cr-stat-soldes", allCredits.filter(c => c.solde).length);
}

// ─────────────────────────────────────────────────────
//  RENDU LISTE
// ─────────────────────────────────────────────────────

function renderCredits() {
  const tbody = document.getElementById("credits-list");
  if (!tbody) return;

  let filtered = allCredits;
  if (filtreCredits === "encours") filtered = allCredits.filter(c => !c.solde);
  if (filtreCredits === "solde") filtered = allCredits.filter(c => c.solde);

  const q = (document.getElementById("cr-search")?.value ?? "").trim().toLowerCase();
  if (q) filtered = filtered.filter(c =>
    (c.client?.nom ?? "").toLowerCase().includes(q) ||
    (c.client?.tel ?? "").toLowerCase().includes(q) ||
    (c.numero ?? "").toLowerCase().includes(q)
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

    return `
      <tr>
        <td>
          <div style="font-weight:600;">${escHtml(c.client?.nom ?? "Anonyme")}</div>
          <div style="font-size:11px;color:var(--ink-muted);">${escHtml(c.client?.tel ?? "")}</div>
        </td>
        <td class="mono" style="font-size:12px;">${escHtml(c.numero ?? "—")}</td>
        <td class="mono" style="font-weight:600;">${fmt(c.total)}</td>
        <td>
          <div class="mono" style="font-weight:600;color:var(--green);">${fmt(c.totalPaye)}</div>
          <div style="background:var(--border);border-radius:4px;height:5px;margin-top:4px;overflow:hidden;">
            <div style="background:var(--green);height:5px;width:${pct.toFixed(0)}%;border-radius:4px;transition:width .4s;"></div>
          </div>
        </td>
        <td class="mono" style="font-weight:700;color:${c.solde ? "var(--green)" : "var(--red)"};">
          ${c.solde ? "—" : fmt(c.soldeRestant)}
        </td>
        <td>${statutBadge}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${!c.solde ? `
              <button class="btn btn-green btn-sm" onclick="ouvrirModalPaiement('${c.id}')" title="Enregistrer un paiement">
                💰 Payer
              </button>
              <button class="btn btn-ghost btn-sm" onclick="marquerSolde('${c.id}')" title="Marquer comme soldé">
                ✓ Solder
              </button>` : ""}
            <button class="btn btn-ghost btn-sm btn-icon" onclick="ouvrirDetailCredit('${c.id}')" title="Voir détail">
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

window.filtrerCredits = function filtrerCredits(filtre) {
  filtreCredits = filtre;
  document.querySelectorAll(".cr-filtre-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filtre === filtre);
  });
  renderCredits();
};

// ─────────────────────────────────────────────────────
//  MODAL PAIEMENT PARTIEL
// ─────────────────────────────────────────────────────

let _creditEnCours = null;

window.ouvrirModalPaiement = function ouvrirModalPaiement(ventId) {
  const c = allCredits.find(x => x.id === ventId);
  if (!c) return;
  _creditEnCours = c;

  document.getElementById("mp-cr-client").textContent = c.client?.nom ?? "Anonyme";
  document.getElementById("mp-cr-total").textContent = fmt(c.total);
  document.getElementById("mp-cr-paye").textContent = fmt(c.totalPaye);
  document.getElementById("mp-cr-restant").textContent = fmt(c.soldeRestant);
  document.getElementById("mp-cr-montant").value = "";
  document.getElementById("mp-cr-note").value = "";
  document.getElementById("mp-cr-date").value = new Date().toISOString().slice(0, 10);

  const hist = document.getElementById("mp-cr-historique");
  if (c.paiements?.length) {
    hist.innerHTML = c.paiements.map(p => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="color:var(--ink-soft);">${
      // [FIX D] toDateObj() pour éviter crash Timestamp
      toDateObj(p.date).toLocaleDateString("fr-FR")
      }</span>
        <span style="font-weight:600;color:var(--green);font-family:'DM Mono',monospace;">${fmt(p.montant)}</span>
        ${p.note ? `<span style="color:var(--ink-muted);font-style:italic;">${escHtml(p.note)}</span>` : ""}
      </div>`).join("");
  } else {
    hist.innerHTML = `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;">Aucun paiement enregistré.</div>`;
  }

  document.getElementById("modal-paiement").classList.add("active");
  setTimeout(() => document.getElementById("mp-cr-montant").focus(), 100);
};

window.fermerModalPaiement = function fermerModalPaiement() {
  document.getElementById("modal-paiement").classList.remove("active");
  _creditEnCours = null;
};

window.enregistrerPaiement = async function enregistrerPaiement() {
  if (!_creditEnCours) return;
  const montant = parseFloat(document.getElementById("mp-cr-montant").value);
  const note = document.getElementById("mp-cr-note").value.trim();
  const dateStr = document.getElementById("mp-cr-date").value;

  if (!montant || montant <= 0) {
    toast("Saisis un montant valide.", "err"); return;
  }
  if (montant > _creditEnCours.soldeRestant + 0.01) {
    toast(`Le montant dépasse le solde restant (${fmt(_creditEnCours.soldeRestant)}).`, "err"); return;
  }

  loader(true);
  try {
    const paiementRef = db.collection("ventes").doc(_creditEnCours.id)
      .collection("paiements");

    await paiementRef.add({
      montant,
      note,
      dateStr,
      date: firebase.firestore.Timestamp.fromDate(new Date(dateStr + "T12:00:00")),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    const nouveauSolde = _creditEnCours.soldeRestant - montant;
    if (nouveauSolde <= 0.01) {
      await db.collection("ventes").doc(_creditEnCours.id).update({ solde: true });
      // [FIX A] Mettre à jour le cache global
      const idx = window.allVentes.findIndex(v => v.id === _creditEnCours.id);
      if (idx >= 0) window.allVentes[idx].solde = true;
      toast("✅ Paiement enregistré — Ardoise soldée ! 🎉");
    } else {
      toast(`✅ Paiement de ${fmt(montant)} enregistré. Reste : ${fmt(nouveauSolde)}`);
    }

    fermerModalPaiement();
    await chargerCredits();
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

window.marquerSolde = async function marquerSolde(ventId) {
  if (!confirm("Marquer cette ardoise comme entièrement soldée ?")) return;
  loader(true);
  try {
    const c = allCredits.find(x => x.id === ventId);
    if (c && c.soldeRestant > 0.01) {
      await db.collection("ventes").doc(ventId).collection("paiements").add({
        montant: c.soldeRestant,
        note: "Solde final",
        dateStr: new Date().toISOString().slice(0, 10),
        date: firebase.firestore.Timestamp.fromDate(new Date()),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    await db.collection("ventes").doc(ventId).update({ solde: true });
    // [FIX A] Sync cache global
    const idx = window.allVentes.findIndex(v => v.id === ventId);
    if (idx >= 0) window.allVentes[idx].solde = true;
    toast("✅ Ardoise soldée !");
    await chargerCredits();
  } catch (e) { toast("Erreur : " + e.message, "err"); }
  loader(false);
};

// ─────────────────────────────────────────────────────
//  MODAL DÉTAIL CRÉDIT
// ─────────────────────────────────────────────────────

window.ouvrirDetailCredit = function ouvrirDetailCredit(ventId) {
  const c = allCredits.find(x => x.id === ventId);
  if (!c) return;

  document.getElementById("modal-detail-title").textContent =
    `Ardoise — ${c.client?.nom ?? "Anonyme"}`;

  const lignesHtml = (c.lignes ?? []).map(l => `
    <tr>
      <td style="padding:6px 10px;">${escHtml(l.des ?? "—")}</td>
      <td style="padding:6px 10px;text-align:center;">${l.qte}</td>
      <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;">${Math.round(l.prix).toLocaleString("fr-FR")}</td>
      <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;">
        ${Math.round(l.qte * l.prix * (1 - (l.remise ?? 0) / 100)).toLocaleString("fr-FR")}
      </td>
    </tr>`).join("");

  const paiementsHtml = c.paiements?.length
    ? c.paiements.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;
             padding:8px 12px;background:var(--green-bg);border-radius:6px;margin-bottom:5px;">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--green);">+ ${fmt(p.montant)}</div>
            ${p.note ? `<div style="font-size:11px;color:var(--ink-muted);">${escHtml(p.note)}</div>` : ""}
          </div>
          <div style="font-size:11px;color:var(--ink-muted);">
            ${toDateObj(p.date).toLocaleDateString("fr-FR")}
          </div>
        </div>`).join("")
    : `<div style="font-size:12px;color:var(--ink-muted);font-style:italic;">Aucun paiement.</div>`;

  document.getElementById("modal-detail-body").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div style="background:var(--bg);border-radius:8px;padding:12px;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:5px;">Client</div>
        <div style="font-weight:600;">${escHtml(c.client?.nom ?? "—")}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${escHtml(c.client?.tel ?? "")}</div>
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:12px;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:5px;">Facture</div>
        <div style="font-weight:600;font-family:'DM Mono',monospace;">${escHtml(c.numero ?? "—")}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${fmtDate(c.date)}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      <thead><tr style="background:var(--bg);">
        <th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--ink-muted);">Article</th>
        <th style="padding:7px 10px;text-align:center;font-size:10px;color:var(--ink-muted);">Qté</th>
        <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--ink-muted);">P.U.</th>
        <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--ink-muted);">Total</th>
      </tr></thead>
      <tbody>${lignesHtml}</tbody>
    </table>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
      <div style="background:var(--bg);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--ink-muted);margin-bottom:4px;">TOTAL</div>
        <div style="font-weight:700;font-family:'DM Mono',monospace;">${fmt(c.total)}</div>
      </div>
      <div style="background:var(--green-bg);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--ink-muted);margin-bottom:4px;">PAYÉ</div>
        <div style="font-weight:700;color:var(--green);font-family:'DM Mono',monospace;">${fmt(c.totalPaye)}</div>
      </div>
      <div style="background:var(--red-bg);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--ink-muted);margin-bottom:4px;">RESTE</div>
        <div style="font-weight:700;color:var(--red);font-family:'DM Mono',monospace;">${c.solde ? "Soldé ✓" : fmt(c.soldeRestant)}</div>
      </div>
    </div>
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-muted);margin-bottom:8px;">Historique des paiements</div>
    ${paiementsHtml}
  `;

  document.getElementById("modal-print-btn").style.display = "none";
  document.getElementById("modal-pdf-btn").style.display = "none";
  document.getElementById("modal-detail").classList.add("active");
};

// ─────────────────────────────────────────────────────
//  EXPORT CSV CRÉDITS
// ─────────────────────────────────────────────────────

window.exporterCreditsCSV = function exporterCreditsCSV() {
  if (!allCredits.length) { toast("Aucune donnée.", "info"); return; }
  const rows = allCredits.map(c => ({
    "Numéro": c.numero ?? "",
    "Client": c.client?.nom ?? "",
    "Téléphone": c.client?.tel ?? "",
    "Total": c.total ?? 0,
    "Payé": c.totalPaye ?? 0,
    "Reste": c.soldeRestant ?? 0,
    "Statut": c.solde ? "Soldé" : "En cours",
    "Date vente": fmtDate(c.date),
  }));
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(";"),
    ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g, '""')}"`).join(";")),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `credits_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("✅ Export CSV crédits téléchargé !");
};
// ══════════════════════════════════════════════════════
//  print.js  —  FacturaPro
//  Impression native via window.print()
//  Génère un document HTML propre dans une iframe cachée
//  → Compatible imprimantes Bluetooth, mobiles anciens
//  → Idéal pour imprimer directement en boutique
// ══════════════════════════════════════════════════════

/**
 * Lance l'impression native du navigateur pour une vente.
 * Injecte un document HTML complet dans une iframe cachée,
 * adapté au format papier configuré (thermal 80mm / A5 / A4).
 *
 * @param {object} data       — objet vente complet (buildVenteData())
 * @param {object} entreprise — infos entreprise
 * @param {object} config     — config documents
 */
function imprimerDocument(data, entreprise, config) {
  const fmt  = config.format || "thermal";
  const dev  = config.devise || entreprise.devise || "F CFA";
  const pos  = config.devisePos || "after";

  const fmtAmt = (n) => {
    const s = Number(n || 0).toLocaleString("fr-FR");
    return pos === "before" ? `${dev} ${s}` : `${s} ${dev}`;
  };

  const typeLbl = { facture: "FACTURE", recu: "REÇU", devis: "DEVIS" };
  const pmodes  = {
    especes:      "Espèces",
    mobile_money: "Mobile Money",
    virement:     "Virement bancaire",
    cheque:       "Chèque",
    credit:       "À crédit",
  };

  const dateStr = data.date
    ? data.date.toLocaleDateString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  // ── CSS selon le format ──
  const paperCSS = {
    thermal: `
      @page { size: 80mm auto; margin: 3mm 4mm; }
      body   { max-width: 72mm; font-size: 9pt; }`,
    a5: `
      @page { size: A5 portrait; margin: 10mm; }
      body  { max-width: 128mm; font-size: 10pt; }`,
    a4: `
      @page { size: A4 portrait; margin: 15mm; }
      body  { max-width: 180mm; font-size: 11pt; }`,
  }[fmt] || `@page { size: 80mm auto; margin: 3mm 4mm; } body { max-width: 72mm; font-size: 9pt; }`;

  // ── Lignes articles ──
  const lignesRows = (data.lignes || []).map((l, i) => {
    const tot = l.qte * l.prix * (1 - (l.remise || 0) / 100);
    return `
      <tr class="${i % 2 === 0 ? "alt" : ""}">
        <td class="td-des">${escH(l.des || `Article ${i + 1}`)}</td>
        <td class="tc">${l.qte}</td>
        <td class="tr">${Number(l.prix).toLocaleString("fr-FR")}</td>
        ${config.showRef ? `<td class="tc">${l.remise > 0 ? l.remise + "%" : "—"}</td>` : ""}
        <td class="tr bold">${Number(tot).toLocaleString("fr-FR")}</td>
      </tr>`;
  }).join("");

  // ── Totaux intermédiaires ──
  let totsRows = "";
  if (data.remiseMt > 0 || data.applyTva) {
    totsRows += `
      <tr class="tot-line">
        <td colspan="${config.showRef ? "3" : "2"}" class="tr light">Sous-total HT</td>
        <td class="tr light">${fmtAmt(data.ht)}</td>
      </tr>`;
  }
  if (data.remiseMt > 0) {
    totsRows += `
      <tr class="tot-line">
        <td colspan="${config.showRef ? "3" : "2"}" class="tr red">Remise (${data.remise}%)</td>
        <td class="tr red">−${fmtAmt(data.remiseMt)}</td>
      </tr>`;
  }
  if (data.applyTva) {
    totsRows += `
      <tr class="tot-line">
        <td colspan="${config.showRef ? "3" : "2"}" class="tr light">TVA (${data.tvaRate}%)</td>
        <td class="tr light">${fmtAmt(data.tvaMt)}</td>
      </tr>`;
  }

  // ── Rendu monnaie ──
  let renduBlock = "";
  if (config.showRendu !== false && data.montantRecu > 0 && data.type !== "devis") {
    const rendu = data.montantRecu - data.total;
    renduBlock = `
      <div class="rendu-block">
        <div class="rendu-row">
          <span>Montant reçu</span>
          <span>${fmtAmt(data.montantRecu)}</span>
        </div>
        <div class="rendu-row ${rendu >= 0 ? "green" : "red"}">
          <span><strong>Rendu monnaie</strong></span>
          <span><strong>${fmtAmt(rendu)}</strong></span>
        </div>
      </div>`;
  }

  // ── Infos entreprise ──
  const logoHtml = (config.showLogo !== false && entreprise.logoUrl)
    ? `<img src="${entreprise.logoUrl}" class="logo" alt="Logo" onerror="this.style.display='none'">`
    : "";

  const companyHtml = config.showCompany !== false ? `
    <div class="company-name">${escH(entreprise.nom || "Mon Entreprise")}</div>
    ${entreprise.slogan ? `<div class="company-slogan">${escH(entreprise.slogan)}</div>` : ""}
    <div class="company-info">
      ${[
          [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
          [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
          entreprise.email,
          entreprise.web,
        ].filter(Boolean).map(l => `<div>${escH(l)}</div>`).join("")}
    </div>` : "";

  const fiscalHtml = (entreprise.rc || entreprise.nif) ? `
    <div class="fiscal">
      ${[entreprise.rc && `RC : ${entreprise.rc}`, entreprise.nif && `NIF : ${entreprise.nif}`]
         .filter(Boolean).join(" &nbsp;|&nbsp; ")}
    </div>` : "";

  // ── Signature ──
  const signHtml = config.showSign ? `
    <div class="signature-block">
      <div class="sig-line"></div>
      <div class="sig-label">Signature du vendeur</div>
    </div>` : "";

  // ── Colonne "Remise" dans le header ──
  const thRef = config.showRef ? `<th class="tc">Rem%</th>` : "";

  // ── Document HTML complet ──
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${typeLbl[data.type] || "Document"} ${data.numero || ""}</title>
  <style>
    /* ── RESET ── */
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }

    /* ── PAGE ── */
    ${paperCSS}

    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #1a1a1a;
      background: #fff;
      margin: 0 auto;
      line-height: 1.45;
    }

    /* ── EN-TÊTE ── */
    .header {
      text-align: center;
      padding-bottom: 5px;
      margin-bottom: 6px;
      border-bottom: 2px solid #b5622b;
    }
    .logo {
      max-width: 70px; max-height: 55px;
      object-fit: contain; margin-bottom: 4px;
      display: block; margin-left: auto; margin-right: auto;
    }
    .company-name {
      font-size: 1.25em; font-weight: 800;
      text-transform: uppercase; letter-spacing: .5px;
      color: #1a1a1a;
    }
    .company-slogan {
      font-size: .78em; font-style: italic; color: #666;
      margin-top: 1px;
    }
    .company-info div { font-size: .78em; color: #444; }
    .fiscal {
      font-size: .68em; color: #888;
      margin-top: 3px;
    }
    .header-custom {
      font-size: .78em; color: #666; margin-top: 4px;
      font-style: italic;
    }

    /* ── TYPE + NUMÉRO ── */
    .doc-header {
      text-align: center;
      margin: 8px 0 6px;
    }
    .doc-type {
      font-size: 1.5em; font-weight: 900;
      color: #b5622b; text-transform: uppercase;
      letter-spacing: 2px;
    }
    .doc-num  { font-size: .85em; color: #444; margin-top: 2px; }
    .doc-date { font-size: .78em; color: #888; margin-top: 1px; }

    /* ── CLIENT ── */
    .client-block {
      background: #f9f6f2;
      border-left: 3px solid #b5622b;
      padding: 5px 7px;
      margin: 6px 0;
      border-radius: 0 4px 4px 0;
    }
    .client-label {
      font-size: .65em; font-weight: 700;
      letter-spacing: 1.5px; text-transform: uppercase;
      color: #b5622b; margin-bottom: 2px;
    }
    .client-name { font-weight: 700; font-size: .9em; }
    .client-info { font-size: .78em; color: #555; }

    /* ── SÉPARATEUR ── */
    .sep {
      border: none; border-top: 1px dashed #ccc;
      margin: 6px 0;
    }

    /* ── TABLEAU ARTICLES ── */
    table.articles {
      width: 100%; border-collapse: collapse;
      margin: 4px 0;
    }
    table.articles thead tr {
      background: #1c1712; color: #fff;
    }
    table.articles thead th {
      padding: 4px 5px;
      font-size: .72em; font-weight: 700;
      text-transform: uppercase; letter-spacing: .5px;
    }
    table.articles td {
      padding: 4px 5px; font-size: .82em;
      border-bottom: 1px solid #ede8e0;
      vertical-align: middle;
    }
    table.articles tr.alt td { background: #faf7f3; }

    /* Alignements colonnes */
    .tc { text-align: center; }
    .tr { text-align: right; }
    .td-des { text-align: left; }
    .bold { font-weight: 700; }
    .light { color: #666; }
    .red   { color: #8b2020; }
    .green { color: #2a6644; }

    /* ── LIGNES TOTAUX (dans le tableau) ── */
    tr.tot-line td {
      padding: 3px 5px; font-size: .8em;
      border: none; background: #f5f0ea;
    }

    /* ── TOTAL FINAL ── */
    .total-block {
      background: #b5622b;
      color: #fff;
      padding: 6px 8px;
      display: flex; justify-content: space-between; align-items: center;
      margin: 4px 0;
      border-radius: 3px;
    }
    .total-label { font-weight: 800; font-size: 1em; letter-spacing: 1px; }
    .total-amount { font-weight: 900; font-size: 1.2em; }

    /* ── RENDU MONNAIE ── */
    .rendu-block {
      border: 1px solid #ddd; border-radius: 3px;
      overflow: hidden; margin: 4px 0;
    }
    .rendu-row {
      display: flex; justify-content: space-between;
      padding: 4px 8px; font-size: .82em;
      border-bottom: 1px solid #eee;
    }
    .rendu-row:last-child { border-bottom: none; }
    .rendu-row.green { background: #e8f4ee; color: #2a6644; }
    .rendu-row.red   { background: #faeaea; color: #8b2020; }

    /* ── PAIEMENT / NOTE ── */
    .paiement-line {
      font-size: .8em; color: #555;
      margin: 4px 0;
    }
    .note-block {
      font-size: .78em; color: #777; font-style: italic;
      margin: 4px 0; padding: 4px 6px;
      border-left: 2px solid #ddd;
    }

    /* ── SIGNATURE ── */
    .signature-block {
      margin-top: 14px; padding-top: 6px;
    }
    .sig-line {
      width: 45mm; height: 0;
      border-top: 1px solid #1a1a1a;
      margin-bottom: 3px;
    }
    .sig-label { font-size: .72em; color: #888; }

    /* ── PIED DE PAGE ── */
    .footer {
      margin-top: 10px; padding-top: 5px;
      border-top: 1px dashed #ccc;
      text-align: center;
    }
    .footer-thanks {
      font-weight: 700; font-size: .9em;
      color: #b5622b; margin-bottom: 3px;
    }
    .footer-legal {
      font-size: .68em; color: #999;
      line-height: 1.5;
    }
    .footer-brand {
      font-size: .6em; color: #ccc;
      margin-top: 5px;
    }

    /* ── MASQUER À L'ÉCRAN (iframe invisible) ── */
    @media screen { body { visibility: hidden; } }

    /* ── IMPRESSION ── */
    @media print {
      body        { visibility: visible; }
      * { -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>

  <!-- EN-TÊTE ENTREPRISE -->
  <div class="header">
    ${logoHtml}
    ${companyHtml}
    ${fiscalHtml}
    ${config.headerText ? `<div class="header-custom">${escH(config.headerText)}</div>` : ""}
  </div>

  <!-- TYPE + NUMÉRO -->
  <div class="doc-header">
    <div class="doc-type">${typeLbl[data.type] || "DOCUMENT"}</div>
    <div class="doc-num">N° ${escH(data.numero || "")}</div>
    ${config.showDate !== false ? `<div class="doc-date">${dateStr}</div>` : ""}
  </div>

  <hr class="sep">

  <!-- CLIENT -->
  ${(data.client?.nom || data.client?.tel) ? `
  <div class="client-block">
    <div class="client-label">Client</div>
    ${data.client.nom     ? `<div class="client-name">${escH(data.client.nom)}</div>`     : ""}
    ${data.client.tel     ? `<div class="client-info">Tél : ${escH(data.client.tel)}</div>` : ""}
    ${data.client.email   ? `<div class="client-info">${escH(data.client.email)}</div>`   : ""}
    ${data.client.adresse ? `<div class="client-info">${escH(data.client.adresse)}</div>` : ""}
  </div>` : ""}

  <!-- TABLEAU ARTICLES -->
  <table class="articles">
    <thead>
      <tr>
        <th class="td-des">Désignation</th>
        <th class="tc">Qté</th>
        <th class="tr">P.U.</th>
        ${thRef}
        <th class="tr">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lignesRows}
      ${totsRows}
    </tbody>
  </table>

  <!-- TOTAL FINAL -->
  <div class="total-block">
    <span class="total-label">TOTAL ${data.applyTva ? "TTC" : ""}</span>
    <span class="total-amount">${fmtAmt(data.total)}</span>
  </div>

  <!-- RENDU MONNAIE -->
  ${renduBlock}

  <!-- MODE DE PAIEMENT -->
  ${data.paiement && data.type !== "devis"
    ? `<div class="paiement-line">💳 Paiement : <strong>${pmodes[data.paiement] || data.paiement}</strong></div>`
    : ""}

  <!-- NOTE -->
  ${data.note ? `<div class="note-block">Note : ${escH(data.note)}</div>` : ""}

  <!-- SIGNATURE -->
  ${signHtml}

  <!-- PIED DE PAGE -->
  <div class="footer">
    ${config.footerThanks ? `<div class="footer-thanks">${escH(config.footerThanks)}</div>` : ""}
    ${config.footerLegal  ? `<div class="footer-legal">${escH(config.footerLegal).replace(/\n/g,"<br>")}</div>` : ""}
    <div class="footer-brand">FacturaPro</div>
  </div>

</body>
</html>`;

  // ── Injection dans une iframe cachée ──
  // On réutilise la même iframe pour éviter les fuites mémoire
  let iframe = document.getElementById("print-iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "print-iframe";
    Object.assign(iframe.style, {
      position: "fixed", top: "-9999px", left: "-9999px",
      width: "1px", height: "1px", border: "none",
    });
    document.body.appendChild(iframe);
  }

  const iDoc = iframe.contentWindow.document;
  iDoc.open();
  iDoc.write(html);
  iDoc.close();

  // On attend que les ressources (logo…) soient chargées
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 300);
  };

  // Fallback si onload ne se déclenche pas (doc déjà chargé)
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) { console.warn("print fallback:", e); }
  }, 600);
}

// ── Petit helper HTML escape (dupliqué ici pour autonomie du fichier) ──
function escH(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

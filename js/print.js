// ══════════════════════════════════════════════════════
//  print.js  —  FacturaPro  v5
//
//  FIXES v5 :
//  [1] BUG MONTANTS : toLocaleString("fr-FR") produit
//      "\u202F" (espace fine insécable) que certains
//      navigateurs/imprimantes n'affichent pas bien.
//      SOLUTION : formatage manuel ASCII uniquement.
//  [2] Design repris du template Blade :
//      - inv-box gris pour N°/date/client
//      - thead fond noir (#111) texte blanc
//      - totaux avec bordure + fond selon type
//      - rendu monnaie en vert (.t-rendu)
//      - visas (signature vendeur)
//  [3] Logo chargé depuis URL (Firebase Storage)
// ══════════════════════════════════════════════════════

/**
 * Formate un nombre sans toLocaleString pour éviter
 * les caractères unicode non-ASCII (espace fine \u202F)
 * qui cassent certaines imprimantes thermiques et navigateurs.
 */
function _pFmtNum(n) {
  return String(Math.round(Number(n ?? 0)))
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u0020");
}

/**
 * Lance l'impression native (window.print()) via une iframe cachée.
 * Design inspiré du template Blade (thermique / A5 / A4).
 *
 * @param {object} data       — objet vente, data.date = Date JS
 * @param {object} entreprise — infos entreprise
 * @param {object} config     — config documents
 */
function imprimerDocument(data, entreprise, config) {
  const escH = window.escHtml;

  const fmt_   = config.format    || "thermal";
  const dev    = config.devise    || entreprise.devise || "F CFA";
  const pos    = config.devisePos || "after";

  // Formatage montant — ASCII uniquement, pas de \u202F
  const fmtAmt = n => {
    const s = _pFmtNum(n);
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

  // Date sécurisée
  const dateObj = data.date instanceof Date ? data.date : toDateObj(data.date);
  const dateStr = [
    String(dateObj.getDate()).padStart(2, "0"),
    String(dateObj.getMonth() + 1).padStart(2, "0"),
    dateObj.getFullYear(),
  ].join("/") + " " +
    String(dateObj.getHours()).padStart(2, "0") + ":" +
    String(dateObj.getMinutes()).padStart(2, "0");

  // CSS @page selon format
  const paperCSS = {
    thermal: `@page { size: 80mm 297mm; margin: 2mm 3mm; } body { max-width: 74mm; font-size: 8px; }`,
    a5:      `@page { size: A5 portrait; margin: 8mm; }    body { max-width: 140mm; font-size: 10px; }`,
    a4:      `@page { size: A4 portrait; margin: 12mm; }   body { max-width: 186mm; font-size: 11px; }`,
  }[fmt_] ?? `@page { size: 80mm 297mm; margin: 2mm 3mm; } body { max-width: 74mm; font-size: 8px; }`;

  // Guard lignes
  const lignes = Array.isArray(data.lignes) ? data.lignes : [];

  // Logo
  const logoHtml = (config.showLogo !== false && entreprise.logoUrl)
    ? `<img src="${escH(entreprise.logoUrl)}" class="logo" alt="Logo"
           onerror="this.style.display='none'">`
    : "";

  // Infos entreprise
  const companyHtml = (config.showCompany !== false) ? `
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

  const fiscalStr = [
    entreprise.rc  && `RC : ${entreprise.rc}`,
    entreprise.nif && `NIF : ${entreprise.nif}`,
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");

  // Lignes articles HTML
  const thRef = config.showRef ? `<th class="tc">Rem%</th>` : "";
  const lignesRows = lignes.map((l, i) => {
    const tot = l.qte * l.prix * (1 - (l.remise ?? 0) / 100);
    return `
      <tr class="${i % 2 === 0 ? "" : "even"}">
        <td>${escH(l.des || `Article ${i + 1}`)}</td>
        <td class="tc">${l.qte}</td>
        <td class="tr">${_pFmtNum(l.prix)}</td>
        ${config.showRef ? `<td class="tc">${(l.remise ?? 0) > 0 ? l.remise + "%" : "—"}</td>` : ""}
        <td class="tr bold">${_pFmtNum(tot)}</td>
      </tr>`;
  }).join("");

  // Totaux intermédiaires
  const cols = config.showRef ? "3" : "2";
  let totsRows = "";
  if ((data.remiseMt ?? 0) > 0 || data.applyTva) {
    totsRows += `<tr class="t-row"><td colspan="${cols}" class="t-label">Total HT</td><td class="tr">${fmtAmt(data.ht)}</td></tr>`;
  }
  if ((data.remiseMt ?? 0) > 0) {
    totsRows += `<tr class="t-row"><td colspan="${cols}" class="t-label t-rouge">Remise (${data.remise}%)</td><td class="tr t-rouge">&minus;${fmtAmt(data.remiseMt)}</td></tr>`;
  }
  if (data.applyTva) {
    totsRows += `<tr class="t-row"><td colspan="${cols}" class="t-label">TVA (${data.tvaRate}%)</td><td class="tr">${fmtAmt(data.tvaMt)}</td></tr>`;
  }

  // Rendu monnaie
  const showRendu = config.showRendu !== false && (data.montantRecu ?? 0) > 0 && data.type !== "devis";
  let renduRows = "";
  if (showRendu) {
    const rendu = (data.montantRecu ?? 0) - (data.total ?? 0);
    renduRows = `
      <tr class="t-recu">
        <td colspan="${cols}" class="t-label">Montant reçu</td>
        <td class="tr">${fmtAmt(data.montantRecu)}</td>
      </tr>
      <tr class="t-rendu">
        <td colspan="${cols}">Rendu monnaie</td>
        <td class="tr bold">${fmtAmt(rendu)}</td>
      </tr>`;
  }

  // Visa vendeur
  const signHtml = config.showSign ? `
    <div class="visas">
      <div class="visa-cell">
        <div class="visa-line"></div>
        <div class="visa-lbl">Signature vendeur</div>
      </div>
    </div>` : "";

  // ── Document HTML complet ──
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${typeLbl[data.type] ?? "Document"} ${escH(data.numero ?? "")}</title>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    ${paperCSS}
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #1a1a1a;
      background: #fff;
      margin: 0 auto;
      line-height: 1.35;
    }

    /* ── HEADER ── */
    .header {
      text-align: center;
      padding-bottom: 2mm;
      margin-bottom: 2mm;
      border-bottom: 2px solid #111;
    }
    .logo {
      max-width: 55px; max-height: 55px;
      object-fit: contain;
      display: block;
      margin: 0 auto 1.5mm;
    }
    .company-name {
      font-size: 1.25em; font-weight: 800;
      text-transform: uppercase; letter-spacing: .5px;
    }
    .company-slogan {
      font-size: .8em; font-style: italic; color: #666; margin-top: 1px;
    }
    .company-info div { font-size: .78em; color: #555; }
    .header-custom {
      font-size: .75em; color: #777; margin-top: 1.5mm; font-style: italic;
    }

    /* ── INV-BOX (inspiré .inv-box du Blade) ── */
    .inv-box {
      background: #f4f4f4;
      padding: 2mm;
      margin: 2mm 0;
      border-radius: 1mm;
    }
    .inv-title {
      text-align: center;
      font-size: 1.1em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 1.5mm;
    }
    .inv-row {
      display: flex;
      justify-content: space-between;
      padding: .4mm 0;
      font-size: .9em;
    }
    .inv-label { color: #666; }
    .inv-value { font-weight: 600; }

    /* ── TABLE ARTICLES ── */
    table { width: 100%; border-collapse: collapse; margin: 2mm 0; }
    thead th {
      background: #111;
      color: #fff;
      padding: 1.5mm;
      font-size: .78em;
      text-transform: uppercase;
      letter-spacing: .3px;
    }
    tbody td {
      padding: 1mm 1.5mm;
      border-bottom: 1px solid #e5e5e5;
      font-size: .92em;
    }
    tbody tr.even td { background: #fafafa; }
    .tc { text-align: center; }
    .tr { text-align: right; }
    .bold { font-weight: 700; }

    /* ── TOTAUX (inspiré .totals du Blade) ── */
    .totals {
      border: 1px solid #111;
      border-radius: 1mm;
      overflow: hidden;
      margin: 2mm 0;
      width: 100%;
      border-collapse: collapse;
    }
    .totals td {
      padding: 1mm 2mm;
      font-size: .9em;
      border-bottom: 1px solid #e5e5e5;
    }
    .totals tr:last-child td { border-bottom: none; }
    .t-label { color: #666; }
    .t-row td { background: #fff; }
    /* Total final — fond noir */
    .t-final td {
      background: #111;
      color: #fff;
      font-weight: 700;
      font-size: 1.05em;
    }
    .t-final .t-label { color: rgba(255,255,255,.8); }
    /* Reçu — fond gris */
    .t-recu td { background: #f5f5f5; }
    /* Rendu — fond vert clair */
    .t-rendu td { background: #e8f5e9; color: #2e7d32; font-weight: 700; }
    /* Rouge remise */
    .t-rouge { color: #8b2020; }

    /* ── PAIEMENT / NOTE ── */
    .paiement-line {
      font-size: .82em; color: #444; margin: 1.5mm 0;
    }
    .note-block {
      font-size: .78em; color: #777; font-style: italic;
      margin: 1.5mm 0; padding: .5mm 1mm;
      border-left: 2px solid #ddd;
    }

    /* ── VISAS (inspiré .visas du Blade) ── */
    .visas {
      display: table;
      width: 100%;
      margin-top: 3mm;
      border-top: 1px solid #ddd;
      padding-top: 2mm;
    }
    .visa-cell {
      display: table-cell;
      width: 50%;
      text-align: center;
    }
    .visa-line {
      min-height: 8mm;
      border-bottom: 1px solid #333;
      margin: 0 auto 1mm;
      width: 85%;
    }
    .visa-lbl {
      font-size: .7em; color: #666; text-transform: uppercase;
    }

    /* ── FOOTER ── */
    .footer {
      margin-top: 2mm;
      padding-top: 1.5mm;
      border-top: 1px dashed #ccc;
      text-align: center;
    }
    .f-thanks { font-weight: 700; font-size: .95em; color: #b5622b; margin-bottom: 1mm; }
    .f-note   { font-size: .7em; color: #666; line-height: 1.3; }
    .f-fiscal { font-size: .65em; color: #999; margin-top: 1mm; }
    .f-brand  { font-size: .6em; color: #ccc; margin-top: 1mm; }

    /* ── PRINT ONLY ── */
    @media screen { body { visibility: hidden; } }
    @media print  {
      body { visibility: visible; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    ${logoHtml}
    ${companyHtml}
    ${config.headerText ? `<div class="header-custom">${escH(config.headerText)}</div>` : ""}
  </div>

  <!-- INV-BOX : type, numéro, date, client -->
  <div class="inv-box">
    <div class="inv-title">${typeLbl[data.type] ?? "DOCUMENT"}</div>
    <div class="inv-row">
      <span class="inv-label">N° Facture</span>
      <span class="inv-value">${escH(data.numero ?? "")}</span>
    </div>
    ${config.showDate !== false ? `
    <div class="inv-row">
      <span class="inv-label">Date</span>
      <span class="inv-value">${dateStr}</span>
    </div>` : ""}
    ${(data.client?.nom) ? `
    <div class="inv-row">
      <span class="inv-label">Client</span>
      <span class="inv-value">${escH(data.client.nom)}</span>
    </div>` : ""}
    ${(data.client?.tel) ? `
    <div class="inv-row">
      <span class="inv-label">Tél.</span>
      <span class="inv-value">${escH(data.client.tel)}</span>
    </div>` : ""}
    ${(data.client?.email) ? `
    <div class="inv-row">
      <span class="inv-label">Email</span>
      <span class="inv-value">${escH(data.client.email)}</span>
    </div>` : ""}
    ${(data.client?.adresse) ? `
    <div class="inv-row">
      <span class="inv-label">Adresse</span>
      <span class="inv-value">${escH(data.client.adresse)}</span>
    </div>` : ""}
  </div>

  <!-- TABLEAU ARTICLES -->
  <table>
    <thead>
      <tr>
        <th>Désignation</th>
        <th class="tc">Qté</th>
        <th class="tr">P.U.</th>
        ${thRef}
        <th class="tr">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lignesRows}
    </tbody>
  </table>

  <!-- TOTAUX -->
  <table class="totals">
    ${totsRows}
    <tr class="t-final">
      <td class="t-label" colspan="${cols}">TOTAL ${data.applyTva ? "TTC" : ""}</td>
      <td class="tr">${fmtAmt(data.total)}</td>
    </tr>
    ${renduRows}
  </table>

  <!-- PAIEMENT -->
  ${data.paiement && data.type !== "devis"
    ? `<div class="paiement-line">💳 Paiement : <strong>${pmodes[data.paiement] ?? escH(data.paiement)}</strong></div>`
    : ""}

  <!-- NOTE -->
  ${data.note ? `<div class="note-block">Note : ${escH(data.note)}</div>` : ""}

  <!-- VISAS -->
  ${signHtml}

  <!-- FOOTER -->
  <div class="footer">
    ${config.footerThanks ? `<div class="f-thanks">${escH(config.footerThanks)}</div>` : ""}
    ${config.footerLegal  ? `<div class="f-note">${escH(config.footerLegal).replace(/\n/g,"<br>")}</div>` : ""}
    ${fiscalStr ? `<div class="f-fiscal">${fiscalStr}</div>` : ""}
    <div class="f-brand">FacturaPro</div>
  </div>

</body>
</html>`;

  // ── Injection dans iframe cachée ──
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

  iframe.onload = () => {
    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
      catch(e) { console.warn("print onload:", e); }
    }, 350);
  };
  // Fallback
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch(e) { console.warn("print fallback:", e); }
  }, 750);
}
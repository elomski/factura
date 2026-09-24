// ══════════════════════════════════════════════════════
//  print.js  —  FacturaPro  v6
//
//  REFONTE COMPLÈTE v6 :
//  Mise en page identique à pdf.js pour une vraie
//  similitude entre impression et PDF :
//  - Même couleurs (cuivre #B5622B, fond sombre #0F1726)
//  - Même structure : logo+entreprise | filet cuivre |
//    titre+badge | infos doc+client | tableau | totaux |
//    arrêté en lettres | signature+cachet | footer
//  - Format adapté selon config.format (thermal/a5/a4)
//  - Signature et cachet depuis URL (signatureUrl/cachetUrl)
//  - Arrêté en toutes lettres (même fonction que pdf.js)
//  - Colonne REM masquée si aucune remise par article
// ══════════════════════════════════════════════════════

"use strict";

/* ─── Formatage montant sans caractères unicode ─── */
function _pFmtNum(n) {
  return String(Math.round(Number(n ?? 0)))
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u0020");
}

/* ─── Nombre en lettres (identique à pdf.js) ─── */
function _pNombreEnLettres(n) {
  n = Math.round(Math.abs(n ?? 0));
  if (n === 0) return "zéro";
  const U = ["","un","deux","trois","quatre","cinq","six","sept","huit","neuf",
             "dix","onze","douze","treize","quatorze","quinze","seize","dix-sept",
             "dix-huit","dix-neuf"];
  const D = ["","","vingt","trente","quarante","cinquante","soixante",
             "soixante","quatre-vingt","quatre-vingt"];
  function grp(g) {
    if (g === 0) return "";
    if (g < 20)  return U[g];
    const d = Math.floor(g / 10), u = g % 10;
    if (d === 7 || d === 9) return D[d] + (u === 1 && d !== 9 ? "-et-" : "-") + U[u + 10 - (d === 7 ? 0 : 0)];
    const join = u === 1 && d !== 8 ? "-et-" : (u ? "-" : "");
    const tens = D[d] + (d === 8 && u === 0 ? "s" : "");
    return u ? tens + join + U[u] : tens;
  }
  let s = "", r = n;
  if (r >= 1000000000) { const b = Math.floor(r/1000000000); s += grp(b) + " milliard" + (b>1?"s":"") + " "; r %= 1000000000; }
  if (r >= 1000000)    { const m = Math.floor(r/1000000);    s += grp(m) + " million" + (m>1?"s":"") + " ";    r %= 1000000; }
  if (r >= 1000) {
    const k = Math.floor(r/1000);
    s += (k === 1 ? "" : grp(k) + " ") + "mille ";
    r %= 1000;
  }
  if (r >= 100) {
    const c = Math.floor(r/100);
    s += (c === 1 ? "" : grp(c) + " ") + "cent" + (c > 1 && r % 100 === 0 ? "s" : "") + " ";
    r %= 100;
  }
  if (r > 0) s += grp(r);
  return s.trim().replace(/-$/, "").replace(/\s+/g," ");
}

/**
 * Lance l'impression via une iframe cachée.
 * Mise en page identique au pdf.js (mêmes sections, mêmes couleurs).
 */
function imprimerDocument(data, entreprise, config) {
  const escH = window.escHtml ?? (s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]));

  const fmt   = config.format ?? "thermal";
  const isTh  = fmt === "thermal";
  const isA5  = fmt === "a5";
  const isA4  = fmt === "a4";
  const dev   = config.devise ?? entreprise.devise ?? "F CFA";
  const pos   = config.devisePos ?? "after";

  const fmtAmt = n => {
    const s = _pFmtNum(n);
    return pos === "before" ? `${dev}\u00A0${s}` : `${s}\u00A0${dev}`;
  };

  /* ── Colonne REM : masquée si aucune remise individuelle ── */
  const lignes = Array.isArray(data.lignes) ? data.lignes : [];
  const hasAnyRemiseLigne = lignes.some(l => (l.remise ?? 0) > 0);
  const showRem = (config.showRef !== false) && hasAnyRemiseLigne;

  const typeLbl  = { facture:"FACTURE", recu:"REÇU", devis:"DEVIS" };
  const typeLabel = typeLbl[data.type] ?? "DOCUMENT";

  /* ── Couleur badge type (identique à pdf.js) ── */
  const typeColor = data.type === "recu"  ? "#15803d" :
                    data.type === "devis" ? "#a1780c" : "#1e3a8a";

  const pmodes = {
    especes:"Espèces", mobile_money:"Mobile Money",
    virement:"Virement bancaire", cheque:"Chèque", credit:"À crédit",
  };

  /* ── Date ── */
  const dateObj = data.date instanceof Date ? data.date : toDateObj(data.date);
  const pad = n => String(n).padStart(2,"0");
  const dateStr = `${pad(dateObj.getDate())}/${pad(dateObj.getMonth()+1)}/${dateObj.getFullYear()} `
                + `${pad(dateObj.getHours())}h${pad(dateObj.getMinutes())}`;

  /* ── CSS @page selon format ── */
  const paperCSS = isTh
    ? `@page{size:80mm 297mm;margin:2mm 3mm;} body{max-width:74mm;font-size:8px;}`
    : isA5
    ? `@page{size:A5 portrait;margin:8mm;}    body{max-width:149mm;font-size:9.5px;}`
    : `@page{size:A4 portrait;margin:12mm;}   body{max-width:210mm;font-size:10.5px;}`;

  /* ── Logo ── */
  const logoHtml = (config.showLogo !== false && entreprise.logoUrl)
    ? `<img src="${escH(entreprise.logoUrl)}" class="logo" alt="Logo" onerror="this.style.display='none'">`
    : "";

  /* ── Infos entreprise ── */
  const hasLogo = config.showLogo !== false && !!entreprise.logoUrl;
  const showCompany = config.showCompany !== false;

  const infosLignes = [
    [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
    [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
    entreprise.email,
    entreprise.web,
  ].filter(Boolean);

  const companyHtml = showCompany ? (isTh ? `
    <div class="company-th">
      <div class="company-name">${escH(entreprise.nom ?? "Mon Entreprise")}</div>
      ${entreprise.slogan ? `<div class="company-slogan">${escH(entreprise.slogan)}</div>` : ""}
      ${infosLignes.map(l=>`<div class="company-info">${escH(l)}</div>`).join("")}
    </div>` : `
    <div class="company-block${hasLogo ? " has-logo" : ""}">
      ${hasLogo ? `<div class="logo-wrap">${logoHtml}</div>` : ""}
      <div class="company-text">
        <div class="company-name">${escH(entreprise.nom ?? "Mon Entreprise")}</div>
        ${entreprise.slogan ? `<div class="company-slogan">${escH(entreprise.slogan)}</div>` : ""}
        ${infosLignes.map(l=>`<div class="company-info">${escH(l)}</div>`).join("")}
      </div>
    </div>`) : "";

  /* ── Infos document + client (2 colonnes sur A5/A4) ── */
  const clientLignes = [
    data.client?.nom     && `<div class="client-name">${escH(data.client.nom)}</div>`,
    data.client?.tel     && `<div>Tél : ${escH(data.client.tel)}</div>`,
    data.client?.email   && `<div>${escH(data.client.email)}</div>`,
    data.client?.adresse && `<div>${escH(data.client.adresse)}</div>`,
  ].filter(Boolean).join("");

  const hasClient = !!(data.client?.nom || data.client?.tel || data.client?.email || data.client?.adresse);

  const infoBoxHtml = isTh ? `
    <div class="inv-box-th">
      <div class="inv-title-th">${typeLabel}</div>
      <div class="inv-row"><span class="inv-lbl">N° Facture</span><span class="inv-val">${escH(data.numero ?? "")}</span></div>
      ${config.showDate !== false ? `<div class="inv-row"><span class="inv-lbl">Date</span><span class="inv-val">${dateStr}</span></div>` : ""}
      <div class="inv-row"><span class="inv-lbl">Paiement</span><span class="inv-val">${pmodes[data.paiement] ?? escH(data.paiement ?? "")}</span></div>
      ${hasClient ? `<div class="inv-row"><span class="inv-lbl">Client</span><span class="inv-val">${escH(data.client?.nom ?? "")}</span></div>` : ""}
      ${data.client?.tel ? `<div class="inv-row"><span class="inv-lbl">Tél</span><span class="inv-val">${escH(data.client.tel)}</span></div>` : ""}
    </div>` : `
    <div class="doc-meta">
      <div class="doc-title-row">
        <div>
          <div class="doc-title">${typeLabel}</div>
          <div class="doc-num">N° ${escH(data.numero ?? "")}</div>
        </div>
        <div class="doc-badge" style="background:${typeColor}">${typeLabel}</div>
      </div>
      <div class="meta-cols">
        ${hasClient ? `
        <div class="meta-col client-col">
          <div class="meta-col-label">FACTURER À</div>
          ${clientLignes}
        </div>` : ""}
        <div class="meta-col info-col${!hasClient ? " full-width" : ""}">
          <div class="meta-col-label">INFORMATIONS</div>
          <div class="info-row"><span class="info-lbl">Date</span><span class="info-val">${dateStr}</span></div>
          <div class="info-row"><span class="info-lbl">N° Facture</span><span class="info-val">${escH(data.numero ?? "")}</span></div>
          <div class="info-row"><span class="info-lbl">Paiement</span><span class="info-val">${pmodes[data.paiement] ?? escH(data.paiement ?? "")}</span></div>
        </div>
      </div>
    </div>`;

  /* ── Lignes tableau ── */
  const lignesRows = lignes.map((l, i) => {
    const tot = l.qte * l.prix * (1 - (l.remise ?? 0) / 100);
    return `<tr class="${i%2===0?"":"even"}">
      <td>${escH(l.des || `Article ${i+1}`)}</td>
      <td class="tc">${l.qte}</td>
      <td class="tr">${_pFmtNum(l.prix)}</td>
      ${showRem ? `<td class="tc">${(l.remise??0)>0 ? l.remise+"%" : ""}</td>` : ""}
      <td class="tr bold">${_pFmtNum(tot)}</td>
    </tr>`;
  }).join("");

  /* ── Totaux ── */
  const colspan = showRem ? "3" : "2";
  let totsRows = "";
  if ((data.remiseMt ?? 0) > 0 || data.applyTva) {
    totsRows += `<tr class="t-row"><td colspan="${colspan}" class="t-lbl">Sous-total HT</td><td class="tr">${fmtAmt(data.ht)}</td></tr>`;
  }
  if ((data.remiseMt ?? 0) > 0) {
    totsRows += `<tr class="t-row"><td colspan="${colspan}" class="t-lbl rouge">Remise ${data.remise}%</td><td class="tr rouge">- ${fmtAmt(data.remiseMt)}</td></tr>`;
  }
  if (data.applyTva) {
    totsRows += `<tr class="t-row"><td colspan="${colspan}" class="t-lbl">TVA ${data.tvaRate}%</td><td class="tr">${fmtAmt(data.tvaMt)}</td></tr>`;
  }

  const showRendu = config.showRendu !== false && (data.montantRecu ?? 0) > 0 && data.type !== "devis";
  let renduRows = "";
  if (showRendu) {
    const rendu = (data.montantRecu ?? 0) - (data.total ?? 0);
    renduRows = `
      <tr class="t-recu"><td colspan="${colspan}" class="t-lbl">Montant reçu</td><td class="tr">${fmtAmt(data.montantRecu)}</td></tr>
      <tr class="t-rendu"><td colspan="${colspan}">Rendu monnaie</td><td class="tr bold">${fmtAmt(rendu)}</td></tr>`;
  }

  /* ── Arrêté en lettres ── */
  const lettresTxt = `Arrêté à la somme de : ${_pNombreEnLettres(data.total ?? 0)} francs CFA`;

  /* ── Signature + cachet (2 blocs côte à côte, identique à pdf.js) ── */
  let signHtml = "";
  if (config.showSign && !isTh) {
    const sigImgHtml = config.signatureUrl
      ? `<img src="${escH(config.signatureUrl)}" class="sign-img" alt="Signature" onerror="this.style.display='none'">`
      : `<div class="sign-line"></div>`;
    const cachetImgHtml = config.cachetUrl
      ? `<img src="${escH(config.cachetUrl)}" class="cachet-img" alt="Cachet" onerror="this.style.display='none'">`
      : `<div class="sign-line"></div>`;
    signHtml = `
    <div class="sign-row">
      <div class="sign-bloc">
        <div class="sign-lbl">SIGNATURE VENDEUR</div>
        <div class="sign-content">${sigImgHtml}</div>
      </div>
      <div class="sign-bloc">
        <div class="sign-lbl">CACHET DE LA SOCIÉTÉ</div>
        <div class="sign-content">${cachetImgHtml}</div>
      </div>
    </div>`;
  } else if (config.showSign && isTh) {
    const sigImgHtml = config.signatureUrl
      ? `<img src="${escH(config.signatureUrl)}" class="sign-img-th" alt="Signature" onerror="this.style.display='none'">`
      : `<div class="sign-line-th"></div>`;
    signHtml = `
    <div class="sign-th">
      <div class="sign-lbl">SIGNATURE VENDEUR</div>
      ${sigImgHtml}
    </div>`;
  }

  /* ── Footer ── */
  const fiscalStr = [
    entreprise.rc  && `RC : ${entreprise.rc}`,
    entreprise.nif && `NIF : ${entreprise.nif}`,
  ].filter(Boolean).join(" | ");

  const footerHtml = `
    <div class="footer">
      <div class="footer-line"></div>
      ${config.footerThanks ? `<div class="f-thanks">${escH(config.footerThanks)}</div>` : ""}
      ${config.footerLegal  ? `<div class="f-note">${escH(config.footerLegal)}</div>` : ""}
      ${fiscalStr ? `<div class="f-fiscal">${fiscalStr}</div>` : ""}
      <div class="f-brand">FacturaPro</div>
    </div>`;

  /* ── HTML complet ── */
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${typeLabel} ${escH(data.numero ?? "")}</title>
<style>
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
${paperCSS}
body {
  font-family: Arial, Helvetica, sans-serif;
  color: #0F1726;
  background: #fff;
  margin: 0 auto;
  line-height: 1.35;
}

/* ══ HEADER ENTREPRISE ══ */
.company-block {
  display: flex;
  align-items: flex-start;
  gap: 3mm;
  margin-bottom: 2mm;
}
.company-block.has-logo .logo-wrap { flex-shrink: 0; }
.logo { max-width: 14mm; max-height: 14mm; object-fit: contain; display: block; }
.company-text { flex: 1; }
.company-name { font-size: 1.25em; font-weight: 800; color: #0F1726; }
.company-slogan { font-size: .78em; font-style: italic; color: #B5622B; margin-top: 1px; }
.company-info { font-size: .75em; color: #64748b; margin-top: 1px; }

/* Thermique : centré */
.company-th { text-align: center; margin-bottom: 1.5mm; }
.company-th .company-name { font-size: 1.1em; }

/* ── Filet cuivre double (identique pdf.js) ── */
.filet-cuivre {
  border-top: 0.6px solid #B5622B;
  margin: 2mm 0 0;
  position: relative;
}
.filet-cuivre::after {
  content: '';
  display: block;
  border-top: 0.15px solid #e2e8f0;
  margin-top: 1.2px;
}

/* ══ INFOS DOCUMENT (A5/A4) ══ */
.doc-meta { margin: 3mm 0 2mm; }

.doc-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2mm;
}
.doc-title {
  font-size: 1.9em;
  font-weight: 800;
  color: #0F1726;
  letter-spacing: -0.5px;
}
.doc-num { font-size: .78em; color: #64748b; margin-top: 1px; }
.doc-badge {
  color: #fff;
  font-size: .65em;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  letter-spacing: 1px;
  text-transform: uppercase;
  white-space: nowrap;
  align-self: flex-start;
  margin-top: 2px;
}

.meta-cols {
  display: flex;
  gap: 3mm;
  margin-top: 1mm;
}
.meta-col {
  flex: 1;
  border: 1px solid #e2e8f0;
  border-radius: 2mm;
  padding: 2mm 2.5mm;
  font-size: .78em;
}
.meta-col.full-width { flex: 0 0 48%; margin-left: auto; }
.meta-col-label {
  font-size: .7em;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 1.5mm;
  background: #f8fafc;
  margin: -2mm -2.5mm 1.5mm;
  padding: 1mm 2.5mm;
  border-radius: 2mm 2mm 0 0;
  border-bottom: 1px solid #e2e8f0;
}
.client-name { font-weight: 700; color: #0F1726; font-size: 1.05em; margin-bottom: 1px; }
.meta-col div { color: #475569; line-height: 1.6; }

.info-row { display: flex; justify-content: space-between; padding: 0.5mm 0; border-bottom: 1px solid #f1f5f9; }
.info-row:last-child { border-bottom: none; }
.info-lbl { color: #64748b; }
.info-val { font-weight: 600; color: #0F1726; }

/* Thermique : inv-box */
.inv-box-th {
  background: #f8fafc;
  border-radius: 1mm;
  padding: 1.5mm;
  margin: 1.5mm 0;
  font-size: .82em;
}
.inv-title-th {
  text-align: center;
  font-weight: 700;
  font-size: 1.05em;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 1mm;
}
.inv-row { display: flex; justify-content: space-between; padding: .3mm 0; }
.inv-lbl { color: #64748b; }
.inv-val { font-weight: 600; }

/* ══ TABLEAU ARTICLES ══ */
table { width: 100%; border-collapse: collapse; margin: 2mm 0; }
thead th {
  background: #0F1726;
  color: #fff;
  padding: ${isA4 ? "2mm 2.5mm" : "1.5mm 1.5mm"};
  font-size: ${isA4 ? ".75em" : ".7em"};
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .4px;
}
tbody td {
  padding: ${isA4 ? "1.5mm 2.5mm" : "1mm 1.5mm"};
  border-bottom: 1px solid #e2e8f0;
  font-size: ${isA4 ? ".88em" : ".82em"};
  color: #0F1726;
}
tbody tr.even td { background: #f8fafc; }
.tc { text-align: center; }
.tr { text-align: right; }
.bold { font-weight: 700; }

/* ══ TOTAUX ══ */
.totals { width: 100%; border-collapse: collapse; margin: 2mm 0; border: 1px solid #0F1726; border-radius: 2mm; overflow: hidden; }
.totals td { padding: ${isA4 ? "1.5mm 3mm" : "1mm 2mm"}; font-size: .85em; border-bottom: 1px solid #f1f5f9; }
.totals tr:last-child td { border-bottom: none; }
.t-lbl { color: #64748b; }
.t-row td { background: #fff; }
.t-final td { background: #0F1726; color: #fff; font-weight: 700; font-size: 1em; }
.t-final .t-lbl { color: rgba(255,255,255,.7); }
.t-recu td { background: #f8fafc; }
.t-rendu td { background: #dcfce7; color: #15803d; font-weight: 700; }
.rouge { color: #B91C1C; }

/* ══ ARRÊTÉ EN LETTRES ══ */
.lettres-box {
  border: 1px solid #e2e8f0;
  border-radius: 2mm;
  padding: ${isA4 ? "2.5mm 3mm" : "1.5mm 2mm"};
  margin: 2mm 0;
  font-size: .82em;
  font-style: italic;
  font-weight: 700;
  color: #0F1726;
  background: #f8fafc;
}

/* ══ SIGNATURE + CACHET ══ */
.sign-row {
  display: flex;
  gap: 3mm;
  margin: 2mm 0;
}
.sign-bloc {
  flex: 1;
  border: 1px solid #e2e8f0;
  border-radius: 2mm;
  padding: 1.5mm 2mm;
  background: #f8fafc;
  min-height: ${isA4 ? "18mm" : "14mm"};
  display: flex;
  flex-direction: column;
}
.sign-lbl {
  font-size: .62em;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 1px;
  text-transform: uppercase;
  text-align: center;
  padding-bottom: 1.5mm;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 1mm;
}
.sign-content { flex: 1; display: flex; align-items: center; justify-content: center; }
.sign-img { max-width: 70%; max-height: ${isA4 ? "12mm" : "9mm"}; object-fit: contain; }
.cachet-img { max-width: 55%; max-height: ${isA4 ? "12mm" : "9mm"}; object-fit: contain; }
.sign-line { width: 75%; height: 1px; background: #334155; margin: auto; }

/* Thermique : signature */
.sign-th { background: #f8fafc; border-radius: 1mm; padding: 1.5mm; margin: 1.5mm 0; text-align: center; }
.sign-img-th { max-width: 60%; max-height: 7mm; object-fit: contain; margin-top: 1mm; }
.sign-line-th { width: 55%; height: 1px; background: #334155; margin: 2mm auto 0; }

/* ══ FOOTER ══ */
.footer { margin-top: 2mm; text-align: center; }
.footer-line {
  border: none;
  border-top: 1px dashed #cbd5e1;
  margin-bottom: 1.5mm;
}
.f-thanks { font-weight: 700; font-size: .88em; color: #B5622B; margin-bottom: 1mm; }
.f-note   { font-size: .68em; color: #64748b; line-height: 1.4; }
.f-fiscal { font-size: .62em; color: #94a3b8; margin-top: 1mm; }
.f-brand  { font-size: .58em; color: #cbd5e1; margin-top: 1mm; }

/* ══ PRINT ══ */
@media screen { body { visibility: hidden; } }
@media print {
  body { visibility: visible; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
</style>
</head>
<body>

${showCompany ? `
<!-- HEADER ENTREPRISE -->
${companyHtml}
${isTh && hasLogo ? logoHtml : ""}
<!-- Filet cuivre -->
<div class="filet-cuivre"></div>
` : ""}

<!-- INFOS DOCUMENT + CLIENT -->
${infoBoxHtml}

<!-- TABLEAU ARTICLES -->
<table>
  <thead>
    <tr>
      <th>DÉSIGNATION</th>
      <th class="tc">QTÉ</th>
      <th class="tr">P.U.</th>
      ${showRem ? `<th class="tc">REM</th>` : ""}
      <th class="tr">MONTANT</th>
    </tr>
  </thead>
  <tbody>${lignesRows}</tbody>
</table>

<!-- TOTAUX -->
<table class="totals">
  ${totsRows}
  <tr class="t-final">
    <td class="t-lbl" colspan="${colspan}">TOTAL ${data.applyTva ? "TTC" : ""}</td>
    <td class="tr">${fmtAmt(data.total)}</td>
  </tr>
  ${renduRows}
</table>

${data.note ? `<div class="note-block">Note : ${escH(data.note)}</div>` : ""}

<!-- ARRÊTÉ EN LETTRES -->
${!isTh ? `<div class="lettres-box"><em>${escH(lettresTxt)}</em></div>` : ""}

<!-- SIGNATURE + CACHET -->
${signHtml}

<!-- FOOTER -->
${footerHtml}

</body>
</html>`;

  /* ── Injection iframe cachée ── */
  let iframe = document.getElementById("print-iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "print-iframe";
    Object.assign(iframe.style, {
      position:"fixed", top:"-9999px", left:"-9999px",
      width:"1px", height:"1px", border:"none",
    });
    document.body.appendChild(iframe);
  }

  const iDoc = iframe.contentWindow.document;
  iDoc.open(); iDoc.write(html); iDoc.close();

  const doPrint = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch (e) { console.warn("[print]", e); }
  };
  iframe.onload = () => setTimeout(doPrint, 350);
  setTimeout(doPrint, 750);
}
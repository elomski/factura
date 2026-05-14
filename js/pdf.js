// ══════════════════════════════════════════════════════
//  pdf.js  —  FacturaPro
//  Génération PDF via jsPDF + jsPDF-AutoTable
// ══════════════════════════════════════════════════════

/**
 * Génère et télécharge le PDF d'une vente.
 * @param {object} data  — objet vente complet (buildVenteData())
 * @param {object} entreprise — infos entreprise (depuis Firestore)
 * @param {object} config     — config documents (depuis Firestore)
 */
function genererPDF(data, entreprise, config) {
  const { jsPDF } = window.jspdf;

  // ── Format papier ──
  const fmt = config.format || "thermal";
  let pw, margin;
  if (fmt === "thermal") { pw = 80;  margin = 5;  }
  else if (fmt === "a5") { pw = 148; margin = 10; }
  else                   { pw = 210; margin = 15; }
  const ph  = 297;
  const lw  = pw - 2 * margin;

  const doc = new jsPDF({ unit: "mm", format: [pw, ph], orientation: "portrait" });
  let y = margin;

  // ── Couleurs ──
  const CUIVRE = [181, 98,  43];
  const ENCRE  = [28,  23,  18];
  const BLANC  = [255, 255, 255];

  // ── Helper montant ──
  const fmtAmt = (n) => {
    const s   = Number(n || 0).toLocaleString("fr-FR");
    const dev = config.devise || entreprise.devise || "F CFA";
    return (config.devisePos === "before") ? `${dev} ${s}` : `${s} ${dev}`;
  };

  // ══════════════════════════════════════════════
  //  EN-TÊTE COLORÉE
  // ══════════════════════════════════════════════
  doc.setFillColor(...CUIVRE);
  doc.rect(0, 0, pw, 14, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BLANC);
  doc.text(entreprise.nom || "Mon Entreprise", pw / 2, 9, { align: "center" });
  y = 18;

  // Slogan
  if (entreprise.slogan) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...CUIVRE);
    doc.text(entreprise.slogan, pw / 2, y, { align: "center" });
    y += 4;
  }

  // Infos contact
  if (config.showCompany !== false) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...ENCRE);

    const lignesContact = [
      [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
      [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
      entreprise.email,
      entreprise.web,
    ].filter(Boolean);

    lignesContact.forEach((ligne) => {
      doc.text(ligne, pw / 2, y, { align: "center" });
      y += 3.5;
    });

    if (entreprise.rc || entreprise.nif) {
      const fiscal = [
        entreprise.rc  && `RC : ${entreprise.rc}`,
        entreprise.nif && `NIF : ${entreprise.nif}`,
      ].filter(Boolean).join("  |  ");
      doc.setFontSize(6.5);
      doc.setTextColor(130, 120, 110);
      doc.text(fiscal, pw / 2, y, { align: "center" });
      y += 4;
    }
    y += 1;
  }

  // En-tête texte personnalisé
  if (config.headerText) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(120, 110, 100);
    const hlines = doc.splitTextToSize(config.headerText, lw);
    doc.text(hlines, pw / 2, y, { align: "center" });
    y += hlines.length * 3.5 + 2;
  }

  // Séparateur
  doc.setDrawColor(...CUIVRE);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pw - margin, y);
  y += 5;

  // ══════════════════════════════════════════════
  //  TYPE + NUMÉRO
  // ══════════════════════════════════════════════
  const typeLabel = { facture: "FACTURE", recu: "REÇU", devis: "DEVIS" }[data.type] || "DOCUMENT";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...CUIVRE);
  doc.text(typeLabel, pw / 2, y, { align: "center" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...ENCRE);
  doc.text(`N° ${data.numero}`, pw / 2, y, { align: "center" });
  y += 4;

  if (config.showDate !== false) {
    const ds = data.date.toLocaleDateString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.setFontSize(7.5);
    doc.text(`Date : ${ds}`, pw / 2, y, { align: "center" });
    y += 5;
  }

  // ══════════════════════════════════════════════
  //  BLOC CLIENT
  // ══════════════════════════════════════════════
  if (data.client.nom || data.client.tel || data.client.adresse) {
    y += 2;
    doc.setFillColor(245, 240, 234);
    doc.roundedRect(margin, y, lw, 5, 0.8, 0.8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...CUIVRE);
    doc.text("CLIENT", margin + 2, y + 3.5);
    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...ENCRE);
    if (data.client.nom)     { doc.text(data.client.nom,            margin, y); y += 4; }
    if (data.client.tel)     { doc.text(`Tél : ${data.client.tel}`, margin, y); y += 4; }
    if (data.client.email)   { doc.text(data.client.email,          margin, y); y += 4; }
    if (data.client.adresse) { doc.text(data.client.adresse,        margin, y); y += 4; }
    y += 2;
  }

  // Séparateur
  doc.setDrawColor(220, 210, 200);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  // ══════════════════════════════════════════════
  //  TABLEAU ARTICLES
  // ══════════════════════════════════════════════
  const isNarrow = fmt === "thermal";
  const cols = isNarrow
    ? { des: lw * 0.40, qte: lw * 0.12, pu: lw * 0.22, rem: lw * 0.10, tot: lw * 0.16 }
    : { des: lw * 0.38, qte: lw * 0.10, pu: lw * 0.20, rem: lw * 0.10, tot: lw * 0.22 };

  // En-tête tableau
  doc.setFillColor(...ENCRE);
  doc.rect(margin, y, lw, 6.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...BLANC);

  let cx = margin + 1;
  doc.text("DÉSIGNATION",           cx,               y + 4.5);               cx += cols.des;
  doc.text("QTÉ",                   cx + cols.qte/2,  y + 4.5, {align:"center"}); cx += cols.qte;
  doc.text("P.UNIT.",               cx + cols.pu - 1, y + 4.5, {align:"right"});  cx += cols.pu;
  if (config.showRef)
    doc.text("REM%",                cx + cols.rem/2,  y + 4.5, {align:"center"});
  cx += cols.rem;
  doc.text("TOTAL",                 pw - margin - 1,  y + 4.5, {align:"right"});
  y += 6.5;

  // Lignes articles
  let altRow = false;
  data.lignes.forEach((l, idx) => {
    const tot   = l.qte * l.prix * (1 - (l.remise || 0) / 100);
    const rowH  = 7;

    if (altRow) {
      doc.setFillColor(248, 244, 240);
      doc.rect(margin, y, lw, rowH, "F");
    }
    altRow = !altRow;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...ENCRE);

    cx = margin + 1;
    const des     = l.des || `Article ${idx + 1}`;
    const desWrap = doc.splitTextToSize(des, cols.des - 2);
    doc.text(desWrap[0], cx, y + 4.5);
    cx += cols.des;

    doc.text(String(l.qte),                          cx + cols.qte / 2,  y + 4.5, {align:"center"}); cx += cols.qte;
    doc.text(Number(l.prix).toLocaleString("fr-FR"), cx + cols.pu - 1,   y + 4.5, {align:"right"});  cx += cols.pu;

    if (config.showRef && l.remise > 0)
      doc.text(`${l.remise}%`,                       cx + cols.rem / 2,  y + 4.5, {align:"center"});
    cx += cols.rem;

    doc.text(Number(tot).toLocaleString("fr-FR"),    pw - margin - 1,    y + 4.5, {align:"right"});

    y += rowH;
    doc.setDrawColor(230, 220, 210);
    doc.setLineWidth(0.1);
    doc.line(margin, y, pw - margin, y);
  });

  y += 4;

  // ══════════════════════════════════════════════
  //  TOTAUX
  // ══════════════════════════════════════════════
  // Sous-total HT si TVA ou remise
  if (data.applyTva || data.remiseMt > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...ENCRE);
    doc.text("Sous-total HT",      pw - margin - 1 - 30, y + 4);
    doc.text(fmtAmt(data.ht),      pw - margin - 1,       y + 4, {align:"right"});
    y += 7;
  }

  // Remise
  if (data.remiseMt > 0) {
    doc.setTextColor(139, 32, 32);
    doc.text(`Remise (${data.remise}%)`,   pw - margin - 1 - 30, y + 4);
    doc.text(`-${fmtAmt(data.remiseMt)}`, pw - margin - 1,       y + 4, {align:"right"});
    doc.setTextColor(...ENCRE);
    y += 7;
  }

  // TVA
  if (data.applyTva) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...ENCRE);
    doc.text(`TVA (${data.tvaRate}%)`, pw - margin - 1 - 30, y + 4);
    doc.text(fmtAmt(data.tvaMt),      pw - margin - 1,       y + 4, {align:"right"});
    y += 7;
  }

  // Total final — bande colorée
  doc.setFillColor(...CUIVRE);
  doc.rect(margin, y, lw, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BLANC);
  doc.text("TOTAL",            margin + 3,      y + 7);
  doc.text(fmtAmt(data.total), pw - margin - 1, y + 7, {align:"right"});
  y += 15;

  // Montant reçu / rendu
  if (config.showRendu !== false && data.montantRecu > 0 && data.type !== "devis") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...ENCRE);
    doc.text(`Montant reçu : ${fmtAmt(data.montantRecu)}`, pw - margin - 1, y, {align:"right"});
    y += 4;

    const rendu = data.montantRecu - data.total;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...(rendu >= 0 ? [42, 102, 68] : [139, 32, 32]));
    doc.text(`Rendu monnaie : ${fmtAmt(rendu)}`, pw - margin - 1, y, {align:"right"});
    y += 6;
    doc.setTextColor(...ENCRE);
  }

  // Mode de paiement
  if (data.paiement && data.type !== "devis") {
    const pmodes = {
      especes:      "Espèces",
      mobile_money: "Mobile Money",
      virement:     "Virement bancaire",
      cheque:       "Chèque",
      credit:       "À crédit",
    };
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...ENCRE);
    doc.text(`Mode de paiement : ${pmodes[data.paiement] || data.paiement}`, margin, y);
    y += 5;
  }

  // Note
  if (data.note) {
    y += 2;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(120, 110, 100);
    const noteLines = doc.splitTextToSize(`Note : ${data.note}`, lw);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 3.5 + 2;
  }

  // ── Signature ──
  if (config.showSign) {
    y += 8;
    doc.setDrawColor(...ENCRE);
    doc.setLineWidth(0.3);
    doc.line(margin, y, margin + 45, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...ENCRE);
    doc.text("Signature du vendeur", margin, y + 4);
    y += 10;
  }

  // ══════════════════════════════════════════════
  //  PIED DE PAGE
  // ══════════════════════════════════════════════
  y += 4;
  doc.setDrawColor(220, 210, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pw - margin, y);
  y += 5;

  if (config.footerThanks) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...CUIVRE);
    doc.text(config.footerThanks, pw / 2, y, { align: "center" });
    y += 5;
  }

  if (config.footerLegal) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(150, 140, 130);
    const legal = doc.splitTextToSize(config.footerLegal, lw);
    doc.text(legal, pw / 2, y, { align: "center" });
    y += legal.length * 3.5 + 3;
  }

  // Infos fiscales tout en bas
  if (entreprise.rc || entreprise.nif) {
    doc.setFontSize(6);
    doc.setTextColor(170, 160, 150);
    const fiscal = [
      entreprise.rc  && `RC : ${entreprise.rc}`,
      entreprise.nif && `NIF : ${entreprise.nif}`,
    ].filter(Boolean).join("  |  ");
    doc.text(fiscal, pw / 2, y, { align: "center" });
    y += 5;
  }

  // Pied générique
  doc.setFontSize(5.5);
  doc.setTextColor(200, 190, 180);
  doc.text("Généré par FacturaPro", pw / 2, y, { align: "center" });

  // ── Téléchargement ──
  const nomFichier = `${data.numero}_${(entreprise.nom || "facture").replace(/\s+/g, "_")}.pdf`;
  doc.save(nomFichier);

  return nomFichier;
}

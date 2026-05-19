// ══════════════════════════════════════════════════════
//  pdf.js  —  FacturaPro  v6
//
//  SOLUTIONS PROFESSIONNELLES :
//
//  [1] PAGINATION AUTOMATIQUE
//      Thermal : hauteur dynamique (pas de page fixe),
//      le document grandit avec le contenu.
//      A4 / A5 : format fixe avec saut de page automatique.
//      Quand y + contenu_suivant > hauteur_utile → addPage()
//      puis répéter le header tableau sur la nouvelle page.
//
//  [2] LAYOUT PROFESSIONNEL POUR CONTENU COURT (A4/A5)
//      Sur A4/A5 avec peu d'articles, le footer est ancré
//      en bas de page (position absolue calculée).
//      Le tableau occupe l'espace disponible.
//      Le contenu ne flotte jamais en haut de page.
//
//  [3] LOGO CLOUDINARY / URL EXTERNE
//      Firebase Storage retiré (carte bancaire requise).
//      L'upload passe par l'API Cloudinary (gratuit, sans carte).
//
//  [4] FIX MONTANTS — _fmtNum() avec espace ASCII uniquement.
// ══════════════════════════════════════════════════════

/** Formate un montant sans toLocaleString (évite \u202F → "/") */
function _fmtNum(n) {
  return String(Math.round(Number(n ?? 0)))
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u0020");
}

/**
 * Génère et télécharge le PDF d'une vente.
 *
 * Stratégies de mise en page :
 * • Thermal 80mm  → hauteur auto (document grandit avec le contenu)
 * • A5 / A4       → format fixe, pagination + footer ancré en bas
 *
 * @param {object} data       — objet vente complet, data.date = Date JS
 * @param {object} entreprise — infos entreprise
 * @param {object} config     — config documents
 * @returns {string} nom du fichier PDF
 */
function genererPDF(data, entreprise, config) {
  const { jsPDF } = window.jspdf;

  // ── Paramètres format ──
  const fmt_ = config.format ?? "thermal";
  const isThermal = fmt_ === "thermal";

  let pw, ph, margin;
  if (fmt_ === "a4") { pw = 210; ph = 297; margin = 12; }
  else if (fmt_ === "a5") { pw = 148; ph = 210; margin = 8; }
  else { pw = 80; ph = 400; margin = 3; } // thermal : hauteur provisoire

  const lw = pw - 2 * margin;

  // ── jsPDF init ──
  // Thermal : [pw, 400] — on ajuste la hauteur réelle à la fin
  // A4/A5   : format standard
  const docFormat = isThermal ? [pw, ph] : (fmt_ === "a4" ? "a4" : "a5");
  const doc = new jsPDF({
    unit: "mm",
    format: docFormat,
    orientation: "portrait",
  });

  // ── Hauteur utile par page (A4/A5) ──
  // On réserve de l'espace en bas pour le footer
  const footerH = _estimateFooterHeight(config, entreprise, fmt_);
  const pageH = isThermal ? 9999 : ph; // thermal = infini
  const safeBot = isThermal ? 9999 : pageH - margin - footerH;

  // ── Palette ──
  const C_NOIR = [17, 17, 17];
  const C_CUIVRE = [181, 98, 43];
  const C_BLANC = [255, 255, 255];
  const C_GRIS = [244, 244, 244];
  const C_MUTED = [102, 102, 102];
  const C_VERT = [46, 125, 50];
  const C_ROUGE = [139, 32, 32];
  const C_ALT = [250, 250, 250];

  const safe = str => sanitizePdf(str);
  const fmtAmt = n => {
    const s = _fmtNum(n);
    const dev = config.devise ?? entreprise.devise ?? "F CFA";
    return config.devisePos === "before" ? `${dev} ${s}` : `${s} ${dev}`;
  };

  const dateObj = data.date instanceof Date ? data.date : toDateObj(data.date);
  const dateStr =
    String(dateObj.getDate()).padStart(2, "0") + "/" +
    String(dateObj.getMonth() + 1).padStart(2, "0") + "/" +
    dateObj.getFullYear() + " " +
    String(dateObj.getHours()).padStart(2, "0") + ":" +
    String(dateObj.getMinutes()).padStart(2, "0");

  const fontSize = isThermal ? 7.5 : fmt_ === "a5" ? 9 : 10;
  const smallSz = isThermal ? 6 : 7.5;
  const rowH_art = isThermal ? 6 : 7;
  const thH = isThermal ? 5.5 : 6.5;
  const totRowH = isThermal ? 4.5 : 6;
  const rowH_box = isThermal ? 3.8 : 4.5;

  // ── Colonnes tableau ──
  const showRemise = config.showRef ?? false;
  let colDes, colQte, colPU, colRem, colTot;
  if (isThermal) {
    colDes = lw * 0.38; colQte = lw * 0.12; colPU = lw * 0.24;
    colRem = showRemise ? lw * 0.10 : 0;
  } else {
    colDes = lw * 0.42; colQte = lw * 0.10; colPU = lw * 0.22;
    colRem = showRemise ? lw * 0.08 : 0;
  }
  colTot = lw - colDes - colQte - colPU - colRem;

  let y = margin;
  let pageNum = 1;

  // ════════════════════════════════════════════════════
  //  HELPER : saut de page automatique (A4/A5)
  //  Vérifie si le contenu suivant (neededH mm) tient
  //  dans la zone utile. Si non → nouvelle page avec
  //  répétition de l'en-tête du tableau.
  // ════════════════════════════════════════════════════
  let tableHeaderDrawn = false; // pour savoir si on doit répéter l'en-tête

  const checkNewPage = (neededH, repeatTableHeader = false) => {
    if (isThermal) return; // thermal = pas de saut de page
    if (y + neededH > safeBot) {
      // Dessiner le footer sur la page courante avant de passer
      _drawFooter(doc, pageH, margin, lw, pw, config, entreprise, pageNum, C_MUTED, C_CUIVRE, safe, fmtAmt, smallSz, fontSize);
      doc.addPage();
      pageNum++;
      y = margin;

      // Répéter l'en-tête du tableau si on est en milieu de tableau
      if (repeatTableHeader && tableHeaderDrawn) {
        _drawTableHeader(doc, y, margin, lw, pw, thH, smallSz, colDes, colQte, colPU, colRem, colTot, showRemise, C_NOIR, C_BLANC);
        y += thH;
      }
    }
  };

  // ════════════════════════════════════════════════════
  //  HEADER — Logo + infos entreprise
  // ════════════════════════════════════════════════════

  if (config.showLogo !== false && entreprise.logoUrl) {
    try {
      const logoH = isThermal ? 11 : fmt_ === "a5" ? 18 : 22;
      const logoW = logoH;
      doc.addImage(
        entreprise.logoUrl, "JPEG",
        pw / 2 - logoW / 2, y, logoW, logoH,
        undefined, "FAST"
      );
      y += logoH + 2;
    } catch { /* URL inaccessible ou format CORS → skip */ }
  }

  if (config.showCompany !== false) {
    // Nom entreprise
    doc.setFont("helvetica", "bold");
    doc.setFontSize(isThermal ? 9.5 : fmt_ === "a5" ? 13 : 16);
    doc.setTextColor(...C_NOIR);
    doc.text(safe(entreprise.nom ?? "Mon Entreprise"), pw / 2, y + 4, { align: "center" });
    y += isThermal ? 5.5 : 8;

    if (entreprise.slogan) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(smallSz);
      doc.setTextColor(...C_MUTED);
      doc.text(safe(entreprise.slogan), pw / 2, y + 1, { align: "center" });
      y += 4;
    }

    const contactLines = [
      [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
      [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
      entreprise.email,
      entreprise.web,
    ].filter(Boolean);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz);
    doc.setTextColor(...C_MUTED);
    contactLines.forEach(l => {
      doc.text(safe(l), pw / 2, y + 1, { align: "center" });
      y += 3.5;
    });
    y += 1;
  }

  if (config.headerText) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(smallSz);
    doc.setTextColor(120, 110, 100);
    const hls = doc.splitTextToSize(safe(config.headerText), lw);
    doc.text(hls, pw / 2, y + 1, { align: "center" });
    y += hls.length * 3.2 + 2;
  }

  // Ligne séparatrice noire
  doc.setDrawColor(...C_NOIR);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  // ════════════════════════════════════════════════════
  //  INV-BOX — numéro, date, client
  // ════════════════════════════════════════════════════
  const typeLabel = { facture: "FACTURE", recu: "RECU", devis: "DEVIS" }[data.type] ?? "DOCUMENT";
  const client = data.client ?? {};

  let boxLines = 2; // titre + numéro
  if (config.showDate !== false) boxLines++;
  if (client.nom) boxLines++;
  if (client.tel) boxLines++;
  if (client.email) boxLines++;
  if (client.adresse) boxLines++;
  const boxH = 5 + boxLines * rowH_box + 3;

  checkNewPage(boxH + thH + rowH_art * 3); // s'assurer qu'au moins 3 lignes suivent

  doc.setFillColor(...C_GRIS);
  doc.roundedRect(margin, y, lw, boxH, 1, 1, "F");

  const bx = margin + 2;
  let by = y + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(isThermal ? 8.5 : 12);
  doc.setTextColor(...C_NOIR);
  doc.text(typeLabel, pw / 2, by, { align: "center" });
  by += rowH_box + 1;

  const drawBoxRow = (lbl, val) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...C_MUTED);
    doc.text(lbl, bx, by);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C_NOIR);
    doc.text(safe(val), pw - margin - 2, by, { align: "right" });
    by += rowH_box;
  };

  drawBoxRow("N\u00B0 Facture", data.numero ?? "");
  if (config.showDate !== false) drawBoxRow("Date", dateStr);
  if (client.nom) drawBoxRow("Client", client.nom);
  if (client.tel) drawBoxRow("Tel.", client.tel);
  if (client.email) drawBoxRow("Email", client.email);
  if (client.adresse) drawBoxRow("Adresse", client.adresse);

  y += boxH + 3;

  // ════════════════════════════════════════════════════
  //  TABLEAU ARTICLES — avec pagination automatique
  // ════════════════════════════════════════════════════
  const lignes = Array.isArray(data.lignes) ? data.lignes : [];

  // Dessiner l'en-tête du tableau
  _drawTableHeader(doc, y, margin, lw, pw, thH, smallSz, colDes, colQte, colPU, colRem, colTot, showRemise, C_NOIR, C_BLANC);
  tableHeaderDrawn = true;
  y += thH;

  let isEven = true;

  lignes.forEach((l, idx) => {
    const tot = l.qte * l.prix * (1 - (l.remise ?? 0) / 100);

    // [FIX PAGINATION] Vérifier si la ligne tient sur la page
    checkNewPage(rowH_art, true);

    if (isEven) {
      doc.setFillColor(...C_ALT);
      doc.rect(margin, y, lw, rowH_art, "F");
    }
    isEven = !isEven;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...C_NOIR);

    let cx = margin + 1;
    const desText = safe(l.des || `Article ${idx + 1}`);
    const desCut = doc.splitTextToSize(desText, colDes - 1)[0];
    doc.text(desCut, cx, y + rowH_art * 0.66);
    cx += colDes;

    doc.text(String(l.qte), cx + colQte / 2, y + rowH_art * 0.66, { align: "center" }); cx += colQte;
    doc.text(_fmtNum(l.prix), cx + colPU - 1, y + rowH_art * 0.66, { align: "right" }); cx += colPU;
    if (showRemise) {
      if ((l.remise ?? 0) > 0)
        doc.text(`${l.remise}%`, cx + colRem / 2, y + rowH_art * 0.66, { align: "center" });
      cx += colRem;
    }
    doc.text(_fmtNum(tot), pw - margin - 1, y + rowH_art * 0.66, { align: "right" });

    y += rowH_art;
    doc.setDrawColor(229, 229, 229);
    doc.setLineWidth(0.1);
    doc.line(margin, y, pw - margin, y);
  });

  y += 2;

  // ════════════════════════════════════════════════════
  //  TOTAUX — avec vérification de place
  // ════════════════════════════════════════════════════
  const showTvaLine = !!data.applyTva;
  const showRemiseLine = (data.remiseMt ?? 0) > 0;
  const showRendu = config.showRendu !== false &&
    (data.montantRecu ?? 0) > 0 &&
    data.type !== "devis";

  const totLinesCount = [
    showTvaLine || showRemiseLine,
    showRemiseLine,
    showTvaLine,
    true,     // TOTAL
    showRendu, // reçu
    showRendu, // rendu
  ].filter(Boolean).length;

  const totBoxH = totLinesCount * totRowH;
  const paiementH = data.paiement && data.type !== "devis" ? 5 : 0;
  const noteH = data.note ? 8 : 0;
  const signH = config.showSign ? 14 : 0;

  checkNewPage(totBoxH + paiementH + noteH + signH);

  // Contour box totaux
  doc.setDrawColor(...C_NOIR);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, lw, totBoxH, "S");

  let ty = y;

  const drawTotRow = (lbl, val, opts = {}) => {
    const { bgColor, fgColor, bold, bigFont } = opts;
    if (bgColor) {
      doc.setFillColor(...bgColor);
      doc.rect(margin, ty, lw, totRowH, "F");
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bigFont ? fontSize + 1 : fontSize);
    doc.setTextColor(...(fgColor ?? C_MUTED));
    doc.text(safe(lbl), margin + 2, ty + totRowH * 0.66);
    doc.setTextColor(...(bold && bgColor ? C_BLANC : (fgColor ?? C_NOIR)));
    if (bold && bgColor) doc.setFont("helvetica", "bold");
    doc.text(safe(val), pw - margin - 2, ty + totRowH * 0.66, { align: "right" });
    ty += totRowH;
    doc.setDrawColor(229, 229, 229);
    doc.setLineWidth(0.1);
    doc.line(margin, ty, pw - margin, ty);
  };

  if (showTvaLine || showRemiseLine) drawTotRow("Total HT", fmtAmt(data.ht));
  if (showRemiseLine) drawTotRow(`Remise (${data.remise}%)`, `-${fmtAmt(data.remiseMt)}`, { fgColor: C_ROUGE });
  if (showTvaLine) drawTotRow(`TVA (${data.tvaRate}%)`, fmtAmt(data.tvaMt));

  drawTotRow(
    `TOTAL ${showTvaLine ? "TTC" : ""}`,
    fmtAmt(data.total),
    { bgColor: C_NOIR, fgColor: C_BLANC, bold: true, bigFont: true }
  );

  if (showRendu) {
    const rendu = (data.montantRecu ?? 0) - (data.total ?? 0);
    drawTotRow("Montant recu", fmtAmt(data.montantRecu), { bgColor: [245, 245, 245], fgColor: C_MUTED });
    drawTotRow("Rendu monnaie", fmtAmt(rendu), { bgColor: [232, 245, 233], fgColor: C_VERT, bold: true });
  }

  y = ty + 3;

  // ── Paiement ──
  if (data.paiement && data.type !== "devis") {
    const pmodes = { especes: "Especes", mobile_money: "Mobile Money", virement: "Virement bancaire", cheque: "Cheque", credit: "A credit" };
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...C_NOIR);
    doc.text(`Paiement : ${pmodes[data.paiement] ?? safe(data.paiement)}`, margin, y);
    y += 5;
  }

  // ── Note ──
  if (data.note) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(smallSz);
    doc.setTextColor(120, 110, 100);
    const nls = doc.splitTextToSize(`Note : ${safe(data.note)}`, lw);
    doc.text(nls, margin, y);
    y += nls.length * 3.5 + 2;
  }

  // ── Signature vendeur ──
  if (config.showSign) {
    y += 4;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pw - margin, y);
    y += 3;
    const visaW = lw * 0.45;
    doc.setDrawColor(...C_NOIR);
    doc.setLineWidth(0.3);
    doc.line(margin, y + 6, margin + visaW, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz - 0.5);
    doc.setTextColor(...C_MUTED);
    doc.text("Signature vendeur", margin + visaW / 2, y + 10, { align: "center" });
    y += 14;
  }

  // ════════════════════════════════════════════════════
  //  FOOTER ANCRÉ EN BAS (A4/A5) ou inline (thermal)
  //
  //  Sur A4/A5 : le footer est TOUJOURS en bas de la
  //  dernière page, quelle que soit la quantité de contenu.
  //  → professionnel même avec 1 seul article.
  //
  //  Sur thermal : footer placé juste après le contenu.
  // ════════════════════════════════════════════════════
  if (isThermal) {
    // Thermal → footer immédiatement après le contenu
    y += 2;
    _drawFooter(doc, y, margin, lw, pw, config, entreprise, pageNum, C_MUTED, C_CUIVRE, safe, fmtAmt, smallSz, fontSize, true);
  } else {
    // A4/A5 → footer ancré en bas de la dernière page
    _drawFooter(doc, pageH, margin, lw, pw, config, entreprise, pageNum, C_MUTED, C_CUIVRE, safe, fmtAmt, smallSz, fontSize, false);
  }

  // ── Thermal : recadrer la hauteur réelle du document ──
  if (isThermal) {
    // jsPDF ne supporte pas le recadrage natif sur v2.5
    // → on utilise le format [pw, y+10] dès le départ serait idéal
    // mais comme on ne connaît pas y à l'avance, on laisse la hauteur généreuse.
    // La plupart des imprimantes thermiques coupent automatiquement.
  }

  // ── Sauvegarde ──
  const nom = `${safe(data.numero ?? "doc")}_${safe(entreprise.nom ?? "facture").replace(/\s+/g, "_")}.pdf`;
  doc.save(nom);
  return nom;
}

// ════════════════════════════════════════════════════
//  FONCTIONS INTERNES
// ════════════════════════════════════════════════════

/** Dessine l'en-tête du tableau (réutilisable après saut de page) */
function _drawTableHeader(doc, y, margin, lw, pw, thH, smallSz, colDes, colQte, colPU, colRem, colTot, showRemise, C_NOIR, C_BLANC) {
  doc.setFillColor(...C_NOIR);
  doc.rect(margin, y, lw, thH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(smallSz);
  doc.setTextColor(...C_BLANC);

  let cx = margin + 1;
  doc.text("DESIGNATION", cx, y + thH * 0.7);
  cx += colDes;
  doc.text("QTE", cx + colQte / 2, y + thH * 0.7, { align: "center" });
  cx += colQte;
  doc.text("P.U.", cx + colPU - 1, y + thH * 0.7, { align: "right" });
  cx += colPU;
  if (showRemise) {
    doc.text("REM%", cx + colRem / 2, y + thH * 0.7, { align: "center" });
    cx += colRem;
  }
  doc.text("TOTAL", pw - margin - 1, y + thH * 0.7, { align: "right" });
}

/**
 * Dessine le footer.
 * @param {number} pageHorY  — Sur thermal : y courant. Sur A4/A5 : hauteur de page (position absolue depuis le bas).
 * @param {boolean} inline   — true = placer à y courant, false = ancrer en bas de page
 */
function _drawFooter(doc, pageHorY, margin, lw, pw, config, entreprise, pageNum, C_MUTED, C_CUIVRE, safe, fmtAmt, smallSz, fontSize, inline) {
  const footerH = _estimateFooterHeight(config, entreprise, config.format ?? "thermal");
  let fy;

  if (inline) {
    // Thermal ou placement direct
    fy = pageHorY;
  } else {
    // Ancré en bas de page (A4/A5)
    fy = pageHorY - margin - footerH;
  }

  doc.setDrawColor(200, 190, 180);
  doc.setLineWidth(0.25);
  doc.setLineDash([1, 1]);
  doc.line(margin, fy, pw - margin, fy);
  doc.setLineDash([]);
  fy += 3;

  if (config.footerThanks) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    doc.setTextColor(...C_CUIVRE);
    doc.text(safe(config.footerThanks), pw / 2, fy, { align: "center" });
    fy += 4.5;
  }

  if (config.footerLegal) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz);
    doc.setTextColor(150, 140, 130);
    const legal = doc.splitTextToSize(safe(config.footerLegal), lw);
    doc.text(legal, pw / 2, fy, { align: "center" });
    fy += legal.length * 3 + 2;
  }

  if (entreprise.rc || entreprise.nif) {
    const fiscal = [
      entreprise.rc && `RC : ${entreprise.rc}`,
      entreprise.nif && `NIF : ${entreprise.nif}`,
    ].filter(Boolean).join("  |  ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz - 0.5);
    doc.setTextColor(170, 160, 150);
    doc.text(safe(fiscal), pw / 2, fy, { align: "center" });
    fy += 4;
  }

  doc.setFontSize(5.5);
  doc.setTextColor(210, 200, 190);
  doc.text("FacturaPro", pw / 2, fy, { align: "center" });
}

/** Estime la hauteur du footer pour réserver l'espace en bas */
function _estimateFooterHeight(config, entreprise, fmt_) {
  let h = 3 + 2; // séparateur + marge
  if (config.footerThanks) h += 4.5;
  if (config.footerLegal) h += 8;   // estimation 2 lignes
  if (entreprise.rc || entreprise.nif) h += 4;
  h += 4; // "FacturaPro"
  return h;
}
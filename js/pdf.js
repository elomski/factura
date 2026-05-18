// ══════════════════════════════════════════════════════
//  pdf.js  —  FacturaPro  v5
//
//  FIXES v5 :
//  [1] BUG CRITIQUE : toLocaleString("fr-FR") produit
//      "\u202F" (espace fine insécable) → jsPDF l'affiche
//      comme "/" (ex: "1 990" → "1/990").
//      SOLUTION : formatage manuel avec replace() qui
//      insère un espace ASCII standard.
//  [2] Design repris du template Blade (inv-box, visas,
//      totaux avec fond #111, rendu en vert, etc.)
//  [3] Logo depuis URL (Firebase Storage ou autre)
//  [4] Section visas (signature vendeur / livreur)
//  [5] Hauteur page dynamique (évite page blanche inutile)
// ══════════════════════════════════════════════════════

/**
 * Formate un nombre sans toLocaleString pour éviter
 * les caractères unicode non-ASCII qui cassent jsPDF.
 * Ex: 1990  → "1 990"
 *     15000 → "15 000"
 */
function _fmtNum(n) {
  return String(Math.round(Number(n ?? 0)))
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u0020"); // espace ASCII U+0020
}

/**
 * Génère et télécharge le PDF d'une vente.
 * Design inspiré du template Blade (facture thermique / A5 / A4).
 *
 * @param {object} data        — objet vente complet, data.date = Date JS
 * @param {object} entreprise  — infos entreprise
 * @param {object} config      — config documents
 * @returns {string} nom du fichier sauvegardé
 */
function genererPDF(data, entreprise, config) {
  const { jsPDF } = window.jspdf;

  // ── Format papier ──
  const fmt_ = config.format ?? "thermal";
  let pw, margin;
  if      (fmt_ === "a4")     { pw = 210; margin = 12; }
  else if (fmt_ === "a5")     { pw = 148; margin = 8;  }
  else                        { pw = 80;  margin = 3;  } // thermal
  const lw = pw - 2 * margin;

  // Hauteur initiale généreuse — on recadre à la fin
  const doc = new jsPDF({ unit: "mm", format: [pw, 400], orientation: "portrait" });
  let y = margin;

  // ── Palette ──
  const C_NOIR   = [17,  17,  17 ];
  const C_CUIVRE = [181, 98,  43 ];
  const C_BLANC  = [255, 255, 255];
  const C_GRIS   = [244, 244, 244];
  const C_MUTED  = [102, 102, 102];
  const C_VERT   = [46,  125, 50 ];
  const C_ROUGE  = [139, 32,  32 ];
  const C_ALT    = [250, 250, 250];

  // ── Helpers ──
  const safe = str => sanitizePdf(str); // depuis utils.js

  const fmtAmt = n => {
    const s   = _fmtNum(n);
    const dev = config.devise ?? entreprise.devise ?? "F CFA";
    return (config.devisePos === "before") ? `${dev} ${s}` : `${s} ${dev}`;
  };

  const dateObj = data.date instanceof Date ? data.date : toDateObj(data.date);
  const dateStr = [
    String(dateObj.getDate()).padStart(2, "0"),
    String(dateObj.getMonth() + 1).padStart(2, "0"),
    dateObj.getFullYear(),
  ].join("/") + " " +
    String(dateObj.getHours()).padStart(2, "0") + ":" +
    String(dateObj.getMinutes()).padStart(2, "0");

  const fontSize = fmt_ === "thermal" ? 7.5 : fmt_ === "a5" ? 9 : 10;
  const smallSz  = fmt_ === "thermal" ? 6   : 7.5;

  // ════════════════════════════════════════
  //  HEADER — Logo + infos entreprise
  // ════════════════════════════════════════

  // Bande noire en-tête (comme .header avec border-bottom:#111)
  if (config.showLogo !== false && entreprise.logoUrl) {
    // Tenter de charger le logo en base64 (si en mémoire cache)
    // → On l'affiche si disponible, sinon on passe
    try {
      const logoH = fmt_ === "thermal" ? 12 : 20;
      const logoW = logoH; // carré par défaut
      doc.addImage(entreprise.logoUrl, "JPEG",
        pw / 2 - logoW / 2, y, logoW, logoH,
        undefined, "FAST"
      );
      y += logoH + 2;
    } catch {
      // Logo inaccessible (CORS, format non supporté) → skip silencieusement
    }
  }

  if (config.showCompany !== false) {
    // Nom entreprise
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fmt_ === "thermal" ? 10 : 14);
    doc.setTextColor(...C_NOIR);
    doc.text(safe(entreprise.nom ?? "Mon Entreprise"), pw / 2, y + 4, { align: "center" });
    y += 6;

    // Slogan
    if (entreprise.slogan) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(smallSz);
      doc.setTextColor(...C_MUTED);
      doc.text(safe(entreprise.slogan), pw / 2, y + 1, { align: "center" });
      y += 4;
    }

    // Infos contact
    const contactLines = [
      [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
      [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
      entreprise.email,
      entreprise.web,
    ].filter(Boolean);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz);
    doc.setTextColor(...C_MUTED);
    contactLines.forEach(line => {
      doc.text(safe(line), pw / 2, y + 1, { align: "center" });
      y += 3.5;
    });
    y += 1;
  }

  // Texte d'en-tête personnalisé
  if (config.headerText) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(smallSz);
    doc.setTextColor(120, 110, 100);
    const hlines = doc.splitTextToSize(safe(config.headerText), lw);
    doc.text(hlines, pw / 2, y + 1, { align: "center" });
    y += hlines.length * 3.2 + 2;
  }

  // Ligne séparatrice noire (inspiré .header border-bottom:2px solid #111)
  doc.setDrawColor(...C_NOIR);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  // ════════════════════════════════════════
  //  INVOICE INFO BOX (inspiré .inv-box)
  //  Fond gris clair, numéro, date, client
  // ════════════════════════════════════════
  const typeLabel = { facture: "FACTURE", recu: "RECU", devis: "DEVIS" }[data.type] ?? "DOCUMENT";

  // Calculer la hauteur de la box
  let boxLines = 1; // titre
  if (config.showDate !== false) boxLines++;
  boxLines++; // numéro
  const client = data.client ?? {};
  if (client.nom)     boxLines++;
  if (client.tel)     boxLines++;
  if (client.email)   boxLines++;
  if (client.adresse) boxLines++;
  const rowH_box = 4;
  const boxH = 6 + boxLines * rowH_box + 3;

  doc.setFillColor(...C_GRIS);
  doc.roundedRect(margin, y, lw, boxH, 1, 1, "F");

  const bx = margin + 2;
  let by = y + 5;

  // Titre centré (FACTURE / RECU / DEVIS)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fmt_ === "thermal" ? 9 : 12);
  doc.setTextColor(...C_NOIR);
  doc.text(typeLabel, pw / 2, by, { align: "center" });
  by += rowH_box + 1;

  // Numéro
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(...C_MUTED);
  doc.text("N\u00B0 Facture", bx, by);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C_NOIR);
  doc.text(safe(data.numero ?? ""), pw - margin - 2, by, { align: "right" });
  by += rowH_box;

  // Date
  if (config.showDate !== false) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text("Date", bx, by);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C_NOIR);
    doc.text(dateStr, pw - margin - 2, by, { align: "right" });
    by += rowH_box;
  }

  // Client
  if (client.nom) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text("Client", bx, by);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C_NOIR);
    doc.text(safe(client.nom), pw - margin - 2, by, { align: "right" });
    by += rowH_box;
  }
  if (client.tel) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text("Tel.", bx, by);
    doc.setTextColor(...C_NOIR);
    doc.text(safe(client.tel), pw - margin - 2, by, { align: "right" });
    by += rowH_box;
  }
  if (client.email) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text("Email", bx, by);
    doc.setTextColor(...C_NOIR);
    doc.text(safe(client.email), pw - margin - 2, by, { align: "right" });
    by += rowH_box;
  }
  if (client.adresse) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C_MUTED);
    doc.text("Adresse", bx, by);
    doc.setTextColor(...C_NOIR);
    doc.text(safe(client.adresse), pw - margin - 2, by, { align: "right" });
    by += rowH_box;
  }

  y += boxH + 3;

  // ════════════════════════════════════════
  //  TABLEAU ARTICLES
  //  En-tête fond noir (comme thead th background:#111)
  //  Rangées alternées (comme tbody tr:nth-child(even))
  // ════════════════════════════════════════
  const lignes = Array.isArray(data.lignes) ? data.lignes : [];

  // Largeurs colonnes selon format
  const hasRef    = config.showRef ?? false;
  const showRemise = hasRef;

  let colDes, colQte, colPU, colRem, colTot;
  if (fmt_ === "thermal") {
    colDes = lw * 0.38; colQte = lw * 0.12; colPU = lw * 0.24;
    colRem = showRemise ? lw * 0.10 : 0;
    colTot = lw - colDes - colQte - colPU - colRem;
  } else {
    colDes = lw * 0.40; colQte = lw * 0.10; colPU = lw * 0.22;
    colRem = showRemise ? lw * 0.10 : 0;
    colTot = lw - colDes - colQte - colPU - colRem;
  }

  const thH = 6;
  // En-tête tableau — fond noir
  doc.setFillColor(...C_NOIR);
  doc.rect(margin, y, lw, thH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(smallSz);
  doc.setTextColor(...C_BLANC);

  let cx = margin + 1;
  doc.text("DESIGNATION",               cx, y + 4);
  cx += colDes;
  doc.text("QTE",  cx + colQte / 2,     y + 4, { align: "center" });
  cx += colQte;
  doc.text("P.U.", cx + colPU - 1,      y + 4, { align: "right" });
  cx += colPU;
  if (showRemise) {
    doc.text("REM%", cx + colRem / 2,   y + 4, { align: "center" });
    cx += colRem;
  }
  doc.text("TOTAL", pw - margin - 1,    y + 4, { align: "right" });
  y += thH;

  // Lignes articles
  let isEven = true;
  const rowH_art = fmt_ === "thermal" ? 6.5 : 7.5;

  lignes.forEach((l, idx) => {
    const tot = l.qte * l.prix * (1 - (l.remise ?? 0) / 100);

    if (isEven) {
      doc.setFillColor(...C_ALT);
      doc.rect(margin, y, lw, rowH_art, "F");
    }
    isEven = !isEven;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...C_NOIR);

    cx = margin + 1;

    // Désignation (tronquée si trop longue)
    const desText = safe(l.des || `Article ${idx + 1}`);
    const desCut  = doc.splitTextToSize(desText, colDes - 1)[0];
    doc.text(desCut, cx, y + rowH_art * 0.65);
    cx += colDes;

    doc.text(String(l.qte),        cx + colQte / 2, y + rowH_art * 0.65, { align: "center" });
    cx += colQte;
    doc.text(_fmtNum(l.prix),      cx + colPU - 1,  y + rowH_art * 0.65, { align: "right" });
    cx += colPU;
    if (showRemise) {
      if ((l.remise ?? 0) > 0)
        doc.text(`${l.remise}%`,   cx + colRem / 2, y + rowH_art * 0.65, { align: "center" });
      cx += colRem;
    }
    doc.text(_fmtNum(tot),         pw - margin - 1, y + rowH_art * 0.65, { align: "right" });

    y += rowH_art;

    // Ligne séparatrice fine
    doc.setDrawColor(229, 229, 229);
    doc.setLineWidth(0.1);
    doc.line(margin, y, pw - margin, y);
  });

  y += 2;

  // ════════════════════════════════════════
  //  TOTAUX (inspiré .totals dans le Blade)
  //  Bordure noire, rangée finale fond noir
  // ════════════════════════════════════════

  // Calculer hauteur totaux box
  const showTvaLine    = data.applyTva;
  const showRemiseLine = (data.remiseMt ?? 0) > 0;
  const showRendu      = config.showRendu !== false &&
                         (data.montantRecu ?? 0) > 0 &&
                         data.type !== "devis";

  const totRows = [
    showTvaLine || showRemiseLine, // sous-total HT
    showRemiseLine,
    showTvaLine,
    true, // TOTAL
    showRendu, // reçu
    showRendu, // rendu
  ].filter(Boolean).length;

  const totRowH = fmt_ === "thermal" ? 5 : 6;
  const totBoxH = totRows * totRowH;

  // Contour de la box totaux
  doc.setDrawColor(...C_NOIR);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, lw, totBoxH, "S");

  let ty = y;

  const drawTotRow = (label, valeur, opts = {}) => {
    const { bgColor, fgColor, bold, bigFont } = opts;

    if (bgColor) {
      doc.setFillColor(...bgColor);
      doc.rect(margin, ty, lw, totRowH, "F");
    }

    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bigFont ? fontSize + 1 : fontSize);

    // Label
    doc.setTextColor(...(fgColor ?? C_MUTED));
    doc.text(safe(label), margin + 2, ty + totRowH * 0.65);

    // Valeur
    doc.setTextColor(...(bold && bgColor ? C_BLANC : (fgColor ?? C_NOIR)));
    if (bold && bgColor) doc.setFont("helvetica", "bold");
    doc.text(safe(valeur), pw - margin - 2, ty + totRowH * 0.65, { align: "right" });

    ty += totRowH;

    // Ligne séparatrice (sauf dernière)
    doc.setDrawColor(229, 229, 229);
    doc.setLineWidth(0.1);
    doc.line(margin, ty, pw - margin, ty);
  };

  // Sous-total HT (si TVA ou remise)
  if (showTvaLine || showRemiseLine) {
    drawTotRow("Total HT", fmtAmt(data.ht));
  }

  // Remise
  if (showRemiseLine) {
    drawTotRow(
      `Remise (${data.remise}%)`,
      `-${fmtAmt(data.remiseMt)}`,
      { fgColor: C_ROUGE }
    );
  }

  // TVA
  if (showTvaLine) {
    drawTotRow(`TVA (${data.tvaRate}%)`, fmtAmt(data.tvaMt));
  }

  // TOTAL — fond noir, texte blanc
  drawTotRow(
    `TOTAL ${showTvaLine ? "TTC" : ""}`,
    fmtAmt(data.total),
    { bgColor: C_NOIR, fgColor: C_BLANC, bold: true, bigFont: true }
  );

  // Montant reçu + rendu
  if (showRendu) {
    const rendu = (data.montantRecu ?? 0) - (data.total ?? 0);

    // Reçu — fond gris léger
    drawTotRow(
      "Montant recu",
      fmtAmt(data.montantRecu),
      { bgColor: [245, 245, 245], fgColor: C_MUTED }
    );

    // Rendu — fond vert clair (inspiré .t-rendu background:#e8f5e9)
    drawTotRow(
      "Rendu monnaie",
      fmtAmt(rendu),
      { bgColor: [232, 245, 233], fgColor: C_VERT, bold: true }
    );
  }

  y = ty + 3;

  // ── Mode de paiement ──
  if (data.paiement && data.type !== "devis") {
    const pmodes = {
      especes:      "Especes",
      mobile_money: "Mobile Money",
      virement:     "Virement bancaire",
      cheque:       "Cheque",
      credit:       "A credit",
    };
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
    const noteLines = doc.splitTextToSize(`Note : ${safe(data.note)}`, lw);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 3.5 + 2;
  }

  // ════════════════════════════════════════
  //  VISAS (signature vendeur — inspiré .visas du Blade)
  // ════════════════════════════════════════
  if (config.showSign) {
    y += 4;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.25);
    doc.line(margin, y, pw - margin, y); // séparateur haut
    y += 3;

    const visaW = lw * 0.45;

    // Ligne de signature
    doc.setDrawColor(...C_NOIR);
    doc.setLineWidth(0.3);
    doc.line(margin, y + 6, margin + visaW, y + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz - 0.5);
    doc.setTextColor(...C_MUTED);
    doc.text("Signature vendeur", margin + visaW / 2, y + 10, { align: "center" });

    y += 14;
  }

  // ════════════════════════════════════════
  //  FOOTER
  // ════════════════════════════════════════
  y += 2;
  doc.setDrawColor(200, 190, 180);
  doc.setLineWidth(0.25);
  doc.setLineDash([1, 1]);
  doc.line(margin, y, pw - margin, y);
  doc.setLineDash([]);
  y += 4;

  if (config.footerThanks) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    doc.setTextColor(...C_CUIVRE);
    doc.text(safe(config.footerThanks), pw / 2, y, { align: "center" });
    y += 4.5;
  }

  if (config.footerLegal) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz);
    doc.setTextColor(150, 140, 130);
    const legal = doc.splitTextToSize(safe(config.footerLegal), lw);
    doc.text(legal, pw / 2, y, { align: "center" });
    y += legal.length * 3 + 3;
  }

  // Infos fiscales pied de page
  if (entreprise.rc || entreprise.nif) {
    const fiscal = [
      entreprise.rc  && `RC : ${entreprise.rc}`,
      entreprise.nif && `NIF : ${entreprise.nif}`,
    ].filter(Boolean).join("  |  ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(smallSz - 0.5);
    doc.setTextColor(170, 160, 150);
    doc.text(safe(fiscal), pw / 2, y, { align: "center" });
    y += 4;
  }

  // Généré par
  doc.setFontSize(5.5);
  doc.setTextColor(200, 190, 180);
  doc.text("FacturaPro", pw / 2, y, { align: "center" });
  y += 4;

  // ── Sauvegarder avec nom propre ──
  const nomFichier = `${safe(data.numero ?? "doc")}_${safe(entreprise.nom ?? "facture").replace(/\s+/g, "_")}.pdf`;
  doc.save(nomFichier);
  return nomFichier;
}
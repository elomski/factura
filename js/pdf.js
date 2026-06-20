// ══════════════════════════════════════════════════════
//  pdf.js  —  FacturaPro  v20
//
//  SYSTÈME ADAPTATIF PAR FORMAT
//  ─────────────────────────────
//  Chaque format a ses propres tailles calibrées pour
//  que le contenu rentre toujours sur le minimum de pages.
//
//  Thermique 80mm : hauteur dynamique → toujours 1 page
//
//  A5 (148×210mm) : tailles compactes calibrées
//    → jusqu'à ~6 articles avec tout activé en 1 page
//    → police légèrement réduite, espacement serré
//    → signature compacte (17mm)
//
//  A4 (210×297mm) : tailles confortables standard
//    → jusqu'à ~20 articles avec tout activé en 1 page
//    → mise en page aérée et professionnelle
//
//  FIXES v20 :
//  [1] Colonne REM masquée si aucun article n'a de remise
//      individuelle → affichée seulement quand utile
//  [2] Vide blanc supprimé : anchorY retiré, les totaux
//      collent directement sous le tableau
//  [3] "/ Suite page suivante /" plus visible avec filet
//  [4] Numéros de page en passe finale (vrai total)
//  [5] Ancrage bas retiré — le vide résiduel est APRÈS
//      les totaux (avant footer), pas avant eux
//  [1] FS, RH, signH, logoH différents selon format
//  [2] Numéros de page écrits en PASSE FINALE (vrai total)
//  [3] "/ Suite page suivante /" sur pages intermédiaires
//  [4] Ancrage bas uniquement si 1 seule page de tableau
//  [5] bottomNeed = footer seulement (autoTable remplit la page)
//      + vérification post-autoTable pour page de résumé
// ══════════════════════════════════════════════════════
"use strict";

/* ─── Formatage nombre ──────────────────────────────── */
function _fmtNum(n) {
  const abs = Math.round(Math.abs(Number(n ?? 0)));
  const s   = String(abs);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out.push('\u0020');
    out.push(s[i]);
  }
  return (Number(n) < 0 ? '-' : '') + out.join('');
}

/* ─── Nombre en lettres ─────────────────────────────── */
function _nombreEnLettres(n) {
  const U = ["","un","deux","trois","quatre","cinq","six","sept","huit","neuf",
    "dix","onze","douze","treize","quatorze","quinze","seize",
    "dix-sept","dix-huit","dix-neuf"];
  const D = ["","","vingt","trente","quarante","cinquante",
    "soixante","soixante","quatre-vingt","quatre-vingt"];
  function c(nb) {
    if (nb === 0) return "zéro";
    if (nb < 20)  return U[nb];
    if (nb < 100) {
      const t = Math.floor(nb / 10), u = nb % 10;
      if (t === 7 || t === 9) return D[t] + "-" + U[10 + u];
      if (t === 8)            return "quatre-vingt" + (u > 0 ? "-" + U[u] : "s");
      return D[t] + (u === 1 && t !== 8 ? "-et-" : u > 0 ? "-" : "") + (u > 0 ? U[u] : "");
    }
    if (nb < 1000) {
      const h = Math.floor(nb / 100), r = nb % 100;
      return (h === 1 ? "" : U[h] + " ") + "cent" + (r > 0 ? " " + c(r) : h > 1 ? "s" : "");
    }
    if (nb < 1000000) {
      const m = Math.floor(nb / 1000), r = nb % 1000;
      return (m === 1 ? "mille" : c(m) + " mille") + (r > 0 ? " " + c(r) : "");
    }
    const mi = Math.floor(nb / 1000000), r = nb % 1000000;
    return c(mi) + " million" + (mi > 1 ? "s" : "") + (r > 0 ? " " + c(r) : "");
  }
  const v = Math.round(n);
  if (v === 0) return "Zéro franc CFA";
  const s = c(v);
  return s.charAt(0).toUpperCase() + s.slice(1) + " franc" + (v > 1 ? "s" : "") + " CFA";
}

/* ─── Palette ───────────────────────────────────────── */
var _C = {
  NOIR:     [15, 23, 42],
  NOIR2:    [30, 41, 59],
  BLANC:    [255, 255, 255],
  CUIVRE:   [181, 98, 43],
  BLEU:     [30, 58, 138],
  GOLD:     [161, 120, 28],
  GRIS_TH:  [51, 65, 85],
  GRIS_LINE:[226, 232, 240],
  GRIS_BG:  [248, 250, 252],
  GRIS_ALT: [241, 245, 249],
  MUTED:    [100, 116, 139],
  ROUGE:    [185, 28, 28],
  VERT_BG:  [220, 252, 231],
  VERT_TXT: [21, 128, 61],
  TOT_BG:   [15, 23, 42],
  TOT_TXT:  [255, 255, 255],
  TOT_LBL:  [148, 163, 184],
};

function _pmode(c) {
  return {
    especes:      "Espèces",
    mobile_money: "Mobile Money",
    virement:     "Virement bancaire",
    cheque:       "Chèque",
    credit:       "À crédit",
  }[c] ?? c;
}

/* ══════════════════════════════════════════════════════
   TOKENS PAR FORMAT
   Toutes les dimensions calibrées pour chaque format
══════════════════════════════════════════════════════ */
function _getTokens(fmt) {
  // Thermique
  if (fmt === "thermal") return {
    FS: { big: 9, base: 7.5, small: 6.5, tiny: 5.5, title: 11, lettr: 7 },
    RH: { art: 5.5, th: 6.5, tot: 5.5, box: 4.5 },
    logoH: 12, signH: 0, mg: 3, fMg: 2,
  };
  // A5 — compact calibré pour tout tenir en 1 page avec peu d'articles
  if (fmt === "a5") return {
    FS: { big: 11, base: 7.5, small: 6.5, tiny: 5.5, title: 14, lettr: 7 },
    RH: { art: 4.8, th: 5.5, tot: 4.8, box: 4.0 },
    logoH: 12, signH: 17, mg: 10, fMg: 3,
  };
  // A4 — confortable, standard professionnel
  return {
    FS: { big: 16, base: 9.5, small: 8, tiny: 7, title: 22, lettr: 8.5 },
    RH: { art: 6.0, th: 7.0, tot: 5.5, box: 5.0 },
    logoH: 22, signH: 26, mg: 14, fMg: 5,
  };
}

/* ══════════════════════════════════════════════════════
   HAUTEUR FOOTER
══════════════════════════════════════════════════════ */
function _calcFooterH(config, entreprise, FS) {
  let h = 1.5;
  if (config.footerThanks)             h += (FS.base - 0.5) * 0.35 + 1.0;
  if (config.footerLegal)              h += (FS.tiny - 0.5) * 0.35 + 0.6;
  if (entreprise.rc || entreprise.nif) h += (FS.tiny - 1)   * 0.35 + 0.5;
  h += 5 * 0.35 + 0.4;
  return Math.ceil(h);
}

/* ══════════════════════════════════════════════════════
   DESSIN FOOTER
══════════════════════════════════════════════════════ */
function _drawFooter(doc, fy, mg, lw, pw, config, entreprise, S, FS, C) {
  doc.setDrawColor(196, 178, 155);
  doc.setLineWidth(0.25);
  doc.setLineDash([1.8, 1.2]);
  doc.line(mg, fy, pw - mg, fy);
  doc.setLineDash([]);
  fy += 1.5;
  if (config.footerThanks) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.base - 0.5);
    doc.setTextColor(...C.CUIVRE);
    doc.text(S(config.footerThanks), pw / 2, fy, { align: "center" });
    fy += (FS.base - 0.5) * 0.35 + 1.0;
  }
  if (config.footerLegal) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.tiny - 0.5);
    doc.setTextColor(155, 145, 135);
    doc.splitTextToSize(S(config.footerLegal), lw - 4)
      .forEach(l => { doc.text(l, pw / 2, fy, { align: "center" }); fy += (FS.tiny - 0.5) * 0.35 + 0.6; });
  }
  if (entreprise.rc || entreprise.nif) {
    const f = [
      entreprise.rc  ? "RC : "  + entreprise.rc  : null,
      entreprise.nif ? "NIF : " + entreprise.nif : null,
    ].filter(Boolean).join("  |  ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.tiny - 1);
    doc.setTextColor(170, 160, 150);
    doc.text(S(f), pw / 2, fy, { align: "center" });
    fy += (FS.tiny - 1) * 0.35 + 0.5;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5);
  doc.setTextColor(210, 205, 200);
  doc.text("FacturaPro", pw / 2, fy, { align: "center" });
}

/* ══════════════════════════════════════════════════════
   NUMÉROS DE PAGE — passe finale
   Écrit "X / N" sur toutes les pages avec le vrai total
══════════════════════════════════════════════════════ */
function _drawPageNumbers(doc, totalPages, pw, mg, footerY, FS) {
  if (totalPages <= 1) return;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.tiny - 0.5);
    doc.setTextColor(..._C.MUTED);
    doc.text(i + " / " + totalPages, pw - mg, footerY - 1.5, { align: "right" });
  }
}

/* ══════════════════════════════════════════════════════
   MINI-HEADER pages 2+
   Retourne la hauteur occupée en mm
══════════════════════════════════════════════════════ */
function _drawMiniHeader(doc, mg, pw, FS, typeLabel, data, entreprise, S) {
  const y = mg + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.tiny);
  doc.setTextColor(..._C.MUTED);
  doc.text(
    S((entreprise.nom ?? "") + "  —  " + typeLabel + "  N° " + (data.numero ?? "")),
    mg, y + FS.tiny * 0.38
  );
  doc.setDrawColor(..._C.GRIS_LINE);
  doc.setLineWidth(0.2);
  doc.line(mg, y + FS.tiny * 0.38 + 2, pw - mg, y + FS.tiny * 0.38 + 2);
  return FS.tiny * 0.38 + 4;
}

/* ══════════════════════════════════════════════════════
   "/ Suite page suivante /" en bas du tableau
   pages 1..N-1 quand le tableau s'étale sur plusieurs pages
══════════════════════════════════════════════════════ */
function _drawSuitePage(doc, cursorY, pw, mg, FS) {
  const y = cursorY + 2;
  // Filet léger sous le tableau
  doc.setDrawColor(196, 178, 155);
  doc.setLineWidth(0.2);
  doc.setLineDash([1.5, 1.0]);
  doc.line(mg, y, pw - mg, y);
  doc.setLineDash([]);
  // Texte "Suite page suivante"
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FS.tiny);
  doc.setTextColor(..._C.MUTED);
  doc.text("/ Suite page suivante /", pw - mg, y + 3.5, { align: "right" });
}

/* ══════════════════════════════════════════════════════
   SIGNATURE
══════════════════════════════════════════════════════ */
function _drawSignature(doc, sY, mg, lw, pw, config, S, FS, signH, C) {
  const isTh = pw <= 82;
  if (isTh) {
    const boxH    = signH - 2;
    const labelH  = FS.tiny * 0.4 + 1;
    const imgAreaH = boxH - labelH - 3;
    doc.setFillColor(...C.GRIS_BG);
    doc.rect(mg, sY, lw, boxH, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(...C.MUTED);
    doc.text("SIGNATURE VENDEUR", mg + lw / 2, sY + FS.tiny * 0.38 + 1, { align: "center" });
    if (config.signatureUrl) {
      try {
        const iw = lw * 0.70, ih = Math.min(imgAreaH, iw * 0.4);
        doc.addImage(config.signatureUrl, "PNG",
          mg + (lw - iw) / 2, sY + labelH + 2 + (imgAreaH - ih) / 2, iw, ih, undefined, "FAST");
      } catch (_) {
        doc.setDrawColor(...C.MUTED); doc.setLineWidth(0.4);
        doc.line(mg + 4, sY + boxH - 3, mg + lw * 0.55, sY + boxH - 3);
      }
    } else {
      doc.setDrawColor(...C.MUTED); doc.setLineWidth(0.4);
      doc.line(mg + 4, sY + boxH - 3, mg + lw * 0.55, sY + boxH - 3);
    }
    return;
  }
  const gap    = pw <= 148 ? 4 : 6; // gap plus petit en A5
  const bW     = (lw - gap) / 2;
  const bH     = signH - 3;
  const xL     = mg;
  const xR     = mg + bW + gap;
  const labelH = FS.tiny * 0.38 + 2;
  const imgAreaY = sY + 3 + labelH;
  const imgAreaH = bH - labelH - 2;

  doc.setDrawColor(...C.GRIS_LINE); doc.setLineWidth(0.2);
  doc.line(mg, sY, pw - mg, sY);

  // Bloc gauche — signature
  doc.setFillColor(...C.GRIS_BG); doc.setDrawColor(...C.GRIS_LINE); doc.setLineWidth(0.2);
  doc.roundedRect(xL, sY + 2, bW, bH, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(...C.MUTED);
  doc.text("SIGNATURE VENDEUR", xL + bW / 2, sY + 2 + labelH * 0.8, { align: "center" });
  if (config.signatureUrl) {
    try {
      const iw = bW * 0.75, ih = Math.min(imgAreaH, iw * 0.35);
      doc.addImage(config.signatureUrl, "PNG",
        xL + (bW - iw) / 2, imgAreaY + (imgAreaH - ih) / 2, iw, ih, undefined, "FAST");
    } catch (_) {
      doc.setDrawColor(...C.MUTED); doc.setLineWidth(0.5);
      doc.line(xL + 6, sY + 2 + bH - 3, xL + bW - 6, sY + 2 + bH - 3);
    }
  } else {
    doc.setDrawColor(...C.MUTED); doc.setLineWidth(0.5);
    doc.line(xL + 6, sY + 2 + bH - 3, xL + bW - 6, sY + 2 + bH - 3);
  }

  // Bloc droit — cachet
  doc.setFillColor(...C.GRIS_BG); doc.setDrawColor(...C.GRIS_LINE); doc.setLineWidth(0.2);
  doc.roundedRect(xR, sY + 2, bW, bH, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(...C.MUTED);
  doc.text("CACHET DE LA SOCIÉTÉ", xR + bW / 2, sY + 2 + labelH * 0.8, { align: "center" });
  if (config.cachetUrl) {
    try {
      const ih = Math.min(imgAreaH * 0.88, bW * 0.65), iw = ih;
      doc.addImage(config.cachetUrl, "PNG",
        xR + (bW - iw) / 2, imgAreaY + (imgAreaH - ih) / 2, iw, ih, undefined, "FAST");
    } catch (_) {
      doc.setDrawColor(...C.MUTED); doc.setLineWidth(0.5);
      doc.line(xR + 6, sY + 2 + bH - 3, xR + bW - 6, sY + 2 + bH - 3);
    }
  } else {
    doc.setDrawColor(...C.MUTED); doc.setLineWidth(0.5);
    doc.line(xR + 6, sY + 2 + bH - 3, xR + bW - 6, sY + 2 + bH - 3);
  }
}

/* ══════════════════════════════════════════════════════
   FONCTION PRINCIPALE
══════════════════════════════════════════════════════ */
function genererPDF(data, entreprise, config) {
  const { jsPDF } = window.jspdf;
  const S = str => sanitizePdf(str);

  /* ── Format + tokens adaptatifs ─────────────────── */
  const fmt_ = config.format ?? "thermal";
  const isTh = fmt_ === "thermal";
  const isA4 = fmt_ === "a4";
  const isA5 = !isTh && !isA4;

  // Dimensions page
  let pw, ph_pg;
  if (isA4)       { pw = 210; ph_pg = 297; }
  else if (!isTh) { pw = 148; ph_pg = 210; }
  else            { pw = 80;  ph_pg = 0;   }

  // Tokens calibrés par format
  const T     = _getTokens(fmt_);
  const FS    = T.FS;
  const RH    = T.RH;
  const mg    = T.mg;
  const fMg   = T.fMg;
  const logoH = T.logoH;
  const signH = config.showSign ? T.signH : 0;
  const lw    = pw - 2 * mg;

  /* ── Devise ─────────────────────────────────────── */
  const dev  = config.devise ?? entreprise.devise ?? "F CFA";
  const fAmt = n => {
    const s = _fmtNum(n);
    return config.devisePos === "before" ? dev + " " + s : s + " " + dev;
  };

  /* ── Date ───────────────────────────────────────── */
  const dObj = data.date instanceof Date ? data.date : toDateObj(data.date);
  const dStr = String(dObj.getDate()).padStart(2, "0") + "/" +
               String(dObj.getMonth() + 1).padStart(2, "0") + "/" + dObj.getFullYear();
  const tStr = String(dObj.getHours()).padStart(2, "0") + "h" +
               String(dObj.getMinutes()).padStart(2, "0");

  /* ── Données ────────────────────────────────────── */
  const lignes   = Array.isArray(data.lignes) ? data.lignes : [];
  const client   = data.client ?? {};
  const hasTva   = !!data.applyTva;
  const hasRem   = (data.remiseMt ?? 0) > 0;
  const hasRendu = (data.montantRecu ?? 0) > 0 && data.type !== "devis";

  /* ── Totaux ─────────────────────────────────────── */
  let totCnt = 1;
  if (hasTva || hasRem) totCnt++;
  if (hasRem)           totCnt++;
  if (hasTva)           totCnt++;
  if (hasRendu)         totCnt += 2;
  const totH = totCnt * RH.tot + 2;

  /* ── Footer ─────────────────────────────────────── */
  const FH      = _calcFooterH(config, entreprise, FS);
  const footerY = isTh ? 9999 : ph_pg - fMg - FH;

  /* ── Type document ──────────────────────────────── */
  const typeLabels = { facture: "FACTURE", recu: "RECU DE PAIEMENT", devis: "DEVIS / PRO FORMA" };
  const typeLabel  = typeLabels[data.type] ?? "DOCUMENT";
  const typeColor  = data.type === "recu"  ? _C.VERT_TXT :
                     data.type === "devis" ? _C.GOLD     : _C.BLEU;

  /* ── Mini-header height ─────────────────────────── */
  const MH_H = FS.tiny * 0.38 + 4;

  /* ── Colonnes tableau ───────────────────────────── */
  // Colonne REM : affichée seulement si le paramètre est activé
  // ET qu'au moins 1 article a une remise individuelle > 0
  const hasAnyRemiseLigne = lignes.some(l => (l.remise ?? 0) > 0);
  const showRem = (config.showRef ?? false) && hasAnyRemiseLigne;

  /* ── Estimation totalNeed ───────────────────────── */
  function _estimTotalNeed() {
    const txt = "Arrêté à la somme de : " + _nombreEnLettres(data.total ?? 0);
    const cpl = isTh ? 32 : isA4 ? 70 : 42;
    const lc  = Math.max(1, Math.ceil(txt.length / cpl));
    const lH  = lc * (FS.lettr * 0.40 + 1.8) + 5;
    const nH  = data.note
      ? Math.ceil(data.note.length / (isTh ? 28 : 50)) * (FS.small * 0.38 + 1.5) + 5 : 0;
    const sG  = (signH > 0 && !isTh) ? signH + 4 : 0;
    return totH + lH + (nH ? nH + 2 : 0) + sG + 5;
  }
  const totalNeedEstim = _estimTotalNeed();

  /* ── Thermique — hauteur dynamique ─────────────── */
  function calcThH() {
    let h = mg;
    if (config.showLogo !== false && entreprise.logoUrl) h += logoH + 2;
    h += FS.big * 0.4 + 3;
    if (entreprise.slogan) h += FS.small * 0.4 + 2;
    const cl = [
      [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
      [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
      entreprise.email, entreprise.web,
    ].filter(Boolean);
    h += cl.length * (FS.small * 0.4 + 1.8) + 5;
    h += FS.title * 0.4 + 4;
    let bl = 0;
    if (client.nom) bl++; if (client.tel) bl++;
    if (client.email) bl++; if (client.adresse) bl++;
    if (config.showDate !== false) bl++;
    h += bl * RH.box + 5;
    h += RH.th + Math.max(lignes.length, 5) * RH.art + 3;
    h += totalNeedEstim + FH + mg + 3;
    return Math.max(h, 80);
  }

  /* ── Création document ──────────────────────────── */
  const ph  = isTh ? calcThH() : ph_pg;
  const doc = new jsPDF({
    unit: "mm", format: isTh ? [pw, ph] : (isA4 ? "a4" : "a5"), orientation: "portrait",
  });
  let y = mg;

  /* ── Helper page de résumé ──────────────────────── */
  function ajouterPageResume() {
    doc.addPage();
    _drawFooter(doc, footerY, mg, lw, pw, config, entreprise, S, FS, _C);
    _drawMiniHeader(doc, mg, pw, FS, typeLabel, data, entreprise, S);
    return mg + MH_H + 2;
  }

  /* ══════════════════════════════════════════════════
     S1 — HEADER ENTREPRISE
  ══════════════════════════════════════════════════ */
  if (!isTh && config.showCompany !== false) {
    const hasL = config.showLogo !== false && entreprise.logoUrl;
    const iX   = mg + (hasL ? logoH + 4 : 0);
    const topY = y;
    if (hasL) {
      try { doc.addImage(entreprise.logoUrl, "JPEG", mg, y, logoH, logoH, undefined, "FAST"); }
      catch (_) {}
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.big); doc.setTextColor(..._C.NOIR);
    doc.text(S(entreprise.nom ?? "Mon Entreprise"), iX, y + FS.big * 0.38);
    let iy = y + FS.big * 0.38 + 2;
    if (entreprise.slogan) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(FS.small); doc.setTextColor(..._C.CUIVRE);
      doc.text(S(entreprise.slogan), iX, iy);
      iy += FS.small * 0.38 + (isA4 ? 2 : 1.2);
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
    [
      [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
      [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
      entreprise.email, entreprise.web,
    ].filter(Boolean).forEach(l => {
      doc.text(S(l), iX, iy);
      iy += FS.small * 0.38 + (isA4 ? 1.8 : 1.2);
    });
    y = Math.max(topY + logoH, iy) + (isA4 ? 4 : 2.5);
  } else if (isTh && config.showCompany !== false) {
    if (config.showLogo !== false && entreprise.logoUrl) {
      try { doc.addImage(entreprise.logoUrl, "JPEG", pw / 2 - logoH / 2, y, logoH, logoH, undefined, "FAST"); y += logoH + 2; }
      catch (_) {}
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.big); doc.setTextColor(..._C.NOIR);
    doc.text(S(entreprise.nom ?? "Mon Entreprise"), pw / 2, y + FS.big * 0.38, { align: "center" });
    y += FS.big * 0.38 + 2.5;
    if (entreprise.slogan) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(FS.small); doc.setTextColor(..._C.CUIVRE);
      doc.text(S(entreprise.slogan), pw / 2, y, { align: "center" });
      y += FS.small * 0.38 + 2;
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
    [
      [entreprise.adresse, entreprise.ville, entreprise.pays].filter(Boolean).join(", "),
      [entreprise.tel, entreprise.tel2].filter(Boolean).join(" / "),
      entreprise.email, entreprise.web,
    ].filter(Boolean).forEach(l => { doc.text(S(l), pw / 2, y, { align: "center" }); y += FS.small * 0.38 + 1.8; });
    y += 1;
  }

  // Filet double cuivre
  doc.setDrawColor(..._C.CUIVRE); doc.setLineWidth(0.6); doc.line(mg, y, pw - mg, y);
  doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.15); doc.line(mg, y + 1.2, pw - mg, y + 1.2);
  y += isA4 ? 5 : (isA5 ? 2.5 : 2.5);

  /* ══════════════════════════════════════════════════
     S2 — TITRE
  ══════════════════════════════════════════════════ */
  if (!isTh) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.title); doc.setTextColor(..._C.NOIR);
    doc.text(typeLabel, mg, y + FS.title * 0.38);
    const bW = isA4 ? 38 : 28, bH = isA4 ? 8 : 6;
    doc.setFillColor(...typeColor); doc.roundedRect(pw - mg - bW, y, bW, bH, 2, 2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(..._C.BLANC);
    doc.text(typeLabel, pw - mg - bW / 2, y + bH * 0.65, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
    doc.text("N° " + S(data.numero ?? "—"), mg, y + FS.title * 0.38 + FS.small * 0.38 + 1.5);
    y += FS.title * 0.38 + FS.small * 0.38 + (isA4 ? 7 : 4);
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.title); doc.setTextColor(..._C.NOIR);
    doc.text(typeLabel, pw / 2, y + FS.title * 0.38, { align: "center" });
    y += FS.title * 0.38 + 2;
    doc.setFont("helvetica", "normal"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
    doc.text("N° " + S(data.numero ?? "—"), pw / 2, y, { align: "center" });
    y += FS.small * 0.38 + 2.5;
  }

  /* ══════════════════════════════════════════════════
     S3 — CLIENT / INFORMATIONS
  ══════════════════════════════════════════════════ */
  if (!isTh) {
    const sec3Y = y;
    const cW = lw * 0.50, iW = lw * 0.44, gap = lw * 0.06, xI = mg + cW + gap;
    const hasC = client.nom || client.tel || client.email || client.adresse;
    if (hasC) {
      doc.setFillColor(..._C.GRIS_TH); doc.roundedRect(mg, y, cW, RH.box, 1, 1, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(..._C.BLANC);
      doc.text("FACTURER À", mg + 2.5, y + RH.box * 0.65);
      y += RH.box;
      const cRows = [
        client.nom     ? { t: client.nom,            bold: true  } : null,
        client.tel     ? { t: "Tél : " + client.tel, bold: false } : null,
        client.email   ? { t: client.email,           bold: false } : null,
        client.adresse ? { t: client.adresse,         bold: false } : null,
      ].filter(Boolean);
      const cBH = cRows.length * RH.box + 1.5;
      doc.setFillColor(..._C.GRIS_BG); doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.2);
      doc.rect(mg, y, cW, cBH, "FD");
      let cy = y + 1.5;
      cRows.forEach(r => {
        doc.setFont("helvetica", r.bold ? "bold" : "normal");
        doc.setFontSize(FS.small); doc.setTextColor(..._C.NOIR);
        doc.text(doc.splitTextToSize(S(r.t), cW - 4)[0], mg + 2.5, cy + RH.box * 0.55);
        cy += RH.box;
      });
      y = sec3Y + RH.box + cBH + (isA4 ? 3 : 2);
    }
    let dy = sec3Y;
    doc.setFillColor(..._C.NOIR); doc.roundedRect(xI, dy, iW, RH.box, 1, 1, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(..._C.BLANC);
    doc.text("INFORMATIONS", xI + 2.5, dy + RH.box * 0.65);
    dy += RH.box;
    const iRows = [
      { l: "Date",       v: dStr + "  " + tStr },
      { l: "N° Facture", v: data.numero ?? "—" },
      data.paiement && data.type !== "devis" ? { l: "Paiement", v: _pmode(data.paiement) } : null,
    ].filter(Boolean);
    const iBH = iRows.length * RH.box + 1.5;
    doc.setFillColor(..._C.GRIS_BG); doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.2);
    doc.rect(xI, dy, iW, iBH, "FD");
    let iy2 = dy + 1.5;
    iRows.forEach(r => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(FS.tiny); doc.setTextColor(..._C.MUTED);
      doc.text(S(r.l), xI + 2.5, iy2 + RH.box * 0.55);
      doc.setFont("helvetica", "bold"); doc.setFontSize(FS.small); doc.setTextColor(..._C.NOIR);
      doc.text(S(r.v), xI + iW - 2, iy2 + RH.box * 0.55, { align: "right" });
      iy2 += RH.box;
    });
    y = Math.max(y, sec3Y + RH.box + iBH + (isA4 ? 3 : 2));
  } else {
    const r3 = [
      config.showDate !== false ? { l: "Date:",    v: dStr + " " + tStr } : null,
      client.nom     ? { l: "Client:",  v: client.nom     } : null,
      client.tel     ? { l: "Tél:",     v: client.tel     } : null,
      client.email   ? { l: "Email:",   v: client.email   } : null,
      client.adresse ? { l: "Adresse:", v: client.adresse } : null,
    ].filter(Boolean);
    if (r3.length) {
      doc.setFillColor(..._C.GRIS_BG);
      doc.rect(mg, y, lw, r3.length * RH.box + 2, "F");
      let ty = y + 2;
      r3.forEach(r => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
        doc.text(r.l, mg + 1, ty + RH.box * 0.6);
        doc.setFont("helvetica", "bold"); doc.setTextColor(..._C.NOIR);
        doc.text(S(r.v), pw - mg - 1, ty + RH.box * 0.6, { align: "right" });
        ty += RH.box;
      });
      y += r3.length * RH.box + 3;
    }
  }
  y += isA4 ? 2 : 1.5;

  /* ══════════════════════════════════════════════════
     S4 — TABLEAU (autoTable)

     bottomNeed = footer seulement
     → autoTable remplit la page au maximum
     → les totaux sont vérifiés APRÈS (post-autoTable)
  ══════════════════════════════════════════════════ */
  const cols = [];
  const colWidths = {};
  if (!isTh) {
    const pDes = showRem ? 0.44 : 0.52, pQte = 0.09;
    const pPU  = showRem ? 0.18 : 0.20, pRem = showRem ? 0.10 : 0, pTot = 0.19;
    cols.push({ header: "DÉSIGNATION", dataKey: "des" });
    cols.push({ header: "QTÉ",         dataKey: "qte" });
    cols.push({ header: "P.U.",        dataKey: "pu"  });
    if (showRem) cols.push({ header: "REM", dataKey: "rem" });
    cols.push({ header: "MONTANT",     dataKey: "tot" });
    colWidths["des"] = lw * pDes; colWidths["qte"] = lw * pQte;
    colWidths["pu"]  = lw * pPU;  if (showRem) colWidths["rem"] = lw * pRem;
    colWidths["tot"] = lw * pTot;
  } else {
    cols.push({ header: "DÉSIGNATION", dataKey: "des" });
    cols.push({ header: "QTÉ",         dataKey: "qte" });
    cols.push({ header: "P.U.",        dataKey: "pu"  });
    cols.push({ header: "MONTANT",     dataKey: "tot" });
    colWidths["des"] = lw * 0.40; colWidths["qte"] = lw * 0.10;
    colWidths["pu"]  = lw * 0.25; colWidths["tot"] = lw * 0.25;
  }

  const rows = lignes.map(l => {
    const tot = l.qte * l.prix * (1 - (l.remise ?? 0) / 100);
    const row = { des: S(l.des || "—"), qte: String(l.qte), pu: _fmtNum(l.prix), tot: _fmtNum(tot) };
    if (showRem) row.rem = (l.remise ?? 0) > 0 ? l.remise + "%" : "";
    return row;
  });

  // bottomNeed = footer seulement (autoTable remplit la page)
  const bottomNeed = isTh ? 0 : FH + fMg + 5;

  // MIN_ROWS dynamique selon espace réel
  let MIN_ROWS = 0;
  if (!isTh) {
    const esp = ph_pg - bottomNeed - y - RH.th;
    const lMax = Math.floor(esp / RH.art);
    if (lMax > lignes.length) {
      const cap = isA4 ? 10 : 5;
      MIN_ROWS = Math.min(lMax, Math.max(lignes.length, cap));
    }
  }
  if (!isTh && rows.length < MIN_ROWS) {
    const empty = { des: "", qte: "", pu: "", tot: "" };
    if (showRem) empty.rem = "";
    while (rows.length < MIN_ROWS) rows.push({ ...empty });
  }

  const columnStyles = {};
  columnStyles["des"] = { cellWidth: colWidths["des"], halign: "left"   };
  columnStyles["qte"] = { cellWidth: colWidths["qte"], halign: "center" };
  columnStyles["pu"]  = { cellWidth: colWidths["pu"],  halign: "right"  };
  columnStyles["tot"] = { cellWidth: colWidths["tot"], halign: "right", fontStyle: "bold" };
  if (showRem) columnStyles["rem"] = { cellWidth: colWidths["rem"], halign: "center" };

  const marginTop = isTh ? mg : (mg + MH_H + 2);
  const _pageCursors = {};

  doc.autoTable({
    startY:       y,
    margin:       { left: mg, right: mg, top: marginTop, bottom: bottomNeed },
    columns:      cols,
    body:         rows,
    rowPageBreak: "auto",
    styles: {
      fontSize:    FS.base,
      cellPadding: isA5
        ? { top: 1.0, bottom: 1.0, left: 1.5, right: 1.5 }
        : { top: 1.2, bottom: 1.2, left: 2,   right: 2   },
      lineColor:   _C.GRIS_LINE,
      lineWidth:   0.1,
      textColor:   _C.NOIR,
      font:        "helvetica",
    },
    headStyles: {
      fillColor:   _C.GRIS_TH,
      textColor:   _C.BLANC,
      fontStyle:   "bold",
      fontSize:    FS.small,
      cellPadding: isA5
        ? { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 }
        : { top: 1.8, bottom: 1.8, left: 2,   right: 2   },
      lineWidth:   0,
    },
    alternateRowStyles: { fillColor: _C.GRIS_ALT },
    columnStyles: columnStyles,

    didDrawPage: (hookData) => {
      if (!isTh) {
        const pgNum = hookData.pageNumber;
        const tbl   = hookData.table;
        if (hookData.cursor) _pageCursors[pgNum] = hookData.cursor.y;

        // Bordure tableau
        if (tbl) {
          const tX = tbl.settings.margin.left;
          const tY = pgNum === 1 ? tbl.startY : tbl.settings.margin.top;
          const tW = pw - tbl.settings.margin.left - tbl.settings.margin.right;
          const tH = hookData.cursor ? hookData.cursor.y - tY : 0;
          if (tW > 0 && tH > 0) {
            doc.setDrawColor(..._C.NOIR2); doc.setLineWidth(0.3);
            doc.rect(tX, tY, tW, tH);
          }
        }

        // Footer
        _drawFooter(doc, footerY, mg, lw, pw, config, entreprise, S, FS, _C);

        // Mini-header pages 2+
        if (pgNum > 1) _drawMiniHeader(doc, mg, pw, FS, typeLabel, data, entreprise, S);
      }
    },
  });

  /* ══════════════════════════════════════════════════
     POST-AUTOTABLE

     [FIX 1] "Suite page suivante" sur pages intermédiaires
     [FIX 2] Numéros de page en passe finale
  ══════════════════════════════════════════════════ */
  const pagesAutoTable = doc.getNumberOfPages();

  // "Suite page suivante" sur toutes les pages sauf la dernière du tableau
  if (!isTh && pagesAutoTable > 1) {
    for (let pg = 1; pg < pagesAutoTable; pg++) {
      doc.setPage(pg);
      const cur = _pageCursors[pg];
      if (cur) _drawSuitePage(doc, cur, pw, mg, FS);
    }
    doc.setPage(pagesAutoTable);
  }

  /* ══════════════════════════════════════════════════
     S5 — TOTAUX + ARRÊTÉ + NOTE + SIGNATURE
  ══════════════════════════════════════════════════ */
  y = doc.lastAutoTable.finalY + 2.5;

  // Calcul exact des hauteurs
  const lettresTxt = "Arrêté à la somme de : " + _nombreEnLettres(data.total ?? 0);
  const lLines     = doc.splitTextToSize(S(lettresTxt), lw - 6);
  const lettresH   = lLines.length * (FS.lettr * 0.40 + 1.8) + 5;
  const noteH      = data.note
    ? Math.ceil(data.note.length / (isTh ? 28 : 48)) * (FS.small * 0.38 + 1.5) + 5 : 0;
  const signGap    = (signH > 0 && !isTh) ? signH + 4 : 0;
  const totalNeed  = totH + lettresH + (noteH ? noteH + 2 : 0) + signGap + 4;

  if (!isTh) {
    // Les totaux collent directement sous le tableau — pas d'ancrage vers le bas
    // L'ancrage créait un grand vide blanc entre le tableau et les totaux
    // Le vide résiduel (entre totaux et footer) est naturel et professionnel

    // Vérification : page de résumé si les totaux ne rentrent pas
    if (y + totalNeed > footerY - 2) {
      y = ajouterPageResume();
    }
  }

  // Note à gauche
  if (data.note && !isTh) {
    const nW  = lw * 0.50;
    const nSp = doc.splitTextToSize("Note : " + S(data.note), nW - 4);
    const nH  = nSp.length * (FS.small * 0.38 + 1.5) + 5;
    doc.setFillColor(..._C.GRIS_BG); doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.2);
    doc.roundedRect(mg, y, nW, nH, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "italic"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
    let ny = y + 3;
    nSp.forEach(l => { doc.text(l, mg + 2, ny); ny += FS.small * 0.38 + 1.5; });
  }

  // Bloc totaux
  const tW = isTh ? lw : lw * 0.43;
  const tX = isTh ? mg : pw - mg - tW - 1;
  const vX = tX + tW;
  doc.setDrawColor(..._C.NOIR2); doc.setLineWidth(0.3);
  doc.rect(tX, y, tW, totH);

  let ty = y;
  const drawTL = (lbl, val, opts = {}) => {
    const { bgCol, txtCol, lblCol, bold = false, big = false, noLine = false } = opts;
    const rh = big ? RH.tot * 1.2 : RH.tot;
    if (bgCol) { doc.setFillColor(...bgCol); doc.rect(tX, ty, tW, rh, "F"); }
    if (!noLine && ty > y) {
      doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.1); doc.line(tX, ty, tX + tW, ty);
    }
    const sx = tX + tW * 0.52;
    doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.1); doc.line(sx, ty, sx, ty + rh);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(big ? FS.base + 0.5 : FS.small); doc.setTextColor(...(lblCol ?? _C.MUTED));
    doc.text(S(lbl), tX + 2.5, ty + rh * 0.64);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(big ? FS.base + 0.5 : FS.small); doc.setTextColor(...(txtCol ?? _C.NOIR));
    doc.text(S(val), vX - 2, ty + rh * 0.64, { align: "right" });
    ty += rh;
  };

  if (hasTva || hasRem) drawTL("Sous-total HT", fAmt(data.ht));
  if (hasRem) drawTL("Remise " + data.remise + "%", "- " + fAmt(data.remiseMt), { txtCol: _C.ROUGE });
  if (hasTva) drawTL("TVA " + data.tvaRate + "%", fAmt(data.tvaMt));
  drawTL("TOTAL" + (hasTva ? " TTC" : ""), fAmt(data.total),
    { bgCol: _C.TOT_BG, txtCol: _C.TOT_TXT, lblCol: _C.TOT_LBL, bold: true, big: true, noLine: true });
  if (hasRendu) {
    const rendu = (data.montantRecu ?? 0) - (data.total ?? 0);
    drawTL("Montant reçu",  fAmt(data.montantRecu), { bgCol: [245, 247, 250], txtCol: _C.MUTED });
    drawTL("Rendu monnaie", fAmt(rendu),             { bgCol: _C.VERT_BG, txtCol: _C.VERT_TXT, lblCol: _C.VERT_TXT, bold: true });
  }
  y = ty + 2.5;

  // Arrêté en lettres
  const lH = lLines.length * (FS.lettr * 0.40 + 1.8) + 5;
  doc.setFillColor(245, 247, 250); doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.2);
  doc.roundedRect(mg, y, lw, lH, 2, 2, "FD");
  doc.setFont("helvetica", "bolditalic"); doc.setFontSize(FS.lettr); doc.setTextColor(..._C.NOIR);
  let lly = y + 3.5;
  lLines.forEach(l => { doc.text(l, mg + 3, lly); lly += FS.lettr * 0.40 + 1.8; });
  y += lH + 2;

  // Note thermique
  if (data.note && isTh) {
    const nL  = doc.splitTextToSize("Note : " + S(data.note), lw);
    const nBH = nL.length * (FS.small * 0.38 + 1.5) + 5;
    doc.setFillColor(..._C.GRIS_BG); doc.setDrawColor(..._C.GRIS_LINE); doc.setLineWidth(0.2);
    doc.roundedRect(mg, y, lw, nBH, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "italic"); doc.setFontSize(FS.small); doc.setTextColor(..._C.MUTED);
    let ny = y + 3;
    nL.forEach(l => { doc.text(l, mg + 2, ny); ny += FS.small * 0.38 + 1.5; });
    y += nBH + 2.5;
  }

  /* ══════════════════════════════════════════════════
     S6 — SIGNATURE
  ══════════════════════════════════════════════════ */
  if (config.showSign && signH > 0) {
    if (isTh) {
      y += 3;
      _drawSignature(doc, y, mg, lw, pw, config, S, FS, T.signH, _C);
      y += T.signH + 2;
    } else {
      y += 3;
      if (y + signH > footerY - 2) y = ajouterPageResume();
      _drawSignature(doc, y, mg, lw, pw, config, S, FS, signH, _C);
      y += signH;
    }
  }

  /* ══════════════════════════════════════════════════
     S7 — FOOTER thermique
  ══════════════════════════════════════════════════ */
  if (isTh) {
    _drawFooter(doc, y + 2, mg, lw, pw, config, entreprise, S, FS, _C);
  }

  /* ══════════════════════════════════════════════════
     PASSE FINALE — numéros de page sur TOUTES les pages
     On connaît maintenant le vrai total de pages
  ══════════════════════════════════════════════════ */
  if (!isTh) {
    const totalDocPages = doc.getNumberOfPages();
    _drawPageNumbers(doc, totalDocPages, pw, mg, footerY, FS);
    doc.setPage(totalDocPages);
  }

  const fname = S(data.numero ?? "doc") + "_" +
    S((entreprise.nom ?? "facture").replace(/\s+/g, "_")) + ".pdf";
  doc.save(fname);
  return fname;
}
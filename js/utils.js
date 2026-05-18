// ══════════════════════════════════════════════════════
//  utils.js  —  FacturaPro
//  Fonctions utilitaires GLOBALES
//  Chargé EN PREMIER (avant tout autre script)
//  → Résout : crash si ordre de chargement modifié
//  → Résout : escH() dupliqué dans print.js (risque XSS)
//  → Résout : fmt() / escHtml() non globaux
// ══════════════════════════════════════════════════════

"use strict";

// ─────────────────────────────────────────────────────
//  ÉCHAPPEMENT HTML — source unique de vérité
//  (remplace escH() dans print.js et escHtml() dans app.js)
// ─────────────────────────────────────────────────────

window.escHtml = function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
};

// Alias identique pour print.js (autonomie préservée)
window.escH = window.escHtml;

// ─────────────────────────────────────────────────────
//  FORMATAGE MONTANT
//  Dépend de config/entreprise — objets chargés après,
//  donc on lit au moment de l'appel, pas à l'init.
// ─────────────────────────────────────────────────────

window.fmt = function fmt(n) {
  const cfg = window.config    ?? {};
  const ent = window.entreprise ?? {};
  const dev = cfg.devise    ?? ent.devise ?? "F CFA";
  const pos = cfg.devisePos ?? "after";
  // F CFA = entier, pas de décimale affichée
  const num = Number(n ?? 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
  });
  return pos === "before" ? `${dev}\u00A0${num}` : `${num}\u00A0${dev}`;
};

// ─────────────────────────────────────────────────────
//  FORMATAGE DATE
// ─────────────────────────────────────────────────────

window.fmtDate = function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day:    "2-digit",
    month:  "2-digit",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
};

// ─────────────────────────────────────────────────────
//  CONVERSION TIMESTAMP → Date JS (gère Firestore + ISO)
// ─────────────────────────────────────────────────────

window.toDateObj = function toDateObj(ts) {
  if (!ts) return new Date(0);
  if (ts?.toDate) return ts.toDate();      // Firestore Timestamp
  if (ts instanceof Date) return ts;
  return new Date(ts);
};

// ─────────────────────────────────────────────────────
//  GÉNÉRATION NUMÉRO DOCUMENT
// ─────────────────────────────────────────────────────

window.genNumero = function genNumero(type, counter) {
  const prefix = { facture: "FAC", recu: "REC", devis: "DEV" }[type] ?? "DOC";
  const now = new Date();
  const yy  = now.getFullYear().toString().slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${yy}${mm}-${String(counter).padStart(4, "0")}`;
};

// ─────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────

window.toast = function toast(msg, type = "ok", dur = 3800) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent   = msg;
  el.className     = `toast ${type}`;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, dur);
};

// ─────────────────────────────────────────────────────
//  LOADER
// ─────────────────────────────────────────────────────

window.loader = function loader(show) {
  document.getElementById("loader")?.classList.toggle("active", show);
};

// ─────────────────────────────────────────────────────
//  SANITISATION TEXTE POUR jsPDF
//  Évite que \, (, ) corrompent le flux PDF
// ─────────────────────────────────────────────────────

window.sanitizePdf = function sanitizePdf(str) {
  return String(str ?? "")
    .replace(/\\/g, "/")
    .replace(/[()]/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); // caractères de contrôle
};

// ─────────────────────────────────────────────────────
//  PARTAGE WHATSAPP NATIF (mobile) + fallback téléchargement
//  → Résout : "Partage WhatsApp = téléchargement seulement"
// ─────────────────────────────────────────────────────

/**
 * Tente le partage natif via Web Share API (mobile),
 * sinon ouvre WhatsApp web avec un message + lien,
 * sinon déclenche simplement le téléchargement.
 *
 * @param {Blob}   blob     — Blob du PDF
 * @param {string} filename — Nom du fichier
 * @param {string} text     — Message WhatsApp
 */
window.partagerPDF = async function partagerPDF(blob, filename, text = "") {
  const file = new File([blob], filename, { type: "application/pdf" });

  // 1. Web Share API avec fichier (Android Chrome, iOS Safari 15+)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text });
      return;
    } catch (e) {
      if (e.name !== "AbortError") console.warn("share:", e);
    }
  }

  // 2. WhatsApp Web (lien texte — le PDF doit être hébergé pour cela,
  //    donc on télécharge d'abord puis ouvre WhatsApp)
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  // Ouvre WhatsApp avec un message d'instruction
  if (text) {
    const wa = `https://wa.me/?text=${encodeURIComponent(text + "\n(PDF téléchargé — joindre manuellement)")}`;
    window.open(wa, "_blank", "noopener");
  }
};
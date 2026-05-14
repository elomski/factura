// ══════════════════════════════════════════════════════
//  js/firebase-config.js  —  FacturaPro  —  Firebase v8 CDN
// ══════════════════════════════════════════════════════

// ⚠️ Pas d'imports ! Firebase est déjà chargé via les scripts CDN dans le HTML

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDrhlfcyuWsll3aDc9bLnxeCIIb_QCF6So",
  authDomain: "factura-9961f.firebaseapp.com",
  projectId: "factura-9961f",
  storageBucket: "factura-9961f.firebasestorage.app",
  messagingSenderId: "31566447499",
  appId: "1:31566447499:web:7e45398fb627878356a58e",
  measurementId: "G-E8RDSTKEE1"
};

// ── Initialisation ──
if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

// ── Services exposés globalement ──
const db   = firebase.firestore();
const auth = firebase.auth();
// const analytics = firebase.analytics(); // Optionnel, décommente si besoin

// ── Export simple pour les autres fichiers (sans bundler) ──
// On attache à window pour que app.js, print.js, etc. puissent y accéder
window.fb = { db, auth, firebase };

// ── Utils rapides ──
window.showToast = (msg, type = 'ok') => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
};

window.showLoader = (show = true) => {
  const loader = document.getElementById('loader');
  if (loader) loader.classList.toggle('active', show);
};
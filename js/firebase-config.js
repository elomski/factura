// ══════════════════════════════════════════════════════
//  js/firebase-config.js  —  FacturaPro  —  Firebase v8 CDN
//
//  ORDRE DE CHARGEMENT dans index.html :
//    1. firebase-app.js        (CDN)
//    2. firebase-firestore.js  (CDN)
//    3. firebase-auth.js       (CDN)
//    4. firebase-config.js     ← CE FICHIER
//    5. utils.js
//    6. print.js / pdf.js / catalogue.js / credits.js
//    7. app.js
// ══════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDrhlfcyuWsll3aDc9bLnxeCIIb_QCF6So",
  authDomain: "factura-9961f.firebaseapp.com",
  projectId: "factura-9961f",
  storageBucket: "factura-9961f.firebasestorage.app",
  messagingSenderId: "31566447499",
  appId: "1:31566447499:web:7e45398fb627878356a58e",
  measurementId: "G-E8RDSTKEE1",
};

// ── Initialisation (guard contre double-init) ──
if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

// ── Firestore : settings() AVANT enablePersistence() ──
const db = firebase.firestore();
db.settings({
  experimentalForceLongPolling: true,
  merge: true,
});

db.enablePersistence({ synchronizeTabs: true })
  .catch(err => {
    if (err.code === "failed-precondition") {
      console.warn("[Firestore] Offline désactivé : plusieurs onglets ouverts.");
    } else if (err.code === "unimplemented") {
      console.warn("[Firestore] Offline non supporté par ce navigateur.");
    } else {
      console.error("[Firestore] Erreur activation offline :", err);
    }
  });

// ── Auth ──
const auth = firebase.auth();

// ── Exposition globale ──
window.db = db;
window.auth = auth;
// Note : Firebase Storage retiré → upload logo via Cloudinary (gratuit, sans carte bancaire)
// Voir la configuration CLOUDINARY_CLOUD_NAME dans index.html
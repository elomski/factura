// ══════════════════════════════════════════════════════
//  js/firebase-config.js  —  FacturaPro  —  Firebase v8 CDN
//
//  ORDRE DE CHARGEMENT dans index.html :
//    1. firebase-app.js        (CDN)
//    2. firebase-firestore.js  (CDN)
//    3. firebase-auth.js       (CDN)
//    4. firebase-storage.js    (CDN)  ← NOUVEAU
//    5. firebase-config.js     ← CE FICHIER
//    6. utils.js
//    7. print.js / pdf.js / catalogue.js / credits.js
//    8. app.js
// ══════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDrhlfcyuWsll3aDc9bLnxeCIIb_QCF6So",
  authDomain:        "factura-9961f.firebaseapp.com",
  projectId:         "factura-9961f",
  storageBucket:     "factura-9961f.firebasestorage.app",
  messagingSenderId: "31566447499",
  appId:             "1:31566447499:web:7e45398fb627878356a58e",
  measurementId:     "G-E8RDSTKEE1",
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

// ── Storage ──
const storage = firebase.storage();

// ── Exposition globale ──
window.db      = db;
window.auth    = auth;
window.storage = storage;

// ════════════════════════════════════════════════════
//  uploadLogo(file) — Upload logo vers Firebase Storage
//  Retourne l'URL publique de téléchargement.
//
//  Utilisation dans index.html :
//    const url = await uploadLogo(file);
//    document.getElementById('p-logo-url').value = url;
// ════════════════════════════════════════════════════
window.uploadLogo = async function uploadLogo(file) {
  if (!window.currentUser) throw new Error("Non connecté.");

  // Valider le type et la taille (max 2 Mo)
  const allowed = ["image/jpeg", "image/png", "image/svg+xml", "image/webp"];
  if (!allowed.includes(file.type))
    throw new Error("Format non supporté. Utilise JPG, PNG, SVG ou WEBP.");
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Fichier trop lourd. Maximum 2 Mo.");

  // Chemin : logos/{uid}/logo_{timestamp}.{ext}
  const ext      = file.name.split(".").pop().toLowerCase() || "png";
  const path     = `logos/${window.currentUser.uid}/logo_${Date.now()}.${ext}`;
  const ref      = storage.ref(path);

  const snapshot = await ref.put(file, { contentType: file.type });
  const url      = await snapshot.ref.getDownloadURL();
  return url;
};
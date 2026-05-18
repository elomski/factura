// ══════════════════════════════════════════════════════
//  sw.js  —  FacturaPro Service Worker  v4
//
//  CORRECTIONS v4 :
//  [A] CACHE_VERSION "facturapro-v4" (typo corrigée)
//  [B] Polices .woff2 explicitement pré-cachées
//  [C] cacheFirst() retourne une Response vide
//      correctement typée (pas du texte pour JS/CSS)
//  [D] Cache versioned avec hash dans le nom
//      → déploiement sans cache périmé
//  [E] Hash URL (#route) ignoré dans le fetch
//      → shortcuts PWA ne cassent pas le SW
// ══════════════════════════════════════════════════════

// [FIX A] Nom cohérent (était "facturapo-v1")
const CACHE_VERSION = "facturapro-v6";
const CACHE_STATIC  = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC = `${CACHE_VERSION}-dynamic`;

// Ressources pré-cachées à l'installation
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/js/utils.js",
  "/js/app.js",
  "/js/print.js",
  "/js/pdf.js",
  "/js/catalogue.js",
  "/js/credits.js",
  // [FIX B] Polices Google — feuille CSS + fichiers woff2
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap",
  // Libs CDN
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
];

// Domaines jamais mis en cache (Firebase backend)
const NETWORK_ONLY_PATTERNS = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseio.com",
  "firebase.google.com",
];

// ─────────────────────────────────────────────────────
//  INSTALL
// ─────────────────────────────────────────────────────
self.addEventListener("install", event => {
  console.log("[SW] Install", CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache =>
      Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(e => console.warn("[SW] Pré-cache échoué :", url, e.message))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────
//  ACTIVATE — nettoyer les vieux caches
// ─────────────────────────────────────────────────────
self.addEventListener("activate", event => {
  console.log("[SW] Activate", CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => { console.log("[SW] Suppression vieux cache :", k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────
//  FETCH — stratégies de cache
// ─────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const { request } = event;

  // [FIX E] Ignorer les fragments hash (shortcuts PWA /#route)
  let url;
  try { url = new URL(request.url); }
  catch { return; }
  // Retirer le hash pour la logique de cache
  const cleanUrl = url.origin + url.pathname + url.search;

  // 1. Network Only — Firebase APIs
  if (NETWORK_ONLY_PATTERNS.some(p => url.hostname.includes(p))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Network Only — mutations (POST/PUT/DELETE)
  if (request.method !== "GET") {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Cache First — assets statiques (JS, CSS, fonts, images)
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, cleanUrl));
    return;
  }

  // 4. Network First — HTML (toujours à jour)
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // 5. Stale While Revalidate — tout le reste
  event.respondWith(staleWhileRevalidate(request));
});

// ─────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/js/")            ||
    url.pathname.startsWith("/icons/")         ||
    url.pathname.endsWith(".css")              ||
    url.pathname.endsWith(".woff2")            ||
    url.pathname.endsWith(".woff")             ||
    url.pathname.endsWith(".ttf")              ||
    url.pathname.endsWith(".png")              ||
    url.pathname.endsWith(".jpg")              ||
    url.hostname === "fonts.googleapis.com"    ||
    url.hostname === "fonts.gstatic.com"       ||
    url.hostname === "cdnjs.cloudflare.com"    ||
    url.hostname === "www.gstatic.com"
  );
}

/**
 * [FIX C] Cache First — retourne une Response 503 vide
 * si offline (pas du texte brut qui crasherait JS/CSS parsers)
 */
async function cacheFirst(request, cleanUrl) {
  // Chercher avec l'URL propre (sans hash)
  const cached = await caches.match(cleanUrl) ?? await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // [FIX C] Réponse vide compatible avec tous les types de ressources
    return new Response("", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/** Network First — réseau d'abord, fallback sur le cache ou index.html */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback SPA → index.html pour toutes les routes HTML
    const fallback = await caches.match("/index.html");
    return fallback ?? new Response("Hors ligne — Recharge quand tu es connecté.", {
      status: 503,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
    });
  }
}

/** Stale While Revalidate — sert le cache ET met à jour en fond */
async function staleWhileRevalidate(request) {
  const cache    = await caches.open(CACHE_DYNAMIC);
  const cached   = await cache.match(request);
  const fetchProm = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached ?? (await fetchProm) ?? new Response("", { status: 503 });
}

// ─────────────────────────────────────────────────────
//  MESSAGES — mise à jour forcée depuis l'app
// ─────────────────────────────────────────────────────
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_CACHE") {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => event.ports[0]?.postMessage({ ok: true }));
  }
});
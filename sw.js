// ══════════════════════════════════════════════════════
//  sw.js  —  FacturaPro Service Worker
//
//  Stratégies de cache :
//  - ASSETS (JS, CSS, fonts, icons) → Cache First
//    → L'app se charge même sans réseau
//  - Pages HTML (index.html)        → Network First
//    → Toujours à jour, fallback sur le cache
//  - Firebase / API                 → Network Only
//    → Les données doivent être fraîches
//
//  À chaque déploiement : incrémente CACHE_VERSION
// ══════════════════════════════════════════════════════

const CACHE_VERSION  = "facturapo-v1";
const CACHE_STATIC   = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC  = `${CACHE_VERSION}-dynamic`;

// Ressources pré-cachées à l'installation
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/js/firebase-config.js",
  "/js/app.js",
  "/js/print.js",
  "/js/pdf.js",
  "/js/catalogue.js",
  "/js/credits.js",
  // Polices Google (si disponibles offline)
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap",
  // Libs CDN
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
];

// Domaines qui ne doivent JAMAIS être mis en cache
const NETWORK_ONLY_PATTERNS = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseio.com",
  "firebase.google.com",
];

// ─────────────────────────────────────────────────────
//  INSTALL — pré-cache des assets
// ─────────────────────────────────────────────────────

self.addEventListener("install", event => {
  console.log("[SW] Install", CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      // On ignore les erreurs individuelles pour ne pas bloquer l'install
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(e => console.warn("[SW] Impossible de pré-cacher :", url, e.message))
        )
      );
    }).then(() => self.skipWaiting())
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
          .filter(key => key !== CACHE_STATIC && key !== CACHE_DYNAMIC)
          .map(key => {
            console.log("[SW] Suppression vieux cache :", key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────
//  FETCH — stratégies de cache
// ─────────────────────────────────────────────────────

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Network Only — Firebase et APIs
  if (NETWORK_ONLY_PATTERNS.some(p => url.hostname.includes(p))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Network Only — requêtes POST/PUT/DELETE (mutations)
  if (request.method !== "GET") {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Cache First — assets JS, CSS, fonts, images
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
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
    url.pathname.startsWith("/js/")   ||
    url.pathname.startsWith("/icons/")||
    url.pathname.endsWith(".css")     ||
    url.pathname.endsWith(".woff2")   ||
    url.pathname.endsWith(".woff")    ||
    url.pathname.endsWith(".ttf")     ||
    url.hostname === "fonts.googleapis.com"     ||
    url.hostname === "fonts.gstatic.com"        ||
    url.hostname === "cdnjs.cloudflare.com"     ||
    url.hostname === "www.gstatic.com"
  );
}

/** Cache First : sert le cache, sinon réseau + mise en cache */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response("Ressource non disponible hors ligne.", { status: 503 });
  }
}

/** Network First : réseau d'abord, fallback sur le cache */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback ultimate : index.html pour les SPA
    const fallback = await caches.match("/index.html");
    return fallback || new Response("Hors ligne — Recharge la page quand tu es connecté.", {
      status: 503,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
    });
  }
}

/** Stale While Revalidate : sert le cache ET met à jour en arrière-plan */
async function staleWhileRevalidate(request) {
  const cache    = await caches.open(CACHE_DYNAMIC);
  const cached   = await cache.match(request);
  const fetchProm = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await fetchProm || new Response("Hors ligne.", { status: 503 });
}

// ─────────────────────────────────────────────────────
//  MESSAGE — mise à jour forcée depuis l'app
// ─────────────────────────────────────────────────────

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_CACHE") {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
    event.ports[0]?.postMessage({ ok: true });
  }
});

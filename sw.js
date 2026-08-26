/* Service worker — «A minha recuperação» */
const VERSAO = "1787768367014";
const CACHE = "recup-" + VERSAO;
const ESTADO = "recup-estado";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["./", "./index.html"]).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== ESTADO).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (er) { return; }
  const mesmaOrigem = url.origin === self.location.origin;
  const cdn = url.hostname === "cdn.jsdelivr.net" || url.hostname === "tessdata.projectnaptha.com";
  if (!mesmaOrigem && !cdn) return; /* Supabase e outros: sempre rede */
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => { try { c.put(req, copia); } catch (er) {} });
        return resp;
      }).catch(() => (mesmaOrigem ? caches.match("./index.html") : Promise.reject(new Error("offline"))));
    })
  );
});

/* A página envia-nos o estado atual para podermos avisar mesmo fechada */
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.tipo === "estado") {
    caches.open(ESTADO).then((c) => c.put("estado.json", new Response(JSON.stringify(d.estado), { headers: { "Content-Type": "application/json" } })));
  }
  if (d.tipo === "notificar") {
    self.registration.showNotification(d.titulo, {
      body: d.corpo, tag: d.tag || "recup", renotify: false,
      icon: d.icon, badge: d.icon, data: { url: "./" },
    });
  }
});

async function lerEstado() {
  try {
    const c = await caches.open(ESTADO);
    const r = await c.match("estado.json");
    return r ? await r.json() : null;
  } catch (e) { return null; }
}

async function verificar() {
  const est = await lerEstado();
  if (!est || !est.lembretes) return;
  const agora = new Date();
  const hhmm = String(agora.getHours()).padStart(2, "0") + ":" + String(agora.getMinutes()).padStart(2, "0");
  const dia = agora.toISOString().slice(0, 10);
  if (est.dia !== dia) return; /* estado velho: a app avisa quando abrir */
  const pend = (est.momentos || []).filter((m) => m.pendentes > 0 && m.hora <= hhmm);
  if (!pend.length) return;
  const m = pend[pend.length - 1];
  await self.registration.showNotification("Protocolo — " + m.nome, {
    body: m.pendentes === 1 ? "Falta 1 toma: " + m.exemplo : "Faltam " + m.pendentes + " tomas (" + m.exemplo + "…)",
    tag: "proto-" + dia + "-" + m.nome, icon: est.icon, badge: est.icon, data: { url: "./" },
  });
}


/* ---- Web Push: chega mesmo com a app fechada ---- */
self.addEventListener("push", (e) => {
  let d = { titulo: "A minha recuperação", corpo: "Tens algo por fazer." };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch (er) { try { d.corpo = e.data.text(); } catch (er2) {} }
  e.waitUntil(self.registration.showNotification(d.titulo, {
    body: d.corpo, tag: d.tag || "push", icon: d.icon, badge: d.icon,
    data: { url: d.url || "./" }, requireInteraction: !!d.fixa,
  }));
});
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: "resubscrever" }))));
});

self.addEventListener("periodicsync", (e) => { if (e.tag === "verificar-protocolo") e.waitUntil(verificar()); });
self.addEventListener("sync", (e) => { if (e.tag === "verificar-protocolo") e.waitUntil(verificar()); });

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const url = (e.notification.data && e.notification.data.url) || "./";
      for (const c of cs) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Gateway WhatsApp por QR code (Baileys) para rodar no PC, sem Docker.
// Expõe o MESMO subconjunto da API do Waha que o app usa (sessions, qr, sendText,
// sendSeen, logout) e entrega webhooks no formato do Waha com HMAC-SHA512.
// Opcional: abre um Cloudflare Quick Tunnel e registra a URL pública no app.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  isPnUser,
  downloadMediaMessage,
} from "baileys";

const DIR = import.meta.dirname;
loadDotEnv(path.join(DIR, ".env"));

const PORT = Number(process.env.PORT ?? 3000);
const API_KEY = process.env.WAHA_API_KEY ?? "";
const DATA = path.join(DIR, "data");
const AUTH = path.join(DATA, "auth");
const SESSION_FILE = path.join(DATA, "session.json");
const SESSION = "default";

if (!API_KEY) throw new Error("WAHA_API_KEY não definido (.env)");
fs.mkdirSync(DATA, { recursive: true });

const log = (event, data = {}) => console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
const logger = pino({ level: "warn" });

// ─── Estado ─────────────────────────────────────────────────────────
/** @type {{ name: string, config: any } | null} */
let session = readJson(SESSION_FILE);
/** @type {"STOPPED"|"STARTING"|"SCAN_QR_CODE"|"WORKING"|"FAILED"} */
let status = "STOPPED";
let qr = null;
let sock = null;
let me = null;
let stopping = false;
const lastKeyByChat = new Map(); // p/ sendSeen

function setStatus(next) {
  if (status === next) return;
  status = next;
  log("session.status", { status });
  // `me` (como no Waha): o app usa p/ saber qual número está conectado e separar as conversas
  deliver({ event: "session.status", session: SESSION, me, payload: { status } });
}

// ─── WhatsApp (Baileys) ─────────────────────────────────────────────
async function start() {
  if (sock) return;
  stopping = false;
  setStatus("STARTING");
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({
    auth: state,
    version,
    logger,
    browser: Browsers.ubuntu("Agente Gaucho"),
    markOnlineOnConnect: false, // não tira as notificações do celular
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      qr = u.qr;
      setStatus("SCAN_QR_CODE");
    }
    if (u.connection === "open") {
      qr = null;
      me = { id: toCus(sock.user?.id), pushName: sock.user?.name ?? sock.user?.notify ?? null };
      setStatus("WORKING");
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      sock = null;
      qr = null;
      if (stopping) return setStatus("STOPPED");
      if (code === DisconnectReason.loggedOut) {
        // Desconectado pelo celular: apaga credenciais e volta a pedir QR
        fs.rmSync(AUTH, { recursive: true, force: true });
        me = null;
        log("session.logged_out");
        setStatus("STOPPED");
        return;
      }
      log("session.reconnecting", { code });
      setTimeout(() => start().catch((e) => log("session.start_failed", { err: String(e) })), 2000);
    }
  });

  // "notify" = msg nova recebida, inclusive as que o atendente envia pelo celular /
  // WhatsApp Web deste número (fromMe). O que a API envia volta como "append" e é ignorado.
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key?.fromMe && sentIds.has(m.key.id)) continue; // eco do que a IA/painel enviou
      const payload = await toWahaMessage(m);
      if (!payload) continue;
      if (!payload.fromMe) lastKeyByChat.set(payload.from, m.key);
      deliver({ event: "message", session: SESSION, me, payload });
    }
  });
}

/** Ids das msgs enviadas pela API (IA/painel), p/ não confundir com o atendente humano. */
const sentIds = new Set();
function rememberSent(id) {
  if (!id) return;
  sentIds.add(id);
  if (sentIds.size > 2000) sentIds.delete(sentIds.values().next().value);
}

async function stop() {
  stopping = true;
  if (sock) sock.end(undefined);
  sock = null;
  setStatus("STOPPED");
}

async function logout() {
  stopping = true;
  if (sock) await sock.logout().catch(() => {});
  sock = null;
  me = null;
  qr = null;
  fs.rmSync(AUTH, { recursive: true, force: true });
  setStatus("STOPPED");
}

const MEDIA = {
  imageMessage: "[o cliente enviou uma imagem]",
  audioMessage: "[o cliente enviou um áudio]",
  videoMessage: "[o cliente enviou um vídeo]",
  documentMessage: "[o cliente enviou um documento]",
  stickerMessage: "[o cliente enviou uma figurinha]",
  locationMessage: "[o cliente enviou uma localização]",
};

/**
 * Converte msg do Baileys p/ o payload "message" do Waha. Só conversas 1-a-1.
 * fromMe (atendente pelo celular): como no Waha, `from` = este número e `to` = cliente.
 */
async function toWahaMessage(m) {
  const jid = m.key?.remoteJid ?? "";
  const fromMe = Boolean(m.key?.fromMe);
  if (!m.message) return null;
  if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) return null; // ignora grupos, status, canais
  // Contato com privacidade chega como @lid. Usa sempre o número real quando conhecido:
  // na msg (remoteJidAlt) ou no mapa lid→número do Baileys. Sem isso, a mesma pessoa
  // (e até a mesma msg reentregue) vira dois contatos.
  const alt = m.key.remoteJidAlt;
  let pn = isPnUser(jid) ? jid : isPnUser(alt) ? alt : null;
  if (!pn) pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
  const chat = pn ? toCus(pn) : jid;

  const msg = m.message.ephemeralMessage?.message ?? m.message;
  let body =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.buttonsResponseMessage?.selectedDisplayText ??
    msg.listResponseMessage?.title ??
    null;
  const mediaKey = Object.keys(MEDIA).find((k) => msg[k]);
  if (!body && !mediaKey) return null; // reações, edições, protocolo etc.
  if (!body) body = fromMe ? MEDIA[mediaKey].replace("o cliente", "o atendente") : MEDIA[mediaKey];

  // Áudio do cliente (nota de voz): baixa e envia junto p/ o app transcrever
  let media;
  if (!fromMe && mediaKey === "audioMessage") media = await downloadAudio(m, msg.audioMessage);

  return {
    id: `${fromMe}_${chat}_${m.key.id}`,
    from: fromMe ? (toCus(sock?.user?.id) ?? "me") : chat,
    // Waha: from = remetente, to = destinatário (o número do bot, nas msgs de clientes)
    to: fromMe ? chat : (toCus(sock?.user?.id) ?? undefined),
    fromMe,
    body,
    hasMedia: Boolean(mediaKey),
    media,
    timestamp: Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    notifyName: fromMe ? undefined : (m.pushName ?? undefined),
  };
}

// Limite da Vercel: 4,5 MB por requisição; 3 MB vira ~4 MB em base64 (~10 min de voz)
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

/** Baixa a nota de voz. Retorna { mimetype, data(base64), seconds } ou undefined. */
async function downloadAudio(m, audio) {
  const size = Number(audio?.fileLength ?? 0);
  if (size > MAX_AUDIO_BYTES) {
    log("media.audio_too_big", { size });
    return undefined;
  }
  try {
    const buf = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
    log("media.audio_downloaded", { bytes: buf.length, seconds: audio?.seconds });
    return {
      mimetype: (audio?.mimetype ?? "audio/ogg").split(";")[0],
      data: buf.toString("base64"),
      seconds: audio?.seconds ?? undefined,
    };
  } catch (err) {
    log("media.audio_download_failed", { err: String(err) });
    return undefined;
  }
}

/** "5551...@s.whatsapp.net" ou "5551...:12@s.whatsapp.net" → "5551...@c.us" */
function toCus(jid) {
  if (!jid) return jid;
  return jid.replace(/:\d+(?=@)/, "").replace(/@s\.whatsapp\.net$/, "@c.us");
}
/** Formato Waha → jid do Baileys */
function toJid(chatId) {
  return chatId.replace(/@c\.us$/, "@s.whatsapp.net");
}

/**
 * Número de telefone → jid real no WhatsApp. Celulares brasileiros antigos podem
 * estar registrados SEM o nono dígito (5573 9 9909-1977 → 557399091977), então
 * consulta as duas formas. @lid e jids já resolvidos passam direto.
 */
const jidCache = new Map();
async function resolveJid(chatId) {
  if (!chatId.endsWith("@c.us")) return toJid(chatId);
  const digits = chatId.replace(/@.*/, "");
  if (jidCache.has(digits)) return jidCache.get(digits);
  const candidates = [digits];
  if (/^55\d{2}9\d{8}$/.test(digits)) candidates.push(digits.slice(0, 4) + digits.slice(5)); // sem o 9
  for (const n of candidates) {
    const [res] = (await sock.onWhatsApp(n).catch(() => undefined)) ?? [];
    if (res?.exists) {
      jidCache.set(digits, res.jid);
      if (n !== digits) log("jid.resolved_without_9", { from: digits.slice(0, 4) + "…" });
      return res.jid;
    }
  }
  return toJid(chatId); // não encontrado: tenta mesmo assim (WhatsApp devolve erro se não existir)
}

// ─── Webhook de saída (formato Waha + HMAC-SHA512) ──────────────────
async function deliver(body) {
  const hook = session?.config?.webhooks?.[0];
  if (!hook?.url) return;
  if (hook.events && !hook.events.includes(body.event)) return;
  const raw = JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };
  if (hook.hmac?.key) {
    headers["X-Webhook-Hmac"] = createHmac("sha512", hook.hmac.key).update(raw).digest("hex");
    headers["X-Webhook-Hmac-Algorithm"] = "sha512";
  }
  const attempts = hook.retries?.attempts ?? 4;
  const delay = (hook.retries?.delaySeconds ?? 2) * 1000;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(hook.url, { method: "POST", headers, body: raw, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return log("webhook.delivered", { hook: body.event, status: r.status });
      log("webhook.failed", { hook: body.event, status: r.status, attempt: i });
      if (r.status < 500) return; // 4xx não adianta repetir
    } catch (err) {
      log("webhook.failed", { hook: body.event, err: String(err), attempt: i });
    }
    await new Promise((res) => setTimeout(res, delay * i));
  }
}

// ─── API HTTP (subconjunto Waha) ────────────────────────────────────
function sessionView() {
  return { name: SESSION, status, me, config: session?.config ?? {} };
}

const routes = [
  ["GET", /^\/(ping|health)$/, () => [200, { ok: true }]],
  ["GET", /^\/api\/server\/version$/, () => [200, { engine: "BAILEYS", tier: "gateway" }]],
  ["GET", /^\/api\/sessions\/default$/, () => (session ? [200, sessionView()] : [404, { message: "Session not found" }])],
  ["POST", /^\/api\/sessions$/, async (b) => {
    if (session) return [422, { message: `Session '${SESSION}' already exists. Use PUT to update it.` }];
    session = { name: SESSION, config: b?.config ?? {} };
    writeJson(SESSION_FILE, session);
    if (b?.start) await start();
    return [201, sessionView()];
  }],
  ["PUT", /^\/api\/sessions\/default$/, async (b) => {
    if (!session) return [404, { message: "Session not found" }];
    session.config = b?.config ?? session.config;
    writeJson(SESSION_FILE, session);
    return [200, sessionView()];
  }],
  ["POST", /^\/api\/sessions\/default\/start$/, async () => {
    if (!session) return [404, { message: "Session not found" }];
    if (sock) return [422, { message: `Session '${SESSION}' is already started.` }];
    await start();
    return [201, sessionView()];
  }],
  ["POST", /^\/api\/sessions\/default\/stop$/, async () => {
    if (!sock) return [422, { message: `Session '${SESSION}' is not started.` }];
    await stop();
    return [201, sessionView()];
  }],
  ["POST", /^\/api\/sessions\/default\/logout$/, async () => {
    await logout();
    return [201, sessionView()];
  }],
  ["GET", /^\/api\/default\/auth\/qr/, async () => {
    if (status !== "SCAN_QR_CODE" || !qr) return [422, { message: `Session status is ${status}` }];
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    return [200, { mimetype: "image/png", data: dataUrl.split(",")[1] }];
  }],
  ["POST", /^\/api\/sendText$/, async (b) => {
    if (status !== "WORKING" || !sock) return [422, { message: `Session status is ${status}` }];
    if (!b?.chatId || !b?.text) return [400, { message: "chatId e text são obrigatórios" }];
    const sent = await sock.sendMessage(await resolveJid(b.chatId), { text: String(b.text) });
    rememberSent(sent?.key?.id);
    return [201, { id: `true_${b.chatId}_${sent?.key?.id ?? ""}` }];
  }],
  ["POST", /^\/api\/sendSeen$/, async (b) => {
    const key = lastKeyByChat.get(b?.chatId);
    if (sock && key) await sock.readMessages([key]).catch(() => {});
    return [201, {}];
  }],
];

function authorized(req) {
  const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
  const want = Buffer.from(API_KEY);
  return given.length === want.length && timingSafeEqual(given, want);
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (!route) return send(404, { message: "Not found" });
      if (!/^\/(ping|health)$/.test(url.pathname) && !authorized(req)) return send(401, { message: "Unauthorized" });
      try {
        const [code, body] = await route[2](raw ? JSON.parse(raw) : null);
        send(code, body);
      } catch (err) {
        log("api.error", { path: url.pathname, err: String(err) });
        send(500, { message: String(err) });
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    log("gateway.listening", { port: PORT });
    // Reconecta sozinho após reiniciar o PC, se já havia um número conectado
    if (session && fs.existsSync(path.join(AUTH, "creds.json"))) {
      start().catch((e) => log("session.start_failed", { err: String(e) }));
    }
    if (process.env.TUNNEL === "cloudflared") startTunnel();
  });

// ─── Cloudflare Quick Tunnel + registro da URL no app ───────────────
// Se a internet cai, o quick tunnel pode morrer com o processo cloudflared ainda
// vivo (URL deixa de resolver). O vigia testa a URL pública e recria o túnel.
const WATCH_EVERY_MS = 60_000;
const WATCH_MAX_FAILS = 3;
let tunnelRestarts = 0;
let tunnelGen = 0; // cada túnel novo invalida os registros pendentes do anterior

// O log do cloudflared também cita https://api.trycloudflare.com (endereço da
// própria Cloudflare, ex.: em erros). Só vale o subdomínio sorteado do túnel.
function tunnelUrlFrom(text) {
  for (const [url] of text.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/g)) {
    if (!/^(api|www)$/.test(url.split("//")[1].split(".")[0])) return url;
  }
  return null;
}

/** A URL nova leva alguns segundos para resolver; só registra quando chega no gateway. */
async function reachable(url, gen) {
  for (let i = 0; i < 12 && gen === tunnelGen; i++) {
    try {
      const r = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 5000));
  }
  return false;
}

function startTunnel() {
  const bin = process.env.CLOUDFLARED_BIN ?? "cloudflared";
  const child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`], { windowsHide: true });
  const gen = ++tunnelGen;
  let publicUrl = null;
  let fails = 0;
  let watch = null;

  const onData = async (buf) => {
    const url = tunnelUrlFrom(String(buf));
    if (url && !publicUrl) {
      publicUrl = url;
      log("tunnel.ready", { url: publicUrl });
      if (!(await reachable(publicUrl, gen))) {
        log("tunnel.unreachable_restarting", { url: publicUrl });
        return child.kill();
      }
      tunnelRestarts = 0;
      registerUrl(publicUrl, gen);
      watch = setInterval(async () => {
        try {
          const r = await fetch(`${publicUrl}/ping`, { signal: AbortSignal.timeout(10_000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          fails = 0;
        } catch (err) {
          fails++;
          log("tunnel.check_failed", { fails, err: String(err) });
          if (fails >= WATCH_MAX_FAILS) {
            log("tunnel.unhealthy_restarting");
            child.kill();
          }
        }
      }, WATCH_EVERY_MS);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    clearInterval(watch);
    // Backoff: sem internet o cloudflared encerra na hora; evita loop a cada 5s
    const delay = Math.min(60_000, 5000 * 2 ** tunnelRestarts++);
    log("tunnel.exited", { code, retryInMs: delay });
    setTimeout(startTunnel, delay); // URL nova → registra de novo
  });
}

async function registerUrl(baseUrl, gen) {
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!app) return log("tunnel.register_skipped", { reason: "APP_URL ausente" });
  for (let i = 1; gen === tunnelGen; i++) {
    try {
      const r = await fetch(`${app}/api/waha/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ baseUrl }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return log("tunnel.registered", { baseUrl });
      log("tunnel.register_failed", { status: r.status, attempt: i });
    } catch (err) {
      log("tunnel.register_failed", { err: String(err), attempt: i });
    }
    await new Promise((res) => setTimeout(res, Math.min(60_000, 5000 * i)));
  }
}

// ─── util ───────────────────────────────────────────────────────────
function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(f, obj) {
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
}
function loadDotEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

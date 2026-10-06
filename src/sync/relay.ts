import { buildBackup } from '../backup/export';
import { applyImport, parseBackup, type ImportSummary } from '../backup/import';

/**
 * Synchroniseren via een versleuteld "doorgeefluik" (ntfy.sh: gratis, open source, geen account).
 *
 * Toestel 1 maakt een code met een willekeurig kanaal en een geheime sleutel en toont die als QR-code.
 * Toestel 2 scant hem. Beide toestellen versleutelen hun notities met die sleutel (AES-GCM),
 * zetten ze als bijlage in het kanaal, halen elkaars pakketje op en voegen samen.
 * ntfy.sh ziet alleen versleutelde bytes; de sleutel verlaat de toestellen alleen via de QR-code.
 * Bijlagen verlopen bij ntfy.sh na hooguit 3 uur.
 */
export const RELAY = 'https://ntfy.sh';
export const PREFIX = 'PB2';
/** ntfy.sh staat bijlagen tot 15 MB toe. */
const MAX_BYTES = 14 * 1024 * 1024;
const HOST_WAIT_MS = 10 * 60_000;
const JOIN_WAIT_MS = 2 * 60_000;

export type Role = 'host' | 'join';
export type RelayError = 'badCode' | 'offline' | 'timeout' | 'wrongKey' | 'tooLarge' | 'service' | 'newerVersion' | 'notPlekboek';
export type Progress = 'uploading' | 'waiting' | 'downloading' | 'merging';

export class RelayFailure extends Error {
  constructor(
    public reason: RelayError,
    public details = '',
  ) {
    super(reason);
  }
}

export interface Session {
  topic: string;
  key: CryptoKey;
  code: string;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const importKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Nieuwe sessie: kanaal van 16 willekeurige bytes, sleutel van 32 bytes. Code: PB2|kanaal|sleutel */
export async function newSession(): Promise<Session> {
  const topic = `plekboek-${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { topic, key: await importKey(raw), code: [PREFIX, topic, b64url(raw)].join('|') };
}

export async function parseCode(code: string): Promise<Session> {
  const [prefix, topic, key, ...rest] = code.trim().split('|');
  if (prefix !== PREFIX || rest.length || !/^plekboek-[\w-]{20,}$/.test(topic ?? '')) throw new RelayFailure('badCode');
  let raw: Uint8Array;
  try {
    raw = unb64url(key);
  } catch {
    throw new RelayFailure('badCode');
  }
  if (raw.length !== 32) throw new RelayFailure('badCode');
  return { topic, key: await importKey(raw), code: code.trim() };
}

/* ---------- versleutelen ---------- */

async function gzip(data: Uint8Array, direction: 'compress' | 'decompress'): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as BufferSource);
      controller.close();
    },
  });
  const stream = source.pipeThrough(direction === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Formaat: [versie 1][gecomprimeerd 0/1][iv 12 bytes][AES-GCM-ciphertext]; de rol is extra geauthenticeerde data. */
export async function seal(key: CryptoKey, role: Role, text: string): Promise<Uint8Array> {
  let data: Uint8Array = new TextEncoder().encode(text);
  const compressed = typeof CompressionStream !== 'undefined';
  if (compressed) data = await gzip(data, 'compress');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(role) }, key, data as BufferSource));
  const out = new Uint8Array(2 + 12 + cipher.length);
  out.set([1, compressed ? 1 : 0]);
  out.set(iv, 2);
  out.set(cipher, 14);
  return out;
}

export async function open(key: CryptoKey, role: Role, bytes: Uint8Array): Promise<string> {
  if (bytes.length < 14 || bytes[0] !== 1) throw new RelayFailure('newerVersion');
  let data: Uint8Array;
  try {
    data = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(2, 14) as BufferSource, additionalData: new TextEncoder().encode(role) }, key, bytes.subarray(14) as BufferSource),
    );
  } catch {
    throw new RelayFailure('wrongKey');
  }
  if (bytes[1] === 1) data = await gzip(data, 'decompress');
  return new TextDecoder().decode(data);
}

/* ---------- doorgeefluik ---------- */

async function request(url: string, init?: RequestInit): Promise<Response> {
  if (!navigator.onLine) throw new RelayFailure('offline');
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new RelayFailure(navigator.onLine ? 'service' : 'offline', String(e));
  }
  if (res.status === 413) throw new RelayFailure('tooLarge');
  if (!res.ok) throw new RelayFailure('service', `${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
  return res;
}

async function publish(topic: string, role: Role, bytes: Uint8Array) {
  if (bytes.length > MAX_BYTES) throw new RelayFailure('tooLarge');
  await request(`${RELAY}/${topic}`, {
    method: 'PUT',
    headers: { Filename: `${role}.bin` },
    body: bytes as BodyInit,
  });
}

interface NtfyMessage {
  event: string;
  attachment?: { name: string; url: string };
}

/**
 * Wacht tot het pakketje van de andere kant in het kanaal staat.
 * Live via Server-Sent Events, plus af en toe een gewone opvraag: ntfy.sh slaat een nieuw bericht
 * pas na een fractie van een seconde op, dus wie zich precies dan aanmeldt, ziet het live én
 * in de geschiedenis niet. De extra opvragen (na 2 en 6 s, daarna elke 20 s) vangen dat op.
 */
function waitFor(topic: string, from: Role, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const name = `${from}.bin`;
    const es = new EventSource(`${RELAY}/${topic}/sse?since=all`);
    const timers = [
      setTimeout(() => finish(() => reject(new RelayFailure('timeout'))), timeoutMs),
      setTimeout(poll, 2000),
      setTimeout(poll, 6000),
    ];
    const interval = setInterval(poll, 20_000);
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      clearInterval(interval);
      es.close();
      fn();
    };
    const found = (m: NtfyMessage) => m.event === 'message' && m.attachment?.name === name && finish(() => resolve(m.attachment!.url));
    es.onmessage = (e) => found(JSON.parse(e.data) as NtfyMessage);
    // EventSource probeert zelf opnieuw te verbinden; alleen offline is een reden om op te geven.
    es.onerror = () => !navigator.onLine && finish(() => reject(new RelayFailure('offline')));

    async function poll() {
      if (done) return;
      try {
        const res = await fetch(`${RELAY}/${topic}/json?poll=1&since=all`);
        if (!res.ok) return;
        for (const line of (await res.text()).split('\n')) if (line.trim()) found(JSON.parse(line) as NtfyMessage);
      } catch {
        /* volgende keer opnieuw */
      }
    }
  });
}

async function download(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await request(url)).arrayBuffer());
}

/* ---------- de uitwisseling ---------- */

async function merge(text: string): Promise<ImportSummary> {
  const parsed = parseBackup(text);
  if (!parsed.ok) throw new RelayFailure(parsed.error === 'newerVersion' ? 'newerVersion' : 'notPlekboek');
  return applyImport(parsed.data, 'merge');
}

/**
 * Toestel 1 (toont de code): zet zijn notities klaar zodra de code er is,
 * wacht op het pakketje van toestel 2 en voegt dat samen.
 */
export async function runHost(s: Session, onProgress: (p: Progress) => void): Promise<ImportSummary> {
  onProgress('uploading');
  const mine = JSON.stringify(await buildBackup());
  await publish(s.topic, 'host', await seal(s.key, 'host', mine));
  onProgress('waiting');
  const url = await waitFor(s.topic, 'join', HOST_WAIT_MS);
  onProgress('downloading');
  const theirs = await open(s.key, 'join', await download(url));
  onProgress('merging');
  return merge(theirs);
}

/**
 * Toestel 2 (scant de code): zet eerst zijn eigen notities klaar (momentopname vóór het samenvoegen),
 * haalt dan het pakketje van toestel 1 op en voegt dat samen.
 */
export async function runJoin(s: Session, onProgress: (p: Progress) => void): Promise<ImportSummary> {
  onProgress('uploading');
  const mine = JSON.stringify(await buildBackup());
  await publish(s.topic, 'join', await seal(s.key, 'join', mine));
  onProgress('waiting');
  const url = await waitFor(s.topic, 'host', JOIN_WAIT_MS);
  onProgress('downloading');
  const theirs = await open(s.key, 'host', await download(url));
  onProgress('merging');
  return merge(theirs);
}

import { buildBackup } from '../backup/export';
import { applyImport, parseBackup, type ImportSummary } from '../backup/import';
import { decode, encode, fromSdp, toSdp, type Signal } from './signal';

/**
 * Directe verbinding tussen twee toestellen (WebRTC-datakanaal), zonder eigen server.
 * De verbindingsgegevens gaan via QR-codes (zie signal.ts). Openbare STUN-servers helpen
 * de toestellen elkaar te vinden; ze zien alleen IP-adressen, nooit de notities.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const GATHER_MS = 4000;
/** Toestel 1: na het scannen van de antwoordcode moet de verbinding er snel zijn. */
const CONNECT_AFTER_ACCEPT_MS = 30_000;
/** Toestel 2: wacht tot toestel 1 de antwoordcode heeft gescand; dat kan even duren. */
const CONNECT_WHILE_WAITING_MS = 5 * 60_000;
const CHUNK = 16_000;

export type PeerError = 'badCode' | 'wrongStep' | 'noConnection' | 'newerVersion' | 'notPlekboek' | 'closed';

export class PeerFailure extends Error {
  constructor(
    public reason: PeerError,
    /** technische details voor in de foutmelding (welke adressen, welke verbindingsstatus) */
    public details = '',
  ) {
    super(reason);
  }
}

/** Wacht tot alle kandidaat-adressen bekend zijn (of tot de tijd om is: STUN kan traag zijn). */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Chrome en Safari verbergen het lokale IP-adres achter een "….local"-naam, tenzij de pagina
 * cameratoestemming heeft. Veel routers en Android-toestellen kunnen die namen niet opzoeken,
 * waardoor toestellen op hetzelfde wifi elkaar niet vinden. Daarom: camera kort aan tijdens het
 * maken van de code (de camera is in deze flow toch nodig om te scannen).
 */
async function withCamera<T>(fn: () => Promise<T>): Promise<T> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices?.getUserMedia({ video: true, audio: false });
  } catch {
    /* geen camera of geen toestemming: dan maar met verborgen adressen */
  }
  try {
    return await fn();
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

/** Openbaar IP-adres deels verbergen; lokale adressen (192.168…, 10…, IPv6 link-local) blijven zichtbaar. */
function mask(address: string): string {
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(address) || address.endsWith('.local')) return address;
  if (address.includes(':')) return address.split(':').slice(0, 2).join(':') + ':…';
  return address.split('.').slice(0, 2).join('.') + '.x.x';
}

/** Adressen in een code, bijv. "192.168.1.20 (lokaal), 84.85.x.x (STUN)". */
function describe(s: Signal | null): string {
  if (!s) return '–';
  if (!s.candidates.length) return 'geen adressen';
  return s.candidates.map((c) => `${mask(c.address)} (${c.kind === 'host' ? 'lokaal' : 'STUN'})`).join(', ');
}

/** Browser en systeem, kort: "Edge/Windows", "Safari/iPhone". */
function platform(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '?';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : '?';
  return `${browser}/${os}`;
}

export class Peer {
  private channel: Promise<RTCDataChannel>;
  private open!: (ch: RTCDataChannel) => void;
  private fail!: (e: PeerFailure) => void;
  /** Berichten die binnenkomen voordat de uitwisseling luistert, worden bewaard. */
  private inbox: string[] = [];
  private listener: ((data: string) => void) | null = null;
  private local: Signal | null = null;
  private role: 'host' | 'join' = 'host';
  /** Laatste stand van de verbindingscontroles; na een mislukking gooit de browser die weg. */
  private checks = { sent: 0, answered: 0, received: 0, pairs: '' };
  private poll: ReturnType<typeof setInterval>;
  private remote: Signal | null = null;

  private constructor(
    private pc: RTCPeerConnection,
    channel: RTCDataChannel | null,
  ) {
    this.channel = new Promise((resolve, reject) => {
      this.open = resolve;
      this.fail = reject;
    });
    this.channel.catch(() => {}); // voorkomt een melding als niemand (meer) wacht
    const ready = (ch: RTCDataChannel) => {
      ch.addEventListener('message', (e) => (this.listener ? this.listener(e.data as string) : this.inbox.push(e.data as string)));
      if (ch.readyState === 'open') this.open(ch);
      else ch.addEventListener('open', () => this.open(ch), { once: true });
    };
    if (channel) ready(channel);
    else pc.addEventListener('datachannel', (e) => ready(e.channel), { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') this.failWithDetails();
      if (pc.connectionState === 'connected' || pc.connectionState === 'closed') clearInterval(this.poll);
    });
    this.poll = setInterval(() => this.measure(), 1000);
  }

  private async measure() {
    let sent = 0;
    let answered = 0;
    let received = 0;
    const states: Record<string, number> = {};
    try {
      (await this.pc.getStats()).forEach((r) => {
        if (r.type !== 'candidate-pair') return;
        sent += r.requestsSent ?? 0;
        answered += r.responsesReceived ?? 0;
        received += r.requestsReceived ?? 0;
        states[r.state] = (states[r.state] ?? 0) + 1;
      });
    } catch {
      return; // geen statistieken beschikbaar
    }
    if (sent + received === 0 && this.checks.sent + this.checks.received > 0) return; // al opgeruimd
    const pairs = Object.entries(states)
      .map(([st, n]) => `${n}× ${st}`)
      .join(', ');
    this.checks = { sent, answered, received, pairs };
  }

  /** Toestel 1: maakt de eerste code (aanbod). */
  static async host(): Promise<{ peer: Peer; code: string }> {
    return withCamera(async () => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const ch = pc.createDataChannel('plekboek', { ordered: true });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const peer = new Peer(pc, ch);
      peer.local = fromSdp('offer', pc.localDescription!.sdp);
      return { peer, code: encode(peer.local) };
    });
  }

  /** Toestel 2: leest de eerste code en maakt de antwoordcode. */
  static async join(offerCode: string): Promise<{ peer: Peer; code: string }> {
    const offer = parse(offerCode, 'offer');
    return withCamera(async () => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const peer = new Peer(pc, null);
      peer.role = 'join';
      peer.remote = offer;
      await pc.setRemoteDescription({ type: 'offer', sdp: toSdp(offer) });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      peer.local = fromSdp('answer', pc.localDescription!.sdp);
      return { peer, code: encode(peer.local) };
    });
  }

  /** Toestel 1: leest de antwoordcode van toestel 2. */
  async accept(answerCode: string): Promise<void> {
    this.remote = parse(answerCode, 'answer');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(this.remote) });
  }

  /**
   * Technische details voor de foutmelding: rol, platform, adressen en hoeveel
   * verbindingscontroles (STUN-checks) er heen en terug zijn gegaan.
   */
  async diagnostics(): Promise<string> {
    await this.measure();
    const { sent, answered, received, pairs } = this.checks;
    return [
      `rol: ${this.role === 'host' ? 'toont code' : 'scant code'} · ${platform()}`,
      `dit toestel: ${describe(this.local)}`,
      `ander toestel: ${describe(this.remote)}`,
      `checks: ${sent} verstuurd, ${answered} beantwoord, ${received} ontvangen`,
      `paren: ${pairs || 'geen'}`,
      `ICE: ${this.pc.iceConnectionState}, verbinding: ${this.pc.connectionState}`,
    ].join('\n');
  }

  private failWithDetails() {
    this.diagnostics().then((d) => this.fail(new PeerFailure('noConnection', d)));
  }

  /**
   * Wacht op de verbinding en wisselt alle notities uit. Beide kanten voegen samen.
   * De wachttijd begint pas hier: toestel 1 roept dit aan na het scannen van de antwoordcode,
   * toestel 2 direct na het tonen van zijn antwoordcode (en wacht dan langer).
   */
  async exchange(onProgress?: (step: 'connected' | 'received' | 'merged') => void): Promise<ImportSummary> {
    const waitMs = this.pc.remoteDescription?.type === 'answer' ? CONNECT_AFTER_ACCEPT_MS : CONNECT_WHILE_WAITING_MS;
    const timer = setTimeout(() => this.failWithDetails(), waitMs);
    let ch: RTCDataChannel;
    try {
      ch = await this.channel;
    } finally {
      clearTimeout(timer);
    }
    onProgress?.('connected');
    return exchangeOver(ch, (fn) => {
      this.listener = fn;
      this.inbox.splice(0).forEach(fn);
    }, onProgress);
  }

  close() {
    clearInterval(this.poll);
    this.pc.close();
  }
}

function parse(code: string, expected: 'offer' | 'answer') {
  let s;
  try {
    s = decode(code);
  } catch {
    throw new PeerFailure('badCode');
  }
  if (s.type !== expected) throw new PeerFailure('wrongStep');
  return s;
}

type Msg = { k: 'hello'; app: string; v: number } | { k: 'chunk'; i: number; n: number; d: string } | { k: 'merged' };

/**
 * Protocol: beide kanten maken eerst een momentopname van hun eigen data en sturen die in stukken.
 * Wie alles binnen heeft, voegt samen en meldt "merged". Klaar als beide kanten dat hebben gemeld.
 */
function exchangeOver(
  ch: RTCDataChannel,
  listen: (fn: (data: string) => void) => void,
  onProgress?: (step: 'connected' | 'received' | 'merged') => void,
): Promise<ImportSummary> {
  return new Promise((resolve, reject) => {
    const mine = buildBackup().then((b) => JSON.stringify(b));
    const parts: string[] = [];
    let total = -1;
    let summary: ImportSummary | null = null;
    let theyMerged = false;
    const finish = () => summary && theyMerged && resolve(summary);
    const fail = (e: PeerError) => {
      reject(new PeerFailure(e));
      ch.close();
    };

    const send = async (m: Msg) => {
      // Niet te veel tegelijk in de verzendbuffer.
      while (ch.bufferedAmount > 1_000_000) await new Promise((r) => setTimeout(r, 20));
      ch.send(JSON.stringify(m));
    };

    ch.addEventListener('close', () => !(summary && theyMerged) && reject(new PeerFailure('closed')));
    listen(async (data) => {
      const m = JSON.parse(data) as Msg;
      if (m.k === 'hello') {
        if (m.app !== 'plekboek') return fail('notPlekboek');
        if (m.v > 1) return fail('newerVersion');
      } else if (m.k === 'chunk') {
        total = m.n;
        parts[m.i] = m.d;
        if (parts.filter((p) => p !== undefined).length === total) {
          onProgress?.('received');
          await mine; // eigen momentopname eerst, vóór er iets wijzigt
          const parsed = parseBackup(parts.join(''));
          if (!parsed.ok) return fail(parsed.error === 'newerVersion' ? 'newerVersion' : 'notPlekboek');
          summary = await applyImport(parsed.data, 'merge');
          onProgress?.('merged');
          await send({ k: 'merged' });
          finish();
        }
      } else if (m.k === 'merged') {
        theyMerged = true;
        finish();
      }
    });

    (async () => {
      await send({ k: 'hello', app: 'plekboek', v: 1 });
      const text = await mine;
      const n = Math.max(1, Math.ceil(text.length / CHUNK));
      for (let i = 0; i < n; i++) await send({ k: 'chunk', i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    })().catch(() => fail('closed'));
  });
}

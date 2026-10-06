import { buildBackup } from '../backup/export';
import { applyImport, parseBackup, type ImportSummary } from '../backup/import';
import { decode, encode, fromSdp, toSdp } from './signal';

/**
 * Directe verbinding tussen twee toestellen (WebRTC-datakanaal), zonder eigen server.
 * De verbindingsgegevens gaan via QR-codes (zie signal.ts). Openbare STUN-servers helpen
 * de toestellen elkaar te vinden; ze zien alleen IP-adressen, nooit de notities.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const GATHER_MS = 3000;
const CONNECT_MS = 30_000;
const CHUNK = 16_000;

export type PeerError = 'badCode' | 'wrongStep' | 'noConnection' | 'newerVersion' | 'notPlekboek' | 'closed';

export class PeerFailure extends Error {
  constructor(public reason: PeerError) {
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

export class Peer {
  private channel: Promise<RTCDataChannel>;
  /** Berichten die binnenkomen voordat de uitwisseling luistert, worden bewaard. */
  private inbox: string[] = [];
  private listener: ((data: string) => void) | null = null;

  private constructor(
    private pc: RTCPeerConnection,
    channel: RTCDataChannel | null,
  ) {
    this.channel = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new PeerFailure('noConnection')), CONNECT_MS);
      const ready = (ch: RTCDataChannel) => {
        ch.addEventListener('message', (e) => (this.listener ? this.listener(e.data as string) : this.inbox.push(e.data as string)));
        const open = () => (clearTimeout(timer), resolve(ch));
        if (ch.readyState === 'open') open();
        else ch.addEventListener('open', open, { once: true });
      };
      if (channel) ready(channel);
      else pc.addEventListener('datachannel', (e) => ready(e.channel), { once: true });
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') {
          clearTimeout(timer);
          reject(new PeerFailure('noConnection'));
        }
      });
    });
    this.channel.catch(() => {}); // voorkomt een melding als niemand (meer) wacht
  }

  /** Toestel 1: maakt de eerste code (aanbod). */
  static async host(): Promise<{ peer: Peer; code: string }> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const ch = pc.createDataChannel('plekboek', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return { peer: new Peer(pc, ch), code: encode(fromSdp('offer', pc.localDescription!.sdp)) };
  }

  /** Toestel 2: leest de eerste code en maakt de antwoordcode. */
  static async join(offerCode: string): Promise<{ peer: Peer; code: string }> {
    const offer = parse(offerCode, 'offer');
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = new Peer(pc, null);
    await pc.setRemoteDescription({ type: 'offer', sdp: toSdp(offer) });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return { peer, code: encode(fromSdp('answer', pc.localDescription!.sdp)) };
  }

  /** Toestel 1: leest de antwoordcode van toestel 2. */
  async accept(answerCode: string): Promise<void> {
    const answer = parse(answerCode, 'answer');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(answer) });
  }

  /** Wacht op de verbinding en wisselt alle notities uit. Beide kanten voegen samen. */
  async exchange(onProgress?: (step: 'connected' | 'received' | 'merged') => void): Promise<ImportSummary> {
    const ch = await this.channel;
    onProgress?.('connected');
    return exchangeOver(ch, (fn) => {
      this.listener = fn;
      this.inbox.splice(0).forEach(fn);
    }, onProgress);
  }

  close() {
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

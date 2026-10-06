/**
 * Verbindingsgegevens (WebRTC-"SDP") compact maken voor een QR-code, en weer terug.
 * Een SDP voor alleen een datakanaal is ca. 900 tekens; de onderdelen die ertoe doen
 * (ICE-gebruikersnaam en -wachtwoord, DTLS-vingerafdruk, rol en kandidaat-adressen)
 * passen in ca. 150 tekens. Kleine QR-codes zijn veel makkelijker te scannen,
 * zeker met de webcam van een laptop.
 *
 * Formaat: PB1|o of a|ufrag|pwd|vingerafdruk (base64)|setup|kandidaat|kandidaat…
 * Kandidaat: h,adres,poort (host) of s,adres,poort (via STUN gevonden).
 */

export const PREFIX = 'PB1';

export interface Signal {
  type: 'offer' | 'answer';
  ufrag: string;
  pwd: string;
  /** SHA-256-vingerafdruk als 32 bytes */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  candidates: { kind: 'host' | 'srflx'; address: string; port: number }[];
}

const SETUP = { actpass: 'x', active: 'a', passive: 'p' } as const;
const SETUP_BACK = { x: 'actpass', a: 'active', p: 'passive' } as const;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Haalt de nodige onderdelen uit een volledige SDP. */
export function fromSdp(type: 'offer' | 'answer', sdp: string): Signal {
  const line = (key: string) => sdp.match(new RegExp(`^a=${key}:(.+)$`, 'm'))?.[1].trim();
  const fp = line('fingerprint');
  if (!fp || !fp.toLowerCase().startsWith('sha-256')) throw new Error('fingerprint');
  const candidates: Signal['candidates'] = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx)/gim)) {
    const c = { kind: m[3].toLowerCase() as 'host' | 'srflx', address: m[1], port: Number(m[2]) };
    if (!candidates.some((x) => x.address === c.address && x.port === c.port)) candidates.push(c);
  }
  return {
    type,
    ufrag: line('ice-ufrag')!,
    pwd: line('ice-pwd')!,
    fingerprint: Uint8Array.from(fp.split(' ')[1].split(':').map((h) => parseInt(h, 16))),
    setup: (line('setup') ?? 'actpass') as Signal['setup'],
    candidates,
  };
}

/** Bouwt een minimale, geldige SDP voor één datakanaal. */
export function toSdp(s: Signal): string {
  const fp = [...s.fingerprint].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const lines = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...s.candidates.map((c, i) =>
      c.kind === 'host'
        ? `a=candidate:${i + 1} 1 udp 2122260223 ${c.address} ${c.port} typ host`
        : `a=candidate:${i + 1} 1 udp 1686052607 ${c.address} ${c.port} typ srflx raddr 0.0.0.0 rport 0`,
    ),
    'a=end-of-candidates',
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${s.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  return lines.join('\r\n') + '\r\n';
}

export function encode(s: Signal): string {
  return [
    PREFIX,
    s.type === 'offer' ? 'o' : 'a',
    s.ufrag,
    s.pwd,
    b64(s.fingerprint),
    SETUP[s.setup],
    ...s.candidates.map((c) => `${c.kind === 'host' ? 'h' : 's'},${c.address},${c.port}`),
  ].join('|');
}

export class BadCode extends Error {}

export function decode(code: string): Signal {
  const parts = code.trim().split('|');
  if (parts[0] !== PREFIX || parts.length < 6) throw new BadCode('format');
  const [, t, ufrag, pwd, fp, setup, ...cands] = parts;
  if ((t !== 'o' && t !== 'a') || !(setup in SETUP_BACK)) throw new BadCode('format');
  const fingerprint = unb64(fp);
  if (fingerprint.length !== 32) throw new BadCode('fingerprint');
  return {
    type: t === 'o' ? 'offer' : 'answer',
    ufrag,
    pwd,
    fingerprint,
    setup: SETUP_BACK[setup as keyof typeof SETUP_BACK],
    candidates: cands.map((c) => {
      const [k, address, port] = c.split(',');
      if ((k !== 'h' && k !== 's') || !address || !Number(port)) throw new BadCode('candidate');
      return { kind: k === 'h' ? 'host' : 'srflx', address, port: Number(port) };
    }),
  };
}

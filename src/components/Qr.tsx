import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { t, useLang } from '../i18n';
import { Icon } from './Icon';

/** QR-code als SVG; altijd zwart op wit, ook in donkere modus (anders scannen camera's slecht). */
export function QrCode({ value, label }: { value: string; label: string }) {
  useLang();
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }, [value]);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text: value });
      else {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }
    } catch {
      /* delen afgebroken */
    }
  };

  return (
    <div class="qr-block">
      <div class="qr" role="img" aria-label={label} data-code={value} dangerouslySetInnerHTML={{ __html: svg }} />
      <button type="button" class="link small" onClick={share}>
        <Icon name="share" size={16} /> {copied ? t('peer.copied') : t('peer.shareText')}
      </button>
    </div>
  );
}

interface ScanProps {
  /** Alleen codes die hiermee beginnen worden geaccepteerd. */
  prefix: string;
  onCode: (code: string) => void;
}

type CamState = 'starting' | 'running' | 'denied' | 'none';

/** Camera met QR-herkenning (jsQR), plus een tekstveld om de code te plakken als er geen camera is. */
export function QrScanner({ prefix, onCode }: ScanProps) {
  useLang();
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CamState>('starting');
  const [mirror, setMirror] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState(false);
  const done = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const accept = (code: string) => {
    if (done.current) return;
    done.current = true;
    onCodeRef.current(code);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        setCam((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'none');
        return;
      }
      if (stopped) return stream.getTracks().forEach((tr) => tr.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      // Voorcamera (laptop): beeld spiegelen zodat bewegen natuurlijk voelt.
      setMirror(stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment');
      setCam('running');
      timer = setInterval(() => {
        if (done.current || v.readyState < 2 || !v.videoWidth) return;
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (found?.data.startsWith(prefix)) accept(found.data);
      }, 200);
    })();

    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div class="scanner">
      {cam === 'starting' || cam === 'running' ? (
        <div class="scanner-view">
          <video ref={video} muted playsInline class={mirror ? 'mirror' : ''} />
          <div class="scanner-frame" aria-hidden="true" />
          {cam === 'starting' && <p class="scanner-msg">{t('peer.cameraStarting')}</p>}
        </div>
      ) : (
        <p class="banner banner-warn">{t(cam === 'denied' ? 'peer.cameraDenied' : 'peer.cameraNone')}</p>
      )}
      <details class="paste" open={cam === 'denied' || cam === 'none'}>
        <summary>{t('peer.pasteInstead')}</summary>
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const code = pasted.trim();
            if (code.startsWith(prefix)) accept(code);
            else setPasteError(true);
          }}
        >
          <textarea class="input" rows={3} value={pasted} placeholder="PB1|…" onInput={(e) => (setPasted(e.currentTarget.value), setPasteError(false))} />
          {pasteError && <p class="error">{t('peer.badCode')}</p>}
          <button type="submit" class="btn">
            {t('common.ok')}
          </button>
        </form>
      </details>
    </div>
  );
}

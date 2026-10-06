import { useEffect, useRef, useState } from 'preact/hooks';
import type { ImportSummary } from '../backup/import';
import { t, tn, useLang } from '../i18n';
import { useStore } from '../lib/store';
import { toLocalIso } from '../lib/time';
import { goBack } from '../router';
import { onlineStore, updateSettings } from '../state';
import { Peer, PeerFailure, type PeerError } from '../sync/peer';
import { PREFIX } from '../sync/signal';
import { Header } from '../components/common';
import { Icon } from '../components/Icon';
import { QrCode, QrScanner } from '../components/Qr';

/**
 * Synchroniseren met een ander toestel via twee QR-codes:
 * toestel 1 toont een code → toestel 2 scant die en toont een antwoordcode → toestel 1 scant die.
 * Daarna een directe verbinding; beide toestellen wisselen alles uit en voegen samen.
 */
type Step =
  | { s: 'choose' }
  | { s: 'preparing' }
  | { s: 'showOffer'; code: string }
  | { s: 'scanAnswer' }
  | { s: 'scanOffer' }
  | { s: 'showAnswer'; code: string }
  | { s: 'connecting' }
  | { s: 'transferring' }
  | { s: 'done'; summary: ImportSummary }
  | { s: 'error'; reason: PeerError | 'unknown'; details: string };

export function SyncScreen() {
  useLang();
  const [step, setStep] = useState<Step>({ s: 'choose' });
  const peer = useRef<Peer | null>(null);
  const online = useStore(onlineStore);

  useEffect(() => () => peer.current?.close(), []);

  const fail = (e: unknown) =>
    setStep({
      s: 'error',
      reason: e instanceof PeerFailure ? e.reason : 'unknown',
      details: e instanceof PeerFailure ? e.details : String(e),
    });

  /** Uitwisselen zodra de verbinding er is (wacht op de achtergrond). */
  const run = (p: Peer) =>
    p
      .exchange((progress) => progress === 'connected' && setStep({ s: 'transferring' }))
      .then(async (summary) => {
        await updateSettings({ lastSyncAt: toLocalIso() });
        setStep({ s: 'done', summary });
        p.close();
      })
      .catch(fail);

  const host = async () => {
    setStep({ s: 'preparing' });
    try {
      const { peer: p, code } = await Peer.host();
      peer.current = p;
      setStep({ s: 'showOffer', code });
    } catch (e) {
      fail(e);
    }
  };

  const onAnswer = async (code: string) => {
    setStep({ s: 'connecting' });
    try {
      await peer.current!.accept(code);
      run(peer.current!);
    } catch (e) {
      fail(e);
    }
  };

  const onOffer = async (code: string) => {
    setStep({ s: 'preparing' });
    try {
      const { peer: p, code: answer } = await Peer.join(code);
      peer.current = p;
      setStep({ s: 'showAnswer', code: answer });
      run(p);
    } catch (e) {
      fail(e);
    }
  };

  const restart = () => {
    peer.current?.close();
    peer.current = null;
    setStep({ s: 'choose' });
  };

  return (
    <div class="screen sync-screen">
      <Header
        title={t('peer.title')}
        left={
          <button type="button" class="icon-btn" aria-label={t('common.back')} onClick={() => goBack('#/settings')}>
            <Icon name="back" size={24} />
          </button>
        }
      />
      <div class="content">
        {step.s === 'choose' && (
          <>
            <p>{t('peer.intro')}</p>
            {!online && <p class="banner banner-warn">{t('peer.offlineHint')}</p>}
            <button type="button" class="choice card" onClick={host}>
              <strong>{t('peer.hostTitle')}</strong>
              <span class="muted small">{t('peer.hostHint')}</span>
            </button>
            <button type="button" class="choice card" onClick={() => setStep({ s: 'scanOffer' })}>
              <strong>{t('peer.joinTitle')}</strong>
              <span class="muted small">{t('peer.joinHint')}</span>
            </button>
            <p class="muted small">{t('peer.privacy')}</p>
          </>
        )}

        {step.s === 'preparing' && (
          <>
            <Progress text={t('peer.preparing')} />
            <p class="muted small">{t('peer.cameraWhy')}</p>
          </>
        )}

        {step.s === 'showOffer' && (
          <>
            <StepLabel n={1} text={t('peer.step1Host')} />
            <QrCode value={step.code} label={t('peer.qrLabel')} />
            <button type="button" class="btn btn-primary btn-block" onClick={() => setStep({ s: 'scanAnswer' })}>
              {t('peer.nextScanAnswer')}
            </button>
          </>
        )}

        {step.s === 'scanAnswer' && (
          <>
            <StepLabel n={2} text={t('peer.step2Host')} />
            <QrScanner prefix={`${PREFIX}|a|`} onCode={onAnswer} />
          </>
        )}

        {step.s === 'scanOffer' && (
          <>
            <StepLabel n={1} text={t('peer.step1Join')} />
            <QrScanner prefix={`${PREFIX}|o|`} onCode={onOffer} />
          </>
        )}

        {step.s === 'showAnswer' && (
          <>
            <StepLabel n={2} text={t('peer.step2Join')} />
            <QrCode value={step.code} label={t('peer.qrLabel')} />
            <Progress text={t('peer.waiting')} />
          </>
        )}

        {step.s === 'connecting' && <Progress text={t('peer.connecting')} />}
        {step.s === 'transferring' && <Progress text={t('peer.transferring')} />}

        {step.s === 'done' && (
          <div class="card center">
            <Icon name="refresh" size={36} class="accent" />
            <h2>{t('peer.doneTitle')}</h2>
            <p>
              {[
                tn('peer.sumAdded', step.summary.added),
                tn('peer.sumUpdated', step.summary.updated),
                tn('peer.sumDeleted', step.summary.deleted),
              ].join(', ')}
            </p>
            <p class="muted small">{t('peer.doneHint')}</p>
            <button type="button" class="btn btn-primary btn-block" onClick={() => goBack('#/settings')}>
              {t('common.done')}
            </button>
          </div>
        )}

        {step.s === 'error' && (
          <div class="card">
            <p class="error">{t(`peer.error.${step.reason}`)}</p>
            {step.details && (
              <details class="small muted">
                <summary>{t('peer.details')}</summary>
                <p class="tech">{step.details}</p>
              </details>
            )}
            <button type="button" class="btn btn-primary btn-block" onClick={restart}>
              {t('peer.tryAgain')}
            </button>
          </div>
        )}

        {step.s !== 'choose' && step.s !== 'done' && step.s !== 'error' && (
          <button type="button" class="link" onClick={restart}>
            {t('peer.startOver')}
          </button>
        )}
      </div>
    </div>
  );
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <p class="step-label">
      <span class="step-n">{n}</span> {text}
    </p>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <p class="progress" role="status">
      <Icon name="refresh" size={20} class="spin accent" /> {text}
    </p>
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ImportSummary } from '../backup/import';
import { t, tn, useLang } from '../i18n';
import { useStore } from '../lib/store';
import { toLocalIso } from '../lib/time';
import { goBack } from '../router';
import { onlineStore, updateSettings } from '../state';
import { newSession, parseCode, PREFIX, RelayFailure, runHost, runJoin, type Progress, type RelayError, type Session } from '../sync/relay';
import { Header } from '../components/common';
import { Icon } from '../components/Icon';
import { QrCode, QrScanner } from '../components/Qr';

/**
 * Synchroniseren met een ander toestel: toestel 1 toont een QR-code, toestel 2 scant hem.
 * Daarna wisselen ze hun notities versleuteld uit via een doorgeefdienst (zie sync/relay.ts).
 */
type Step =
  | { s: 'choose' }
  | { s: 'showCode'; code: string; progress: Progress }
  | { s: 'scan' }
  | { s: 'working'; progress: Progress }
  | { s: 'done'; summary: ImportSummary }
  | { s: 'error'; reason: RelayError | 'unknown'; details: string };

export function SyncScreen() {
  useLang();
  const [step, setStep] = useState<Step>({ s: 'choose' });
  const online = useStore(onlineStore);
  /** Voorkomt dat een afgebroken poging later nog de stap verandert. */
  const attempt = useRef(0);

  useEffect(() => () => void attempt.current++, []);

  const fail = (e: unknown) =>
    setStep({
      s: 'error',
      reason: e instanceof RelayFailure ? e.reason : 'unknown',
      details: e instanceof RelayFailure ? e.details : String(e),
    });

  const run = (session: Session, role: 'host' | 'join', onProgress: (p: Progress) => void) => {
    const id = ++attempt.current;
    const alive = () => id === attempt.current;
    (role === 'host' ? runHost : runJoin)(session, (p) => alive() && onProgress(p))
      .then(async (summary) => {
        if (!alive()) return;
        await updateSettings({ lastSyncAt: toLocalIso() });
        setStep({ s: 'done', summary });
      })
      .catch((e) => alive() && fail(e));
  };

  const host = async () => {
    const session = await newSession();
    setStep({ s: 'showCode', code: session.code, progress: 'uploading' });
    // De code blijft zichtbaar tot het andere toestel zijn notities heeft klaargezet.
    run(session, 'host', (progress) =>
      setStep((cur) =>
        cur.s === 'showCode' && (progress === 'uploading' || progress === 'waiting') ? { ...cur, progress } : { s: 'working', progress },
      ),
    );
  };

  const onCode = async (code: string) => {
    try {
      const session = await parseCode(code);
      setStep({ s: 'working', progress: 'uploading' });
      run(session, 'join', (progress) => setStep({ s: 'working', progress }));
    } catch (e) {
      fail(e);
    }
  };

  const restart = () => {
    attempt.current++;
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
            <button type="button" class="choice card" onClick={host} disabled={!online}>
              <strong>{t('peer.hostTitle')}</strong>
              <span class="muted small">{t('peer.hostHint')}</span>
            </button>
            <button type="button" class="choice card" onClick={() => setStep({ s: 'scan' })} disabled={!online}>
              <strong>{t('peer.joinTitle')}</strong>
              <span class="muted small">{t('peer.joinHint')}</span>
            </button>
            <p class="muted small">{t('peer.privacy')}</p>
          </>
        )}

        {step.s === 'showCode' && (
          <>
            <p class="step-label">{t('peer.showCodeHint')}</p>
            <QrCode value={step.code} label={t('peer.qrLabel')} />
            <ProgressLine text={t(`peer.progress.${step.progress}`)} />
          </>
        )}

        {step.s === 'scan' && (
          <>
            <p class="step-label">{t('peer.scanHint')}</p>
            <QrScanner prefix={`${PREFIX}|`} onCode={onCode} />
          </>
        )}

        {step.s === 'working' && <ProgressLine text={t(`peer.progress.${step.progress}`)} />}

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

        {(step.s === 'showCode' || step.s === 'scan' || step.s === 'working') && (
          <button type="button" class="link" onClick={restart}>
            {t('peer.startOver')}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressLine({ text }: { text: string }) {
  return (
    <p class="progress" role="status">
      <Icon name="refresh" size={20} class="spin accent" /> {text}
    </p>
  );
}

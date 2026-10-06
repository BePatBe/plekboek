import { t, useLang } from '../i18n';

/** iPhone/iPad: stappen om de app op het beginscherm te zetten, plus de waarschuwing over gescheiden gegevens. */
export function IosInstallSteps() {
  useLang();
  return (
    <div class="ios-steps">
      <strong>{t('install.iosTitle')}</strong>
      <ol>
        <li>
          {t('install.iosStep1')} <ShareGlyph />
        </li>
        <li>{t('install.iosStep2')}</li>
        <li>{t('install.iosStep3')}</li>
      </ol>
      <p class="small">{t('install.iosWarning')}</p>
    </div>
  );
}

/** Het Deel-icoon van Safari (vierkant met pijl omhoog). */
function ShareGlyph() {
  return (
    <svg class="share-glyph" width="18" height="22" viewBox="0 0 18 22" aria-label={t('install.shareButton')} role="img">
      <path d="M9 1v13M4.5 5.5 9 1l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M6 9H2.5v11.5h13V9H12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
    </svg>
  );
}

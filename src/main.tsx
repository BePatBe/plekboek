import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { initInstall, initSettings, requestPersistence } from './state';
import './styles.css';

async function start() {
  initInstall();
  await initSettings();
  render(<App />, document.getElementById('app')!);
  requestPersistence();
  registerSW({ immediate: true });
}

start();

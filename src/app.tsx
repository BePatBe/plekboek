import { useEffect, useState } from 'preact/hooks';
import { useRoute } from './router';
import { useLang } from './i18n';
import { BottomNav } from './components/common';
import { SearchScreen } from './screens/SearchScreen';
import { ReadScreen } from './screens/ReadScreen';
import { SettingsScreen } from './screens/SettingsScreen';

type EditModule = typeof import('./screens/EditScreen');
type SyncModule = typeof import('./screens/SyncScreen');

// Het invoerscherm (met de Tiptap-editor) is het grootste deel van de code;
// pas laden als het nodig is, maar wel alvast op de achtergrond.
let editModule: Promise<EditModule> | null = null;
const loadEdit = () => (editModule ??= import('./screens/EditScreen'));

let syncModule: Promise<SyncModule> | null = null;
const loadSync = () => (syncModule ??= import('./screens/SyncScreen'));

function useSyncScreen(active: boolean): SyncModule['SyncScreen'] | null {
  const [mod, setMod] = useState<SyncModule | null>(null);
  useEffect(() => {
    if (active) loadSync().then(setMod);
  }, [active]);
  return mod?.SyncScreen ?? null;
}

function useEditScreen(): EditModule['EditScreen'] | null {
  const [mod, setMod] = useState<EditModule | null>(null);
  useEffect(() => {
    loadEdit().then(setMod);
  }, []);
  return mod?.EditScreen ?? null;
}

export function App() {
  useLang();
  const route = useRoute();
  const EditScreen = useEditScreen();
  const SyncScreen = useSyncScreen(route.name === 'sync');

  // Elk scherm begint bovenaan.
  useEffect(() => {
    document.querySelector('.screen')?.scrollTo(0, 0);
  }, [route]);

  let screen;
  switch (route.name) {
    case 'new':
      screen = EditScreen ? <EditScreen key={`new?${route.params}`} id={null} params={route.params} /> : <div class="screen" />;
      break;
    case 'edit':
      screen = EditScreen ? <EditScreen key={`edit-${route.id}`} id={route.id} params={null} /> : <div class="screen" />;
      break;
    case 'read':
      screen = <ReadScreen key={route.id} id={route.id} />;
      break;
    case 'sync':
      screen = SyncScreen ? <SyncScreen /> : <div class="screen" />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    default:
      screen = <SearchScreen />;
  }

  const showNav = route.name !== 'new' && route.name !== 'edit' && route.name !== 'sync';
  return (
    <div class={`app ${showNav ? 'with-nav' : ''}`}>
      {screen}
      {showNav && <BottomNav route={route} />}
    </div>
  );
}

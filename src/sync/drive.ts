import type { Remote } from './sync';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'plekboek-sync.json';

export class AuthExpired extends Error {}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new AuthExpired();
  if (!res.ok) throw new Error(`drive-${res.status}`);
  return res;
}

/** E-mailadres van het gekoppelde account, alleen voor weergave in de instellingen. */
export async function driveEmail(token: string): Promise<string | undefined> {
  const res = await call(token, `${API}/about?fields=user(emailAddress)`);
  return ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress;
}

/** Het sync-bestand in de verborgen app-map (appDataFolder) van Google Drive. */
export function driveRemote(token: string): Remote {
  let fileId: string | null = null;

  const find = async (): Promise<{ id: string; version: string } | null> => {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const res = await call(token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,version)&orderBy=createdTime&pageSize=10`);
    const files = ((await res.json()) as { files: { id: string; version: string }[] }).files;
    const f = files[0] ?? null;
    fileId = f?.id ?? null;
    return f;
  };

  return {
    async read() {
      const f = await find();
      if (!f) return null;
      const res = await call(token, `${API}/files/${f.id}?alt=media`);
      return { text: await res.text(), version: f.version };
    },
    async version() {
      return (await find())?.version ?? null;
    },
    async write(text) {
      if (fileId) {
        await call(token, `${UPLOAD}/files/${fileId}?uploadType=media`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: text,
        });
        return;
      }
      const boundary = `plekboek${Math.random().toString(36).slice(2)}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
      const res = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      fileId = ((await res.json()) as { id: string }).id;
    },
  };
}

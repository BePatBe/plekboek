import DOMPurify from 'dompurify';

/** De enige toegestane opmaak (§3): geen attributen. */
export const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li'];

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html ?? '', { ALLOWED_TAGS, ALLOWED_ATTR: [] }).trim();
}

const BLOCKS = new Set(['P', 'LI', 'UL', 'OL']);

/** Platte tekst: alinea's en lijstitems gescheiden door een regelovergang. */
export function toPlain(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const lines: string[] = [];
  let cur = '';
  const flush = () => {
    const line = cur.replace(/[ \t ]+/g, ' ').trim();
    if (line) lines.push(line);
    cur = '';
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) cur += child.textContent ?? '';
      else if (child.nodeName === 'BR') flush();
      else if (BLOCKS.has(child.nodeName)) {
        flush();
        walk(child);
        flush();
      } else walk(child);
    }
  };
  walk(doc.body);
  flush();
  return lines.join('\n');
}

/** Opschonen + platte tekst; een lege editor ("<p></p>") wordt een lege string. */
export function normalizeText(html: string): { text: string; textPlain: string } {
  const text = sanitize(html);
  const textPlain = toPlain(text);
  return { text: textPlain ? text : '', textPlain };
}

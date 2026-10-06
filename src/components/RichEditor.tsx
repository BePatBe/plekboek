import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { sanitize } from '../text/sanitize';
import { t, useLang } from '../i18n';

interface Props {
  value: string;
  onChange: (html: string) => void;
  label: string;
}

type Mark = 'bold' | 'italic' | 'underline' | 'bulletList' | 'orderedList';

const BUTTONS: { mark: Mark; text: string; key: string; run: (e: Editor) => boolean }[] = [
  { mark: 'bold', text: 'B', key: 'editor.bold', run: (e) => e.chain().focus().toggleBold().run() },
  { mark: 'italic', text: 'I', key: 'editor.italic', run: (e) => e.chain().focus().toggleItalic().run() },
  { mark: 'underline', text: 'U', key: 'editor.underline', run: (e) => e.chain().focus().toggleUnderline().run() },
  { mark: 'bulletList', text: '•≡', key: 'editor.bulletList', run: (e) => e.chain().focus().toggleBulletList().run() },
  { mark: 'orderedList', text: '1.≡', key: 'editor.orderedList', run: (e) => e.chain().focus().toggleOrderedList().run() },
];

/**
 * Tiptap met alleen de toegestane opmaak (§3/§4.2): vet, cursief, onderstrepen en lijsten.
 * Markdown-achtige invoer ("- " en "1. ") en Ctrl/⌘+B/I/U zitten in de extensies zelf.
 */
export function RichEditor({ value, onChange, label }: Props) {
  useLang();
  const el = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, rerender] = useState(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const ed = new Editor({
      element: el.current!,
      extensions: [
        StarterKit.configure({
          heading: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
          strike: false,
          link: false,
          dropcursor: false,
          trailingNode: false,
        }),
      ],
      content: value,
      editorProps: {
        // Plakken uit andere apps: alleen de toegestane opmaak blijft over.
        transformPastedHTML: (html) => sanitize(html),
        attributes: { class: 'rte-content rich', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label },
      },
      onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML()),
      onSelectionUpdate: () => rerender((x) => x + 1),
      onTransaction: () => rerender((x) => x + 1),
    });
    setEditor(ed);
    return () => ed.destroy();
  }, []);

  return (
    <div class="rte">
      <div class="rte-toolbar" role="toolbar" aria-label={t('editor.toolbar')}>
        {BUTTONS.map((b, i) => (
          <Fragment key={b.mark}>
            {i === 3 && <span class="rte-sep" />}
            <button
              type="button"
              class={`rte-btn rte-${b.mark}`}
              aria-pressed={editor?.isActive(b.mark) ?? false}
              aria-label={t(b.key)}
              title={t(b.key)}
              // Voorkom dat de knop de focus uit de editor haalt.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor && b.run(editor)}
            >
              {b.text}
            </button>
          </Fragment>
        ))}
      </div>
      <div ref={el} class="rte-host" onClick={() => editor?.commands.focus()} />
    </div>
  );
}

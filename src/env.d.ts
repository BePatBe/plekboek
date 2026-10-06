/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

export {};

declare global {
  const __APP_VERSION__: string;
}

// CSS-variabelen in style-objecten (bijv. { '--c': tag.color }).
declare module 'preact' {
  namespace JSX {
    interface CSSProperties {
      [key: `--${string}`]: string | number;
    }
  }
}

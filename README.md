# Plekboek

Notities op basis van locatie, als Progressive Web App. Alle data blijft op het toestel (IndexedDB); geen account, geen backend. Zie [SPEC.md](SPEC.md) voor het volledige ontwerp.

## Ontwikkelen

Vereist Node.js 20 of nieuwer.

```sh
npm install
npm run dev       # ontwikkelserver op http://localhost:5173
npm test          # Vitest: datalaag, export/import, analyse
npm run build     # type-check + productiebuild in dist/
npm run preview   # de build lokaal bekijken (incl. service worker)
```

GPS en de service worker werken alleen via HTTPS of `localhost`. Om op een telefoon te testen zonder te deployen: `npm run dev -- --host` werkt voor de interface, maar locatie en offline-gebruik pas na deployen (HTTPS).

## Deployen naar GitHub Pages

1. Maak een repository op GitHub en push deze map naar de branch `main`.
2. Zet in de repository onder **Settings → Pages** de bron op **GitHub Actions**.
3. Elke push naar `main` draait de tests, bouwt de app en zet hem online via [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

De app gebruikt een relatieve `base` en hash-routing, dus hij werkt op elk pad (`https://<gebruiker>.github.io/<repo>/`).

## Installeren

- **Android (Chrome/Edge):** link openen → *App installeren* (of menu ⋮ → *App installeren*).
- **iPhone/iPad (Safari):** Deel-knop → *Zet op beginscherm* → *Voeg toe*. Doe dit vóór je notities maakt: Safari en de geïnstalleerde app hebben gescheiden opslag.
- **Windows (Chrome/Edge):** installeer-icoon rechts in de adresbalk, of menu → *Apps* → *Plekboek installeren*.

Twee toestellen gelijk houden: **Instellingen → Synchroniseren met ander toestel** (één QR-code scannen; de notities gaan versleuteld via de gratis doorgeefdienst ntfy.sh, die de inhoud niet kan lezen). Een back-up als bestand kan via **Exporteren/Importeren**.

## Structuur

```
src/
  db/          Dexie-schema, notities (CRUD, zoeken, sorteren), tags, instellingen
  backup/      export, import (validatie, samenvoegen/vervangen, migraties)
  analysis/    "beste moment" per tijdvak, weekdag en maand
  sync/        synchroniseren: QR-code, AES-versleuteling, doorgeefluik ntfy.sh
  geo/         afstand, GPS, Nominatim (met rate limit), titelvoorstel
  i18n/        nl.json, en.json
  components/  kaarten (Leaflet), cards-wiel, editor (Tiptap), tagkiezer, …
  screens/     zoeken, invoer, lezen, instellingen
tests/         Vitest
```

## Licenties en bronnen

Kaartdata © OpenStreetMap-bijdragers (ODbL). Tegels van `tile.openstreetmap.org` worden alleen gecachet wanneer je ze bekijkt; bulk downloaden is volgens het OSM-gebruiksbeleid niet toegestaan. Adres zoeken en titelvoorstellen gebruiken Nominatim, met maximaal één verzoek per seconde.

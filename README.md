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

## Google Drive-synchronisatie instellen (eenmalig)

De app synchroniseert via een verborgen map in de eigen Google Drive van de gebruiker. Daarvoor heeft de app een OAuth-client-ID nodig:

1. Ga naar [Google Cloud Console](https://console.cloud.google.com/) en maak een project (bijv. "Plekboek").
2. **APIs & Services → Library:** zoek *Google Drive API* en klik *Enable*.
3. **Google Auth Platform → Branding / Audience:** app-naam "Plekboek", je eigen e-mailadres als contact, type *External*. Laat de status op *Testing* en voeg onder *Test users* de Google-accounts toe die mogen synchroniseren.
4. **Data access:** voeg de scope `https://www.googleapis.com/auth/drive.appdata` toe.
5. **Clients → Create client:** type *Web application*. Bij *Authorized JavaScript origins*: `https://bepatbe.github.io` en (voor lokaal testen) `http://localhost:5173` en `http://localhost:4173`. Geen redirect-URI nodig.
6. Kopieer het client-ID (`…apps.googleusercontent.com`) en zet het in GitHub onder **Settings → Secrets and variables → Actions → Variables** als `GOOGLE_CLIENT_ID`. Start daarna de workflow opnieuw.

Lokaal: maak een bestand `.env.local` met `VITE_GOOGLE_CLIENT_ID=…`.

## Installeren

- **Android (Chrome/Edge):** link openen → *App installeren* (of menu ⋮ → *App installeren*).
- **iPhone/iPad (Safari):** Deel-knop → *Zet op beginscherm* → *Voeg toe*. Doe dit vóór je notities maakt: Safari en de geïnstalleerde app hebben gescheiden opslag.
- **Windows (Chrome/Edge):** installeer-icoon rechts in de adresbalk, of menu → *Apps* → *Plekboek installeren*.

Overzetten naar een ander toestel gaat via **Instellingen → Back-up → Exporteren/Importeren**.

## Structuur

```
src/
  db/          Dexie-schema, notities (CRUD, zoeken, sorteren), tags, instellingen
  backup/      export, import (validatie, samenvoegen/vervangen, migraties)
  analysis/    "beste moment" per tijdvak, weekdag en maand
  geo/         afstand, GPS, Nominatim (met rate limit), titelvoorstel
  i18n/        nl.json, en.json
  components/  kaarten (Leaflet), cards-wiel, editor (Tiptap), tagkiezer, …
  screens/     zoeken, invoer, lezen, instellingen
tests/         Vitest
```

## Licenties en bronnen

Kaartdata © OpenStreetMap-bijdragers (ODbL). Tegels van `tile.openstreetmap.org` worden alleen gecachet wanneer je ze bekijkt; bulk downloaden is volgens het OSM-gebruiksbeleid niet toegestaan. Adres zoeken en titelvoorstellen gebruiken Nominatim, met maximaal één verzoek per seconde.

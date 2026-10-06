# Plekboek: notities op basis van locatie

> Werktitel: **Plekboek** (EN: *PlaceLog*). De naam is nog aan te passen.

Een gratis app voor de telefoon waarmee je aantekeningen koppelt aan een plek op de kaart, met datum/tijd, één tag en een sterrenbeoordeling. Door een plek vaker te bezoeken en telkens een nieuwe notitie te maken, zie je na verloop van tijd **wat het beste moment is voor die plek**.

---

## 1. Uitgangspunten

| Eis | Invulling |
|---|---|
| Draait op Android, iPhone en Windows-laptops (Chrome/Edge) | **Progressive Web App (PWA)**: je installeert hem via de browser op het startscherm (telefoon) of als app in Windows (laptop) |
| Kost niets | Open-source libraries, OpenStreetMap-kaart, gratis hosting (GitHub Pages) |
| Lokale database | IndexedDB in de browser, via Dexie.js |
| Overzetten naar een nieuw toestel | Export naar een JSON-bestand en import van dat bestand, of automatisch synchroniseren via de eigen Google Drive (keuze in Instellingen, zie §5a) |
| Offline bruikbaar | App-shell en data volledig offline; bekeken kaarttegels worden gecachet |
| Talen | Nederlands en Engels, te kiezen in de instellingen (standaard: taal van het toestel) |
| Weergave | Licht en donker, te kiezen in de instellingen (standaard: volgt het toestel) |
| Foto's | Niet in v1, maar datamodel en exportformaat houden er rekening mee (zie §9) |

**Geen backend, geen account, geen tracking.** Alle data blijft op het toestel. Alleen wie zelf kiest voor Google Drive-synchronisatie, slaat een kopie op in een verborgen map van de eigen Drive.

---

## 2. Techniek

- **Build:** Vite + TypeScript
- **UI:** Preact (klein en snel) met eenvoudige hash-routing (`#/search`, `#/note/new`, `#/note/:id`, `#/settings`)
- **Kaart:** Leaflet + OpenStreetMap-tegels, plus `leaflet.markercluster` voor veel markers
- **Database:** Dexie.js (wrapper rond IndexedDB)
- **Tekstopmaak:** Tiptap (rich-text-editor) + DOMPurify (opschonen van HTML)
- **PWA/offline:** `vite-plugin-pwa` (Workbox): precache van de app-shell, runtime-cache voor kaarttegels
- **i18n:** eigen kleine module met `nl.json` en `en.json`; geen zware library nodig
- **Donkere modus:** alle kleuren als CSS-variabelen (tokens). Zie §4.5.
- **Tests:** Vitest voor de datalaag, export/import en de "beste moment"-analyse
- **Hosting:** GitHub Pages. HTTPS is verplicht voor GPS en de service worker en zit daar standaard bij.

### Platform-aandachtspunten
- **iPhone:** gebruik de app via *Deel → Zet op beginscherm*. Alleen zo blijft de opslag behouden; Safari kan data van niet-geïnstalleerde sites na 7 dagen zonder gebruik wissen.
- Vraag bij de eerste start `navigator.storage.persist()` aan, zodat de browser de data niet zomaar opruimt.
- **GPS** (`navigator.geolocation`) werkt ook zonder internet, maar alleen als de app open is. Er is geen achtergrondtracking, en dat is ook niet nodig.
- **Windows-laptop:**
  - **Locatie:** de meeste laptops hebben geen GPS. `navigator.geolocation` gebruikt dan de Windows-locatiedienst (positie via wifi, vaak 20–500 m nauwkeurig). Daarvoor moet Locatie aanstaan in Windows (Instellingen → Privacy en beveiliging → Locatie). Offline is er meestal geen positie. *Kies op kaart* is op de laptop dus de gewone manier. Is de nauwkeurigheid slechter dan `samePlaceRadiusM`, dan toont de app een waarschuwing met de suggestie om de plek op de kaart te kiezen.
  - **Synchronisatie:** laptop en telefoon hebben elk hun eigen database. Overzetten gaat via export/import (§5) of via Google Drive (§5a).
  - **Firefox** werkt als website, maar installeren gaat alleen via Chrome/Edge.

### Installeren
De app moet eerst online staan (GitHub Pages, HTTPS). Daarna:
- **Android (Chrome/Edge):** de link openen en tikken op de melding *App installeren*, of via het menu ⋮ → *App installeren*.
- **Android (Samsung Internet):** menu → *Pagina toevoegen aan* → *Startscherm*.
- **iPhone/iPad (Safari, of Chrome/Edge vanaf iOS 16.4):** Deel-knop → *Zet op beginscherm* → *Voeg toe*.
- **Windows (Chrome/Edge):** de link openen en klikken op het installeer-icoon rechts in de adresbalk, of via het menu → *Apps* → *Plekboek installeren*. De app krijgt een eigen venster en komt in het Startmenu (vastzetten op de taakbalk kan).
- **Verwijderen:** lang drukken op het icoon → verwijderen. Op Windows via Instellingen → Apps, of in de app via het menu → *Verwijderen*. Daarmee zijn ook alle notities weg, dus eerst exporteren.
- **iPhone-valkuil:** Safari en de geïnstalleerde app bewaren hun gegevens apart. Notities die je in Safari maakt, staan niet in de geïnstalleerde app. Installeer dus vóór je notities maakt.

**Installatiehulp in de app:**
- Herken een geïnstalleerde app via `matchMedia('(display-mode: standalone)')` of `navigator.standalone === true` (iOS). Is de app geïnstalleerd, dan blijft de hulp verborgen.
- **Android en Windows (Chrome/Edge):** vang de gebeurtenis `beforeinstallprompt` op en toon een eigen knop *Installeer Plekboek* (bij de eerste start en in Instellingen). Na een tik roep je `prompt()` aan.
- **iPhone, niet geïnstalleerd:** toon bij de eerste start een banner met de drie stappen, een plaatje van de Deel-knop en de waarschuwing over gescheiden gegevens. De banner is weg te klikken en blijft dan beschikbaar onder Instellingen.

---

## 3. Datamodel

```ts
type Rating = 1 | 2 | 3 | 4 | 5;

interface Note {
  id: string;              // UUID (crypto.randomUUID())
  lat: number;
  lng: number;
  accuracy?: number;       // meters, alleen bij GPS
  locationSource: 'gps' | 'map';
  observedAt: string;      // ISO 8601 met tijdzone-offset: moment van de waarneming (standaard "nu", aanpasbaar)
  title?: string;          // optioneel, korte naam van de plek (handig in lijsten)
  text: string;            // de aantekening als opgeschoonde HTML (zie "Opmaak" hieronder)
  textPlain: string;       // platte tekst afgeleid van `text`, voor zoeken en voorbeeldregels in lijsten
  tagId: string | null;    // precies 0 of 1 tag
  rating: Rating | null;   // sterren; leeg toegestaan
  createdAt: string;       // ISO, automatisch
  updatedAt: string;       // ISO, automatisch bij elke wijziging
  // v2: attachmentIds?: string[];
}

interface Tag {
  id: string;              // UUID
  name: string;            // door gebruiker ingevoerd, uniek (hoofdletterongevoelig)
  color: string;           // hex, automatisch uit een vast palet, aanpasbaar
  createdAt: string;
  updatedAt: string;
}

interface Settings {       // één record, key 'settings'
  language: 'nl' | 'en' | 'system';
  theme: 'light' | 'dark' | 'system';   // standaard 'system'
  samePlaceRadiusM: number;     // 25–500, standaard 100: notities binnen deze straal = "dezelfde plek"
  defaultMapCenter?: { lat: number; lng: number; zoom: number };
  lastExportAt?: string;
  backupReminderDays: number;   // standaard 30; 0 = uit
  syncMethod: 'file' | 'gdrive'; // per toestel, standaard 'file'
  driveEmail?: string;          // gekoppeld Google-account (alleen weergave)
  lastSyncAt?: string;
}

interface Deletion {         // tombstone: onthoudt verwijderingen voor samenvoegen/synchroniseren
  id: string;                // id van de verwijderde notitie of tag
  kind: 'note' | 'tag';
  deletedAt: string;
}
```

**Dexie-schema (versie 1):**
```ts
db.version(1).stores({
  notes: 'id, observedAt, tagId, rating, updatedAt, [lat+lng]',
  tags: 'id, &name',
  settings: 'key',
});
db.version(2).stores({ deletions: 'id, kind' });
```

**Opmaak van `text`:** alleen deze HTML-tags zijn toegestaan, zonder attributen:
`<p> <br> <strong> <em> <u> <ul> <ol> <li>`.
Alles wordt bij opslaan, bij weergeven én bij importeren door **DOMPurify** gehaald met precies deze whitelist. `textPlain` wordt bij elke opslag opnieuw berekend (lijstitems en alinea's gescheiden door een regelovergang).

Regels:
- Een **nieuw bezoek is altijd een nieuwe notitie**. Bestaande notities kun je bewerken (typfouten), maar het concept is "één notitie per moment".
- Wordt een tag verwijderd, dan vraagt de app of de notities **geen tag** krijgen of naar een **andere tag** gaan.

---

## 4. Schermen

Mockups per scherm staan in [mockups/](mockups/): `1-zoeken.jpg`, `2-invoer.jpg`, `3-lezen.jpg`, `4-instellingen.jpg`, elk ook in een donkere versie (`…-donker.jpg`), plus `telefoon-zoeken(-donker).jpg` op echt telefoonformaat. Ze laten de indeling en de stijl zien; bij verschillen gaat de tekst van deze spec voor.

**Markers op alle kaarten** (zoekscherm, minikaart op het invoerscherm, minikaart op het leesscherm) hebben **de kleur van hun tag**. Notities zonder tag krijgen een neutrale grijze marker. Op het invoerscherm verandert de pin direct van kleur als je een andere tag kiest. Een cluster van markers toont een ring met de verhouding van de tagkleuren erin, en het aantal in het midden.

Onderin staat een navigatiebalk met drie knoppen: **Zoeken**, **+ Nieuw**, **Instellingen**. Het leesscherm open je vanuit de zoekresultaten.

**Groot scherm en muis (laptop):**
- Vanaf ca. 900 px breed staat op het zoekscherm de kaart links (ca. 60%) en de cards rechts in een kolom. De andere schermen gebruiken een gecentreerde kolom van max. 640 px.
- Een nieuwe notitie op een plek maak je met **lang drukken op de kaart** of met **rechtsklik** (`contextmenu`).
- Het cards-wiel draait met het muiswiel (scroll-snap). De toetsen **↑/↓** gaan naar de vorige/volgende card, en **Enter** opent de actieve card.
- De pin is met de muis te slepen (dat doet Leaflet al). De sneltoetsen voor de editor staan in §4.2.

### 4.1 Zoekscherm (startscherm)
- **Kaart** in het bovenste deel (ca. een derde van het scherm), met markers in de kleur van hun tag. Markers clusteren bij uitzoomen.
- **Knop "Mijn locatie"** centreert de kaart op de GPS-positie.
- **Adres/plaats zoeken** (alleen online) via Nominatim (OpenStreetMap-geocoder, gratis). Respecteer de limiet van max. 1 request per seconde: debounce en alleen zoeken op Enter.
- **Tekstzoekveld** doorzoekt `title`, `textPlain` en tagnaam (hoofdletterongevoelig, accentongevoelig).
- **Filters** (uitklapbaar):
  - tag
  - minimale beoordeling (sterren)
  - periode (van/tot)
  - tijdstip van de dag (ochtend / middag / avond / nacht)
  - "Alleen in kaartgebied": beperkt de resultaten tot de zichtbare kaart
- **Resultaten als cards** in het onderste deel, onder de kaart. Kaart en cards tonen altijd dezelfde set.
  - Je **scrolt verticaal** (van onder naar boven en terug) door de cards. Ze klikken per card vast in het midden van het resultatenvak (CSS `scroll-snap-align: center`).
  - **Eén card is steeds groot:** de card in het midden is de *actieve* card en toont alles: titel, sterren, tag, datum/tijd, de eerste 2–3 regels van de aantekening en de afstand tot je huidige locatie (als die bekend is).
  - **De cards eromheen zijn kleiner:** één compacte regel met titel, sterren en datum, iets verkleind en vervaagd. Hoe verder van het midden, hoe kleiner en lichter.
  - **Wiel-effect** (zoals een datum/tijd-kiezer op de telefoon): de cards lijken op een liggende cilinder te zitten die je ronddraait. Cards boven het midden kantelen naar achteren, cards eronder naar voren. Uitwerking:
    - per card wordt bij elke scroll-frame (`requestAnimationFrame`) de afstand `d` tot het midden berekend, genormaliseerd naar −1…1;
    - transform: `perspective(700px) rotateX(d × −55°) scale(1 − |d| × 0.18)`, `opacity: 1 − |d| × 0.7`;
    - de actieve card (d ≈ 0) klapt vloeiend open naar de grote weergave, en de vorige actieve card klapt dicht;
    - snappen via `scroll-snap-type: y mandatory` en native momentum-scroll, zodat het wiel natuurlijk uitloopt en op één card stopt;
    - een kort tikje (`navigator.vibrate(5)`, alleen Android) als er een nieuwe card in het midden klikt;
    - bij `prefers-reduced-motion` alleen schalen en vervagen, zonder kantelen.
  - Tik op een **kleine card**: die scrolt naar het midden en wordt actief. Tik op de **actieve card**: het leesscherm opent.
  - **Gekoppeld aan de kaart:** de marker van de actieve card wordt groter en gemarkeerd, en de kaart schuift er zo nodig naartoe. Tik je op een marker, dan scrolt de lijst naar die card.
  - Boven de cards staat een balkje met het aantal en de positie ("3 / 8 resultaten") en de sortering.
  - Standaardsortering: **1. beoordeling** (hoogste eerst), **2. datum/tijd** (`observedAt`, nieuwste eerst) bij gelijke beoordeling. Notities zonder beoordeling komen achteraan, onderling gesorteerd op datum/tijd.
  - Bij veel resultaten wordt de lijst gevirtualiseerd (alleen de cards rond de actieve card worden gerenderd).
  - Geen resultaten: één lege card met "Niets gevonden. Pas je zoekterm of filters aan."
- Het **leesscherm** open je door op de actieve card te tikken.
- Lang drukken op de kaart opent een **nieuwe notitie op die plek**.

### 4.2 Invoerscherm (nieuw/bewerken)
Velden, van boven naar beneden:
1. **Locatie**: een minikaart met een sleepbare pin in de kleur van de gekozen tag (grijs zolang er geen tag is).
   - Bij een nieuwe notitie wordt de GPS-positie direct opgevraagd (met nauwkeurigheid in meters).
   - Knoppen: *Gebruik GPS* / *Kies op kaart*. Tikken op de kaart verplaatst de pin en zet `locationSource = 'map'`.
   - Is de kaart offline niet beschikbaar, dan werkt GPS gewoon en toont de app de coördinaten als tekst.
2. **Datum en tijd**: standaard nu, aanpasbaar via de native date/time-picker.
3. **Titel** (optioneel): wordt automatisch voorgesteld op basis van de locatie en is altijd vrij aan te passen.
   - **Eerst lokaal:** ligt er een eerdere notitie met een titel binnen `samePlaceRadiusM` (de "zelfde plek"-straal), dan neemt de app de titel van de dichtstbijzijnde over. Dit werkt ook offline en zorgt dat herhaalde bezoeken dezelfde naam krijgen.
   - **Anders online:** de app zoekt de plaatsnaam op via Nominatim reverse geocoding (in de taal van de app). De meest specifieke naam krijgt voorrang: naam van de plek/POI, dan straat, dan wijk/dorp, dan plaats. Bijvoorbeeld: "Vogelhut De Kiekendief" of "Dorpsstraat, Ootmarsum".
   - **Offline en geen eerdere notitie:** het veld blijft leeg. Zodra er weer verbinding is, verschijnt "Naam ophalen" als knop naast het veld.
   - Het voorstel wordt alleen ingevuld zolang de gebruiker de titel nog **niet zelf heeft aangepast**. Wordt de pin daarna verplaatst, dan wordt de automatische titel ververst; een handmatige titel blijft staan.
   - Een klein icoon (↻) naast het veld haalt het voorstel opnieuw op.
4. **Aantekening**: een meerregelig tekstveld dat meegroeit, met **basisopmaak**.
   - Werkbalk boven het veld (blijft zichtbaar boven het toetsenbord): **B** (vet), *I* (cursief), U (onderstrepen), • (opsommingslijst), 1. (genummerde lijst).
   - Een knop staat "aan" als de cursor in zo'n opmaak staat; nogmaals tikken zet de opmaak uit.
   - Sneltoetsen voor wie een toetsenbord gebruikt: Ctrl/⌘+B, I, U. Typ je "- " of "1. " aan het begin van een regel, dan begint automatisch een lijst.
   - Plakken van tekst uit andere apps: alle opmaak behalve de toegestane wordt verwijderd.
   - Editor: **Tiptap** (`@tiptap/core` + `starter-kit` + `extension-underline`), framework-onafhankelijk en goed op mobiel. Alles wat niet in de lijst hieronder staat, schakel je uit (koppen, code, citaten, enz.).
5. **Tag**: een keuzelijst met de bestaande tags, plus *+ Nieuwe tag* om er direct een aan te maken.
6. **Beoordeling**: 5 tikbare sterren; nogmaals tikken op dezelfde ster wist de beoordeling.

Knoppen: **Opslaan** en **Annuleren** (met bevestiging als er wijzigingen zijn). Bij bewerken is er ook **Verwijderen** (met bevestiging).
Validatie: een locatie is verplicht. Daarnaast moet tekst, titel of beoordeling ingevuld zijn.
**Concept-autosave:** zolang je typt, wordt een concept bewaard (localStorage), zodat niets verloren gaat als de app wordt afgesloten.

### 4.3 Leesscherm
- Titel, datum/tijd (in de taal van de app), tag (gekleurd label), sterren en de volledige tekst met opmaak (opgeschoonde HTML, zie §3).
- Een minikaart met de pin in de tagkleur, plus coördinaten en GPS-nauwkeurigheid.
- Knoppen: **Bewerken**, **Verwijderen**, **Nieuwe notitie op deze plek** (zelfde coördinaten, tijd = nu).
- **Sectie "Deze plek door de tijd"**:
  - alle notities binnen `samePlaceRadiusM` van deze notitie, als tijdlijn (met de afstand per notitie erbij);
  - **beste moment**: de gemiddelde beoordeling per tijdstip van de dag, per dag van de week en per maand, als eenvoudige balkjes. De beste waarde wordt gemarkeerd, en het aantal notities per groep staat erbij (bijv. "★ 4,5 · 3×").
  - Dit tonen we pas vanaf 2 beoordeelde notities.

Tijdvakken: nacht 0–6 u, ochtend 6–12 u, middag 12–18 u, avond 18–24 u (lokale tijd van `observedAt`).

### 4.4 Instellingen
- **Taal:** Systeem / Nederlands / English.
- **Weergave:** Systeem / Licht / Donker. Een wijziging is direct zichtbaar, zonder herstart.
- **Tags beheren:** een lijst met naam, kleur en aantal notities. Je kunt tags toevoegen, hernoemen, van kleur veranderen en verwijderen (zie de regel in §3).
- **"Zelfde plek"-straal:** een schuifregelaar van 25 tot 500 m (stappen van 25 m, standaard 100 m), met de gekozen waarde ernaast. Notities binnen deze straal tellen als één plek (voor het titelvoorstel en de "beste moment"-analyse).
- **Back-up en synchronisatie:** keuze *Bestand* of *Google Drive* (§5a). Bij Google Drive blijft de handmatige back-up beschikbaar onder een uitklapbaar kopje.
- **Back-up via bestand:**
  - *Exporteren*: maakt een JSON-bestand (zie §5) en biedt het aan via de deelfunctie (Web Share API, zodat je het kunt opslaan in Bestanden, Drive, mail, enz.). Web Share werkt ook op Windows (Chrome/Edge). Als dat niet beschikbaar is, wordt het bestand gedownload (op de laptop naar de map Downloads).
  - *Importeren*: kies een bestand en kies daarna **Samenvoegen** of **Alles vervangen** (met bevestiging).
  - Toont "Laatste back-up: …" en een herinnering na `backupReminderDays` dagen.
- **Offline-kaart:** toont de grootte van de tegelcache en een knop *Cache wissen*.
- **App installeren** (alleen zichtbaar als de app nog niet geïnstalleerd is): de knop *Installeer Plekboek* op Android en Windows, of de stappenuitleg op de iPhone (zie §2, Installeren).
- **Over:** versie, licenties (OpenStreetMap-attributie, Leaflet).

### 4.5 Donkere modus
- **Instelling:** Systeem (volgt `prefers-color-scheme` van het toestel en wisselt mee als het toestel wisselt, bijv. 's avonds), Licht of Donker.
- **Opbouw:** alle kleuren zijn CSS-variabelen op `:root` (achtergrond, kaartvlak, tekst, gedempte tekst, lijnen, accent, sterren, waarschuwing, gevaar). Het donkere thema overschrijft alleen die variabelen, via `@media (prefers-color-scheme: dark)` en een `data-theme="dark"`/`"light"`-attribuut op `<html>` dat de keuze uit de instellingen afdwingt. Componenten gebruiken nooit losse kleurwaarden.
- **Kleuren donker:** geen puur zwart maar een donkergroen-grijze achtergrond (ca. `#141a18`), cards iets lichter (ca. `#1d2522`), tekst gebroken wit. Het accentgroen wordt lichter (ca. `#5cc29d`), zodat het genoeg contrast heeft. Alles minimaal WCAG AA (4,5:1 voor tekst).
- **Tagkleuren:** een tag heeft één opgeslagen kleur. In donkere modus berekent de app voor labels een lichtere tekstkleur en een donkere, doorschijnende achtergrond van dezelfde tint. Markers houden hun eigen kleur met een witte rand, zodat ze op de donkere kaart goed opvallen.
- **Kaart:** OpenStreetMap heeft geen gratis donkere tegels. Daarom krijgt alleen de tegellaag in donkere modus een CSS-filter: `filter: invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)`. Dat werkt ook met gecachete tegels (offline) en kost niets. Markers, cluster en je eigen locatie vallen buiten het filter.
- **Systeemkleuren:** `<meta name="theme-color">` met twee varianten (`media="(prefers-color-scheme: dark)"`), en `color-scheme: light dark`, zodat datum/tijd-kiezers, scrollbalken en het toetsenbord meekleuren.
- **Teksteditor en opgemaakte tekst** volgen dezelfde variabelen.

---

## 5. Export-/importformaat

Bestandsnaam: `plekboek-backup-YYYY-MM-DD.json`

```json
{
  "app": "plekboek",
  "schemaVersion": 1,
  "exportedAt": "2026-10-02T14:30:00+02:00",
  "tags":  [ { "id": "…", "name": "Vogels", "color": "#2a9d8f", "createdAt": "…", "updatedAt": "…" } ],
  "notes": [ { "id": "…", "lat": 52.37, "lng": 4.89, "locationSource": "gps", "accuracy": 8,
               "observedAt": "2026-09-30T07:15:00+02:00", "title": "Vogelhut", "text": "<p>Veel <strong>lepelaars</strong></p><ul><li>12 stuks</li></ul>",
               "textPlain": "Veel lepelaars\n12 stuks",
               "tagId": "…", "rating": 4, "createdAt": "…", "updatedAt": "…" } ],
  "settings": { "language": "system", "theme": "system", "samePlaceRadiusM": 100, "backupReminderDays": 30 }
}
```

**Import-regels:**
- Controleer eerst `app` en `schemaVersion`. Een oudere versie wordt gemigreerd, een nieuwere versie geeft een nette foutmelding.
- Valideer elk record (types, lat tussen −90 en 90, lng tussen −180 en 180, rating 1–5 of null). Ongeldige records worden overgeslagen en gemeld.
- `text` gaat altijd door DOMPurify met de whitelist uit §3; `textPlain` wordt opnieuw berekend en niet blind overgenomen.
- **Samenvoegen:** match op `id`; bij een conflict wint de nieuwste `updatedAt`. Tags met dezelfde naam maar een ander `id` worden samengevoegd, en de `tagId` van de betrokken notities wordt omgezet.
- **Vervangen:** alles wissen en dan importeren, in één Dexie-transactie (alles of niets).
- **Verwijderingen:** het bestand bevat ook `deletions` (optioneel veld in versie 1; oudere bestanden zonder dat veld blijven geldig). Een record verdwijnt bij samenvoegen als het niet ná de verwijdering is gewijzigd; een later gewijzigd record blijft en de tombstone vervalt.
- **Tags met dezelfde naam** en een ander `id`: de tag met het kleinste `id` wint, op elk toestel. Zo komen toestellen na synchroniseren op dezelfde tags uit.
- Toon na afloop een samenvatting: "123 notities toegevoegd, 4 bijgewerkt, 1 overgeslagen".

## 5a. Synchroniseren via Google Drive

- **Opslag:** één bestand `plekboek-sync.json` (zelfde formaat als §5) in de verborgen `appDataFolder` van de eigen Google Drive. Scope `drive.appdata`: de app ziet geen andere bestanden.
- **Inloggen:** Google Identity Services (token-model), geen eigen server. Een toegangstoken is ca. een uur geldig; daarna toont de kopbalk de knop *Nu synchroniseren* (één tik, Google-venster sluit meestal direct).
- **Ronde:** bestand ophalen → samenvoegen in de lokale database (§5) → resultaat terugschrijven als er iets is veranderd. Heeft een ander toestel intussen geschreven (`version` van het bestand veranderd), dan begint de ronde opnieuw (max. 3 keer).
- **Wanneer:** bij openen, bij terugkeren naar de app, bij weer online komen, en 3 s na elke lokale wijziging.
- **Niet gesynchroniseerd:** instellingen (taal, weergave, straal) horen bij het toestel.
- **Configuratie:** OAuth-client-ID (type webapplicatie) via `VITE_GOOGLE_CLIENT_ID`; bij GitHub Pages als repository-variabele `GOOGLE_CLIENT_ID`. Zonder ID toont de app dat Google Drive niet is ingesteld.

---

## 6. Offline-gedrag

- **App-shell** (HTML/JS/CSS/iconen/vertalingen) wordt geprecachet, zodat de app volledig opent zonder internet.
- **Notities maken, lezen, zoeken en exporteren** werkt volledig offline.
- **Kaarttegels:** Workbox-runtimecache (`CacheFirst`, max. ~3000 tegels, 60 dagen). Gebieden die je eerder online hebt bekeken, zijn daarna dus offline beschikbaar.
  - Tip in de app: "Bekijk het gebied vooraf online op de zoomniveaus die je nodig hebt."
  - **Niet** in bulk tegels downloaden van `tile.openstreetmap.org`; dat verbiedt het gebruiksbeleid van OSM. Echte offline-kaartpakketten vragen een andere tegelbron en zijn een kandidaat voor later (§9).
- **Adres zoeken** is offline uitgeschakeld, met de melding "Alleen beschikbaar met internet".
- Een kleine indicator in de kopbalk laat zien wanneer de app offline is.

---

## 7. Projectstructuur

```
/
├─ index.html
├─ vite.config.ts            # incl. vite-plugin-pwa config + manifest
├─ public/icons/             # 192, 512, maskable, apple-touch-icon
├─ src/
│  ├─ main.tsx
│  ├─ router.ts
│  ├─ db/
│  │  ├─ db.ts               # Dexie schema
│  │  ├─ notes.ts            # CRUD + zoeken/filteren
│  │  ├─ tags.ts
│  │  └─ settings.ts
│  ├─ backup/
│  │  ├─ export.ts
│  │  ├─ import.ts           # validatie, merge/replace, migraties
│  │  └─ schema.ts
│  ├─ analysis/
│  │  └─ bestTime.ts         # nabije notities + gemiddelden per tijdvak/dag/maand
│  ├─ geo/
│  │  ├─ distance.ts         # haversine
│  │  ├─ gps.ts
│  │  ├─ geocode.ts          # Nominatim zoeken + reverse geocoding, met rate limit
│  │  └─ suggestTitle.ts     # titelvoorstel: eerst nabije notitie, dan reverse geocoding
│  ├─ i18n/
│  │  ├─ index.ts
│  │  ├─ nl.json
│  │  └─ en.json
│  ├─ components/            # MapView, StarRating, TagPicker, NoteCard, BottomNav, …
│  └─ screens/
│     ├─ SearchScreen.tsx
│     ├─ EditScreen.tsx
│     ├─ ReadScreen.tsx
│     └─ SettingsScreen.tsx
└─ tests/                    # Vitest
```

---

## 8. Bouwvolgorde (mijlpalen)

1. **Basis:** Vite + TS + Preact, routing, de vier lege schermen, bottom-nav, i18n met NL/EN.
2. **Data:** Dexie-schema, CRUD voor notities en tags, plus tests.
3. **Invoerscherm:** GPS, kiezen op de kaart, datum/tijd, titelvoorstel op basis van de locatie, tekstveld met opmaak (Tiptap), tag, sterren, concept-autosave.
4. **Leesscherm:** detailweergave, bewerken en verwijderen, "nieuwe notitie op deze plek".
5. **Zoekscherm:** kaart met markers en clustering, tekstzoeken, filters, lijst, lang drukken voor een nieuwe notitie.
6. **Instellingen:** tagbeheer, taal, straal.
7. **Export/import:** inclusief validatie, merge/replace en tests (round-trip: export → wissen → import levert identieke data op).
8. **"Beste moment"-analyse** op het leesscherm.
9. **PWA/offline:** manifest, service worker, tegelcache, offline-indicator, `storage.persist()`, back-upherinnering, installatiehulp.
10. **Deploy** naar GitHub Pages en testen op een echte Android- en iPhone-telefoon en een Windows-laptop.

**Klaar wanneer:** op beide telefoons geïnstalleerd vanaf het startscherm; in vliegtuigmodus een notitie met GPS-locatie maken, terugvinden via zoeken, exporteren, en dat bestand op het andere toestel importeren, zonder dataverlies. Daarnaast op de Windows-laptop geïnstalleerd via Chrome of Edge; daar een notitie maken via *Kies op kaart*, die exporteren en op een telefoon importeren (en andersom), zonder dataverlies.

---

## 9. Later (buiten v1, maar ontwerp houdt er rekening mee)

- **Foto's:** een aparte Dexie-tabel `attachments` (`id, noteId, blob, mimeType, createdAt`) en `Note.attachmentIds`. De export wordt dan een **ZIP** (`data.json` + `attachments/…`) met `schemaVersion: 2`; de import blijft v1-JSON ondersteunen. Afbeeldingen bij opslaan verkleinen (bijv. max. 1600 px, JPEG 80%).
- **Meerdere tags per notitie:** `tagId` wordt `tagIds: string[]`, met een migratie in Dexie-versie 2.
- **Echte offline-kaartpakketten** (gebied downloaden), via een tegelbron die dat toestaat, of vectortegels (PMTiles).
- **Export naar GPX/CSV** voor gebruik in andere apps.
- **Ontwikkeling van de beoordeling in de tijd** als grafiek per plek.

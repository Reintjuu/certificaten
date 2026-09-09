# Queeste naar de Certificaten

Persoonlijk (niet-werkgerelateerd) Vite/TypeScript canvas-platformer in NES Super Mario Bros.-stijl, met een eigen satirische verhaallijn over bureaucratie en certificaten.

## Draaien

```
npm install
npm run dev      # spel op /
npm test         # unit tests
npm run lint     # prettier + eslint
npm run format   # prettier --write
```

Besturing: pijltjes/A-D bewegen, **Shift rennen**, spatie/W springen (kort tikken = lage hop, ingedrukt houden = volle sprong), **pijl omlaag/S bukken** (alleen groot), R reset het huidige level.

## Physics

De bewegingsregels komen uit de Super Mario Bros.-disassembly (`smbdis.asm`), niet uit een gevoelsmatige benadering. `src/physics.ts` zet de ruwe ROM-waarden er als hexgetal bij, zodat ze na te trekken zijn:

|                                | ROM                   | omgerekend                  |
| ------------------------------ | --------------------- | --------------------------- |
| Max. loop-/rensnelheid         | `$18` / `$28`         | 1,5 / 2,5 px per frame      |
| Versnelling lopen / rennen     | `$98` / `$e4`         | 0,037 / 0,056 px per frame² |
| Omdraaien (skid)               | adder ×2              | remt dubbel zo hard         |
| Ren-timer na loslaten B        | `$0a`                 | 10 frames                   |
| Sprongsnelheid (5 rijen)       | `$fc…$fb`             | −4 tot −5 px per frame      |
| Zwaartekracht stijgen / vallen | `$20…$28` / `$60…$90` | 0,117–0,156 / 0,375–0,563   |
| Max. valsnelheid               | `$04`                 | 4 px per frame              |
| Terugstuiter na pletten        | `$fd`                 | −3 px per frame             |

De levels zijn 1440px breed en de camera scrollt mee zoals in SMB1: hij volgt je zodra je voorbij het midden komt en gaat **nooit terug**, waardoor de linkerrand van het beeld een muur is. Vijanden hebben echte physics — ze vallen, en ze draaien _niet_ om bij een rand maar lopen eraf, precies zoals SMB1's normale vijanden; ze blijven slapen tot de camera ze in beeld brengt, zoals het origineel ze uit de leveldata spawnt.

Twee timers, allebei uit de ROM: de **framerule** (`IntervalTimerControl`, 21 frames) laat de interval-timers tikken — bij ons het platgedrukte-vijand-timertje — en de **leveltimer** is een aparte frame-timer die elke 24 frames één eenheid aftelt, dus 400 eenheden duren 160 seconden. Op nul ga je dood.

Je begint klein. Een paddenstoel maakt je groot (`BoundBoxCtrlData`: 24px hoog in plaats van 12), en alleen als grote Mario kun je bukken — dan krimpt je hitbox weer naar de kleine. Een klap kost een grote speler zijn formaat in plaats van zijn leven, met `$08` framerules onkwetsbaarheid erna (`ForceInjury`); klein zijn en geraakt worden is wél fataal. Paddenstoelen bewegen als vijanden: ze lopen, vallen en rollen van randen af.

Twee details die vaak verkeerd worden nagemaakt: SMB1 varieert de spronghoogte door bij het loslaten van de knop naar de _zware valzwaartekracht_ om te schakelen (niet door de opwaartse snelheid af te kappen), en de sprongboog wordt gekozen uit een tabel van vijf rijen op basis van je snelheid bij het afzetten — hard rennen springt hoger én strakker.

**Coyote time zit er bewust niet in.** Het origineel heeft het niet: springen vereist `Player_State == 0`. Dat toevoegen zou de besturing moderner maken, maar aantoonbaar on-NES.

## Structuur

| Map                             | Wat                                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/physics.ts`                | De regels van de wereld per frame: versnellen, springen, vallen, landen, vijanden. Losse, pure functies die elk apart getest worden.                                                                                        |
| `src/engine.ts`                 | De state machine eromheen (`step(state, input, levels)`): welk scherm, welk level, wanneer de physics-regels gelden. Levels worden meegegeven, niet geïmporteerd, zodat tests synthetische levels kunnen gebruiken.         |
| `src/levels.ts`                 | Leveldata. Platforms krijgen een naam; vijanden en het certificaat worden _op_ een platform geplaatst (`enemyOn`, `certificateOn`, `startOn`), dus een platform verplaatsen verplaatst alles wat erop staat mee.            |
| `src/level-builders.ts`         | Die plaatsingshelpers plus de maten van speler/vijand/certificaat, die de engine ook gebruikt.                                                                                                                              |
| `src/render.ts`                 | Gedeelde tekencode (scène, sprites, kleuren), gebruikt door zowel het spel als de replay-viewer.                                                                                                                            |
| `src/sprites.ts`, `src/font.ts` | Origineel handgetekende pixel-art en het bitmap-font.                                                                                                                                                                       |
| `src/main.ts`                   | Dunne browser-shell: toetsen → `Input`, loop, schermen. Geen physics.                                                                                                                                                       |
| `agent/`                        | Losstaande test-/AI-tooling; importeert alleen de engine + levels, nooit `main.ts`.                                                                                                                                         |
| `test/`                         | Unit tests (Node's ingebouwde test runner, geen extra framework), inclusief controles op leveldata en pixel-art: niets zweeft, vijanden lopen niet van hun platform, sprites zijn rechthoekig en even groot als hun hitbox. |

## Agent-tooling

```
npm run validate-levels   # snelle scripted smoke test
npm run train-agent       # neuro-evolutie, schrijft agent/training-history.json
```

Beide zijn ook zonder terminal te doen: open `/agent/replay.html` — de **AI-console**. Een NES-menu met pijltjes en Enter (of gewoon klikken):

- **Bekijk beste run** — de beste generatie speelt het level uit;
- **Alle generaties** — alle 60 lopen naast elkaar als gekleurde ghosts (blauw = vroegste, geel = laatste) met hun afgelegde pad, zodat je in één beeld ziet hoe het leren verliep;
- **Train opnieuw** — draait de hele evolutie in de browser, één generatie per frame zodat de pagina niet bevriest, met een live grafiek;
- **Download data** — het resultaat als JSON, om in de repo te committen;
- **Speel zelf** — terug naar het spel.

Escape brengt je altijd terug naar het menu.

De opgeslagen gewichten _zijn_ de opname — de engine is deterministisch, dus een genome speelt altijd exact dezelfde run.

Trainen gebeurt volledig headless en zo snel als de CPU kan, niet op speelsnelheid: de laatste run simuleerde 3,45 miljoen frames (≈16 uur speeltijd op 60fps) in 4,7 seconden, ruwweg 12.000× realtime. De trainer print die cijfers zelf aan het eind.

`validate-levels` is een snelle kanarie: hij simuleert per beurt zijn mogelijke sprongen tegen de echte engine en kiest de beste, in plaats van sprongafstanden uit vaste constanten te gokken. Daardoor blijft hij kloppen als de physics veranderen — de vorige, handmatig afgestelde versie werd waardeloos zodra de getallen verschoven. Draait in een halve seconde. De uitgebreidere controle is de getrainde agent (`npm test` speelt de opgeslagen beste genome per level opnieuw af en eist dat die het certificaat haalt).

## Een level of sprite aanpassen

Een level toevoegen: geef de platforms een naam en plaats de rest erop.

```ts
const four = { ground: platform(0, 240, 480, 30), ledge: platform(120, 180, 80) }

{
  platforms: Object.values(four),
  enemies: [enemyOn(four.ledge, { from: 10, to: 50, speed: 0.8 })],
  certificate: certificateOn(four.ledge, 30),
  playerStart: startOn(four.ground, 20),
  intro: ["..."], outro: ["..."],
}
```

Sprites zijn tekst: elke regel is een rij pixels, een spatie is doorzichtig, elke letter is een kleur uit `PALETTE` in `src/sprite-frames.ts`. Gewoon de letters aanpassen. `npm test` controleert daarna of het frame rechthoekig is, of alle letters bestaan, en of het even groot is als de hitbox.

Na het aanpassen van levelgeometrie: `npm run train-agent` opnieuw draaien, anders faalt de test die controleert of de opgeslagen AI-runs het level nog uitspelen.

## Hosten (GitHub Pages)

```
BASE_PATH=/<repo-naam>/ npm run build
```

Beide pagina's zitten in de build (`vite.config.ts` noemt ze allebei als entry; zonder dat was de replay-viewer een dev-only pagina die stilzwijgend ontbrak in `dist/`). `base` moet gezet worden omdat een project-site vanaf `/<repo>/` wordt geserveerd.

De trainingsdata is een gewone `import` van `agent/training-history.json`, dus Vite bakt hem bij het bouwen in de bundle — geen fetch, geen los asset-bestand, werkt op elke statische host (~20 kB gzipped). Wat _niet_ kan op Pages: wegschrijven. `npm run train-agent` schrijft het bestand lokaal en je commit het; een trainer in de browser kan zijn resultaat alleen in het geheugen houden, in `localStorage` zetten of als download aanbieden.

## Attributie

Het bitmap-font is afgeleid van de "Super Mario Bros. NES Font"-recreatie door Patrick Adams ([TheWolfBunny64](https://thewolfbunny64.itch.io/super-mario-bros-nes)), gebruikt met toestemming van de maker. Elk teken is eenmalig gerenderd en omgezet naar harde pixels (`src/font-glyphs.ts`); er zit geen los font-bestand in de app. De sprites zijn origineel handgetekend, geen Nintendo-assets.

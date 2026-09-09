# Queeste naar de Certificaten

Persoonlijk (niet-werkgerelateerd) Vite/TypeScript canvas-platformer in NES Super Mario Bros.-stijl, met een eigen satirische verhaallijn over bureaucratie en certificaten.

## Draaien

```
npm install
npm run dev      # spel op /
npm test         # unit tests
```

Besturing: pijltjes/A-D bewegen, spatie/W springen (kort tikken = lage hop, ingedrukt houden = volle sprong), R reset het huidige level.

## Structuur

| Map | Wat |
| --- | --- |
| `src/engine.ts` | Pure, DOM-vrije physics/collision/state-machine (`step(state, input, levels)`). Bevat geen rendering en geen invoerafhandeling. De levels worden meegegeven, niet geïmporteerd, zodat tests met synthetische levels kunnen werken. |
| `src/levels.ts` | Leveldata: platforms, vijanden, certificaat, intro/outro-dialoog. Nieuw level = object aan `LEVELS` toevoegen. |
| `src/render.ts` | Gedeelde tekencode (scène, sprites, kleuren), gebruikt door zowel het spel als de replay-viewer. |
| `src/sprites.ts`, `src/font.ts` | Origineel handgetekende pixel-art en het bitmap-font. |
| `src/main.ts` | Dunne browser-shell: toetsen → `Input`, loop, schermen. Geen physics. |
| `agent/` | Losstaande test-/AI-tooling; importeert alleen de engine + levels, nooit `main.ts`. |
| `test/` | Unit tests (Node's ingebouwde test runner, geen extra framework). |

## Agent-tooling

```
npm run validate-levels   # snelle scripted smoke test
npm run train-agent       # neuro-evolutie, schrijft agent/training-history.json
```

Daarna `/agent/replay.html` openen (via `npm run dev`): daar zie je de fitness per generatie, welke generatie de beste was (★), en kun je elke generatie apart terugkijken. De opgeslagen gewichten *zijn* de opname — de engine is deterministisch, dus een genome speelt altijd exact dezelfde run.

`validate-levels` is bewust een simpele scripted bot: een snelle kanarie, geen goede speler. Hij haalt level 1 en 2, maar struikelt over de langere klim in level 3 — dat is een beperking van zijn eigen regels, niet van het level. De echte controle of elk level haalbaar is, is de getrainde agent (`npm test` speelt de opgeslagen beste genome per level opnieuw af en eist dat die het certificaat haalt).

## Attributie

Het bitmap-font is afgeleid van de "Super Mario Bros. NES Font"-recreatie door Patrick Adams ([TheWolfBunny64](https://thewolfbunny64.itch.io/super-mario-bros-nes)), gebruikt met toestemming van de maker. Elk teken is eenmalig gerenderd en omgezet naar harde pixels (`src/font-glyphs.ts`); er zit geen los font-bestand in de app. De sprites zijn origineel handgetekend, geen Nintendo-assets.

# Queeste naar de Certificaten

Persoonlijk (niet-werkgerelateerd) Vite/TypeScript canvas-platformer in NES Super Mario Bros.-stijl, met een eigen satirische verhaallijn over bureaucratie en certificaten.

## Draaien

```
npm install
npm run dev
```

Besturing: pijltjes/A-D bewegen, spatie/W springen (kort tikken = lage hop, ingedrukt houden = volle sprong), R reset het huidige level.

## Structuur

- `src/engine.ts` — pure, DOM-vrije physics/collision/state-machine (`step(state, input)`), herbruikt door zowel de browser-game als de headless agent-tooling.
- `src/levels.ts` — leveldata (platforms, vijanden, certificaat, intro/outro-dialoog). Nieuw level toevoegen = object aan `LEVELS` toevoegen.
- `src/sprites.ts` / `src/sprite-frames.ts` — origineel handgetekende pixel-art (personage, vijand), geen Nintendo-assets.
- `src/font.ts` / `src/font-glyphs.ts` — eigen bitmap-font (harde pixels, geen anti-aliasing).
- `src/main.ts` — dunne browser-shell (input, canvas, rendering).
- `agent/` — losstaande test-/AI-tooling, importeert alleen `src/engine.ts` + `src/levels.ts`:
  - `npm run validate-levels` — snelle heuristische regressietest per level.
  - `npm run train-agent` — neuro-evolutie (klein hand-geschreven neuraal netwerkje + genetisch algoritme, geen ML-library) die leert spelen; schrijft `agent/best-run.json`.
  - `/agent/replay.html` (via `npm run dev`) — speelt een opgeslagen run visueel af.

## Attributie

Het bitmap-font is afgeleid van de "Super Mario Bros. NES Font"-recreatie door Patrick Adams ([TheWolfBunny64](https://thewolfbunny64.itch.io/super-mario-bros-nes)), gebruikt met toestemming van de maker. Elk teken is eenmalig gerenderd en omgezet naar harde pixels (`src/font-glyphs.ts`); er zit geen los font-bestand in de app.

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

Besturing: pijltjes/A-D bewegen, **Shift rennen**, spatie/W springen (kort tikken = lage hop, ingedrukt houden = volle sprong), **pijl omlaag/S bukken** (alleen groot), R reset het huidige level, F toont de framerate, M zet het geluid uit.

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
| Terugstuiter na pletten        | `$fc`                 | −4 px per frame             |
| Geschopt schild                | `$30`                 | 3 px per frame              |
| Blok stuitert weg              | `$fe`, `$10`          | 2 px per frame, 16 frames   |
| Schild komt weer bij           | `$10`                 | 16 framerules               |

De levels zijn 1440px breed en de camera scrollt mee zoals in SMB1: hij volgt je zodra je voorbij het midden komt en gaat **nooit terug**, waardoor de linkerrand van het beeld een muur is. Vijanden hebben echte physics: ze vallen, en ze draaien _niet_ om bij een rand maar lopen eraf, precies zoals SMB1's normale vijanden; ze blijven slapen tot de camera ze in beeld brengt, zoals het origineel ze uit de leveldata spawnt.

Twee timers, allebei uit de ROM: de **framerule** (`IntervalTimerControl`, 21 frames) laat de interval-timers tikken (bij ons het platgedrukte-vijand-timertje) en de **leveltimer** is een aparte frame-timer die elke 24 frames één eenheid aftelt, dus 400 eenheden duren 160 seconden. Op nul ga je dood.

Je begint klein. Een paddenstoel maakt je groot (`BoundBoxCtrlData`: 24px hoog in plaats van 12), en alleen als grote Mario kun je bukken, waarbij je hitbox weer naar de kleine krimpt. Een klap kost een grote speler zijn formaat in plaats van zijn leven, met `$08` framerules onkwetsbaarheid erna (`ForceInjury`); klein zijn en geraakt worden is wél fataal. Paddenstoelen bewegen als vijanden: ze lopen, vallen en rollen van randen af.

Er lopen twee soorten vijanden rond. Een goomba wordt plat en verdwijnt. Een koopa kruipt in zijn schild: dat schild blijft liggen, en loop je ertegenaan dan schopt je het weg met `$30` (3 px per frame, zes keer een looppas, uit `KickedShellXSpdData`), waarna het alles omver maait wat het onderweg tegenkomt. Een stilliggend schild telt `RevivalRateData` af (`$10` framerules) en dan staat de koopa weer op zijn poten. Erop springen zet een glijdend schild weer stil, en dat is hoe je een schild tegen de rest van de rij aan gebruikt zonder er zelf onder te komen.

Aan blokken kom je van onderaf. `PlayerHeadCollision` zet je verticale snelheid op nul zodra je er met je hoofd tegenaan komt, dus je stopt dood tegen de onderkant; het blok zelf schiet met `$fe` omhoog en is na `BlockBounceTimer` ($10 frames) terug op zijn plek. Wat erin zit komt eruit: een stempel wordt meteen bijgeschreven (`GiveOneCoin` doet dat op het moment van tevoorschijn komen, dus het ding dat omhoog vliegt is louter vertoon) en een paddenstoel komt bovenop het blok te staan. Een gewone baksteen zonder inhoud breekt als je groot bent en rammelt alleen als je klein bent; `BrickShatter` laat je daarbij op `$fe` doorstijgen in plaats van je stil te zetten.

Een leeg blok is daarna alleen nog muur. `CheckForSolidMTiles` rekent de opgebruikte tegel (`$c4`) tot de gewoon-vaste tegels, dus de hoofdbotsing komt niet eens meer bij `PlayerHeadCollision` uit: je hoort de bonk, `NYSpd` zet je snelheid op `$01` zodat je weer daalt, en het blok verroert zich niet en geeft niets nog een keer.

En een blok is aan alle kanten vast, niet alleen boven en onder: `BlockBufferColli_Side` doet er een aparte zijcontrole op en `ImpedePlayerMove` zet je horizontale snelheid op nul. Zonder dat kon je er dwars doorheen lopen, wat je zag zodra een agent er eentje raakte. Alleen de ondiepste overlap wordt opgelost, dus erop landen blijft landen en je hoofd stoten blijft stoten.

Twee details die vaak verkeerd worden nagemaakt: SMB1 varieert de spronghoogte door bij het loslaten van de knop naar de _zware valzwaartekracht_ om te schakelen (niet door de opwaartse snelheid af te kappen), en de sprongboog wordt gekozen uit een tabel van vijf rijen op basis van je snelheid bij het afzetten: hard rennen springt hoger én strakker.

**Twee bewuste afwijkingen van de ROM, allebei omdat het scherm anders liegt.** Een geplet schild valt hier. In de ROM doet het dat niet: `ReviveStunned` slaat `MoveD_EnemyVertically` over, dus een koopa die je boven een gat plet blijft in de lucht hangen tot hij weer opstaat. Dat leest voor iedereen die het ziet als een bug. En de onkwetsbaarheidsflits is een doorzichtige Mario in plaats van een verdwenen Mario: de ROM knippert het palet weg, maar de sprite helemaal weglaten haalt je juist op het moment dat je 'm het hardst nodig hebt van het scherm.

**Coyote time zit er bewust niet in.** Het origineel heeft het niet: springen vereist `Player_State == 0`. Dat toevoegen zou de besturing moderner maken, maar aantoonbaar on-NES.

## Geluid

De NES had twee pulse-kanalen, een triangle en een ruisgenerator, en alles wat het apparaat ooit zei kwam daaruit. `src/sound.ts` bouwt diezelfde vier stemmen met WebAudio: de smalle pulse-breedtes (12,5% en 25%) bestaan niet als browser-oscillator en worden uit hun Fourierreeks opgebouwd, want juist die maken dat een pulse-kanaal klinkt als een pulse-kanaal.

**De melodieën uit de ROM zijn niet nagemaakt.** Die zijn Nintendo's compositie. Wat geleend is, is de machine: dezelfde vier stemmen, dezelfde harde envelopes, hetzelfde gebrek aan alles daartussen. De effecten zijn voor dit spel geschreven, net zoals de pixel-art voor dit spel getekend is.

Wélke gebeurtenis er klinkt is aparte, pure logica in `src/sound-events.ts`: die vergelijkt twee frames spelstaat en zegt wat er gebeurde. De engine blijft dus zelf niets van geluid weten. Dat is ook wat het testbaar maakt, want een WebAudio-context maakt herrie en geen assertions; springen tegen van een richel vallen uit elkaar houden is wél te testen, en dat gebeurt.

De context wordt pas bij de eerste toetsaanslag aangemaakt, omdat browsers weigeren geluid te starten voordat er interactie is geweest. **M** zet alles uit.

## Structuur

| Map                             | Wat                                                                                                                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/physics.ts`                | De regels van de wereld per frame: versnellen, springen, vallen, landen, vijanden. Losse, pure functies die elk apart getest worden.                                                                                                                                          |
| `src/engine.ts`                 | De state machine eromheen (`step(state, input, levels)`): welk scherm, welk level, wanneer de physics-regels gelden. Levels worden meegegeven, niet geïmporteerd, zodat tests synthetische levels kunnen gebruiken.                                                           |
| `src/levels.ts`                 | Leveldata. Platforms krijgen een naam; vijanden en het certificaat worden _op_ een platform geplaatst (`enemyOn`, `certificateOn`, `startOn`), dus een platform verplaatsen verplaatst alles wat erop staat mee. Blokkenrijen staan als plaatje: `blockRow(600, 160, "b?b")`. |
| `src/level-builders.ts`         | Die plaatsingshelpers plus de maten van speler/vijand/certificaat, die de engine ook gebruikt.                                                                                                                                                                                |
| `src/render.ts`                 | Gedeelde tekencode (scène, sprites, kleuren), gebruikt door zowel het spel als de AI-console.                                                                                                                                                                                 |
| `src/sprites.ts`, `src/font.ts` | Origineel handgetekende pixel-art en het bitmap-font.                                                                                                                                                                                                                         |
| `src/main.ts`                   | Dunne browser-shell: toetsen → `Input`, loop, schermen. Geen physics.                                                                                                                                                                                                         |
| `src/agent/`                    | De test- en AI-tooling. Eigen map met een eigen richting: hij importeert de engine, de levels en de renderer, maar niets in `src/` importeert ooit iets uit `src/agent/`, behalve de lazy import van de console.                                                              |
| `visual/`                       | De visuele regressietests: `scenes.ts` tekent elke scene met de echte renderer uit een toestand die de echte engine heeft geproduceerd, `scenes.spec.ts` schiet er een plaatje van. Niet onderdeel van de gebouwde site.                                                      |
| `test/`                         | Unit tests (Node's ingebouwde test runner, geen extra framework), inclusief controles op leveldata en pixel-art: niets zweeft, vijanden lopen niet van hun platform, sprites zijn rechthoekig en even groot als hun hitbox.                                                   |

Binnen `src/agent/` heeft elk bestand één taak: `run.ts` bepaalt wanneer een run stopt en wat hij opleverde, `policy.ts` is het netwerk, `evolution.ts`, `reinforce.ts`, `clone.ts`, `cmaes.ts`, `map-elites.ts`, `dqn.ts` en `neat.ts` zijn de leermethodes met `methods.ts` als de lijst ervan, `moves.ts` en `search.ts` zoeken in plaats van leren, `chart.ts` tekent de leercurve, en elk scherm heeft zijn eigen view: `training-view.ts`, `replay-view.ts`, `network-view.ts`, `neat-view.ts`, `weights-view.ts` en `archive-view.ts`. Die tekenen en geven de regel tekst terug die eronder hoort, in plaats van zelf in de pagina te schrijven. `console-chrome.ts` bouwt de pagina eromheen en kent geen genome, `weight-editing.ts` houdt bij welk gewicht je hebt aangeklikt en wat je ermee deed, en `console.ts` kiest alleen nog wat je bekijkt.

Er is één entry point: `index.html`. Het titelscherm heeft twee regels, **speel** en **AI console**, en die tweede doet een dynamische import. Daardoor kost de AI-kant niets zolang je hem niet opent: het spel is 39 kB (10 kB gzipped), de console met alle trainingsdata erin 331 kB (21 kB gzipped) en die wordt pas opgehaald als je hem kiest.

## Agent-tooling

```
npm run validate-levels   # snelle scripted smoke test
npm run train-agent       # neuro-evolutie, schrijft src/agent/training-history.json
```

Beide zijn ook zonder terminal te doen: kies **AI console** op het titelscherm. Een NES-menu met pijltjes en Enter (of gewoon klikken):

- **Bekijk beste run**: de beste generatie speelt het level uit;
- **Alle generaties**: alle 100 lopen naast elkaar als gekleurde ghosts (blauw = vroegste, geel = laatste) met hun afgelegde pad, zodat je in één beeld ziet hoe het leren verliep;
- **Train opnieuw**: draait de evolutie in de browser en laat het hele level in overzicht zien met de sprongbogen van elke kandidaat erover, zodat je de zoektocht ziet verlopen. Onder het spel kies je de verborgen lagen en de leermethode;
- **Download data**: het resultaat als JSON, om in de repo te committen;
- **Speel zelf**: terug naar het spel.

Escape gaat steeds één stap terug: van een scherm naar het menu, van het menu naar het spel.

### Wat de agent ziet en waarop hij scoort

De policy is een klein feed-forward netwerkje (12 inputs, 8 verborgen neuronen, 3 outputs: links/rechts, springen, rennen) zonder ML-library. Naast de richting van het certificaat, zijn eigen snelheid en de dichtstbijzijnde vijand krijgt hij **drie terreinvoelers**: op 20, 48 en 80px vóór zich meet hij de hoogte van de grond ten opzichte van zijn voeten, waarbij −1 "hier is helemaal geen grond" betekent. Zonder die voelers is hij blind voor de vorm van het level en haalde hij het certificaat alleen per ongeluk: met dezelfde seed gingen level 1 en 3 van nul oplossingen naar respectievelijk 6 en 41 van de 80.

Scoren gebeurt op tijd, niet op overleven:

```
opgelost     -> 2000 + (framebudget − gebruikte frames)   # sneller is strikt beter
niet gehaald -> −afstand tot het certificaat              # hoe dichtbij kwam hij
```

De solve-bonus hoeft niet groter. Halen is al een eigen klasse (minimaal 2000 tegenover hoogstens 0 voor een misser), en de selectie bestaat uitsluitend uit vergelijkingen: toernooiselectie, sorteren voor de elites en een `Math.max`. Een groter getal zou niets herordenen.

Wat wél uitmaakte is hoe die afstand gemeten wordt. In pure pixels overheerst de horizontale term, want een level is 1440 breed en 270 hoog. Op level 1 staat het certificaat 95px boven de grond terwijl een perfecte rensprong 80px tilt, dus de enige route is een tweetrapsklim; van de 1200 punten die er te verdienen waren leverde rechts vasthouden er 1105 op en de klim 95. De agent leerde precies waar hij voor betaald werd: sprinten, eronderdoor lopen en tegen de muur op x 1424 stilvallen, waar 43 van de 100 beste genomen eindigden. De verticale term wordt nu geschaald met de breedte van het level gedeeld door de hoogte, wat neerkomt op beide assen normaliseren naar de ruimte die er op die as is. Op dezelfde seed ging level 1 van 6 oplossers per generatie naar 30 en level 2 van 15 naar 22, terwijl level 3 van 41 naar 29 zakte omdat diezelfde trek omhoog hem tussen de pilaren soms laat vallen. Die cijfers zijn gemeten vóór de correctie van de terugstuiter naar `$fc`; met de huidige physics staan ze op 12, 12 en 25, en de beste agent zit nog steeds op de ondergrens.

De vorige versie gaf een bonus per overleefd frame. Onder die regel scoorde een agent die tien seconden ronddobberde en dan binnenkwam _hoger_ dan eentje die er meteen heen liep, en dat is precies wat hij deed. Nu leggen de beste agents de levels af in 504, 542 en 570 frames, oftewel rond de negen seconden speeltijd, en houden ze de rentoets vrijwel de hele run ingedrukt (top speed 2,5 px per frame, de volle `$28` uit de ROM). Dat is ook zo snel als het kán: een pure sprint over een vlakke baan zonder vijanden of klimwerk kost 502, 540 en 568 frames, dus ze zitten er twee frames boven.

Een run stopt zodra hij **180 frames lang niet dichter bij het certificaat is gekomen**. De leveltimer zou in theorie ook kunnen aflopen, maar 400 eenheden is 9600 frames: veel te laat om nog iets te betekenen. Die stilstandsdetectie is ook wat het trainen sneller maakt, want hij snijdt de doelloze runs meteen af.

Het genetisch algoritme draait op een **vaste seed** (mulberry32 in `src/agent/random.ts`), dus `npm run train-agent` levert twee keer exact dezelfde agent op. Het doet per level drie herstarts met opeenvolgende seeds en houdt de beste, want evolutie loopt vast en of ze vastloopt hangt van de seed af: op de ene seed kwam level 2 op 616 frames uit waar een andere 542 vond. Drie herstarts kosten twee en een halve minuut en halen dat toeval uit wat er gecommit wordt. Daarvoor was het gokwerk: dezelfde opdracht gaf de ene keer zes oplossers op level 1 en de volgende keer nul, en wat er in de repo belandde was toevallig de laatste run.

De opgeslagen gewichten _zijn_ de opname: de engine is deterministisch, dus een genome speelt altijd exact dezelfde run. Ze staan op vier decimalen, wat een tanh-netwerk niet merkt en het bestand van 390 kB naar ongeveer 320 kB brengt (17 kB gzipped) terwijl er nu 100 in plaats van 60 generaties in zitten.

Trainen gebeurt volledig headless en zo snel als de CPU kan, niet op speelsnelheid: de laatste run simuleerde 10,5 miljoen frames (bijna 49 uur speeltijd op 60fps) in 23,5 seconden, ruwweg 7.500× realtime. De trainer print die cijfers zelf aan het eind.

In de browser scoort de trainer **één kandidaat per keer** in plaats van een hele generatie, met een budget van 10ms per frame. Een generatie is 80 runs en kost een paar honderd milliseconden; die tussen twee paints proppen liet de pagina bevriezen en de generatieteller stilstaan. Nu loopt er een voortgangsbalk binnen de generatie mee.

### Zeven manieren van leren, en wat ze van elkaar verraden

Er zit ook **behaviour cloning** in (`src/agent/clone.ts`), en dat is het controle-experiment voor de hele AI-kant. Neem de beste agent die er is, schrijf op wat hij in elke toestand deed, en leer een vers netwerk dat na te doen met gewone supervised gradiëntafdaling. De leraar is een netwerk van precies dezelfde vorm, dus de leerling kán hem in principe exact evenaren.

Alleen de eigen run van de leraar naschrijven bleek niet genoeg. De lessen dekken dan uitsluitend de toestanden waar de leraar is geweest, en zodra de leerling een pixel afwijkt krijgt hij vragen over plekken waar niemand hem iets over verteld heeft. Dat is de klassieke zwakte van klonen, en de klassieke oplossing staat er nu in: na elke generatie wordt de run van de _leerling_ nagelopen en bij elk frame aan de leraar gevraagd wat hij daar gedaan zou hebben. Die correcties gaan bij de lessen, met de laatste vijf runs in beeld. Dat heet DAgger.

Daarmee haalt de leerling op alle drie de levels **exact de score van zijn leraar** (3296, 3258, 3230). Zonder die correcties bleef level 1 op 16 frames achterstand steken en kwamen 2 en 3 er niet eens in de buurt: op level 2 liep de leerling tot 43px van het certificaat en viel daar stil. Dat de architectuur en de features de policy gradient nooit in de weg zaten blijft daarmee staan; het zat in het leersignaal. Een test eist dat de leerling de leraar op level 1 precies evenaart en niet slechts benadert.

Een detail dat het waard is om te noemen: met 100 passes bleef de fout op 0,08 steken en speelde de leerling geen enkel level uit. Dat is geen toeval maar rekenwerk: een knop zit achter een drempel van 0,2, en een gemiddelde fout van die orde draait precies op de verkeerde momenten een druk om. Pas als de fout een orde kleiner is dan de drempel volgt de leerling het pad van de leraar.

Naast de evolutie zit er een **policy gradient** (REINFORCE) in `src/agent/reinforce.ts`: hetzelfde netwerk, dezelfde inputs, hetzelfde spel, maar in plaats van hele runs scoren en de winnaars kruisen duwt hij elk gewicht in de richting die de goede frames waarschijnlijker maakte. Kiesbaar onder de grafiek in de console.

Hij leert wel, maar hij wint niet, en de weg daarnaartoe was leerzamer dan het resultaat.

| level | hebzuchtige fitness bij de eerste update | beste over 100 updates | opgelost |
| ----- | ---------------------------------------- | ---------------------- | -------- |
| 1     | −1237                                    | **−273** (update 47)   | nooit    |
| 2     | −518                                     | **−167** (update 61)   | nooit    |
| 3     | −1488                                    | **−661** (update 16)   | nooit    |

Die getallen zijn van de kale versie van het spel, vóór de koopa's en de blokken; met de huidige levels staat REINFORCE op −393, −637 en −1161. Ze zijn ook van één seed: over drie seeds liep level 1 uiteen van −121 tot −1268, wat de spreiding is die bij REINFORCE hoort en de reden dat het de ene keer lijkt te werken en de andere keer niets lijkt te doen. Ter ijking: recht onder het certificaat staan is ongeveer −618 op level 1, en erbovenop −112, dus op zijn best staat hij er letterlijk bovenop zonder hem te pakken. Hij komt dus ruim voorbij de eerste vijand en het grootste deel van het level door, maar maakt de laatste klim niet af. De curve is grillig: hij vindt een goede policy en loopt er daarna weer vanaf, wat bij REINFORCE hoort. De opname bewaart de beste, dus "bekijk beste run" laat wel zien wat hij op zijn best kon.

Belangrijk bij het lezen van die grafiek: een generatie wordt gescoord met de policy **zonder** verkenningsruis, want dat is de agent die het opgeslagen genome beschrijft. Dat was eerst niet zo, en dat maakte het beeld onwaar: de grafiek meldde een opgelost level zodra de ruis een keer geluk had, terwijl de agent zelf nog tegen dezelfde vijand aanliep. Een test eist nu van beide leermethodes dat een opgeslagen genome zijn eigen opgeslagen fitness reproduceert.

Eerst leerde hij helemaal niets: level 1 bleef honderd updates lang op −1182 staan, wat neerkomt op doodgaan bij de eerste vijand op x=233. Mijn eerste verklaring was dat de verkenning het level niet genoeg afzocht. Die verklaring was fout, en dat bleek uit een meting: met dezelfde ruisinstellingen komt **259 van de 400 episodes voorbij die vijand**, is de mediaan x=541 en haalt de verste x=1424. Er was volop variatie en er waren volop goede episodes; de gradiënt gebruikte ze alleen niet.

Het zat in de credit assignment. De beloning was "afstand die dit frame is goedgemaakt", en de return-to-go vanaf frame _t_ telescopeert daarmee tot "de vooruitgang die nog volgt". Die is _kleiner_ naarmate je al verder bent, en een baseline per framenummer haalt dat er niet uit. Een episode werd dus bestraft voor het al gemaakt hebben van vooruitgang. Nu krijgt elke episode één advantage, op precies de schaal waarop de evolutie ook wordt gescoord, zodat beide methodes hetzelfde optimaliseren en hun curves te vergelijken zijn. Daarbij loopt de stapgrootte af naar 15%, want met een vaste stap vond hij een goede policy en liep er daarna even hard weer vanaf.

Wat er overblijft is waarom hij het laatste stuk niet haalt, en dat is wél de trap:

| gewicht met 0,01 verschuiven | verandert de uitkomst niet |
| ---------------------------- | -------------------------- |
| willekeurig genome           | 69 tot 131 van de 131      |
| getraind genome              | **117 van de 131**         |

Ik heb geprobeerd dat laatste stuk alsnog te halen: ruis vasthouden over meerdere frames, de verkenning laten aflopen, grotere batches, meer updates (tot 400) en stapgroottes over twee ordes van grootte. Geen van alle levert een uitgespeeld level op, en de verkenning laten aflopen hielp level 1 terwijl het 2 en 3 juist schaadde, wat afstellen op ruis is. Bij een getraind genome verandert een stapje van 0,01 voor 117 van de 131 gewichten niets aan hoe de run afloopt, en bij 0,1 nog voor 111. Dat was ooit 131 van de 131: sinds er blokken in de wereld staan zijn er meer dingen om langs te schampen, dus een duwtje heeft meer manieren om de run ergens anders te laten eindigen zonder dat de agent iets anders _doet_. Een knop is namelijk een drempel: `rechts` is `output > 0,2`, dus zolang die niet wordt overschreden ziet het spel geen verschil. Voor het grove werk (naar rechts, over een vijand heen) is er genoeg spreiding tussen episodes om een richting uit te halen; voor de precieze laatste sprong is de opbrengst een trap en geen helling, en daar loopt een gradiënt vast waar evolutie gewoon de gelukkige mutatie bewaart.

Die eigenschap staat als test in `test/reinforce.test.ts`, samen met een numerieke controle van de backpropagatie tegen eindige differenties. De gradiënt is dus aantoonbaar correct; het ging mis in wat ik hem te eten gaf.

Drie fouten onderweg, alle drie in code die volkomen normaal leest. Ruis op de gewogen som in plaats van op de uitgang: zodra die som voorbij ongeveer twee komt is tanh vlak en zijn alle episodes in een batch letterlijk identiek. Een baseline per framenummer onder een return-to-go die telescopeert, waardoor vooruitgang zichzelf bestrafte. En de gesamplede beste episode opslaan naast het hebzuchtige genome, waardoor de grafiek voortgang meldde die de agent niet had.

### MAP-Elites: niet één beste, maar een archief van gedrag

De andere zes jagen op één beste agent. **MAP-Elites** (`src/agent/map-elites.ts`) vult een raster van gedragingen en bewaart per vakje de beste agent die zich zó gedroeg. De assen zijn hoe ver hij kwam en hoe hoog hij ooit klom, precies de twee dingen die de pogingen op het scherm van elkaar onderscheiden. Een vakje gaat alleen vooruit, nooit achteruit, dus een vreemde eend die hoog kwam maar slecht scoorde wordt niet weggefokt zoals in een gewone populatie.

Met hetzelfde evaluatiebudget als de GA speelt hij alle drie de levels uit (3296, 3258, 3214 tegen 3296, 3258, 3230) en levert er 70, 79 en 55 gevulde gedragsvakjes bij. Kies **archief** in het menu om het raster te zien: kleur is kwaliteit, geel omrand betekent dat die agent het certificaat haalt, en klikken speelt hem af.

Eén meetles die het vermelden waard is. Met een kwart van het budget haalde hij geen enkel level en kwam level 1 op −39; met een gelijk budget haalt hij ze alle drie. De eerste meting zei dus niets over de methode en alles over wat ik hem gaf.

### CMA-ES: evolutie die leert wáár ze moet zoeken

De gewone GA muteert elk gewicht even hard in elke richting. **CMA-ES** (`src/agent/cmaes.ts`) houdt een gemiddelde bij plus een stapgrootte per gewicht, en na elke generatie schuift het gemiddelde naar de kandidaten die het goed deden terwijl de stapgrootte meegroeit langs de assen waarin die kandidaten daadwerkelijk van elkaar verschilden. Dit is de separabele vorm: een diagonale covariantie in plaats van een volle matrix, wat een eigendecompositie bespaart en voor 131 grotendeels onafhankelijke gewichten een prima ruil is.

Over negen volledige runs per methode (drie levels, drie seeds):

|           | opgelost | beste run  | gesimuleerde frames |
| --------- | -------- | ---------- | ------------------- |
| CMA-ES    | 8 van 9  | 504 frames | **10,1M**           |
| gewone GA | 9 van 9  | 504 frames | 27,9M               |

Eén run minder raak, dezelfde snelheid, met **een derde van het rekenwerk**. Dat is precies wat een slimmere zoeker hoort op te leveren. Wat opvalt bij het lezen van de grafiek: CMA-ES zet zijn _gemiddelde_ neer als de agent van die generatie, waar de GA de beste van tachtig neerzet. Dat eerste is een strengere uitspraak, want het gemiddelde is wat het algoritme daadwerkelijk gelooft.

### Q-learning, de eerlijke tweede kans

De policy gradient stuurt drie continue getallen door drempels, en juist daar komt de trap vandaan. **Q-learning** (`src/agent/dqn.ts`) heeft dat probleem per constructie niet: het netwerk schat wat elk van de **twaalf knopcombinaties** waard is en de agent neemt de hoogste. Elke verandering die de volgorde omgooit verandert de actie, en elke verandering die dat niet doet is ook echt zonder gevolg. Compleet met replay buffer, een bevroren kopie voor de doelwaarden en epsilon die van 1 naar 0,05 loopt.

Dat hielp, tot er koopa's en blokken bij kwamen. Op de kale versie van het spel kwam level 1 op **−104**, het beste dat een lerende methode hier haalde, en op het platform bij het certificaat staan is −112: hij stond er dus bovenop en pakte hem niet. Met de huidige levels staat hij op −790, −713 en −1193. Een schild dat weer opstaat en blokken om tegenaan te springen maken de wereld duidelijk moeilijker voor hem, en dat het cijfer zó ver terugvalt zegt vooral dat die −104 fijner afgestemd was op precies dát level dan ik dacht.

Eén getal maakte daar het meeste verschil, en het was niet de leersnelheid. Met de gebruikelijke discount van 0,99 is een beloning 400 frames verderop nog 0,018 waard: de agent kán het certificaat vanaf de start niet zien. Op 0,999 reikt de horizon over het hele level en ging het van −143 naar −104.

Twee dingen die de bruikbaarheid bepaalden. Leren op elk frame kost vijf minuten per level, wat in een browser niet kan; net als in de oorspronkelijke DQN-publicatie gebeurt het elke vierde frame, en dat scheelt een factor vier zonder kwaliteitsverlies. En een episode in één keer uitspelen blokkeerde het frame veel langer dan het budget, wat de pagina naar 34fps trok; nu gaat er hooguit 60 frames per aanroep doorheen en blijft het op 61.

De netwerkweergave past zich vanzelf aan: hij leest uit de opgeslagen architectuur of het een stuur-kop met drie uitgangen is of een waarde-kop met twaalf, labelt de uitgangen navenant en licht bij een waarde-kop de hoogste op in plaats van de drempels.

### NEAT: de vorm van het netwerk evolueert mee

Alle methodes hierboven trainen een vorm die ik heb gekozen: twaalf inputs, acht verborgen, drie outputs, 131 gewichten, en de enige vraag is wat die gewichten moeten zijn. **NEAT** (`src/agent/neat.ts`, naar [Stanley en Miikkulainen, 2002](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf)) begint met _geen_ verborgen knopen en laat mutatie er een verbinding of een knoop bij maken. De vorm is daarmee een uitkomst in plaats van een instelling.

Drie dingen maken dat het werkt, en alle drie zitten erin:

- **Innovatienummers.** Een gen krijgt een stempel op het moment dat het voor het eerst ergens opduikt. Twee genomen die allebei "input 3 naar output 1" hebben laten groeien kunnen daardoor naast elkaar gelegd en gekruist worden, ook al zijn ze er los van elkaar op gekomen.
- **Soorten.** Een verse knoop scoort bijna altijd eerst slechter voordat hij beter scoort. Genomen worden daarom gegroepeerd op gelijkenis en concurreren binnen hun groep, met de fitness gedeeld door de groepsgrootte. Zonder dat wordt elke vernieuwing weggeconcurreerd in de generatie waarin ze verschijnt en komt de topologie nooit ergens.
- **Minimaal beginnen.** Er komt niets bij dat zichzelf niet heeft terugverdiend, en dat is waarom het eindigt met een klein netwerk in plaats van een gesnoeid groot netwerk.

Een knoop toevoegen gebeurt door een verbinding doormidden te knippen: het oude gen wordt uitgezet, de eerste helft krijgt gewicht 1 en de tweede het oude gewicht. Het gedrag verschuift daarmee nauwelijks, zodat een nieuwe knoop de tijd krijgt om iets waard te worden. Een test meet dat: de outputs bewegen minder dan 0,35 door een splitsing.

| level | NEAT       | gegroeid                   | gewone GA  |
| ----- | ---------- | -------------------------- | ---------- |
| 1     | 533 frames | 13 knopen, 38 verbindingen | 504 frames |
| 2     | 542 frames | 15 knopen, 33 verbindingen | 542 frames |
| 3     | 570 frames | 24 knopen, 42 verbindingen | 570 frames |

Level 2 en 3 komen dus precies op de ondergrens uit, met een netwerk dat een derde van de verbindingen heeft van de vaste 131. Level 1 blijft op deze seed 29 frames achter; met drie andere seeds haalt hij daar wél 504, dus dat is pech en geen eigenschap.

Het netwerk heeft geen lagen om op te stapelen, dus het krijgt een eigen tekening (`src/agent/neat-view.ts`): de diepte van een knoop wordt uit de graaf zelf afgeleid, namelijk één stap rechts van het verste dat erin voert. Gewichten aanpassen kan hier niet; er zijn geen laagcoördinaten om op te klikken.

Eén ding is bewust simpeler dan het artikel: knoopnummers worden per genome uitgedeeld in plaats van globaal. Dat is prima zolang een lijn afstamming houdt, maar het betekent dat kruising tussen twee ver uit elkaar gegroeide soorten knoopnummers kan verwarren. Dat is een bekende hoek van het huis, geen ongeluk.

### A\*: niet leren maar zoeken

De zeven methodes hierboven leren allemaal iets. **A\*** (`src/agent/search.ts`) doet dat niet: de engine is deterministisch en volledig inspecteerbaar, dus je kunt gewoon toekomsten uitproberen en de goedkoopste houden. Zo werd de [Mario AI-competitie van 2009](https://www.researchgate.net/publication/224177833_The_2009_Mario_AI_Competition) gewonnen, door een zoeker en niet door een van de lerende inzendingen.

Er wordt niets benaderd aan die toekomsten: wat de zoeker probeert is exact wat het spel doet, want het _is_ het spel dat het doet. Wat hij wel opgeeft is fijnmazigheid. Plannen per frame werkt niet: een sprong duurt tientallen frames, dus een boom die elk frame twaalf keer vertakt zit vol toekomsten die halverwege de sprong van gedachten veranderen. Een zet is daarom "ren die kant op, houd de sprongknop zo lang vast, en maak het af" (`src/agent/moves.ts`, twee richtingen × zes vasthoudtijden), precies zoals een mens het zou beschrijven. Met zetten per frame loste hij level 3 op en levels 1 en 2 niet, bij welk budget dan ook; met deze zetten alle drie.

De schatting is het aantal frames dat je op zijn allerbest nog nodig hebt: de horizontale afstand gedeeld door de topsnelheid, of de klim gedeeld door de snelste sprongrij, welke van de twee groter is. Allebei zijn het ondergrenzen en geen gokken, en dáárom is de eerste oplossing die A\* vindt meteen de snelste die deze zetten toelaten.

| level | A\*        | beste getrainde agent | wat het kostte              |
| ----- | ---------- | --------------------- | --------------------------- |
| 1     | 504 frames | 504 frames            | 880 knopen, een paar tellen |
| 2     | 542 frames | 542 frames            | 1175 knopen                 |
| 3     | 570 frames | 570 frames            | 647 knopen                  |

Precies gelijk dus, en dat is het hele punt: waar evolutie 27 miljoen frames simuleert om die route te vinden, leest de zoeker hem in een paar seconden van het model af. Tegelijk is dat ook de grens ervan: hij heeft het model nodig. Een lerende agent heeft alleen zijn ogen en mag het spel niet vooruitspoelen.

Op het herhaalscherm ligt die route als oranje stippellijn onder de spoken, met een stip erop waar de zoeker op dat frame zou staan. Zo zie je precies waar een geleerde policy van de beste lijn afdwaalt.

Die route wordt niet in de browser gezocht maar meegeleverd in `src/agent/routes.json`, net als de getrainde gewichten. Eén knoop uitrekenen kost ongeveer 3,4 ms en er gaan er een paar honderd in, dus zoeken tussen de frames door maakte de eerste seconden van een herhaling onbekijkbaar (60 knopen per frame is 400 ms in een frame van 16). Het is een zuivere functie van de engine en de leveldata, dus het hoort in een bestand en niet in de tijd van de speler. `npm run train-agent` schrijft het, en een test speelt elke route opnieuw af en faalt zodra hij het level niet meer haalt.

`validate-levels` is dezelfde zoeker als snelle kanarie: hij simuleert zijn mogelijke zetten tegen de echte engine in plaats van sprongafstanden uit vaste constanten te gokken. Daardoor blijft hij kloppen als de physics veranderen; de vorige, handmatig afgestelde versie werd waardeloos zodra de getallen verschoven. De uitgebreidere controle is de getrainde agent (`npm test` speelt de opgeslagen beste genome per level opnieuw af en eist dat die het certificaat haalt).

## Op een telefoon

Er is geen toetsenbord, dus de toetsen krijgen knoppen. Ze voeren geen tweede soort invoer in: een knop zet precies de toets waar hij voor staat in dezelfde twee verzamelingen waar het toetsenbord in schrijft, dus de menu's, de dialoog en de physics kunnen het verschil niet zien. Een test eist dat elke knop een toets stuurt die het spel ook echt leest, zodat een hernoemde binding daar stukgaat in plaats van stilletjes niets te doen.

Wat er verder anders is op een aanraakscherm:

- De pad verschijnt pas als er iets te sturen valt. Op het titelscherm en in de AI-console tik je, en dan ligt een pad in de weg.
- Tikken op het beeld is de bevestigknop, zodat je door de dialoog komt. Bewust niet dezelfde toets als springen, anders was elke tik tijdens het spelen ook een sprong, en bewust niet actief in de menu's, waar een tik al "deze regel" betekent.
- De knoppen zijn in `vmin` gemaakt, want in `vw` worden ze in liggende stand enorm. Pointer capture houdt een duim vast die van de knop af glijdt; zonder dat ziet de knop het loslaten nooit en rent de speler uit zichzelf door. Als capture niet lukt gaat de druk gewoon door, want de toets vasthouden is belangrijker dan de vinger volgen.
- Het beeld wordt zo groot als past: de volle breedte staand, de volle hoogte liggend, want daar loopt 16:9 het eerst vast.

De aparte testprojecten in `playwright.config.ts` zorgen dat dit ook echt op een telefoonprofiel wordt gecontroleerd: knoppen indrukken, vasthouden, loslaten en zien dat het beeld meebeweegt.

## Visuele regressietests

Alles hierboven test getallen. Een sprite die twee pixels opschuift, een blok dat achter een platform verdwijnt of een letter die van het scherm valt haalt geen enkele assertie, en dat zijn nou precies de fouten die je meteen ziet als je kijkt. Daarom staat er een tweede suite naast: `npm run test:visual` tekent een reeks scenes en vergelijkt ze **pixel voor pixel** met vastgelegde plaatjes in `visual/scenes.spec.ts-snapshots/`.

Die vergelijking kan alleen streng zijn (`maxDiffPixels: 0`) omdat er geen klok aan te pas komt. Een scene wordt niet "het spel een seconde laten lopen en dan kijken" maar "stap de engine precies 200 frames en teken één keer", dus een plaatje is puur een functie van de code. Er wordt ook niets nagebouwd: de scenes gebruiken dezelfde `drawScene`, `drawEntities` en `Menu` als het spel, want een test van een nagetekende titelbalk test niets.

De testpagina (`visual/scenes.html`) hoort bij de tests en niet bij het spel: vite serveert hem in dev, en alleen `index.html` wordt gebouwd. In CI draait dit als aparte stap, met de verschilplaatjes als artifact wanneer het misgaat.

Verandert er bewust iets aan hoe het spel eruitziet, dan is dat `npm run test:visual -- --update-snapshots`, even kijken of het klopt, en de nieuwe plaatjes committen.

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

Na het aanpassen van levelgeometrie of physics: `npm run train-agent` opnieuw draaien. Die schrijft twee gegenereerde bestanden, `training-history.json` en `routes.json`, en er faalt een test per stuk zodra ze niet meer bij het spel passen.

## Hosten (GitHub Pages)

Live op <https://reinierdevries.nl/certificaten/>, de AI-console op <https://reinierdevries.nl/certificaten/agent/replay.html>.

`.github/workflows/build.yml` draait bij elke push en pull request op `master` lint, typecheck en de 129 tests, bouwt daarna, en pusht bij een push naar `master` de `dist/` naar de branch `github-pages`, waar Pages hem vandaan serveert.

```
npm run build:github-pages   # vite build --base=/certificaten/
```

Een project-site wordt geserveerd vanaf `/<repo-naam>/`, dus de repo heet `certificaten` en `--base` moet daarmee overeenkomen. Beide pagina's zitten in de build (`vite.config.ts` noemt ze allebei als entry; zonder dat was de replay-viewer een dev-only pagina die stilzwijgend ontbrak in `dist/`).

De trainingsdata is een gewone `import` van `src/agent/training-history.json`, dus Vite bakt hem bij het bouwen in de bundle: geen fetch, geen los asset-bestand, werkt op elke statische host (17 kB gzipped, en alleen opgehaald als je de console opent). Wat _niet_ kan op Pages: wegschrijven. `npm run train-agent` schrijft het bestand lokaal en je commit het; een trainer in de browser kan zijn resultaat alleen in het geheugen houden, in `localStorage` zetten of als download aanbieden.

## Tekenen: één keer rasteren, daarna blitten

Alles op het scherm is pixelkunst, en dat werd letterlijk pixel voor pixel getekend: `ctx.fillRect(x, y, 1, 1)` per lichtgevende pixel van elke letter, en bij sprites ook nog een `fillStyle` per pixel. Gemeten in Chromium:

| scherm          | vóór                               | na                                 |
| --------------- | ---------------------------------- | ---------------------------------- |
| titelmenu       | 6.099 `fillRect`                   | 2 `fillRect` + 71 `drawImage`      |
| dialoogbox      | 2.943                              | 2 + 33                             |
| spelen          | 2.795 `fillRect` + 830 `fillStyle` | 29 `drawImage`                     |
| alle generaties | 4.066 `fillRect` + 13.600 `lineTo` | 99 + 43 `drawImage` + 185 `lineTo` |

Glyphs staan nu per kleur in één offscreen strip, spriteframes worden één keer gerasterd in beide richtingen, en de statische scène (lucht, wolken, platforms, certificaat) wordt per level één keer geschilderd waarna alleen de zichtbare strook geblit wordt. In de console tekenen de negenennegentig verliezende ghosts hun spoor één keer op een trail-canvas in plaats van elke frame hun hele geschiedenis opnieuw te strooken; de koploper wordt nog wel live getekend, want dat is één pad.

Het beeld is hierbij bit voor bit gelijk gebleven: `Math.round(x + n)` is `Math.round(x) + n` voor gehele `n`, dus het afronden van de oorsprong van een glyph landt op dezelfde pixels als het afronden van elke pixel apart. Nagemeten door de canvasinhoud van beide versies op hetzelfde frame te vergelijken: nul verschillende pixels.

Met **F** zet je een framerateteller aan, in het spel en in de console, zodat je op je eigen machine kunt zien wat het oplevert.

## Waarom het font is omgezet naar pixels

Het TTF wordt niet ingeladen; de glyphs staan als harde pixels in `src/font-glyphs.ts`. Dat is 18,6 kB aan bron, maar het comprimeert naar **1,4 kB** over de lijn, want een raster van nullen en enen is precies wat gzip goed doet. Een TrueType-bestand is zelf al gecomprimeerd en zou daar niet onder komen. Belangrijker dan de bytes: het rasteren gebeurt nu één keer op mijn machine in plaats van elke keer in de browser van de bezoeker, en een browser die het font net iets anders hint of afrondt kan het resultaat niet meer scheeftrekken. Runtime inladen zou dus meer code, een async wachtmoment vóór het eerste frame en een bron van onvoorspelbaarheid opleveren, en geen kleinere download.

## Attributie

Het bitmap-font is afgeleid van de "Super Mario Bros. NES Font"-recreatie door Patrick Adams ([TheWolfBunny64](https://thewolfbunny64.itch.io/super-mario-bros-nes)), gebruikt met toestemming van de maker. Elk teken is eenmalig gerenderd en omgezet naar harde pixels (`src/font-glyphs.ts`); er zit geen los font-bestand in de app. De sprites zijn origineel handgetekend, geen Nintendo-assets.

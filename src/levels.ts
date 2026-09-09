import { certificateOn, enemyOn, mushroomOn, platform, startOn } from "./level-builders";

export type Platform = { x: number; y: number; w: number; h: number };
export type EnemyDef = { x: number; y: number; facing: 1 | -1 };
export type Rect = { x: number; y: number; w: number; h: number };

export type MushroomDef = { x: number; y: number };

export type Level = {
  /** Levels are wider than the 480px view; the camera scrolls across them. */
  width: number;
  /** Units of level time, counted down like SMB1's 400. */
  timeLimit: number;
  platforms: Platform[];
  enemies: EnemyDef[];
  mushrooms: MushroomDef[];
  certificate: Rect;
  playerStart: { x: number; y: number };
  intro: string[];
  outro: string[];
};

const GROUND_Y = 240;
const LEVEL_WIDTH = 1440;

const one = {
  ground: platform(0, GROUND_Y, 470, 30),
  groundAfterGap: platform(540, GROUND_Y, 400, 30),
  groundEnd: platform(1010, GROUND_Y, 430, 30),
  firstLedge: platform(220, 190, 110),
  highLedge: platform(430, 150, 120),
  midLedge: platform(700, 185, 130),
  stepUp: platform(950, 185, 130),
  prize: platform(1170, 145, 190),
};

const two = {
  ground: platform(0, GROUND_Y, 380, 30),
  island: platform(450, GROUND_Y, 260, 30),
  groundEnd: platform(790, GROUND_Y, 650, 30),
  ledge: platform(180, 185, 120),
  stair1: platform(470, 190, 110),
  stair2: platform(640, 150, 110),
  stair3: platform(820, 115, 120),
  balcony: platform(1030, 160, 150),
  prize: platform(1250, 120, 160),
};

const three = {
  ground: platform(0, GROUND_Y, 300, 30),
  pillar1: platform(380, 205, 90),
  pillar2: platform(540, 170, 90),
  pillar3: platform(700, 135, 90),
  landing: platform(860, 175, 180),
  pillar4: platform(1110, 140, 90),
  prize: platform(1250, 100, 190),
};

export const LEVELS: Level[] = [
  {
    width: LEVEL_WIDTH,
    timeLimit: 400,
    platforms: Object.values(one),
    enemies: [
      enemyOn(one.ground, { offsetFromLeftEdge: 300, facing: -1 }),
      enemyOn(one.midLedge, { offsetFromLeftEdge: 90, facing: -1 }),
      enemyOn(one.groundEnd, { offsetFromLeftEdge: 200, facing: -1 }),
    ],
    mushrooms: [mushroomOn(one.firstLedge, 40)],
    certificate: certificateOn(one.prize, 70),
    playerStart: startOn(one.ground, 25),
    intro: [
      "Je bent bureaucratie-avonturier.",
      "Op zoek naar het felbegeerde Certificaat.",
      "Vandaag: loket een. Hoe moeilijk kan het zijn?",
    ],
    outro: ["Certificaat 1 binnen!", "Er blijken nog twee loketten te zijn.", "Uiteraard."],
  },
  {
    width: LEVEL_WIDTH,
    timeLimit: 400,
    platforms: Object.values(two),
    enemies: [
      enemyOn(two.ground, { offsetFromLeftEdge: 250, facing: -1 }),
      enemyOn(two.stair2, { offsetFromLeftEdge: 60, facing: -1 }),
      enemyOn(two.groundEnd, { offsetFromLeftEdge: 260, facing: -1 }),
      enemyOn(two.balcony, { offsetFromLeftEdge: 100, facing: -1 }),
    ],
    mushrooms: [mushroomOn(two.ledge, 40), mushroomOn(two.balcony, 60)],
    certificate: certificateOn(two.prize, 80),
    playerStart: startOn(two.ground, 20),
    intro: [
      "Loket twee: 'Extra verificatie vereist.'",
      "De formulier-wachters lopen gewoon van de rand af.",
      "Spring op ze. Het mag, echt.",
    ],
    outro: ["Certificaat 2 verkregen.", "Na drie exemplaren die niemand leest.", "Een loket te gaan."],
  },
  {
    width: LEVEL_WIDTH,
    timeLimit: 400,
    platforms: Object.values(three),
    enemies: [
      enemyOn(three.ground, { offsetFromLeftEdge: 200, facing: -1 }),
      enemyOn(three.landing, { offsetFromLeftEdge: 120, facing: -1 }),
      enemyOn(three.prize, { offsetFromLeftEdge: 140, facing: -1 }),
    ],
    mushrooms: [mushroomOn(three.pillar2, 30)],
    certificate: certificateOn(three.prize, 150),
    playerStart: startOn(three.ground, 20),
    intro: [
      "Het laatste loket.",
      "Hoogste toren, langste rij, kleinste lettertjes.",
      "Dit is hem. Volhouden.",
    ],
    outro: [
      "Alle certificaten binnen.",
      "De queeste is volbracht.",
      "Ergens rinkelt een telefoon:",
      "'Helaas, vervallen per 1 januari.'",
    ],
  },
];

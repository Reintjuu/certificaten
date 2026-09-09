import { certificateOn, enemyOn, platform, startOn } from "./level-builders"

export type Platform = { x: number; y: number; w: number; h: number }
export type EnemyDef = { x: number; y: number; vx: number; patrolMin: number; patrolMax: number }
export type Rect = { x: number; y: number; w: number; h: number }

export type Level = {
  platforms: Platform[]
  enemies: EnemyDef[]
  certificate: Rect
  playerStart: { x: number; y: number }
  intro: string[]
  outro: string[]
}

// Levels are built from named platforms rather than raw coordinates: an enemy
// or the certificate is placed *on* a platform, so moving that platform moves
// everything standing on it. test/levels.test.ts checks the invariants the
// builders can't (nothing floating, nothing unreachable, patrols on solid
// ground).

const one = {
  ground: platform(0, 240, 480, 30),
  firstStep: platform(70, 195, 85),
  guarded: platform(190, 160, 85),
  detour: platform(315, 205, 70),
  prize: platform(395, 145, 85),
}

const two = {
  groundBeforeGap: platform(0, 240, 150, 30),
  groundAfterGap: platform(210, 240, 270, 30),
  firstStep: platform(40, 190, 70),
  highLedge: platform(150, 150, 60),
  guarded: platform(250, 190, 70),
  climb: platform(350, 150, 70),
  prize: platform(410, 100, 70),
}

const three = {
  ground: platform(0, 240, 480, 30),
  step1: platform(40, 205, 60),
  guarded: platform(130, 175, 60),
  step3: platform(220, 145, 60),
  step4: platform(300, 110, 60),
  prize: platform(380, 75, 70),
}

export const LEVELS: Level[] = [
  {
    platforms: Object.values(one),
    enemies: [enemyOn(one.guarded, { from: 10, to: 66, speed: 0.7 })],
    certificate: certificateOn(one.prize, 35),
    playerStart: startOn(one.ground, 25),
    intro: [
      "Je bent bureaucratie-avonturier.",
      "Op zoek naar het felbegeerde Certificaat.",
      "Vandaag: loket een. Hoe moeilijk kan het zijn?",
    ],
    outro: ["Certificaat 1 binnen!", "Er blijken nog twee loketten te zijn.", "Uiteraard."],
  },
  {
    platforms: Object.values(two),
    enemies: [
      enemyOn(two.groundBeforeGap, { from: 60, to: 115, speed: 0.8 }),
      enemyOn(two.guarded, { from: 30, to: 54, speed: 0.9 }),
    ],
    certificate: certificateOn(two.prize, 30),
    playerStart: startOn(two.groundBeforeGap, 20),
    intro: [
      "Loket twee: 'Extra verificatie vereist.'",
      "Twee formulier-wachters bewaken de trap.",
      "Spring op ze. Het mag, echt.",
    ],
    outro: ["Certificaat 2 verkregen.", "Na drie exemplaren die niemand leest.", "Een loket te gaan."],
  },
  {
    platforms: Object.values(three),
    enemies: [enemyOn(three.guarded, { from: 20, to: 44, speed: 0.8 })],
    certificate: certificateOn(three.prize, 30),
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
]

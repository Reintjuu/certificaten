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

export const LEVELS: Level[] = [
  {
    platforms: [
      { x: 0, y: 240, w: 480, h: 30 },
      { x: 70, y: 195, w: 85, h: 12 },
      { x: 190, y: 160, w: 85, h: 12 },
      { x: 315, y: 205, w: 70, h: 12 },
      { x: 395, y: 145, w: 85, h: 12 },
    ],
    enemies: [
      { x: 220, y: 144, vx: 0.7, patrolMin: 200, patrolMax: 256 },
    ],
    certificate: { x: 430, y: 108, w: 18, h: 24 },
    playerStart: { x: 25, y: 205 },
    intro: [
      "Je bent bureaucratie-avonturier.",
      "Op zoek naar het felbegeerde Certificaat.",
      "Vandaag: loket een. Hoe moeilijk kan het zijn?",
    ],
    outro: [
      "Certificaat 1 binnen!",
      "Er blijken nog twee loketten te zijn.",
      "Uiteraard.",
    ],
  },
  {
    platforms: [
      { x: 0, y: 240, w: 150, h: 30 },
      { x: 210, y: 240, w: 270, h: 30 },
      { x: 40, y: 190, w: 70, h: 12 },
      { x: 150, y: 150, w: 60, h: 12 },
      { x: 250, y: 190, w: 70, h: 12 },
      { x: 350, y: 150, w: 70, h: 12 },
      { x: 410, y: 100, w: 70, h: 12 },
    ],
    enemies: [
      { x: 70, y: 224, vx: 0.8, patrolMin: 60, patrolMax: 115 },
      { x: 285, y: 174, vx: 0.9, patrolMin: 280, patrolMax: 315 },
    ],
    certificate: { x: 440, y: 68, w: 18, h: 24 },
    playerStart: { x: 20, y: 205 },
    intro: [
      "Loket twee: 'Extra verificatie vereist.'",
      "Twee formulier-wachters bewaken de trap.",
      "Spring op ze. Het mag, echt.",
    ],
    outro: [
      "Certificaat 2 verkregen.",
      "Na drie exemplaren die niemand leest.",
      "Een loket te gaan.",
    ],
  },
  {
    platforms: [
      { x: 0, y: 240, w: 480, h: 30 },
      { x: 40, y: 205, w: 60, h: 12 },
      { x: 130, y: 175, w: 60, h: 12 },
      { x: 220, y: 145, w: 60, h: 12 },
      { x: 300, y: 110, w: 60, h: 12 },
      { x: 380, y: 75, w: 70, h: 12 },
    ],
    enemies: [
      { x: 168, y: 159, vx: 0.8, patrolMin: 163, patrolMax: 186 },
    ],
    certificate: { x: 410, y: 43, w: 18, h: 24 },
    playerStart: { x: 20, y: 205 },
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

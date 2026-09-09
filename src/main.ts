const canvas = document.querySelector<HTMLCanvasElement>("#game")!
const ctx = canvas.getContext("2d")!
ctx.imageSmoothingEnabled = false

const keys = new Set<string>()

addEventListener("keydown", e => {
  e.preventDefault();
  keys.add(e.key.toLowerCase())
  if (e.key.toLowerCase() === "r") reset()
})
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()))

const platforms = [
  { x: 0, y: 240, w: 480, h: 30 },
  { x: 70, y: 195, w: 85, h: 12 },
  { x: 190, y: 160, w: 85, h: 12 },
  { x: 315, y: 205, w: 70, h: 12 },
  { x: 395, y: 145, w: 85, h: 12 }
]

const certificate = { x: 430, y: 108, w: 18, h: 24 }

let player = { x: 25, y: 205, w: 16, h: 24, vx: 0, vy: 0 }
let enemy = { x: 220, y: 136, w: 18, h: 24, vx: 0.7 }
let won = false
let dead = false

function reset() {
  player = { x: 25, y: 205, w: 16, h: 24, vx: 0, vy: 0 }
  enemy = { x: 220, y: 136, w: 18, h: 24, vx: 0.7 }
  won = dead = false
}

function hit(a: any, b: any) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y
}

function update() {
  if (won || dead) return

  const left = keys.has("arrowleft") || keys.has("a")
  const right = keys.has("arrowright") || keys.has("d")
  const jump = keys.has(" ") || keys.has("w") || keys.has("arrowup")

  player.vx = (right ? 2.2 : 0) - (left ? 2.2 : 0)
  if (jump && Math.abs(player.vy) < 0.1) player.vy = -6.5

  player.vy += 0.3
  player.x += player.vx
  player.y += player.vy

  for (const p of platforms) {
    if (player.vy >= 0 &&
        player.x + player.w > p.x && player.x < p.x + p.w &&
        player.y + player.h >= p.y && player.y + player.h - player.vy <= p.y) {
      player.y = p.y - player.h
      player.vy = 0
    }
  }

  player.x = Math.max(0, Math.min(464, player.x))

  enemy.x += enemy.vx
  if (enemy.x < 205 || enemy.x > 255) enemy.vx *= -1

  if (hit(player, enemy)) dead = true
  if (hit(player, certificate)) won = true
  if (player.y > 290) dead = true
}

function draw() {
  ctx.fillStyle = "#62b9ff"
  ctx.fillRect(0, 0, 480, 270)

  // clouds
  ctx.fillStyle = "#fff"
  ctx.fillRect(35, 35, 42, 8)
  ctx.fillRect(50, 27, 25, 8)
  ctx.fillRect(330, 55, 48, 8)

  // platforms
  for (const p of platforms) {
    ctx.fillStyle = "#42a642"
    ctx.fillRect(p.x, p.y, p.w, p.h)
    ctx.fillStyle = "#8b5a2b"
    ctx.fillRect(p.x, p.y + 5, p.w, p.h - 5)
  }

  // certificate
  ctx.fillStyle = "#fff8d6"
  ctx.fillRect(certificate.x, certificate.y, certificate.w, certificate.h)
  ctx.fillStyle = "#d33"
  ctx.fillRect(certificate.x + 4, certificate.y + 4, 10, 4)
  ctx.fillRect(certificate.x + 7, certificate.y + 8, 4, 11)

  // enemy
  ctx.fillStyle = "#5a2a18"
  ctx.fillRect(enemy.x, enemy.y, enemy.w, enemy.h)
  ctx.fillStyle = "#fff"
  ctx.fillRect(enemy.x + 3, enemy.y + 5, 4, 4)
  ctx.fillRect(enemy.x + 11, enemy.y + 5, 4, 4)

  // player
  ctx.fillStyle = "#e33"
  ctx.fillRect(player.x, player.y, player.w, 8)
  ctx.fillStyle = "#ffd0a0"
  ctx.fillRect(player.x + 3, player.y + 8, 10, 8)
  ctx.fillStyle = "#2870c8"
  ctx.fillRect(player.x + 2, player.y + 16, 12, 8)

  ctx.fillStyle = "#111"
  ctx.font = "bold 12px monospace"
  ctx.fillText("QUEESTE NAAR DE CERTIFICATEN", 12, 18)

  if (won || dead) {
    ctx.fillStyle = "rgba(0,0,0,.72)"
    ctx.fillRect(0, 0, 480, 270)
    ctx.fillStyle = "#fff"
    ctx.textAlign = "center"
    ctx.font = "bold 24px monospace"
    ctx.fillText(won ? "CERTIFICAAT GEVONDEN!" : "JE BENT GESTRAND!", 240, 120)
    ctx.font = "14px monospace"
    ctx.fillText(won ? "Eindelijk. De organisatie kan niet meer weigeren." : "De bureaucratie heeft gewonnen.", 240, 150)
    ctx.fillText("Druk op R om opnieuw te beginnen", 240, 180)
    ctx.textAlign = "left"
  }
}

function loop() {
  update()
  draw()
  requestAnimationFrame(loop)
}

loop()

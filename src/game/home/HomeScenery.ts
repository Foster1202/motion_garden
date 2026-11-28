const TAU = Math.PI * 2;
type Point = readonly [number, number];

export const HOME_PALETTES = [
  { sky: '#49436c', horizon: '#d99b85', hill: '#6f5767', far: '#8b746c', ground: '#485b48',
    grass: '#273b36', path: '#a98273', trail: '#60484b', leaves: '#b9a56d', flowers: '#e0a8aa' },
  { sky: '#324b66', horizon: '#9686aa', hill: '#526e76', far: '#698582', ground: '#4a6455',
    grass: '#263e3c', path: '#a0927f', trail: '#525354', leaves: '#9aaf84', flowers: '#afb9d4' },
  { sky: '#1d264c', horizon: '#6b688e', hill: '#495274', far: '#655b7b', ground: '#454f58',
    grass: '#262d43', path: '#9b827e', trail: '#504659', leaves: '#a5a291', flowers: '#d2b2db' },
] as const;

export type HomePalette = Record<keyof typeof HOME_PALETTES[number], string>;

export function grain(seed: number) {
  const value = Math.sin(seed * 126.1 + 91.7) * 43618.724;
  return value - Math.floor(value);
}

export function blendColor(from: string, to: string, t: number) {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

export function fillPoly(ctx: CanvasRenderingContext2D, color: string | CanvasGradient, vertices: readonly Point[]) {
  ctx.fillStyle = color;
  ctx.beginPath();
  vertices.forEach(([x, y], index) => {
    if (index) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

export function oval(ctx: CanvasRenderingContext2D, color: string | CanvasGradient,
  x: number, y: number, rx: number, ry = rx, angle = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fill();
}

export function trail(ctx: CanvasRenderingContext2D, color: string | CanvasGradient,
  width: number, points: readonly Point[]) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
}

export function softLight(color: string) {
  const texture = document.createElement('canvas');
  texture.width = texture.height = 96;
  const ctx = texture.getContext('2d')!;
  const glow = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  glow.addColorStop(0, `${color}d4`);
  glow.addColorStop(.29, `${color}55`);
  glow.addColorStop(.67, `${color}13`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 96, 96);
  return texture;
}

export function paintGlow(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement,
  x: number, y: number, r: number, ry = r, strength = 1) {
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha *= strength;
  ctx.drawImage(texture, x - r, y - ry, 2 * r, 2 * ry);
  ctx.globalAlpha = alpha;
}

export function brick(ctx: CanvasRenderingContext2D, color: string | CanvasGradient,
  x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

export function makeTree(seed: number, far = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 510;
  const ctx = canvas.getContext('2d')!;
  const bark = ctx.createLinearGradient(105, 0, 290, 0);
  bark.addColorStop(0, far ? '#5d576e' : '#61474b');
  bark.addColorStop(.55, far ? '#45475b' : '#3c313d');
  bark.addColorStop(1, far ? '#313f51' : '#2d2937');
  const direction = seed % 2 ? -1 : 1;
  ctx.translate(direction === -1 ? 400 : 0, 0);
  ctx.scale(direction, 1);
  ctx.fillStyle = bark;
  ctx.beginPath();
  ctx.moveTo(108, 503);
  ctx.bezierCurveTo(188, 473, 199, 351, 181, 272);
  ctx.bezierCurveTo(167, 231, 121, 197, 80, 168);
  ctx.lineTo(86, 151);
  ctx.bezierCurveTo(121, 172, 149, 189, 174, 206);
  ctx.bezierCurveTo(167, 141, 188, 80, 209, 51);
  ctx.lineTo(226, 50);
  ctx.bezierCurveTo(202, 123, 207, 173, 217, 209);
  ctx.bezierCurveTo(233, 189, 270, 155, 310, 150);
  ctx.lineTo(316, 169);
  ctx.bezierCurveTo(255, 195, 222, 236, 228, 279);
  ctx.bezierCurveTo(239, 361, 228, 469, 287, 499);
  ctx.bezierCurveTo(237, 491, 211, 501, 190, 503);
  ctx.bezierCurveTo(164, 499, 140, 498, 108, 503);
  ctx.fill();
  if (!far) {
    const groove = (color: string, width: number,
      move: Point, curve: readonly [number, number, number, number, number, number]) => {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(...move);
      ctx.bezierCurveTo(...curve);
      ctx.stroke();
    };
    groove('#b0816259', 4, [152, 483], [194, 462, 208, 342, 197, 279]);
    groove('#ad816075', 3.5, [190, 209], [187, 160, 197, 115, 209, 84]);
    groove('#9f746468', 3, [218, 262], [223, 213, 267, 185, 293, 177]);
    groove('#271f2f7c', 4, [215, 476], [229, 433, 222, 353, 214, 325]);
    groove('#dfaa7c35', 3, [184, 335], [184, 369, 178, 401, 172, 415]);
  }
  const foliage = far ? ['#798481', '#525d63', '#3a4c55']
    : seed % 3 === 0 ? ['#778969', '#4e6657', '#324a48']
      : ['#7c8269', '#4f665c', '#324951'];
  const clusters = Array.from({ length: far ? 14 : 29 }, (_, i) => {
    const k = i + seed * 29;
    return { x: 88 + grain(k) * 224, y: 52 + grain(k + 15) * 118,
      radius: 23 + grain(k + 49) * 56, tilt: -.28 + grain(k + 59) * .5 };
  }).sort((a, b) => a.y - b.y);
  for (const { x, y, radius, tilt } of clusters) {
    const shade = ctx.createRadialGradient(x - radius * .15, y - radius * .39, 0, x, y, radius);
    shade.addColorStop(0, foliage[0]);
    shade.addColorStop(.62, foliage[1]);
    shade.addColorStop(1, foliage[2]);
    oval(ctx, shade, x, y, radius, radius * .69, tilt);
  }
  if (!far) for (let i = 0; i < 42; i++) {
    const k = seed * 111 + i;
    const x = 52 + grain(k) * 288;
    const y = 56 + grain(k + 79) * 142;
    oval(ctx, '#b2ae8533', x, y, 2 + grain(k + 172) * 7, 1.5 + grain(k + 37) * 3, grain(k) - .5);
  }
  return canvas;
}

export function tuft(ctx: CanvasRenderingContext2D, x: number, y: number,
  s: number, seed: number, palette: HomePalette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const color = palette.grass;
  oval(ctx, '#29293935', 1, 3, 29, 6);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-10, 1);
  ctx.quadraticCurveTo(-23, -21, -37, -24);
  ctx.quadraticCurveTo(-14, -26, -4, -9);
  ctx.quadraticCurveTo(-10, -31, -6, -44);
  ctx.quadraticCurveTo(4, -28, 4, -6);
  ctx.quadraticCurveTo(11, -35, 24, -36);
  ctx.quadraticCurveTo(17, -23, 11, -7);
  ctx.quadraticCurveTo(23, -21, 39, -16);
  ctx.quadraticCurveTo(25, -10, 13, 1);
  ctx.closePath();
  ctx.fill();
  if (grain(seed) < .29) {
    trail(ctx, palette.leaves, 2.5, [[2, 0], [9, -18], [7, -31]]);
    oval(ctx, palette.flowers, 6, -33, 6, 4, -.27);
    oval(ctx, palette.flowers, 11, -28, 4.7, 3.3, .38);
    oval(ctx, '#ffdda0', 7, -29, 2.25);
  }
  ctx.restore();
}

export function lantern(ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  lit: boolean, glow: HTMLCanvasElement, shimmer: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  oval(ctx, '#212c2c64', 0, 2, 37, 7);
  trail(ctx, '#422f32', 9, [[0, 0], [0, -111], [-32, -111]]);
  trail(ctx, '#aa7b5b', 2.5, [[-2, -9], [-2, -114], [-33, -114]]);
  trail(ctx, '#583840', 3.5, [[-31, -111], [-31, -96]]);
  if (lit) paintGlow(ctx, glow, -32, -72, 112 + shimmer * 12, 105, .94);
  else paintGlow(ctx, glow, -32, -72, 36, 38, .32);
  fillPoly(ctx, '#623a3c', [[-54, -94], [-48, -103], [-14, -103], [-10, -94]]);
  brick(ctx, '#603942', -51, -95, 39, 44, 8);
  brick(ctx, lit ? '#ffd687' : '#9b7b77', -47, -91, 31, 34, 6);
  if (lit) oval(ctx, '#fff2b3', -31, -74, 10, 12);
  trail(ctx, '#79434b', 3, [[-32, -91], [-32, -55]]);
  brick(ctx, lit ? '#b56c51' : '#775750', -53, -57, 43, 8, 4);
  oval(ctx, '#af7d58', 0, -117, 7, 7);
  ctx.restore();
}

export function cottage(ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  open: number, glow: HTMLCanvasElement, timeMs: number, reducedMotion: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const pulse = reducedMotion ? 1 : .92 + .08 * Math.sin(timeMs / 460);
  paintGlow(ctx, glow, 5, -100, 315, 242, .76 + open * .19);
  oval(ctx, '#2927386d', 0, 8, 245, 35);
  if (open > 0) paintGlow(ctx, glow, 15, 10, 145 + 55 * open, 38, open * .8);

  const side = ctx.createLinearGradient(100, 0, 190, 0);
  side.addColorStop(0, '#9f6b56');
  side.addColorStop(1, '#725765');
  fillPoly(ctx, side, [[122, -147], [191, -171], [183, -11], [120, 3]]);
  const wall = ctx.createLinearGradient(0, -170, 0, 0);
  wall.addColorStop(0, '#eead83');
  wall.addColorStop(.56, '#d49a73');
  wall.addColorStop(1, '#ae765e');
  brick(ctx, wall, -149, -176, 285, 176, 17);
  trail(ctx, '#7e5864', 8, [[-148, -8], [-77, -9], [53, -9], [136, -8], [185, -20]]);
  const roof = ctx.createLinearGradient(0, -294, 0, -151);
  roof.addColorStop(0, '#c37c71');
  roof.addColorStop(.54, '#9d5363');
  roof.addColorStop(1, '#704153');
  fillPoly(ctx, '#784655', [[-132, -165], [-11, -290], [107, -306], [211, -180], [183, -161], [52, -165]]);
  fillPoly(ctx, roof, [[-181, -160], [-49, -286], [-9, -298], [32, -282], [161, -157], [110, -152], [-97, -153]]);
  fillPoly(ctx, '#cf8572', [[-181, -160], [-49, -286], [-9, -298], [32, -282], [102, -214], [19, -272], [-11, -282], [-39, -270], [-153, -158]]);
  for (let row = 0; row < 6; row++) {
    const ry = -272 + row * 21;
    const end = 9 + row * 23;
    trail(ctx, '#e6a08863', 2.3, [[-end - 20, ry + 3], [-end * .2, ry], [end * .58, ry - 2], [end, ry + 1]]);
    for (let i = 1; i <= row + 1; i++) {
      const rx = -end - 12 + 2 * end * i / (row + 2) + (row % 2) * 9;
      trail(ctx, '#6e3d529e', 1.9, [[rx, ry + 2], [rx + 3, ry + 14]]);
    }
  }
  trail(ctx, '#613b52', 9, [[-174, -157], [-103, -154], [-11, -158], [86, -151], [157, -153]]);
  trail(ctx, '#ffb487', 3.5, [[-165, -150], [-103, -147], [-11, -151], [89, -144], [152, -146]]);
  fillPoly(ctx, '#9b5d66', [[112, -219], [133, -219], [131, -282], [110, -280]]);
  fillPoly(ctx, '#bd776c', [[89, -225], [111, -218], [110, -282], [89, -282]]);
  brick(ctx, '#744456', 84, -289, 53, 13, 5);
  if (!reducedMotion) for (let i = 0; i < 3; i++) {
    const t = (timeMs / 2900 + i / 3) % 1;
    oval(ctx, `rgba(244,191,170,${.16 * (1 - t)})`, 107 + t * 54, -305 - t * 83, 10 + t * 29, 6 + t * 16, -.3);
  }

  const window = (wx: number, wy: number, radius: number) => {
    paintGlow(ctx, glow, wx, wy, 85, 71, pulse * .84);
    oval(ctx, '#7b4d56', wx, wy, radius + 7);
    oval(ctx, '#f2b77d', wx, wy, radius + 2);
    oval(ctx, '#ffdf9c', wx, wy, radius - 3);
    trail(ctx, '#ad6e60', 4, [[wx - radius + 1, wy], [wx + radius - 1, wy]]);
    trail(ctx, '#ad6e60', 4, [[wx, wy - radius + 1], [wx, wy + radius - 1]]);
    oval(ctx, '#fff3ba', wx - radius * .36, wy - radius * .37, radius * .24, radius * .2, -.2);
  };
  window(-90, -92, 28);
  window(85, -93, 28);
  window(-7, -195, 18);
  for (const w of [-90, 85]) {
    brick(ctx, '#744b51', w - 33, -64, 66, 12, 5);
    brick(ctx, '#546454', w - 30, -69, 60, 7, 5);
    for (let i = 0; i < 6; i++) oval(ctx, i % 2 ? '#f0a990' : '#d7b387', w - 23 + i * 9.4, -72 + (i % 3) * 1.8, 4, 3);
  }
  trail(ctx, '#79565d', 4, [[-146, -136], [-109, -121], [-66, -118], [-21, -126], [22, -125], [64, -118], [107, -121], [138, -134]]);
  for (let i = 0; i < 8; i++) {
    const lx = -135 + i * 37;
    const ly = -132 + 9 * Math.sin(i * 1.1) + 6;
    trail(ctx, '#875659', 2, [[lx, ly - 6], [lx, ly]]);
    oval(ctx, i % 2 ? '#ffd990' : '#f7a77d', lx, ly + 4, 4, 6);
  }

  brick(ctx, '#754752', -42, -115, 82, 117, [34, 34, 7, 7]);
  const doorLight = ctx.createLinearGradient(0, -104, 0, 0);
  doorLight.addColorStop(0, '#ffeca8');
  doorLight.addColorStop(1, '#efa367');
  brick(ctx, doorLight, -34, -107, 66, 107, [28, 28, 2, 2]);
  if (open > .02) paintGlow(ctx, glow, -5, -36, 96, 119, open * .56);
  ctx.save();
  ctx.translate(-33, 0);
  ctx.transform(1 - .83 * open, -.27 * open, 0, 1, 0, 0);
  brick(ctx, '#8d5661', 0, -107, 66, 107, [28, 28, 2, 2]);
  brick(ctx, '#aa6664', 5, -102, 56, 94, [24, 24, 5, 5]);
  trail(ctx, '#cf8a73', 2, [[20, -90], [20, -11]]);
  trail(ctx, '#79505b', 2, [[39, -96], [39, -10]]);
  oval(ctx, '#e8b172', 52, -43, 4.5);
  ctx.restore();
  brick(ctx, '#897675', -52, -3, 100, 10, 5);
  brick(ctx, '#ab8980', -55, 6, 106, 11, 5);
  if (open > .15) paintGlow(ctx, glow, 0, 16, 154, 28, .9 * open);
  ctx.restore();
}

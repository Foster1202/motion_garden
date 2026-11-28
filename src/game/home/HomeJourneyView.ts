import type Phaser from 'phaser';
import { LowPerformanceDrawGate } from '../3d/threeRenderQuality';
import { GAME_HEIGHT, GAME_WIDTH } from '../layout';
import { getGameSettings } from '../settings/gameSettings';
import { HomeRabbitView } from './HomeRabbitView';
import {
  blendColor, cottage, fillPoly, grain, HOME_PALETTES, lantern, makeTree, oval, paintGlow, softLight, trail, tuft,
  type HomePalette,
} from './HomeScenery';
import { HOME_END, HOME_GATES, HOME_LANTERNS, HOME_STAGES, type HomeFoot, type HomeGate, type HomeLane } from './RabbitHomeRound';

const MIDPOINT = GAME_WIDTH / 2;
const HORIZON = 402;
const FEET = 720;
const CAMERA_DEPTH = 13;
const LANE_WIDTH = 154;
const TAU = 2 * Math.PI;
const COTTAGE_AT = HOME_END + 4.6;
const COTTAGE_LANE = 1.53;
const ART = ['forest', 'brook', 'stars'] as const;

type Point = [number, number];
type Tree = { at: number; lane: number; size: number; index: number; far: boolean };
type Dust = { timeMs: number; at: number; x: number; side: HomeFoot; seed: number };

export interface HomeJourneyFrame {
  distance: number;
  lane: HomeLane;
  steps: number;
  lastFoot: HomeFoot | null;
  lanterns: number;
  gate: HomeGate | null;
  timeMs: number;
  moving: boolean;
  arrived: boolean;
  blocked: boolean;
}

const initialFrame: HomeJourneyFrame = {
  distance: 0, lane: 0, steps: 0, lastFoot: null, lanterns: 0,
  gate: HOME_GATES[0], timeMs: 0, moving: false, arrived: false, blocked: false,
};

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const smooth = (value: number, low: number, high: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const curve = (at: number) => Math.sin(at * .201) * 65 + Math.sin(at * .079) * 58;
const pathWidth = (at: number) => 1.78 + Math.sin(at * .45) * .095 + Math.sin(at * .163) * .12;

export class HomeJourneyView {
  private readonly lowPerformance = getGameSettings().lowPerformanceMode;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly drawGate = new LowPerformanceDrawGate();
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly rabbit: HomeRabbitView;
  private readonly key = 'rabbit-home-scenery';
  private readonly glow = softLight('#ffc376');
  private readonly mote = softLight('#ffdf8b');
  private readonly mist = softLight('#f3aa94');
  private readonly ripple = softLight('#a9e6d6');
  private readonly trees = Array.from({ length: 7 }, (_, i) => makeTree(i, i >= 4));
  private readonly grove: Tree[] = [];
  private readonly plates: HTMLImageElement[] = ART.map(name => {
    const img = new Image();
    img.decoding = 'async';
    img.src = `${import.meta.env.BASE_URL}assets/rabbit_home/${name}.webp`;
    return img;
  });
  private readonly dust: Dust[] = [];
  private distance = 0;
  private x = MIDPOINT;
  private time = 0;
  private lastSteps = 0;
  private arrivalTime: number | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const width = this.lowPerformance ? 640 : 1120;
    const height = width * GAME_HEIGHT / GAME_WIDTH;
    this.texture = scene.textures.createCanvas(this.key, width, height)!;
    this.image = scene.add.image(0, 0, this.key).setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.texture.context.setTransform(width / GAME_WIDTH, 0, 0, height / GAME_HEIGHT, 0, 0);
    for (let i = -4; i < 35; i++) {
      for (const side of [-1, 1]) {
        const k = i * 29 + side * 7;
        this.grove.push({
          at: i * 4.85 + grain(k) * 3.9,
          lane: side * (2.47 + grain(k + 29) * 2.45),
          size: .81 + grain(k + 157) * .64,
          index: Math.floor(grain(k + 124) * 7),
          far: grain(k + 83) < .43,
        });
      }
    }
    this.grove.sort((a, b) => b.at - a.at);
    this.rabbit = new HomeRabbitView(scene, this.lowPerformance, this.reducedMotion);
    this.draw(initialFrame);
  }

  update(frame: HomeJourneyFrame) {
    if (this.destroyed) return;
    const dt = clamp(frame.timeMs - this.time, 0, 100);
    this.time = frame.timeMs;
    if (frame.arrived && this.arrivalTime === null) this.arrivalTime = frame.timeMs;
    const arrivedMs = this.arrivalTime === null ? null : frame.timeMs - this.arrivalTime;
    const distanceDelta = frame.distance - this.distance;
    if (distanceDelta > 0) {
      this.distance += distanceDelta * (1 - Math.exp(-dt / (this.reducedMotion ? 100 : 150)));
      if (frame.distance - this.distance < .008) this.distance = frame.distance;
    }
    const arrivalShift = arrivedMs === null ? 0 : smooth(arrivedMs, 60, 1150);
    const laneX = MIDPOINT + frame.lane * LANE_WIDTH;
    const goalX = mix(laneX, this.project(COTTAGE_AT, COTTAGE_LANE)[0] - 110, arrivalShift);
    this.x = mix(this.x, goalX, 1 - Math.exp(-dt / 105));
    const y = FEET - 28 * arrivalShift;
    if (frame.steps !== this.lastSteps && frame.lastFoot !== null && !this.reducedMotion) {
      this.dust.push({ timeMs: frame.timeMs, at: this.distance, x: this.x, side: frame.lastFoot, seed: frame.steps });
    }
    this.lastSteps = frame.steps;
    while (this.dust.length && frame.timeMs - this.dust[0].timeMs > 640) this.dust.shift();
    if (this.drawGate.isDue(frame.timeMs)) this.draw(frame);
    this.rabbit.update({ x: this.x, y, side: frame.lastFoot, steps: frame.steps, timeMs: frame.timeMs, arrivedMs });
  }

  private scale(depth: number) { return CAMERA_DEPTH / (CAMERA_DEPTH + depth); }

  private project(at: number, lane = 0): Point {
    const s = this.scale(at - this.distance);
    const roadX = curve(at) - curve(this.distance);
    return [MIDPOINT + (lane * LANE_WIDTH + roadX) * s, HORIZON + (FEET - HORIZON) * s];
  }

  private mood() {
    const brook = HOME_STAGES[1].start;
    const night = HOME_STAGES[2].start;
    const from = this.distance < night - 2 ? 0 : 1;
    const target = from === 0 ? brook : night;
    const blend = smooth(this.distance, target - 2, target + 3);
    const base = HOME_PALETTES[from];
    const next = HOME_PALETTES[from + 1];
    const color = {} as HomePalette;
    for (const key of Object.keys(base) as (keyof HomePalette)[]) {
      color[key] = blendColor(base[key], next[key], blend);
    }
    return { from, blend, color };
  }

  private draw(frame: HomeJourneyFrame) {
    const ctx = this.texture.context;
    const mood = this.mood();
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.background(ctx, mood.from, mood.blend, mood.color);
    this.ground(ctx, mood.color);
    this.drawBridges(ctx, frame);
    this.vegetation(ctx, mood.color);
    this.landmarks(ctx, frame);
    this.ambient(ctx, frame);
    const arrivalShift = this.arrivalTime === null ? 0 : smooth(this.time - this.arrivalTime, 60, 1150);
    oval(ctx, '#29283653', this.x + 2, FEET + 2 - 28 * arrivalShift, 59, 11);
    this.texture.refresh();
  }

  private background(ctx: CanvasRenderingContext2D, from: number, blend: number, color: HomePalette) {
    const sky = ctx.createLinearGradient(0, 0, 0, FEET);
    sky.addColorStop(0, color.sky);
    sky.addColorStop(.55, color.horizon);
    sky.addColorStop(1, color.ground);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const parallax = this.reducedMotion ? 0 : Math.sin(this.distance / 6) * 22 - (this.x - MIDPOINT) / 15;
    const art = (index: number, opacity: number) => {
      const plate = this.plates[index];
      if (!plate.naturalWidth || opacity <= 0) return false;
      ctx.globalAlpha = opacity;
      ctx.drawImage(plate, -46 + parallax * .55, -24 + this.distance % 12 / 4, GAME_WIDTH + 92, 842);
      ctx.globalAlpha = 1;
      return true;
    };
    const farArt = art(from, 1);
    const nextArt = art(from + 1, blend);
    if (!farArt && !nextArt) {
      paintGlow(ctx, this.mist, MIDPOINT + parallax, HORIZON - 104, 650, 347, .92);
      for (let layer = 0; layer < 3; layer++) {
        const vertices: Point[] = [[-80, 570]];
        for (let i = 0; i <= 20; i++) {
          const x = i * 88 - 80;
          const height = 44 + Math.sin(i * .58 + layer * 2) * (48 + layer * 4) + grain(i + layer * 17) * 36;
          vertices.push([x + parallax * layer / 3, HORIZON + 29 * layer - height]);
        }
        vertices.push([1680, 570]);
        fillPoly(ctx, layer < 2 ? color.far : color.hill, vertices);
      }
    }
    const night = smooth(this.distance, HOME_STAGES[2].start - 3, HOME_STAGES[2].start + 3);
    if (night > 0) {
      ctx.globalAlpha = night;
      for (let i = 0; i < (this.lowPerformance ? 10 : 30); i++) {
        const x = 42 + grain(i * 49) * 1524 + parallax * .28;
        const y = 33 + grain(i * 83) * 305;
        const radius = 1.2 + grain(i * 23) * 2.1;
        const light = this.reducedMotion ? .8 : .63 + .36 * Math.sin(this.time / 1200 + i * 9);
        paintGlow(ctx, this.mote, x, y, radius * 4, radius * 4, light);
        oval(ctx, '#fff2cb', x, y, radius * .62);
      }
      ctx.globalAlpha = 1;
    }
  }

  private ground(ctx: CanvasRenderingContext2D, color: HomePalette) {
    const grass = ctx.createLinearGradient(0, HORIZON - 52, 0, GAME_HEIGHT);
    grass.addColorStop(0, 'transparent');
    grass.addColorStop(.28, color.ground);
    grass.addColorStop(1, color.grass);
    ctx.fillStyle = grass;
    ctx.fillRect(0, HORIZON - 52, GAME_WIDTH, GAME_HEIGHT - HORIZON + 52);
    const road = ctx.createLinearGradient(0, HORIZON, 0, GAME_HEIGHT);
    road.addColorStop(.09, 'transparent');
    road.addColorStop(.34, color.path);
    road.addColorStop(.68, color.path);
    road.addColorStop(1, color.trail);

    const shoulders: Point[][] = [[], []];
    const roadEdges: Point[][] = [[], []];
    for (let i = 0; i <= 25; i++) {
      const depth = 85 / (1 + i * .64) - 10.5;
      const at = this.distance + depth;
      const width = pathWidth(at);
      shoulders[0].push(this.project(at, -width - .15));
      shoulders[1].push(this.project(at, width + .15));
      roadEdges[0].push(this.project(at, -width));
      roadEdges[1].push(this.project(at, width));
    }
    const edge = ctx.createLinearGradient(0, HORIZON, 0, GAME_HEIGHT);
    edge.addColorStop(.11, 'transparent');
    edge.addColorStop(.3, color.ground);
    edge.addColorStop(1, color.trail);
    fillPoly(ctx, edge, shoulders[0].concat(shoulders[1].reverse()));
    fillPoly(ctx, road, roadEdges[0].concat(roadEdges[1].reverse()));
    const grains = this.lowPerformance ? 4 : 9;
    const bands = this.lowPerformance ? 19 : 32;
    for (let i = 0; i < bands; i++) {
      const base = Math.floor(this.distance - 4) + i;
      for (let j = 0; j < grains; j++) {
        const k = base * 29 + j;
        const at = base + grain(k * 17);
        const depth = this.scale(at - this.distance);
        const lane = (grain(k + 167) - .5) * 4.55;
        const [x, y] = this.project(at, lane);
        const warm = j % 3 ? '#fee5b933' : '#473b4b39';
        const size = (.85 + grain(k + 13) * 5) * depth;
        const offPath = Math.abs(lane) > pathWidth(at);
        oval(ctx, offPath ? color.leaves : warm, x, y, size, size * .33, Math.sin(k * 3) * .6);
      }
    }
  }

  private drawBridges(ctx: CanvasRenderingContext2D, frame: HomeJourneyFrame) {
    for (let i = HOME_GATES.length - 1; i >= 0; i--) {
      const gate = HOME_GATES[i];
      if (gate.at - this.distance > 28 || gate.at - this.distance < -6) continue;
      const active = frame.gate?.at === gate.at;
      const waveTime = this.reducedMotion ? 0 : this.time;
      const near = gate.at - 1.08;
      const far = gate.at + 1.22;
      const riverFar: Point[] = [];
      const riverNear: Point[] = [];
      const bankCurve = (lane: number) => Math.sin(lane * .8 + i * 1.8) * .72
        + Math.sin(lane * 1.47 + i) * .21;
      for (let bank = 0; bank <= 24; bank++) {
        const lane = -8 + bank * 2 / 3;
        const winding = bankCurve(lane);
        riverFar.push(this.project(far + winding, lane));
        riverNear.push(this.project(near + winding, lane));
      }
      const water = ctx.createLinearGradient(0, this.project(far)[1], 0, this.project(near)[1]);
      water.addColorStop(0, '#9cbbba');
      water.addColorStop(.21, '#568f93');
      water.addColorStop(.62, '#38777f');
      water.addColorStop(1, '#b5bcab');
      fillPoly(ctx, water, riverFar.concat(riverNear.slice().reverse()));
      trail(ctx, '#c2d6be9c', 3.5, riverFar);
      trail(ctx, '#b4d5c1a0', 4, riverNear);
      const size = this.scale(gate.at - this.distance);
      const stones = this.lowPerformance ? 13 : 28;
      for (let j = 0; j < stones; j++) {
        const lane = -6.5 + j * 13 / stones + grain(j * 3 + i) * .26;
        if (Math.abs(lane - gate.lane) < .62 || grain(j * 21 + i) > .82) continue;
        const [x, y] = this.project((j % 2 ? near : far) + bankCurve(lane), lane);
        const r = size * (4 + grain(j * 9) * 10);
        oval(ctx, '#365e62aa', x, y + r * .16, r * 1.15, r * .55, -.16);
        oval(ctx, '#91a69b', x, y - r * .12, r, r * .56, -.15);
        oval(ctx, '#ced3af80', x - r * .22, y - r * .24, r * .62, r * .21, -.14);
      }
      const count = this.lowPerformance ? 13 : 34;
      for (let j = 0; j < count; j++) {
        const lane = grain(j * 13 + i * 17) * 13 - 6.5;
        const a = (grain(j * 27 + i * 35) + waveTime / 3600) % 1;
        const [x, y] = this.project(mix(near, far, a) + bankCurve(lane), lane);
        const s = this.scale(gate.at - this.distance);
        const length = 16 + grain(j * 51) * 51;
        const alpha = (j % 3 ? .35 : .67) * Math.sin(Math.PI * a);
        trail(ctx, `rgba(208,242,218,${alpha})`, 1.8 * s, [[x - length * s, y + 3], [x, y], [x + length * s, y + 2]]);
      }
      this.bridge(ctx, gate, near + bankCurve(gate.lane), far + bankCurve(gate.lane), active, frame.blocked);
    }
  }

  private bridge(ctx: CanvasRenderingContext2D, gate: HomeGate, near: number, far: number, active: boolean, blocked: boolean) {
    const center = gate.lane;
    near -= .46;
    far += .48;
    const at = gate.at;
    const width = .49;
    const p = (distance: number, edge: number) => this.project(distance, center + edge);
    const [x, y] = p(at, 0);
    const s = this.scale(at - this.distance);
    if (active) paintGlow(ctx, this.glow, x, y, 150 * s, 73 * s, blocked ? 1 : .76);
    const corners = [p(far, -width), p(far, width), p(near, width), p(near, -width)];
    fillPoly(ctx, '#533b41', corners.map(([px, py]) => [px, py + 8 * s] as Point));
    fillPoly(ctx, '#b6805f', corners);
    const plankCount = 10;
    for (let i = 0; i < plankCount; i++) {
      const a = mix(far, near, i / plankCount);
      const b = mix(far, near, (i + .9) / plankCount);
      fillPoly(ctx, i % 3 ? '#bd8c68' : '#d4a17a', [p(a, -width), p(a, width), p(b, width), p(b, -width)]);
      trail(ctx, '#76564eaa', 1.4 * s, [p(b, -width), p(b, width)]);
      const [gX, gY] = p((a + b) / 2, Math.sin(i * 1.56) * .25);
      oval(ctx, '#936548b0', gX, gY, (7 + i % 3 * 3) * s, 1.2 * s, -.12);
    }
    for (const edge of [-width, width]) {
      const posts: Point[] = [];
      for (let i = 0; i < 3; i++) {
        const [px, py] = p(mix(far, near, i / 2), edge);
        const top: Point = [px, py - 34 * s];
        trail(ctx, '#65434a', 9 * s, [[px, py + 5 * s], top]);
        trail(ctx, active ? '#f0bf86' : '#ab7557', 3.1 * s, [[px - 1 * s, py + 2 * s], [top[0] - 1 * s, top[1]]]);
        posts.push(top);
      }
      trail(ctx, '#79544a', 6 * s, posts);
      trail(ctx, active ? '#ffcf83' : '#ac7d65', 2.9 * s, posts);
    }
    if (active && at - this.distance < 12) {
      const pulse = this.reducedMotion ? 1 : .84 + Math.sin(this.time / 260) * .16;
      for (let i = 0; i < 3; i++) {
        const [px, py] = p(near - .75 - i * 1.09, 0);
        const spread = (20 + i * 3) * s;
        ctx.globalAlpha = (1 - i * .19) * pulse;
        trail(ctx, '#56464cb4', 12 * s, [[px - spread, py + 6 * s], [px, py - 4 * s], [px + spread, py + 6 * s]]);
        trail(ctx, '#ffe59e', 6.6 * s, [[px - spread, py + 6 * s], [px, py - 4 * s], [px + spread, py + 6 * s]]);
      }
      ctx.globalAlpha = 1;
    }
  }

  private vegetation(ctx: CanvasRenderingContext2D, palette: HomePalette) {
    const woodland = (far: boolean) => {
      for (const tree of this.grove) {
        const depth = tree.at - this.distance;
        if (tree.far !== far || depth < -5.1 || depth > 49) continue;
        if (this.lowPerformance && far && tree.index % 2) continue;
        if (HOME_GATES.some(gate => Math.abs(gate.at - tree.at) < 1.8)) continue;
        const pushedBack = far ? tree.at + 1.6 : tree.at;
        const [x, y] = this.project(pushedBack, tree.lane);
        const s = this.scale(pushedBack - this.distance) * tree.size;
        if (x < -205 * s || x > GAME_WIDTH + 205 * s) continue;
        const softFade = smooth(depth, -5.1, -3.65) * (1 - smooth(depth, 35, 49));
        ctx.globalAlpha = softFade * (far ? .42 : .91);
        if (!far) oval(ctx, '#25243353', x, y, 90 * s, 15 * s);
        ctx.drawImage(this.trees[tree.index], x - 200 * s, y - 503 * s, 400 * s, 510 * s);
      }
      ctx.globalAlpha = 1;
    };
    woodland(true);
    woodland(false);
    const count = this.lowPerformance ? 13 : 22;
    for (let i = count; i >= 0; i--) {
      const at = Math.floor(this.distance - 4) + i * 1.68;
      if (HOME_GATES.some(gate => Math.abs(gate.at - at) < 2.1)) continue;
      const s = this.scale(at - this.distance);
      for (const side of [-1, 1]) {
        const k = at * 7 + side * 167;
        const lane = side * (1.91 + grain(k) * 1.55);
        const [x, y] = this.project(at, lane);
        tuft(ctx, x, y, s * (.62 + grain(k + 101) * 1.38), k, palette);
        if (!this.lowPerformance && grain(k + 69) < .37) {
          const stem = 18 * s;
          const capX = x + 36 * s;
          trail(ctx, '#f0bb9da0', 3.5 * s, [[capX, y], [capX + 1 * s, y - stem]]);
          oval(ctx, '#d68b8f', capX, y - stem, 9 * s, 5 * s, -.11);
          oval(ctx, '#ffba9d', capX - 3 * s, y - stem - 1 * s, 1.6 * s);
        }
      }
    }
  }

  private landmarks(ctx: CanvasRenderingContext2D, frame: HomeJourneyFrame) {
    for (let i = HOME_LANTERNS.length - 1; i >= 0; i--) {
      const at = HOME_LANTERNS[i];
      const depth = at - this.distance;
      if (depth > 23 || depth < -4.6) continue;
      const [x, y] = this.project(at, i % 2 ? -1.81 : 1.83);
      ctx.globalAlpha = smooth(depth, -4.6, -3.8);
      const shimmer = this.reducedMotion ? 0 : Math.sin(this.time / 460 + i);
      lantern(ctx, x, y, this.scale(depth), i < frame.lanterns, this.glow, shimmer);
      ctx.globalAlpha = 1;
    }
    if (this.distance < HOME_STAGES[2].start - 7) return;
    const s = this.scale(COTTAGE_AT - this.distance) * 1.31;
    const [x, y] = this.project(COTTAGE_AT, COTTAGE_LANE);
    const open = this.arrivalTime === null ? 0 : smooth(this.time - this.arrivalTime, 190, 1230);
    const fade = smooth(this.distance, HOME_STAGES[2].start - 7, HOME_STAGES[2].start + 2);
    ctx.globalAlpha = fade;
    for (let i = 0; i < 5; i++) {
      const t = (i + 1) / 6;
      const [px, py] = this.project(mix(COTTAGE_AT, HOME_END - 4, t), COTTAGE_LANE * (1 - t * t * .79));
      const stepSize = s * (15 + t * 12);
      oval(ctx, '#4b444f9c', px + 3 * s, py + 3 * s, stepSize, s * (5 + t * 3), -.1);
      oval(ctx, '#9f9294', px, py, stepSize, s * (4 + t * 3), -.1);
    }
    cottage(ctx, x, y, s, open, this.glow, this.time, this.reducedMotion);
    ctx.globalAlpha = 1;
  }

  private ambient(ctx: CanvasRenderingContext2D, frame: HomeJourneyFrame) {
    const fireflies = this.lowPerformance ? 9 : 21;
    const clock = this.reducedMotion ? 0 : this.time;
    for (let i = 0; i < fireflies; i++) {
      const phase = i * 17.17;
      const left = i % 2 === 0;
      const depth = 2 + grain(i * 81) * 25;
      const float = Math.sin(clock / 1530 + phase);
      const lane = (left ? -1 : 1) * (i < 4 ? .42 + i * .18 : 1.93 + grain(i * 113) * 2.44);
      const [x, floor] = this.project(this.distance + depth, lane + .16 * float);
      const s = this.scale(depth);
      const y = floor - (68 + grain(i * 941) * 220) * s + 16 * Math.sin(clock / 1140 + phase);
      const alpha = this.reducedMotion ? .6 : .25 + .75 * Math.max(0, Math.sin(this.time / (520 + i * 13) + phase));
      const radius = (2.6 + s * 2) * (i < 4 ? 1.25 : .9);
      paintGlow(ctx, this.mote, x, y, radius * 6.5, radius * 6.5, alpha * .92);
      ctx.globalAlpha = alpha;
      oval(ctx, '#ffecb0', x, y, radius * .73, radius * .45, float);
      if (i < 4 && !this.reducedMotion) {
        oval(ctx, '#fff3b6', x - 9 * float - 4, y - 4, 1.7);
        oval(ctx, '#fff3b6', x - 17 * float - 8, y - 7, .95);
      }
    }
    ctx.globalAlpha = 1;

    if (!this.reducedMotion) {
      const leaves = this.lowPerformance ? 5 : 12;
      for (let i = 0; i < leaves; i++) {
        const cycle = (this.time / (6700 + i * 283) + grain(i * 42)) % 1;
        const pos = grain(i * 39);
        const x = 130 + pos * 1340 + Math.sin(cycle * TAU + i) * (31 + 51 * pos);
        const y = 71 + cycle * 675 + grain(i * 21) * 112;
        const size = 3 + pos * 7.6;
        const tilt = cycle * .7 + Math.sin(cycle * TAU * 1.5 + pos * 5.2);
        ctx.globalAlpha = Math.pow(Math.sin(Math.PI * cycle), .64) * .65;
        oval(ctx, i % 2 === 0 ? '#d89176' : '#dbbd86', x, y, size, size * .39, tilt);
        trail(ctx, '#eac59690', 1.15, [[x - size * Math.cos(tilt), y - size * Math.sin(tilt)], [x, y]]);
      }
      ctx.globalAlpha = 1;
    }

    for (const dust of this.dust) {
      const age = (this.time - dust.timeMs) / 640;
      const sign = dust.side === 'left' ? -1 : 1;
      const scroll = Math.max(0, this.distance - dust.at);
      const count = this.lowPerformance ? 4 : 8;
      for (let j = 0; j < count; j++) {
        const k = dust.seed * 91 + j;
        const x = dust.x + sign * 22 + (grain(k) - .5) * age * 104;
        const y = FEET + scroll * 20 - 38 * (grain(k + 332) + .31) * age;
        ctx.globalAlpha = .8 * (1 - age) ** 2;
        oval(ctx, j % 3 ? '#f4ba92' : '#ffffc6', x, y, (2 + grain(k + 33) * 3.8) * (1 + .6 * age));
      }
    }
    ctx.globalAlpha = 1;
    const arrivedMs = this.arrivalTime === null ? null : this.time - this.arrivalTime;
    if (arrivedMs !== null && arrivedMs < 4300) {
      if (this.reducedMotion) {
        paintGlow(ctx, this.ripple, MIDPOINT + 160, 485, 124, 130, .38);
        return;
      }
      const r = clamp(arrivedMs / 3500);
      const count = this.lowPerformance ? 10 : 22;
      for (let j = 0; j < count; j++) {
        const life = .73 + grain(j * 67) * .28;
        const alpha = Math.sin(Math.PI * clamp(r / life));
        const lx = MIDPOINT + 10 + (.3 + r) * (grain(j * 38) - .5) * 770;
        const ly = FEET - Math.sin(r * Math.PI * .92) * (117 + grain(j * 19) * 335);
        const size = 1.8 + grain(j * 93) * 4.8;
        paintGlow(ctx, this.mote, lx, ly, size * 4, size * 4, alpha * .65);
        ctx.globalAlpha = alpha;
        fillPoly(ctx, j % 2 ? '#ffdea4' : '#f4c6dd', [[lx, ly - size * 1.6], [lx + size, ly], [lx, ly + size * 1.6], [lx - size, ly]]);
      }
      ctx.globalAlpha = 1;
    }
    if (frame.moving) paintGlow(ctx, this.mote, this.x, FEET + 8, 83, 27, .23);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rabbit.destroy();
    this.image.destroy();
    this.scene.textures.remove(this.key);
  }
}

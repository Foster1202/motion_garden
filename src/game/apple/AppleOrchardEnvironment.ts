import {
  BackSide, CatmullRomCurve3, CircleGeometry, CylinderGeometry, Group, InstancedMesh, LatheGeometry,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RingGeometry,
  SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { APPLE_CONFIG, appleZoneBounds, type AppleSide, type AppleZone } from './appleConfig';

export const ORCHARD_PIXELS_PER_UNIT = 125;
export const ORCHARD_X_TRAVEL = 5.55;

type Placement = readonly [x: number, y: number, z: number, sx: number, sy: number, sz: number];

interface TargetMarker {
  root: Group;
  edge: MeshBasicMaterial;
  gold: MeshBasicMaterial;
}

export interface AppleTreeArt {
  root: Group;
  reachableApples: Group[];
  highAppleCount: number;
  zoneMarker: TargetMarker;
  crownMarker: TargetMarker;
}

const sphere = () => new SphereGeometry(1, 21, 14);
const paint = (color: number, roughness = .85) => new MeshStandardMaterial({ color, roughness });

function ellipsoid(root: Object3D, geometry: SphereGeometry, material: MeshStandardMaterial, placement: Placement) {
  const [x, y, z, sx, sy, sz] = placement;
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  root.add(mesh);
  return mesh;
}

function scatter(root: Object3D, geometry: SphereGeometry, material: MeshStandardMaterial, shapes: Placement[]) {
  const mesh = new InstancedMesh(geometry, material, shapes.length);
  const transform = new Object3D();
  for (const [index, shape] of shapes.entries()) {
    const [x, y, z, sx, sy, sz] = shape;
    transform.position.set(x, y, z);
    transform.scale.set(sx, sy, sz);
    transform.rotation.set(0, index * 1.7, Math.sin(index * 2.3) * .34);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }
  root.add(mesh);
}

function tube(root: Object3D, material: MeshStandardMaterial, radius: number, coords: readonly (readonly number[])[]) {
  const curve = new CatmullRomCurve3(coords.map(coord => new Vector3().fromArray(coord)));
  const mesh = new Mesh(new TubeGeometry(curve, 14, radius, 7, false), material);
  root.add(mesh);
}

function taperedWood(root: Object3D, material: MeshStandardMaterial,
  start: Vector3, end: Vector3, base: number, tip = base * .67) {
  const direction = end.clone().sub(start);
  const piece = new Mesh(new CylinderGeometry(tip, base, direction.length() + .08, 10), material);
  piece.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  piece.position.copy(start).lerp(end, .5);
  root.add(piece);
}

class AppleArt {
  private readonly fruit: LatheGeometry;
  private readonly skin = paint(0xd43729, .35);
  private readonly stalk = new CylinderGeometry(.011, .016, .104, 7);
  private readonly bark = paint(0x805032);
  private readonly leaf = paint(0x6ba347, .54);

  constructor(private readonly ball: SphereGeometry) {
    const profile = [
      [0, -.106], [.05, -.123], [.096, -.096], [.126, -.040], [.144, .033],
      [.143, .087], [.116, .130], [.075, .143], [.04, .134], [0, .117],
    ];
    this.fruit = new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 24);
    const vertices = this.fruit.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
      const lobes = Math.cos(Math.atan2(x, z) * 5);
      const bulge = 1 + .045 * lobes;
      vertices.setXYZ(i, x * bulge, y + .008 * lobes * Math.min(1, Math.hypot(x, z) * 16), z * bulge);
    }
    this.fruit.computeVertexNormals();
  }

  create() {
    const apple = new Group();
    apple.add(new Mesh(this.fruit, this.skin));
    const stem = new Mesh(this.stalk, this.bark);
    stem.position.set(.012, .165, 0);
    stem.rotation.z = -.22;
    apple.add(stem);
    const leaf = ellipsoid(apple, this.ball, this.leaf, [.062, .181, .017, .082, .027, .041]);
    leaf.rotation.z = .42;
    return apple;
  }
}

function groundEllipse(root: Object3D, geometry: CircleGeometry | RingGeometry, material: MeshBasicMaterial,
  x: number, y: number, z: number, width: number, depth: number) {
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.scale.set(width, depth, 1);
  root.add(mesh);
  return mesh;
}

function targetMarker(parent: Group, silhouette = false): TargetMarker {
  const options = { transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    ...(silhouette ? { side: BackSide } : {}) };
  const root = new Group();
  root.visible = false;
  parent.add(root);
  return {
    root,
    edge: new MeshBasicMaterial({ ...options, color: 0x734511 }),
    gold: new MeshBasicMaterial({ ...options, color: 0xffdf55 }),
  };
}

function buildZoneMarker(parent: Group, zone: AppleZone, edge: RingGeometry, stripe: RingGeometry, depth: number) {
  const marker = targetMarker(parent);
  const { minX, maxX } = appleZoneBounds(zone);
  const center = (minX + maxX) / 2 * ORCHARD_X_TRAVEL;
  const radius = (maxX - minX) / 2 * ORCHARD_X_TRAVEL;
  marker.root.position.set(center - parent.position.x, 0, -parent.position.z);
  groundEllipse(marker.root, edge, marker.edge, 0, -.025, 0, radius, depth).renderOrder = 1;
  groundEllipse(marker.root, stripe, marker.gold, 0, -.022, 0, radius, depth).renderOrder = 2;
  return marker;
}

function buildLandscape(root: Group, ball: SphereGeometry, disk: CircleGeometry) {
  const sky = new Mesh(new PlaneGeometry(30, 18), new MeshBasicMaterial({ color: 0xc6e8ee }));
  sky.position.set(0, 2, -24);
  root.add(sky);
  const clouds = paint(0xf1faf4);
  for (const [x, y, scale] of [[-4.37, 1.79, .91], [.7, 1.91, .64], [5.26, 1.53, .85]]) {
    for (const [dx, dy, sx, sy] of [[-.47, .02, .52, .18], [-.16, .13, .33, .3],
      [.19, .16, .40, .38], [.45, .03, .52, .22], [.01, -.08, .61, .15]]) {
      ellipsoid(root, ball, clouds, [x + dx * scale, y + dy * scale, -21.5, sx * scale, sy * scale, .38]);
    }
  }
  const hills = new SphereGeometry(1, 40, 28);
  scatter(root, hills, paint(0xb1cfaa), [
    [-5.5, -.18, -19.5, 4.6, 1.2, 2.44], [-.3, -.42, -19.8, 4.7, 1.14, 2.5], [5.9, -.12, -19.4, 4.6, 1.1, 2.5],
  ]);
  scatter(root, hills, paint(0xaad2ab), [
    [-8.5, -.65, -16.6, 6.95, 2.9, 2.8], [-1.5, -1.62, -18.5, 7.2, 3.28, 2.5],
    [6.3, -.42, -17.1, 6.6, 2.32, 2.5],
  ]);
  scatter(root, hills, paint(0x93be8b), [
    [-6.3, -.98, -13.4, 5.3, 2.38, 2.25], [3.55, -1.6, -14.3, 6.4, 2.95, 2.25],
    [8.6, -1.4, -12.8, 4.9, 2.85, 2.25],
  ]);
  const land = new Mesh(new PlaneGeometry(40, 36), paint(0x9abb6f));
  land.rotation.x = -Math.PI / 2;
  land.position.set(0, -.078, -8);
  root.add(land);
  groundEllipse(root, disk, new MeshBasicMaterial({ color: 0xd6ca8c }), -.07, -.059, -.55, 6.21, 7.7);
  groundEllipse(root, disk, new MeshBasicMaterial({ color: 0xe9d5a4 }), 0, -.054, -.4, 5.94, 7.4);
  groundEllipse(root, disk, new MeshBasicMaterial({ color: 0xf0deac }), 0, -.05, -.1, 5.13, 6.62);

  const undergrowth = [
    [-5.8, .16, -7.2, .9, .75, .85], [-4.8, .03, -7.31, .67, .59, .73], [-3.4, .1, -8.59, 1.28, .62, .68],
    [-.4, .08, -8.28, 1.2, .54, .78], [1.48, .17, -9.2, 1.2, .62, .63],
    [3.05, .15, -7.9, 1.18, .63, .73], [4.68, .17, -7.4, .89, .68, .6], [5.75, .12, -7.12, 1.1, .63, .7],
  ] satisfies Placement[];
  scatter(root, ball, paint(0x83a66a), undergrowth);

  const timber = paint(0xd2a675);
  for (const side of [-1, 1]) {
    const railX = side * 4.52;
    const railStart = new Vector3(railX - 1.75, .48, -5.76), railEnd = new Vector3(railX + 1.75, .48, -5.76);
    taperedWood(root, timber, railStart, railEnd, .058, .058);
    railStart.y = railEnd.y = .22;
    taperedWood(root, timber, railStart, railEnd, .049, .05);
    for (let i = 0; i < 4; i++) {
      const x = railX - 1.68 + i * 1.12;
      taperedWood(root, timber, new Vector3(x, -.02, -5.73), new Vector3(x, .67, -5.73), .08, .067);
    }
  }

  const stones: Placement[] = [];
  const sandFlecks: Placement[] = [];
  const bushes: Placement[] = [];
  const leaves: Placement[] = [];
  const meadowPetals: Placement[] = [];
  const centers: Placement[] = [];
  for (let i = 0; i < 37; i++) {
    const angle = i * 2.399963;
    const x = Math.cos(angle) * (3.9 + .11 * (i % 12));
    const z = -4.9 + (i % 13) * .78;
    stones.push([x, -.035, z, .031 + i % 3 * .019, .025, .054 + i % 4 * .013]);
    sandFlecks.push([Math.cos(angle + .1) * (1 + (i % 11) * .32), -.036, z, .024 + i % 3 * .008, .006, .036]);
  }
  for (const bank of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const x = bank * (4.43 + (i * .49 % 1.93));
      const z = 4.31 + (i * .79 % 2.38);
      const height = .15 + (i % 4) * .048;
      const stemX = x + bank * .035;
      bushes.push([x, -.006, z, .16 + i % 3 * .051, .16, .24]);
      leaves.push([x - .065, height * .6, z, .08, height * .4, .038],
        [x + .09, height * .51, z - .035, .084, height * .28, .05]);
      centers.push([stemX, height + .073, z, .042, .044, .04]);
      for (let p = 0; p < 5; p++) {
        const a = p * Math.PI * .4;
        meadowPetals.push([
          stemX + Math.sin(a) * .065, height + .066 + Math.cos(a) * .064, z -.029, .057, .049, .038,
        ]);
      }
    }
  }
  scatter(root, ball, paint(0xb8a484), stones);
  scatter(root, ball, paint(0xe0c595), sandFlecks);
  scatter(root, ball, paint(0x789d50), bushes);
  scatter(root, ball, paint(0x699649), leaves);
  scatter(root, ball, paint(0xfff5cc), meadowPetals);
  scatter(root, ball, paint(0xf4b755), centers);
}

function buildTree(parent: Group, side: AppleSide, ball: SphereGeometry, disk: CircleGeometry,
  edge: RingGeometry, stripe: RingGeometry, apples: AppleArt): AppleTreeArt {
  const sign = side === 'left' ? -1 : 1;
  const x = APPLE_CONFIG.zones[side].center * ORCHARD_X_TRAVEL;
  const art = new Group();
  art.position.x = x;
  parent.add(art);
  const shadow = new MeshBasicMaterial({ color: 0x93794a, transparent: true, opacity: .17, depthWrite: false });
  groundEllipse(art, disk, shadow, 0, -.039, -1.14, 1.12, .84);
  const zoneMarker = buildZoneMarker(art, side, edge, stripe, 1.63);

  const crown = new Group();
  art.add(crown);
  const crownMarker = targetMarker(crown, true);
  const wood = paint(0x9a6541);
  const lip = paint(0xaf7952);
  const knot = paint(0x6e462f);
  const barkZ = -1.47;
  const trunkBase = new Vector3(sign * .42, 0, barkZ);
  const trunkJoint = new Vector3(sign * .26, 1.62, barkZ - .12);
  taperedWood(art, wood, trunkBase, trunkJoint, .34, .236);
  taperedWood(art, wood, trunkJoint, new Vector3(sign * .45, 3.15, barkZ -.35), .24, .14);
  for (const [dx, dz] of [[-.48, .09], [.17, .42], [.57, -.18]]) {
    taperedWood(art, wood, new Vector3(trunkBase.x, .21, barkZ), new Vector3(trunkBase.x + dx, .04, barkZ + dz), .16, .035);
  }
  for (const dx of [-.12, .05, .14]) {
    const x0 = trunkBase.x + dx;
    tube(art, lip, .012, [[x0 + .01, .18, barkZ + .28], [x0 - .04, .36, barkZ + .321],
      [x0 - .04, .70, barkZ + .271], [x0 - .12, 1.39, barkZ + .173]]);
  }
  const trunkKnot = ellipsoid(art, ball, knot, [trunkBase.x + .06, .91, barkZ + .234, .047, .097, .025]);
  trunkKnot.rotation.z = -.25 * sign;
  for (const [dx, y, z] of [[-1.18, 2.25, -.68], [1.04, 2.18, -.71], [-.2, 2.9, -1.2]]) {
    taperedWood(art, wood, trunkJoint, new Vector3(dx, y, z), .122, .061);
  }

  const foliage = [paint(0x598b43), paint(0x75a047), paint(0x8ab74e), paint(0x98bd5b)];
  const lobes: Placement[] = [
    [.20 * sign, 2.98, -1.64, 1.36, 1.03, .89], [-.8, 2.71, -1.36, .94, .69, .68],
    [1.03, 2.79, -1.24, .76, .67, .69], [-1.22, 3.19, -1.62, .72, .68, .62],
    [.96 * sign, 3.49, -1.86, .87, .76, .72], [-.54 * sign, 3.67, -1.82, .91, .76, .68],
    [.08, 3.23, -.99, .90, .86, .56], [-.69, 3.27, -.89, .60, .57, .47],
    [1.43, 2.52, -1.18, .44, .48, .5], [-1.38, 2.41, -1.05, .48, .5, .48],
    [.65, 2.34, -.92, .60, .42, .54], [-.52, 2.33, -.93, .60, .42, .55],
  ];
  for (const [index, placement] of lobes.entries()) {
    const lobe = ellipsoid(crown, ball, foliage[index % foliage.length], placement);
    for (const [material, expansion, order] of [[crownMarker.edge, .105, 1], [crownMarker.gold, .078, 2]] as const) {
      const shell = new Mesh(ball, material);
      shell.position.copy(lobe.position);
      shell.scale.copy(lobe.scale).addScalar(expansion);
      shell.renderOrder = order;
      crownMarker.root.add(shell);
    }
  }
  const accents: Placement[] = [];
  for (let i = 0; i < 39; i++) {
    const lobe = lobes[i % lobes.length];
    const a = i * 2.399963;
    const dx = Math.cos(a) * .59, dy = Math.sin(a) * .54;
    accents.push([lobe[0] + dx * lobe[3], lobe[1] + dy * lobe[4],
      lobe[2] + lobe[5] * Math.sqrt(1 - dx ** 2 - dy ** 2) - .025, .11 + i % 3 * .026, .065, .052]);
  }
  scatter(crown, ball, paint(0x9bbf57), accents);

  const high = [
    [-1.25, 3.15, -.95], [-.87, 2.67, -.7], [-.95, 3.5, -.93], [-.39, 3.97, -1.44],
    [-.31, 2.91, -.46], [.11, 3.51, -.40], [.43, 2.48, -.43], [.44, 3.95, -1.16],
    [.87, 3.22, -.57], [1.4, 2.76, -.7],
  ];
  for (const [index, [px, py, pz]] of high.entries()) {
    const apple = apples.create();
    const x = px * (side === 'left' ? 1 : -1);
    const y = py + sign * .055 * Math.sin(index);
    let front = pz;
    for (const [cx, cy, cz, sx, sy, sz] of lobes) {
      const distance = ((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2;
      if (distance <= 1) front = Math.max(front, cz + sz * Math.sqrt(1 - distance) + .078);
    }
    apple.position.set(x, y, front);
    apple.rotation.z = Math.sin(index * 2.4) * .34;
    apple.scale.setScalar(.94 + index % 4 * .06);
    art.add(apple);
  }

  const twigMaterial = paint(0xb98251);
  const lowLeaves = paint(0x7ea34a);
  const lowRow = [-1.59, -1.20, -.82, -.41, .02, .43, .83, 1.22, 1.61, -sign * 2.10];
  const reachableApples = lowRow.map((offset, index) => {
    const y = 1.08 + .115 * Math.sin(index * 2.24);
    const z = -.33 + (index % 3) * .066;
    const twig = new Vector3(offset, y + .20, z - .07);
    const bend = new Vector3(offset * .73, 1.52 + index % 2 * .17, -.55);
    const start = new Vector3(sign * .24, 1.62 + Math.abs(offset) * .12, barkZ -.08);
    taperedWood(art, wood, start, bend, .036, .025);
    taperedWood(art, twigMaterial, bend, twig, .026, .012);
    const leaf = ellipsoid(art, ball, lowLeaves, [twig.x + .07, twig.y + .04, twig.z + .03, .15, .047, .083]);
    leaf.rotation.z = Math.sin(index * 2.1) * .74;
    const apple = apples.create();
    apple.position.set(offset, y, z);
    apple.rotation.z = Math.sin(index * 2.21) * .245;
    apple.scale.setScalar(.91 + index % 4 * .048);
    art.add(apple);
    return apple;
  });
  return { root: art, reachableApples, highAppleCount: high.length, zoneMarker, crownMarker };
}

function buildBasket(parent: Group, disk: CircleGeometry, edge: RingGeometry, stripe: RingGeometry) {
  const basket = new Group();
  const z = 1.22;
  basket.position.set(0, 0, z);
  parent.add(basket);
  groundEllipse(basket, disk, new MeshBasicMaterial({ color: 0x997743, transparent: true, opacity: .24, depthWrite: false }),
    0, -.032, .03, .75, .64);
  const zoneMarker = buildZoneMarker(basket, 'basket', edge, stripe, 2.32);

  const darkWicker = paint(0xa77243);
  const wicker = paint(0xcf9b5b);
  const lightWicker = paint(0xe7b875);
  const inside = paint(0x865f3c);
  const profile = [[0, .054], [.40, .061], [.53, .143], [.64, .45], [.64, .49],
    [.58, .49], [.55, .40], [.47, .192], [.38, .133], [0, .13]];
  const bowl = new Mesh(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 48), darkWicker);
  basket.add(bowl);
  const floor = new Mesh(new CircleGeometry(.398, 32), inside);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = .135;
  basket.add(floor);
  for (let i = 0; i < 7; i++) {
    const loop = new Mesh(new TorusGeometry(.456 + i * .0292, .024 + (i % 2) * .005, 8, 48), i % 2 ? wicker : lightWicker);
    loop.position.y = .101 + i * .059;
    loop.rotation.x = -Math.PI / 2;
    basket.add(loop);
  }
  for (let i = 0; i < 29; i++) {
    const a = Math.PI * 2 * i / 29;
    const radial = [Math.cos(a), Math.sin(a)];
    const points = [0, 1, 2, 3, 4, 5].map(j => {
      const radius = .454 + j * .038 + (j % 2) * .018;
      const weave = (i % 2 ? .033 : -.033) * (j % 2 ? 1 : -1);
      return [radial[0] * radius + radial[1] * weave, .104 + j * .073,
        radial[1] * radius - radial[0] * weave];
    });
    tube(basket, i % 2 ? wicker : darkWicker, .019, points);
  }
  const rim = new Mesh(new TorusGeometry(.623, .056, 10, 56), lightWicker);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = .486;
  basket.add(rim);
  const handle = [[-.58, .43, -.221], [-.53, .70, -.27], [-.37, .915, -.305], [0, 1.015, -.32],
    [.37, .915, -.305], [.53, .70, -.27], [.58, .43, -.221]];
  tube(basket, darkWicker, .055, handle);
  tube(basket, wicker, .025, handle.map(([x, y, hz]) => [x, y + .032, hz + .034]));
  return { zoneMarker, dropPoint: new Vector3(0, .45, z + .07), root: basket };
}

export class AppleOrchardEnvironment {
  readonly root = new Group();
  readonly trees: Record<AppleSide, AppleTreeArt>;
  readonly basket: ReturnType<typeof buildBasket>;
  readonly rabbitShadow: Mesh;
  readonly stores: Group[] = [];
  readonly movingApple: Group;
  private readonly maxGlow = { left: 0, right: 0, basket: 0 };

  constructor() {
    const ball = sphere(), disk = new CircleGeometry(1, 64);
    const edge = new RingGeometry(.70, 1, 64);
    const stripe = new RingGeometry(.77, .94, 64);
    const apples = new AppleArt(ball);
    buildLandscape(this.root, ball, disk);
    this.trees = {
      left: buildTree(this.root, 'left', ball, disk, edge, stripe, apples),
      right: buildTree(this.root, 'right', ball, disk, edge, stripe, apples),
    };
    this.basket = buildBasket(this.root, disk, edge, stripe);
    this.rabbitShadow = groundEllipse(this.root, disk,
      new MeshBasicMaterial({ color: 0xa28454, transparent: true, opacity: .26, depthWrite: false }),
      0, -.018, .02, .70, .65);
    this.movingApple = apples.create();
    this.movingApple.visible = false;
    this.root.add(this.movingApple);
    for (const [index, [x, y, z]] of [[-.31, .421, .13], [-.108, .464, .12], [.14, .421, .14],
      [.34, .431, .059], [.01, .52, -.16], [-.249, .453, -.12], [.26, .47, -.16]].entries()) {
      const apple = apples.create();
      apple.position.set(x, y, z);
      apple.rotation.z = Math.sin(index * 1.74) * .43;
      apple.scale.setScalar(.92);
      apple.visible = false;
      this.stores.push(apple);
      this.basket.root.add(apple);
    }
  }

  highlight(target: AppleZone | null, time: number, dt: number, reducedMotion: boolean) {
    const pulse = reducedMotion ? .96 : .94 + .05 * Math.sin(time * Math.PI * 1.37);
    for (const name of ['left', 'right', 'basket'] as const) {
      const amount = target === name ? 1 : 0;
      this.maxGlow[name] = dt ? MathUtils.lerp(this.maxGlow[name], amount, 1 - Math.exp(-8 * dt)) : amount;
      const marker = name === 'basket' ? this.basket.zoneMarker : this.trees[name].zoneMarker;
      this.setMarkerStrength(marker, this.maxGlow[name], pulse);
      if (name !== 'basket') this.setMarkerStrength(this.trees[name].crownMarker, this.maxGlow[name], pulse);
    }
  }

  private setMarkerStrength(marker: TargetMarker, strength: number, pulse: number) {
    marker.root.visible = strength > .015;
    marker.edge.opacity = strength * .95;
    marker.gold.opacity = strength * pulse;
  }

  showStored(count: number) {
    this.stores.forEach((apple, i) => { apple.visible = i < count; });
  }
}

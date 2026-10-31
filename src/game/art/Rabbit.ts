import Phaser from 'phaser';

export class Rabbit {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container;
  private head: Phaser.GameObjects.Container;
  private arm: Phaser.GameObjects.Ellipse;
  private leftArm: Phaser.GameObjects.Ellipse;
  private face: Phaser.GameObjects.Graphics;
  private baseY: number;

  constructor(private scene: Phaser.Scene, x: number, y: number, scale = 1) {
    this.baseY = y;
    this.root = scene.add.container(x, y).setScale(scale);
    const shadow = scene.add.ellipse(3, 5, 210, 36, 0x54754a, .18);
    const footA = scene.add.ellipse(-50, -8, 87, 39, 0xfffbef).setStrokeStyle(3, 0xdedbcc);
    const footB = scene.add.ellipse(55, -8, 87, 39, 0xfffbef).setStrokeStyle(3, 0xdedbcc);
    this.body = scene.add.container(0, -98);
    const tail = scene.add.circle(-87, 27, 29, 0xfffbef).setStrokeStyle(3, 0xdedbcc);
    const torso = scene.add.ellipse(0, 0, 172, 191, 0xfffbef).setStrokeStyle(3, 0xdedbcc);
    const dungarees = scene.add.graphics();
    dungarees.fillStyle(0x749781).fillRoundedRect(-76, -8, 152, 95, 36);
    dungarees.fillRoundedRect(-46, -47, 92, 96, 18);
    dungarees.fillStyle(0x4f7965).fillRoundedRect(-24, 5, 48, 38, 9);
    dungarees.lineStyle(2, 0xb4c6a8).strokeRoundedRect(-24, 5, 48, 38, 9);
    dungarees.fillStyle(0xf0d28d).fillCircle(-30, -24, 6).fillCircle(30, -24, 6);
    this.leftArm = scene.add.ellipse(-74, -33, 42, 99, 0xfffbef).setStrokeStyle(3, 0xdedbcc).setAngle(22);
    this.arm = scene.add.ellipse(76, -31, 43, 100, 0xfffbef).setStrokeStyle(3, 0xdedbcc).setAngle(-24);
    this.body.add([tail, torso, dungarees, this.leftArm, this.arm]);
    this.head = scene.add.container(0, -208);
    const earA = scene.add.ellipse(-43, -110, 48, 151, 0xfffbef).setStrokeStyle(3, 0xdedbcc).setAngle(-12);
    const earB = scene.add.ellipse(42, -113, 48, 158, 0xfffbef).setStrokeStyle(3, 0xdedbcc).setAngle(13);
    const innerA = scene.add.ellipse(-43, -113, 23, 108, 0xe9b5a5).setAngle(-12);
    const innerB = scene.add.ellipse(42, -116, 23, 111, 0xe9b5a5).setAngle(13);
    const head = scene.add.ellipse(0, -6, 202, 164, 0xfffbef).setStrokeStyle(3, 0xdedbcc);
    const cheekA = scene.add.ellipse(-64, 17, 32, 20, 0xefc1af, .65);
    const cheekB = scene.add.ellipse(64, 17, 32, 20, 0xefc1af, .65);
    this.face = scene.add.graphics();
    const scarf = scene.add.graphics().fillStyle(0xd88a68);
    scarf.fillRoundedRect(-54, 64, 108, 21, 10).fillTriangle(33, 74, 77, 109, 36, 110);
    this.head.add([earA, earB, innerA, innerB, head, cheekA, cheekB, this.face, scarf]);
    this.root.add([shadow, footA, footB, this.body, this.head]);
    this.setHappy(false);
  }

  setPose(bend: number, time: number, reducedMotion = false) {
    const breath = reducedMotion ? 0 : Math.sin(time / 720) * 3;
    this.root.y = this.baseY + breath;
    this.body.setPosition(bend * 18, -98 + bend * 30).setScale(1 + bend * .025, 1 - bend * .13);
    this.head.setPosition(bend * 36, -208 + bend * 66).setAngle(bend * 9);
    this.arm.setPosition(76 + bend * 21, -31 + bend * 15).setAngle(-24 - bend * 28);
    this.leftArm.setAngle(22 - bend * 16);
  }

  setHappy(happy: boolean) {
    const f = this.face.clear().lineStyle(4, 0x3c5142);
    if (happy) {
      f.beginPath().arc(-37, -5, 10, Math.PI, 2 * Math.PI).strokePath();
      f.beginPath().arc(37, -5, 10, Math.PI, 2 * Math.PI).strokePath();
    } else {
      f.fillStyle(0x3c5142).fillEllipse(-37, -6, 10, 16).fillEllipse(37, -6, 10, 16);
      f.fillStyle(0xffffff).fillCircle(-35, -9, 2).fillCircle(39, -9, 2);
    }
    f.fillStyle(0xd98c78).fillTriangle(-7, 12, 7, 12, 0, 19);
    f.lineStyle(2.5, 0x6b6751).beginPath().moveTo(0, 19).lineTo(0, 26).strokePath();
    f.beginPath().arc(-7, 25, 7, 0, Math.PI).strokePath();
    f.beginPath().arc(7, 25, 7, 0, Math.PI).strokePath();
  }
}

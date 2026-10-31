import Phaser from 'phaser';
import { AmbientLight, DirectionalLight, HemisphereLight, NeutralToneMapping, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { Rabbit3D } from '../3d/Rabbit3D';
import { RabbitFootTracker } from '../3d/RabbitFootTracker';
import { BERRY_CONFIG as C } from './berryConfig';
export class BerryRabbitView {
  readonly camera = new OrthographicCamera();
  readonly world = new Scene();
  readonly renderer: WebGLRenderer;
  readonly tracker: RabbitFootTracker;
  readonly maxTravel: number;
  rootX = 800;
  fps = 0;
  private frames = 0;
  private elapsed = 0;
  private readonly key = `berry-rabbit-${crypto.randomUUID()}`;
  private readonly texture!: Phaser.Textures.CanvasTexture;
  private readonly image!: Phaser.GameObjects.Image;
  private disposed = false;
  private readonly lost: (event: Event) => void;
  constructor(private readonly scene: Phaser.Scene, readonly rabbit: Rabbit3D, failure: () => void) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    try {
    this.renderer.setPixelRatio(1); this.renderer.setSize(1200, 675); this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = SRGBColorSpace; this.renderer.toneMapping = NeutralToneMapping;
    const p = rabbit.pixelsPerUnit;
    Object.assign(this.camera, { left: -800 / p, right: 800 / p, top: C.feetY / p,
      bottom: (C.feetY - 900) / p, near: .1, far: 50 });
    this.camera.position.set(0, 0, 12); this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
    rabbit.pivot.scale.x = -1;
    this.world.add(rabbit.pivot, new AmbientLight(0xfffaf2, .5), new HemisphereLight(0xf6fbff, 0xd7d5b3, 1.7));
    const light = new DirectionalLight(0xffe9cc, 2.4); light.position.set(-3, 5, 7); this.world.add(light);
    this.tracker = new RabbitFootTracker(rabbit, this.camera, { x: 0, y: 0, width: 1600, height: 900 });
    const rest = this.tracker.sample().left.x;
    rabbit.rig.setLegExtension('left', 1); rabbit.rig.update(10);
    const extended = this.tracker.sample().left.x;
    rabbit.rig.resetPose(true);
    // Keep the standing foot outside the actual trunk; extension closes half its available reach.
    this.maxTravel = 800 - (C.tree.left + C.tree.width * .045 + (800 - rest) + (rest - extended) * .5);
    this.texture = scene.textures.createCanvas(this.key, 1200, 675)!;
    this.image = scene.add.image(0, 0, this.key).setOrigin(0).setDisplaySize(1600, 900).setDepth(5);
    this.lost = event => { event.preventDefault(); failure(); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.lost);
    } catch (error) {
      this.image?.destroy();
      if (scene.textures.exists(this.key)) scene.textures.remove(this.key);
      this.world.clear(); this.renderer.dispose(); this.renderer.forceContextLoss();
      throw error;
    }
  }
  update(dt: number, lateral: number, left: number, right: number) {
    const target = lateral * this.maxTravel;
    const current = this.rabbit.pivot.position.x * this.rabbit.pixelsPerUnit;
    const next = current + (target - current) * (1 - Math.exp(-8 * dt));
    this.rabbit.pivot.position.x = next / this.rabbit.pixelsPerUnit; this.rootX = 800 + next;
    this.rabbit.rig.setLegExtension('left', left); this.rabbit.rig.setLegExtension('right', right);
    this.rabbit.rig.update(dt); this.renderer.render(this.world, this.camera);
    this.texture.context.clearRect(0, 0, 1200, 675); this.texture.context.drawImage(this.renderer.domElement, 0, 0); this.texture.refresh();
    this.elapsed += dt; this.frames++;
    if (this.elapsed >= 1) { this.fps = this.frames / this.elapsed; this.frames = 0; this.elapsed = 0; }
    return this.tracker.sample();
  }
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.renderer.domElement.removeEventListener('webglcontextlost', this.lost);
    this.image.destroy(); this.scene.textures.remove(this.key); this.rabbit.dispose(); this.world.clear();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}

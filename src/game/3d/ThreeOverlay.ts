import { AmbientLight, DirectionalLight, HemisphereLight, OrthographicCamera, Scene, SRGBColorSpace, NeutralToneMapping, WebGLRenderer } from 'three';
import { Rabbit3D } from './Rabbit3D';
import { getThreeRenderSize, LowPerformanceDrawGate } from './threeRenderQuality';

export const RABBIT_VIEWPORT = { x: 634, y: 229, width: 520, height: 520 } as const;
export const CARROT_GRAB_VIEWPORT = { x: 574, y: 119, width: 640, height: 700 } as const;
export const CARROT_GAME_VIEWPORT = { x: 250, y: 100, width: 1300, height: 720 } as const;
export interface ThreeViewport { x: number; y: number; width: number; height: number }
interface ThreeOverlayOptions {
  lowPerformance?: boolean;
  outputSize?: { width: number; height: number };
}
export function rabbitWorldToPhaser(x: number, y: number, pixelsPerUnit: number) {
  return { x: 894 + x * pixelsPerUnit, y: 681 - y * pixelsPerUnit };
}
export function phaserToRabbitWorld(x: number, y: number, pixelsPerUnit: number) {
  return { x: (x - 894) / pixelsPerUnit, y: (681 - y) / pixelsPerUnit };
}

export class ThreeOverlay {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera();
  readonly renderer: WebGLRenderer;
  readonly renderSize: { width: number; height: number };
  renderedFrames = 0;
  fps = 0;
  private elapsed = 0;
  private samples = 0;
  private renderElapsed = 0;
  private destroyed = false;
  private readonly contextLost: (event: Event) => void;
  private readonly drawGate?: LowPerformanceDrawGate;

  constructor(readonly rabbit: Rabbit3D, onFailure: () => void,
    readonly viewport: ThreeViewport = RABBIT_VIEWPORT,
    { lowPerformance = false, outputSize = viewport }: ThreeOverlayOptions = {}) {
    if (lowPerformance) this.drawGate = new LowPerformanceDrawGate();
    this.renderSize = getThreeRenderSize(outputSize, lowPerformance);
    this.renderer = new WebGLRenderer({ alpha: true, antialias: !lowPerformance, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.renderSize.width, this.renderSize.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.dataset.rabbitThree = 'true';
    const p = rabbit.pixelsPerUnit;
    this.camera.left = (viewport.x - 894) / p;
    this.camera.right = (viewport.x + viewport.width - 894) / p;
    this.camera.top = (681 - viewport.y) / p;
    this.camera.bottom = (681 - viewport.y - viewport.height) / p;
    this.camera.near = .1; this.camera.far = 50;
    this.camera.position.set(0, 0, 12); this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.scene.add(rabbit.pivot, new AmbientLight(0xffffff, .35), new HemisphereLight(0xfff6e8, 0xb3c3ad, 2));
    const key = new DirectionalLight(0xffefd7, 2.2);
    key.position.set(-3, 5, 7); this.scene.add(key);
    this.contextLost = event => { event.preventDefault(); onFailure(); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
  }

  render(deltaSeconds: number, afterPose?: (deltaSeconds: number) => void) {
    if (this.destroyed || document.hidden) return false;
    this.rabbit.rig.update(deltaSeconds);
    afterPose?.(deltaSeconds);
    if (this.destroyed) return false;
    this.elapsed += deltaSeconds;
    if (this.drawGate) {
      if (!this.drawGate.isDue()) return false;
    } else {
      this.renderElapsed += deltaSeconds;
      if (this.renderElapsed < 1 / 60) return false;
      this.renderElapsed %= 1 / 60;
    }
    this.renderer.render(this.scene, this.camera);
    this.renderedFrames++;
    this.samples++;
    if (this.elapsed >= 1) { this.fps = this.samples / this.elapsed; this.elapsed = 0; this.samples = 0; }
    return true;
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.rabbit.dispose();
    this.scene.clear();
    this.renderer.dispose();
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

import { Camera, Vector3 } from 'three';
import type { Rabbit3D } from './Rabbit3D';

export interface LogicalViewport { x: number; y: number; width: number; height: number }
export interface ProjectedFoot { x: number; y: number; visible: boolean }

/** Projection uses logical render bounds, never CSS pixels or device pixel ratio. */
export function projectToLogical(world: Vector3, camera: Camera, viewport: LogicalViewport): ProjectedFoot {
  camera.updateWorldMatrix(true, false);
  const view = world.clone().applyMatrix4(camera.matrixWorldInverse);
  const ndc = world.clone().project(camera);
  const finite = [ndc.x, ndc.y, ndc.z, viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite);
  return {
    x: viewport.x + (ndc.x + 1) * viewport.width / 2,
    y: viewport.y + (1 - ndc.y) * viewport.height / 2,
    visible: finite && viewport.width > 0 && viewport.height > 0 && view.z < 0
      && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1,
  };
}

export class RabbitFootTracker {
  constructor(private readonly rabbit: Rabbit3D, private readonly camera: Camera, public viewport: LogicalViewport) {}

  sample(): { left: ProjectedFoot; right: ProjectedFoot } {
    this.rabbit.pivot.updateWorldMatrix(true, true);
    const foot = (side: 'L' | 'R') => projectToLogical(
      this.rabbit.rig.bones.get(`foot.${side}`)!.getWorldPosition(new Vector3()), this.camera, this.viewport,
    );
    return { left: foot('L'), right: foot('R') };
  }
}

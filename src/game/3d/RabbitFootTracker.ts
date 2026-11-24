import { Camera, SkinnedMesh, Vector3 } from 'three';
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

type PawVertex = { mesh: SkinnedMesh; index: number };
type Side = 'L' | 'R';

export class RabbitFootTracker {
  private paws?: Record<Side, PawVertex | undefined>;

  constructor(private readonly rabbit: Rabbit3D, private readonly camera: Camera, public viewport: LogicalViewport) {}

  samplePaws(): { left: ProjectedFoot; right: ProjectedFoot } {
    // Attached skins need their updated inverse bind matrices even on skipped draw frames.
    this.rabbit.pivot.updateMatrixWorld(true);
    this.paws ??= { L: this.findOuterPaw('L'), R: this.findOuterPaw('R') };
    const point = new Vector3();
    const paw = (side: Side) => {
      const vertex = this.paws![side];
      const world = vertex ? vertex.mesh.getVertexPosition(vertex.index, point).applyMatrix4(vertex.mesh.matrixWorld)
        : this.rabbit.rig.bones.get(`foot.${side}`)!.getWorldPosition(point);
      return projectToLogical(world, this.camera, this.viewport);
    };
    return { left: paw('L'), right: paw('R') };
  }

  private findOuterPaw(side: Side): PawVertex | undefined {
    const foot = this.rabbit.rig.bones.get(`foot.${side}`)!;
    const outward = side === 'L' ? 1 : -1;
    const point = new Vector3();
    let best: PawVertex | undefined;
    let edge = -Infinity;
    this.rabbit.model.traverse(object => {
      if (!(object instanceof SkinnedMesh)) return;
      const footIndex = object.skeleton.bones.indexOf(foot);
      if (footIndex < 0) return;
      const { skinIndex, skinWeight } = object.geometry.attributes;
      for (let index = 0; index < skinIndex.count; index++) {
        // Exclude nearby shin vertices that only have a minor foot influence.
        let footWeight = 0;
        for (let joint = 0; joint < 4; joint++) {
          if (skinIndex.getComponent(index, joint) === footIndex) footWeight += skinWeight.getComponent(index, joint);
        }
        if (footWeight < .5) continue;
        object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld);
        const x = this.rabbit.pivot.worldToLocal(point).x * outward;
        if (x > edge) { edge = x; best = { mesh: object, index }; }
      }
    });
    return best;
  }

  sample(): { left: ProjectedFoot; right: ProjectedFoot } {
    this.rabbit.pivot.updateWorldMatrix(true, true);
    const foot = (side: 'L' | 'R') => projectToLogical(
      this.rabbit.rig.bones.get(`foot.${side}`)!.getWorldPosition(new Vector3()), this.camera, this.viewport,
    );
    return { left: foot('L'), right: foot('R') };
  }
}

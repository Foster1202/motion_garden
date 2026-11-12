import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeModel } from './Rabbit3D';

const finiteVector = (value: Vector3) => value.toArray().every(Number.isFinite) && Number.isFinite(value.lengthSq());
const finiteQuaternion = (value: Quaternion) => value.toArray().every(Number.isFinite)
  && Number.isFinite(value.lengthSq()) && value.lengthSq() > 1e-12;

/** An independent asset with an explicit local grip and parent-aware world placement. */
export class Carrot3D {
  readonly root = new Group();
  readonly grip: Object3D;
  readonly bounds: Box3;
  private readonly localGrip = new Vector3();
  private disposed = false;

  constructor(readonly model: Object3D) {
    this.root.name = 'Carrot3D';
    this.root.add(model);
    this.root.updateWorldMatrix(true, true);
    const grip = model.getObjectByName('Carrot_Grip_Point');
    if (!grip) throw new Error('Carrot GLB is missing Carrot_Grip_Point');
    this.grip = grip;
    this.localGrip.copy(this.root.worldToLocal(grip.getWorldPosition(new Vector3())));
    this.bounds = new Box3().setFromObject(model, true);
    const size = this.bounds.getSize(new Vector3());
    if (!finiteVector(size) || size.lengthSq() < 1e-12 || !finiteVector(this.localGrip)) {
      throw new Error('Carrot GLB has invalid geometry or grip');
    }
  }

  static async load(url: string, signal: AbortSignal): Promise<Carrot3D> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Carrot GLB HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    if (signal.aborted) {
      disposeModel(gltf.scene);
      throw new DOMException('Aborted', 'AbortError');
    }
    try { return new Carrot3D(gltf.scene); }
    catch (error) { disposeModel(gltf.scene); throw error; }
  }

  gripWorld(target = new Vector3()): Vector3 {
    this.root.updateWorldMatrix(true, true);
    return this.grip.getWorldPosition(target);
  }

  setScale(scale: number): boolean {
    if (this.disposed || !Number.isFinite(scale * scale) || scale <= 0) return false;
    this.root.matrixAutoUpdate = true;
    this.root.scale.setScalar(scale);
    this.root.updateWorldMatrix(true, true);
    return true;
  }

  setPosition(position: Vector3): boolean {
    if (this.disposed || !finiteVector(position)) return false;
    this.root.position.copy(position);
    if (!this.root.matrixAutoUpdate) {
      this.root.matrix.setPosition(position);
      this.root.matrixWorldNeedsUpdate = true;
    }
    this.root.updateWorldMatrix(true, true);
    return true;
  }

  setRotation(rotation: Quaternion): boolean {
    if (this.disposed || !finiteQuaternion(rotation)) return false;
    this.root.matrixAutoUpdate = true;
    this.root.quaternion.copy(rotation).normalize();
    this.root.updateWorldMatrix(true, true);
    return true;
  }

  setGripWorld(position: Vector3, rotation: Quaternion): boolean {
    if (this.disposed || !finiteVector(position) || !finiteQuaternion(rotation)
      || !finiteVector(this.root.scale) || this.root.scale.toArray().some(value => Math.abs(value) < 1e-12)) return false;
    const parent = this.root.parent;
    parent?.updateWorldMatrix(true, false);
    if (parent && (!Number.isFinite(parent.matrixWorld.determinant()) || Math.abs(parent.matrixWorld.determinant()) < 1e-12)) return false;
    this.root.updateWorldMatrix(true, false);
    const worldScale = this.root.getWorldScale(new Vector3());
    const worldRotation = rotation.clone().normalize();
    const offset = this.localGrip.clone().multiply(worldScale).applyQuaternion(worldRotation);
    const localMatrix = new Matrix4().compose(position.clone().sub(offset), worldRotation, worldScale);
    if (parent) localMatrix.premultiply(parent.matrixWorld.clone().invert());
    const localPosition = new Vector3(), localRotation = new Quaternion(), localScale = new Vector3();
    localMatrix.decompose(localPosition, localRotation, localScale);
    if (!finiteVector(localPosition) || !finiteQuaternion(localRotation) || !finiteVector(localScale)
      || !localMatrix.elements.every(Number.isFinite)) return false;
    const composed = new Matrix4().compose(localPosition, localRotation, localScale);
    // Nonuniform ancestors can require shear to preserve the requested world rotation.
    this.root.matrixAutoUpdate = localMatrix.elements.every((value, index) => Math.abs(value - composed.elements[index]) < 1e-10);
    this.root.position.copy(localPosition);
    this.root.quaternion.copy(localRotation).normalize();
    this.root.scale.copy(localScale);
    this.root.matrix.copy(localMatrix);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.updateWorldMatrix(true, true);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeModel(this.model);
    this.root.removeFromParent();
  }
}

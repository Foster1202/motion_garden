import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { Carrot3D } from '../Carrot3D';
import type { HandGripSample, RabbitHandTracker } from './RabbitHandTracker';

export type CarrotGrabState = 'IDLE' | 'NEAR_TARGET' | 'GRABBING' | 'ATTACHED' | 'RELEASING' | 'RELEASED';

export interface CarrotAttachmentOptions {
  initialGripPosition?: Vector3;
  initialQuaternion?: Quaternion;
  allowDistanceBypass?: boolean;
  handMode?: 'midpoint' | 'left' | 'right';
  maximumHandDistance?: number;
}

/** Owns only the carrot; all arm and body transforms remain with the rabbit rig. */
export class CarrotAttachmentController {
  state: CarrotGrabState = 'IDLE';
  reason = '請將雙手移近蘿蔔握點';
  readonly transitionSeconds = .2;
  readonly maxHandDistance: number;
  private readonly initialPosition: Vector3;
  private readonly initialRotation: Quaternion;
  private readonly initialScale: Vector3;
  private readonly initialMatrix: Matrix4;
  private readonly initialMatrixAutoUpdate: boolean;
  private readonly startPosition = new Vector3();
  private readonly startRotation = new Quaternion();
  private readonly targetRotation = new Quaternion();
  private transitionElapsed = 0;
  private paused = false;
  private disposed = false;
  private distanceLimitEnabled = true;
  private reliable = true;
  private hands?: HandGripSample;
  private leftDistance = 0;
  private rightDistance = 0;
  private attachmentError = 0;
  private eligible = false;
  private contactSatisfied = false;
  private transformValid = false;

  constructor(readonly carrot: Carrot3D, readonly tracker: RabbitHandTracker,
    private readonly options: CarrotAttachmentOptions = {}) {
    const distance = options.maximumHandDistance ?? tracker.palmRadius * 1.6;
    if (!Number.isFinite(distance) || distance <= 0) throw new Error('Invalid carrot grip distance');
    if (options.initialGripPosition) carrot.setGripWorld(options.initialGripPosition, options.initialQuaternion ?? new Quaternion());
    this.initialPosition = carrot.root.position.clone();
    this.initialRotation = carrot.root.quaternion.clone();
    this.initialScale = carrot.root.scale.clone();
    this.initialMatrix = carrot.root.matrix.clone();
    this.initialMatrixAutoUpdate = carrot.root.matrixAutoUpdate;
    this.maxHandDistance = distance;
  }

  setDistanceLimitEnabled(enabled: boolean): boolean {
    if (this.disposed || this.paused) return false;
    if (!enabled && !this.options.allowDistanceBypass) return false;
    this.distanceLimitEnabled = enabled;
    return true;
  }

  update(deltaSeconds: number, reliable = this.reliable): void {
    if (this.disposed || this.paused || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    this.reliable = reliable;
    this.measure();
    if (!this.hands?.valid || !this.transformValid) return;
    if (this.state === 'RELEASING') {
      this.state = 'RELEASED';
      return;
    }
    if (this.state === 'GRABBING' || this.state === 'ATTACHED') {
      this.holdingRotation(this.hands, this.targetRotation);
      const target = this.attachmentTarget(this.hands);
      if (this.state === 'GRABBING') {
        this.transitionElapsed = Math.min(this.transitionSeconds, this.transitionElapsed + Math.min(deltaSeconds, .05));
        const progress = this.transitionElapsed / this.transitionSeconds;
        const smooth = progress * progress * (3 - 2 * progress);
        const position = this.startPosition.clone().lerp(target, smooth);
        const rotation = this.startRotation.clone().slerp(this.targetRotation, smooth);
        this.carrot.setGripWorld(position, rotation);
        if (progress >= 1) this.state = 'ATTACHED';
      } else this.carrot.setGripWorld(target, this.targetRotation);
      this.attachmentError = this.carrot.gripWorld().distanceTo(target);
      this.updateGripDistances();
      this.reason = '等候追蹤恢復，保留抓取並隨阿兔平滑回復';
      if (reliable) this.reason = this.contactSatisfied ? '蘿蔔跟隨最終手部姿態' : '開發附著跟隨中，雙手仍未接觸握點';
      return;
    }
    if (this.state === 'IDLE' || this.state === 'NEAR_TARGET') this.state = this.eligible ? 'NEAR_TARGET' : 'IDLE';
  }

  grab(): { ok: boolean; reason: string } {
    if (this.disposed || this.paused) return { ok: false, reason: this.paused ? '暫停期間不能抓取' : '抓取控制器已關閉' };
    if (this.state === 'GRABBING' || this.state === 'ATTACHED') return { ok: false, reason: '已經抓住蘿蔔' };
    this.measure();
    if (!this.eligible) return { ok: false, reason: this.reason };
    this.startPosition.copy(this.carrot.gripWorld());
    this.startRotation.copy(this.carrot.root.getWorldQuaternion(new Quaternion()));
    this.transitionElapsed = 0;
    this.state = 'GRABBING';
    this.reason = '正在對齊雙手握點';
    return { ok: true, reason: this.reason };
  }

  release(): boolean {
    if (this.disposed || this.paused || (this.state !== 'GRABBING' && this.state !== 'ATTACHED')) return false;
    this.state = 'RELEASING';
    this.reason = '已放開，蘿蔔保留最後位置';
    return true;
  }

  reset(): void {
    if (this.disposed || this.paused) return;
    this.carrot.root.position.copy(this.initialPosition);
    this.carrot.root.quaternion.copy(this.initialRotation);
    this.carrot.root.scale.copy(this.initialScale);
    this.carrot.root.matrix.copy(this.initialMatrix);
    this.carrot.root.matrixAutoUpdate = this.initialMatrixAutoUpdate;
    this.carrot.root.matrixWorldNeedsUpdate = true;
    this.carrot.root.updateWorldMatrix(true, true);
    this.transitionElapsed = 0;
    this.attachmentError = 0;
    this.eligible = false;
    this.updateGripDistances();
    this.state = 'IDLE';
    this.reason = '蘿蔔已重設';
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  snapshot() {
    return {
      state: this.state, reason: this.reason, eligible: this.eligible,
      contactSatisfied: this.contactSatisfied,
      handMode: this.options.handMode ?? 'midpoint',
      leftHandPosition: this.hands?.leftGripPosition.toArray(), rightHandPosition: this.hands?.rightGripPosition.toArray(),
      gripMidpoint: this.hands?.gripMidpoint.toArray(), carrotGripPosition: this.carrot.gripWorld().toArray(),
      leftDistance: this.leftDistance, rightDistance: this.rightDistance, grabDistance: this.requiredDistance(),
      maxHandDistance: this.maxHandDistance * (this.hands?.scale ?? 1), handSpan: this.hands?.span,
      attachmentError: this.attachmentError, transitionElapsed: this.transitionElapsed, reliable: this.hands?.reliable ?? false,
      distanceLimitEnabled: this.distanceLimitEnabled, distanceBypassAllowed: !!this.options.allowDistanceBypass,
      owner: this.state === 'GRABBING' || this.state === 'ATTACHED' ? 'Rabbit final-bone hand attachment' : 'Carrot world transform',
      paused: this.paused, disposed: this.disposed,
    };
  }

  dispose(): void { this.disposed = true; this.hands = undefined; }

  private measure(): void {
    this.hands = this.tracker.sample(this.reliable);
    this.eligible = false;
    this.contactSatisfied = false;
    this.transformValid = false;
    if (!this.hands.valid) { this.reason = '手部座標無效，保留最後蘿蔔位置'; return; }
    const grip = this.carrot.gripWorld();
    const determinant = this.carrot.root.matrixWorld.determinant();
    if (!grip.toArray().every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0) {
      this.reason = '蘿蔔握點無效，請重設蘿蔔';
      return;
    }
    this.transformValid = true;
    this.updateGripDistances();
    if (!this.hands.reliable) { this.reason = '雙手追蹤未可靠，請稍候或使用手動骨骼測試'; return; }
    const distance = this.maxHandDistance * this.hands.scale;
    if (this.distanceLimitEnabled && this.requiredDistance() > distance) {
      this.reason = `雙手距離過遠，左 ${this.leftDistance.toFixed(3)}、右 ${this.rightDistance.toFixed(3)}，上限 ${distance.toFixed(3)} 模型單位`;
      return;
    }
    this.eligible = true;
    this.reason = this.distanceLimitEnabled ? '雙手已接近，可以抓住蘿蔔' : '開發距離限制已停用';
  }

  private updateGripDistances(): void {
    if (!this.hands?.valid) { this.contactSatisfied = false; return; }
    const grip = this.carrot.gripWorld();
    this.leftDistance = this.hands.leftGripPosition.distanceTo(grip);
    this.rightDistance = this.hands.rightGripPosition.distanceTo(grip);
    this.contactSatisfied = Number.isFinite(this.leftDistance) && Number.isFinite(this.rightDistance)
      && this.requiredDistance() <= this.maxHandDistance * this.hands.scale;
  }

  private requiredDistance(): number {
    if (this.options.handMode === 'left') return this.leftDistance;
    if (this.options.handMode === 'right') return this.rightDistance;
    return Math.max(this.leftDistance, this.rightDistance);
  }

  private attachmentTarget(hands: HandGripSample): Vector3 {
    if (this.options.handMode === 'left') return hands.leftGripPosition;
    if (this.options.handMode === 'right') return hands.rightGripPosition;
    return hands.gripMidpoint;
  }

  private holdingRotation(hands: HandGripSample, target: Quaternion): void {
    if (this.options.handMode === 'left' || this.options.handMode === 'right') {
      target.copy(this.options.initialQuaternion ?? new Quaternion());
      return;
    }
    const line = hands.leftGripPosition.clone().sub(hands.rightGripPosition);
    if (line.lengthSq() < 1e-12) return;
    const roll = MathUtils.clamp(Math.atan2(line.y, Math.abs(line.x) + 1e-8), -Math.PI / 7.2, Math.PI / 7.2);
    const yaw = MathUtils.clamp(-Math.atan2(line.z, Math.abs(line.x) + 1e-8), -Math.PI / 9, Math.PI / 9);
    target.setFromEuler(new Euler(0, yaw, roll, 'YXZ')).normalize();
  }
}

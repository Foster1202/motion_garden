import { MathUtils, Quaternion, Vector3 } from 'three';
import type { RabbitPose } from '../../mocap/RabbitPose';
import type { RoundState } from '../../systems/CarrotRound';
import type { Rabbit3D } from '../Rabbit3D';
import type { Carrot3D } from '../Carrot3D';
import { CarrotAttachmentController } from '../interaction/CarrotAttachmentController';
import type { RabbitHandTracker } from '../interaction/RabbitHandTracker';
import { CARROT_GAME_CONFIG as CONFIG } from './carrotGameConfig';

export type CarrotGamePhase = 'PLANTED' | 'REACHING' | 'ALIGNING' | 'ATTACHED'
  | 'LIFTING' | 'TRANSFERRING' | 'HARVESTED' | 'COMPLETE' | 'UNAVAILABLE';

export interface CarrotPull3DOptions {
  basketTarget: Vector3;
  onHarvestComplete: () => void;
  onAssistanceUnavailable?: (reason: string) => void;
}

/** Translates round state into visual ownership; the scene retains all score authority. */
export class CarrotPull3DCoordinator {
  readonly plantedGrip: Vector3;
  readonly soilWorldY: number;
  readonly attachment: CarrotAttachmentController;
  private roundState: RoundState = 'READY';
  private phase: CarrotGamePhase = 'PLANTED';
  private pullProgress = 0;
  private reachElapsed = 0;
  private transferElapsed = 0;
  private grabBend = 1;
  private reachSource?: { raise: number; elbow: number; plane: number };
  private currentArm = { raise: 0, elbow: 0, plane: 0 };
  private releaseArm = { raise: 0, elbow: 0, plane: 0 };
  private readonly transferStart = new Vector3();
  private readonly transferRotation = new Quaternion();
  private readonly previousGrip = new Vector3();
  private readonly bodyRestRotation: Quaternion;
  private readonly basketTarget: Vector3;
  private paused = false;
  private trackingReliable = true;
  private disposed = false;
  private harvestSent = false;
  private harvestCallbacks = 0;
  private soilOcclusion = true;
  private reachBlocked = false;
  private maximumVisualStep = 0;
  private maximumAttachStep = 0;
  private readonly originalTargetDistance: number;
  private readonly originalShoulderDistance: number;
  private readonly plantedShoulderDistance: number;
  private readonly plantedWristDistance: number;
  private readonly maximumArmReach: number;
  private contactDistanceAtGrab?: number;

  constructor(private readonly rabbit: Rabbit3D, private readonly carrot: Carrot3D,
    private readonly tracker: RabbitHandTracker, private readonly options: CarrotPull3DOptions) {
    if (rabbit.rig.version !== 'v3') throw new Error('3D carrot gameplay requires the V3 rabbit rig');
    if (!options.basketTarget.toArray().every(Number.isFinite)) throw new Error('Invalid basket target');
    this.basketTarget = options.basketTarget.clone();
    const rig = rabbit.rig;
    rabbit.model.updateWorldMatrix(true, true);
    this.bodyRestRotation = rabbit.model.getWorldQuaternion(new Quaternion()).invert()
      .multiply(rig.bones.get('body')!.getWorldQuaternion(new Quaternion()));
    const point = (name: 'upper_arm.L' | 'forearm.L' | 'hand.L') =>
      rabbit.model.worldToLocal(rig.bones.get(name)!.getWorldPosition(new Vector3()));
    this.maximumArmReach = point('upper_arm.L').distanceTo(point('forearm.L')) + point('forearm.L').distanceTo(point('hand.L'));
    const originalTarget = new Vector3(0, 13 / rabbit.pixelsPerUnit, .65);
    this.originalTargetDistance = tracker.sample().leftGripPosition.distanceTo(originalTarget);
    this.originalShoulderDistance = rig.bones.get('upper_arm.L')!.getWorldPosition(new Vector3()).distanceTo(originalTarget);
    rig.setArmInwardEnabled(true);
    rig.setIKEnabled(true);
    rig.resetPose(true);
    rig.setArmRotation('left', CONFIG.reach.raise, CONFIG.reach.elbow, CONFIG.reach.plane);
    rig.setKneeBend(1);
    for (let frame = 0; frame < 120; frame++) rig.update(1 / 60);
    this.plantedGrip = tracker.sample().leftGripPosition.clone();
    const plantedShoulder = rig.bones.get('upper_arm.L')!.getWorldPosition(new Vector3());
    this.plantedShoulderDistance = plantedShoulder.distanceTo(this.plantedGrip);
    this.plantedWristDistance = plantedShoulder.distanceTo(rig.bones.get('hand.L')!.getWorldPosition(new Vector3()));
    this.soilWorldY = this.plantedGrip.y - CONFIG.soilBelowGrip;
    rig.resetPose(true);
    carrot.setScale(CONFIG.carrotScale);
    this.attachment = new CarrotAttachmentController(carrot, tracker, {
      initialGripPosition: this.plantedGrip, handMode: 'left', maximumHandDistance: CONFIG.maximumAlignmentDistance,
    });
    carrot.setSoilClippingHeight(this.soilWorldY);
    this.previousGrip.copy(carrot.gripWorld());
  }

  get canAdvanceRound(): boolean {
    if (this.frozen || this.roundState === 'COMPLETE') return false;
    const requiresGrip = this.roundState === 'GRABBED' || this.roundState === 'RETURNING';
    return !requiresGrip || this.phase === 'ATTACHED';
  }

  get frozen(): boolean { return this.disposed || this.paused || !this.trackingReliable; }

  onRoundState(state: RoundState): void {
    if (this.disposed || state === this.roundState) return;
    this.roundState = state;
    if (state === 'READY' || state === 'NEXT_ROUND') { this.resetPlant(); return; }
    const requiresGrip = state === 'GRABBED' || state === 'RETURNING' || state === 'SUCCESS';
    if (requiresGrip && (this.phase === 'PLANTED' || this.phase === 'HARVESTED')) {
      this.phase = 'REACHING';
      this.reachElapsed = 0;
      this.reachSource = undefined;
      return;
    }
    if (state === 'SUCCESS' && !this.harvestSent && this.phase === 'ATTACHED') this.phase = 'LIFTING';
    if (state === 'COMPLETE') {
      this.phase = 'COMPLETE';
      this.attachment.release();
      this.carrot.root.visible = false;
      this.soilOcclusion = false;
      this.carrot.setSoilClippingHeight(null);
      this.rabbit.rig.clearHandTarget('left');
    }
  }

  /** Mocap stages its pose first; this hook changes only the primary arm request. */
  preparePose(deltaSeconds: number, bendAmount: number, sourcePose?: RabbitPose, roundProgress = 0): void {
    if (this.frozen || !Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(bendAmount)) return;
    const step = Math.min(deltaSeconds, .05);
    const source = {
      raise: finite(sourcePose?.leftArmElevation), elbow: finite(sourcePose?.leftElbowBend),
      plane: finite(sourcePose?.leftArmPlane),
    };
    if (this.phase === 'PLANTED' || this.phase === 'HARVESTED' || this.phase === 'COMPLETE' || this.phase === 'UNAVAILABLE') return;
    if (this.phase === 'TRANSFERRING') {
      this.transferElapsed = Math.min(CONFIG.transferSeconds, this.transferElapsed + step);
      const blend = smooth(this.transferElapsed / CONFIG.returnArmSeconds);
      this.stageArm({ raise: MathUtils.lerp(this.releaseArm.raise, source.raise, blend),
        elbow: MathUtils.lerp(this.releaseArm.elbow, source.elbow, blend),
        plane: MathUtils.lerp(this.releaseArm.plane, source.plane, blend) });
      return;
    }
    if (!this.reachSource) {
      this.reachSource = source;
      this.grabBend = Math.max(.2, MathUtils.clamp(bendAmount, 0, 1));
    }
    if (this.phase === 'REACHING') {
      this.reachElapsed += step;
      const blend = smooth(this.reachElapsed / CONFIG.reachSeconds);
      this.stageArm({ raise: MathUtils.lerp(this.reachSource.raise, CONFIG.reach.raise, blend),
        elbow: MathUtils.lerp(this.reachSource.elbow, CONFIG.reach.elbow, blend),
        plane: MathUtils.lerp(this.reachSource.plane, CONFIG.reach.plane, blend) });
      if (this.reachBlocked) this.stageContactTarget();
      return;
    }
    const visualReturn = MathUtils.clamp(1 - bendAmount / this.grabBend, 0, 1);
    const stableReturn = this.roundState === 'RETURNING' ? MathUtils.clamp(finite(roundProgress), 0, 1) : 0;
    const desiredPull = this.roundState === 'SUCCESS' ? 1 : Math.max(visualReturn, stableReturn);
    if (this.phase === 'ATTACHED' || this.phase === 'LIFTING') {
      this.pullProgress = Math.max(this.pullProgress, Math.min(desiredPull, this.pullProgress + step / CONFIG.pullSeconds));
    }
    const progress = this.pullProgress;
    this.stageArm({
      raise: MathUtils.lerp(CONFIG.reach.raise, CONFIG.lift.raise, progress)
        + MathUtils.clamp((source.raise - CONFIG.reach.raise) * .05, -CONFIG.sourceRaiseContribution, CONFIG.sourceRaiseContribution),
      elbow: MathUtils.clamp(source.elbow * .02, 0, 2),
      plane: MathUtils.lerp(CONFIG.reach.plane, CONFIG.lift.plane, progress)
        + MathUtils.clamp((source.plane - CONFIG.reach.plane) * .02, -CONFIG.sourcePlaneContribution, CONFIG.sourcePlaneContribution),
    });
  }

  /** Samples actual committed bones; called before the existing Three renderer. */
  afterPose(deltaSeconds: number): void {
    if (this.frozen || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    if (this.phase === 'COMPLETE') return;
    const step = Math.min(deltaSeconds, .05);
    if (this.phase === 'TRANSFERRING') { this.updateTransfer(); return; }
    this.attachment.update(step, true);
    if (this.phase === 'REACHING' && this.reachElapsed >= CONFIG.reachSeconds) {
      this.reachBlocked = !this.attachment.snapshot().eligible;
      if (!this.reachBlocked && this.attachment.grab().ok) {
        this.contactDistanceAtGrab = this.attachment.snapshot().leftDistance;
        this.phase = 'ALIGNING';
      }
      else if (this.reachElapsed >= CONFIG.reachTimeoutSeconds) {
        this.phase = 'UNAVAILABLE';
        this.rabbit.rig.clearHandTarget('left');
        this.options.onAssistanceUnavailable?.('未能穩定捉住蘿蔔，請使用原有遊戲繼續。');
        return;
      }
    } else if (this.phase === 'ALIGNING' && this.attachment.state === 'ATTACHED') {
      this.phase = this.roundState === 'SUCCESS' ? 'LIFTING' : 'ATTACHED';
      this.reachBlocked = false;
    }
    this.recordStep();
    this.carrot.setSoilClippingHeight(this.soilOcclusion ? this.soilWorldY : null);
    if (this.phase === 'LIFTING' && this.pullProgress >= 1 && this.attachment.snapshot().attachmentError < .01) {
      this.attachment.release();
      this.phase = 'TRANSFERRING';
      this.transferElapsed = 0;
      this.releaseArm = { ...this.currentArm };
      this.transferStart.copy(this.carrot.gripWorld());
      this.transferRotation.copy(this.carrot.root.getWorldQuaternion(new Quaternion()));
      this.soilOcclusion = this.carrotBottom() < this.soilWorldY;
      this.carrot.setSoilClippingHeight(this.soilOcclusion ? this.soilWorldY : null);
    }
  }

  pause(): void { this.paused = true; this.attachment.pause(); }
  resume(): void { this.paused = false; if (this.trackingReliable) this.attachment.resume(); }
  setTrackingReliable(reliable: boolean): void {
    this.trackingReliable = reliable;
    if (this.frozen) this.attachment.pause();
    else this.attachment.resume();
  }

  snapshot() {
    const attachment = this.attachment.snapshot();
    return {
      roundState: this.roundState, phase: this.phase, pullProgress: this.pullProgress,
      reachElapsed: this.reachElapsed, transferElapsed: this.transferElapsed,
      transferProgress: this.transferElapsed / CONFIG.transferSeconds,
      plantedGrip: this.plantedGrip.toArray(), soilWorldY: this.soilWorldY, soilOcclusion: this.soilOcclusion,
      primaryHand: 'left', primaryDistance: attachment.leftDistance, supportDistance: attachment.rightDistance,
      attachment, attachmentError: attachment.attachmentError, reachBlocked: this.reachBlocked,
      owner: this.phase === 'REACHING' ? 'Mocap body/legs + assisted primary arm'
        : this.phase === 'ALIGNING' || this.phase === 'ATTACHED' || this.phase === 'LIFTING'
          ? 'Mocap body/legs/support arm + bounded primary hold'
          : this.phase === 'TRANSFERRING' && this.transferElapsed < CONFIG.returnArmSeconds
            ? 'Mocap body/legs/support arm + primary return blend' : 'Mocap',
      primaryArmTarget: { ...this.currentArm }, maximumVisualStep: this.maximumVisualStep,
      maximumAttachStep: this.maximumAttachStep, originalTargetDistance: this.originalTargetDistance,
      originalShoulderDistance: this.originalShoulderDistance, plantedShoulderDistance: this.plantedShoulderDistance,
      contactDistanceAtGrab: this.contactDistanceAtGrab,
      alignmentUsed: this.contactDistanceAtGrab !== undefined && this.contactDistanceAtGrab > 1e-6,
      maximumArmReach: this.maximumArmReach, extractionHeight: this.carrot.gripWorld().y - this.plantedGrip.y,
      maximumPalmReach: this.maximumArmReach + this.tracker.HandGripOffset.L.length(),
      plantedWristDistance: this.plantedWristDistance,
      harvestCallbacks: this.harvestCallbacks, trackingReliable: this.trackingReliable,
      paused: this.paused, disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attachment.dispose();
    this.carrot.setSoilClippingHeight(null);
    this.rabbit.rig.clearHandTarget('left');
  }

  private stageArm(pose: { raise: number; elbow: number; plane: number }): void {
    this.currentArm = pose;
    this.rabbit.rig.setArmRotation('left', pose.raise, pose.elbow, pose.plane);
  }

  private stageContactTarget(): void {
    const { model, rig } = this.rabbit;
    model.updateWorldMatrix(true, true);
    const hand = rig.bones.get('hand.L')!;
    const palmOffset = hand.localToWorld(this.tracker.HandGripOffset.L.clone()).sub(hand.getWorldPosition(new Vector3()));
    const desired = model.worldToLocal(this.plantedGrip.clone().sub(palmOffset));
    const shoulder = model.worldToLocal(rig.bones.get('upper_arm.L')!.getWorldPosition(new Vector3()));
    const body = model.getWorldQuaternion(new Quaternion()).invert()
      .multiply(rig.bones.get('body')!.getWorldQuaternion(new Quaternion()));
    const relative = desired.sub(shoulder).applyQuaternion(body.invert()).applyQuaternion(this.bodyRestRotation);
    rig.setHandTarget('left', relative.x, relative.y, relative.z);
  }

  private updateTransfer(): void {
    const progress = smooth(this.transferElapsed / CONFIG.transferSeconds);
    const target = this.transferStart.clone().lerp(this.basketTarget, progress);
    target.y += Math.sin(progress * Math.PI) * CONFIG.basketArcHeight;
    const rotation = this.transferRotation.clone().slerp(new Quaternion(), progress);
    this.carrot.setGripWorld(target, rotation);
    if (this.soilOcclusion && (this.carrotBottom() >= this.soilWorldY
      || Math.abs(target.x - this.plantedGrip.x) > .6)) this.soilOcclusion = false;
    this.carrot.setSoilClippingHeight(this.soilOcclusion ? this.soilWorldY : null);
    this.recordStep();
    if (this.transferElapsed < CONFIG.transferSeconds || this.harvestSent) return;
    this.carrot.root.visible = false;
    this.phase = 'HARVESTED';
    this.harvestSent = true;
    this.harvestCallbacks++;
    this.options.onHarvestComplete();
  }

  private carrotBottom(): number {
    this.carrot.root.updateWorldMatrix(true, true);
    return this.carrot.bounds.clone().applyMatrix4(this.carrot.root.matrixWorld).min.y;
  }

  private recordStep(): void {
    const grip = this.carrot.gripWorld();
    const distance = grip.distanceTo(this.previousGrip);
    this.maximumVisualStep = Math.max(this.maximumVisualStep, distance);
    if (this.phase === 'ALIGNING') this.maximumAttachStep = Math.max(this.maximumAttachStep, distance);
    this.previousGrip.copy(grip);
  }

  private resetPlant(): void {
    this.attachment.resume();
    this.attachment.reset();
    if (this.frozen) this.attachment.pause();
    this.carrot.root.visible = true;
    this.phase = 'PLANTED';
    this.pullProgress = this.reachElapsed = this.transferElapsed = 0;
    this.reachSource = undefined;
    this.harvestSent = false;
    this.reachBlocked = false;
    this.contactDistanceAtGrab = undefined;
    this.soilOcclusion = true;
    this.carrot.setSoilClippingHeight(this.soilWorldY);
    this.previousGrip.copy(this.carrot.gripWorld());
    this.rabbit.rig.clearHandTarget('left');
  }
}

const finite = (value: number | undefined) => Number.isFinite(value) ? value! : 0;
const smooth = (value: number) => {
  const progress = MathUtils.clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
};

import { RABBIT_3D_CONFIG } from '../3d/rabbit3dConfig';
import { MOCAP_CONFIG } from './mocapConfig';
import { neutralRabbitPose, type RabbitPose } from './RabbitPose';

/** Rate limits targets; RabbitRigController owns the only quaternion interpolation. */
export class MotionSmoother {
  private current = neutralRabbitPose();

  get pose(): RabbitPose { return { ...this.current }; }

  reset(pose = neutralRabbitPose()): void {
    this.current = neutralRabbitPose();
    this.update(pose, Number.MAX_SAFE_INTEGER);
  }

  update(target: RabbitPose, deltaSeconds: number): RabbitPose {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return this.pose;
    const limits = RABBIT_3D_CONFIG.limits;
    const rates = MOCAP_CONFIG.slew;
    const move = (key: keyof RabbitPose, min: number, max: number, rate: number) => {
      const requested = target[key];
      if (!Number.isFinite(requested)) return;
      const bounded = Math.max(min, Math.min(max, requested));
      const distance = bounded - this.current[key];
      this.current[key] += Math.sign(distance) * Math.min(Math.abs(distance), rate * deltaSeconds);
    };
    move('leftArmElevation', limits.arm.min, limits.arm.max, rates.armDegreesPerSecond);
    move('rightArmElevation', limits.arm.min, limits.arm.max, rates.armDegreesPerSecond);
    move('leftElbowBend', limits.forearm.min, limits.forearm.max, rates.armDegreesPerSecond);
    move('rightElbowBend', limits.forearm.min, limits.forearm.max, rates.armDegreesPerSecond);
    move('torsoLean', -limits.bodySide, limits.bodySide, rates.bodyDegreesPerSecond);
    move('bendAmount', 0, 1, rates.bendPerSecond);
    move('lateralOffset', -limits.root.x, limits.root.x, rates.rootUnitsPerSecond);
    if (Number.isFinite(target.trackingConfidence)) this.current.trackingConfidence = Math.max(0, Math.min(1, target.trackingConfidence));
    if (Number.isFinite(target.timestampMs)) this.current.timestampMs = target.timestampMs;
    return this.pose;
  }
}

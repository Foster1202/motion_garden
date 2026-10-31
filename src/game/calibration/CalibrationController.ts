import type { PoseSnapshot } from '../vision/poseTypes';
import { CALIBRATION_CONFIG as CONFIG } from './calibrationConfig';
import { calibrationThresholds, interquartileRange, isPlausibleAngle, isStable, median, validateCalibration } from './calibrationMath';
import type { CalibrationProfile, CalibrationSide, CalibrationSnapshot, CalibrationState } from './calibrationTypes';

interface AngleSample { time: number; active: number; left?: number; right?: number }
interface Baseline { active: number; left?: number; right?: number; iqr: number }

export class CalibrationController {
  private state: CalibrationState = 'IDLE';
  private message = '準備設定你舒服嘅活動幅度。';
  private samples: AngleSample[] = [];
  private readySamples: AngleSample[] = [];
  private sampleStarted: number | undefined;
  private stepStarted = 0;
  private lastTimestamp: number | undefined;
  private lastUpdate: number | undefined;
  private side: CalibrationSide | undefined;
  private standing: Baseline | undefined;
  private profile: CalibrationProfile | undefined;
  private failureReason: string | undefined;
  private failedStep: 'standing' | 'bend' = 'standing';
  private bendArmed = false;
  private pausedAt: number | undefined;
  private activeAngle: number | undefined;
  private destroyed = false;

  begin(nowMs: number): CalibrationSnapshot { return this.restart(nowMs); }

  update(pose: PoseSnapshot, nowMs: number): CalibrationSnapshot {
    this.tick(nowMs);
    if (!this.isActive() || this.pausedAt !== undefined || this.destroyed) return this.getSnapshot();
    const timestamp = pose.timestampMs;
    if (!Number.isFinite(nowMs) || !Number.isFinite(timestamp) || timestamp > nowMs
      || nowMs - timestamp > CONFIG.maxDataAgeMs
      || (this.lastTimestamp !== undefined && timestamp <= this.lastTimestamp)) {
      this.interrupt('行後少少，等阿兔睇到你全身。');
      return this.getSnapshot();
    }
    if (this.lastTimestamp !== undefined && timestamp - this.lastTimestamp > CONFIG.maxFrameGapMs) this.interrupt();
    this.lastTimestamp = timestamp;
    this.lastUpdate = nowMs;
    const available = this.availableSide(pose);
    if (!available || !isPlausibleAngle(pose.activeKneeAngle) || !Number.isFinite(pose.confidence) || pose.confidence < CONFIG.confidenceThreshold
      || pose.state === 'UNKNOWN' || pose.state === 'TRACKING_LOST') {
      this.interrupt('行後少少，等阿兔睇到你全身。');
      return this.getSnapshot();
    }
    if (!this.side) this.side = available;
    const sample = this.angleSample(pose, nowMs);
    if (!sample) {
      this.interrupt('行後少少，等阿兔睇到你全身。');
      return this.getSnapshot();
    }
    this.activeAngle = sample.active;
    const bending = this.standing !== undefined;
    if (bending && !this.bendArmed) {
      this.message = '去到你覺得舒服嘅位置就得，唔使蹲低。';
      return this.getSnapshot();
    }
    if (bending && this.standing!.active - sample.active < CONFIG.bendTriggerDrop) {
      this.clearWindow();
      this.state = 'BEND_INSTRUCTIONS';
      this.message = '慢慢屈膝，去到你覺得舒服嘅位置就得。';
      return this.getSnapshot();
    }
    if (this.state === 'STANDING_INSTRUCTIONS' || this.state === 'BEND_INSTRUCTIONS') {
      this.readySamples.push(sample);
      if (this.readySamples.length > CONFIG.maximumSamples) this.readySamples.shift();
      const values = this.readySamples.map(value => value.active);
      if (Math.max(...values) - Math.min(...values) > CONFIG.readyMaximumSpread) {
        this.readySamples = [sample];
        this.message = bending ? '去到舒服嘅位置，再保持一下。' : '企穩少少，再試一次。';
        return this.getSnapshot();
      }
      if (nowMs - this.readySamples[0].time < CONFIG.stableReadyMs) {
        this.message = bending ? '好，就保持呢個位置一下。' : '放鬆企好，唔使刻意用力。';
        return this.getSnapshot();
      }
      this.state = bending ? 'BEND_SAMPLING' : 'STANDING_SAMPLING';
      this.sampleStarted = nowMs;
      this.readySamples = [];
    }
    this.samples.push(sample);
    if (this.samples.length > CONFIG.maximumSamples) this.samples.shift();
    this.message = bending ? '好，就保持呢個位置一下。' : '保持一下…';
    if (this.samples.length >= CONFIG.minimumSamples && nowMs - this.sampleStarted! >= CONFIG.sampleDurationMs) this.finishWindow(nowMs);
    return this.getSnapshot();
  }

  tick(nowMs: number): CalibrationSnapshot {
    if (this.destroyed || this.pausedAt !== undefined || !this.isActive() || !Number.isFinite(nowMs)) return this.getSnapshot();
    if (nowMs - this.stepStarted >= CONFIG.stepTimeoutMs) {
      this.fail('timeout', '未設定到，我哋再試一次。');
    } else if (this.lastUpdate !== undefined && nowMs - this.lastUpdate > CONFIG.maxDataAgeMs) {
      this.interrupt('行後少少，等阿兔睇到你全身。');
    }
    return this.getSnapshot();
  }

  startBending(nowMs: number): CalibrationSnapshot {
    if (!this.destroyed && this.state === 'BEND_INSTRUCTIONS' && this.standing && !this.bendArmed) {
      this.bendArmed = true;
      this.stepStarted = nowMs;
      this.clearWindow();
      this.message = '慢慢屈膝，去到你覺得舒服嘅位置就得。';
    }
    return this.getSnapshot();
  }

  retry(nowMs: number): CalibrationSnapshot {
    if (this.state !== 'FAILED' || this.destroyed) return this.getSnapshot();
    if (this.failedStep === 'standing') return this.restart(nowMs);
    this.state = 'BEND_INSTRUCTIONS';
    this.message = '去到你覺得舒服嘅位置就得，唔使蹲低。';
    this.failureReason = undefined;
    this.bendArmed = false;
    this.profile = undefined;
    this.stepStarted = nowMs;
    this.lastTimestamp = undefined;
    this.lastUpdate = undefined;
    this.clearWindow();
    return this.getSnapshot();
  }

  restart(nowMs: number): CalibrationSnapshot {
    if (this.destroyed) return this.getSnapshot();
    this.state = 'STANDING_INSTRUCTIONS';
    this.message = '放鬆企好，唔使刻意用力。';
    this.clearWindow();
    this.standing = undefined;
    this.side = undefined;
    this.profile = undefined;
    this.failureReason = undefined;
    this.activeAngle = undefined;
    this.bendArmed = false;
    this.pausedAt = undefined;
    this.lastTimestamp = undefined;
    this.lastUpdate = undefined;
    this.stepStarted = nowMs;
    return this.getSnapshot();
  }

  pause(nowMs: number): CalibrationSnapshot {
    if (this.destroyed || this.pausedAt !== undefined) return this.getSnapshot();
    this.pausedAt = nowMs;
    if (this.isActive()) this.interrupt();
    return this.getSnapshot();
  }

  resume(nowMs: number): CalibrationSnapshot {
    if (this.destroyed || this.pausedAt === undefined) return this.getSnapshot();
    this.stepStarted += Math.max(0, nowMs - this.pausedAt);
    this.pausedAt = undefined;
    this.lastTimestamp = undefined;
    this.lastUpdate = undefined;
    return this.getSnapshot();
  }

  destroy(): void {
    this.clearWindow();
    this.standing = undefined;
    this.profile = undefined;
    this.side = undefined;
    this.activeAngle = undefined;
    this.state = 'IDLE';
    this.pausedAt = undefined;
    this.destroyed = true;
  }

  getSnapshot(): CalibrationSnapshot {
    const timeProgress = this.samples.length > 0
      ? (this.samples[this.samples.length - 1].time - this.sampleStarted!) / CONFIG.sampleDurationMs : 0;
    return {
      state: this.state,
      progress: this.state === 'COMPLETE' ? 1 : Math.max(0, Math.min(1, timeProgress, this.samples.length / CONFIG.minimumSamples)),
      message: this.message,
      profile: this.profile ? { ...this.profile } : undefined,
      failureReason: this.failureReason,
      sampleCount: this.samples.length,
      activeAngle: this.activeAngle,
      paused: this.pausedAt !== undefined,
      samplingSide: this.side,
      bendStarted: this.bendArmed,
    };
  }

  private isActive(): boolean {
    return ['STANDING_INSTRUCTIONS', 'STANDING_SAMPLING', 'BEND_INSTRUCTIONS', 'BEND_SAMPLING'].includes(this.state);
  }
  private availableSide(pose: PoseSnapshot): CalibrationSide | undefined {
    const left = isPlausibleAngle(pose.leftKneeAngle);
    const right = isPlausibleAngle(pose.rightKneeAngle);
    if (pose.reliableSides < 1) return undefined;
    if (left && right && pose.reliableSides < 2) return undefined;
    return left && right ? 'both' : left ? 'left' : right ? 'right' : undefined;
  }
  private angleSample(pose: PoseSnapshot, nowMs: number): AngleSample | undefined {
    const left = this.side !== 'right' && isPlausibleAngle(pose.leftKneeAngle) ? pose.leftKneeAngle : undefined;
    const right = this.side !== 'left' && isPlausibleAngle(pose.rightKneeAngle) ? pose.rightKneeAngle : undefined;
    if ((this.side === 'both' && (left === undefined || right === undefined))
      || (this.side === 'left' && left === undefined) || (this.side === 'right' && right === undefined)) return undefined;
    const active = left !== undefined && right !== undefined ? (left + right) / 2 : (left ?? right);
    return active === undefined ? undefined : { time: nowMs, active, left, right };
  }
  private clearWindow(): void {
    this.samples = [];
    this.readySamples = [];
    this.sampleStarted = undefined;
  }
  private interrupt(message?: string): void {
    this.clearWindow();
    this.activeAngle = undefined;
    if (!this.isActive()) return;
    this.state = this.standing ? 'BEND_INSTRUCTIONS' : 'STANDING_INSTRUCTIONS';
    if (!this.standing) this.side = undefined;
    this.message = message ?? (this.standing ? '去到舒服嘅位置，再保持一下。' : '放鬆企好，唔使刻意用力。');
  }
  private stats(samples: AngleSample[]): Baseline {
    const left = samples.flatMap(sample => sample.left === undefined ? [] : [sample.left]);
    const right = samples.flatMap(sample => sample.right === undefined ? [] : [sample.right]);
    const active = samples.map(sample => sample.active);
    return { active: median(active), left: left.length ? median(left) : undefined,
      right: right.length ? median(right) : undefined, iqr: interquartileRange(active) };
  }
  private finishWindow(nowMs: number): void {
    const stable = ['active', 'left', 'right'].every(key => {
      const values = this.samples.flatMap(sample => sample[key as 'active' | 'left' | 'right'] === undefined
        ? [] : [sample[key as 'active' | 'left' | 'right']!]);
      return !values.length || isStable(values);
    });
    if (!stable) {
      this.interrupt(this.standing ? '去到舒服嘅位置，再保持一下。' : '企穩少少，再試一次。');
      return;
    }
    const baseline = this.stats(this.samples);
    this.clearWindow();
    if (!this.standing) {
      this.standing = baseline;
      this.state = 'BEND_INSTRUCTIONS';
      this.bendArmed = false;
      this.stepStarted = nowMs;
      this.message = '去到你覺得舒服嘅位置就得，唔使蹲低。';
      return;
    }
    this.state = 'VALIDATING';
    const standing = this.standing;
    const thresholds = calibrationThresholds(standing.active, baseline.active);
    const profile: CalibrationProfile = {
      standingAngle: standing.active, bendingAngle: baseline.active, ...thresholds, timestamp: nowMs,
      leftStanding: standing.left, rightStanding: standing.right,
      leftBending: baseline.left, rightBending: baseline.right,
      leftRange: standing.left !== undefined && baseline.left !== undefined ? standing.left - baseline.left : undefined,
      rightRange: standing.right !== undefined && baseline.right !== undefined ? standing.right - baseline.right : undefined,
      standingIqr: standing.iqr, bendingIqr: baseline.iqr, reliableSide: this.side,
    };
    if (thresholds.range < CONFIG.minimumRange - CONFIG.numericAngleEpsilon) {
      this.fail('range-too-small', '差少少，可以再屈多少少嗎？去到舒服嘅位置就得。');
    } else if (!validateCalibration(profile)) {
      this.fail('invalid-profile', '未設定到，我哋再試一次。');
    } else {
      this.profile = profile;
      this.state = 'COMPLETE';
      this.message = '之後阿兔會跟住你舒服嘅活動幅度。';
    }
  }
  private fail(reason: string, message: string): void {
    this.failedStep = this.standing ? 'bend' : 'standing';
    this.clearWindow();
    this.profile = undefined;
    this.state = 'FAILED';
    this.failureReason = reason;
    this.message = message;
  }
}

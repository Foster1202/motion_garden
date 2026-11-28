import { POSE_LANDMARK as L } from '../vision/poseConfig';
import { landmarkConfidence } from '../vision/poseMath';
import type { PoseFrame } from '../vision/poseTypes';
import type { TrackingMode } from '../vision/trackingMode';
import { HOME_STEP_GAP_MS, type HomeFoot, type HomeLane } from './RabbitHomeRound';

type StepMode = Exclude<TrackingMode, 'lost'>;
type Gesture = HomeFoot | 'ground' | 'uncertain';
type Shift = Exclude<HomeLane, 0>;

interface LegGeometry {
  separation: number;
  left: number;
  right: number;
}

interface StandingBaseline {
  geometry: LegGeometry;
  noise: number;
}

interface BodyGeometry {
  center: number;
  width: number;
  orientation: number;
  full?: LegGeometry;
  partial?: LegGeometry;
}

interface StandingSample {
  body: BodyGeometry;
  time: number;
}

export interface HomeStepObservation {
  trackingMode: TrackingMode;
  ready: boolean;
  step: HomeFoot | null;
  shift: Shift | null;
}

export const HOME_MAXIMUM_FRAME_GAP_MS = 320;
const REFERENCE_MS = 440;
const RECOVERY_MS = 85;
const LIFT_MS = 50;
const SHIFT_MS = 110;
const STEP_THRESHOLD = { full: .043, partial: .037 };
const STEP_MODES = ['full', 'partial'] as const;
const NO_OBSERVATION: HomeStepObservation = { trackingMode: 'lost', ready: false, step: null, shift: null };

function measureBody(frame: PoseFrame, confidence: number): BodyGeometry | undefined {
  const points = frame.landmarks;
  if (!points) return undefined;
  const [ls, rs, lh, rh] = [L.leftShoulder, L.rightShoulder, L.leftHip, L.rightHip].map(id => points[id]);
  if ([ls, rs, lh, rh].some(point => landmarkConfidence(point) < confidence)) return undefined;
  const aspect = (frame.imageWidth ?? 640) / (frame.imageHeight ?? 360);
  if (!Number.isFinite(aspect) || aspect <= 0) return undefined;
  const shoulderWidth = Math.abs(ls.x - rs.x);
  const hipWidth = Math.abs(lh.x - rh.x);
  const shoulderCenter = (ls.x + rs.x) / 2;
  const hipCenter = (lh.x + rh.x) / 2;
  const torsoHeight = (lh.y + rh.y - ls.y - rs.y) / 2;
  const scale = shoulderWidth * aspect;
  const orientation = Math.sign(ls.x - rs.x);
  if (shoulderWidth < .035 || torsoHeight < .035 || scale < torsoHeight * .42 || scale > torsoHeight * 2.5
    || hipWidth < shoulderWidth * .16 || hipWidth > shoulderWidth * 1.35
    || orientation !== Math.sign(lh.x - rh.x) || Math.abs(hipCenter - shoulderCenter) * aspect > torsoHeight * .65) return undefined;

  const legs = (leftId: number, rightId: number): LegGeometry | undefined => {
    const left = points[leftId];
    const right = points[rightId];
    if (landmarkConfidence(left) < confidence || landmarkConfidence(right) < confidence) return undefined;
    const leftDown = (left.y - lh.y) / scale;
    const rightDown = (right.y - rh.y) / scale;
    if (Math.min(leftDown, rightDown) < .1 || Math.max(leftDown, rightDown) > 2.9) return undefined;
    return { separation: (right.y - left.y) / scale, left: leftDown, right: rightDown };
  };

  return { center: hipCenter * .78 + shoulderCenter * .22, width: shoulderWidth, orientation,
    full: legs(L.leftAnkle, L.rightAnkle), partial: legs(L.leftKnee, L.rightKnee) };
}

const smooth = (previous: number, current: number, delta: number, smoothingMs: number) =>
  previous + (current - previous) * (1 - Math.exp(-delta / smoothingMs));

function plausibleStanding(geometry: LegGeometry | undefined): geometry is LegGeometry {
  return geometry !== undefined && Math.abs(geometry.separation) < .12 && Math.abs(geometry.left - geometry.right) < .18;
}

function stableGeometry(first: LegGeometry, current: LegGeometry, tolerance: number): boolean {
  return Math.abs(first.separation - current.separation) <= tolerance
    && Math.abs(first.left - current.left) <= tolerance * 1.5 && Math.abs(first.right - current.right) <= tolerance * 1.5;
}

function averageGeometry(samples: readonly LegGeometry[]): LegGeometry {
  const mean = (key: keyof LegGeometry) => samples.reduce((total, sample) => total + sample[key], 0) / samples.length;
  return { separation: mean('separation'), left: mean('left'), right: mean('right') };
}

function classify(geometry: LegGeometry, baseline: StandingBaseline, threshold: number): Gesture {
  const separation = geometry.separation - baseline.geometry.separation;
  if (Math.abs(separation) < threshold * .46) return 'ground';
  if (Math.abs(separation) < threshold || Math.abs(separation) > .95) return 'uncertain';
  const side = separation > 0 ? 'left' : 'right';
  const support = side === 'left' ? 'right' : 'left';
  const shortening = baseline.geometry[side] - geometry[side];
  const supportShortening = baseline.geometry[support] - geometry[support];
  return shortening >= threshold * .25 && shortening - supportShortening > threshold * .25
    && supportShortening < threshold * .88 ? side : 'uncertain';
}

/** Tracks mirrored shifts and alternating lifts from one session-only standing reference. */
export class HomeStepDetector {
  private origin?: Pick<BodyGeometry, 'center' | 'width' | 'orientation'>;
  private readonly baselines: Partial<Record<StepMode, StandingBaseline>> = {};
  private readonly candidates: Record<StepMode, StandingSample[]> = { full: [], partial: [] };
  private lastTimestamp?: number;
  private previousBody?: BodyGeometry;
  private consistentSince = 0;
  private mode?: StepMode;
  private fullVisibleSince?: number;
  private filteredLegs?: LegGeometry;
  private pose?: Gesture;
  private poseSince = 0;
  private armed = false;
  private lastFoot?: HomeFoot;
  private lastStepAt = -Infinity;
  private shiftArmed = false;
  private filteredShift?: number;
  private shiftPose?: HomeLane;
  private shiftSince = 0;

  get hasReference() { return this.origin !== undefined; }

  update(frame: PoseFrame, confidence = .55): HomeStepObservation {
    const time = frame.timestampMs;
    const elapsed = this.lastTimestamp === undefined ? 0 : time - this.lastTimestamp;
    if (!Number.isFinite(time) || (this.lastTimestamp !== undefined && elapsed <= 0)) {
      this.interrupt();
      return NO_OBSERVATION;
    }
    if (elapsed >= HOME_MAXIMUM_FRAME_GAP_MS) this.interrupt();
    this.lastTimestamp = time;
    const body = measureBody(frame, Math.max(.55, confidence));
    if (!body || (this.origin && body.orientation !== this.origin.orientation)) {
      this.interrupt();
      return NO_OBSERVATION;
    }
    if (this.previousBody && (body.orientation !== this.previousBody.orientation
      || Math.abs(body.center - this.previousBody.center) > this.previousBody.width * .60
      || Math.abs(body.width / this.previousBody.width - 1) > .32)) this.interrupt();
    if (!this.previousBody) this.consistentSince = time;
    this.previousBody = body;
    this.captureStanding(body, time);
    if (!this.origin) return NO_OBSERVATION;

    const continuous = time - this.consistentSince >= RECOVERY_MS;
    const dt = Math.min(130, elapsed);
    const shift = this.readShift(body, time, dt, continuous);
    const mode = this.chooseMode(body, time);
    if (mode !== this.mode) this.beginMode(mode);
    if (!mode || !continuous) return { ...NO_OBSERVATION, shift };
    const step = this.readStep(body[mode]!, this.baselines[mode]!, mode, time, dt);
    return { trackingMode: mode, ready: this.armed, step, shift };
  }

  interrupt(): void {
    this.previousBody = undefined;
    this.candidates.full = [];
    this.candidates.partial = [];
    this.beginMode(undefined);
    this.fullVisibleSince = undefined;
    this.filteredShift = undefined;
    this.shiftPose = undefined;
    this.shiftArmed = false;
  }

  private captureStanding(body: BodyGeometry, time: number): void {
    // A newly visible pair must agree with any established motion signal before calibration.
    const moving = STEP_MODES.some(mode => {
      const baseline = this.baselines[mode];
      return baseline && body[mode] && classify(body[mode], baseline, STEP_THRESHOLD[mode]) !== 'ground';
    });
    for (const mode of STEP_MODES) {
      if (this.baselines[mode]) continue;
      const legs = body[mode];
      if (moving || !plausibleStanding(legs)) {
        this.candidates[mode] = [];
        continue;
      }
      const candidates = this.candidates[mode];
      const first = candidates[0]?.body;
      if (first && (Math.abs(first.center - body.center) > first.width * .10
        || Math.abs(first.width / body.width - 1) > .12 || !stableGeometry(first[mode]!, legs, .031))) candidates.length = 0;
      candidates.push({ body, time });
      if (candidates.length < 4 || time - candidates[0].time < REFERENCE_MS) continue;
      const samples = candidates.map(sample => sample.body[mode]!);
      const geometry = averageGeometry(samples);
      const noise = Math.max(...samples.map(sample => Math.abs(sample.separation - geometry.separation)));
      this.baselines[mode] = { geometry, noise };
      if (!this.origin) {
        const mean = (key: 'center' | 'width') => candidates.reduce((sum, sample) => sum + sample.body[key], 0) / candidates.length;
        this.origin = { center: mean('center'), width: mean('width'), orientation: body.orientation };
      }
      candidates.length = 0;
    }
  }

  private chooseMode(body: BodyGeometry, time: number): StepMode | undefined {
    const full = body.full && this.baselines.full;
    const partial = body.partial && this.baselines.partial;
    this.fullVisibleSince = full ? this.fullVisibleSince ?? time : undefined;
    if (full && partial && this.mode === 'partial') {
      const grounded = classify(body.full!, this.baselines.full!, STEP_THRESHOLD.full) === 'ground'
        && classify(body.partial!, this.baselines.partial!, STEP_THRESHOLD.partial) === 'ground';
      return grounded && time - (this.fullVisibleSince ?? time) >= 250 ? 'full' : 'partial';
    }
    return full ? 'full' : partial ? 'partial' : undefined;
  }

  private beginMode(mode: StepMode | undefined): void {
    this.mode = mode;
    this.filteredLegs = undefined;
    this.pose = undefined;
    this.armed = false;
  }

  private readStep(raw: LegGeometry, baseline: StandingBaseline, mode: StepMode, time: number, dt: number): HomeFoot | null {
    const previous = this.filteredLegs ?? raw;
    const filtered = this.filteredLegs = {
      separation: smooth(previous.separation, raw.separation, dt, 42),
      left: smooth(previous.left, raw.left, dt, 42),
      right: smooth(previous.right, raw.right, dt, 42),
    };
    const threshold = Math.max(STEP_THRESHOLD[mode], Math.min(.083, baseline.noise * 2.8));
    const rawPose = classify(raw, baseline, threshold);
    const filteredPose = classify(filtered, baseline, threshold);
    const pose = rawPose === filteredPose ? rawPose : 'uncertain';
    if (pose !== this.pose) {
      this.pose = pose;
      this.poseSince = time;
    }
    const holdMs = time - this.poseSince;
    if (pose === 'ground') {
      if (holdMs >= RECOVERY_MS) this.armed = true;
      if (holdMs >= 220) {
        const reference = baseline.geometry;
        reference.separation = smooth(reference.separation, raw.separation, dt, 3200);
        reference.left = smooth(reference.left, raw.left, dt, 1100);
        reference.right = smooth(reference.right, raw.right, dt, 1100);
        baseline.noise = smooth(baseline.noise, Math.abs(raw.separation - reference.separation), dt, 1500);
      }
    }
    if (!this.armed || pose === 'ground' || pose === 'uncertain' || holdMs < LIFT_MS
      || pose === this.lastFoot || time - this.lastStepAt < HOME_STEP_GAP_MS) return null;
    this.lastFoot = pose;
    this.lastStepAt = time;
    return pose;
  }

  private readShift(body: BodyGeometry, time: number, dt: number, continuous: boolean): Shift | null {
    const origin = this.origin!;
    const raw = (origin.center - body.center) / origin.width;
    const filtered = this.filteredShift = smooth(this.filteredShift ?? raw, raw, dt, 65);
    const pose = Math.max(Math.abs(raw), Math.abs(filtered)) < .095 ? 0
      : raw < -.18 && filtered < -.18 ? -1 : raw > .18 && filtered > .18 ? 1 : undefined;
    if (pose !== this.shiftPose) {
      this.shiftPose = pose;
      this.shiftSince = time;
    }
    if (!continuous || time - this.shiftSince < SHIFT_MS) return null;
    if (pose === 0) this.shiftArmed = true;
    if (!pose || !this.shiftArmed) return null;
    this.shiftArmed = false;
    return pose;
  }
}

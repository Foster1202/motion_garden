import type { PoseFrame, PoseLandmark } from './poseTypes';

export interface PersonPreviewOptions {
  background?: 'transparent' | 'none' | 'blur' | 'gray';
  showBodyKeypoints?: boolean;
  confidenceThreshold?: number;
}

interface PersonPreviewCanvasOptions {
  width?: number;
  height?: number;
  nativeVideo?: boolean;
}

// MediaPipe's 33-landmark pose topology, including face, hands and feet.
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
] as const;

function drawable(point: PoseLandmark | undefined): point is PoseLandmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function confidence(point: PoseLandmark): number {
  const value = Math.min(point.visibility ?? 1, point.presence ?? 1);
  return Number.isFinite(value) ? value : 0;
}

export class PersonOnlyRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly maskContext?: CanvasRenderingContext2D;
  private maskImage?: ImageData;
  private lastMaskTimestamp?: number;
  private readonly automaticAspect: boolean;
  private readonly width: number;
  private readonly nativeVideo: boolean;

  constructor(private readonly video: HTMLVideoElement, readonly canvas: HTMLCanvasElement,
    { width = 320, height, nativeVideo = false }: PersonPreviewCanvasOptions = {}) {
    this.width = width;
    this.nativeVideo = nativeVideo;
    this.automaticAspect = height === undefined;
    const size = this.sizeFor(video.videoWidth, video.videoHeight);
    canvas.width = height === undefined ? size.width : width;
    canvas.height = height ?? size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('未能建立人物預覽畫布。');
    this.context = context;
    if (nativeVideo) {
      video.classList.add('camera-preview-native');
    } else {
      const maskContext = document.createElement('canvas').getContext('2d');
      if (!maskContext) throw new Error('未能建立人物預覽畫布。');
      this.maskContext = maskContext;
    }
  }

  render(frame: PoseFrame, options: PersonPreviewOptions = {}): CanvasRenderingContext2D {
    const { context, canvas, video } = this;
    if (this.automaticAspect) {
      const size = this.sizeFor(frame.imageWidth ?? video.videoWidth, frame.imageHeight ?? video.videoHeight);
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
        this.resetMask();
      }
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      this.resetMask();
      if (this.nativeVideo) video.classList.remove('camera-preview-active');
      return context;
    }
    if (this.nativeVideo) {
      video.classList.add('camera-preview-active');
      if (options.showBodyKeypoints) this.drawKeypoints(frame.landmarks, options.confidenceThreshold ?? .5);
      return context;
    }
    const background = options.background ?? 'transparent';
    try {
      if (background === 'none') {
        this.resetMask();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        this.drawPerson(frame);
        context.save();
        context.globalCompositeOperation = 'destination-over';
        if (background === 'gray') {
          context.fillStyle = '#808080';
          context.fillRect(0, 0, canvas.width, canvas.height);
        } else if (background === 'blur') {
          const padding = 12;
          context.filter = 'blur(8px)';
          context.drawImage(video, -padding, -padding, canvas.width + padding * 2, canvas.height + padding * 2);
        }
        context.restore();
      }
      if (options.showBodyKeypoints) this.drawKeypoints(frame.landmarks, options.confidenceThreshold ?? .5);
    } catch {
      // A stopped video must not interrupt motion input or keep the previous preview.
      context.restore();
      this.clear();
    }
    return context;
  }

  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.resetMask();
    if (this.nativeVideo) this.video.classList.remove('camera-preview-active');
  }

  private sizeFor(width: number, height: number): { width: number; height: number } {
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
      return { width: this.width, height: Math.round(this.width * 9 / 16) };
    }
    const scale = Math.min(this.width / width, 640 / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  private drawPerson(frame: PoseFrame): void {
    const mask = frame.personMask;
    const maskContext = this.maskContext;
    if (!maskContext || !frame.landmarks?.length || !mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height)
      || mask.width <= 0 || mask.height <= 0 || mask.alpha.length !== mask.width * mask.height) {
      this.resetMask();
      return;
    }
    const maskCanvas = maskContext.canvas;
    if (!this.maskImage || maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
      maskCanvas.width = mask.width;
      maskCanvas.height = mask.height;
      this.maskImage = maskContext.createImageData(mask.width, mask.height);
      this.lastMaskTimestamp = undefined;
      for (let index = 0; index < mask.alpha.length; index++) {
        this.maskImage.data[index * 4] = 255;
        this.maskImage.data[index * 4 + 1] = 255;
        this.maskImage.data[index * 4 + 2] = 255;
      }
    }
    const continuous = this.lastMaskTimestamp !== undefined && frame.timestampMs > this.lastMaskTimestamp
      && frame.timestampMs - this.lastMaskTimestamp <= 250;
    for (let index = 0; index < mask.alpha.length; index++) {
      const alpha = mask.alpha[index];
      const previous = this.maskImage.data[index * 4 + 3];
      // Stabilize uncertain edges while accepting large motion and clear pixels immediately.
      this.maskImage.data[index * 4 + 3] = continuous && alpha > 0 && alpha < 255 && Math.abs(alpha - previous) < 64
        ? Math.round(alpha * .8 + previous * .2) : alpha;
    }
    this.lastMaskTimestamp = frame.timestampMs;
    maskContext.putImageData(this.maskImage, 0, 0);
    const { context, canvas } = this;
    context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    context.save();
    context.globalCompositeOperation = 'destination-in';
    context.imageSmoothingEnabled = true;
    context.filter = 'blur(0.65px)';
    context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
    context.restore();
  }

  private drawKeypoints(landmarks: PoseFrame['landmarks'], threshold: number): void {
    if (!landmarks?.length) return;
    const { context, canvas } = this;
    const scale = canvas.width / 320;
    context.save();
    context.lineWidth = 2 * scale;
    context.strokeStyle = '#2788ff';
    for (const [a, b] of POSE_CONNECTIONS) {
      const first = landmarks[a], second = landmarks[b];
      if (!drawable(first) || !drawable(second)) continue;
      context.globalAlpha = Math.min(confidence(first), confidence(second)) >= threshold ? 1 : .25;
      context.beginPath();
      context.moveTo(first.x * canvas.width, first.y * canvas.height);
      context.lineTo(second.x * canvas.width, second.y * canvas.height);
      context.stroke();
    }
    for (const point of landmarks.slice(0, 33)) {
      if (!drawable(point)) continue;
      const reliable = confidence(point) >= threshold;
      context.globalAlpha = reliable ? 1 : .65;
      context.fillStyle = reliable ? '#00e676' : '#ff453a';
      context.beginPath();
      context.arc(point.x * canvas.width, point.y * canvas.height, 3 * scale, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  private resetMask(): void {
    this.lastMaskTimestamp = undefined;
  }
}

import type { PoseFrame } from './poseTypes';

export class PersonOnlyRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly maskCanvas = document.createElement('canvas');
  private readonly maskContext: CanvasRenderingContext2D;
  private maskImage?: ImageData;

  constructor(private readonly video: HTMLVideoElement, readonly canvas: HTMLCanvasElement,
    width = 320, height = 180) {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const maskContext = this.maskCanvas.getContext('2d');
    if (!context || !maskContext) throw new Error('未能建立人物預覽畫布。');
    this.context = context;
    this.maskContext = maskContext;
  }

  render(frame: PoseFrame): CanvasRenderingContext2D {
    const { context, canvas } = this;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const mask = frame.personMask;
    if (!mask || mask.width <= 0 || mask.height <= 0 || mask.alpha.length !== mask.width * mask.height) return context;
    if (!this.maskImage || this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas.width = mask.width;
      this.maskCanvas.height = mask.height;
      this.maskImage = this.maskContext.createImageData(mask.width, mask.height);
      for (let index = 0; index < mask.alpha.length; index++) {
        this.maskImage.data[index * 4] = 255;
        this.maskImage.data[index * 4 + 1] = 255;
        this.maskImage.data[index * 4 + 2] = 255;
      }
    }
    for (let index = 0; index < mask.alpha.length; index++) this.maskImage.data[index * 4 + 3] = mask.alpha[index];
    this.maskContext.putImageData(this.maskImage, 0, 0);
    context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    context.save();
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(this.maskCanvas, 0, 0, canvas.width, canvas.height);
    context.restore();
    return context;
  }

  clear(): void { this.context.clearRect(0, 0, this.canvas.width, this.canvas.height); }
}

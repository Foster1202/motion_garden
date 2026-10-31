import { KeyboardMotionInput } from './KeyboardMotionInput';
import { MediapipeMotionInput, type MediapipeInputOptions } from './MediapipeMotionInput';
import type { MotionInput, MotionInputStatus, MotionSample } from './MotionInput';
import { PoseDebugOverlay } from '../vision/PoseDebugOverlay';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { manualMotionRange } from '../settings/motionRange';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';

export interface MotionCaptureEvents {
  onFrame?: (frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile) => void;
  onReset?: () => void;
  isContinuousPreview?: () => boolean;
}

export class MotionInputController implements MotionInput {
  private active?: MotionInput;
  private preview?: PoseDebugOverlay;
  private cameraPlaying = false;
  private readonly panel: HTMLElement;
  private readonly controls: HTMLElement;
  private generation = 0;
  private destroyed = false;
  private paused = false;
  private loading = false;
  private lastMessage = '';
  private readonly orientation = document.querySelector<HTMLElement>('.orientation-note');
  private readonly originalOrientation = this.orientation?.textContent ?? '';

  constructor(private readonly host: HTMLElement, private readonly capture: MotionCaptureEvents = {}) {
    this.panel = document.createElement('section');
    this.panel.className = 'motion-setup';
    this.panel.setAttribute('aria-label', '輸入模式選擇');
    this.panel.innerHTML = `
      <h2 id="motion-setup-title">體感模式</h2>
      <p id="motion-setup-message" role="status">開啟鏡頭就可以開始，活動幅度可喺主頁「設置」調整。</p>
      <p class="motion-safety">請保持地面清爽，旁邊最好有穩固椅子。</p>
      <p class="motion-privacy">鏡頭影像只會喺裝置上即時處理，不會上傳或儲存。</p>
      <div class="motion-setup-actions"><button class="button primary" data-input-action="camera">開啟鏡頭</button><button class="button secondary" data-input-action="keyboard">使用鍵盤測試</button></div>`;
    this.controls = document.createElement('aside');
    this.controls.className = 'motion-controls';
    this.controls.hidden = true;
    this.controls.innerHTML = `<p class="motion-mode-label"></p><p class="motion-status" role="status"></p><button class="motion-switch" data-input-action="change-mode">切換輸入模式</button><label class="preview-toggle" hidden><input type="checkbox" checked> 顯示鏡頭小畫面</label>`;
    host.append(this.panel, this.controls);
    host.classList.add('input-selecting');
    this.panel.querySelector('[data-input-action="camera"]')!.addEventListener('click', () => { void this.startCamera(); });
    this.panel.querySelector('[data-input-action="keyboard"]')!.addEventListener('click', () => this.useKeyboard());
    this.controls.querySelector('[data-input-action="change-mode"]')!.addEventListener('click', () => this.chooseMode());
    this.controls.querySelector('input')!.addEventListener('change', event => this.preview?.setVisible((event.target as HTMLInputElement).checked));
    this.setKeyboardHints(false);
    this.cameraButton.focus({ preventScroll: true });
  }

  sample(): MotionSample {
    if (this.paused || this.loading) return { bending: false, standing: false };
    return this.active?.sample() ?? { bending: false, standing: false };
  }

  getStatus(): MotionInputStatus {
    const status = this.active?.getStatus?.() ?? {
      mode: this.active ? 'keyboard' : null,
      ready: Boolean(this.active), suspended: !this.active, requestPause: false,
      message: this.active ? '鍵盤測試模式' : this.loading ? '正在準備鏡頭…' : '揀一個輸入模式，準備好先開始。',
    };
    this.renderStatus(status);
    return {
      ...status, ready: status.ready && !this.loading,
      suspended: status.suspended || this.paused || this.loading,
      requestPause: status.requestPause,
    };
  }

  reset() { this.active?.reset(); }
  pause() {
    this.paused = true;
    this.active?.pause?.();
    this.active?.reset();
  }
  resume() {
    this.paused = false;
    this.active?.reset();
    this.active?.resume?.();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    this.releaseInput();
    this.host.classList.remove('input-selecting', 'using-camera', 'calibrating');
    if (this.orientation) this.orientation.textContent = this.originalOrientation;
    this.panel.remove();
    this.controls.remove();
  }


  private chooseMode() {
    ++this.generation;
    this.releaseInput();
    this.loading = false;
    this.host.classList.add('input-selecting');
    this.host.classList.remove('using-camera', 'calibrating');
    this.panel.hidden = false;
    this.controls.hidden = true;
    this.setupMessage('體感模式', '開啟鏡頭就可以開始，活動幅度可喺主頁「設置」調整。');
    this.cameraButton.disabled = false;
    this.setKeyboardHints(false);
    this.cameraButton.focus({ preventScroll: true });
  }

  private useKeyboard() {
    if (this.destroyed) return;
    ++this.generation;
    this.releaseInput();
    this.loading = false;
    this.active = new KeyboardMotionInput();
    this.host.classList.remove('input-selecting', 'using-camera', 'calibrating');
    this.panel.hidden = true;
    this.controls.hidden = false;
    this.controls.querySelector<HTMLElement>('.motion-mode-label')!.textContent = '鍵盤測試';
    this.controls.querySelector<HTMLElement>('.preview-toggle')!.hidden = true;
    this.setKeyboardHints(true);
    this.getStatus();
    this.focusPause();
  }

  private async startCamera() {
    if (this.loading || this.destroyed) return;
    const generation = ++this.generation;
    this.releaseInput();
    this.loading = true;
    this.cameraButton.disabled = true;
    this.setupMessage('體感模式', '正在準備鏡頭…');
    const options: MediapipeInputOptions = {
      onFrame: (frame, pose) => {
        if (generation !== this.generation || this.destroyed) return;
        this.preview?.update(frame, pose);
        this.getStatus();
        const profile = input.getCalibration();
        if (this.cameraPlaying && !this.paused && profile) this.capture.onFrame?.(frame, pose, profile);
      },
      onError: error => { if (generation === this.generation && !this.destroyed) this.cameraFailed(error); },
    };
    const input = new MediapipeMotionInput(options);
    this.active = input;
    if (this.paused) input.pause();
    try {
      const video = await input.start();
      if (this.destroyed || generation !== this.generation) { input.destroy(); return; }
      this.loading = false;
      this.preview = new PoseDebugOverlay(this.host, video);
      this.controls.querySelector<HTMLInputElement>('input')!.checked = !this.preview.root.hidden;
      this.host.classList.add('using-camera');
      this.panel.hidden = true;
      this.controls.hidden = false;
      this.controls.querySelector<HTMLElement>('.motion-mode-label')!.textContent = '體感模式';
      this.controls.querySelector<HTMLElement>('.preview-toggle')!.hidden = false;
      this.setKeyboardHints(false);
      input.setMotionRange(manualMotionRange());
      this.preview.setCalibration(input.getCalibration());
      this.cameraPlaying = true;
      this.host.classList.remove('input-selecting', 'calibrating');
      this.getStatus();
      this.focusPause();
    } catch (error) {
      if (generation === this.generation && !this.destroyed) this.cameraFailed(error);
    }
  }

  private cameraFailed(error: unknown) {
    ++this.generation;
    this.releaseInput();
    this.loading = false;
    this.host.classList.add('input-selecting');
    this.host.classList.remove('using-camera', 'calibrating');
    this.panel.hidden = false;
    this.controls.hidden = true;
    this.cameraButton.disabled = false;
    this.setupMessage('未能開啟鏡頭', error instanceof Error ? error.message : '你可以檢查瀏覽器權限，或者暫時使用鍵盤操作。');
  }

  private get cameraButton() { return this.panel.querySelector<HTMLButtonElement>('[data-input-action="camera"]')!; }
  private focusPause() { this.host.querySelector<HTMLButtonElement>('[data-action="pause"]')?.focus({ preventScroll: true }); }
  private setupMessage(title: string, message: string) {
    this.panel.querySelector<HTMLElement>('#motion-setup-title')!.textContent = title;
    this.panel.querySelector<HTMLElement>('#motion-setup-message')!.textContent = message;
  }
  private renderStatus(status: MotionInputStatus) {
    const message = this.cameraPlaying && !status.suspended && this.capture.isContinuousPreview?.()
      ? '即時動作預覽，按自己舒適幅度活動。' : status.message;
    if (message !== this.lastMessage) {
      this.controls.querySelector<HTMLElement>('.motion-status')!.textContent = message;
      this.lastMessage = message;
    }
  }
  private setKeyboardHints(visible: boolean) {
    const hints = this.host.querySelector<HTMLElement>('.keyboard-hints');
    if (hints) hints.hidden = !visible || import.meta.env?.VITE_SHOW_KEYBOARD_HINTS === 'false';
    if (this.orientation) this.orientation.textContent = visible ? this.originalOrientation
      : this.active instanceof MediapipeMotionInput ? '橫向畫面更清楚。頭到腳盡量留喺畫面內。' : '橫向畫面更清楚。揀一個輸入模式先開始。';
  }
  private releaseInput() {
    this.capture.onReset?.();
    this.cameraPlaying = false;
    this.active?.destroy();
    this.active = undefined;
    this.preview?.destroy();
    this.preview = undefined;
  }
}

import { KeyboardMotionInput } from './KeyboardMotionInput';
import { MediapipeMotionInput, type MediapipeInputOptions } from './MediapipeMotionInput';
import type { MotionInput, MotionInputStatus, MotionSample } from './MotionInput';
import { PoseDebugOverlay } from '../vision/PoseDebugOverlay';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { CalibrationController } from '../calibration/CalibrationController';
import { CalibrationPanel } from '../calibration/CalibrationPanel';
import { manualMotionRange } from '../settings/motionRange';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';

export interface MotionCaptureEvents {
  onFrame?: (frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile) => void;
  onReset?: () => void;
  onStatus?: (status: MotionInputStatus) => void;
  isContinuousPreview?: () => boolean;
  getMotionHint?: () => string | undefined;
}

export class MotionInputController implements MotionInput {
  private active?: MotionInput;
  private preview?: PoseDebugOverlay;
  private cameraPlaying = false;
  private waitingForStanding = false;
  private calibration?: CalibrationController;
  private calibrationPanel?: CalibrationPanel;
  private readonly personStatus = document.createElement('p');
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
      <p id="motion-setup-message" role="status">開啟鏡頭後，阿兔會帶你設定舒服嘅活動幅度。</p>
      <p class="motion-safety">請保持地面清爽，旁邊最好有穩固椅子。</p>
      <p class="motion-privacy">鏡頭影像只會喺裝置上即時處理，不會上傳或儲存。</p>
      <div class="motion-setup-actions"><button class="button primary" data-input-action="camera">開啟鏡頭</button><button class="button secondary" data-input-action="keyboard">使用鍵盤測試</button></div>`;
    this.controls = document.createElement('aside');
    this.controls.className = 'motion-controls';
    this.controls.hidden = true;
    this.controls.innerHTML = `<p class="motion-mode-label"></p><p class="motion-status" role="status"></p><button class="motion-switch" data-input-action="change-mode">切換輸入模式</button><button class="motion-switch" data-input-action="recalibrate" hidden>重新設定動作</button><label class="preview-toggle" hidden><input type="checkbox" checked> 顯示鏡頭小畫面</label>`;
    this.personStatus.className = 'person-status';
    this.personStatus.hidden = true;
    this.personStatus.setAttribute('role', 'status');
    host.append(this.panel, this.controls, this.personStatus);
    host.classList.add('input-selecting');
    this.panel.querySelector('[data-input-action="camera"]')!.addEventListener('click', () => { void this.startCamera(); });
    this.panel.querySelector('[data-input-action="keyboard"]')!.addEventListener('click', () => this.useKeyboard());
    this.controls.querySelector('[data-input-action="change-mode"]')!.addEventListener('click', () => this.chooseMode());
    this.controls.querySelector('[data-input-action="recalibrate"]')!.addEventListener('click', () => this.restartCalibration());
    this.controls.querySelector('input')!.addEventListener('change', event => this.preview?.setVisible((event.target as HTMLInputElement).checked));
    this.setKeyboardHints(false);
    this.cameraButton.focus({ preventScroll: true });
  }

  sample(): MotionSample {
    if (this.paused || this.loading || (this.active instanceof MediapipeMotionInput && !this.cameraPlaying)) return { bending: false, standing: false };
    return this.active?.sample() ?? { bending: false, standing: false };
  }

  getStatus(): MotionInputStatus {
    const status = this.active?.getStatus?.() ?? {
      mode: this.active ? 'keyboard' : null,
      ready: Boolean(this.active), suspended: !this.active, requestPause: false,
      message: this.active ? '鍵盤測試模式' : this.loading ? '正在準備鏡頭…' : '揀一個輸入模式，準備好先開始。',
    };
    if (status.mode === 'camera' && (!status.ready || status.suspended)) {
      const calibration = this.calibration?.pause(performance.now());
      if (calibration && calibration.state !== 'FAILED') this.calibrationPanel?.render({
        ...calibration, message: '等候穩定姿勢，動作設定會自動繼續。',
      });
    }
    const calibrated = status.mode !== 'camera' || this.cameraPlaying;
    const result: MotionInputStatus = {
      ...status, ready: status.ready && !this.loading,
      suspended: status.suspended || this.paused || this.loading || !calibrated || this.waitingForStanding,
      requestPause: status.requestPause,
      calibrationReady: calibrated && status.mode === 'camera',
      calibrationState: this.calibration?.getSnapshot().state ?? 'IDLE',
    };
    this.renderStatus(result);
    this.capture.onStatus?.(result);
    return result;
  }

  reset() { this.active?.reset(); }
  pause() {
    this.paused = true;
    this.active?.pause?.();
    this.active?.reset();
    this.calibration?.pause(performance.now());
  }
  resume() {
    this.paused = false;
    this.active?.reset();
    this.active?.resume?.();
    this.calibration?.resume(performance.now());
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
    this.personStatus.remove();
  }


  private chooseMode() {
    ++this.generation;
    this.releaseInput();
    this.loading = false;
    this.host.classList.add('input-selecting');
    this.host.classList.remove('using-camera', 'calibrating');
    this.panel.hidden = false;
    this.controls.hidden = true;
    this.setupMessage('體感模式', '開啟鏡頭後，阿兔會帶你設定舒服嘅活動幅度。');
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
    this.controls.querySelector<HTMLElement>('[data-input-action="recalibrate"]')!.hidden = true;
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
        this.updateCalibration(input, pose);
        if (this.waitingForStanding && pose.state === 'STANDING' && !input.getStatus().suspended) this.waitingForStanding = false;
        const status = this.getStatus();
        const profile = input.getCalibration();
        if (this.cameraPlaying && !this.paused && profile) {
          this.capture.onFrame?.(frame, status.suspended ? { ...pose, state: 'TRACKING_LOST' } : pose, profile);
        }
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
      this.controls.querySelector<HTMLElement>('[data-input-action="recalibrate"]')!.hidden = false;
      this.setKeyboardHints(false);
      input.setMotionRange(manualMotionRange());
      this.calibration = new CalibrationController();
      this.host.classList.remove('input-selecting', 'calibrating');
      this.getStatus();
      this.focusPause();
    } catch (error) {
      if (generation === this.generation && !this.destroyed) this.cameraFailed(error);
    }
  }

  private updateCalibration(input: MediapipeMotionInput, pose: PoseSnapshot) {
    if (!this.calibration || this.cameraPlaying || this.paused || this.loading) return;
    const now = performance.now();
    const reliable = pose.state !== 'UNKNOWN' && pose.state !== 'TRACKING_LOST';
    let snapshot = this.calibration.getSnapshot();
    if (!reliable) {
      if (snapshot.state !== 'IDLE') this.calibration.pause(now);
      return;
    }
    if (snapshot.state === 'IDLE') {
      if (input.getStatus().suspended) return;
      this.calibration.begin(now);
      this.calibrationPanel = new CalibrationPanel(this.host, {
        bend: () => undefined, play: () => undefined,
        retry: () => { this.calibration?.retry(performance.now()); },
        restart: () => this.restartCalibration(), keyboard: () => this.useKeyboard(),
      }, true);
      this.host.classList.add('calibrating');
    }
    this.calibration.resume(now);
    snapshot = this.calibration.update(pose, now);
    if (snapshot.state === 'BEND_INSTRUCTIONS' && !snapshot.bendStarted) snapshot = this.calibration.startBending(now);
    this.calibrationPanel?.render(snapshot);
    if (snapshot.state === 'COMPLETE' && snapshot.profile) {
      input.setCalibration(snapshot.profile);
      this.preview?.setCalibration(snapshot.profile);
      this.cameraPlaying = true;
      this.waitingForStanding = true;
      this.calibrationPanel?.destroy();
      this.calibrationPanel = undefined;
      this.host.classList.remove('calibrating');
    }
  }

  private restartCalibration() {
    if (!(this.active instanceof MediapipeMotionInput) || this.destroyed) return;
    this.cameraPlaying = false;
    this.waitingForStanding = false;
    this.capture.onReset?.();
    this.active.setMotionRange(manualMotionRange());
    this.calibration?.destroy();
    this.calibration = new CalibrationController();
    this.calibrationPanel?.destroy();
    this.calibrationPanel = undefined;
    this.host.classList.remove('calibrating');
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
    const message = this.waitingForStanding ? '動作設定完成，請自然企直、雙手放鬆，阿兔會自動跟隨。'
      : this.cameraPlaying && !status.suspended && this.capture.isContinuousPreview?.()
      ? this.capture.getMotionHint?.() ?? '即時動作預覽，按自己舒適幅度活動。' : status.message;
    if (message !== this.lastMessage) {
      this.controls.querySelector<HTMLElement>('.motion-status')!.textContent = message;
      this.lastMessage = message;
    }
    this.personStatus.hidden = status.mode !== 'camera';
    const state = status.trackingState ?? 'CAMERA_INITIALIZING';
    this.personStatus.dataset.trackingState = state;
    const labels = {
      CAMERA_INITIALIZING: '正在準備鏡頭…', WAITING_FOR_PERSON: '未偵測到人物',
      PERSON_DETECTED: '已偵測到人物', TRACKING_UNSTABLE: '正在確認姿勢…',
      TRACKING_LOST: '未偵測到人物', TRACKING_READY: '已偵測到人物',
    };
    const displayedPerson = ['PERSON_DETECTED', 'TRACKING_UNSTABLE', 'TRACKING_READY'].includes(state);
    const text = status.cameraStatus === 'paused' ? '已暫停'
      : displayedPerson && !status.calibrationReady ? '請先完成動作設定' : labels[state];
    if (this.personStatus.textContent !== text) this.personStatus.textContent = text;
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
    this.waitingForStanding = false;
    this.calibration?.destroy();
    this.calibration = undefined;
    this.calibrationPanel?.destroy();
    this.calibrationPanel = undefined;
    this.personStatus.hidden = true;
    this.active?.destroy();
    this.active = undefined;
    this.preview?.destroy();
    this.preview = undefined;
  }
}

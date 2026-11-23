import { MainThreadPerformanceProbe, VideoPerformanceProbe } from './game/performance/framePerformance';
import { getGameSettings } from './game/settings/gameSettings';
import { PoseCamera } from './game/vision/PoseCamera';
import { CAMERA_PROFILE_LABELS, getCameraPreferences, saveCameraPreferences,
  type CameraPreferences, type CameraProfile } from './game/vision/cameraPreferences';
import './cameraDiagnostics.css';

const device = document.querySelector<HTMLSelectElement>('#camera-device')!;
const profile = document.querySelector<HTMLSelectElement>('#camera-profile')!;
const startButton = document.querySelector<HTMLButtonElement>('#camera-start')!;
const stopButton = document.querySelector<HTMLButtonElement>('#camera-stop')!;
const saveButton = document.querySelector<HTMLButtonElement>('#camera-save')!;
const video = document.querySelector<HTMLVideoElement>('#camera-video')!;
const status = document.querySelector<HTMLElement>('#camera-status')!;
const saved = document.querySelector<HTMLElement>('#camera-saved')!;
const metrics = document.querySelector<HTMLElement>('#camera-metrics')!;
const mediaDevices = navigator.mediaDevices;

let camera: PoseCamera | undefined;
let deviceRefresh = 0;
let videoProbe: VideoPerformanceProbe | undefined;
let threadProbe: MainThreadPerformanceProbe | undefined;
let readTimer: ReturnType<typeof setInterval> | undefined;
let sampleTime = 0;

const number = (value: number | undefined) => value === undefined ? '—' : value.toFixed(1);
const range = (value: { min?: number; max?: number } | undefined) =>
  value?.min === undefined || value.max === undefined ? '—' : `${value.min}–${value.max}`;

const preferences = getCameraPreferences();
for (const [key, label] of Object.entries(CAMERA_PROFILE_LABELS)) profile.add(new Option(label, key));
profile.value = preferences.profile;
if (preferences.deviceId) device.add(new Option('已儲存的鏡頭', preferences.deviceId, true, true));

async function refreshDevices(): Promise<void> {
  const refresh = ++deviceRefresh;
  try {
    const inputs = (await mediaDevices?.enumerateDevices?.() ?? []).filter(item => item.kind === 'videoinput');
    if (refresh !== deviceRefresh) return;
    const selected = device.value;
    device.replaceChildren(new Option('瀏覽器預設鏡頭', ''));
    for (const [index, input] of inputs.entries()) {
      if (!input.deviceId || input.deviceId === 'default') continue;
      device.add(new Option(input.label || `鏡頭 ${index + 1}`, input.deviceId));
    }
    if (selected && !Array.from(device.options).some(option => option.value === selected)) {
      device.add(new Option('已選鏡頭（目前未列出）', selected));
    }
    device.value = selected;
  } catch {
    // The browser may withhold device labels until camera permission is granted.
  }
}

function stopSampling(): void {
  clearInterval(readTimer);
  readTimer = undefined;
  videoProbe?.stop();
  threadProbe?.stop();
  videoProbe = undefined;
  threadProbe = undefined;
}

function startSampling(): void {
  stopSampling();
  if (!camera || !video.srcObject || document.hidden) return;
  videoProbe = new VideoPerformanceProbe(video);
  threadProbe = new MainThreadPerformanceProbe();
  sampleTime = performance.now();
  readTimer = setInterval(readMetrics, 1000);
}

function readMetrics(): void {
  if (!camera || !videoProbe || !threadProbe) return;
  const now = performance.now();
  const frames = videoProbe.read(now - sampleTime);
  const thread = threadProbe.read();
  sampleTime = now;
  const settings = camera.settings;
  const caps = camera.capabilities;
  const supported = mediaDevices?.getSupportedConstraints?.();
  const controls: string[] = (['deviceId', 'width', 'height', 'frameRate'] as const).filter(key => supported?.[key]);
  if (supported && 'resizeMode' in supported && supported.resizeMode === true) controls.push('resizeMode');
  metrics.textContent = [
    `生效設定 ${CAMERA_PROFILE_LABELS[camera.resolvedProfile]}`,
    `實際影像 ${video.videoWidth || '—'}×${video.videoHeight || '—'}`,
    `協商 ${settings?.width ?? '—'}×${settings?.height ?? '—'} · ${number(settings?.frameRate)} FPS`,
    `縮放方式 ${settings && 'resizeMode' in settings && typeof settings.resizeMode === 'string' ? settings.resizeMode : '—'}`,
    `Video ${number(frames.presentedFps)} FPS · ${frames.source ?? '瀏覽器未提供影格計數'}`,
    `回調 ${number(frames.callbackFps)} FPS · 合併回調 ${frames.skippedCallbacks ?? '—'}`,
    `媒體時間軸 ${number(frames.mediaTimelineFps)} FPS · 擷取時間軸 ${number(frames.captureTimelineFps)} FPS`,
    `解碼 P95 ${number(frames.decodeP95Ms)} ms · 播放掉幀 ${frames.droppedFrames ?? '—'}`,
    `長任務 ${thread.longTasks ?? '—'} · 最長 ${number(thread.longestTaskMs)} ms`,
    `RAF 停頓（≥50 ms） ${thread.rafStalls} · 最長 ${number(thread.maxRafGapMs)} ms`,
    `鏡頭範圍  寬 ${range(caps?.width)} · 高 ${range(caps?.height)} · FPS ${range(caps?.frameRate)}`,
    `瀏覽器可設定  ${controls.join(', ') || '—'}`,
  ].join('\n');
  if (frames.presentedFps === undefined) delete metrics.dataset.videoFps;
  else metrics.dataset.videoFps = frames.presentedFps.toFixed(1);
}

function selection(): CameraPreferences {
  return { deviceId: device.value || undefined, profile: profile.value as CameraProfile };
}

function stopCamera(message = '鏡頭已停止。'): void {
  stopSampling();
  const active = camera;
  camera = undefined;
  active?.stop();
  startButton.disabled = false;
  stopButton.disabled = true;
  status.textContent = message;
  metrics.textContent = '等候啟動鏡頭…';
  delete metrics.dataset.videoFps;
}

async function startCamera(): Promise<void> {
  stopCamera('正在啟動鏡頭…');
  startButton.disabled = true;
  stopButton.disabled = false;
  const active = new PoseCamera({ video, preferences: selection(), lowPerformanceMode: getGameSettings().lowPerformanceMode,
    onEnded: () => { if (camera === active) stopCamera('鏡頭已中斷，請重新選擇或再試。'); } });
  camera = active;
  try {
    await active.start();
    if (camera !== active) return;
    status.textContent = '相機運作中。每秒更新數據。';
    metrics.textContent = '正在量度…';
    startSampling();
    void refreshDevices();
  } catch (error) {
    if (camera !== active) return;
    stopCamera(error instanceof Error ? error.message : '未能啟動鏡頭，請重試。');
  }
}

startButton.addEventListener('click', () => void startCamera());
stopButton.addEventListener('click', () => stopCamera());
for (const control of [device, profile]) control.addEventListener('change', () => {
  saved.textContent = '';
  if (camera) void startCamera();
});
saveButton.addEventListener('click', () => {
  try {
    saveCameraPreferences(selection());
    saved.textContent = '已儲存，下一次開啟遊戲鏡頭時套用。';
  } catch {
    saved.textContent = '瀏覽器未能儲存設定。';
  }
});
mediaDevices?.addEventListener?.('devicechange', () => void refreshDevices());
window.addEventListener('pagehide', () => stopCamera());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSampling();
  else startSampling();
});
void refreshDevices();

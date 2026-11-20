import { DEFAULT_GAME_SETTINGS, GAME_SETTING_LIMITS, getGameSettings, saveGameSettings, type GameSettings, type NumericGameSetting } from './gameSettings';
import { BERRY_CONFIG as C } from '../berry/berryConfig';

const FIELDS: readonly [NumericGameSetting, string, string, number][] = [
  ['standingAngle', '站立觸發角度（°）', '膝角達到此值即視為企直。', 1],
  ['bendingAngle', '屈膝觸發角度（°）', '膝角低於此值即視為屈膝；數值越大，越容易觸發，毋須追求深蹲。', 1],
  ['bendHoldMs', '屈膝保持時間（毫秒）', '保持多久才捉實蘿蔔。', 50],
  ['standHoldMs', '站立保持時間（毫秒）', '企直保持多久才拔出蘿蔔。', 50],
  ['smoothingAlpha', '姿勢平滑係數', '越低越平滑；越高反應越快。', 0.05],
  ['debounceMs', '姿勢確認時間（毫秒）', '動作穩定多久才確認，減少誤觸。', 50],
  ['confidenceThreshold', '追蹤可信度門檻', '越高越嚴格；降低可能增加誤判。', 0.05],
  ['mocapGain', '3D 動作幅度', '調整兔子跟隨動作的幅度，不改變拔蘿蔔門檻。', 0.05],
  ['mocapSmoothingAlpha', '3D 動作平滑係數', '越低越平滑；越高反應越快。', 0.05],
  ['rabbitScale', '3D 兔子大小', '調整模型顯示比例。', 0.05],
];

export class SettingsPanel {
  private readonly dialog = document.createElement('dialog');
  private readonly inputs = new Map<NumericGameSetting, HTMLInputElement>();
  private readonly showBodyKeypoints = document.createElement('input');
  private readonly backgroundProcessing = document.createElement('input');
  private readonly backgroundMode = document.createElement('select');
  private readonly backgroundModeLabel = document.createElement('label');
  private readonly berryDuration = document.createElement('select');
  private readonly sfxEnabled = document.createElement('input');
  private readonly sfxVolume = document.createElement('input');
  private readonly sfxVolumeOutput = document.createElement('output');
  private readonly voiceEnabled = document.createElement('input');
  private readonly voiceVolume = document.createElement('input');
  private readonly voiceVolumeOutput = document.createElement('output');
  private readonly error = document.createElement('p');
  private closed = false;

  constructor(host: HTMLElement, private readonly onClose: () => void) {
    this.dialog.className = 'game-settings';
    this.dialog.setAttribute('aria-labelledby', 'game-settings-title');
    const form = document.createElement('form');
    const heading = document.createElement('h2');
    heading.id = 'game-settings-title';
    heading.textContent = '設置';
    const intro = document.createElement('p');
    intro.textContent = '毋須校準，使用預設值即可開始。只需舒適輕屈膝，保持雙腳着地；如有不適請休息。設定會儲存在此瀏覽器。音效及語音儲存後即時套用，其餘選項於下一次開始遊戲時套用。';
    form.append(heading, intro);
    const fields = document.createElement('div');
    fields.className = 'game-settings-fields';
    const audio = document.createElement('fieldset');
    audio.className = 'game-settings-audio';
    const audioLegend = document.createElement('legend');
    audioLegend.textContent = '音效與語音';
    audio.append(audioLegend);
    for (const [enabled, volume, output, name, caption] of [
      [this.sfxEnabled, this.sfxVolume, this.sfxVolumeOutput, 'sfx', '音效'],
      [this.voiceEnabled, this.voiceVolume, this.voiceVolumeOutput, 'voice', '語音'],
    ] as const) {
      const enabledLabel = document.createElement('label');
      enabledLabel.className = 'game-settings-switch';
      enabled.type = 'checkbox';
      enabled.name = `${name}Enabled`;
      const enabledCaption = document.createElement('span');
      enabledCaption.textContent = `${caption}開關`;
      enabledLabel.append(enabled, enabledCaption);
      const volumeLabel = document.createElement('label');
      const volumeCaption = document.createElement('span');
      volumeCaption.textContent = `${caption}音量`;
      volume.type = 'range';
      volume.name = `${name}Volume`;
      volume.id = `settings-${name}-volume`;
      volume.min = '0';
      volume.max = '1';
      volume.step = '0.05';
      volume.setAttribute('aria-label', `${caption}音量`);
      output.setAttribute('for', volume.id);
      output.setAttribute('aria-label', `目前${caption}音量`);
      volumeLabel.append(volumeCaption, volume, output);
      enabled.addEventListener('change', () => this.updateAudioControls());
      volume.addEventListener('input', () => this.updateAudioControls());
      audio.append(enabledLabel, volumeLabel);
    }
    fields.append(audio);
    const durationLabel = document.createElement('label');
    const durationCaption = document.createElement('span');
    durationCaption.textContent = '莓果挑戰時間';
    this.berryDuration.name = 'berryDurationSeconds';
    for (const duration of C.durationOptions) {
      const option = document.createElement('option');
      option.value = String(duration);
      option.textContent = `${duration} 秒`;
      this.berryDuration.append(option);
    }
    const durationHint = document.createElement('small');
    durationHint.id = 'settings-help-berry-duration';
    durationHint.textContent = '選擇每局莓果大豐收的限時，時間內可持續收集莓果。';
    this.berryDuration.setAttribute('aria-describedby', durationHint.id);
    durationLabel.append(durationCaption, this.berryDuration, durationHint);
    fields.append(durationLabel);
    const preview = document.createElement('fieldset');
    preview.className = 'game-settings-preview';
    const legend = document.createElement('legend');
    legend.textContent = '鏡頭預覽';
    preview.append(legend);
    for (const [input, name, title] of [
      [this.showBodyKeypoints, 'showBodyKeypoints', '顯示身體關鍵點'],
      [this.backgroundProcessing, 'backgroundProcessing', '背景處理'],
    ] as const) {
      const label = document.createElement('label');
      label.className = 'game-settings-switch';
      input.type = 'checkbox';
      input.name = name;
      const caption = document.createElement('span');
      caption.textContent = title;
      label.append(input, caption);
      preview.append(label);
    }
    this.backgroundModeLabel.className = 'game-settings-background-mode';
    const modeCaption = document.createElement('span');
    modeCaption.textContent = '背景效果';
    this.backgroundMode.name = 'backgroundMode';
    for (const [value, title] of [['blur', '模糊'], ['gray', '灰色']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = title;
      this.backgroundMode.append(option);
    }
    this.backgroundModeLabel.append(modeCaption, this.backgroundMode);
    preview.append(this.backgroundModeLabel);
    this.backgroundProcessing.addEventListener('change', () => this.updateBackgroundMode());
    fields.append(preview);
    for (const [key, title, help, step] of FIELDS) {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = title;
      const input = document.createElement('input');
      input.type = 'number';
      input.name = key;
      input.min = String(GAME_SETTING_LIMITS[key][0]);
      input.max = String(GAME_SETTING_LIMITS[key][1]);
      input.step = String(step);
      const hint = document.createElement('small');
      hint.id = `settings-help-${key}`;
      hint.textContent = `${help} 範圍 ${input.min}–${input.max}。`;
      input.setAttribute('aria-describedby', hint.id);
      label.append(caption, input, hint);
      fields.append(label);
      this.inputs.set(key, input);
    }
    this.setValues(getGameSettings());
    this.error.className = 'game-settings-error';
    this.error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'game-settings-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '恢復預設';
    reset.addEventListener('click', () => { this.setValues(DEFAULT_GAME_SETTINGS); this.error.textContent = '已填入預設值，按「儲存」後生效。'; });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => this.destroy());
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = '儲存';
    actions.append(reset, cancel, save);
    form.append(fields, this.error, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const numeric = Object.fromEntries([...this.inputs].map(([key, input]) => [key, input.valueAsNumber])) as Pick<GameSettings, NumericGameSetting>;
      const settings: GameSettings = { ...numeric,
        showBodyKeypoints: this.showBodyKeypoints.checked,
        backgroundProcessing: this.backgroundProcessing.checked,
        backgroundMode: this.backgroundMode.value as GameSettings['backgroundMode'],
        berryDurationSeconds: Number(this.berryDuration.value) as GameSettings['berryDurationSeconds'],
        sfxEnabled: this.sfxEnabled.checked,
        sfxVolume: this.sfxVolume.valueAsNumber,
        voiceEnabled: this.voiceEnabled.checked,
        voiceVolume: this.voiceVolume.valueAsNumber,
      };
      try { saveGameSettings(settings); this.destroy(); }
      catch (error) { this.error.textContent = error instanceof Error ? error.message : '未能儲存設定，請檢查瀏覽器儲存權限。'; }
    });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.destroy(); });
    this.dialog.append(form);
    host.append(this.dialog);
    this.dialog.showModal();
  }

  private setValues(settings: Readonly<GameSettings>): void {
    for (const [key, input] of this.inputs) input.value = String(settings[key]);
    this.showBodyKeypoints.checked = settings.showBodyKeypoints;
    this.backgroundProcessing.checked = settings.backgroundProcessing;
    this.backgroundMode.value = settings.backgroundMode;
    this.berryDuration.value = String(settings.berryDurationSeconds);
    this.sfxEnabled.checked = settings.sfxEnabled;
    this.sfxVolume.value = String(settings.sfxVolume);
    this.voiceEnabled.checked = settings.voiceEnabled;
    this.voiceVolume.value = String(settings.voiceVolume);
    this.updateAudioControls();
    this.updateBackgroundMode();
  }

  private updateAudioControls(): void {
    for (const [enabled, volume, output] of [
      [this.sfxEnabled, this.sfxVolume, this.sfxVolumeOutput],
      [this.voiceEnabled, this.voiceVolume, this.voiceVolumeOutput],
    ] as const) {
      volume.disabled = !enabled.checked;
      const percentage = `${Math.round(volume.valueAsNumber * 100)}%`;
      output.value = percentage;
      volume.setAttribute('aria-valuetext', percentage);
    }
  }

  private updateBackgroundMode(): void {
    this.backgroundMode.disabled = !this.backgroundProcessing.checked;
    this.backgroundModeLabel.hidden = !this.backgroundProcessing.checked;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.dialog.close();
    this.dialog.remove();
    this.onClose();
  }
}

import { DEFAULT_GAME_SETTINGS, GAME_SETTING_LIMITS, getGameSettings, saveGameSettings, type GameSettings } from './gameSettings';

const FIELDS: readonly [keyof GameSettings, string, string, number][] = [
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
  private readonly inputs = new Map<keyof GameSettings, HTMLInputElement>();
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
    intro.textContent = '毋須校準，使用預設值即可開始。只需舒適輕屈膝，保持雙腳着地；如有不適請休息。設定會儲存在此瀏覽器，於下一次開始遊戲時套用。';
    form.append(heading, intro);
    const fields = document.createElement('div');
    fields.className = 'game-settings-fields';
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
      const settings = Object.fromEntries([...this.inputs].map(([key, input]) => [key, input.valueAsNumber])) as unknown as GameSettings;
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
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.dialog.close();
    this.dialog.remove();
    this.onClose();
  }
}

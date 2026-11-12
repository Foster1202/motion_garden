import { Group, Mesh, MeshBasicMaterial, SphereGeometry, type Scene, type Vector3 } from 'three';
import type { Carrot3D } from './Carrot3D';
import type { CarrotAttachmentController } from './interaction/CarrotAttachmentController';
import type { RabbitHandTracker } from './interaction/RabbitHandTracker';

export const DEV_CARROT_GRAB_DEBUG = import.meta.env.DEV &&
  new URLSearchParams(location.search).get('carrotGrabDebug') === '1';

export class CarrotGrabDebug {
  private readonly root = document.createElement('details');
  private readonly metrics = document.createElement('pre');
  private readonly message = document.createElement('p');
  private readonly markers = new Group();
  private readonly geometry = new SphereGeometry(.025, 10, 8);
  private readonly materials = [0x1479ed, 0xeb3483, 0xf5a600].map(color =>
    new MeshBasicMaterial({ color, depthTest: false }));
  private readonly points = this.materials.map(material => new Mesh(this.geometry, material));
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly toggles: HTMLInputElement[] = [];
  private elapsed = 0;
  private paused = false;

  constructor(host: HTMLElement, scene: Scene, private readonly carrot: Carrot3D,
    private readonly tracker: RabbitHandTracker, private readonly controller: CarrotAttachmentController,
    private readonly placeAtHands: () => void, private readonly controlSource: () => string,
    private readonly refreshEligibility: () => void) {
    this.root.className = 'carrot-grab-debug';
    this.root.open = true;
    const summary = document.createElement('summary');
    summary.textContent = '3D 蘿蔔抓握測試';
    const hint = document.createElement('p');
    hint.textContent = '手動測試可將雙臂調至 85–90°、手肘 10°、方向 145°，再擺放測試蘿蔔。向下捲動可調骨骼。';
    this.root.append(summary, hint);
    const actions = document.createElement('div');
    for (const [key, text, action] of [
      ['reset', '重設蘿蔔', () => this.controller.reset()],
      ['grab', '抓住蘿蔔', () => { this.refreshEligibility(); this.controller.grab(); }],
      ['release', '放開蘿蔔', () => this.controller.release()],
      ['place', '擺放到雙手中間（測試）', this.placeAtHands],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = text; button.dataset.carrotGrabAction = key;
      button.addEventListener('click', () => { if (!this.paused) { action(); this.update(1); } });
      actions.append(button); this.buttons.push(button);
    }
    this.root.append(actions);
    for (const [key, text, checked, changed] of [
      ['points', '顯示抓握點', false, (enabled: boolean) => { this.markers.visible = enabled; }],
      ['distance', '啟用抓取距離限制', true, (enabled: boolean) => { this.controller.setDistanceLimitEnabled(enabled); }],
    ] as const) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = checked; input.dataset.carrotGrabToggle = key;
      input.addEventListener('change', () => { changed(input.checked); this.update(1); });
      label.append(input, document.createTextNode(text));
      this.root.append(label); this.toggles.push(input);
    }
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.root.append(this.message, this.metrics); host.prepend(this.root);
    this.markers.name = 'Carrot_Grab_Debug_Points'; this.markers.visible = false;
    this.points.forEach(point => { point.renderOrder = 100; this.markers.add(point); });
    scene.add(this.markers);
    this.update(1);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    for (const control of [...this.buttons, ...this.toggles]) control.disabled = paused;
  }

  update(seconds: number) {
    const hands = this.tracker.sample();
    const grip = this.carrot.gripWorld();
    const positions = [hands.leftGripPosition, hands.rightGripPosition, grip];
    this.points.forEach((point, index) => {
      point.position.copy(positions[index]); point.scale.setScalar(hands.scale);
    });
    this.elapsed += seconds;
    if (this.elapsed < .1) return;
    this.elapsed = 0;
    const data = this.controller.snapshot();
    const point = (value: Vector3) => value.toArray().map(number => number.toFixed(3)).join(', ');
    this.message.textContent = data.reason;
    const owner = data.owner === 'Rabbit final-bone hand attachment' ? '雙手附著控制器' : '蘿蔔世界變換';
    this.metrics.textContent = [
      `抓取狀態 ${data.state}`,
      `左手握點 ${point(hands.leftGripPosition)}`,
      `右手握點 ${point(hands.rightGripPosition)}`,
      `雙手中點 ${point(hands.gripMidpoint)}`,
      `蘿蔔握點 ${point(grip)}`,
      `左手距離 ${hands.leftGripPosition.distanceTo(grip).toFixed(4)}`,
      `右手距離 ${hands.rightGripPosition.distanceTo(grip).toFixed(4)}`,
      `雙手間距 ${hands.span.toFixed(4)}`,
      `每手距離上限 ${data.maxHandDistance.toFixed(4)}`,
      `接近條件 ${data.contactSatisfied ? '符合' : '未符合'}`,
      `握點誤差 ${data.attachmentError.toFixed(6)}`,
      `控制來源 ${this.controlSource()} · ${owner}`,
      '藍色 左手 · 粉紅色 右手 · 橙色 蘿蔔',
    ].join('\n');
  }

  destroy() {
    this.root.remove(); this.markers.removeFromParent(); this.markers.clear();
    this.geometry.dispose(); this.materials.forEach(material => material.dispose());
  }
}

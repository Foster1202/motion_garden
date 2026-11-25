export type BerrySide = 'left' | 'right';
export const BERRY_CONFIG = {
  durationOptions: [60, 90, 120], defaultDurationSeconds: 120, berriesPerHit: 3,
  maxTargetStreak: 3,
  cooldownMs: 1000, retractThreshold: 0.15, extensionThreshold: 0.32,
  rootTravel: 290, rootSpeed: 250, feetY: 730,
  tree: { left: 440, right: 1160, y: 735, width: 380, height: 470 },
} as const;
export interface FootPoint { x: number; y: number; visible: boolean }
export interface TreeTrunkHitZone { x: number; y: number; width: number; height: number }
export function treeTrunkZone(side: BerrySide): TreeTrunkHitZone {
  const width = BERRY_CONFIG.tree.width * .13;
  const height = BERRY_CONFIG.tree.height * .55;
  return { x: BERRY_CONFIG.tree[side] - width / 2, y: BERRY_CONFIG.tree.y - height, width, height };
}
export function footInTrunk(foot: FootPoint, zone: TreeTrunkHitZone): boolean {
  return foot.visible && Number.isFinite(foot.x) && Number.isFinite(foot.y)
    && foot.x >= zone.x && foot.x <= zone.x + zone.width && foot.y >= zone.y && foot.y <= zone.y + zone.height;
}
export const BERRY_ASSETS = ['background', 'tree_left', 'tree_right', 'berry', 'basket', 'foreground'] as const;
export const berryKey = (name: string) => `berry-${name}`;
export const berryFile = (name: string) => name === 'berry' ? 'berry.png' : `berry_${name}.png`;

// Irregular attachment points follow the rendered orchard boughs.
export const BERRY_FRUIT_ANCHORS = {"left": [[0.24, 0.265], [0.42, 0.16], [0.66, 0.205], [0.78, 0.31], [0.55, 0.3], [0.34, 0.365], [0.63, 0.385], [0.18, 0.36], [0.46, 0.425]], "right": [[0.25, 0.235], [0.49, 0.15], [0.73, 0.25], [0.82, 0.355], [0.61, 0.325], [0.37, 0.3], [0.22, 0.385], [0.48, 0.415], [0.67, 0.4]]} as const;

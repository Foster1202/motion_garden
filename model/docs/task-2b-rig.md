# Task 2B — 阿兔 Rig 與 Carrot Pull 基礎動畫

基於現有 `rabbit_base.blend` 建立 **19 根骨骼的混合綁定**及六個 Blender Actions。模型造型、原始 mesh 頂點／拓撲、材質、正面方向及 Task 2A 相機均保留。未重新執行 `create_rabbit.py`，沒有建立替代角色。

## 檔案

```text
assets/blender/rabbit/
  rabbit_base.blend             # Task 2A 原始檔，保持不變
  rabbit_rigged.blend           # Task 2B：rig + 六個 Actions
assets/rendered/rabbit/animation_previews/
  rabbit_idle_preview.png
  rabbit_bend_preview.png
  rabbit_grab_preview.png
  rabbit_return_preview.png
  rabbit_pull_preview.png
  rabbit_celebrate_preview.png
scripts/blender/
  rig_rabbit.py
  animate_rabbit.py
  validate_rig.py
rabbit_rig_report.json
rabbit_rig_validation.json
```

Blender **5.2.1 LTS**，執行檔 `/Applications/Blender.app/Contents/MacOS/Blender`，Eevee（`BLENDER_EEVEE`）。使用該版本原生 layered Action／channelbag API，沒有安裝外掛。

## 骨架階層

`Rabbit_Rig` 是 `Rabbit_Root` 下的 Armature。骨骼以角色自身命名：L=+X、R=−X；front=−Y、up=+Z。

```text
root
├── body
│   ├── head
│   │   ├── ear.L
│   │   └── ear.R
│   ├── upper_arm.L → forearm.L → hand.L
│   ├── upper_arm.R → forearm.R → hand.R
│   ├── thigh.L → shin.L → foot.L
│   ├── thigh.R → shin.R → foot.R
│   └── tail
└── carrot_socket
```

共 **19 bones**；`root`、`carrot_socket` 是非 deform 骨骼。保留自然站立的 Rest Pose，沒有重新擺成 T-pose 或改變比例。

## 綁定方式

| 部件 | 方法 |
| --- | --- |
| Rabbit_Body | Bone parent → body |
| Rabbit_Head | Bone parent → head |
| Rabbit_Ear_L / R | Bone parent → ear.L / R |
| Rabbit_Tail | Bone parent → tail |
| Rabbit_Arm_L / R | Armature Modifier + upper_arm／forearm／hand 手動權重 |
| Rabbit_Leg_L / R | Armature Modifier + thigh／shin／foot 手動權重 |
| 雙眼、鼻、嘴部曲線、紅暈 | 保留原父子階層，跟隨 Rabbit_Head |
| 眼神高光、耳內 | 保留原父子階層，分別跟隨眼睛、外耳 |
| Carrot_Attach_Point | Empty，bone parent → carrot_socket |

沒有使用自動權重。四個肢體 mesh 的權重依原始位置平滑分配，各頂點 deform weights 總和為 1，啟用 preserve volume。modifier 順序為 **Armature → 原有 Subdivision Surface Level 1**，讓細分平滑變形後的短肢體；其他原有細分設定不變。

頭、耳及臉部沒有變形權重，避免眼睛漂移、耳內分離及紅暈脫離頭部。沒有增加、刪除或改寫原始 mesh 的頂點／面。

## 動作、幀範圍與預覽

全部 **24 fps**，從 frame 1 開始。每個 Action 都保留 fake user，存檔重開後不會因未使用而消失。

| Action | Frame range | 播放幀數／24 | 預覽 frame | 動作 |
| --- | --- | --- | --- | --- |
| Rabbit_Idle | 1–48 | 2.00 秒 | 13 | 輕微呼吸、頭耳微動；首尾同姿勢 |
| Rabbit_Bend | 1–16 | 0.67 秒 | 16 | 身體下降 0.10 單位、腿部淺屈、手向前準備 |
| Rabbit_Grab | 1–16 | 0.67 秒 | 16 | 保持低位，雙手向前合攏、微微低頭 |
| Rabbit_Return | 1–16 | 0.67 秒 | 16 | 平穩站回，雙手保持握物形狀 |
| Rabbit_Pull | 1–20 | 0.83 秒 | 14 | 短暫準備、雙手上拉、身體略後移，然後穩定 |
| Rabbit_Celebrate | 1–32 | 1.33 秒 | 12 | 雙手舉起、輕微頭耳動作，最後回到 Idle |

實際首末幀之間有 N−1 個時間間隔；表中秒數是 N 幀播放時間。Idle 的最後一幀與第一幀相同，未來匯出 loop 時可選擇省略重複末幀；本階段未做匯出流程。

動畫採平滑時間曲線採樣，再逐幀烘焙 location／quaternion／scale。F-curves 使用 linear interpolation，避免曲線插值越過已驗證的位置。每個 Action 有 190 條非空曲線。沒有 dynamics、快速跳躍、強烈 squash/stretch 或強烈 motion blur。

## 固定腳掌與動畫銜接

手腳使用 Python 的兩段式幾何求解，再烘焙為 FK。**每一幀的 foot 骨骼世界矩陣不變**，底部頂點完全跟隨 foot；身體下降時由 thigh／shin 分擔彎曲。動作只降低身體約角色全高 2.8%，並非深蹲。

以下接點以實際評估後的全部角色頂點比對：

```text
Idle 48 = Bend 1
Bend 16 = Grab 1
Grab 16 = Return 1
Return 16 = Pull 1
Pull 20 = Celebrate 1
Celebrate 32 = Idle 1
Idle 1 = Idle 48
```

這是已烘焙 Actions 的固定腳掌保證，**不是即時 GUI IK 控制器**。若在 Blender 手動改動單根骨骼，腳掌不會自動重新求解；可修改 `animate_rabbit.py` 的姿勢參數再重建。任意中途切換 Actions 的 crossfade 不在此階段實作。

## 蘿蔔附著點

- 實體物件：`Carrot_Attach_Point`（Empty）。
- 骨骼：`carrot_socket`，父骨骼為 root。
- 位置定義：`(hand.L.head + hand.L.tail + hand.R.head + hand.R.tail) / 4`。
- 每一個烘焙幀都更新，保持在雙手中心之間；位置會隨握取、站起及上拉改變。
- Empty 的 +Z 朝上，−Y 向前，適合後續加入直立蘿蔔；本次沒有建立蘿蔔 mesh 或釋放道具邏輯。
- Grab 的預覽位置約 `(0, -0.470, 1.100)`，Pull 峰值約 `(0, -0.460, 1.500)`；Grab 以肩膀下方的向前握取為主，未誇張伸手到地面。
- 各預覽幀的精確世界座標記錄於 `rabbit_rig_report.json` 的 `socket.world_positions_at_preview_frames`。

## 完整重新生成

從 `game/model/` 執行：

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/animate_rabbit.py
```

預設會重新載入 **rabbit_base.blend** → 建立 rig → 六組 Actions → 儲存 **rabbit_rigged.blend** → 實際渲染六張透明 PNG。它不呼叫 Task 2A 生成器，也不修改 base 檔案。每次從同一 base 開始，因此不會累積 Armature 或 Actions。

其他模式：

```sh
# Rebuild Actions on the saved rig, then save and render.
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/animate_rabbit.py -- --actions-only

# Render the six previews without rewriting the saved blend.
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/animate_rabbit.py -- --render-only

# Rebuild the rig and Actions without rendering.
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/animate_rabbit.py -- --no-render

# Validate the saved asset, all 148 frames, and all six PNGs.
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/validate_rig.py
```

`rig_rabbit.py` 也可獨立執行，但它只建立 rig，會把 `rabbit_rigged.blend` 重設為**未含 Actions**的版本；通常使用 `animate_rabbit.py` 完整指令即可。手動修改成果請先另存，生成腳本會改寫其同名輸出。

`--actions-only` 會先清除舊的六組同名 Actions，再建立新版本。完整流程及 actions-only 重複生成均已實際執行，重新開啟後保持 1 個 Armature、19 bones、6 個 Actions，沒有 `.001` 副本。

## 在 Blender 檢查動作

開啟 `rabbit_rigged.blend`，選擇 `Rabbit_Rig`，在 Dope Sheet 的 Action Editor 選擇上述 Action，並將播放範圍設為表內的 frame range。儲存檔預設選取 Rabbit_Idle，停在 frame 1。

也可從 Blender Python Console 使用已驗證的 helper：

```python
import sys, bpy
sys.path.insert(0, "/Users/foster/Documents/2026:27 Y4 S1/BME3S02/game/model/scripts/blender")
from animate_rabbit import select_action
select_action(bpy.data.objects['Rabbit_Rig'], bpy.data.actions['Rabbit_Grab'])
bpy.context.scene.frame_set(16)
```

此 helper 同時選取正確 Action slot 和播放範圍，不建立新 keyframes。

## 驗證結果與實際限制

- 保存檔重開、骨骼、綁定、非空 keyframes、幀範圍、父子關係、原始材質與相機：**PASS**。
- 全部 **148 個整數幀**都評估了角色 geometry、鏡頭邊界、地面高度、腳底位移及 socket 位置。
- 腳底最大位移約 **2.73 × 10⁻⁷** 個模型單位，屬浮點誤差，未出現可見 foot sliding 或跳離地面。
- Rest geometry 與原始檔最大差異約 **5.17 × 10⁻⁷** 個模型單位；原始 base 頂點／拓撲、材質和相機設定保持不變。
- 所有上述接點及 Idle 首尾的評估頂點差異為 **0**。
- 六張 PNG 均為 **1024×1024 RGBA、透明背景**，耳朵與腳完整入鏡。
- 目視檢查後已調整肘部屈曲幅度、權重過渡與 modifier 順序，減輕局部摺痕。短腿在低姿勢仍有輕微軟摺／壓縮，沒有拆開幾何或改造主要形體。
- 自動驗證不是通用穿模檢測器；這套簡單 rig 的確認範圍是交付的六個動作和固定正面相機，未宣稱任意大幅度姿勢都無穿模。

原始 base SHA-256：

```text
7bbaa295ebd941fcac526692540872039b1aec453616efa771114c32502a0b34
```

詳細數據見 `rabbit_rig_validation.json`。

## Task 2B 邊界

目前已適合在你檢查後進入固定相機的 spritesheet render pipeline：Actions 名稱、幀率、方向、腳底位置及相機一致，渲染可重複。

**本階段停在 Task 2B**。沒有 spritesheet、atlas JSON、Phaser 整合、正式蘿蔔模型、花園場景、MediaPipe、webcam、遊戲 state machine、AI 動作回饋或粵語音訊。

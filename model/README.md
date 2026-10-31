# Motion Garden · 阿兔 Blender 資產

目前新增 **Task 2E-1：Carrot Pull Blender 場景資產**，包括可重建 `.blend`、七層 RGBA PNG、道具 pivot metadata 及合成 QA。此任務未修改 Phaser。

- [Task 2E-1 說明及命令](docs/task-2e1-carrot-scene.md)
- [場景 Blender 文件](assets/blender/scenes/carrot_pull_scene.blend)
- [最終合成預覽](qa/carrot_pull/carrot_pull_scene_preview.png)
- [七層 PNG 與 metadata](assets/rendered/carrot_pull/)
- [Task 2C spritesheet 說明](docs/task-2c-spritesheets.md)

---

以下保留 **Task 2B：19 根骨骼的混合 rig、6 個 Actions 與 6 張透明關鍵姿勢預覽**。詳細綁定、幀範圍、重建指令與驗證結果見 [Task 2B 說明](docs/task-2b-rig.md)。

- 模型：[rabbit_rigged.blend](assets/blender/rabbit/rabbit_rigged.blend)
- 六張預覽：[animation_previews/](assets/rendered/rabbit/animation_previews/)
- 完整重建：[animate_rabbit.py](scripts/blender/animate_rabbit.py)
- 驗證結果：[rabbit_rig_validation.json](rabbit_rig_validation.json)

Task 2A 的 `rabbit_base.blend` 與生成腳本保持不變。此段為 Task 2B 當時紀錄；後續 spritesheet 與 Phaser 整合已另行完成。

---

以下保留 **Task 2A 基礎模型**的紀錄；其中「尚未 rig」及原始物件階層均指 `rabbit_base.blend`，不代表新的 `rabbit_rigged.blend`。

造型以提供的 **Motion Garden Concept Board** 白兔為主要參考，採用原創、無衣、圓潤玩具公仔風格。

## Blender 環境

- 實際執行版本：**Blender 5.2.1 LTS**，build `9e2066aef7ef`。
- 執行檔：`/Applications/Blender.app/Contents/MacOS/Blender`。
- `blender` 沒有加入 shell PATH，以下使用完整路徑。
- 引擎：**Eevee**，本版本 Python identifier 為 `BLENDER_EEVEE`。
- macOS graphics backend：Metal；未使用 Cycles。
- 沒有安裝或下載其他 Blender 版本、外掛、模型或紋理。
- 本次沙箱內的背景程序曾在 Python 執行前退出；透過獲准的沙箱外 CLI 執行後正常完成。最終生成、重新渲染及驗證指令均以 exit code 0 結束，沒有 fatal error。
- 腳本以此實際安裝版本驗證，未聲稱跨 Blender 版本相容。

## 交付檔案

```text
model/
├── README.md
├── assets/
│   ├── blender/rabbit/rabbit_base.blend
│   └── rendered/rabbit/rabbit_front_preview.png
├── scripts/blender/
│   ├── create_rabbit.py
│   └── validate_rabbit.py
├── rabbit_model_report.json
└── rabbit_validation.json
```

`rabbit_base.blend` 包含角色、正交正面相機、三盞柔光燈及預覽地面。所有材質由檔案內的節點／頂點色建立，沒有外部貼圖依賴。`rabbit_model_report.json` 記錄每個部件的父物件、世界座標原點、面數、材質及 modifier；`rabbit_validation.json` 記錄實際重開檔案與 PNG 檢查結果。

## 重新生成

從本資料夾執行：

```sh
cd "/Users/foster/Documents/2026:27 Y4 S1/BME3S02/game/model"

"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/create_rabbit.py
```

這會重建 `.blend`、更新統計並輸出正面 PNG。腳本啟動自己的空白 Blender 場景，不會操作目前 GUI 中開啟的文件；同名交付檔案會被重新生成，因此手動修改的模型應另存版本。

只建立模型，不渲染：

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/create_rabbit.py -- --no-render
```

可在 `--` 後加上 `--output-root "/另一個輸出資料夾"`，生成另一份資產，無需更改腳本內路徑。

## 只重新渲染已儲存的模型

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/create_rabbit.py -- --render-only
```

此模式開啟 `rabbit_base.blend`，使用儲存的場景重新渲染，不重建幾何、不改寫 `.blend`。若在 Blender GUI 修改材質或姿勢，須先儲存再執行。

## 座標、比例與階層

- **正面 = -Y，向上 = +Z。** 正面相機位於負 Y，看向 +Y。
- 左右名稱以角色自身為準：`L = +X`、`R = -X`。正面觀看時，角色左側在畫面右側。
- `Rabbit_Root` 位於 `(0, 0, 0)`；角色左右對稱於 X=0。
- 腳底最低點約 **Z=0.00438**；整體高度約 **3.600** Blender 單位。場景採 Metric／scale 1，但此為風格化資產單位，不是兔子的真實尺寸。
- 頭部高度約佔全高 **38%**；長耳、梨形小身體、短手與整合腳掌的短腿。
- 主要部件 scale 為 1；形狀已直接寫入 mesh。頸部、肩部、髖部、耳根附近設有對應部件原點，便於下一步旋轉控制。

```text
Rabbit_Character [Collection]
└── Rabbit_Root [Empty]
    └── Rabbit_Body
        ├── Rabbit_Head
        │   ├── Rabbit_Ear_L
        │   │   └── Rabbit_InnerEar_L
        │   ├── Rabbit_Ear_R
        │   │   └── Rabbit_InnerEar_R
        │   ├── Rabbit_Eye_L
        │   │   └── Rabbit_EyeHighlight_L
        │   ├── Rabbit_Eye_R
        │   │   └── Rabbit_EyeHighlight_R
        │   ├── Rabbit_Cheek_L
        │   ├── Rabbit_Cheek_R
        │   ├── Rabbit_Nose
        │   ├── Rabbit_Mouth_Stem [Curve]
        │   ├── Rabbit_Mouth_L [Curve]
        │   └── Rabbit_Mouth_R [Curve]
        ├── Rabbit_Arm_L
        ├── Rabbit_Arm_R
        ├── Rabbit_Leg_L [Includes rounded foot]
        ├── Rabbit_Leg_R [Includes rounded foot]
        └── Rabbit_Tail

Studio_Preview [Collection]
├── Studio_Ground
├── Studio_Key
├── Studio_Fill
├── Studio_Rim
└── Camera_Front_Orthographic
```

## 幾何與 modifiers

- **18 個 mesh + 3 條嘴部曲線 + 1 個角色根物件**。
- 基礎 mesh：**8,384 polygons**。
- 套用評估後的細分與曲線幾何：**25,048 polygons／49,632 triangles**，不包含地面與燈光。
- 頭、身體、雙耳、雙手、雙腿、尾巴共 **9 個 Subdivision Surface modifiers**；Catmull–Clark，viewport/render 均為 **Level 1**。
- 所有 mesh 採 smooth shading；嘴部使用有封口的 Bezier 曲線，bevel depth 0.010、bevel resolution 3。曲線 bevel 是曲線資料設定，不是 Bevel modifier。
- 無 Mirror、Armature、粒子、毛髮、動態拓撲或 simulation。
- 14 個體積 mesh 已驗證為封閉 manifold，體積及外向法線正常。
- 兩塊耳內及兩塊紅暈是**刻意保留的開放表面貼片**，不是獨立封閉體積。紅暈透過 ray projection 貼合細分後的頭部，再保留 0.00065 的微小表面偏移。

## 材質

| 材質 | sRGB 設計色 | Roughness | 用途 |
| --- | --- | --- | --- |
| Rabbit_WarmIvory | `#F5EFE4` | 0.68 | 頭、身體、四肢、耳、尾巴 |
| Rabbit_InnerEarPink | `#E8AEA4` | 0.72 | 柔粉紅耳內 |
| Rabbit_EyeEspresso | `#38251F` | 0.30 | 小型深啡眼睛 |
| Rabbit_NoseRoseBrown | `#B76F64` | 0.60 | 小鼻子 |
| Rabbit_SmileBrown | `#885046` | 0.70 | 細小 W 形微笑 |
| Rabbit_EyeCatchlight | `#FFF6E5` | 0.45 | 小眼神高光 |
| Rabbit_SoftBlush | `#EBA99E` → 暖白 | 0.68 | 頂點色淡出紅暈 |

全部使用 Principled BSDF，Metallic=0。除了紅暈的 `BlushTint` 頂點色直接接 Base Color，沒有複雜材質網絡；沒有 image textures、UV 紋理依賴或 realistic fur。色值在腳本中由 sRGB 轉為 Blender 線性色彩；最終外觀另受燈光及 AgX 影響。

## 相機、燈光與透明輸出

- 固定正交前視；orthographic scale **4.20**，沒有廣角變形。
- 三盞 Area light：soft key、fill、rim，配合柔和 world illumination。
- 色彩管理：AgX，exposure **+0.65**。
- PNG：**1024×1024、RGBA、8-bit、透明背景**。
- `Studio_Ground.hide_render = True`：地面供建模／預覽使用，透明 PNG 不輸出不透明地板，也不包含地面陰影。角色本身仍有柔和光影。
- PNG 輪廓實際 pixel bounds：X=302–721，Y=72–950（Blender bottom-origin）。耳、腳及手臂沒有被裁切；全部邊界像素 alpha=0，約 77% 像素完全透明。
- 透明圖片在某些檢視器會顯示黑色或棋盤背景，這不是烘焙進圖片的背景。

## 重跑驗證

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/validate_rabbit.py
```

驗證腳本會開啟本資料夾預設輸出的 `.blend`，檢查名稱、父子關係、材質、modifier、封閉體積／貼片法線、腳底位置、相機邊界及實際 PNG 的 alpha channel，並寫入 `rabbit_validation.json`。

本次結果：**PASS**。模型已多次重新生成，儲存檔案已用新的 Blender 程序重新開啟及渲染；最後一次生成、單獨重新渲染及驗證皆正常退出。另已目視檢查正面表情、紅暈、輪廓及完整入鏡。沒有進行 rig 或動畫測試。

## 下一階段的綁骨準備

**適合開始分件式／剛體式角色綁骨。** 頭、身體、耳及四肢分離，已有合適 pivot 和 parent hierarchy。可先建立 root、body、head、雙耳及四肢控制，再驗證 idle、淺屈膝、伸手抓取及站立時的輪廓。

目前是互相交疊的乾淨造型部件，**不是已完成連續關節拓撲或權重的角色**。若要柔性肩膀、膝部彎曲、身體形變或更大動作，下一階段須決定關節分段、局部拓撲、權重及交疊處處理，不能直接假設自然變形。臉部目前隨頭部作剛體移動；若新增頭部 shape deformation，需一併處理紅暈表面跟隨。

Task 2A 沒有建立骨架、weight painting、動作、spritesheet、側／背／3/4 成品視角、花園場景、Phaser 整合、MediaPipe 或 webcam 功能。

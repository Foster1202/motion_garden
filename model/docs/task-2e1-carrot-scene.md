# Task 2E-1 — Carrot Pull Blender 場景資產

已完成 Blender 建模、七層 PNG、可重建腳本及合成 QA。全部產物位於 `game/model/`；未修改 Phaser、RabbitCharacter、state machine、HUD、Rabbit 模型或現有公開資產，未同步新場景至遊戲。

## 參考與視覺方向

已實際檢視使用者提供的 `/Users/foster/Downloads/Motion Garden Concept Board.png`，並與現有 `assets/rendered/rabbit/frames/idle/rabbit_idle_000.png` 合成比較。採用圓團樹冠、暖木色、厚實蘿蔔、簡化花草、淺色彎曲小路和柔和啞光材質。中央細節及飽和度比概念板克制，保留遊戲提示空間；沒有加入房屋、蘋果、寫實樹皮、外部貼圖或複雜草葉。

## 文件與模型

- 場景：`assets/blender/scenes/carrot_pull_scene.blend`
- 分層圖：`assets/rendered/carrot_pull/`
- 放置／pivot／相機／SHA256：`assets/rendered/carrot_pull/carrot_scene_assets.json`
- 精確 object 清單及光源數值：`qa/carrot_pull/scene_manifest.json`
- 場景生成：`scripts/blender/create_carrot_scene.py`
- 獨立物件：`scripts/blender/carrot_scene_props.py`
- 單層／全部渲染：`scripts/blender/render_carrot_scene_assets.py`
- 重開 Blender 驗證：`scripts/blender/validate_carrot_scene.py`
- PNG 及合成驗證：`scripts/sprites/qa_carrot_scene_assets.py`

共 **331 個 Blender objects**，包括 323 個分層物件、相機、四盞燈及三個不渲染的定位 Empty。沒有 Rabbit mesh 或 armature。七個 collection 可分別編輯及渲染：

| Layer | 尺寸 | 內容 | Object 數 |
|---|---:|---|---:|
| background_far | 1920×1080 | 淺藍天空、3 團柔雲、4 座圓潤遠山、3 道遠丘 | 11 |
| background_mid | 1920×1080 | 草地、4 棵樹、篱笆、彎曲小路、小石片、左側蘿蔔地、灌木與少量花朵 | 143 |
| platform | 1920×1080 | 厚圓角橢圓木台、11 塊沿圓弧裁切的木板、細微木紋 | 34 |
| foreground | 1920×1080 | 畫面邊角的 8 組花草，中央透明 | 88 |
| soil_patch | 512×512 | 圓潤泥土、8 個邊緣土塊、中央凹陷洞口 | 11 |
| carrot | 512×512 | 橙色根、5 片綠葉、2 條淺紋及握點 root | 9 |
| basket | 512×512 | 開口籃身、橫向編織圈、直向細條、圓角邊緣、拱形提把及 root | 27 |

全部 PNG 為 8-bit RGBA、straight alpha、sRGB。天空由真正的 backdrop geometry 繪成，故 `background_far` 的畫布被天空填滿；它仍是獨立 RGBA 圖層。其餘六層有透明像素。木台保留 1920×1080 登記畫布，以便與遠景、中景、前景共用 `(0,0)` 放置，沒有裁切座標猜測。

## 相機、光照與材質

場景相機 `Camera_Scene_65mm`：Perspective，焦距 **65 mm**，sensor width **36 mm**，位置 **(0, −40, 16)**，看向 **(0, 1, 2.5)**，俯角 **18.225°**。16:9、1920×1080、Eevee、64 render samples、AgX、exposure +0.65，透明 film。

獨立物件使用相同焦距與方向，以 evaluated bounds 自動計算拍攝距離及留白，輸出 512 方圖。相機位置寫入每層 metadata。Rabbit 既有素材為水平正交正面視角；本場景是輕俯視長焦透視，兩者並非完全同一投影。這是展示地面和木台的 2.5D 組合，已用原 Rabbit 透明圖驗證視覺相容性。

| 光源 | 位置 | 強度 | 尺寸／柔度 |
|---|---|---:|---|
| Outdoor_Key | (−10, −12, 16) | 2400 W | disk size 10，暖色 |
| Outdoor_Fill | (10, −8, 10) | 1500 W | disk size 10，偏冷補光 |
| Outdoor_Rim | (5, 9, 15) | 1700 W | disk size 9，暖色 |
| Soft_Sun | 左前上方向 | 1.0 | angular diameter 18° |

World 顏色與 Rabbit 相同 `(0.78,0.82,0.88)`，strength 0.30。物件特寫時 area light 位置乘 0.35、功率乘 0.1225、size 3.5，維持相近照度與方向。環境 roughness 0.72，獨立道具 0.75，metallic 0；Rabbit 原材質 roughness 約 0.60–0.72。沒有 HDRI 或外部紋理；柔和陰影與亮面方向一致。

## 蘿蔔握點與後續座標約定

`Carrot_Grip_Root` 的 local origin = **(0,0,0)**，位於葉與橙色根的交界／手握位置。+Z 為葉，−Z 為根，正面為 −Y。根長約 1.1 Blender 單位，最大直徑約 0.52；葉高約 0.65。

本次 512×512 PNG 投影握點：

- `pivotPixels = (254.610336, 212.798248)`
- `origin = (0.497285813, 0.415621579)`

下階段應讀 metadata 的完整精度，將 carrot origin 設為以上標準化座標，再把 sprite position 對準 Rabbit attachment world point。這是 **carrot 自己的 origin**，不能代替 Rabbit 的 `(0.5,0.928719)`。

QA 中 Rabbit 腳底固定 `(1072.8,817.2)`，是現有 1600×900 遊戲座標的 1.2 倍；Rabbit 512 幀 uniform scale 0.9348519362。可見高度約 410 px，約畫高 38%。道具建議 anchor／scale 全記於 metadata：

- carrot grip `(1073,827)`、scale 0.44；預覽只保留握點以下 22 source pixels，模擬插在泥土內，**完整 carrot.png 未裁去根部**。
- soil surface center `(1073,833)`、scale 0.40。
- basket local ground origin `(1494,858)`、scale 0.60。

以上是美術構圖建議，並非本次修改遊戲中的座標。進入 Task 2E-2 時，還需按實際 Grab/Pull 幀對齊種植位置及 attach 過渡。

## QA 與驗證

- `qa/carrot_pull/carrot_pull_scene_preview.png`：七層加現有 Rabbit；Rabbit 腳下加一個 **只存在於 QA** 的柔和接觸陰影，後續可沿用現有角色 shadow。
- `carrot_pull_scene_hud_guide.png`：標示現有 HUD、提示、步驟、蓄力條及腳底線，沒有修改遊戲 UI。
- `carrot_pull_layers_contact_sheet.png`：七層獨立縮圖。
- `carrot_pull_props_edges.png`：白底、深底、棋盤底的物件／平台透明邊緣。
- `carrot_scene_validation.json`：七層尺寸、RGBA、alpha bounds 檢查 PASS。
- `blender_validation.json`：重開保存文件、七層 inventory、相機、無外部貼圖、物件父子及有限座標檢查 PASS。
- `reproducibility_validation.json`：重建後 object inventory 相同、七張 PNG 的 SHA256 完全相同；52 個受保護遊戲／Rabbit 文件均未變。

已實際檢視最終合成、HUD guide 及深淺背景邊緣，並由第二個代理獨立複核：阿兔保持主體、中央清楚、籃子可見、蘿蔔可辨、無可見黑邊，初稿的雲朵接縫、草地遮山、萝蔔懸浮已修正。上方 HUD／提示／步驟區保持簡潔。**下方蓄力條區域會覆蓋木台紋理與泥土底緣，Task 2E-2 應檢查其文字／進度條對比。** 這不是已驗證的 Phaser runtime 整合。

## 重建與渲染命令

在 `game/` 目錄：

```sh
# Build scene, render all layers, reopen/validate blend, regenerate composite QA.
bash model/scripts/build_carrot_scene_assets.sh

# Preserve saved geometry and render only one layer; refresh composite QA.
bash model/scripts/build_carrot_scene_assets.sh --render-only --layer carrot

# Other choices: background_far, background_mid, platform, foreground, soil_patch, basket, all.
```

`BLENDER_BIN` 預設 `/Applications/Blender.app/Contents/MacOS/Blender`；本機以 Blender **5.2.1 LTS** 實測。`SCENE_PYTHON` 可指定含 Pillow 11.3.0 的 Python。預設建立／重用 `/tmp/motion-garden-sprites-venv`；專案路徑含 `:`，故 Python venv 不放在專案內。

也可分開執行：

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --python-exit-code 1 \
  --python model/scripts/blender/create_carrot_scene.py
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --python-exit-code 1 \
  --python model/scripts/blender/render_carrot_scene_assets.py -- --layer all
/tmp/motion-garden-sprites-venv/bin/python model/scripts/sprites/qa_carrot_scene_assets.py
```

腳本使用 factory-empty scene 及固定 seed，不向現有 GUI 場景追加 object；完整重建會覆寫本次交付的場景與輸出，手動改稿請另存。`--render-only` 使用已保存的 `.blend`，不重建 geometry 或保存 `.blend`。首次渲染一層前應先跑一次完整建置，因 composite QA 需要全部七層。腳本不修改、同步或載入任何 Phaser runtime 資源。

**交付可進入 Task 2E-2 場景整合；本階段到此停止。**

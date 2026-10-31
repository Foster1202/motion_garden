# Task 2C — 阿兔 Spritesheet 自動化管線

已完成既有 Blender Actions → 透明逐幀 PNG → 六套 spritesheet → Phaser 3 JSON Hash atlas → attachment metadata → QA GIF／contact sheet。**本階段停在資產管線**，沒有修改 `CarrotPullScene`、Vite、placeholder、遊戲 state machine 或建立 Phaser animations；沒有渲染蘿蔔。

## 輸出規格

| 動作 | 原始 frame range（24 fps） | 採樣數 | 遊戲建議 fps | 每幀 ms | 遊戲時長 | 排列（欄×列） | Spritesheet 尺寸 | repeat |
|---|---|---:|---:|---:|---:|---|---|---:|
| Idle | 1–48 | 12 | 6 | 166.667 | 2.0 s | 4×3 | 2048×1536 | -1 |
| Bend | 1–16 | 8 | 10 | 100 | 0.8 s | 3×3 | 1536×1536 | 0 |
| Grab | 1–16 | 8 | 10 | 100 | 0.8 s | 3×3 | 1536×1536 | 0 |
| Return | 1–16 | 8 | 10 | 100 | 0.8 s | 3×3 | 1536×1536 | 0 |
| Pull | 1–20 | 12 | 12 | 83.333 | 1.0 s | 4×3 | 2048×1536 | 0 |
| Celebrate | 1–32 | 16 | 10 | 100 | 1.6 s | 4×4 | 2048×2048 | 0 |

合計 **64 張**單幀，每張 **512×512、PNG RGBA、8-bit、straight alpha**。未 trim、未縮放、未旋轉，沒有二次抗鋸齒。打包以原始 RGBA bytes 直接貼入，**不以 alpha 當作 paste mask**，避免 alpha 被再次相乘。空白格維持透明。

採用既有 `Camera_Front_Orthographic`，orthographic scale **4.2**，相機 matrix、角色 root／rig matrix、燈光、AgX 與 exposure 全部沿用 Task 2B。渲染引擎 Eevee，24 fps 原始 timeline，透明背景；只有輸出解析度由 1024 改為 512。沒有逐動作自動取景、重定位或縮放。

## 明確採樣規則

共用函式位於 `scripts/rabbit_pipeline.py`：

```python
sample_frames(action_name, start, end, target_count)
```

以動態規劃選出最接近均勻時間格點的整數 source frames；強制保留首尾與指定 extrema，返回嚴格遞增、不重複的列表。Pull 的 2–4 是相同準備姿勢，不作候選，仍保留準備段兩端 1／5。若 target_count 無法容納必選幀便報錯，不默默丟棄峰值。

```text
Idle:      1, 5, 10, 13, 18, 22, 25, 31, 36, 39, 44, 48
Bend:      1, 3, 5, 7, 10, 12, 14, 16
Grab:      1, 3, 5, 7, 10, 12, 14, 16
Return:    1, 3, 5, 7, 10, 12, 14, 16
Pull:      1, 5, 6, 7, 8, 10, 11, 13, 14, 17, 18, 20
Celebrate: 1, 3, 5, 7, 9, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32
```

必選幀：Idle `1/13/25/36/48`；三個過渡動作 `1/16`；Pull `1/5/14/20`；Celebrate `1/12/14/16/18/20/32`。Pull 使用較密的 12 幀，**source 14 為峰值，即輸出 index 008**，未遺失拔出瞬間。Celebrate 的舉手、耳擺峰值與回復全部保留。

遊戲建議使用各動作的**均勻 frameRate**；這是有意放慢／調整節奏，並非完全保留原 24 fps 的每段時間差。Idle 6 fps 保持 2 秒呼吸；其他過渡略放慢以方便觀察。Idle 保留 source 1／48 相同姿勢，loop 邊界會有輕微重複端點停留；未偷偷刪除使用者要求的末幀。

## 腳底 pivot／origin

所有動畫使用同一參考，從 Idle 1 的左右最低 evaluated sole vertices 取中點，再投影到相機：

```text
footAnchorPixels = (256.0, 475.50414276123047)
origin           = (0.5, 0.9287190288305283)
canvasBottomGap  = 36.49585723876953 px
```

原預覽相機在腳底以下有固定透明留白。因此 **`(0.5, 1.0)` 是畫布底中，不是實際腳底**。固定畫布即使使用它也不會跳動，但腳底會在定位點上方約 36.5 px。atlas 的每個 frame 已寫入精確 `pivot`，animation config 也寫入 `origin`；Task 2D 應以此精確值定位。沒有根據每幀透明 bbox 重算 pivot。

## Atlas 和動畫 config

每個動作一張 PNG／一份 **Phaser 3 JSON Hash**：

```json
{
  "frames": {
    "rabbit_pull_008.png": {
      "frame": {"x": 0, "y": 1024, "w": 512, "h": 512},
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": {"x": 0, "y": 0, "w": 512, "h": 512},
      "sourceSize": {"w": 512, "h": 512},
      "pivot": {"x": 0.5, "y": 0.9287190288305283},
      "duration": 83.33333333333333,
      "sourceFrame": 14
    }
  }
}
```

這是單幀結構示意；實際 atlas 包含所有 frames 和 `meta.image/size/format/scale` 等欄位。排列為 row-major，欄數 `ceil(sqrt(count))`，列數 `ceil(count/columns)`，最大邊長不超過 2048。

`rabbit_animations.json` 以 `idle/bend/grab/return/pull/celebrate` 為 key，包含 texture key、PNG／atlas 檔名、明確有序的 `frames`、`frameNames`、`frameRate`、`repeat`、`origin`。**atlas 的 `duration` 是自訂毫秒 metadata，不會自動設定 Phaser 播放時間**；後續採用 config 的 frameRate。配置檔不會自行建立任何 Phaser 動畫。

格式依据：[Phaser 官方 atlas 說明](https://docs.phaser.io/phaser/concepts/textures)。另以本專案安裝的 **Phaser 3.90.0 `JSONHash` parser + `Frame` class** 實際解析六份 atlas，驗證所有 64 幀名稱、尺寸、pivot 及 custom duration 被保留；此測試不啟動遊戲。

## 蘿蔔附著點

`rabbit_attachment_points.json` 記錄 `object: Carrot_Attach_Point`、`socket: carrot_socket`、source hash、coordinate system、共用 anchor，以及 `actions[action]` 中每個 sampled frame 的 `index/name/sourceFrame/x/y`。

切換 Action 和 Action slot，`scene.frame_set` 並更新 dependency graph 後，讀取 evaluated `Carrot_Attach_Point.matrix_world.translation`。使用 Blender `world_to_camera_view` 取得 NDC `(u,v)`，由左下角轉成單幀左上角：

```text
x = u × 512
y = (1 − v) × 512
```

座標保留浮點，**屬於單幀，不含 spritesheet tile offset**。例如 Pull source14／index008 的 attachment 約 `(256.0, 293.17215)`，同幀雙手中心 x 約為 `284.67889`／`227.32109`，y 相同；socket 保持在兩手之間。

後續未旋轉、未翻轉 sprite 的相對世界座標可用 `spritePosition + (attachmentPixels − footAnchorPixels) × spriteScale`。旋轉／翻轉時應套用完整 sprite transform。Celebrate 舉手時附著點會投影到下半臉；Task 2D 的蘿蔔釋放／顯示時機需另行設計。

## 完整命令

從 `game/model/` 執行：

```sh
./scripts/build_rabbit_assets.sh

# Rerender and replace only one action, preserving compatible others.
./scripts/build_rabbit_assets.sh --action pull

# Repack existing frames and regenerate metadata and QA.
./scripts/build_rabbit_assets.sh --skip-render
```

預設 Blender：`/Applications/Blender.app/Contents/MacOS/Blender`。Python 3 建立獨立 venv 於 `${TMPDIR:-/tmp}/motion-garden-sprites-venv`，首次自動安裝 `scripts/sprites/requirements.txt` 的 **Pillow 11.3.0**。使用暫存路徑是因專案目錄的 `2026:27` 含 `:`，Python 不允許在這種路徑建立 venv。暫存環境被系統清除後，下一次建置會重新建立。

可指定既有 runtime：

```sh
BLENDER_BIN=/path/to/Blender SPRITE_PYTHON=/path/to/venv/bin/python \
  ./scripts/build_rabbit_assets.sh
```

這台 Mac 的驗證使用 Blender **5.2.1 LTS／Eevee**。受限制的執行環境若無法使用 Metal，Blender 會在初始化 GPU 時失敗；Codex 本次經執行權限檢查後完成實際 GPU 渲染。一般 Terminal 可直接執行上述命令。

低階入口：

```sh
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/render_rabbit_frames.py -- --action all

"$SPRITE_PYTHON" scripts/sprites/build_rabbit_spritesheets.py --action all

# Validate source geometry and sampling without rendering.
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/render_rabbit_frames.py -- --inspect-only
```

低階命令需先設定這兩個環境變數。腳本路徑和輸出路徑都由腳本自身解析；完整 runner 也可從 `game/` 執行 `./model/scripts/build_rabbit_assets.sh`。

每個動作先渲染到 staging，成功後替換該動作的整個 frames 目錄，因此不殘留舊版多餘幀；失败時保留上次完成的輸出。來源 `.blend` 僅讀取，不調用 rig／animation 生成或 save。打包會拒絕 source hash、相機／render 設定或 anchor 不一致的混合素材。

Blender PNG 的日期、耗時和文字資訊會造成檔案 hash 波動，因此以標準庫移除 PNG `tEXt/zTXt/iTXt/tIME` chunks。**IDAT 壓縮像素、alpha 和色彩描述 chunks 原樣保留**，不是重新解碼後重取樣。跨 GPU／Blender 版本不保證逐 byte 相同；本機相同 runtime 的完整重跑已驗證一致。

## 目錄

```text
assets/rendered/rabbit/frames/
  idle/       rabbit_idle_000.png ... manifest.json
  bend/       rabbit_bend_000.png ... manifest.json
  grab/       rabbit_grab_000.png ... manifest.json
  return/     rabbit_return_000.png ... manifest.json
  pull/       rabbit_pull_000.png ... manifest.json
  celebrate/  rabbit_celebrate_000.png ... manifest.json
dist/rabbit/
  rabbit_idle.png          rabbit_idle.json
  rabbit_bend.png          rabbit_bend.json
  rabbit_grab.png          rabbit_grab.json
  rabbit_return.png        rabbit_return.json
  rabbit_pull.png          rabbit_pull.json
  rabbit_celebrate.png     rabbit_celebrate.json
  rabbit_animations.json
  rabbit_attachment_points.json
qa/rabbit/
  index.html
  rabbit_{action}_preview.gif
  rabbit_{action}_contact_sheet.png
  rabbit_{action}_edges.png
  render_validation.json
  asset_validation.json
  phaser_atlas_validation.json
  rebuild_validation.json
```

`index.html` 可直接用瀏覽器開啟查看六個 GIF、重播，以及連結 contact sheets／邊緣圖。GIF 使用不透明棋盤背景、時間四捨五入到 10ms，僅供 QA；相鄰相同姿勢可能由 GIF 編碼器合併成較長一幀，正式 atlas 仍保留指定數量。Idle GIF 循環，其他 GIF 播放一次。

## 驗證結果與限制

- 六張 spritesheet、六份可解析 atlas、兩份 aggregate config，合計 **14 個 dist 檔案**。
- 64 張 PNG 尺寸、RGBA、非空、透明邊界、嚴格幀順序與 mandatory frames 通過；每張 atlas tile 解包後與原 PNG 的全部 RGBA bytes 完全相同。
- 全 148 個 source frames 檢查相機／root／rig 不變、實際 sole 頂點漂移及 socket 跟隨雙手中心。sole 位移上限約 **0.0000151 px**；渲染 alpha ≥16 的腳底基準全部是 pixel **475**，差異 **0 px**。
- 所有指定動作接點與 Idle 首尾 geometry 差異 **0**；渲染的 Idle 首尾有極小抗鋸齒量化差異（最大 RGB 2/255、alpha 4/255），沒有可見姿勢跳變。保留重複端點帶來的輕微停留。
- Pull source14 完整保留；socket 峰值、雙手軌跡與頂點衔接通過。contact sheet 的紅色十字為 socket，藍線為固定 foot anchor。
- 已檢視六個動作 contact sheets，以及代表姿勢在白／深色／棋盤背景的邊緣；未見明顯黑邊、背景殘留、鏡頭縮放跳變或腳底漂移。GIF 畫廊可正常載入及重播。
- Celebrate 短臂彎曲仍有 Task 2B 原有的輕微折角；沒有為此修改 rig。這不是全面穿模檢測，也沒有宣稱任意姿勢／視角無瑕疵。
- 最終完整管線連續重跑，**106 個比對檔案 SHA-256 全部一致**，故意加入的多餘 Pull frame 已清除。原有 **53 個檔案未被改動**，包括兩個 `.blend`、原有腳本、文件和遊戲檔案。
- 3 個 sampler／PNG metadata tests 與 9 個 packer regression tests 通過；Phaser 3.90 parser 驗證 64 幀及自訂 pivot 通過。

測試入口：

```sh
"$SPRITE_PYTHON" -m unittest discover -s scripts -p 'test_rabbit_pipeline.py'
"$SPRITE_PYTHON" -m unittest discover -s scripts/sprites -p 'test_build_rabbit_spritesheets.py'
node scripts/sprites/validate_phaser_atlas.cjs
```

資產與格式已適合進入 **Task 2D Phaser integration**。後續仍需實際接入遊戲驗證畫面大小、速度、origin、蘿蔔跟隨和釋放時機；本階段未開始這些整合。

# 動態花園：阿兔 AI 小教練

Motion Garden Rabbit Exercise Game — BME3S02 Service-Learning 專案，沿用既有3D兔子／mocap整合，目前支援鏡頭自動動作設定、連續 3D 同步與手動設置。

Carrot Pull 支援單一鏡頭或鍵盤測試。鏡頭模式按當次個人範圍辨識站立、淺屈膝及 tracking 狀態。「AI 小教練」是專案名稱，這些角度只用作遊戲控制訊號。

## 協作與授權

所有 agent／task 先閱讀並持續更新 [AGENTS.md](AGENTS.md)；完成改動後以簡潔 commit 訊息提交並 push 到 GitHub。軟體採 PolyForm Noncommercial 1.0.0；原創美術及文檔採 CC BY-NC 4.0，見 [授權範圍](LICENSES/README.md)。

目前亦有完整「莓果大豐收」：左右移動、伸腳碰樹、每邊三次；詳見 [遊戲文檔](docs/berry-kick-game.md)。拔蘿蔔的體感模式支援完整即時 3D 五輪遊戲，鍵盤模式使用完整 Sprite 流程。

## 安裝與啟動

需要 Node.js 22.12 或以上及 npm。

```sh
cd motion_garden # 克隆後的倉庫目錄；現有課程工作區則使用 game/
npm ci
npm run sync:assets
npm run dev
```

預設網址 `http://127.0.0.1:5173/`。dev launcher 透過暫存 symlink 處理上層路徑中的冒號，不改動原始檔位置或放寬 Vite 檔案存取限制。若 npm 共用快取無寫入權限，使用 `npm ci --cache /tmp/motion-garden-npm-cache`。

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

`sync:assets` 同步 Rabbit atlas、rabbit3d GLB、Berry 圖層、Carrot Pull 七張 PNG／metadata，以及 MediaPipe WASM。`sync:mediapipe` 可單獨同步 WASM，並驗證模型 SHA256。Runtime 只讀 public 資產，不讀 model 目錄。

## 輸入模式

首頁「開始遊戲」→「拔蘿蔔」→ 選擇模式。鍵盤直接開始。鏡頭先等候人物入鏡，再自動進行自然站立及舒服淺屈膝設定。

- **體感模式**：按「開啟鏡頭」才申請 camera permission。讓鏡頭看到肩、臀、膝和腳踝，按照指示完成動作設定後自然企直。阿兔會自動建立穩定參考並進入即時 3D 遊戲。舒服地淺屈膝並保持後，阿兔會輔助捉住高架花槽的蘿蔔，慢慢企直便逐漸拔出並放入籃。右下角顯示去抖人體狀態。
- **鍵盤測試**：按「使用鍵盤測試」。不申請鏡頭，不初始化 MediaPipe。`↓`／`S` 屈膝，放開後按 `↑`／`W` 站立。
- 「切換輸入模式」重新顯示選擇 panel；離開鏡頭模式立即停止其 stream 和推理，再按「開啟鏡頭」才會重新申請。
- `Esc`／「暫停」開啟休息畫面；「繼續」、重新開始或返回主頁均保留。

原有 bend hold **650ms**、stand hold **500ms** 不變，姿勢分類另有 200ms 穩定確認。按一下或一幀姿勢不會得分。3D 蘿蔔完成入籃轉場或 Sprite Pull → Celebrate 完整播完後加一分，五棵後完成。每輪沿用相同個人校準及鏡頭，玩家可按自己舒服嘅節奏活動。

拔蘿蔔 Camera mode 以當次個人站立／舒服屈膝基準計算動作範圍。請按自己舒服幅度活動，未能完成設定可重試或使用鍵盤。莓果大豐收保留原有免校準伸腳流程。

## 瀏覽器與權限

鏡頭需要 **HTTPS 或 localhost** secure context，以及 `navigator.mediaDevices.getUserMedia`。目前 QA 使用 macOS Chrome；Safari、Firefox、實體 Raspberry Pi 及真人 webcam 流程仍需各自驗證。非 localhost 的純 HTTP LAN 網址不能假定可用鏡頭。

只有 video 權限，`audio:false`，不申請麥克風。前置鏡頭理想輸入 **640×360**，不要求 exact resolution；實際尺寸由裝置決定。權限拒絕、沒有相機、相機忙碌、不安全環境、瀏覽器不支援及模型失敗均顯示香港繁體中文提示並保留鍵盤選項。可在瀏覽器網站權限設定重新允許鏡頭後重試。

開始時的安全提示為「請保持地面清爽，旁邊最好有穩固椅子。」

## 隱私

鏡頭影像只會喺裝置上即時處理，不會上傳或儲存。沒有錄影、影像截圖功能、landmarks history、長期個人檔案、帳戶、後端或資料庫。個人校準角度與 MotionReference 只保留於當次鏡頭 session，切換輸入或離開時清除。手動設置會儲存在本機瀏覽器。只保留當前／平滑處理所需的短期 runtime 資料及 FPS、延遲等數值，debug 不會把 landmark array 寫入 console。

離開場景、切換到鍵盤或啟動失敗時停止所有 MediaStream tracks、取消推理 RAF、關閉模型及移除 preview。即使模型 teardown 發生異常也會釋放鏡頭。Pause 保留已授權 stream 供 preview 使用，但停止推理與遊戲輸入；resume 清除舊姿勢，重新確認後才繼續。完成畫面停止推理；重玩會重新選擇輸入。

## MediaPipe 與模型

使用官方 **`@mediapipe/tasks-vision@1.0.1`**，固定版本與 package-lock。`FilesetResolver`／`PoseLandmarker` 在選擇鏡頭時才 lazy import。

- `runningMode: VIDEO`，`numPoses: 1`，CPU delegate。
- Detection／presence／tracking confidence 均為 **0.55**，不輸出 segmentation mask。
- 官方 **Pose Landmarker Lite float16 v1**：`public/mediapipe/models/pose_landmarker_lite.task`。
- Package WASM 位於 `public/mediapipe/wasm/`，依 BASE_URL 載入；runtime 不使用 CDN 或外部模型網址。
- 模型來源：[Google 官方模型](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)。SHA256：`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`。
- API 實作依據：[Google 官方 Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)。

推理在獨立 requestAnimationFrame loop 中，最高 **25 FPS**，只處理新 video frame。主執行緒的同步模型呼叫會佔用時間；慢裝置自然會降低實際 inference FPS，不降低 Phaser 的 1600×900 logical resolution。Preview 與 debug 顯示實際 Pose FPS、單幀／平均 inference ms；實際真人性能須另測。

## 姿勢訊號

`PoseCamera → PoseEstimator → PoseClassifier（信心過濾／PoseSmoother／角度／debounce）→ MediapipeMotionInput → MotionInput → CarrotRound`。

- 使用左右 shoulder、hip、knee、ankle。
- Visibility 至少 **0.5**；若 landmark 帶 presence，也要求至少 0.5。官方 JS 類型的 presence 為非必需資料，缺少它不會一律拒絕 pose。
- 先過濾信心和畫面範圍，再對可靠 hip／knee／ankle 座標做 EMA，**alpha = 0.35**，最後算角度。丟失的一側或 stale frame 不沿用舊平滑值。
- `calculateAngle(a,b,c)` 使用 hip–knee–ankle 向量內積及 acos，換算度數。先按影像 width／height 修正 normalized x／y 的比例；退化向量不產生角度。
- 正式拔蘿蔔 Camera UI 接入個人校準範圍，固定可靠腿側。原有手動範圍 API 與相容測試保留。
- 連續滿足 **200ms** 才確認站立／屈膝。追蹤可靠性不足時停止動作輸入，連續可靠幀確認後才恢復，膝角介於兩個閾值之間亦可恢復連續骨骼同步。
- 至少有可靠 shoulder／hip 配對，肩在臀上方，軀幹大致直立（臨時容許偏離垂直 35°）。只排除明顯錯誤輸入，不評估 sway、balance 或動作質素。
- 250ms 以上沒有新有效結果，或必要點信心不足，輸入即為 TRACKING_LOST。立即輸出 false／false，Scene 凍結動作 hold，保留已有進度。恢復後需重新通過 debounce。
- 普通 Tracking Lost 會持續等待，毋須確認。正式 3D 遊戲保持最後畫面、抓取、拔出及收穫進度，可靠追蹤恢復後平滑繼續。骨骼開發預覽在 **600ms** 後平滑回到自然站姿。Sprite 動作保持時間、動畫與回調一併凍結，恢復後繼續原進度。主動暫停、離開視窗及頁面隱藏仍保留暫停。

獨立 pose states：UNKNOWN、STANDING、TRANSITION、BENDING、TRACKING_LOST。遊戲狀態機保持：

```text
READY → BENDING → GRABBED → RETURNING → SUCCESS → NEXT_ROUND → READY
                                                   └─ 第五棵 → COMPLETE
```

Preview 用 CSS 鏡像；骨架 canvas 亦作相同 visual mirror。模型讀取原始 video，**沒有對 landmark x 做鏡像轉換**，所有角度使用原座標。

## 自動動作設定與手動設置

拔蘿蔔開啟鏡頭後先安靜等候。可靠人物入鏡後顯示自然站立指示，穩定取樣後自動進入舒服淺屈膝步驟，完成即套用個人範圍。自然企直、雙手放鬆並穩定約 600ms 後建立 MotionReference，3D 阿兔自動同步。發現未能穩定辨識可重試或使用鍵盤。手動「重新設定動作」及開發「重設參考姿勢」均保留。短暫丟失跟蹤保留當次設定，人物／鏡頭位置明顯改變時，3D 參考會提示重設。

首頁「設置」保留預設／手動站立與屈膝閾值、保持時間、姿勢 EMA、確認時間、可信度、3D 增益、平滑及兔子大小。拔蘿蔔個人校準完成後以當次個人角度控制。只有手動數字設定會保存到 localStorage。

開發預覽、骨骼角度與此次修復詳見 [Task 4B 文檔](docs/task-4b-motion-retargeting.md)。

Task 4C-1 的 Carrot 3D 開發預覽預設使用獨立 V3 Rabbit Rig，保留 V2 四肢長度與卡通外觀，改善肩部空間及關節權重。直臂側抬／前抬可達 150°；120° 舉手時肘部最多彎曲 45°，最大舉手須頭部中立。`?rabbit3dDebug=1&mocapDebug=1&rabbitRig=v2` 可回退舊模型；Berry 仍使用 V2。建模、組合限制與對比圖詳見 [Task 4C-1 文檔](docs/task-4c1-rabbit-rig-improvement.md)。`npm run build:rabbit3d -- --version v3` 重新產生獨立 V3 資產，`npm run qa:rig-v3` 驗證實際預覽。

Task 4C-2 在 V3 開發預覽加入可切換 IK／腳底接地。使用 `?rabbit3dDebug=1&mocapDebug=1` 顯示「啟用 IK」「停用 IK」及腳／手目標、殘差、限制和時間；`rabbitIK=0` 直接以 FK 開始。原地淺屈膝、側傾和小幅橫移使用固定腳底目標；超出雙腿可達範圍會限制 Root，手臂則在 V3 已驗證的肩肘組合範圍內靠近目標。`npm run qa:ik` 產生實際 Three.js FK／IK 對比、連續幀及性能結果。架構、限制與驗收見 [Task 4C-2 文檔](docs/task-4c2-realtime-ik-motion-coordination.md)。

Task 4D-1 加入獨立 3D 蘿蔔、實際手骨握點、距離確認、200ms 抓取過渡及持續附著。使用 `http://127.0.0.1:5178/?rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1`，進入拔蘿蔔後選鍵盤測試，即可使用手動骨骼和抓取面板。手臂方向最高 145° 內收，姿勢按現有 IK 的耦合範圍限制。先將雙臂調至約 85–90°、手肘 10°、方向 145°，按「擺放到雙手中間（測試）」放置測試物，再按「抓住蘿蔔」。距離限制預設啟用。面板亦提供放開、重設和握點顯示。此獨立開發預覽隱藏 Sprite 蘿蔔及泥土前唇。正式 3D 遊戲使用下方 Task 4D-2 的高架花槽遮擋。使用 `npm run build:carrot3d` 重匯出原 Blender 蘿蔔，`npm run qa:carrot-grab` 執行 Chrome 驗證。座標、抓握限制與驗證記錄見 [Task 4D-1 文檔](docs/task-4d1-3d-carrot-grabbing.md)。

Task 4D-2 將體感入口接上正式即時 3D 遊戲。沿用 `CarrotRound` 的屈膝與站立保持、唯一入籃計分及五棵完成流程。高架花槽把握點放到現有 V3 可達範圍，穩定淺屈膝後以有界主手輔助抓握，軀幹、腿部及另一隻手持續跟隨玩家。蘿蔔按起身幅度逐漸離土，再以同一 Three.js scene 移入原有籃子。WebGL／GLB 或不可達抓取會顯示提示並回到原有畫面。正式版本隱藏開發控制。架構、數值、驗證與限制見 [Task 4D-2 文檔](docs/task-4d2-full-3d-carrot-pull.md)。

```sh
npm run dev -- --port 5178 --strictPort
QA_URL=http://127.0.0.1:5178/ npm run qa:carrot-game
```

開發數據可用 `?carrotGameDebug=1`。無 Webcam 的完整 3D 鍵盤模擬使用 `?carrotGameDebug=1&carrotGameSim=1`，沿用 `↓/S` 屈膝、`↑/W` 站立及 Esc 暫停。原有 `rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1` 仍可開啟獨立骨骼／抓握預覽。

## 開發 Preview／Debug

Camera mode 提供「顯示鏡頭小畫面」toggle。開發環境預設顯示小 preview，production 預設隱藏。Skeleton 和數值 debug 預設關閉：`DEV_POSE_DEBUG = false`、`DEV_POSE_PREVIEW = true` 在 `PoseDebugOverlay.ts`。

如要顯示 skeleton、左右／融合膝角、PoseState、信心、inference ms、FPS，以及 standing／bend baselines、兩個個人閾值和 range，在 `.env.local` 加入以下設定後重新啟動 dev server：

```dotenv
VITE_POSE_DEBUG=true
# Optional: hide keyboard test hints
VITE_SHOW_KEYBOARD_HINTS=false
```

Debug 只在 DEV 啟用，只畫軀幹及雙腿，不保存影像或 landmarks。沒有開發快捷鍵；模式切換由明確 UI 按鈕處理。

## 主要檔案

```text
src/game/input/
  MotionInput.ts                 # Shared sample, status and lifecycle interface
  KeyboardMotionInput.ts         # Preserved Arrow/W/S adapter
  MediapipeMotionInput.ts         # Pose-to-input adapter and runtime ownership
  MotionInputController.ts       # Explicit setup, switching and failure fallback
src/game/vision/
  PoseCamera.ts                  # Permission, video and stream lifecycle
  PoseEstimator.ts               # Local model, throttled inference, telemetry
  poseTypes.ts / poseConfig.ts    # Runtime types and temporary constants
  poseMath.ts                    # Aspect-correct knee angle and basic torso gate
  PoseSmoother.ts                 # EMA of current reliable landmarks
  PoseClassifier.ts              # Confidence, states, debounce, stale/loss handling
  PoseDebugOverlay.ts            # Mirrored preview and pose/calibration metrics
src/game/calibration/
  calibrationTypes.ts            # Session-only profile and state types
  calibrationConfig.ts           # Temporary sampling/validation constants
  calibrationMath.ts             # Median, IQR, interpolation, validation
  CalibrationController.ts       # Sampling, loss, retry and profile lifecycle
  CalibrationPanel.ts            # Gentle instructions, progress and confirmation
src/game/scenes/CarrotPullScene.ts # Generic MotionInput only; no pose math
```

Task 2E 的集中 asset keys、同 transform 四層背景、depth、正式 Carrot origin、basket drop target、HUD panels，以及 Rabbit rig／spritesheets／attachment tracker 均沿用。`CarrotRound` 沒有修改。

## 驗證與界線

`npm run typecheck`、`npm test`、`npm run build` 驗證程式與既有回歸。`qa:mocap` 用 Chrome 虛擬鏡頭及合成姿勢測試自動校準、自然站立參考、左右／前抬手臂、組合動作、無人等待、追蹤恢復、手動控制互斥、Sprite 防誤得分及資源釋放。`qa:mocap-engine` 使用真正 MediaPipe WASM／模型及無人的虛擬圖案。既有 `qa:rabbit3d`、`qa:berry`、`qa:berry-camera` 保留。

真人 webcam、不同鏡頭位置、遮擋、延遲、抖動、模型極限組合姿勢及目標硬件仍需實測。Human Webcam QA: NOT VERIFIED。完整即時 3D 與 Sprite 流程已使用手動／合成輸入驗證。

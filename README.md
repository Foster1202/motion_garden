# 動態花園：阿兔 AI 小教練

Motion Garden Rabbit Exercise Game — BME3S02 Service-Learning 專案，沿用既有3D兔子／mocap整合，目前支援鏡頭自動動作設定、連續 3D 同步與手動設置。

Carrot Pull 支援單一鏡頭或鍵盤測試。鏡頭模式按當次個人範圍辨識站立、淺屈膝及 tracking 狀態。「AI 小教練」是專案名稱，這些角度只用作遊戲控制訊號。

## 協作與授權

所有 agent／task 先閱讀並持續更新 [AGENTS.md](AGENTS.md)；完成改動後以簡潔 commit 訊息提交並 push 到 GitHub。軟體採 PolyForm Noncommercial 1.0.0；原創美術及文檔採 CC BY-NC 4.0，見 [授權條款](LICENSE)與[第三方聲明](THIRD_PARTY_NOTICES.md)。

「拔蘿蔔」的體感模式支援即時 3D 五輪遊戲，鍵盤模式使用完整 Sprite 流程。「莓果大豐收」跟住箭嘴去發光樹旁，伸腳碰中收集三顆莓果，限時可選60／90／120秒，預設120秒。「摘蘋果」在 3D 果園抬手採摘，把蘋果送回中央籃子入籃得分，限時可選90／120／180秒，預設120秒。[莓果大豐收遊戲文檔](docs/berry-kick-game.md)

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

## 低效能模式

在首頁「設置」勾選「低效能模式」並儲存，下次開局套用。此選項預設關閉。開啟後，相機優先請求 320×240，姿勢推論約 10 FPS，背景處理暫停，3D 畫布降低解像度及更新頻率。可獨立勾選「顯示效能數據」比較兩種模式。Raspberry Pi 4GB／8GB 和 AMD GX-215JJ Windows 的部署、比較方法及驗證範圍見 [低效能模式部署與測試](docs/low-performance-mode.md)。

## 輸入模式

首頁「開始遊戲」→「拔蘿蔔」→ 選擇模式。鍵盤直接開始。鏡頭先等候人物入鏡，再自動進行自然站立及舒服淺屈膝設定。

- **體感模式**：按「開啟鏡頭」才申請 camera permission。讓鏡頭看到雙肩、腰部同雙膝，按照指示完成動作設定後自然企直。有合用的腳踝資料時使用膝角，否則可設定大腿動作估計。阿兔會自動建立穩定參考並進入即時 3D 遊戲。舒服地淺屈膝並保持後，阿兔會俯身捉住地上的蘿蔔，慢慢企直便會把蘿蔔從泥土拔出並放入籃。右下角顯示去抖人體狀態。
- **鍵盤測試**：按「使用鍵盤測試」。不申請鏡頭，不初始化 MediaPipe。`↓`／`S` 屈膝，放開後按 `↑`／`W` 站立。
- 「切換輸入模式」重新顯示選擇 panel；離開鏡頭模式立即停止其 stream 和推理，再按「開啟鏡頭」才會重新申請。
- `Esc`／「暫停」開啟休息畫面；「繼續」、重新開始或返回主頁均保留。

原有 bend hold **650ms**、stand hold **500ms** 不變，姿勢分類另有 200ms 穩定確認。按一下或一幀姿勢不會得分。3D 蘿蔔完成入籃轉場或 Sprite Pull → Celebrate 完整播完後加一分，五棵後完成。每輪沿用相同個人校準及鏡頭，玩家可按自己舒服嘅節奏活動。

拔蘿蔔 Camera mode 以當次個人站立／舒服屈膝基準計算動作範圍。請按自己舒服幅度活動，未能完成設定可重試或使用鍵盤。莓果大豐收在自然站立時自動建立伸腳參考。腳踝出框後可使用可見大腿控制同側兔腿。

## 摘蘋果

首頁「開始遊戲」→「摘蘋果」。跟住方向提示移到有金邊呼吸效果的樹下。樹下的細黃圈標示可採摘的左右範圍。輕輕抬手到胸口附近，再放低。採摘後細黃圈會轉到籃子，入圈後再做一次手勢，蘋果落入籃子才計分。入籃後會揀下一棵樹，同一方向最多連續三次。到時結算以入籃數量為準。

- **攝像頭**：先面向鏡頭企喺中間，讓鏡頭看到雙肩、雙髖和至少一隻自然放低的手腕。準備好後開始計時。向左右舒適地移動，任一隻手可採摘及放置。普通追蹤中斷會取消未完成的手勢，計時繼續。按「暫停」可休息或改用鍵盤。
- **鍵盤**：按住 `A`／`D` 或方向鍵左右移動。按住 `Q`／`E` 抬左／右手，放開代表放低。在發光樹旁採摘，在籃子旁重做手勢放置。`Esc` 暫停或繼續。
- **挑戰時間**：由首頁「設置」選擇摘蘋果挑戰時間。設定在下次開局生效。最後10秒會顯示大字倒數。

```sh
QA_URL=http://127.0.0.1:5173/ npm run qa:apple
```

Playwright 的鏡頭流程使用虛擬相機及合成關鍵點。真人體感驗證需另行進行。

## 音效、配音與 BGM

首頁「設置」可獨立儲存音效與語音開關及音量，音效預設60%、語音預設80%，兩項預設開啟。按鈕、抓握／拔出蘿蔔、莓果收穫及蘋果採摘／入籃有柔和音效。遊戲完成時共用 2.8 秒的 CC0 真人歡呼伴掌聲。暫停、追蹤中斷、重玩及退出會清理相應播放。收錄十四段粵語配音，涵蓋安全、動作設定、追蹤提醒、暫停、重試、下一棵蘿蔔、活動引導、成功鼓勵及完成提示。莓果開局以文字說明隨機目標玩法，收集鼓勵語會讓正在播放的配音先播完。語音期間降低音效及 BGM 音量。AudioManager 保留自訂錄音及 BGM 註冊、循環及暫停位置恢復接口。[整合方式與驗證](docs/audio-system.md) [音效來源與授權](THIRD_PARTY_NOTICES.md#audio-asset-provenance)

## 桌面畫面、瀏覽器與權限

目標畫面為桌面、橫向顯示器或電視的 16:9。1600×900 邏輯畫面隨窗口等比縮放。遊戲說明與示範影片在較小的桌面窗口也保持並排，示範影片保留原有 9:16 比例。


鏡頭需要 **HTTPS 或 localhost** secure context，以及 `navigator.mediaDevices.getUserMedia`。目前 QA 使用 macOS Chrome；Safari、Firefox、實體 Raspberry Pi 及真人 webcam 流程仍需各自驗證。非 localhost 的純 HTTP LAN 網址不能假定可用鏡頭。

只有 video 權限，`audio:false`，不申請麥克風。前置鏡頭理想輸入為標準模式 **640×360**、低效能模式 **320×240**，兩者的實際尺寸由瀏覽器和相機協商。權限拒絕、沒有相機、相機忙碌、不安全環境、瀏覽器不支援及模型失敗均顯示香港繁體中文提示並保留鍵盤選項。可在瀏覽器網站權限設定重新允許鏡頭後重試。

開始時的安全提示為「請保持地面清爽，旁邊最好有穩固椅子。」

## 隱私

鏡頭影像只會喺裝置上即時處理，不會上傳或儲存。沒有錄影、影像截圖功能、landmarks history、長期個人檔案、帳戶、後端或資料庫。個人膝角或大腿動作基準與 MotionReference 只保留於當次鏡頭 session，切換輸入或離開時清除。手動設置會儲存在本機瀏覽器。只保留當前／平滑處理所需的短期 runtime 資料及 FPS、延遲等數值，debug 不會把 landmark array 寫入 console。

離開場景、切換到鍵盤或啟動失敗時停止所有 MediaStream tracks、取消推理 RAF、關閉模型及移除 preview。即使模型 teardown 發生異常也會釋放鏡頭。Pause 保留已授權 stream 供 preview 使用，但停止推理與遊戲輸入；resume 清除舊姿勢，重新確認後才繼續。完成畫面停止推理；重玩會重新選擇輸入。

## MediaPipe 與模型

使用官方 **`@mediapipe/tasks-vision@1.0.1`**，固定版本與 package-lock。`FilesetResolver`／`PoseLandmarker` 在選擇鏡頭時才 lazy import。

- `runningMode: VIDEO`，`numPoses: 1`，CPU delegate。
- Detection／presence／tracking confidence 均為 **0.55**。同一次推理會輸出人物 segmentation mask。Camera 小畫面及 Berry Camera 預覽共用此遮罩。首頁「設置」可獨立開啟身體關鍵點及背景處理，背景效果可選模糊或灰色，兩項預設關閉。遮罩只供顯示，動作判定仍只使用人體 landmarks。
- 官方 **Pose Landmarker Lite float16 v1**：`public/mediapipe/models/pose_landmarker_lite.task`。
- Package WASM 位於 `public/mediapipe/wasm/`，依 BASE_URL 載入；runtime 不使用 CDN 或外部模型網址。
- 模型來源：[Google 官方模型](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)。SHA256：`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`。
- API 實作依據：[Google 官方 Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)。

推理在獨立 requestAnimationFrame loop 中，最高 **25 FPS**，只處理新 video frame。主執行緒的同步模型呼叫會佔用時間；慢裝置自然會降低實際 inference FPS，不降低 Phaser 的 1600×900 logical resolution。Preview 與 debug 顯示實際 Pose FPS、單幀／平均 inference ms；實際真人性能須另測。

## 姿勢訊號

`PoseCamera → PoseEstimator → PoseClassifier（信心過濾／PoseSmoother／角度／debounce）→ MediapipeMotionInput → MotionInput → CarrotRound`。

- 拔蘿蔔完整模式使用可靠的 hip、knee、ankle。部分模式使用雙肩、雙髖與雙膝的相對投影，並採用獨立校準的無單位訊號。頭部只用於可選的視覺旋轉。
- Visibility 至少 **0.5**；若 landmark 帶 presence，也要求至少 0.5。官方 JS 類型的 presence 為非必需資料，缺少它不會一律拒絕 pose。
- 先過濾信心和畫面範圍，再對可靠 hip／knee／ankle 座標做 EMA，**alpha = 0.35**，最後算角度。丟失的一側或 stale frame 不沿用舊平滑值。
- `calculateAngle(a,b,c)` 使用 hip–knee–ankle 向量內積及 acos，換算度數。先按影像 width／height 修正 normalized x／y 的比例；退化向量不產生角度。
- 正式拔蘿蔔 Camera UI 接入個人校準範圍。精確膝角保留原有可靠腿側，部分模式使用各自的站立及屈膝基準。原有手動膝角設定仍可使用。
- 連續滿足 **200ms** 才確認站立／屈膝。追蹤可靠性不足時停止動作輸入，連續可靠幀確認後才恢復，膝角介於兩個閾值之間亦可恢復連續骨骼同步。
- 至少有可靠 shoulder／hip 配對，肩在臀上方，軀幹大致直立（臨時容許偏離垂直 35°）。只排除明顯錯誤輸入，不評估 sway、balance 或動作質素。
- 250ms 以上沒有新有效結果，或必要點信心不足，輸入即為 TRACKING_LOST。立即輸出 false／false，Scene 凍結動作 hold，保留已有進度。恢復後需重新通過 debounce。
- 普通 Tracking Lost 會持續等待，毋須確認。正式 3D 遊戲保持最後畫面、抓取、拔出及收穫進度，可靠追蹤恢復後平滑繼續。骨骼開發預覽在 **600ms** 後平滑回到自然站姿。Sprite 動作保持時間、動畫與回調一併凍結，恢復後繼續原進度。主動暫停、離開視窗及頁面隱藏仍保留暫停。

三款遊戲按可用關鍵點顯示 Full Tracking、Partial Tracking 或 Tracking Lost。必要點與恢復條件見 [部分人體追蹤文檔](docs/partial-body-tracking.md)。

獨立 pose states：UNKNOWN、STANDING、TRANSITION、BENDING、TRACKING_LOST。遊戲狀態機保持：

```text
READY → BENDING → GRABBED → RETURNING → SUCCESS → NEXT_ROUND → READY
                                                   └─ 第五棵 → COMPLETE
```

Preview 用 CSS 鏡像；骨架 canvas 亦作相同 visual mirror。模型讀取原始 video，**沒有對 landmark x 做鏡像轉換**，所有角度使用原座標。

## 自動動作設定與手動設置

拔蘿蔔開啟鏡頭後先安靜等候。可靠人物入鏡後顯示自然站立指示，穩定取樣後自動進入舒服淺屈膝步驟，完成即套用個人範圍。自然企直、可見手臂放鬆並穩定約 600ms 後建立 MotionReference，3D 阿兔自動同步。發現未能穩定辨識可重試或使用鍵盤。手動「重新設定動作」及開發「重設參考姿勢」均保留。短暫丟失跟蹤保留當次設定，人物／鏡頭位置明顯改變時，3D 參考會提示重設。

首頁「設置」保留預設／手動站立與屈膝閾值、保持時間、姿勢 EMA、確認時間、可信度、3D 增益、平滑及兔子大小，並提供莓果挑戰60／90／120秒選項。拔蘿蔔個人校準完成後以當次個人角度控制。手動數值、鏡頭預覽選項及挑戰時長會保存到原有 localStorage，舊版設定會保留原值並補上預設關閉的預覽選項及120秒時長。

開發預覽、骨骼角度與此次修復詳見 [Task 4B 文檔](docs/task-4b-motion-retargeting.md)。

拔蘿蔔 3D 遊戲與預覽預設載入 `rabbit_carrot.glb`。手臂直接取自莓果大豐收的 V2 網格、原肩部靜姿和材質，與 V3 身體及腿部合用。整段手臂由肩骨帶動，手骨保留原握點。相機預覽由 CSS 鏡像，姿勢使用人體解剖左右，直接對應兔子的同名肩骨。側抬與前抬使用肩到肘的方向，手腕遮擋不影響這條手臂的有效肩部訊號。

以 `python3 model/scripts/build_carrot_rabbit_glb.py` 從現有兩個 GLB 重建拔蘿蔔模型，再執行 `npm run sync:assets`。可用 `?rabbit3dDebug=1&mocapDebug=1&rabbitRig=v3` 查看 [Task 4C-1 的分節骨骼](docs/task-4c1-rabbit-rig-improvement.md)，或以 `rabbitRig=v2` 查看莓果大豐收的兔子模型。`npm run qa:carrot-game` 驗證預設角色與五輪拔取，`npm run qa:rig-v3` 驗證歷史分節骨骼。

Task 4C-2 在 V3 開發預覽加入可切換 IK／腳底接地。使用 `?rabbit3dDebug=1&mocapDebug=1` 顯示「啟用 IK」「停用 IK」及腳／手目標、殘差、限制和時間；`rabbitIK=0` 直接以 FK 開始。原地淺屈膝、側傾和小幅橫移使用固定腳底目標；超出雙腿可達範圍會限制 Root，手臂則在 V3 已驗證的肩肘組合範圍內靠近目標。`npm run qa:ik` 產生實際 Three.js FK／IK 對比、連續幀及性能結果。架構、限制與驗收見 [Task 4C-2 文檔](docs/task-4c2-realtime-ik-motion-coordination.md)。

Task 4D-1 加入獨立 3D 蘿蔔、實際手骨握點、距離確認、200ms 抓取過渡及持續附著。使用 `http://127.0.0.1:5178/?rabbitRig=v3&rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1`，進入拔蘿蔔後選鍵盤測試，即可使用手動骨骼和抓取面板。手臂方向最高 145° 內收，姿勢按現有 IK 的耦合範圍限制。先將雙臂調至約 85–90°、手肘 10°、方向 145°，按「擺放到雙手中間（測試）」放置測試物，再按「抓住蘿蔔」。距離限制預設啟用。面板亦提供放開、重設和握點顯示。此獨立開發預覽隱藏 Sprite 蘿蔔及泥土前唇。使用 `npm run build:carrot3d` 重匯出原 Blender 蘿蔔，`npm run qa:carrot-grab` 執行 Chrome 驗證。座標、抓握限制與驗證記錄見 [Task 4D-1 文檔](docs/task-4d1-3d-carrot-grabbing.md)。

Task 4D-2 將體感入口接上正式即時 3D 遊戲。沿用 `CarrotRound` 的屈膝與站立保持、唯一入籃計分及五棵完成流程。穩定淺屈膝後，阿兔會自動俯身並以主手捉住生長在地面泥土中的蘿蔔。隨玩家起身，阿兔逐步抬起身體和主手，另一隻手持續跟隨玩家。蘿蔔按起身幅度逐漸離土，再以同一 Three.js scene 移入原有籃子。WebGL／GLB 或不可達抓取會顯示提示並回到原有畫面。正式版本隱藏開發控制。架構、數值、驗證與限制見 [Task 4D-2 文檔](docs/task-4d2-full-3d-carrot-pull.md)。

```sh
npm run dev -- --port 5178 --strictPort
QA_URL=http://127.0.0.1:5178/ npm run qa:carrot-game
```

開發數據可用 `?carrotGameDebug=1`。無 Webcam 的完整 3D 鍵盤模擬使用 `?carrotGameDebug=1&carrotGameSim=1`，沿用 `↓/S` 屈膝、`↑/W` 站立及 Esc 暫停。原有 `rabbitRig=v3&rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1` 仍可開啟獨立骨骼／抓握預覽。

## 開發 Preview／Debug

Camera mode 提供「顯示鏡頭小畫面」toggle。開發環境預設顯示小 preview，production 預設隱藏。首頁「設置」的「顯示身體關鍵點」會繪製 33 個綠色點及藍色骨架，低可信度點以半透明紅色顯示。「背景處理」可選模糊／灰色。兩項可獨立使用，預設關閉，於下次開啟鏡頭套用。原始影像、遮罩和骨架使用同一比例及 CSS 鏡像。背景處理沿用同次推理的遮罩，柔化邊緣並只對連續的低幅度邊緣變化作輕量平滑。人物／遮罩丟失、暫停及鏡頭停止會清除舊畫面或改用當前模糊／灰色背景。

如要顯示左右／融合膝角、部分追蹤訊號、PoseState、信心、inference ms、FPS，以及個人動作基準和閾值，在 `.env.local` 加入以下設定後重新啟動 dev server：

```dotenv
VITE_POSE_DEBUG=true
# Optional: hide keyboard test hints
VITE_SHOW_KEYBOARD_HINTS=false
```

數值 Debug 只在 DEV 啟用。身體關鍵點由上述設置獨立控制。Preview 不保存影像或 landmarks。沒有開發快捷鍵。模式切換由明確 UI 按鈕處理。`npm run qa:person-preview` 驗證四種開關組合、兩種背景及持久化。

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

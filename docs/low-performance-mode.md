# 低效能模式 · Raspberry Pi 與 Windows 部署和實測

適用於 Raspberry Pi 4GB／8GB 和 AMD GX-215JJ 等較慢的 Windows 電腦。首頁「設置」可獨立開關「低效能模式」和「顯示效能數據」。兩者預設關閉並儲存在當前瀏覽器。畫質和鏡頭設定在下一次開局生效，效能數據會即時顯示。關閉低效能模式可恢復標準解像度和更新頻率，以及之前儲存的背景效果。

兩種模式現均優先使用 Worker 推論和原生相機預覽。最新的部署方式及 Windows 比較方法見 [Windows USB 相機卡頓診斷](windows-camera-stutter.md)。下方舊版量測保留作歷史對照。

## 瓶頸與改動

| 路徑 | 原有成本 | 低效能模式 |
| --- | --- | --- |
| MediaPipe | Lite 單人 CPU/WASM 在主執行緒同步跑 `detectForVideo()`，上限 25 FPS。推論期間會佔用主執行緒。 | 約 100 ms 才對一個新相機影格取樣，約 10 Pose FPS。保留 Lite 模型、單人和追蹤信心設定，落後時跳過影格。 |
| 人物分割 | 曾每次要求遮罩並讀回、轉換 alpha。開啟背景模糊或灰色另需 Canvas 2D 合成。 | 關閉 Landmarker 遮罩輸出與背景合成。標準模式按背景開關決定是否輸出遮罩。 |
| 鏡頭 | 優先請求 640×360。預覽用姿勢回調更新 Canvas。 | 優先請求 320×240、30 FPS，實際由瀏覽器協商。使用原生鏡頭影像作鏡像預覽，身體關鍵點可選擇疊畫並按姿勢取樣更新。鏡頭畫面可比姿勢結果更頻密。 |
| Three.js | 透明 WebGL 畫布有抗鋸齒，Carrot／Apple 約 60 次繪製每秒，Berry 每次場景更新繪製。 | 關閉 Three.js 抗鋸齒，繪製緩衝的寬和高減半，約 30 FPS。個別首次載入或結算保留即時繪製。兔子骨骼、動畫與接觸採樣繼續按場景更新。 |
| Phaser | 每次 3D 繪製後用 Canvas 2D 複製，再透過 `CanvasTexture.refresh()` 更新紋理。 | 只在新 3D 畫面上傳半尺寸紋理。Carrot 1300×720 → 650×360，Berry 1200×675 → 600×338，Apple 1120×630 → 560×315。Phaser 仍以 1600×900 邏輯座標運作。約 60 降至 30 次／秒時，每秒複製的像素數約為原本的八分之一。 |

CPU/GPU 佔用、卡頓和輸入延遲需要在實機量度。更小的相機畫面可減少輸入資料量，亦可能讓畫面遠處或受遮擋的關鍵點更難辨識。

### 下蹲確認

低效能模式以實際取樣間隔調整完整膝角與部分追蹤的大腿訊號平滑係數。標準模式維持原有逐幀係數。姿勢確認仍按時間並要求有效新影格，Carrot 的預設屈膝及站立保持分別維持 650 ms 和 500 ms，失追期間暫停動作進度。250 ms 的資料過期及間隔保護維持原值。以 10 FPS 取 30 個不同影格時，站立和屈膝取樣各約需 3 秒，另加指引及穩定確認。很短的動作可能落在兩次取樣之間。若低模式下舒適淺屈膝頻繁漏判，記錄鏡頭構圖與實際 Pose FPS，並用同一組動作和站位比較標準模式。

### 原有 Worker 可行性實驗

加入正式 Worker 前曾進行獨立實驗。釘選的 MediaPipe Tasks Vision 1.0.1 使用本地模組 WASM 及 Lite 模型，在 macOS arm64 的 Chrome 158.0.8127.36 headless 成功初始化。主執行緒用 `createImageBitmap(video)` 把 320×240 虛擬相機影格逐一轉移給 module Worker，Worker 使用 `FilesetResolver.forVisionTasks(wasmRoot, true)`、CPU/VIDEO 模式，以及單調時間戳呼叫 `detectForVideo()`，用完釋放 bitmap，最後關閉模型。

模型約 384 ms 初始化。11 次推論中首幀約 118 ms，後 10 幀推論中位數 16.1 ms，建立 bitmap 約 0.1 ms，含推論的來回傳送中位數約 16.4 ms。虛擬畫面無人物，這組數字只證明同版本載入和傳幀可行。模組載入路徑使用 SIMD WASM。Worker 的 OffscreenCanvas/WebGL2 和影格轉移仍需在目標瀏覽器驗證。 [Google Web Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web) · [Google Pose Landmarker Worker 範例](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/pose-landmarker.worker.ts)

## 部署

1. Raspberry Pi 建議由有桌面環境的 64-bit Raspberry Pi OS、Chromium 和 USB 相機開始。記錄 Pi 型號與 RAM、系統、瀏覽器、相機、外接畫面解像度和縮放。Windows 亦可用同一份靜態構建，先以 Chromium 系瀏覽器比較。 [Raspberry Pi OS 官方下載](https://www.raspberrypi.com/software/operating-systems/)
2. 用 Node.js 22.12 或以上在開發電腦建置；也可以在已有適用 Node.js 和 npm 的 Pi 上使用相同指令。資產同步會使用倉庫內已匯出的模型。

   ```sh
   git clone https://github.com/Foster1202/motion_garden.git
   cd motion_garden
   npm ci
   npm run sync:assets
   npm run typecheck
   npm run build
   ```

3. 如果在另一部電腦建置，將整個 `dist/` 複製到目標裝置，包含 `assets/`、`mediapipe/` 裏的模型和 WASM。在目標裝置有 Python 3 時，可用以下指令在本機提供靜態檔案。用該裝置上的瀏覽器打開 [本機遊戲](http://127.0.0.1:8080/)。

   ```sh
   python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
   ```

   用其他裝置連入時提供瀏覽器信任的 HTTPS，並正確提供 `.wasm` 的 `application/wasm` MIME 類型。一般區域網 IP 的 HTTP 網址無法提供相機安全環境。首次選「開啟鏡頭」時，需允許網站使用相機。 [瀏覽器相機權限](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
4. 打開 `chrome://gpu` 或 `edge://gpu`，記錄 WebGL2 為硬件加速還是軟件繪製。先試鍵盤確認畫面和資產可載入，再用鏡頭。若相機權限或 3D 資產載入失敗，記錄提示和 Console／Network 錯誤。

## 每台機的 A/B 測試

1. 使用同一構建、瀏覽器、相機、視窗大小、光線及人到鏡頭的距離。先關閉背景處理和關鍵點，開啟效能面板。每款遊戲在標準／低效能模式各測三次。每次回首頁切換並重新開局，暖機約 10 秒後記錄約 30 秒。若日常使用背景效果，可加測標準模式開背景的差異。
2. 記錄相機實際解像度、最近及平均推論時間、Pose FPS、Phaser FPS、3D FPS，以及瀏覽器程序的 CPU/GPU 佔用。Phaser 和 3D 的數字按每秒實際繪製與上傳事件估算，Pose FPS 使用相鄰已推論影格的平滑速率。推論耗時只計同步模型呼叫。可用 Performance 面板查看長工作和停頓，用系統工具記錄 CPU/GPU，Pi 可另記 `vcgencmd measure_temp` 和 `vcgencmd get_throttled`。
3. **拔蘿蔔**每次重做舒適站立和淺屈膝設定。完成 5 次正常屈膝、保持、企直；分別試完整腿部和腳踝出框。另測一次快速偏移、一次短暫遮住膝部、一次暫停再繼續。記錄每次是否捉到、誤捉、成功入籃及失追時有否誤計分。要比較入動作至畫面回饋的延遲，可用外置相機同時拍下參與者及遊戲畫面，再逐格讀取時間差。
4. **莓果大豐收**確認站立參考、左右移動、對應腿接觸目標樹後收穫和縮腿後再踢。**摘蘋果**確認移到目標樹、抬手再放低後採摘、移到籃子重做手勢及入籃計分。兩款都測暫停、續玩、失追和退場釋放相機。記錄速度不足、畫面停頓及漏判。Berry 的部份追蹤證據在連續取樣間隔超過約 150 ms 時可能需重新累積。

| 裝置／模式／遊戲 | 實際相機 | 推論最近／平均 ms | Pose / Phaser / 3D FPS | CPU／GPU／溫度 | 動作成功、誤觸、延遲及停頓 |
| --- | --- | --- | --- | --- | --- |
| 填寫型號、RAM、瀏覽器、模式 | — | — | — | — | — |

以動作辨識可靠度作為採用條件。完成率、漏判或誤觸明顯變差時，即使 FPS 變好也應保留標準模式供該裝置使用。

## 自動驗證與限制

```sh
# npm run dev -- --port 5173 --strictPort
QA_LOW_PERFORMANCE=1 QA_PARTIAL_ONLY=1 QA_URL=http://127.0.0.1:5173/ npm run qa:carrot-game
QA_LOW_PERFORMANCE=1 QA_URL=http://127.0.0.1:5173/ npm run qa:berry-camera
QA_LOW_PERFORMANCE=1 QA_SUITE=camera QA_URL=http://127.0.0.1:5173/ npm run qa:apple
# npm run build && npm run preview
QA_URL=http://127.0.0.1:4173/ npm run qa:low-performance
```

自動測試涵蓋合成關鍵點的 10 Hz 抖動、淺屈膝、站起、完整與部分追蹤、單幀誤觸及失追恢復。Chromium 虛擬相機可測模式切換、攝影機實際解像度、資產載入、指標和相機釋放。真實參與者的淺屈膝辨識、鏡頭到動作反應時間、Raspberry Pi 4GB／8GB 的 CPU/GPU 與溫控、AMD GX-215JJ Windows、Safari、Firefox 仍待實測。

macOS arm64 Chrome 158 的正式構建在無人的虛擬相機下，以實際 Lite 模型在莓果場景測得以下範圍。虛擬相機在兩種模式實際皆以 20 FPS 輸出。

| 模式 | 實際相機 | 最近一次推論 | Pose FPS | Phaser FPS | 3D FPS |
| --- | --- | --- | --- | --- | --- |
| 標準 | 640×360 | 13.0–13.3 ms | 20.0 | 60.0 | 60.0 |
| 低效能 | 320×240 | 11.7–12.0 ms | 9.9–10.0 | 60.0 | 29.5–30.0 |

完整 `npm test` 的一項既有兔子比例比較需本機舊模型 `model/dist/rabbit3d/backup-v1/rabbit_realtime.glb`。全新 clone 缺少這個 Git 忽略的測試素材。若要跑完整套件，請從現有開發工作區複製該素材至同一路徑。部署與執行遊戲所需的模型已隨倉庫提供。

# Windows USB 相機卡頓診斷

## 已確認的程式路徑

| 層 | 原有行為 | 現在如何量度或驗證 |
| --- | --- | --- |
| 瀏覽器取得相機 | 只用前置相機偏好及一組理想解像度。裝置可能回傳其他尺寸或幀率。 | 「相機診斷」可選裝置並比較瀏覽器預設、320×240、640×480 或 640×360。記錄 `getSettings()`、裝置能力範圍、實際 video 尺寸與影格回調。 |
| 解碼和顯示 | 標準預覽把 video 複製到 Canvas，更新受推論頻率控制。低效能模式已有原生 video，但顯示仍依賴姿勢回調。 | 預設使用原生鏡像 video，從相機啟動開始播放。只在開啟背景效果時合成畫面，關鍵點另畫在透明 Canvas。 |
| 推論 | `requestAnimationFrame` 內的同步 `detectForVideo()` 會佔住主執行緒，影響其他影格、DOM 和輸入。 | 優先以 Web Worker 運行相同的 MediaPipe CPU Lite 模型。面板記錄後端、完成率、推論最近耗時與 P95。 |
| 主執行緒 | 舊面板無法分辨姿態取樣慢、相機慢與整頁停頓。 | 記錄長任務、rAF 幀間隔和影片回調。比較有／無遊戲及 Worker／主執行緒。 |
| 遊戲渲染 | Phaser 與 Three.js 的畫面頻率可以不同。 | 分開計算 Phaser 繪製與 3D 上傳。可用鍵盤模式量度遊戲渲染本身。 |

這些程式路徑可以重現推論造成的主執行緒阻塞。Windows Camera 應用順暢只代表其採集及顯示路徑正常。GX-215JJ 測試機在 Chrome 實際選用的相機模式、解碼時間、CPU/GPU 佔用及卡頓原因仍需同機比較。瀏覽器 API 可選裝置、尺寸及幀率偏好，無可攜的 USB MJPEG／YUY2 格式選擇介面。 [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) · [MediaPipe 同步推論與 Worker](https://developers.google.com/edge/mediapipe/solutions/tasks)

## 推論和相機生命週期

- Worker 使用版本鎖定的 Tasks Vision 1.0.1 及本站的 model／WASM。主執行緒只在 Worker 有空時取得一張最新的 `ImageBitmap` 並轉移。忙碌時略過影格。採集影格時間戳用於原有的有效期檢查，避免慢推論將舊姿勢當成新動作。
- Worker 不可用、初始化失敗或運行失敗時，使用同一相機 stream 切回主執行緒模型。手動暫停、頁面隱藏、退出和切換到鍵盤各自清理或停用推論；過期和上一次執行的結果不進入遊戲。
- 雙模式沿用原有姿勢門檻、個人校準、遊戲規則和渲染模式。開啟背景效果仍有 Canvas 合成，對照測試時先將其關閉。瀏覽器只在本機保存所選相機與設定。影像、姿勢結果和效能量測留在當次頁面。
- 自動相機設定沿用標準 640×360 或低效能 320×240 的理想值。尺寸／幀率無法協商時會放寬限制並重試。指定的 USB 相機保持選定，拔出後需在診斷頁重新選擇。成功取得 stream 但實測幀率偏低時，用同一台相機手動比較 VGA 或瀏覽器預設，避免依據驅動回報的單一幀率自動猜測。

## 在 Windows 更新與測試

在有 Node.js 22.12 或以上的 PowerShell 中執行以下命令。也可以在其他電腦建置後將整個 `dist` 複製到 Windows。

```powershell
git clone --branch fix/windows-camera-stutter --single-branch https://github.com/Foster1202/motion_garden.git
cd motion_garden
npm ci
npm run sync:assets
npm run build
npm run preview
```

已有 clone 時，可使用 `git fetch origin` 及 `git switch --track origin/fix/windows-camera-stutter` 建立本機追蹤分支，再執行上述建置命令。開啟 [遊戲首頁](http://127.0.0.1:4173/) 或 [獨立相機診斷](http://127.0.0.1:4173/camera-diagnostics.html)。跨裝置部署需使用 Chrome 信任的 HTTPS，並提供 `application/wasm`。

1. 關閉 Camera 應用並在「鏡頭診斷」按「啟動鏡頭」。首次授權後選出 USB 裝置。分別測瀏覽器預設、320×240/30 和 640×480/30。每組暖機後記錄約 30 秒。用相同的光線、USB 裝置和顯示設定。
2. 選擇實測穩定的設定並按「儲存供遊戲使用」。回遊戲勾選「顯示效能數據」，先用鍵盤模式記錄 Phaser／3D，接着用鏡頭記錄標準和低效能模式。可在相同建置用 `/?poseBackend=main` 強制主執行緒作 A/B，清除查詢字串即回到 Worker 優先。
3. 記下協商幀率、Video FPS、回調 FPS／間隔、Pose FPS、推論 P95、Long Tasks／rAF 停頓、Phaser 和 3D FPS。結合 Chrome Task Manager、Performance 錄製及 `chrome://gpu` 判斷主執行緒或圖形負載。若只在開啟背景效果後變慢，額外比較該模式的 Canvas 成本。
4. 拔蘿蔔試完整與腳踝出框的校準、五次淺屈膝再站起、短暫遮住膝頭、切換視窗暫停再恢復。莓果和蘋果各完成一次得分。最後切到鍵盤或返回首頁，確認相機已釋放。

| 實測結果 | 如何解讀 |
| --- | --- |
| 獨立診斷已呈現低 Video FPS，rAF 正常 | 先檢查 Chrome 與相機協商、相機輸出速度或影片處理路徑，比較同一相機各配置。 |
| 診斷正常，遊戲主執行緒模式有長任務／大回調間隔，而 Worker 模式改善 | 同步推論或同段主執行緒工作是可驗證的阻塞來源。用 Performance trace 追查長任務堆疊。 |
| Video FPS 正常，Pose FPS 低或模型 P95 高 | 相機持續更新，瓶頸可能在推論／傳輸。若結果超出原有有效期，遊戲會等候新鮮姿勢。 |
| 鍵盤時 Phaser 或 3D FPS 已低 | 優先檢查渲染及圖形加速，再比較低效能模式。 |

`requestVideoFrameCallback` 的 `presentedFrames` 估計送去呈現的影片影格，而回調本身由主執行緒處理。兩者差距和回調間隔可揭示回調漏取或主執行緒停頓。協商的相機 FPS 只是 track 設定，未必等於實際 FPS。只有瀏覽器提供的 `processingDuration` 可用於估計解碼耗時，缺值時記為不支援。單次測試無法量出 USB 感光元件幀率或硬件解碼內部狀態。 [WHATWG 影片影格回調](https://html.spec.whatwg.org/multipage/media.html#dom-video-requestvideoframecallback)

## 自動驗證

`npm run qa:camera-stutter` 預設對正式 Vite Preview 建置執行，也可指定 `QA_URL`。它比較純原生相機、同一遊戲主執行緒／Worker 後端，以相同長度的注入任務驗證主執行緒隔離，並測試隱藏恢復、Worker 啟動及運行時降級、模型失敗與相機釋放。虛擬影像沒有真人。針對校準、下蹲、站立與失追，使用 `qa:carrot-game` 的合成骨架流程與單元測試。

macOS arm64、Chrome 158 的正式構建驗證如下。獨立鏡頭以 320×240 和 640×480 測得均約 20 FPS，沒有遊戲或模型請求。瀏覽器未為此虛擬來源提供解碼耗時。遊戲兩種後端約 20 Video／Pose FPS，Phaser／3D 約 60 FPS，短窗口的模型 P95 均約 18 ms。

| 550 ms 人工任務位置 | 最長影片回調間隔 | 最長 rAF 間隔 |
| --- | --- | --- |
| 主執行緒 | 583 ms | 552 ms |
| 推論 Worker | 50 ms | 18 ms |

人工任務用於驗證隔離效果。Windows 10 GX-215JJ／Radeon R2E／實體 USB 相機、Raspberry Pi 4B Chromium 和真人動作、畫面端到端延遲均待實測。

# 莓果大豐收 / Berry Tree Kick

## 遊戲與操作

主頁 → 開始遊戲 → 莓果大豐收。選攝像頭或鍵盤後開始限時挑戰。預設120秒，在首頁「設置」可選60／90／120秒，於下次開局套用。跟着頂部箭嘴去發光的目標樹旁，伸腳碰中樹幹就收集三顆莓果。收腳後再跟下一個目標。限時內可持續收集，時間耗盡才結算。

鍵盤：A / D 左右移動，Q / E 左右伸腳，放開收腳，Esc 暫停。鍵盤與相機使用同一個 RabbitRigController、投影及樹幹碰撞判定。暫停畫面提供繼續、重新開始及返回主頁。真人只需小幅、緩慢、舒服地伸腳，可用旁邊穩固椅子支撐；不需要踢到真實物件。

## 架構

- `scenes/BerryKickScene.ts`：場景、提示、HUD、生命週期。
- `berry/BerryKickRound.ts`：管理遊戲時間、碰撞結果、分數與目標序列，與姿勢偵測分離。
- `berry/TreeTrunk.ts`：每棵樹的莓果、搖晃、掉落動畫及目標輪廓。
- `settings/gameSettings.ts`／`SettingsPanel.ts` 保存及選擇挑戰時長，舊設定自動補上120秒並保留既有值。
- `berry/BerryKickInput.ts`：鍵盤或 PoseCamera / PoseEstimator。
- `mocap/LegExtensionDetector.ts`：無校準、身體尺寸歸一化動作偵測。
- `mocap/HumanPoseExtractor.ts` 的 `extractLegMotion` → `MotionRetargeter.retargetLegMotion`：沿用動作管線，Berry 路徑不接受 CalibrationProfile。
- `3d/RabbitRigController.ts`：連續腿部 FK。
- `3d/RabbitFootTracker.ts`：按變形後的兔腳外緣投影接觸點。
- `berry/BerryRabbitView.ts`：Three.js → Phaser CanvasTexture 橋接。
- `berry/berryConfig.ts`：同側目標連續上限、冷卻、收腿／伸腿門檻、圖層及樹木布局。

## Blender 資產

`model/scripts/blender/create_berry_assets.py` 建立 `model/assets/blender/scenes/berry_garden.blend`，渲染到 `model/dist/berry_kick/`；`npm run sync:assets` 同步到 `public/assets/berry_kick/`。

| PNG | 尺寸 | 內容 |
| --- | --- | --- |
| berry_background | 1600×900 | 山坡、草地、小路 |
| berry_tree_left / right | 400×560 | 木質樹幹、樹枝、樹冠及樹葉；沒有烘焙莓果 |
| berry | 128×128 | 獨立紅莓 |
| berry_basket | 400×320 | 木籃 |
| berry_foreground | 1600×900 | 透明花草前景 |

樹幹 normalized rectangle 為 `[.455,.45,.09,.52]`。場景把樹縮放成380×470，底部中心定位；碰撞區由相同圖像尺寸換算。莓果以獨立 Phaser Image 附在各樹容器，命中後脫離容器，落下、彈跳、移入籃子。Tweens 無強烈閃光。左右樹的清單互不影響。

本次依照文字指定的溫暖花園、木質、紅莓、花草方向製作；本輪未取得可讀取的 Dewdrop Berries 圖片，沒有聲稱逐像素仿照參考圖。

## 攝像頭參考與左右移動

開啟攝像頭後，面向鏡頭平穩站立。程式在至少 400 ms、至少五個連續有效影格內確認可見大腿穩定、髖中心與尺度一致，再取中心和尺度的中位數。參考保留至本次攝像頭會話結束。

- 關鍵點座標以畫面寬高比校正。左右髖→膝→踝分段長度均值用於當前踢腳判定。腳踝減去同側髖位置，抵消整體平移。伸腳門檻、支撐腿和膝方向檢查沿用原有規則。
- 橫移使用當前雙髖中心與參考中心的差。固定使用初始腿長及畫面比例換算出的畫面寬度，讓同一畫面位置持續對應同一 `lateralOffset`。重新量到的人體尺寸只影響踢腳幾何。在相同視野構圖下提高解像度不影響輸入。鏡頭視野或安裝位置改變後，可重新開啟攝像頭建立參考。
- 肩與髖的解剖方向在取得站姿參考時確立，與鏡像畫面共同對應遊戲左右。橫移使用三幀中位數抑制單幀髖部尖峰，接着套用小幅中心死區、70 ms 指數平滑及原有 3D 插值。位置達到行程端點後限幅。
- 肩髖可用而腳踝出框時，使用同側髖至膝的可見大腿運動。該膝頭也出框時暫停該側踢腳。肩髖資料不可靠或中心單幀跳變時，3D root 保持當前位置。來源影格到 300 ms 未更新時同樣停止控制；按暫停會立即使舊輸入失效。
- 恢復需要三個連續位置一致的肩髖影格，從目前畫面位置平滑跟回原參考。短暫遮擋、丟幀、暫停、尺度變化及方向離群影格均保留原中心和尺度。踢腳要在追蹤回復後重新收腳才能計分。

開發環境可用 `?berryTrackingDebug=1` 顯示即時 HUD。加上 `berryTrackingLog=1` 每 200 ms 在 Console 記錄目前／參考中心、尺度、方向、拒絕及重置原因、`lateralOffset`、目標／實際 `rootX`、影格年齡和推論／渲染 FPS。中心單位為畫面寬度，尺度單位為畫面高度，`rootX` 使用 1600×900 場景像素。

每條腿各自選擇投影膝踝幾何或大腿估計。大腿模式比較髖至膝向量在軀幹座標下的外展角與外移量，按軀幹長度歸一化並扣除自然站立基準。連續外展確認後，估計量驅動 3D 兔腿。同一隻虛擬腳仍需碰到指定樹幹。回收確認及原有冷卻條件共同限制重複收集。完整與部分模式交接也要重新確認收腳。詳見 [部分人體追蹤文檔](partial-body-tracking.md)。

### 2026-11-21 故障復現

Chrome 使用虛擬攝像頭及合成高置信度關鍵點。舊版在髖中心保持固定的情況下，腿長由 0.40 增至 0.58 便清除參考，三幀後將偏移位置設為新中心。`lateralOffset` 從 −1 變成 0，實際 `rootX` 從 495.15 到 799.83，`maxTravel` 維持 305.185。玩家回原位置時，兔子反而移向右側。另一組試驗中，短暫無姿勢在參考仍存在時就把橫移命令設為 0，150 ms 內 `rootX` 由 1091.44 漂到 915.85。沒有推論回呼時，舊場景仍會執行過期的橫移目標。原始追蹤記錄位於 `/private/tmp/mg-berry-camera-baseline-in-frame/results.json` 及 `/private/tmp/mg-berry-baseline/baseline-browser.json`。

## 連續骨骼與左右移動

`setLegExtension(side, amount)` 將0–1映射到最多32°髖部側展，腳部反向補償；使用模型 rest pose 的局部軸合成，與既有膝部彎曲相容。不是播放預設 Kick 動畫。原始 GLB 的 L 腳向+X；Berry 視圖鏡像 pivot X，使玩家左腳與畫面左樹一致。

實測原始 GLB 左腳骨X從0.265連續移至0.46637模型單位，向上變化0.05774。沒有修改 GLB 或重建Rig。根容器獨立平移，能在移動時同時伸腳。場景初始化實際測量休息與伸腳投影距離，按現有腳踝骨骼投影設定可移動邊界。接觸判定另外使用變形後的兔腳外緣。

## 3D → 2D 碰撞

初始化時，每側從既有 GLB 取一個主要受同側腳骨影響的外側兔腳頂點。每幀用實際骨骼變形更新它，再以 `Vector3.project(camera)` 轉至 1600×900 場景座標。低性能模式跳過繪製時仍會更新此位置。Phaser FIT 只縮放最終畫布。

左樹只查左腳，右樹只查右腳。兔腳接觸點必須在鏡頭內並進入對應樹幹，伸腿量須達 0.4，角色須靠近該側，且追蹤有效、未暫停、時間未完、已收腿與冷卻。網址加 `?berryDebug=1` 顯示左右腳接觸點及樹幹矩形。

完整追蹤時，建立自然站立參考及確認收腳共用 0.12 腿長的向外幅度上限。符合該自然站姿的向外量映射為 0，較大幅度連續增加，原來達到 0.4 踢腿門檻所需的幅度保留。

每次真實接觸後解除該腿 armed，伸腿量回到0.15以下才重新 armed，並須滿足1000ms遊戲時間冷卻。追蹤丟失、暫停及恢復會解除兩腿 armed，必須重新收腳。碰中目標樹時增加三顆，播放收穫音效及掉落動畫，果樹補回可採果實。碰中另一棵樹只顯示方向提示，目標和分數維持原值。單純伸腳、碰撞區外或未滿足冷卻時均不觸發提示。計分沒有數量上限，到期後結果固定。

每局由 `BerryKickRound` 抽取初始目標。成功得分後立即抽取下一棵，通常左右各半，同一側連續出現三次後強制轉向。暫停、追蹤丟失和錯樹碰撞不推進序列。建構時可注入 `() => number` 隨機數源，正式遊戲使用 `Math.random`。目標左右使用場景樹幹座標，與鏡頭小畫面的 CSS 鏡像分離。

狀態包括READY、MOVING、LEG_EXTENDING、TREE_HIT、BERRIES_FALLING、RECOVERY、COMPLETE；不阻斷連續骨骼更新。

## 暫停、失敗及資源

回合時鐘使用Phaser遊戲幀的delta及scene timeScale，有限正delta完整計入，動作平滑另限制單次步長。姿勢不可靠仍會倒數。到達截止時間的同一幀先鎖定COMPLETE，停止計分並立即顯示一次結算。

暫停停止計分、規則時間、Three更新、推論、樹木／莓果Tweens及UI提示動畫。Berry場景的TweenManager停用自動牆鐘更新，逐幀以同一遊戲delta推進各Tween。UI使用暫停的Web Animations，currentTime由回合elapsedMs驅動。失去視窗焦點或頁面隱藏自動暫停，須按「繼續玩」恢復，恢復首幀跳過舊delta。返回主頁／重玩會中止載入、停止camera tracks、關閉PoseEstimator、移除影片與事件監聽、銷毀renderer及GPU資源／CanvasTexture。到期、載入失敗及離場都清除動態提示、掉落果實及Tween回調。

GLB載入或WebGL失敗只顯示替代角色提示，禁止所有莓果計分並提供返回主頁。沒有可行的腳骨時鍵盤也不假裝可以正常玩。

## 限時挑戰 UI

頂部顯示MM:SS剩餘時間及「收集 N」，移除左右進度框。每次成功命中增加獨立「🍓 +3」提示，在上方以彈跳、輕微放大及淡出播放約一秒，多次提示各自保留及清除。

頂部中央顯示「左」或「右」及箭嘴。目標樹上的柔和金色輪廓取自樹木圖像的透明度，與樹木一起移動，由遊戲時鐘淡入淡出。換目標時方向牌輕輕放大，碰錯樹時放大幅度稍高，並顯示「請去左邊嘅樹！」或「請去右邊嘅樹！」。開局對話框提供玩法說明，原先提到兩邊都可收集的錄音停止自動播放。

最後十秒在上方中央顯示10至1的大型描邊數字，每個數字播放1100ms，具有彈跳放大、短暫停留及淡出，切換保留約100ms重疊。數字區域位於角色上方，提示層不接收操作事件。到期清除提示及掉落動畫，結算顯示「挑戰完成！」、總莓果顆數及設定時長，提供「再玩一次」「返回主頁」。

## 測試與效能

執行 `npm run typecheck`、`npm run build`、`npm test`。測試覆蓋左右碰撞、攝像頭鏡像、尺度、投影、收腳、冷卻、目標機率和連續上限、隨機數注入、錯樹、各挑戰時長、暫停恢復、追蹤丟失及結算。

`npm run qa:berry` 使用已安裝的 Chrome 和 Playwright，預設localhost:5175，截圖與結果寫入 `/tmp/berry-kick-qa/`（可用 `QA_URL`／`QA_OUTPUT` 覆寫）。以可重現目標序列驗證完整60秒鍵盤挑戰、左右樹高亮、錯樹真實接觸、重複伸腳、計時、動畫、暫停、結算及返回。`npm run qa:berry-camera` 驗證合成 camera 管線、左右碰撞和追蹤中斷。`scripts/qa-dialog-buttons.mjs` 使用到期 fixture 驗證結算按鈕。

Three輸出1200×675透明畫布再貼到1600×900 Phaser世界。鍵盤Chrome headless實測約60 FPS；這不是所有裝置的保證。CPU MediaPipe上限25 FPS，推論和render頻率分離。

## 已知限制

真人試玩回報踢腿後未掉果或計分，已用合成關鍵點及真實 3D 模型重現兩個可造成該症狀的問題。修正後的真人 Webcam 回歸尚未驗證。正面鏡頭須看清雙肩、雙髖與要伸出的一側膝頭。可見腳踝可提供較精確的伸腳資料。肩髖出框時保持位置，直到取得可靠姿勢。現有兔子腿較短，伸腿視覺幅度有限；採用安全小幅FK而非全身IK，沒有重新塑形或動作質量評分。

### 2026-11-24 真人回報的踢腿漏判

- 舊碰撞使用腳踝骨中心。真實 GLB 的兔腳外緣約向外多 15.73 場景像素。在 97% 橫移及 0.40 伸腿量時，左腳踝 x=468.45，超出左樹內側 x=457.10。兔腳外緣 x=452.72 已進入樹幹。
- 舊站立採集接受向外 0.12 腿長，收腳生效只接受 0.1015。約 0.110 的自然站姿能完成設定，卻無法重新裝備腳的踢擊資格，伸腿仍會顯示在畫面。
- 修正後，Chrome 合成攝像頭在伸腿量 0.470 時，兔腳外緣 x=456.04、腳踝 x=471.77。遊戲掉落三顆莓果並加 3 分。攝像頭 18 項、鍵盤 12 項、低性能 4 項及單元測試 459 項通過。證據位於 `/private/tmp/mg-berry-paw-{camera,keyboard,low}/`。

### 隨機目標驗收（2026-11-21）

Chrome 158／Playwright 完整跑完60秒鍵盤挑戰，透過可注入的隨機數源重現同側連續、強制換邊及左右目標的實際踢樹。八次有效命中共收集24顆。踢錯樹後持續伸腳，只播放一次方向提示，沒有掉落、加分或抽取下一個目標。1920×1080及600×800的畫面已核對。合成攝像頭驗證了左右實際腳骨碰撞及追蹤丟失後目標保持。另用正式 build 驗證未注入隨機數時的開局、錯樹及正確命中。測試證據位於 `/private/tmp/mg-berry-target-keyboard-final/`、`/private/tmp/mg-berry-target-camera/` 和 `/private/tmp/mg-berry-target-production/`。

### 攝像頭橫移驗收（2026-11-21）

使用 `QA_URL=http://127.0.0.1:5182/ QA_OUTPUT=/private/tmp/mg-berry-camera-tracking-verified npm run qa:berry-camera`，配合 `npm run dev -- --port 5182 --strictPort`。虛擬攝像頭和合成模型輸出經過原有 PoseEstimator、3D 骨骼及碰撞管線。逐步追蹤、分段行程、FPS 及截圖由腳本輸出。Chrome 158 的攝像頭檢查 17 項、鍵盤 12 項、補充語音 13 項全部通過。`npm run typecheck`、`npm test` 399/399 及 `npm run build` 通過。

- 單元測試重放 120 秒姿勢時間戳，包含尺度、鏡像、寬高比、遮擋、暫停及恢復。Playwright 在真實時鐘下連續左右移動 48.023 秒，四段的左右極值分別維持在約 495／1105 px，501／502 個取樣可控制橫移。
- 在原 16:9 會話中，將當前腿長從 0.40 改為 0.58 及 0.252，固定髖中心的命令維持約 −0.987，參考始終是 0.50／0.40。最大行程維持約 ±305 場景像素。短暫踝部遮擋時橫移有效，失去髖部時實際 root 停在原位。來源停止更新、回復、暫停及重新開始也有斷言。
- 測試校對了 16:9 及 640×480 鏡像輸入、視野邊緣限幅、獨立左右腳踏中、收腿防重複得分及相機資源釋放。Chrome 合成測試約 60 FPS 渲染及 20 FPS 推論排程。靜止抖動及兩種單幀尖峰測試中，`rootX` 與中心相差最多 2.10 px。合成位置階躍到角色首次移動 50 px 的輪詢時間為 219 ms。
- **Human Webcam QA: NOT VERIFIED**。固定鏡頭的畫面座標和合成測試數據無法量度真人的端到端延遲或不同鏡頭視角下的實際移動幅度。

### 限時挑戰驗收（2026-11-17）

- `npm run typecheck`、`npm test` 364/364、`npm run build`及diff／三個瀏覽器腳本語法檢查通過，獨立審查未發現可操作的正確性問題。
- Chrome157／Playwright於 `http://127.0.0.1:5180/`，`qa:berry` 12項、`qa:berry-camera` 10項、對話框9項、`qa:rabbit3d` 15項全部通過。Browser插件未提供，沿用已安裝的Playwright及Chrome。
- 正常60秒鍵盤挑戰使用原速遊戲迴圈，於60000ms收集27顆並立即結算。左右各四次以上、10至1順序與重疊、UI及果實動畫長暫停、失焦及隱藏、恢復、到期固定分數、重玩及返回清理均通過。設定三種時長、舊版遷移、保存／取消／重設通過。
- 攝像頭測試使用合成landmarks與實際GLB，時鐘加速fixture驗證到期及停止推論，4個model全部close，tracks全部ended，Berry紋理清除。純視覺提示重疊及對話框到期另有明確標示fixture。
- 最終報告errors[]，故意阻擋GLB的預期載入診斷單獨記錄。1920×1080、1512×982及600×800截圖已核對，倒數位於兔子上方，窄畫面結算按鈕完整可見。鍵盤及合成相機Three約60FPS。
- 證據保留於 `/private/tmp/mg-berry-timed-{keyboard,camera,dialog}-final/`、`/private/tmp/mg-berry-timed-carrot-regression/`及 `/private/tmp/mg-berry-timed-{typecheck,unit-tests,build}.log`。真人webcam、其他瀏覽器及目標硬件尚待實測。

### 本輪驗收結果（2026-10-23）

- Typecheck / production build：通過；Node test：150 / 150通過。
- Berry鍵盤瀏覽器：通過，左右各三次完成、1920×1080及1512×982。
- Berry模擬相機：通過，3次會話的tracks全ended，3個landmarker全close，沒有殘留Three紋理，console errors為0。
- 既有 `qa:rabbit3d`、`qa:mocap`、`qa:mocap-engine`：通過；包含原Carrot五次鍵盤完整流程。
- 鍵盤及合成相機Three約60 FPS；真實MediaPipe引擎配虛擬圖案約20 FPS，平均推論17.58ms。沒有真人實驗。
- 故意阻擋GLB的fallback測試會產生預期HTTP載入錯誤，其餘正常遊戲無console error。

## 視覺改版：暖陽繪本果園（2026-10-25）

本輪只修改美術、燈光及輕量UI。`LegExtensionDetector`、`HumanPoseExtractor`、`MotionRetargeter`、`RabbitRigController`、`RabbitFootTracker`、`BerryKickRound`、`BerryKickInput`均保留原檔案內容；沒有新增Calibration或動作品質評分。

### Blender來源與重建

執行 `npm run build:berry-art`，再執行 `npm run sync:assets`。

- `model/scripts/blender/create_berry_trees_v2.py`：彎曲漸細樹幹、自然分枝、細木紋、約350片帶中脈的弧形葉片／每樹，以及由飽滿小核果組成的覆盆子。左右使用不同樹冠分布與隨機種子。來源為 `model/assets/blender/scenes/berry_trees_v2.blend`。
- `model/scripts/blender/create_berry_environment_v2.py`：暖奶油天空、遠山與遠景果園、矮木欄、連通小路、不規則細紋沙地、前景花草苔石、交錯柳編籃子。來源為 `model/assets/blender/scenes/berry_environment_v2.blend`。
- 原 `create_berry_assets.py` 和 `berry_garden.blend` 保留，供舊版造型追溯。
- 六個既有PNG全部更新：背景／前景1600×900、左右樹800×1120、覆盆子256×256、籃子800×640。仍是獨立圖層，沒有烘焙兔子或可掉落果實。

### 構圖與光色

樹的位置、顯示尺寸、兔子的初始位置、縮放與腳底高度保持原值。樹幹碰撞區仍是 normalized `[.455,.45,.09,.52]`，判定規則沒有修改。果實改用左右各九個不規則掛點與輕微大小／角度差異，不再排列成整齊紅球網格。

平台由孤立縱向形狀改成橫向連貫的花園空地。籃子從 `(800,812)` 移至 `(800,780)`、顯示尺寸從160×128改為180×144，避免底部說明欄遮擋，亦對齊原有收集動畫終點。兔子只有環境光、暖色主光和落地陰影調整，模型、骨骼與動作不變。

配色採奶油天空、薄荷遠山、深淺葉綠、蜂蜜／肉桂木色與覆盆子紅。Blender採柔光、填充光與48樣本降噪；草地及沙地使用細微材質變化，減少均勻塑膠感。UI沿用全部香港繁體文案，改用奶油卡片、細金褐邊框與柔陰影。

### 視覺核對

概念圖 `model/art-direction/berry-orchard-concept.png` 由內置Image Gen產生，只作暖果園光色、植物層次與柳編的方向參考。正式遊戲資產全部由Blender建模渲染。刻意保留既有GLB兔子、固定碰撞布局、較簡潔的遠景與現有文字資訊層級，沒有把概念圖的寫實毛絨角色、巨大樹冠或裝飾木牌直接套進遊戲。

核對項目：樹冠葉片輪廓與左右差異、木色與枝幹線條、覆盆子顆粒及不規則掛點、前中後景色彩區分、兔子腳底與空地、籃子遮擋、HUD文字／間距、掉落莓果可見性、1920×1080及1512×982構圖。可見文案未新增／刪除，僅加入無文字裝飾果實圖示。

本輪最終驗收：typecheck、build通過，155/155自動測試通過。IAB目視檢查及Chrome既有Berry流程測試完成；1920×1080和1512×982、六次採果、掉落果實、暫停／重玩／回主頁皆通過。正常流程無console錯誤；故意阻擋GLB的測試產生預期載入錯誤。實測渲染約60 FPS。七個受保護核心檔案SHA-256與修改前一致。

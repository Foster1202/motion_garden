# 莓果大豐收 / Berry Tree Kick

## 遊戲與操作

主頁 → 開始遊戲 → 莓果大豐收。選攝像頭或鍵盤後開始限時挑戰。預設120秒，在首頁「設置」可選60／90／120秒，於下次開局套用。每次成功踢中任意樹幹掉落三顆莓果，總分增加三顆。兩棵樹均可持續收集，只有時間耗盡才完成。

鍵盤：A / D 左右移動，Q / E 左右伸腳，放開收腳，Esc 暫停。鍵盤與相機使用同一個 RabbitRigController、投影及樹幹碰撞判定。暫停畫面提供繼續、重新開始及返回主頁。真人只需小幅、緩慢、舒服地伸腳，可用旁邊穩固椅子支撐；不需要踢到真實物件。

## 架構

- `scenes/BerryKickScene.ts`：場景、提示、HUD、生命週期。
- `berry/BerryKickRound.ts`：純遊戲規則，與姿勢偵測分離。
- `berry/TreeTrunk.ts`：每棵樹獨立莓果清單、搖晃及掉落動畫。
- `settings/gameSettings.ts`／`SettingsPanel.ts` 保存及選擇挑戰時長，舊設定自動補上120秒並保留既有值。
- `berry/BerryKickInput.ts`：鍵盤或 PoseCamera / PoseEstimator。
- `mocap/LegExtensionDetector.ts`：無校準、身體尺寸歸一化動作偵測。
- `mocap/HumanPoseExtractor.ts` 的 `extractLegMotion` → `MotionRetargeter.retargetLegMotion`：沿用動作管線，Berry 路徑不接受 CalibrationProfile。
- `3d/RabbitRigController.ts`：連續腿部 FK。
- `3d/RabbitFootTracker.ts`：骨骼世界位置投影。
- `berry/BerryRabbitView.ts`：Three.js → Phaser CanvasTexture 橋接。
- `berry/berryConfig.ts`：目標次數、冷卻、收腿/伸腿門檻、圖層及樹木布局。

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

## 無校準動作偵測

`LegExtensionDetector` 讀取肩、髖、膝、腳踝關鍵點。先用影像寬高比修正座標，再以左右髖→膝→踝分段長度均值歸一化。腳踝相對同側髖部的向外位移可消除整體橫移；髖中心相對短暫參考中心則獨立決定 root translation。

- 左右方向由肩及髖的解剖 ID 排序推導，支援已鏡像或未鏡像輸入。
- 向外量小於0.07腿長為死區；0.28腿長映射到1，中間連續變化。這是程式預設值，不是通用人體舒適度保證。
- 三個可靠影格自動建立記憶體內的中心及尺度；沒有計時保持姿勢、按鈕、屈膝要求或長期個人姿勢儲存。
- 70ms 指數平滑；支撐腿、膝蓋方向、髖部高低、軀幹傾斜及可信度共同限制誤判。不是動作質量評分，也不能保證辨識所有失平衡情況。
- 可信度門檻0.55；超過300ms無新影格，Input立即標記不可靠、停止計分。超過500ms追蹤中斷後重新自動建立參考。
- 關鍵點不足時提示調整鏡頭站位，沒有用猜測資料加分。

## 連續骨骼與左右移動

`setLegExtension(side, amount)` 將0–1映射到最多32°髖部側展，腳部反向補償；使用模型 rest pose 的局部軸合成，與既有膝部彎曲相容。不是播放預設 Kick 動畫。原始 GLB 的 L 腳向+X；Berry 視圖鏡像 pivot X，使玩家左腳與畫面左樹一致。

實測原始 GLB 左腳骨X從0.265連續移至0.46637模型單位，向上變化0.05774。沒有修改 GLB 或重建Rig。根容器獨立平移，能在移動時同時伸腳。場景初始化實際測量休息與伸腳投影距離，按當前 rabbitScale 設定可移動邊界，使休息腳留在樹幹外，伸腳後才能接觸；角色不會無限穿越兩棵樹。

## 3D → 2D 碰撞

`foot.L/R.getWorldPosition` → `Vector3.project(camera)` → NDC轉1600×900邏輯座標。投影讀取真實骨骼世界矩陣，包含兔子縮放、root平移、鏡像和camera。Phaser FIT只縮放最終畫布，不改變邏輯碰撞座標。

左樹只查左腳，右樹只查右腳；腳骨必須在可見鏡頭範圍、進入對應樹幹矩形，伸腿量至少0.4，root靠近該側，資料可靠，未暫停、尚有挑戰時間，且已收腿及冷卻。腳骨是保守接觸點，不按整個腳掌外輪廓加分。網址加 `?berryDebug=1` 顯示左右腳點及樹幹矩形。

每次命中後解除該腿armed。只有伸腿量回到0.15以下才重新armed，並須滿足1000ms遊戲時間冷卻。一直伸腳不會重複得分。追蹤丟失、暫停及恢復會解除兩腿armed，必須重新收腿。每次命中以三顆計分，果樹補回可採果實。計分沒有數量上限，到期後結果固定。

狀態包括READY、MOVING、LEG_EXTENDING、TREE_HIT、BERRIES_FALLING、RECOVERY、COMPLETE；不阻斷連續骨骼更新。

## 暫停、失敗及資源

回合時鐘使用Phaser遊戲幀的delta及scene timeScale，有限正delta完整計入，動作平滑另限制單次步長。姿勢不可靠仍會倒數。到達截止時間的同一幀先鎖定COMPLETE，停止計分並立即顯示一次結算。

暫停停止計分、規則時間、Three更新、推論、樹木／莓果Tweens及UI提示動畫。Berry場景的TweenManager停用自動牆鐘更新，逐幀以同一遊戲delta推進各Tween。UI使用暫停的Web Animations，currentTime由回合elapsedMs驅動。失去視窗焦點或頁面隱藏自動暫停，須按「繼續玩」恢復，恢復首幀跳過舊delta。返回主頁／重玩會中止載入、停止camera tracks、關閉PoseEstimator、移除影片與事件監聽、銷毀renderer及GPU資源／CanvasTexture。到期、載入失敗及離場都清除動態提示、掉落果實及Tween回調。

GLB載入或WebGL失敗只顯示替代角色提示，禁止所有莓果計分並提供返回主頁。沒有可行的腳骨時鍵盤也不假裝可以正常玩。

## 限時挑戰 UI

頂部顯示MM:SS剩餘時間及「收集 N」，移除左右進度框。每次成功命中增加獨立「🍓 +3」提示，在上方以彈跳、輕微放大及淡出播放約一秒，多次提示各自保留及清除。

最後十秒在上方中央顯示10至1的大型描邊數字，每個數字播放1100ms，具有彈跳放大、短暫停留及淡出，切換保留約100ms重疊。數字區域位於角色上方，提示層不接收操作事件。到期清除提示及掉落動畫，結算顯示「挑戰完成！」、總莓果顆數及設定時長，提供「再玩一次」「返回主頁」。

## 測試與效能

執行 `npm run typecheck`、`npm run build`、`npm test`。測試覆蓋左右、鏡像、尺度、平移與伸腿、可信度、收腿、投影／camera／scale／viewport、hitbox、正確腳、冷卻、全部時長、無限計分、到期邊界、暫停恢復及固定結算；既有Carrot及rig測試保留。

`npm run qa:berry` 使用已安裝Chrome和Playwright，預設localhost:5175，截圖與結果寫入 `/tmp/berry-kick-qa/`（可用 QA_URL/QA_OUTPUT 覆寫）。驗證1920×1080、1512×982及600×800、完整60秒鍵盤挑戰、左右各四次收穫、幾何接觸、錯腳不計分、長伸腿、動畫暫停恢復、頁面隱藏、全部倒數數字、結算、重玩、返回及GLB失敗。獨立提示重疊採用明確標示的純視覺fixture。`scripts/qa-berry-camera.mjs` 驗證模擬camera管線及遊戲時間加速的到期結算，`scripts/qa-dialog-buttons.mjs` 使用到期fixture驗證結算按鈕。

Three輸出1200×675透明畫布再貼到1600×900 Phaser世界。鍵盤Chrome headless實測約60 FPS；這不是所有裝置的保證。CPU MediaPipe上限25 FPS，推論和render頻率分離。

## 已知限制

未進行真人webcam驗證；合成關鍵點／虛擬相機只能驗證軟體管線，不代表長者動作或所有鏡頭高度都已驗證。正面鏡頭須看清雙髖、雙膝及雙腳；側身、遮擋或裁掉腳會停止計分。現有兔子腿較短，伸腿視覺幅度有限；採用安全小幅FK而非全身IK，沒有重新塑形或動作質量評分。本次只新增莓果遊戲。

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

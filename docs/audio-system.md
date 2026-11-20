# 遊戲音效與後續配音／BGM

更新於 2026-11-20。

## 使用方式

首頁「設置」提供獨立的「音效開關／音效音量」及「語音開關／語音音量」，預設均開啟，音效60%、語音80%。儲存後即時套用，重新載入亦會保留。取消會放棄當次修改，恢復預設需按儲存才生效。舊版 localStorage 會補上音效預設值並保留已有設定。

五個音效包含四個原創短音，以及 2.8 秒的真人歡呼伴掌聲完成提示。完成提示使用 jessepash 的 CC0 錄音，經裁剪、頻率處理、淡入淡出及峰值限制。來源、檔案規格與數位響度列於音效授權文檔。已接入使用者提供的七段粵語配音，BGM 預設音量25%，可按下方接口加入音樂。[音效授權文檔](../THIRD_PARTY_NOTICES.md#audio-asset-provenance)

## 管理與事件

每個場景持有一個 `AudioManager`。建立時預載及解碼五個音效 WAV 及該遊戲的配音，首次可信任的 pointer／keyboard 互動會恢復 AudioContext。場景切換後可沿用瀏覽器已授予的使用者互動資格，後續互動亦可重試恢復。尚未完成解碼或解鎖的短音事件直接略過。`preload()` 可等待解碼完成，並重試先前載入失敗的音效。

UI 按鈕在 `#game-ui` 內共用 capture click listener，滑鼠及鍵盤啟動均只觸發一次。拔蘿蔔在每棵首次 GRABBED 播放抓握音，Sprite 在實際 pull 回調播放收穫音，正式 3D 在 SUCCESS 轉換播放收穫音。每棵分數標記防止重入或回退重播。拔蘿蔔的初次引導等待玩家選好輸入模式、完成相機動作設定及穩定參考後播放。明確繼續／重設輸入會按當前步驟重新引導。莓果只在 `BerryKickRound` 接受命中並加三分時播放一次收集音。莓果玩法說明在開局後第一個可靠輸入才播放，成功鼓勵會保留正在播放的說明，並與上一段成功語音至少相隔8秒。兩個遊戲在唯一完成入口清理先前聲源並播放各自的完成配音及共同掌聲。

同一音效 45ms 內去重，UI 按鈕為 80ms。每次播放使用獨立 BufferSource，最多六個短音同時播放。達上限時停止最早的短音。輸出經各頻道 gain、master gain 及 compressor 到 destination。

`pause()` 停止短音及配音，保存 BGM 位置。`resume()` 從該位置恢復選定 BGM。暫停畫面按鈕仍可提供按鍵音。普通 tracking loss 亦暫停 Carrot 音頻，可靠動作恢復後繼續。頁面隱藏停止播放，顯示時只有未被場景暫停的 BGM 可以恢復。完成畫面的輸入停止保留完成提示。退出或重新開始會 `destroy()`，中止 fetch、使待播工作失效、停止聲源、斷開節點、清空快取與註冊，並關閉該 AudioContext。

載入／解碼失敗及不支援 Web Audio 的環境會安全略過播放。`snapshot()` 提供解鎖狀態、頻道音量、活躍聲源、累計短音次數及有界錯誤摘要，供既有場景 debug snapshot 與 QA 使用。

## 已接入的粵語錄音

原始 M4A 保留於 `assets/audio-sources/`。以下文案依使用者提供的檔名記錄，聲音處理只調整音頻訊號。`assets/audio-sources/voice-processing.json` 記錄每段原檔／輸出雜湊、裁剪位置、響度與處理參數。

| 遊戲事件 | 原始錄音檔名 | Runtime 檔名 |
| --- | --- | --- |
| 蘿蔔開始引導 | `慢慢踎低 幫阿兔捉住蘿蔔.m4a` | `carrot-ready.wav` |
| 蘿蔔捉穩／起身 | `捉實啦 慢慢企返起身.m4a` | `carrot-grabbed.wav` |
| 蘿蔔成功拔出 | `成功抆到蘿蔔好叻呀.m4a` | `carrot-success.wav` |
| 蘿蔔五棵完成 | `完成啦.m4a` | `carrot-complete.wav` |
| 莓果開局玩法 | `左右兩邊都可以！慢慢伸腳掂下樹幹，再收返隻腳.m4a` | `berry-ready.wav` |
| 莓果收集鼓勵 | `好叻呀！莓果跌落嚟喇.m4a` | `berry-success.wav` |
| 莓果限時完成 | `挑戰完成.m4a` | `berry-complete.wav` |

`好叻呀.m4a` 保留作備選，兩個成功錄音已包含相同鼓勵詞。錄音由使用者於2026-11-20提供並指示用於專案。配音期間 SFX 乘以0.35、BGM乘以0.3，結束或取消後平滑恢復。明確暫停、失去追蹤、切換輸入、退出及重新開始都會取消當時的配音，新的遊戲事件才會播放下一句。

```sh
npm run prepare:voices
```

此命令需要 Python3 與 FFmpeg，根據原始錄音重製 `public/assets/audio/voice/` 並更新處理紀錄。實際裁剪、音量與噪音測量以紀錄檔為準。

## 可補錄的語句

現有錄音已覆蓋兩個遊戲的主要活動步驟。以下畫面仍以文字提示，可補錄以延伸全程語音引導。

| 場景 | 建議粵語文案 |
| --- | --- |
| 開啟體感前安全提示 | 請保持地面清爽，旁邊最好有穩固椅子。 |
| 等候玩家入鏡／失去追蹤 | 我睇唔清楚你，企返鏡頭中間少少。 |
| 自然站立動作設定／參考 | 請自然企直，雙手放鬆，保持一陣。 |
| 舒服淺屈膝動作設定 | 舒服咁輕輕屈膝，唔使蹲得深。 |
| 明確暫停／休息 | 休息一陣先，準備好再繼續。 |
| 動作保持未完成／再試 | 慢慢嚟，準備好再試一次。 |
| 下一棵蘿蔔 | 下一棵蘿蔔準備好喇。 |
| 鏡頭啟動失敗 | 鏡頭暫時未能開啟，可以揀鍵盤試玩。 |

## 加入配音

將自己的錄音加入 `public/assets/audio/voice/`，在對應場景持有的 AudioManager 註冊。`registerVoice()` 回傳的 Promise 在載入嘗試完成後結束，錯誤可由 snapshot 查閱。現有 ready／grabbed／success／complete 事件已有場景呼叫，其餘 ID 可用於後續說明事件。錄音應在事件發生前完成註冊，並在使用者選擇輸入模式／開始說明時播放 ready。

```ts
const audio = new AudioManager('carrot');
await audio.registerVoice('ready', `${import.meta.env.BASE_URL}assets/audio/voice/ready.wav`);
await audio.registerVoice('grabbed', `${import.meta.env.BASE_URL}assets/audio/voice/grabbed.wav`);
audio.setVolume('voice', 0.8);
// Run this handler from the user's start/instructions control.
async function playInstructions() {
  await audio.unlock();
  audio.playVoice('ready');
}
```

`VoiceId` 包含 `ready`、`bend`、`grabbed`、`stand`、`success`、`retry`、`complete`。每次 `playVoice()` 取代上一句，包括仍在載入的一句。替換同一 ID 的錄音會取消舊待播句子。`stopVoice()` 可立即停止說明。暫停後舊說明會被取消，需要由新的說明事件明確播放。配音播放期間 BGM 降至其設定音量的30%、音效降至35%，配音結束／取消後平滑恢復。

`playVoice(id, { interrupt: false, cooldownMs: 8000 })` 用於短鼓勵，保留正在播放或等候載入的說明，並按該ID上次實際開始的時間限制重播。被略過的鼓勵會由下一次新的事件再嘗試。`playVoice()` 回傳是否接受當次請求，載入／解碼仍以非同步完成。

## 加入 BGM

將自己的音樂加入 `public/assets/audio/bgm/`，在場景初始化時註冊。首次互動後選定音樂會開始循環。相同 ID 的重複 `playBgm()` 只保留一條音軌，快速切換取最後一次選擇。替換同一 ID 的檔案後需再次選擇該音樂。

```ts
await audio.registerBgm('garden', `${import.meta.env.BASE_URL}assets/audio/bgm/garden.wav`);
audio.setVolume('bgm', 0.25);
audio.playBgm('garden');
// Scene pause/resume hooks already call these methods.
audio.pause();
audio.resume();
// Stop selection and reset its position when changing music deliberately.
audio.stopBgm();
```

音效與語音開關分別管理 SFX 及配音。`setVolume('sfx' | 'voice' | 'bgm', 0…1)` 提供各頻道控制，`setMuted(true)` 可靜音全部頻道。`stopAll()` 取消所有待播配音和 BGM 並停止現有聲源。`destroy()` 在場景關閉時釋放資源。配音／BGM 註冊及音量 API 的變更保留於該實例，後續作者可在場景建立時套用自己的曲目與音量設定。BGM 會解碼至記憶體，短循環音樂可直接使用此接口。

## 驗證

```sh
npm run prepare:voices
npm run typecheck
npm test
npm run build
QA_URL=http://127.0.0.1:5182/ QA_OUTPUT=/private/tmp/motion-garden-voices npm run qa:voices
QA_URL=http://127.0.0.1:5182/ QA_OUTPUT=/private/tmp/motion-garden-audio npm run qa:audio
```

`qa:audio` 以 installed Chrome／Playwright 操作真實 DOM、AudioContext 與 BufferSource，量測輸出 PCM，執行完整五棵鍵盤遊戲、實際莓果腳骨投影命中及明確標記的倒數完成 fixture。錄音及 BGM 的接口測試借用本次已授權音效作測試檔。結果與截圖由 `QA_OUTPUT` 輸出至倉庫外。最新實際結果見 AGENTS.md 的本次交接記錄。

## Web Audio 參考

使用者互動解鎖、AudioContext.resume 及每次短音建立獨立 BufferSource 的實作依據。[MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) [MDN AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume) [MDN AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)

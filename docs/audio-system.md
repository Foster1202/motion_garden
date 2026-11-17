# 遊戲音效與後續配音／BGM

更新於 2026-11-17。

## 使用方式

首頁「設置」提供「音效開關」和「音效音量」，預設開啟、60%。儲存後即時套用，重新載入亦會保留。取消會放棄當次修改，恢復預設需按儲存才生效。舊版 localStorage 會補上音效預設值並保留已有設定。

五個原創音效以柔和短音、上行和音及 2.45 秒完成提示組成。來源、檔案規格與數位響度列於音效授權文檔。配音與 BGM 的音量分別預設 80% 及 25%，尚待作者加入錄音和音樂。[音效授權文檔](../LICENSES/audio-assets.md)

## 管理與事件

每個場景持有一個 `AudioManager`。建立時預載及解碼五個 WAV，首次可信任的 pointer／keyboard 互動會恢復 AudioContext。場景切換後可沿用瀏覽器已授予的使用者互動資格，後續互動亦可重試恢復。尚未完成解碼或解鎖的短音事件直接略過。`preload()` 可等待解碼完成，並重試先前載入失敗的音效。

UI 按鈕在 `#game-ui` 內共用 capture click listener，滑鼠及鍵盤啟動均只觸發一次。拔蘿蔔在每棵首次 GRABBED 播放抓握音，Sprite 在實際 pull 回調播放收穫音，正式 3D 在 SUCCESS 轉換播放收穫音。每棵分數標記防止重入或回退重播。莓果只在 `BerryKickRound` 接受命中並加三分時播放一次收集音。兩個遊戲在唯一完成入口清理先前聲源並播放完成提示。

同一音效 45ms 內去重，UI 按鈕為 80ms。每次播放使用獨立 BufferSource，最多六個短音同時播放。達上限時停止最早的短音。輸出經各頻道 gain、master gain 及 compressor 到 destination。

`pause()` 停止短音及配音，保存 BGM 位置。`resume()` 從該位置恢復選定 BGM。暫停畫面按鈕仍可提供按鍵音。普通 tracking loss 亦暫停 Carrot 音頻，可靠動作恢復後繼續。頁面隱藏停止播放，顯示時只有未被場景暫停的 BGM 可以恢復。完成畫面的輸入停止保留完成提示。退出或重新開始會 `destroy()`，中止 fetch、使待播工作失效、停止聲源、斷開節點、清空快取與註冊，並關閉該 AudioContext。

載入／解碼失敗及不支援 Web Audio 的環境會安全略過播放。`snapshot()` 提供解鎖狀態、頻道音量、活躍聲源、累計短音次數及有界錯誤摘要，供既有場景 debug snapshot 與 QA 使用。

## 加入配音

將自己的錄音加入 `public/assets/audio/voice/`，在對應場景持有的 AudioManager 註冊。`registerVoice()` 回傳的 Promise 在載入嘗試完成後結束，錯誤可由 snapshot 查閱。現有 ready／grabbed／success／complete 事件已有場景呼叫，其餘 ID 可用於後續說明事件。錄音應在事件發生前完成註冊，並在使用者選擇輸入模式／開始說明時播放 ready。

```ts
const audio = new AudioManager();
await audio.registerVoice('ready', `${import.meta.env.BASE_URL}assets/audio/voice/ready.wav`);
await audio.registerVoice('grabbed', `${import.meta.env.BASE_URL}assets/audio/voice/grabbed.wav`);
audio.setVolume('voice', 0.8);
// Run this handler from the user's start/instructions control.
async function playInstructions() {
  await audio.unlock();
  audio.playVoice('ready');
}
```

`VoiceId` 包含 `ready`、`bend`、`grabbed`、`stand`、`success`、`retry`、`complete`。每次 `playVoice()` 取代上一句，包括仍在載入的一句。替換同一 ID 的錄音會取消舊待播句子。`stopVoice()` 可立即停止說明。暫停後舊說明會被取消，需要由新的說明事件明確播放。配音播放期間 BGM 降至其設定音量的 30%，配音結束／取消後平滑恢復。

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

音效開關只管理 SFX。`setVolume('sfx' | 'voice' | 'bgm', 0…1)` 提供各頻道控制，`setMuted(true)` 可靜音全部頻道。`stopAll()` 取消所有待播配音和 BGM 並停止現有聲源。`destroy()` 在場景關閉時釋放資源。配音／BGM 註冊及音量 API 的變更保留於該實例，後續作者可在場景建立時套用自己的曲目與音量設定。BGM 會解碼至記憶體，短循環音樂可直接使用此接口。

## 驗證

```sh
npm run typecheck
npm test
npm run build
QA_URL=http://127.0.0.1:5179/ QA_OUTPUT=/private/tmp/motion-garden-audio npm run qa:audio
```

`qa:audio` 以 installed Chrome／Playwright 操作真實 DOM、AudioContext 與 BufferSource，量測輸出 PCM，執行完整五棵鍵盤遊戲、實際莓果腳骨投影命中及明確標記的倒數完成 fixture。錄音及 BGM 的接口測試借用本次原創短音作測試檔。結果與截圖由 `QA_OUTPUT` 輸出至倉庫外。最新實際結果見 AGENTS.md 的本次交接記錄。

## Web Audio 參考

使用者互動解鎖、AudioContext.resume 及每次短音建立獨立 BufferSource 的實作依據。[MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) [MDN AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume) [MDN AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)

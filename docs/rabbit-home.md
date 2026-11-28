# 阿兔回家

阿兔走過森林小徑、小溪與木橋和星光歸途。120 個有效踏步完成旅程，停下時保留距離和燈籠。兩座木橋各有指定路線。走到水邊時可以跟箭嘴換路，再由當前位置繼續。

- `RabbitHomeRound` 管理路程、左右腳交替、換路、燈籠、關卡和抵達。
- `RabbitHomeInput` 共用 MediaPipe 模型、鏡頭、畫面及效能統計。鍵盤使用 `Q`／`E` 和方向鍵。攝像頭失敗後的鍵盤切換保留路程。
- `HomeStepDetector` 用當次站立參考、時間式平滑和雙腳高低差辨識踏步，以未抬腿作為支撐檢查。可用腳踝或膝頭，兩套量測各自校準。踏步間隔使用輸入時間戳。失去追蹤、重新入鏡或轉換訊號後，先確認已站穩才接收下一步。鏡像換路以肩寬比例估算輕微重心移動。
- `HomeJourneyView` 畫前進路面、樹影、燈籠、橋和小屋，與共用 Three.js 兔子分層合成。低效能模式降低渲染成本、鏡頭解像度和推理頻率。
- `RabbitHomeScene` 透過共用 `Overlay`、`GameIntroLayout` 和 `AudioManager` 管理示範、提示和休息畫面。粵語播放沿用安全、站立、失去追蹤、休息和完成錄音，可用 `AudioManager.registerVoice` 或 `home` 配音設定替換錄音。走路、關卡和抵達沿用遊戲音效。

## 場景圖片

`public/assets/rabbit_home/` 有四張 768×512 WebP，來自同一張 Codex ImageGen 圖集。以專案的 `berry_background.png` 作為色調、質地和樹形參考。四格分別為黃昏森林、青藍溪畔、靛藍星空及橡果屋封面。原圖等分裁切成四格後以 `cwebp -q 88 -m 6` 壓縮。內建工具未回傳可核對的 Images 2.6 API 變體識別碼。

生圖提示詞

> Create a production-ready scenic environment atlas for the existing indie game Motion Garden (soft rounded clay, satin pastel surfaces, simple large shapes like a gentle children's picture book rendered as miniature clay diorama), landscape 3:2, exact edge-to-edge 2x2 grid without gutters. Four equal independently cropped illustrations. Be exceptionally careful to align the horizon/vanishing point at x50%, y50% within the three environment panels. TOP LEFT: twilight forest path with dusty apricot sky glimpses and muted sage green distant wooded hills; flanking dark sage treetops build a welcoming tunnel, space in center. TOP RIGHT: dusk pale teal woodland beside a little creek, lilac clouds and cool aqua fog, broad grassy margins, no foreground water (that is animated separately). BOTTOM LEFT: indigo starlit forest with distant lilac hills, blue-green conifers, scattered small stars; warmly welcoming mood, no building (that is rendered separately). For all three scenic plates keep center clear, far layers silhouettes, lower half covered in simple flat grassy glade gradients without paths at all (path animated separately). Saturated enough to distinguish, subtly textured, soft gradients, no hard lineart, softly-lit, reminiscent of a cozy community garden. Use the supplied existing daylight orchard strictly as the soft matte illustration/texture and tree-shape style reference. BOTTOM RIGHT: a separate full artwork as a cozy miniature cover for the same game, featuring a golden-window acorn cottage with sage green scalloped roof in a moonlit clearing, pastel clay wildflowers, winding butter-colored path, teal fern fringe, lanterns. No rabbit or people anywhere, no typography, no words, no numbers, no UI, no dividers, no watermarks. Treat each quadrant as a complete image with exact 50% divisions.

## 驗證方式

```sh
npm run typecheck
npm test
npm run build
QA_URL=http://127.0.0.1:5173/ npm run qa:rabbit-home
```

真人舒適踏步的抬腳幅度、站位、不同鏡頭高度與遮擋及兒童和長者的可用性，需在目標裝置上驗證。

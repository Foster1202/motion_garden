# Task 4E-Fix — 真人 Webcam 动作同步修复

更新于 2026-11-17。2026-11-16 开始修复 Webcam 到最终 GLB 骨骼的同步、参考采集和运行时诊断。用户随后明确要求左右镜像，并在现有花园扩大前后左右活动范围，本轮包含这些改动。

## 1. 故障定位与证据

原有参考采集对 `HumanPose.left/rightArmElevation` 使用 25° 门槛，对肘部使用 35° 门槛。该手臂角度包含 MediaPipe 单目 z，z 按视频宽度换算，y 按视频高度换算。正面画面中自然下垂的上臂也可能产生较大的三维角度。

可重现的 640×360 样本投影抬手角度为 8°，肘部 z 偏差为 -0.075，原始三维抬手角度为 46.266°。旧 25° 检查会持续拒绝这个样本，`capture()` 每次都清空样本。另一组 1600×900、上臂垂直长度 90px、z 差 0.075 的计算得到三维角度 53.13°，投影角度为 0°。

旧 `MocapController.acceptFrame()` 在提取出 HumanPose 后会清除 `lastRejection`，包括参考采集失败的情况。因此能够出现 Frames Received 和 Human Poses Extracted 持续增长、Mapped Poses 为 0、Reference Ready 为 false、面板重复显示等待自然站立的组合。

用户原故障发生时的完整运行时记录未提供。上述代码路径和数值复现证明了与所述症状一致的阻断机制。后续真人测试直接确认当前代码能建立参考、输出映射并改变实际骨骼。

| 阶段 | 本轮核对结果 |
| --- | --- |
| Webcam → Landmarks | 沿用 PoseCamera 与单个 PoseEstimator 调度器。真人会话收到 3670 帧，首轮片段约 24 pose FPS |
| Landmarks → HumanPose | 提取包含可靠性检查，新增具体失败原因。首轮真人记录提取 1283 个 HumanPose |
| HumanPose → MotionReference | 原三维自然姿态门槛和逐帧清空样本可阻断采集。当前改用投影姿态检查、可靠时间计数及稳健基线 |
| MotionReference → RabbitPose | 原始三维参考偏差直接相减会压缩抬手幅度。当前结合有效投影增量与三维增量 |
| MocapController | 首个有效共享姿态回调会启用控制器。首轮真人已有 340 个有效映射姿态 |
| RabbitRigController | `applyPose()` 暂存目标，`update()` 经既有 V3 关节限制与 IK 写入真实骨骼 |
| Coordinator | PLANTED 阶段直接沿用 Mocap。抓取期间协调器接管左侧主手，右侧手臂和身体继续跟随 |
| Final GLB Bones → 渲染 | 测试比较最终 Quaternion、Root 位置和渲染帧。真人复测额外读取 Rabbit 纹理数值签名 |

模式选择根据目标模式变更触发加载，正常连续相机帧沿用同一控制器。新浏览器回归验证一份模型、一条 Stream 和同一推理调度器完成五轮。

## 2. 参考采集修复

- HumanPose 同时提供三维和按视频比例修正的二维手臂角度、肘角、投影上臂长度。
- 自然姿态门槛采用投影证据，继续使用 25° 手臂、35° 肘角、25° 侧倾及个人 Calibration 的站立阈值。
- 600ms 只累计相邻可靠采样之间的时间，并要求至少 8 个样本。短暂低置信度、无效深度或离群帧暂停计时，近期可靠进度可以保留。
- 整个 HumanPose 提取失败也会调用 `rejectFrame()` 中断时间累计。交替有效帧和躯干低置信度帧的回归确认进度保持 0。
- 超过 250ms 的失效或断档重新确认连续性。采样窗口上限为 1800ms，中心、尺度及投影角度以中位数进行稳定性比较，参考值也采用可靠样本的中位数。
- 投影上臂最小长度为投影躯干的 0.2。长度 0.08、三维角度约 84.29° 的近肩前伸样本会被拒绝。首轮真人自然站姿的左右比例分别为 0.5957 和 0.5608，高于该门槛。
- 原有开发预览保留尺度变化 0.35／中心偏移 1.5 的站位检查，返回后以 600ms 和至少 8 帧恢复原参考。生产游戏启用 `gardenMovement`，可靠的走动沿用原参考，平移和尺度变化交给场景移动处理。
- 「重設參考姿勢」单独重采 MotionReference。游戏控制区和 DEV 面板均提供入口。

原有舒适浅屈膝 Calibration 数值规则沿用既有实现。本次真人已经能够完成该流程。

单目深度与前伸投影仍有歧义。这次前伸拒绝用例与一位真人的自然站姿记录支持当前修复，更多人体比例、遮挡和镜头位置仍需实测。

## 3. 卡顿与幅度修正

游戏就绪检查原先多次调用完整 `MocapController.snapshot()`。新增最终骨骼诊断会生成 Quaternion、Position、条件数组等数据，放在每帧热路径会增加开销。当前使用轻量就绪 getter 和当前平滑姿态 getter，完整 DEV 诊断在调用快照前即限制为每 150ms 一次。单测通过让完整快照 getter 抛错，确认连续 120 次就绪与姿态读取走快速路径。

可靠姿态回调曾受输入层的动作恢复防抖影响，在原始 PoseSnapshot 已可靠时仍被重标为 TRACKING_LOST。当前直接传递分类器原始姿态。预览按 Mocap 自身的有效性决定骨骼更新，动作恢复等待继续约束回合计分和附件状态。实际无效帧仍保持原姿态，状态及诊断持续更新。

Three 绘制和 CanvasTexture 上传限制为每秒最多约 60 次，继续使用既有 Scene 时钟，骨骼和附件更新仍随原有时钟执行。扩展游戏渲染区为 1300×720，以容纳整体移动和抬臂。

抬手目标采用三维增量和有效投影增量的较大值，再应用原有限幅。缺少投影参考的旧调用继续使用三维增量。投影自然角度 8°、三维自然角度 46.266°、侧抬投影 80° 的案例，目标从约 36.77° 提升到 72°，最终 V3 骨骼约为 71.6°。

### 横移幅度的实际阻断与场景移动

用户真人复测报告了走动时移动幅度小。实际 V3 GLB 测量如下，默认显示换算为 87.537 逻辑像素／模型单位。

| 请求横移 | 最终 Root 横移 | 可见横移 | 最大脚底误差 |
| --- | --- | --- | --- |
| 0.10 | 0.10 | 8.754px | 4.32e-7 |
| 0.30 | 0.12 | 10.504px | 4.32e-7 |
| 0.45 | 0.12 | 10.504px | 4.32e-7 |

局部固定脚底 IK 将 Root 横移限制在 ±0.12，这是之前左右走动可见幅度约 10.5px 的直接原因。用户追加活动范围要求后，新增 `RabbitWorldMotion.ts` 在 `Rabbit3D.pivot` 上处理整体位置。局部骨骼、碰撞约束和 IK 继续使用原有求解。

- 左右位移按参考肩宽归一化，保留镜像预览方向，最大整体横移为 ±2.5 模型单位，约 ±219 逻辑像素。生产游戏的局部 `lateralOffset` 为 0，避免重复位移。
- 前后位移采用投影躯干长度相对参考的变化，肩宽变化需与躯干尺度相符。尺度比相差超过 0.18 时保持既有深度，横移继续。缺少旧调用的躯干尺度时使用肩宽兼容路径。
- 正交相机采用有界 2.5D 地面表现，前后范围为 z±2，地面 y=-0.4z，整体大小为 0.8–1.2。缩放补偿保持足底地面锚点，前进时位置向画面下方移动并稍微变大。该深度为单目相对估计。
- 位移使用死区和速度上限，失效、暂停及抓握时锁定当前场景位置。前后深度只在满足个人站立门槛时更新，防止浅屈膝缩短躯干投影被误当成后退；横移仍可跟随可靠中心位置。骨骼遮挡会使场景移动等待可靠帧。
- 花槽和篮筐维持固定世界位置。回到花槽周围 ±1.2 的区域才能开始屈膝。BENDING 时短距离辅助靠稳到既有抓取锚点，随后抓取、提起和入篮阶段保持位置，沿用原有五轮计分和主手辅助。
- 前后深度在既有 Phaser 图层中调整 Rabbit 与花槽前缘的遮挡顺序。游戏画面复用现有花园资源。

手臂镜像在 Mocap 输出端交换完整左右 Elevation／ElbowBend／Plane，HumanPose 与参考基线保留解剖左右。侧倾、横移和头部原有符号已匹配镜像预览，继续沿用。

## 4. 运行时诊断

DEV 的正常 3D 游戏入口直接显示「即時動作同步 · 開發數據」。可查看 Person Detected、Calibration Complete、Camera Ready、Mocap Enabled、Reference Ready、Reference Progress、Reference Rejection Reason、采集条件及实际值、Frames Received、Human Poses Extracted、Mapped Poses、Mocap Tracking State、二维／三维左右手臂角度、原始侧倾／膝角、RabbitPose Targets、最终骨骼 Quaternion／Position、Last Frame Age、推理耗时和渲染提交状态。

同时显示 Root X 请求／实际值、IK 是否限制 Root、整体场景位置／目标／深度可靠性、镜像标志、世界坐标最终手脚骨骼位置、控制器 generation、gameplayReady、gameWasReady、Phaser 图像可见性及纹理是否存在。分类器失败包含原始 `PoseSnapshot.reason`，便于区分躯干、腿部、丢帧及缺少人物。

| 阶段提示 | 排查方向 |
| --- | --- |
| A | 缺少新帧或帧已过期，同时查看相机状态与输入帧数。暂停也会停止新帧 |
| B | HumanPose 提取失败，查看 classifier、置信度、腿侧、几何或时间戳原因 |
| C | 参考未建立或等待站位恢复，查看每项条件、累计进度及拒绝数值 |
| D | 参考已建立，映射尚未出现变化，核对原始运动和目标 |
| E | 映射目标发生变化，实际骨骼尚未响应，核对写入、模式、限幅和变化年龄 |
| F | 骨骼已有变化，渲染提交过期、图像隐藏或纹理缺失，检查 Three → CanvasTexture → Phaser 路径 |
| 已提交渲染 | 数值提交链路已有更新，结合实际 Rabbit 画面或纹理签名核对可见效果 |

重采参考和等待追踪使用非阻塞提示。新按钮沿用当前膝盖 Calibration。

## 5. 最终骨骼自动验收

`tests/LiveWebcamReference.test.ts` 使用实际 V3 GLB 和 IK，覆盖深度偏差、抖动、部分关键点低置信度、持续抬手／屈膝拒绝、持续失败恢复、整帧提取失败的时间计数、快速就绪读取，以及最终骨骼响应。

`scripts/qa-live-webcam-mocap.mjs` 通过实际相机与推理调度、分类器、两步 Calibration、Mocap、Coordinator 和最终 GLB 骨骼完成测试，Landmarker 输出为明确标记的合成输入。正常游戏路径使用 `?carrotGameDebug=1`。

| 动作 | 实际最终骨骼结果 |
| --- | --- |
| 真人解剖左臂侧抬 | 镜像写入 upper_arm.R，实际 Quaternion 改变；修复前基准测试约 71.6° |
| 真人解剖右臂侧抬 | 镜像写入 upper_arm.L，实际 Quaternion 改变 |
| 双臂侧抬 | 左臂约 71.635°，双侧 Quaternion 均变化 |
| 左右侧倾 | body 分别约 8° |
| 舒适浅屈膝 | shin.L 约 23.952° |
| 前后左右及四个角落 | 整体世界位置响应，前后 scale 在 0.8–1.2，实际变形后完整模型包围盒位于渲染区内 |
| 自然站立 | 连续稳定输入后最终手臂骨骼保持稳定 |
| 离开再返回 | 校准和参考继续使用，最终骨骼恢复响应 |
| 五轮拔萝卜 | 得分 1、2、3、4、5，每轮抓握期间检查非主手右臂最终 Quaternion 变化 |

回归另验证持续抬手导致参考拒绝，自然下垂后进入 TRACKING。手动重采及场景走动均检查 Calibration、参考基线、模型数、Stream 数和分数。远离花槽屈膝保持 READY，回到起点可以继续五轮。抓握期间改变真人站位，Rabbit 世界位置保持锁定，非主手继续实时更新。最终报告包含目标、自然姿态 Quaternion、最终 Quaternion、局部／世界位置及渲染帧数。

## 6. 真人 Webcam 验收

### 首轮实际真人记录

用户在实际本地 Chrome 中操作了 Webcam，使用真正的 MediaPipe 模型。用户反馈为「Rabbit 开始跟随，但是画面会卡，同时动作映射有些许问题」，随后说明走动和整体动作幅度偏小。

首轮数值记录如下。

| 指标 | 值 |
| --- | --- |
| Camera Frames Received | 3670 |
| Mocap Frames Received | 2803 |
| Human Poses Extracted | 1283 |
| Mapped Poses | 340 |
| Reference Ready | true |
| 左上臂实际相对自然姿态范围 | 0–39.574° |
| 右上臂实际范围 | 0–34.802° |
| 躯干实际旋转范围 | 0–20.589° |
| 胫骨实际旋转范围 | 0–21.866° |
| 数值轮询观测到的骨骼变化 | 167 次 |

这轮证据确认参考建立、映射及实际骨骼跟随已经恢复。用户也明确报告了质量问题，随后加入幅度修正、热路径快照降频和原站位自动恢复。

### 第二轮实际真人记录

第二轮到达 5／5，Mocap 收到 3113 帧，提取 1784 个 HumanPose，映射 1451 次，Reference Ready 为 true，提交 Rabbit 渲染 8114 次。五轮片段右上臂实际变化最大约 34.81°，主手约 77.26°，胫骨约 33.20°。Rabbit 纹理数字签名同时发生变化。

用户反馈为「幅度与流畅度明显改善，偶尔短时间卡顿」，并明确要求镜像及扩大前后左右活动范围。数值片段中，双手抬起和自然站立阶段出现了较多提取拒绝及保持帧。定时提示流程完成并不能证明每个单独动作质量通过，这些项目需在最终版本继续复测。

随后短测读取了具体分类器原因，包括 missing-pose、unreliable-or-leaning-torso、unreliable-legs、calibrated-legs-unavailable，以及旧站位尺度变化触发的参考等待。记录包含参与者进入／离开画面的时段，因此各原因总次数不能直接当作站立或抬手时的失败率。当前保留置信度与动作安全检查，修正可靠帧被恢复防抖重标及正常走动触发重采的路径。

### 最终镜像与移动复测

2026-11-17 已打开正常游戏的新会话，等待参与者依次检查镜像双侧、前后左右移动、自然站立和五轮游戏。本次实际记录已进入镜像和前后左右活动，双臂阶段的目标分别达到约 75.46°／72.60°，左右活动达到 x=-2.5／+2.28，渲染约 60FPS。

该版本的五轮阶段暴露了新的开始阻断。浅屈膝时投影躯干尺度从参考 0.2754 降到约 0.1445，肩宽从 0.1009 到约 0.0813；过渡帧把深度推到 z=-2，随后被尺度一致性检查保持，花槽门槛因此持续拒绝 READY。用户反馈「主要是无法开始拔萝卜」。

修复将生产深度更新限制为个人站立门槛，屈膝保持前后目标，横移仍可响应。花槽辅助区域从 ±0.35 调整为 ±1.2，开始屈膝后平滑靠稳至既有锚点，再累计回合保持与启动抓握。曾通过本地热更新保留 Calibration／MotionReference 调整当前会话。测试窗口随后关闭，按参与者要求重新打开最终源码的正常游戏页。临时真人 QA 工具恢复上一轮真实测得且经 `setCalibration()` 验证的个人 Profile，原两步膝盖角度数据保持一致，新的自然站姿参考由真实 Webcam 帧重新采集。生产代码和持久化设置均未增加 Profile 自动恢复。

最终真人复测已完成 5／5，分数为 0、1、2、3、4、5。实际摄像头收到 1724 帧，Mocap 收到 1722 帧，提取 1133 个 HumanPose，映射 1033 次，参考建立成功。五轮活动阶段的 1025 个输入帧均被接受，数值轮询记录 tracking 43 次、holding 1 次。非辅助右上臂实际 Quaternion 最大变化约 50.02°，主手约 97.55°（包含游戏抓握辅助），躯干约 17.10°，胫骨约 26.70°。渲染约 59.71–60.43FPS，推理耗时 17.1–20.2ms。

该结果验证修复后能够从 READY 开始并完成原有五轮，实际骨骼响应。镜像、双臂与前后左右已在此前真人活动片段读取到目标／世界变换，单侧镜像方向和全部边界另有自动回归。最终屈膝补丁后的真人选择性复测聚焦五轮，完整九项动作未再次全部逐项重跑。遮挡和单目深度的通用质量仍需结合具体设备评估。

摄像头影像在本机 MediaPipe 管线处理。真人复测只收集数值诊断、最终骨骼 Quaternion 和 Rabbit 渲染纹理的数字签名。

## 7. 检查与复现

世界移动、镜像和浅屈膝深度回归后的最终全量单测为 354／354 PASS。typecheck、build PASS。正常游戏 Webcam 浏览器回归 23 项 PASS，镜像最终骨骼、前后左右与四角边界、远近花槽门槛及五轮抓握均通过。模型数 1、Stream 数 1，结束全部释放。恢复防抖时 input.suspended 仍为 true，Mapped Poses 从 773 增到 774，实际镜像右臂 Quaternion 变化约 1.874°，回合状态、分数和保持进度继续等待。单纯屈膝使躯干尺度变为参考的 0.65、肩宽变为 0.80 时，BENDING 的实际／目标场景 z 均保持 0，随后完成五轮，每轮抓握误差为 0。

最终集成已通过 `qa:carrot-game` 28 项、`qa:carrot-grab` 24 项、`qa:mocap` 24 项、`qa:ik` 11 项、`qa:rig-v3` 7 项、`qa:rabbit3d`、`qa:berry`、`qa:berry-camera` 和 `qa:mocap-engine`。实际 MediaPipe 模型空虚拟镜头仍使用单调度器，推理约 20FPS、平均约 16.18ms，Three 约 60FPS。该空镜头测试用于模型生命周期验证。

```sh
npm run typecheck
npm test
npm run build
npm run dev -- --port 5185 --strictPort
QA_URL=http://127.0.0.1:5185/ QA_OUTPUT=/private/tmp/motion-garden-4e-world-qa-final node scripts/qa-live-webcam-mocap.mjs
```

本次浏览器验证采用已安装的 Chrome 157 和 Playwright，Browser 插件未提供。主要数值及合成截图保存在本机临时目录 `/private/tmp/motion-garden-4e-world-qa-final/`，最终各套回归位于 `/private/tmp/mg4e-garden-regressions/`。横移与手臂约束测量分别为 `/private/tmp/motion-garden-4e-amplitude.json`、`/private/tmp/motion-garden-4e-arm-amplitude.json`。真人摘要为 `/private/tmp/mg4e-human-first-observation.json`、`/private/tmp/mg4e-human-second-observation.json` 和 `/private/tmp/mg4e-human-rejection-observation.json`，最终五轮摘要为 `/private/tmp/mg4e-human-final-observation.json`。临时数值证据保留在本机，未上传个人影像。

## 8. 交付判定

参考采集持续失败的代码机制已修复，实际 GLB 回归及真人会话均观测到参考建立、Mocap 进入 TRACKING 和真实骨骼响应。真人第二轮完成五轮，并确认幅度与流畅度改善。最终版本已通过真人五轮，并保留上述逐项真人复验范围限制。单目相对深度、遮挡、不同身体比例、其他浏览器和目标硬件性能仍存在验证范围限制。

本轮修改涉及 `HumanPoseExtractor.ts`、`MotionRetargeter.ts`、`mocapConfig.ts`、`MocapController.ts`、`MocapDebug.ts`、`MotionInputController.ts`、`Rabbit3DPreview.ts`、`RabbitWorldMotion.ts`、`ThreeOverlay.ts` 和 `CarrotPullScene.ts` 的重采入口，以及对应单元测试、浏览器脚本和本报告。模型资源、局部 Rig／IK 求解、CarrotRound 计分规则继续使用现有实现。

# Task 4C-2 — Realtime IK, Foot Contact and Motion Coordination

本阶段仅修改 TypeScript／Three.js 的运行时姿势控制。所有 Blender、GLB、Sprite、场景与原始动画资产保留。Carrot 的 V3 开发预览默认开启 IK；`rabbitIK=0` 可直接比较旧 FK。V2／Berry 保留 FK。完整 Carrot Sprite 游戏继续可用。

## 姿势流程与控制权

```text
共享 MediaPipe scheduler → HumanPoseExtractor → MotionRetargeter
→ MotionSmoother → rig.applyPose() 暂存目标
→ V3 相对手部目标／受限 Arm IK → Quaternion 插值
→ 实际插值姿势的肩肘／头部组合约束
→ transform-only pose buffer → Leg IK／Foot Contact
→ 200ms 模式切换混合 → 一次提交最终骨骼 → 现有 Three.js／Phaser 渲染
```

`RabbitRigController` 的原有 setters 保留，只设置目标。新的 `applyPose()` 将 Mocap 的一帧目标集中提交，旧 mock／适配器仍可使用原 setters。求解用的影子层级只有 Object3D／Bone transform，不包含 GPU mesh、材质、纹理、动画或第二个渲染循环。实际骨骼在 `update()` 最后统一写入；腿部不再覆盖已写入的真实 Root。

类本身默认 FK，以保留原 183 项测试及调用方式。V3 预览在加载后启用 IK，`setIKEnabled(false)` 平滑切回 FK。停用／启用的 200ms 线性混合只用于模式切换，没有新增持续 EMA。暂停沿用场景时钟停止，退出时释放影子层级和原有渲染资源。

## 腿部与接地

`TwoBoneIK` 用余弦定理求关节位置，固定两段实际骨长；pole 使用角色前方 +Z，避免膝反折。不可达目标投影到可达球壳，处理零距离、平行 pole、退化长度及非有限输入。

`RabbitLegIK` 从 V3 Rest 读取 hip／knee／ankle、局部与模型空间方向及父层级变换。求得的模型空间方向转换为父骨局部 Quaternion；不缩放骨骼。膝上限来自模型 `limits.knee × 2`，当前为 48°。站立时保留原 Rest Quaternion。身体侧倾作用于 body，腿仍由 root 支撑，头和耳朵沿用原层级。

`FootContactController` 保存初始脚踝和实际网格最低脚底的固定模型空间目标。每帧从当前 hip 重新求解，不累计上帧修正。双脚各有独立目标，支持有界的小幅站位调整。脚部保持 Rest 模型空间方向，使脚底接地点不因脚踝旋转落入平台。

Root 的原 FK 屈膝下降作为请求，去除 FK 的前后补偿后，投影到两腿共同可达的垂直区间；横移限制 ±0.12、前后 ±0.08 模型单位。正向抬高 Root 和较大横移可能被限制，避免拉长腿或悬空。限制映射连续，原 Quaternion／位置插值继续生效。这是原地有界站姿，不包含步态、接触检测、平衡物理或移动平台追踪。

## 手臂与碰撞协调

`RabbitArmIK.forward()` 使用实际肩→肘、肘→手 Rest 向量，将已有 RabbitPose 的肩角、肘角和抬臂方向推导为相对肩部手部目标。目标随躯干运动，不将单目 landmark 深度视为准确的人体三维位置。`setHandTarget()` 可设置同一相对坐标系中的外部目标。

固定肘轴的解析逆解提供种子；对于不可达／受限目标，在 V3 已验收的肩／肘运动曲面内进行有界搜索。前一解用于连续性选择。每臂最多约 325 次轻量 endpoint 计算，复用 scratch 向量和结果；可达角度推导目标通常只需一次计算。求解器选择更近的可行手部位置，不保证不可达目标的全局最优解。

肩上限保持 150°，并使用 GLB 中完整肘部曲线：75°／110°、90°／75°、105°／60°、120°／45°、135°／20°、150°／0°。头部总旋转幅度也随实际最高肩角下降，150° 时回到中立。约束在目标阶段及 Quaternion 插值后的实际姿势上执行。这里的组合约束沿用 Task4C-1 实测范围；全身任意碰撞和动态物理仍未实现。

例如原请求肩120°／肘110°／方向45°，仅限肘的手部残差约0.3876模型单位，IK 约0.2435，解可降低肩角并改变方向以靠近目标。这个残差在 Debug 如实显示，不声称完全命中。

## 平滑与追踪丢失

原系统中，手臂／躯干直接使用 HumanPose 当前可靠 landmark，腿部分类 landmark EMA α=.35。后者低频等效延迟约1.857帧（25Hz约74ms）；游戏分类 debounce 不额外阻塞连续 TRANSITION 姿势。推理最高25Hz，实际相机／推理时延需独立测量。600ms站姿参考与校准采样仅为启动步骤。

默认目标手臂速度上限180°/s，120°阶跃目标至少667ms；最终 Quaternion 的14/s插值时间常数约71ms。V3 的 Mocap 使用响应式双速度档：剩余误差超过12°的部分最高540°/s，最后12°沿用180°/s。积分按两个速度区间计算，保持恒定目标下的帧率一致性。小幅噪声／其他通道和默认旧调用均保留原行为，没有增加滤波层。

数值120°阶跃：目标／显示90%响应，旧方式约600／671ms，V3响应式约200／308ms。小幅6°阶跃两者相同。这是目标到模型的数值结果，不能加总解释为真人相机端到端延迟。

Tracking Lost 沿用原机制：短暂保持，600ms后逐步中立，恢复后通过相同目标限速和骨骼插值重新同步；没有新增休息弹窗。IK 不启动推理或 RAF。Reset 清除外部手部目标及求解器历史，恢复固定站位；pause/resume、dispose 沿用现有生命周期。

## 开发调试

`?rabbit3dDebug=1&mocapDebug=1` → 开始游戏 → 拔萝卜 → 键盘测试／摄像头。持久 IK panel 不受手动／Mocap 控制权切换影响，提供「啟用 IK」「停用 IK」、脚目标／接地误差、手目标／残差、组合限制状态、求解时间。V2 显示为不支持 IK。生产模式没有调试控件。

`ikSnapshot()` 复制所有诊断坐标，保存的快照不随下一帧变化。手部 `solverResidual` 表示目标解误差，`residual` 表示当前实际插值骨骼的误差；停用IK后清除手部解显示。脚误差根据实际提交的骨骼重新测量；模式切换中的误差也会如实显示。`solverTimeMs` 包含目标求解、工作层级更新、插值和最终提交，FK 对照也测同一段代码；不等同于整帧 GPU／相机时间。

## 验证与视觉证据

2026-11-10 使用 Node22／Chrome157.0.8103.39 验收。当前没有 Browser 插件，使用项目已安装的 Playwright／Chrome；所有浏览器输入均为手动或合成姿势。

- `npm run typecheck`、`npm run build`：PASS。
- `npm test`：**215/215 PASS，0 skipped**；原183项保留，新增32项。
- 新测试分布：`RabbitLegIK.test.ts`11项、`RabbitArmIK.test.ts`9项、`RabbitIKLifecycle.test.ts`8项、`RabbitMotionCoordination.test.ts`4项。
- 覆盖解析可达／不可达、pole／反向膝、独立脚、Rest／四档屈膝、侧倾／横移／举手组合、实际mesh形变及穿头检查、loss／恢复、pause／resume、reset／dispose、非法输入、不可变快照与实际残差。旧Sprite／Berry生命周期继续回归。
- 实际V3组合mesh：最小三角面积比0.05586、最大边长比1.70321；没有跨过既有严重塌陷／拉伸阈值。腿部45个组合姿势最小面积比0.3814、最大边长比1.7517。
- Chrome `qa:ik`：**11项检查／24个FK-IK姿势 PASS**。最大脚踝位置漂移5.95e-7、脚底高度误差5.33e-7模型单位，验收容差为0.005。横移0.1时，FK脚漂移约0.1，IK约4.11e-7。1000帧数值检查没有累积误差。

| 相同组合姿势，独立约5秒采样 | FK | IK |
| --- | ---: | ---: |
| 观测FPS | 60.03 | 59.90 |
| 完整控制器更新平均时间 | 0.204ms | 0.272ms |
| 更新P95 | 0.40ms | 0.50ms |
| 更新最大时间 | 0.40ms | 0.60ms |

该时间包含整个姿势更新而非仅解析公式，浏览器计时精度会量化结果；FPS差异很小，不能据此外推目标硬件性能。Node单臂微基准可达／受限目标P95约0.003／0.061ms。

持久化图像／报告位于 `docs/qa/task-4c2/`：`fk-vs-ik.png` 为相同相机／灯光／比例的8行对比，`ik-continuous.gif` 为实际Three.js输出的520×520、60帧、6秒合成动作；`ik-combined-ui.png`／`ik-resize-600.png` 为实际游戏页面。`browser-report.json` 保存静态姿势、连续帧和性能数据；`latency-analysis.json` 明确数值响应与真人延迟的区别；`asset-preservation.json` 保存原资产哈希。临时完整帧位于 `/private/tmp/motion-garden-4c2-ik/continuous-frames/`。

既有 Chrome 回归全部 PASS：`qa:mocap`22项、`qa:rabbit3d`15项（含五萝卜Sprite完整游戏）、`qa:rig-v3`7项、`qa:berry`／`qa:berry-camera`各7项；`qa:mocap-engine`使用真正WASM／模型及虚拟空图案，121帧持续等待、不弹自动休息。Berry刻意阻断GLB降级测试的 `net::ERR_FAILED` 为预期诊断，其余无未预期console／page error。六份回归报告及 `acceptance-summary.json` 已保存在同一证据目录。

既有Mocap浏览器检查仍要求实际前抬骨骼超过50°；因响应式目标更快，等待条件同时等待目标和实际骨骼到位，未降低原角度断言。`qa:rig-v3` 使用 `rabbitIK=0` 保留其原有FK角度验证，新的IK行为由专项QA和实际mesh测试覆盖。

```sh
npm run typecheck
npm test
npm run build
QA_URL=http://127.0.0.1:5178/ npm run qa:ik
QA_URL=http://127.0.0.1:5178/ npm run qa:rig-v3
QA_URL=http://127.0.0.1:5178/ npm run qa:rabbit3d
QA_URL=http://127.0.0.1:5178/ npm run qa:mocap
```

真人 webcam 尚未验证。测试和图像仅覆盖声明的合成／手动姿势，不证明所有人体动作、目标硬件或其他浏览器均适用。原地浅屈膝的静态 FK 本已接近接地，主要改善是连续过渡、组合横移和受限手部目标的协调。V3 原有肘膝内侧 LBS 压缩仍存在。

Task4C-2 完成后停止。Task4D 需另行授权；任何真实3D拔萝卜、手指、重力平衡及新模型均未开始。

# Task 4C-1 — Rabbit Rig Improvement for Real-time Motion Capture

本阶段从保存的 `rabbit_realtime_v2.blend` 派生 V3。V2 的四肢长度、头部尺寸、原有表情和材质作为视觉基准。目标是改善真实网格的关节空间和线性蒙皮，并将经验证的范围接入现有 3D 开发预览。

## V2 诊断

Blender 5.2.1 LTS 的 Python 诊断记录于 `model/qa/rig-v3/diagnostics-v2.json`。诊断先于模型修改。

| 检查项 | 实际发现 | V3 处理 |
| --- | --- | --- |
| 头肩几何空间 | glTF 头部横向约 ±0.796，肩 pivot 只有 ±0.515 | 肩移至 ±0.770，整体头部与附属面部／耳朵上移 0.18 单位 |
| Arm Rest Pose | 上臂约 23° 外展，高举时前臂轨迹接近头侧 | 改为约 6° 自然外展，保留 V2 骨段长度 |
| 肩部连接 | 原连接位置适用于旧肩宽 | 增加两个沿用原白色材质的圆润肩部连接网格 |
| 局部旋转轴 | 既有 rest-frame 模型轴转换正确 | 保留转换方法，整理上臂／前臂／手部 roll 定义 |
| 肘部 | V2 使用避开大头的动态方向和角度限制，实际屈曲可小于请求 | V3 使用随上臂继承的明确模型 -X 屈曲轴，范围由实际组合姿势约束 |
| Skinning | Blender Preserve Volume 与 glTF LBS 有差异，旧权重按世界高度分带 | V3 静态细分在绑定前完成，按实际肘／腕／膝／踝位置重新配权重，使用 LBS |
| 层级和脚部 | 19 骨名称完整，腿连接 root，浅屈膝 FK 已有支撑补偿 | 保留这些行为，改善关节权重过渡 |

V2 未限幅的实际网格测试中，120° 侧抬最大穿入约 0.0843 单位，150° 约 0.3169。前抬 120° 亦出现约 0.0416 单位穿入。碰撞检测同时使用 BVH 表面交叉、内部顶点及穿入深度。

## V3 模型与比例

- 基础是保存的 V2，继承 arm chain ×1.38、leg chain ×1.45、head ×0.93 的已有比例。
- 本次相对 V2 的手臂、腿部链长度和头部缩放均为 ×1.0。头部、眼睛、脸颊、嘴巴和耳朵整体上移，亲子关系保留。
- 肩 pivot 从 Blender `(±0.515, -0.005, 1.637)` 调整到 `(±0.770, -0.025, 1.650)`。手肘和手部位置随新的自然下垂方向重新排列。
- 19 根骨骼名称和基本父子层级保留。前臂与手部设为连续连接，骨段长度误差控制在 0.00001 单位以内。
- 髋、膝和踝 pivot 位置保留。原有圆润 V2 细分表面烘焙为静态绑定网格，关节权重重新建立。
- 肘、腕、膝、踝的权重过渡宽度分别为 0.30、0.10、0.19、0.16 单位，每个顶点最多两个非零权重，权重归一化。
- 继续使用七个原有材质，保留暖白身体、粉红内耳、面部颜色和圆尾。新增两个圆肩网格后共 23 个 mesh。

V3 的完整身高随头部间距改变。`Rabbit3D` 继续从实际网格 bounds 统一拟合到 342 logical px，并以真实脚底定位。游戏场景坐标和相机无需为 V3 改写。

## 实际活动范围

肩部直臂侧抬、前抬和斜抬测试到 150°，这是本阶段已验证并采用的上限，更高范围未验收。以下均为相对 Rest 的 FK 旋转角度；Rest 上臂约 6° 外展。屈肘可在较低举手角度达到 110°。大幅举手时，同时大幅屈肘或转头仍可能接触大头，因此 V3 保存明确的组合范围。

| 肩部抬起 | 最大肘屈曲 | 头部目标旋转向量幅度 |
| --- | --- | --- |
| 0° | 110° | 40° |
| 75° | 110° | 25° |
| 90° | 75° | 20° |
| 105° | 60° | 15° |
| 120° | 45° | 10° |
| 135° | 20° | 5° |
| 150° | 0° | 0° |

节点之间连续线性插值。头部各轴仍受 yaw 25°、pitch 18°、roll 14° 限制。躯干侧倾／前倾为 18°／16°，浅屈膝沿用髋 24°／膝 48°，保持个人舒适范围的输入含义。

`elbow_limits_by_raise` 与 `head_limits_by_raise` 保存于 rig extras。运行时读取每个模型的范围。原 V2 资源继续使用其 90° 肩部、100° 肘部及旧头部协调方式。全局角色信号上限允许 V3 范围，人体提取、校准和 MotionRetargeter 计算逻辑保持现有实现。

原始请求与实际骨骼角度分别记录。验收脚本会保留 120°／150° 配合 90°／110° 肘部等超出组合范围的原始失败姿势，并单独测试允许范围的边界。模型在这些极端未限幅组合下仍有明显穿模。

## 形变检查

Blender 验收与渲染统一使用导出等效的线性蒙皮。V2 的原始文件保留 Preserve Volume 设置，比较时只在内存中切换为 LBS。

| 指标 | V2 | V3 |
| --- | --- | --- |
| 屈肘 90° 最小三角形面积比例 | 约 0.03190 | 约 0.09305 |
| 屈肘 110° 最小三角形面积比例 | 约 0.04008 | 约 0.05586 |
| 屈肘 110° 最大边长比例 | 约 1.614 | 约 1.703 |
| 浅屈膝 100% 最小面积比例 | 约 0.0738 | 约 0.139 |
| 浅屈膝 100% 最大边长比例 | 约 1.712 | 约 1.702 |

BVH、边长和面积比较固定使用 Rest 的三角形／边索引，避免姿势后的四边形对角线变化影响结果。关节压缩减少，110° 屈肘的局部最大边长伸长略增。测试保留这个取舍。V3 支持范围采样中没有面积低于基准 3% 的严重塌陷三角形，也没有超过 2.5 倍的严重边长拉伸。膝内侧仍有可见折痕，肘部内侧仍有 LBS 压缩。脚底和踝关节在纯浅屈膝采样中的偏移约为 0.0000002 单位。该结果适用于被测试的 FK 姿势。

最终 Blender 几何结果为 **PASS_WITH_LIMITS**：973 个原始姿势中，945 个支持范围内姿势全部通过（含 905 个组合边界姿势）。其余 28 个请求超出声明范围，19 个标为 UNSUPPORTED、9 个有实际几何 FAIL。支持姿势最大头部穿入为 0，对称误差约 4.92e-7，Rest 恢复误差为 0。连续 Blender 检查使用中立头部，头部方向另以组合边界检查；Three.js 测试另覆盖连续举高、放下、换方向和头部请求。

## Socket 与接口兼容

`carrot_socket` 继续位于 root 下，名义位置为 glTF `(0, 1.30, 0.50)`，处于身体前方的双手操作区域。它是独立参考点，尚未随手部自动抓握。新增的 `setCarrotSocketOffset(x, y, z)` 提供有界、rest-relative 模型坐标控制，使用现有 targetPosition 插值，并随 Reset／Dispose 恢复。

后续手部 IK 可用两手掌的实时位置更新这个独立目标。V3 保留旧骨骼名称和查找方式，当前资产不包含抓萝卜或 IK 操作。

## 文件与重复构建

主要输出和工具如下。

- `model/assets/blender/rabbit/rabbit_realtime_v3.blend`
- `model/dist/rabbit3d/rabbit_realtime_v3.glb`
- `model/dist/rabbit3d/rabbit_realtime_v3.report.json`
- `model/dist/rabbit3d/rabbit_v3_rig_changes.json`
- `public/assets/rabbit3d/rabbit_realtime_v3.glb`
- `model/scripts/blender/improve_rabbit_rig_v3.py`
- `model/scripts/blender/validate_rabbit_rig_v3.py`
- `model/scripts/blender/render_rabbit_rig_v3.py`
- `model/scripts/compose_rabbit_rig_contact_sheets.mjs`

```sh
npm run build:rabbit3d -- --version v3
npm run sync:assets

BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python model/scripts/blender/validate_rabbit_rig_v3.py
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python model/scripts/blender/render_rabbit_rig_v3.py
node model/scripts/compose_rabbit_rig_contact_sheets.mjs
```

生成器每次重新打开保存的 V2。导出沿用现有 exporter，增加 `--output-name` 来生成独立 staging、GLB 和 report。默认 V2 构建路径保留，V3 分支不会运行比例 V2 生成器。同步工具同时保留 canonical V2 和命名 V3。

独立重复构建没有重复对象、骨骼或材质。两份 GLB 的 JSON、坐标、法线、权重、绑定矩阵和材质相同；两个刚性肩部 mesh 的三角形列表顺序不同，但有向三角形集合完全相同，因此不承诺逐字节哈希相同。详细证据及受保护文件哈希见 `model/qa/rig-v3/reproducibility.json`。

最终导出含 19 骨、1 skin、23 mesh、7 材质、24,587 顶点及 48,176 三角形，大小 962,928 bytes。V3 GLB SHA-256 为 `68ea7937ec5ff78ace5f8162f711569b149aa8d71f94a6b016c7eb6d756235bd`；V3 Blender SHA-256 为 `764d2fdc3b8683b418e860d983a97969ee1284b0f801baeb7cbfa9cb5e416558`。public V3 与导出文件完全一致。

源文件保护覆盖 base、rigged、V2 和 canonical V2 GLB。Sprite、动画与场景 PNG 的保存状态由 Git diff 和资产检查验证。导出继续使用 Blender `(x,y,z)` → glTF `(x,z,-y)`，即 +Y 向上、+Z 正面。

## 视觉与浏览器验收

视觉文件位于 `model/qa/rig-v3/`。

- `comparison-v2-v3.png` 保持相同视角、灯光和站立显示高度。
- `contact-v3-upper.png` 展示 Rest、多方向举手及举手屈肘。
- `contact-v3-body-legs.png` 展示肘部、侧倾、浅屈膝和组合动作。
- `joint-details-v2-v3.png` 提供肘、膝和踝的多角度近图。
- `unsupported-combinations.png` 保留超出范围的原始失败姿势。
- `renders/render-manifest.json` 记录渲染源 hash、相机、姿势和图像。
- `geometry/rig-geometry-report.json` 记录支持范围和未支持请求的实际结果。

Carrot 3D 开发预览使用命名 V3。以 `?rabbit3dDebug=1&mocapDebug=1&rabbitRig=v2` 可加载保留的 V2。Berry 继续使用 canonical V2，完整 Sprite 资产沿用现有导出。

```sh
npm run typecheck
npm test
npm run build
QA_URL=http://127.0.0.1:5177/ npm run qa:rig-v3
QA_URL=http://127.0.0.1:5177/ npm run qa:rabbit3d
QA_URL=http://127.0.0.1:5177/ npm run qa:mocap
QA_URL=http://127.0.0.1:5177/ npm run qa:berry
QA_URL=http://127.0.0.1:5177/ npm run qa:berry-camera
```

2026-11-10 最终检查结果如下。

| 检查 | 结果 |
| --- | --- |
| V3 生成、既有 exporter 导出及资源同步 | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS，183/183，0 skipped |
| `npm run build` | PASS |
| `qa:rig-v3` | PASS，7 项检查及 17 个实际预览姿势 |
| `qa:rabbit3d` | PASS，15 项，包含五萝卜 Sprite 完整游戏及资源释放 |
| `qa:mocap` | PASS，22 项，包含自动启动、Tracking Lost／恢复、Reset 和清理 |
| `qa:berry`／`qa:berry-camera` | PASS，7／7 项，沿用 V2 |
| `qa:mocap-engine` | PASS，实际 WASM／模型 121 帧，无人等待无自动休息弹窗 |
| Python／Node／Shell 语法及 Git diff 空白检查 | PASS |

Chrome 157.0.8103.39 通过 Playwright 验证；当前无 Browser 插件。V3 专项 Three.js 约 60.04 FPS；Mocap 合成姿势经实际生产 scheduler／render loop 约 20／60 FPS；真正 MediaPipe 对空测试图案的平均推理约 18.98ms。模型／相机／纹理清理检查通过。Berry 的一个 `net::ERR_FAILED` 来自刻意阻止旧 GLB 的降级测试，其他页面无未预期 console 或 page error。

持久化结果见 `model/qa/rig-v3/acceptance-summary.json` 和 `model/qa/rig-v3/browser/`，包含六份浏览器报告及实际 Three.js／Mocap 截图。原始临时日志位于 `/private/tmp/task4c1-*.log`，浏览器完整截图位于 `/private/tmp/motion-garden-4c1-*`。Contact Sheet 已检查最后一行图注，86 张原始 Blender 渲染均保留。保护文件哈希及重复构建结果见 `reproducibility.json`。

完成后仅建立本地提交；按照本任务要求不自动 push。V2 保留可回退，当前开发预览才切换为 V3。

当前阶段使用手动 FK、合成姿势和实际 GLB 进行验收。真人 webcam 尚未测试，未证明所有可能组合均无碰撞，也未实现脚底锁定。高举配合深屈肘仍有严重穿头，控制器根据实测曲线约束目标及插值中的实际角度；支持范围内未观察到明显穿头或严重破面，膝内侧折痕和局部 LBS 压缩仍存在。Task 4C-1 的资产和接口可以作为 Task 4C-2 的有界 FK 基础；后续 IK 必须继续遵守角色碰撞范围，并另行处理肩肘协调及支撑。此次停止于 Task 4C-1。

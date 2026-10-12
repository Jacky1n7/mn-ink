# MN Ink

在 MarginNote 4 的**脑图上直接手写**的插件：Notability / GoodNotes 那样的压感笔刷、按住自动规整图形、根号自动整齐、格子纸、局部橡皮擦、套索编辑。笔迹是矢量的，跟着脑图一起平移、缩放，放大也不糊，并且跟着最近的卡片移动。

> 状态：v0.2.0 原型。Mac 上已实测（鼠标 / 触控板）；iPad + Apple Pencil 的压感和手指缩放还没实测。

## 功能

| | |
| --- | --- |
| ✒️ **笔** | 钢笔（压感笔锋）、圆珠笔（均匀）、毛笔（收笔出锋）、铅笔（石墨灰）；压感轻 / 中 / 重三档；每档粗细可调 |
| 🖍 **荧光笔** | 半透明，永远在钢笔字下面；可开「自动拉直」，或画完按住拉直 |
| 📐 **图形** | 画完按住半秒 → 规整成直线、圆、椭圆、矩形、三角形、多边形、折线；**按住后继续拖动可微调**（直线改长度和方向、图形改大小）；图形工具下每一笔都自动识别，可选虚线（辅助线） |
| √ **根号** | 写完自动变成规整的根号；按住后拖动可以把横线拉长 |
| 🧲 **吸附** | 端点、角点吸附到其他图形的节点；开格子时吸附到格点；直线 15° 角度吸附，接近水平 / 竖直自动拉正 |
| 🩹 **橡皮擦** | 整笔擦除 / 局部擦除（把笔画切开）；只擦荧光笔；擦完自动切回上一个工具；三档大小 |
| ⭕ **套索** | 圈选后拖动、拉右下角缩放、改颜色、复制、删除；只选中一个图形时可以直接拖它的**节点**改形状 |
| 🗒 **书写背景** | 方格 / 点阵 / 横线，大中小三档，只在书写时显示，跟着脑图缩放 |
| 🎨 **颜色** | 笔和荧光笔各一排常用色；再点一次选中的颜色打开调色板（28 色 + 自定义） |
| ↩️ **撤销** | 书写模式自带撤销 / 重做（⌘Z / ⇧⌘Z） |

快捷键（Mac）：P 笔、H 荧光笔、S 图形、E 橡皮、L 套索、G 切换格子、⌘D 复制、Delete 删除、Esc 退出。
工具条左边的 ⋮⋮ 可以把工具条移到顶部 / 底部；**再点一次当前工具**打开它的设置。

## 安装

1. MarginNote：设置 → Extension → 打开「Allow uncertified extensions」（iPad 上同样要打开）。
2. 把 `MNInk-v0.2.0.mnaddon` 用 MarginNote 打开（Mac 双击；iPad 隔空投送后选 MarginNote），按提示重启。
3. 打开一个笔记本的脑图，点插件栏里的笔形图标进入书写模式，「完成」退出。

## 原理

- 书写模式是一层透明网页，只负责收集 Pencil 输入（压感、合并事件、预测点）并实时画出正在写的那一笔。
- 写完的笔画交给插件，用 `CAShapeLayer` 画进 MarginNote 自己的 `MindMapCanvas`，所以和卡片一起平移、缩放，任意缩放都是矢量清晰。
- 每一笔挂在最近的卡片上，卡片移动时笔迹跟着走；折叠的分支里的笔迹会一起隐藏。
- 笔迹按笔记本保存在 MarginNote 的 Documents/MNInk/<笔记本 id>.json。

## 限制

- 只能写在脑图上，PDF 页面暂不支持。
- 笔迹不随笔记本走 iCloud 同步，也不会出现在导出的笔记本里。
- 书写模式的撤销与 MarginNote 自己的 ⌘Z 是分开的。

## 开发

```bash
npm test                      # 图形识别单测 + 无头 Chrome 页面交互测试
npm run build                 # 发布版 → dist/MNInk-v<版本>.mnaddon
npm run build:dev             # 开发版：带热更新通道
node scripts/dev.mjs push     # 不重启 MarginNote，热更新全部代码和页面
node scripts/dev.mjs eval '<js>'
```

开发版带一个用随机密钥保护的 eval 通道（经 MN Agent Bridge 的回执程序返回结果），**不要分发开发版**。
会让 MarginNote 直接崩溃的调用（无法 try/catch）记录在 `addon/src/40-render.js` 文件头。

## 致谢

- [perfect-freehand](https://github.com/steveruizok/perfect-freehand)（MIT）——压感笔画轮廓算法，原样内置于 `vendor/`。
- [mn-docs](https://mn-docs.museday.top)——社区维护的 MarginNote 插件 API 文档。

## 许可

[MIT](LICENSE) © 2026 Xiaoran Li (@Jacky1n7)

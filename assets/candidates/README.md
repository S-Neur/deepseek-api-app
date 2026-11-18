# 图标素材

四款候选图标（512×512 PNG）+ 一份官方鲸鱼的矢量原文件。**当前应用使用的是 2 号**。

## 素材来源

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `1-官方图标.png` / `2-官方蓝底白鲸.png` / `官方鲸鱼.svg` | 从手机上官方 App（`com.deepseek.chat`）的 `base.apk` 里提取 | 官方 adaptive icon 的前景矢量路径，512 视口、渐变填充 `#5d78fe → #3d5afe` |
| `3-鲸鱼娘浅蓝.png` / `4-鲸鱼娘白底.png` | [fornarwhal/deepseek-whale-girl-icon](https://github.com/fornarwhal/deepseek-whale-girl-icon) 的 `improved-1.png` | Q 版鲸鱼娘透明底，合成到浅蓝/白底圆角方块上 |

更多同类素材：
- [xiaoweigen/deepseek-dafeiyu-assets](https://github.com/xiaoweigen/deepseek-dafeiyu-assets) —— 鲸鱼娘设定图（六视图、古风服装）
- [the-beating-light-of-the-nail/deepseek-chan-meme-pack](https://github.com/the-beating-light-of-the-nail/deepseek-chan-meme-pack) —— 1400+ 张表情包

## 怎么替换应用图标

```powershell
cd deepseek-app
node scripts/apply-icon.mjs assets/candidates/3-鲸鱼娘浅蓝.png
# 然后重新打包
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1
```

`apply-icon.mjs` 会一次性生成全套尺寸：

- `assets/icon-512.png`、`icon-192.png` —— PWA manifest 用
- `assets/icon-maskable-512.png` —— Android 自适应图标用（内容缩到 78% 留安全区，背景取自原图四角）
- `assets/apple-touch-icon.png`（180）、`favicon-64.png`
- `android/res/drawable/ic_launcher.png` —— APK 桌面图标

`assets/icon-source.txt` 记录当前用的是哪张，方便回溯。

## 官方鲸鱼的矢量路径

`官方鲸鱼.svg` 就是完整可用的 512×512 SVG，任何场景都能直接引用：网页 favicon、文档插图、其他 App 的图标。要换配色改 `linearGradient` 的两个 `stop-color` 即可。

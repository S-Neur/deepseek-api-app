# DeepSeek 自建客户端

把 DeepSeek 官方开源演示客户端（[deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，MIT）改造成自己的手机应用：
网页版（PWA）+ 安卓 APK，直连 `api.deepseek.com`，不走任何第三方中转。

## 产出物

| 文件 | 说明 |
| --- | --- |
| `release/deepseek-*.apk` | 安卓安装包，约 1.9 MB，自签名 |
| `dist/` | 纯静态网页，可直接丢到任意静态托管 |
| `dist/manifest.webmanifest` `dist/sw.js` | PWA 外壳：可"添加到主屏幕"、可离线开壳 |

## 关于 API Key

- 安装包里**不含任何 Key**，也没有 `.env` 或构建期注入。
- 首次使用在应用内「设置」里粘贴 Key，存在本机：
  - APK：WebView 的 localStorage（应用私有目录，非 root 不可读）
  - 网页：浏览器 localStorage（同一 origin 内）
- 想换 Key 或清掉，回设置页即可。卸载重装即彻底清除。

## 重新构建

```powershell
# 1. 装依赖（国内用镜像）
npm install --registry=https://registry.npmmirror.com

# 2. 构建网页
$env:NODE_ENV='production'; npx rspack build -c rspack.config.ts

# 3. 本地预览（手机同 WiFi 可直接访问打印出的地址）
node scripts/serve.mjs --port 8080

# 4a. 只做 APK 前置：首次需要下载 JDK + Android SDK（约 310 MB）
node scripts/fetch-toolchain.mjs

# 4b. 打 APK
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1
# 产物在 release/deepseek-<时间戳>.apk
```

## 构建脚本说明

不用 Gradle，直接用 SDK 里的工具链手工打包，避免拉几百兆的 Maven 依赖：

1. `aapt2 compile` 编译资源 → `aapt2 link` 生成基础 APK（只含清单、资源、图标）
2. `javac` 编译 `android/java` 下的代码 → `d8` 转成 `classes.dex`
3. `scripts/pack-apk.mjs` 自己按 zip 格式把 `dist/` 和 `classes.dex` 合进去
4. `zipalign` 对齐 → `apksigner` 自签名

两个坑已在脚本里处理掉，别改回去：

- **Windows 上 `aapt2 -A` 会把资源条目写成 `assets/www\index.html`**（反斜杠），
  AssetManager 按正斜杠查找，装机后白屏。所以前端资源由 `pack-apk.mjs` 自己写入。
- **targetSdk ≥ 30 时 `resources.arsc` 必须是 STORED**，被压缩会导致
  `INSTALL_PARSE_FAILED_RESOURCES_ARSC_COMPRESSED` 装不上。

另外 `build-apk.ps1` 必须是**纯 ASCII**：Windows PowerShell 5.1 按 GBK 读 .ps1，
文件里混入 UTF-8 中文注释会把语法解析搞崩。

## 历史对话的衔接

DeepSeek 网页端「设置 → 导出数据」会得到 `deepseek_data-<日期>.zip`，
在应用内「设置 → 导入历史」选中它即可，旧会话全部出现在列表里并可以接着聊。
导入是**覆盖**本地会话，不是合并，导入前先导出一次做备份。

## 交互（v0.1.1 起）

- **左缘右滑**打开侧边栏，抽屉跟手滑动，松手按位移/速度归位；点遮罩或**向左滑**收起。
- 抽屉常驻挂载，只靠 `transform` 平移，不再"硬弹"；遮罩带渐显。
- 手势位移直接写行内样式，不经过 React 状态，避免每帧重渲染掉帧。
- 竖向占优的手势会被让给页面滚动，不会抢走消息列表的滑动。

## 语音输入排查

录音链路：`getUserMedia` → `AudioContext(16kHz)` → `ScriptProcessor` → WAV → `POST /v1/tools/asr`。

已知坑（已修）：`AudioContext` 如果创建在 `await getUserMedia` **之后**，Chrome/WebView 会把它
置为 suspended，`ScriptProcessor` 不回调，采到 0 个样本 —— 表现为"点了录音没反应也不报错"。
现在改成在用户手势的同步调用栈里先创建 AudioContext。

如果还是不行，失败提示会直接显示原因（`isSecureContext`、`origin`、DOMException 名字、HTTP 状态），
照着实测文案就能定位是权限、安全上下文还是接口问题。

## 导出归档的扩展字段（`ds_usage_detail`）

官方 v3 格式里每条消息只有 `accumulated_token_usage` 一个数字，装不下"输入 / 缓存命中 / 缓存写入 / 输出"的拆分。
所以导出时额外写一个**非官方**字段，形如：

```json
"accumulated_token_usage":1234,
"ds_usage_detail":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":80,"output_tokens":50},
"inserted_at":"2026-11-19T00:00:00.000Z",
```

- 本项目导入时能识别它，token 拆分可完整往返；
- 官方归档没有这个字段，导入照常工作（解析器按字段读取，未知字段直接忽略）；
- 需要恢复成纯官方格式时，把 `chat_sessions/*.json` 解压后做一次全文替换：

```
查找： ,"ds_usage_detail":\{[^{}]*\}
替换：（留空）
```

正则说明：`,"ds_usage_detail":{...}` 整体删除（含前面的逗号），值里不含嵌套花括号，所以 `[^{}]*` 足够。
VSCode 里记得勾选「使用正则表达式」，并限定文件类型 `*.json`。

## 已知限制

- 需要 Android System WebView 版本较新（构建目标是 Chrome 105+，Android 10 以上基本都满足）。
- APK 是自签名的，装机时要允许"安装未知来源应用"，且无法上架应用商店。
- 语音输入需要授予麦克风权限；文件上传走系统文件选择器。
- 没有推送，也不需要。

## 技术要点

- 前端资源通过自定义 https 源 `https://appassets.androidplatform.net` 提供给 WebView，
  而不是 `file://`。因为 `file://` 页面发起 fetch 时 Origin 是 `null`，跨域行为不可控。
  （已实测 DeepSeek 接口对任意 Origin 都回显 `access-control-allow-origin`，预检也放行。）
- 服务端联网搜索、深度思考搜索、阅读链接、文件解析都由 API 侧完成，客户端只渲染内容块。
- 费用：按 token 计费，个人重度使用约每月几十元；搜索与网页抓取自 2026-11-18 起不再单独计费。

# DeepSeek 自建客户端（Android）

把 DeepSeek 官方开源演示客户端 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）
改造成一个自己的安卓 App：直连官方 API，API Key 只存在本机，不经过任何第三方中转。

> **非官方项目**，与 DeepSeek 无隶属关系，仅适用于自用。请遵守
> [DeepSeek 开放平台服务协议](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)。

## 为什么做这个

官方 App 的免费额度有限流。用 API 则是按 token 计费、没有每日条数上限，
重度个人使用每月几十块，还能自己决定界面。

## 功能

对话相关部分沿用上游：思考过程、联网搜索、深度思考搜索、阅读链接、文件解析、
Markdown / Mermaid / 公式渲染、语音输入与朗读、深浅色主题。在此基础上补了：

| 功能 | 说明 |
| --- | --- |
| **安卓 App 壳** | 不用 Gradle，`aapt2 + javac + d8 + apksigner` 手工打包，产物约 1.9 MB |
| **Key 不进安装包** | 首次启动在设置里粘贴，存本机；包内没有任何 `sk-` 字面量 |
| **整页右滑开抽屉** | 不依赖屏幕边缘（边缘归系统返回手势），横向可滚动区域会让位给内容 |
| **返回键导航栈** | 设置 → 搜索面板 → 轮次面板 → 抽屉 → 回主页 → 退出，逐层退 |
| **长对话增量渲染** | 只渲染最近 12 条，往上翻再补；几百条消息的会话不再卡几秒 |
| **轮次跳转** | 按住屏幕右边缘呼出轮次列表，拖动按比例定位，点某一轮平滑跳转 |
| **会话置顶** | 会话菜单置顶，侧边栏最上方单独分组 |
| **每轮元信息** | 时间、输入 / 缓存命中 / 输出 token，悬停看精确值 |
| **历史整体搬迁** | 导入官方导出的 `deepseek_data-*.zip`，导出保持与官方一致的归档格式 |
| **余额与用量** | 查询 `/user/balance`，并汇总本地 token 消耗 |

## 和上游的几个关键差异

上游是纯网页。这里多了 WebView 壳，踩过的坑都写在代码注释里，简单说：

1. **资源用自定义 https 源提供**（`https://appassets.androidplatform.net`）而不是 `file://`。
   `file://` 页面发请求时 Origin 是 `null`，跨域行为不可控。
2. **选中的文件先复制到应用缓存再交给页面**。WebView 通过 content provider 随机读极慢
   （实测读 46 字节要 30ms，导入上千条历史要读上万次），换成本地文件后快两个数量级。
3. **需要 `MODIFY_AUDIO_SETTINGS`**。缺了它 `getUserMedia` 会以
   `NotReadableError: Could not start audio source` 失败——只加 `RECORD_AUDIO` 不够。
4. **targetSdk 35 在 Android 15 强制 edge-to-edge**，主题里用
   `windowOptOutEdgeToEdgeEnforcement` 退回传统行为。
5. **WebView 不实现 `<a download>` + blob URL**，导出必须走原生桥接分块落盘。

## 构建

```powershell
# 依赖
npm install

# 网页
$env:NODE_ENV='production'; npx rspack build -c rspack.config.ts

# 本地预览（手机同 WiFi 可访问打印出的地址）
node scripts/serve.mjs --port 8080

# 首次需要下载 JDK + Android SDK（约 310 MB）
node scripts/fetch-toolchain.mjs

# 打 APK
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1
# 产物在 release/deepseek-<时间戳>.apk
```

签名密钥在 `android/keystore/self.keystore`（自用固定密码）。**这个目录不要提交**，
否则任何人都能给"你的 App"签名；丢了它就没法覆盖升级，需要卸载重装。

构建脚本有几处必须遵守的约定，改动前先看 `scripts/` 里的注释：

- `aapt2` 在 Windows 上会把 assets 条目写成反斜杠，所以静态资源由 `pack-apk.mjs` 自己写入；
- `resources.arsc` 必须是 STORED，否则 Android 11+ 直接装不上；
- `build-apk.ps1` 必须保持纯 ASCII（Windows PowerShell 5.1 按 GBK 解析 `.ps1`）。

## 导入导出的归档格式

与官方 v3 格式对齐：JSON 条目 DEFLATE、图片 STORE、保留 `user.json` 原文。
额外写一个**非官方**字段 `ds_usage_detail`，用来保住每轮的 token 拆分：

```json
"accumulated_token_usage":1234,
"ds_usage_detail":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":80,"output_tokens":50},
```

导入端按字段读取，未知字段直接忽略，所以官方归档（没有这个字段）照样能进。
要恢复成纯官方格式时，解压 `chat_sessions/*.json` 后全文替换：

```
查找： ,"ds_usage_detail":\{[^{}]*\}
替换：（留空）
```

## 已知限制

- 需要较新的 Android System WebView（构建目标 Chrome 105+）。
- APK 自签名，无法上架应用商店。
- 只统计本机对话的 token 用量；官方没有开放用量历史接口，查不到跨设备总花费。
- 官方归档里的部分片段类型（`CONTENT_RISK`、`PARTIAL_FILE_READ`、`TOOL_IMAGE_SEARCH`）
  在本地消息模型里没有对应结构，导入后会丢，再导出时不保留。

## 许可

- 代码沿用上游的 [MIT](LICENSE)。
- 图标等第三方素材的来源与许可见 [NOTICE](NOTICE)。

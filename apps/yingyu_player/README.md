# 影语 YingYu

面向 Windows、Android、iOS 与 iPadOS 的原生英语学习视频播放器。界面采用沉浸式播放器结构，视频始终是主画面；字幕导航、查词与学习工具以 OSD 方式覆盖在画面上，播放内核不依赖网页播放器。

## 已实现

- `media_kit/libmpv` 原生解码，Windows 与 Android 共用稳定播放内核
- MKV、MP4、AVI、MOV、WebM、M4V、TS 等本地媒体
- 独立“在线影视”页面，只保留可由原生适配器读取的 4K 线路；qist 合集中的玩偶、快映、木偶、蜡笔、闪电、至臻、多多、欧哥、二小、虎斑已拆成独立入口，支持线路切换、分类、搜索、翻页、剧集与播放线路选择
- 失效仓自动依次尝试同源新地址和维护中的兼容备用配置；多仓子配置采用并发分批检测，避免某个失效域名拖死整个页面
- 在线剧集生成完整播放列表，可从抽屉或播放器控制栏切换上一集/下一集，播放完成后自动连播下一集；Windows 可使用 `Ctrl+←` / `Ctrl+→`
- 在线影视搜索会并发查询所有可用原生线路，结果保留线路名称；同一影片可显示来自多个线路的结果，进入后可分别选择其剧集和播放地址
- 内置玩偶 Wogg 与常见 PanWebShare 的原生 HTML 适配器，支持备用域名、4K 分类、搜索、详情和网盘分享线路解析
- Windows 夸克登录直接嵌入夸克官方登录页并读取 WebView2 的本机登录结果，避免第三方生成二维码出现请求过期；Android 保留原生二维码流程。登录后可在用户确认时转存到自己的夸克网盘，同步 OpenList 并用 libmpv 播放，登录凭据与 OpenList Token 都只保存在系统凭据库
- 原生兼容 4K 影视仓的 JSON 配置与网盘分享线路；不执行第三方 CatVod JAR、加密配置或任意 JS，避免将未知代码带入稳定播放器进程
- 主界面按“影视 / 在线影视”分区；本地影视、在线 4K 影视与网盘影视统一进入最近播放、继续观看和收藏
- 通过 OpenList API 接入夸克、阿里、百度、115、WebDAV 等个人网盘，支持扫描、串流和直链下载
- 网盘同名 SRT/VTT/ASS/SSA 字幕可直接加载、点击查词和翻译，下载时会一并保存同名字幕
- Windows 主页与在线页提供拖动、最小化、最大化/还原和关闭按钮；播放页区分“返回上一页”和“回到主页”
- 自动载入同名 SRT、WebVTT、ASS、SSA 字幕
- 自动识别 MKV/MP4 等容器的内嵌字幕；文本轨可用于导航、跳转和查词，多轨可手动切换
- ASS/SSA、SRT、WebVTT、MOV Text 等内嵌文本轨可用于学习字幕；远程 MP4 会优先按字节读取播放点附近约 45 秒的 MOV Text，并随播放动态补全相邻时间轴，避免为字幕读取整部 4K 视频；图形字幕由 libmpv 直接显示
- 英中双语字幕、原文/译文切换、当前句高亮
- 原文和译文都可点击查词；支持英文以及内嵌日文、中文等 Unicode 文本字幕，失败时显示原因并可重试
- 在线查词与整轨字幕翻译都使用 SSE 流式接口，查询窗口会先显示状态/部分结果，再替换为完整结果；旧服务会自动回退到兼容接口
- 右侧字幕导航，点击字幕或翻页后精确跳转视频
- 逐句循环、倍速、音量、亮度手势
- Windows 键盘快捷键与自绘标题栏；Android、iOS 与 iPadOS 使用原生横屏沉浸播放器
- 无字幕视频分片续传，由 SeedASR 2.0 生成带时间轴的字幕
- 单语字幕通过服务端私有模型翻译为双语，客户端不包含模型名称、地址或密钥
- 选定字幕后，在线或本地模型都会暂停播放、逐条显示翻译进度与当前语句，并生成一一对应的外挂 SRT 译文轨；该轨可在字幕轨道列表中与任意内嵌原文轨组合并自动对齐
- Windows 可选用本地 Ollama 模型翻译：设置中打开“本地模型翻译”，默认扫描 `D:\AI\Ollama\models`；应用会自动启动/连接本机 Ollama、请求 GPU offload（`num_gpu=999`），并通过 `/api/ps` 校验所选模型确实占用显存；无法确认显存或只能 CPU 加载时会拒绝启用。关闭开关或退出播放器时发送 `keep_alive: 0` 卸载模型。该模式会停用联网翻译、词典、账户和充值入口，不需要账户登录，字幕不会离开本机，也不扣除服务端额度。模型目录中应已有至少一个可用模型（例如 `gemma4:e2b-it-qat`），Ollama 可执行文件支持 `D:\AI\Ollama\ollama-new\ollama.exe`、标准安装目录或 PATH。
- 匿名设备账户、邮箱验证码注册、普通用户登录与原生账户界面
- 管理功能从播放器完全分离，使用独立 Windows 原生管理程序
- 系统安全存储令牌、Token 用量与余额明细
- Windows / 直接分发 Android 可打开 Stripe Checkout；Google Play 发行版默认关闭外部数字内容结算

## 目录

```text
lib/
  data/                    字幕解析、词典、处理服务客户端
  domain/models/           字幕、词典、任务状态模型
  features/player/         播放状态、OSD、字幕导航与弹窗
  windows/                   Windows 原生 runner
  android/                   Android 原生 runner
  ios/                      iOS / iPadOS 原生 runner
assets/images/             离线演示画面
```

## 本地运行

需安装 Flutter 3.44 或兼容稳定版。播放器还需要同级的字幕处理服务：

```powershell
cd apps/yingyu_player
flutter pub get
flutter run -d windows
```

Windows 也支持把媒体路径作为启动参数传入，便于“打开方式”关联或从命令行直接播放：

```powershell
.\yingyu_player.exe "E:\Videos\movie.mkv"
```

Android 模拟器默认连接 `http://10.0.2.2:8787`，Windows 默认连接 `http://127.0.0.1:8787`。生产 Android 包只允许 HTTPS；可在播放器设置中填写部署后的处理服务地址，或构建时传入：

```powershell
flutter build apk --release --dart-define=PIPELINE_API_URL=https://subtitle.example.com
```

直接分发且符合销售地区规则的 Android 包，才可显式开启外部 Checkout：

```powershell
flutter build apk --release `
  --dart-define=PIPELINE_API_URL=https://subtitle.example.com `
  --dart-define=ALLOW_EXTERNAL_CHECKOUT=true
```

提交 Google Play 的构建不要设置 `ALLOW_EXTERNAL_CHECKOUT`；应另行接入 Play Billing，并在服务端验证购买凭据后发放额度。

Windows 构建：

```powershell
flutter build windows --release
```

iOS 与 iPadOS 构建必须在 macOS 上使用 Xcode，并由开发者配置自己的签名团队和 Bundle ID：

```bash
cd apps/yingyu_player
flutter pub get
flutter build ios --release
# 或用 Xcode 打开 ios/Runner.xcworkspace 后运行/Archive
```

本仓库不提供共享的 Apple 签名证书；未配置签名时只能在模拟器或本机调试，不能安装到真机。

### GitHub Actions 无签名构建

仓库提供 `.github/workflows/build-ios-unsigned.yml`，推送源码后可在 GitHub
Actions 手动运行 `Build unsigned iOS artifacts`。它会在 GitHub 的 macOS
Runner 上生成两个构建产物：

- `yingyu-ios-unsigned.ipa`：将无签名的 `Runner.app` 放入 `Payload`，便于后续自行签名或检查包结构；未签名包不能直接安装到真实 iPhone/iPad。
- `yingyu-ios-simulator.zip`：无签名模拟器 App，可解压后拖入对应的 iOS/iPadOS Simulator。

该流程不读取模型密钥、网盘 Cookie 或其他仓库机密；如果要生成可安装真机包，仍需在 GitHub Secrets 中配置自己的 Apple 签名证书与描述文件，并另行启用签名步骤。

Flutter 的 Windows 插件构建依赖符号链接，因此 Windows 建议开启“开发者模式”。

主页“在线影视”仅载入上述拆分后的 4K 入口。玩偶 Wogg 与 `csp_PanWebShare` 站点由客户端自带的受限适配器读取，不依赖 TVBox JAR；其他未识别的 CatVod/JAR/JS 会隔离。夸克链接支持转存到用户自己的网盘后通过 OpenList 播放；其他网盘类型暂不会冒充直链播放。第三方地址可能随时失效、重定向或加密。在线内容来自第三方，请仅访问有权使用的来源并遵守所在地法律。

网盘影视仓从“影视”主页的“网盘”入口配置。建议在自己的电脑或服务器部署 OpenList，并先在 OpenList 中挂载夸克等网盘；影语只需要填写 OpenList 地址、API Token 和影视根目录。夸克类型可点“扫码登录夸克”，不再要求手工复制 Cookie；扫码得到的登录凭据和 Token 保存到 Windows Credential Manager，不写入普通设置文件，也不会上传到影语服务端。OpenList 返回的直链用于原生播放和下载。

Android 首次构建前需安装 Android SDK，并由开发者本人阅读、接受 SDK licenses。当前 Flutter 版本所需组件可在 PowerShell 中安装：

```powershell
$androidSdk = 'C:\Users\Yinz7\.codex\toolchains\android-sdk'
& "$androidSdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$androidSdk --licenses
& "$androidSdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$androidSdk `
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358"
flutter config --android-sdk $androidSdk
```

发布到应用商店前，将 `android/key.properties.example` 复制为 `android/key.properties` 并填写自己的上传密钥。没有该文件时，release APK 会保持未签名，不会退回使用不安全的 debug key。

## 快捷键与手势

| 操作 | Windows | Android / iOS / iPadOS |
|---|---|---|
| 播放/暂停 | `Space` 或双击 | 双击 |
| 前后 5 秒 | `←` / `→` | 拖动进度 |
| 上/下一句 | `PageUp` / `PageDown` | 字幕列表点击或左右滑动字幕卡片 |
| 字幕导航 | `S` | 右侧工具栏 |
| 单句循环 | `R` | 右侧工具栏 |
| 全屏 | `F` | 全屏按钮 |
| 音量/亮度 | `↑` / `↓` | 右半屏/左半屏竖滑 |
| 打开视频 | `Ctrl+O` | 顶部文件按钮 |

设备访问令牌由 Android Keystore、iOS Keychain 或 Windows 安全存储保护。模型和支付密钥只配置在服务端，不能通过 `--dart-define` 打包进客户端。

普通账户注册依赖服务端 SMTP 邮箱验证配置；播放器不能创建管理员。管理人员请单独构建并使用 [`apps/yingyu_admin`](../yingyu_admin/README.md)，该程序不会随播放器客户端一同分发。

# Third-party notices

影语使用以下原生媒体组件：

- `media_kit` / `libmpv`：负责稳定播放、硬件加速及媒体轨道选择。
- `ffmpeg_kit_flutter_new_min` / FFmpeg：仅用于读取媒体轨道信息并临时提取文本字幕。

`ffmpeg_kit_flutter_new_min` 使用不包含 GPL 编解码组件的 minimal 构建，并按 LGPL-3.0
发布。发布安装包时应同时保留相应依赖包中附带的许可证文本，并履行 FFmpeg、FFmpegKit
与 libmpv 各自许可证所要求的声明和可替换/重新链接义务。

项目依赖的完整版本记录在 `pubspec.lock`；各组件许可证以依赖包和上游仓库中的文本为准。

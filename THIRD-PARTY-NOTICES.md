# Third-Party Notices / 第三方组件声明

本项目（MMDBG · MikuMikuDance Background Video）的主代码以 **MIT License** 开源（见 `LICENSE`）。

项目的 `runtime/` 目录**捆绑了以下第三方开源组件**，它们各自保留自己的许可证。分发本项目即表示同时分发这些组件，请遵守它们的许可证条款：

---

## 1. AviSynth+ (`runtime/avisynth.dll`)

- **项目**：[AviSynth+](https://github.com/AviSynth/AviSynthPlus)
- **许可证**：**GNU GPL v3.0**（原文见 `licenses/GPL-3.0.txt`）
- **用途**：为 MMD 提供 VFW 桥接接口，使 MMD 能读取 `.avs` 脚本
- **版权**：Copyright (c) AviSynth+ 贡献者
- **源码**：https://github.com/AviSynth/AviSynthPlus
- **免责声明**：本组件按"原样"提供，无任何明示或暗示的担保。详见 GPL v3.0 第 15-17 条。

## 2. FFMS2 (`runtime/plugins/ffms2.dll`)

- **项目**：[FFMS2](https://github.com/FFMS/ffms2)（FFmpegSource）
- **许可证**：**GNU GPL v3.0**（原文见 `licenses/GPL-3.0.txt`）
- **用途**：内嵌 FFmpeg 解码引擎，使 AviSynth 能解码 mp4 / mkv / avi 等任意格式
- **版权**：Copyright (c) FFMS2 贡献者
- **源码**：https://github.com/FFMS/ffms2
- **免责声明**：本组件按"原样"提供，无任何明示或暗示的担保。详见 GPL v3.0 第 15-17 条。

---

## 3. Node.js (`runtime/node/node.exe`)

- **项目**：[Node.js](https://nodejs.org)
- **许可证**：**MIT License**（原文见 `licenses/NODEJS-MIT.txt`）
- **版本**：v24.20.0 LTS (Krypton)
- **用途**：本工具的运行引擎（便携版，免安装）
- **版权**：Copyright (c) OpenJS Foundation 及 Node.js 贡献者
- **源码**：https://github.com/nodejs/node
- **说明**：本项目只使用官方预编译二进制，未修改。官方便携包中附带的 npm、corepack
  等文件未包含在本项目内（本工具不需要）。

---

## 合规说明

- 本项目主代码（MIT）与 GPL 组件（runtime/）是**独立作品**，通过文本脚本（`.avs`）间接协作，
  二者作为聚合分发物在 GitHub 上共存，不构成衍生作品。
- 用户对本项目主代码的使用遵循 MIT；对 `runtime/` 组件的使用、修改、再分发遵循 GPL v3.0。
- 若你修改或重新分发 `runtime/` 中的组件，必须按 GPL v3.0 的要求开源你的修改，并提供源码。
- GPL v3.0 全文：https://www.gnu.org/licenses/gpl-3.0.txt（本仓库 `licenses/GPL-3.0.txt` 为本地副本）

## 致谢

感谢 [AviSynth+](https://github.com/AviSynth/AviSynthPlus) 与 [FFMS2](https://github.com/FFMS/ffms2)
社区为 MMD 生态做出的贡献。

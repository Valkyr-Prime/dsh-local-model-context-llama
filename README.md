# dsh-local-model-context-llama

在 DeepSeek Harness（dsh）里查看本机模型、选一个上下文窗口，一次改到两边：**llama.app / llama.cpp 侧的 `--ctx-size`** 和 **DSH 模型表里的 `contextWindow`**。

A DeepSeek Harness plugin that lists the local models DSH points at (a llama.app router), shows each model's supported context sizes with an estimated VRAM cost, and applies the chosen window to llama.app's presets (hot reload + unload) and to DSH's own model table.

- 插件页名称 / Settings page: **本地模型**（Local models）, under Settings → 本地模型
- 兼容：DSH `>=0.2.2-rc.5 <0.3.0-0`
- 平台：Windows（`win32`）实测；自动发现依赖 Windows 上 llama.app 的配置目录，其它平台可用配置项手动指定
- 许可证：MIT

## 它解决什么

本机模型有两套「上下文大小」：

- **llama.app / llama.cpp 侧**：每个模型按 preset 里的 `--ctx-size` 加载，决定 KV cache 大小，也就是显存。
- **DSH 侧**：`llm-pi-ai` 模型表里的 `contextWindow`，决定压缩触发点、上下文预算和「剩余上下文」显示。

两边不一致时，会出现「DSH 以为有 128K、模型实际只有 32K」。这个插件把两处放在一页里对照，并用一次「应用」同时改掉。

## 安装

要求：dsh `0.2.2-rc.5` 或同系列更新版本、Windows、本机跑着 llama.app（默认 `http://127.0.0.1:9931`）。

**方式 1：从 GitHub 安装**（不需要 npm）

插件页 **Plugins → Add plugin** 里填（把 `<commit>` 换成仓库任一 40 位完整 commit，pin 住才有「检查更新」）：

```
github:Valkyr-Prime/dsh-local-model-context-llama#<commit>
```

或让 agent 调 `plugin_manager` 的 `install_bundle`，`target` 用同一个 spec。

**方式 2：npm 安装**（发布后）

```
dsh plugin --profile <profile> add dsh-local-model-context-llama
```

**方式 3：本地目录**

`install_bundle` 的 `target` 传本仓库的绝对路径；插件页 Add plugin 也接受本地目录。

## 界面

设置（左下角齿轮）→ 左侧导航 **本地模型**。每张卡片：

- **状态行**：DSH 显示名、模型 id、路由状态（已加载 / 休眠 / 未加载）
- **规格行**：架构、权重体积、视觉投影、训练上限、KV 每 token 占用
- **对照行**：`路由 128K · llama.app 128K · DSH 128K`，三处不一致时整行变黄并标「三处不一致」
- **档位按钮**：从可用下限到训练上限，档位下方是**该窗口的显存估算**；超过预算的标「超预算」，「当前」标在路由正在用的档位
- **应用**：选一档点应用；顶部另有显卡状态、建议预算和警告

## 应用时做了什么

按顺序执行，任一步失败都会在结果里写清楚：

1. 改写 llama.app 的 `model-context-presets.ini` 里该模型的 `ctx-size`
2. 改写 llama.app `settings.json` 的 `ModelContextLengths`（让选择活过 app 重启；端口不匹配或文件不存在时跳过）
3. `GET /models?reload=1` 让路由重读 preset
4. `POST /models/unload` 卸载该模型 —— 旧进程不会自己变窗口，下次请求按新 `--ctx-size` 重载
5. 更新 DSH 里该模型的 `contextWindow`（写 profile 的 `cordis.patch.yml`，普通热更新，不用重启）

顺序是刻意的：先把服务端改好，再改 DSH 的声明。这样即使最后一步失败，DSH 也只会比实际更保守（提前压缩），不会发出超过服务端窗口的请求。

## 显存怎么来的

`≈` 是估算：

```
估算显存 = 权重文件大小 + 视觉投影 + 该窗口的 KV cache + 固定运行开销（约 256 MiB，含视觉再 +128 MiB）
KV cache = 窗口令牌数 × KV 层数 × (KV 头数 × K 维度 × K 字节 + KV 头数 × V 维度 × V 字节)
```

KV 层数/头数/维度来自 GGUF 头本身；混合注意力模型（如 qwen35 的 recurrent 层）只算真正带 KV 的层；字节数按路由实际用的 `--cache-type-k/v` 换算。实测对照（16 GB 显卡，q8_0）：7B @64K 估算 6.5 GB / 实测约 6.3 GB，14B @32K 估算 11.8 GB / 实测约 11.5 GB。真实占用随驱动、批大小和上下文内容浮动，所以界面上永远写 `≈`。

## 风险与限制（请先读）

装插件＝在本机用你的权限运行第三方代码，dsh 的工具审批不会沙箱化插件代码。

- **会写三个宿主机文件**：`%USERPROFILE%\.llama\model-context-presets.ini`、llama.app 的 `settings.json`、以及本 profile 的 `cordis.patch.yml`（只改该模型的 `contextWindow` 一个字段，其余内容与注释保留）。
- **会执行 `nvidia-smi`**（读显存）；不联网，只访问 `127.0.0.1` 上的本地路由。
- **应用会卸载该模型**：正在跑的模型会被卸掉，下一次请求按新窗口重载（本机加载 9B/14B 约几秒）。
- **llama.app 界面不会立刻同步**：本插件直接改文件并热重载路由，所以路由与 DSH 立刻生效；但 llama.app 进程内存里还是旧值，它的界面要重启 app 才显示新数字。若之后在 llama.app 里改任何设置，它可能用内存旧值覆盖回来——回来再点一次「应用」即可。
- **只支持能改 preset 的路由**（llama.app / llama.cpp 的 preset INI）。换成别的本地服务（纯 llama-server、vLLM 等）时页面会报「找不到 preset 文件」，不会硬改。
- **只认本机 provider**：`llm-pi-ai` 里 `baseURL` 指向 `127.0.0.1` / `localhost` 的 provider 才会出现在页面上。
- 自动发现路径依赖 Windows 打包应用的 `%LOCALAPPDATA%\Packages\HuggingFaceInc.LlamaApp_*`；找不到时用下面的配置项指定。

## 可选配置

一般不需要。要覆盖自动发现或显存预留，在 profile 的 `cordis.patch.yml` 里给这一行加 `config`：

```yaml
- id: local-model-context
  name: dsh-local-model-context-llama
  config:
    llamaAppSettingsPath: 'C:\path\to\settings.json'
    llamaAppPresetsPath: 'C:\Users\me\.llama\model-context-presets.ini'
    gpuReserveMiB: 1536
```

## Agent 工具

同一个能力也注册成工具 `local_model_context`：

- `action: "list"` 读快照（模型、档位、显存估算、三处窗口、GPU）
- `action: "apply"` 带 `model` 与 `context`，改一处

界面和工具走同一份实现（`lib/service.js`），行为一致。

## 开发与测试

```powershell
node scripts/smoke.mjs        # 只读：解析 GGUF、读 llama.app 文件、读路由模型表
node scripts/host.test.mjs    # 在沙箱副本上跑「状态 → 应用 → 回滚」，逐字节校验写回
node scripts/client-render.test.mjs  # 用替身 React 渲染设置页（含一次「应用」点击）
```

`host.test.mjs` 只改 `.test-sandbox/` 下的副本，不会碰你真实的 llama.app 配置。

## 卸载

移除插件即可；已经应用过的上下文设置保持不变（它改的是 llama.app 与 DSH 的配置，不是插件私有状态）。

## English summary

`dsh-local-model-context-llama` adds a **Local models** page to dsh Settings. It reads the `llm-pi-ai` providers whose `baseURL` is on this machine, asks the llama.app router for each model's table, parses the GGUF header to size the KV cache, and shows every supported context length with an estimated VRAM figure. Applying a size rewrites llama.app's context presets and settings, hot-reloads the router, unloads that model so the next request reloads it at the new window, and updates the model's `contextWindow` in dsh. The same two operations are exposed to agents as the `local_model_context` tool. Windows only; writes three files outside the workspace (see Risks above).

## License

MIT — see [LICENSE](LICENSE).

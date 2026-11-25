# 聊天语音输入

点击聊天输入框旁的麦克风开始录音，再点击「完成」。识别结果会追加到原有草稿中；修改文字后，点击原来的「发送」按钮发送。录音和转写都不会自动发送消息。每次最多录制 60 秒，到时自动结束录音并转写。

麦克风需要 HTTPS 或 localhost。通过普通 HTTP 的局域网 IP 地址打开页面时，请先配置 HTTPS。取消或切换房间会停止录音并丢弃尚未写入草稿的结果。

## 本地免费识别（默认）

无需 API Key，也无需部署语音识别服务。浏览器使用多语言 Whisper tiny 的量化模型，在 Web Worker 内通过 WASM 识别；音频不会上传至 Dashboard 或外部识别服务。默认识别中文，并将转写结果转为简体中文；可在「语音设置」切换 English 或自动识别。自动识别中的中文也会转为简体，英文模式保持原样。本地和百炼的识别结果采用相同规则，只转换新识别的文字，不修改原有草稿。适合短消息，技术名词和噪声环境下的结果需要检查后发送。

首次点击并完成录音后，浏览器才加载模型，界面显示加载状态；支持 Cache API 的浏览器会缓存模型。后续使用仍可能需要初始化计算，耗时取决于设备和录音长度。手机或低性能设备可能较慢。

`npm run dev` 和 `npm run build` 会运行 `prepare:speech`，将固定版本模型与匹配的 WASM 文件准备到 `public/speech/ff41770/`。模型和运行文件合计约 65 MB，作为构建产物随镜像分发，不提交到 Git；浏览器从 Dashboard 同源加载，不依赖外部模型站点。

模型准备脚本默认从 Hugging Face 获取固定版本 `onnx-community/whisper-tiny@ff41770`。构建机器无法访问时，可以提前准备文件、使用构建缓存，或配置 `SPEECH_MODEL_DOWNLOAD_BASE_URL` 指向同样目录结构的镜像。Docker 构建通过 `--build-arg SPEECH_MODEL_DOWNLOAD_BASE_URL=...` 传入。准备失败时构建会失败，避免发布缺少免费模型的镜像。

## 百炼识别（可选付费）

管理员可以打开「设置 → 后端 → 语音识别」，填写百炼 API Key、服务地址和模型，点击「保存语音配置」，无需重启。页面不回显已保存的 Key，留空会保留原 Key；「移除 API Key」会停用百炼识别。修改服务主机时需重新填写对应地域的 Key。

配置保存在 `DASHBOARD_CONFIG_FILE` 同目录的 `speech.json` 中，文件权限为 `0600`，随 Dashboard 配置卷持久化。页面保存的配置优先于环境变量；清除 Key 后不会重新启用环境变量中的旧 Key。请保证该目录可写，并在 Docker/Kubernetes 部署中挂载持久化目录。

也可以使用服务端环境变量提供初始配置，设置后重启：

```dotenv
DASHBOARD_SPEECH_DASHSCOPE_API_KEY=your-api-key
# 默认北京；新加坡可使用 https://dashscope-intl.aliyuncs.com/compatible-mode/v1
DASHBOARD_SPEECH_DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHBOARD_SPEECH_DASHSCOPE_MODEL=qwen3-asr-flash
```

打开麦克风旁的「语音设置」，选择「百炼（按量付费）」后再录音。未配置时该选项不可用；默认始终为本地免费识别，识别失败不会自动改用付费服务。识别方式在当前聊天输入框内生效，切换房间后恢复默认。

选择百炼后，录音会经 Dashboard 服务端发送至配置的百炼服务，按供应商规则计费。API Key 只从服务端配置读取，页面配置接口仅向管理员返回地址、模型和 Key 是否已配置，普通用户仅可查询服务是否可用。保存配置本身不会调用识别服务。转写接口要求已登录且具备操作权限的账号，校验 16 kHz 单声道 PCM WAV 的实际长度，限制为 60 秒，并设置上游请求超时。录音无需上传对象存储，接口不会将音频写入磁盘。

本地识别的加载状态、取消、麦克风权限错误和付费识别错误都会在输入框旁提示；原草稿、手动选择的 @成员和附件保持不变。口述成员名仅作为文字输入，需要使用现有 @成员选择功能建立真正的提及。

## 验证范围

自动测试覆盖语音填入草稿后手动发送、取消和切房间丢弃过期结果、麦克风权限、付费方式主动选择、服务端鉴权、凭据隔离、音频格式/时长以及供应商错误处理。真实浏览器识别效果和付费服务调用需要分别验证，不能用模拟响应证明识别准确率。

模型来源：[ONNX Whisper tiny](https://huggingface.co/onnx-community/whisper-tiny)（源模型 [OpenAI Whisper](https://github.com/openai/whisper)，MIT）。推理库：[Transformers.js](https://github.com/huggingface/transformers.js)（Apache-2.0）和 [ONNX Runtime](https://github.com/microsoft/onnxruntime)（MIT）。

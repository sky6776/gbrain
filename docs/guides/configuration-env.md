# GBrain 环境变量配置指南

GBrain 通过 `GBRAIN_` 前缀的环境变量控制所有 LLM provider 配置。每个功能模块（Embedding、Query Expansion、LLM Chunking、Transcription）可以独立配置不同的 provider，支持 OpenAI 兼容的国产 LLM 服务。

## API 协议与模型类型

**所有模块均使用 OpenAI API 协议**（OpenAI-compatible），不使用 Anthropic API 协议。

各模块对模型的要求不同，选型时需注意：

| 模块 | 协议/端点 | 模型类型 | 选型建议 |
|------|----------|---------|---------|
| **Embedding** | `/v1/embeddings` | 专用 Embedding 模型 | OpenAI `text-embedding-3-large`、DashScope `text-embedding-v3`、智谱 `embedding-3`、硅基流动 `BAAI/bge-large-zh-v1.5` |
| **Query Expansion** | `/v1/chat/completions` + function calling | Chat 模型 | DeepSeek-V3、GLM-4-Flash（免费）、Qwen-Turbo 等便宜模型即可 |
| **LLM Chunking** | `/v1/chat/completions` + function calling | Chat 模型 | DeepSeek-V3、GLM-4-Plus、Qwen-Plus 等中等模型 |
| **Transcription** | `/v1/audio/transcriptions` | 专用语音模型 | Groq `whisper-large-v3`（快）、OpenAI `whisper-1`（准） |

**关键区别：**

- **Embedding 和 Transcription** 必须使用**专用模型**（embedding 模型、Whisper 模型），不能替换为 chat 模型
- **Expansion 和 Chunking** 只需要**普通 chat 模型**，且必须支持 function calling（国产 OpenAI-compatible 服务商基本都支持）
- Expansion 任务极轻（改写一句话），**越便宜越好**；Chunking 需要理解文档结构，**选稍好的模型**
- 四个模块的 API 密钥和 Base URL **完全独立**，互不影响

> **变更说明：** 旧版中 Query Expansion 和 LLM Chunking 使用 Anthropic SDK（`tool_use` 格式），已切换为 OpenAI SDK（`function calling` 格式）。`@anthropic-ai/sdk` 依赖已移除。国产 Provider（智谱、DashScope、SiliconFlow、DeepSeek）均提供 OpenAI-compatible API，设置 `GBRAIN_*_BASE_URL` 即可直接接入。

## 配置方式

环境变量可通过以下方式设置（优先级从高到低）：

1. **Shell 环境变量** — 直接在终端 export
2. **BlockCell `.env` 文件** — `~/.blockcell/.env`，BlockCell gateway 启动时自动加载并传递给 gbrain
3. **GBrain 配置文件** — `~/.gbrain/config.json`，部分配置项可通过文件设置

推荐使用 BlockCell `.env` 文件统一管理：

```bash
# ~/.blockcell/.env
GBRAIN_OPENAI_API_KEY=sk-xxx
GBRAIN_EXPANSION_API_KEY=sk-yyy
GBRAIN_CHUNKER_API_KEY=sk-zzz
```

---

## 功能模块配置

### 1. Embedding（向量嵌入）

Embedding 服务用于将文本转为向量，支撑 `gbrain query` 的向量搜索和 `gbrain embed` 命令。

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `GBRAIN_OPENAI_API_KEY` | API 密钥 | （必填） |
| `GBRAIN_OPENAI_BASE_URL` | API 基础 URL | OpenAI 官方 |
| `GBRAIN_EMBEDDING_MODEL` | 嵌入模型名称 | `text-embedding-3-large` |
| `GBRAIN_EMBEDDING_DIMENSIONS` | 向量维度 | `1536` |

**功能影响：** 未配置 `GBRAIN_OPENAI_API_KEY` 时，`gbrain query` 退化为纯关键词搜索（无向量召回），搜索质量显著下降。`gbrain embed` 命令将报错。

**配置示例：**

```bash
# OpenAI 官方（最简单）
GBRAIN_OPENAI_API_KEY=sk-proj-xxx
# 其余使用默认值即可

# 阿里百炼 (DashScope) — text-embedding-v3, 1024 维
GBRAIN_OPENAI_API_KEY=sk-dashscope-xxx
GBRAIN_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
GBRAIN_EMBEDDING_MODEL=text-embedding-v3
GBRAIN_EMBEDDING_DIMENSIONS=1024

# 智谱 (Zhipu) — embedding-3, 2048 维
GBRAIN_OPENAI_API_KEY=xxx.zhipu-xxx
GBRAIN_OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GBRAIN_EMBEDDING_MODEL=embedding-3
GBRAIN_EMBEDDING_DIMENSIONS=2048

# 硅基流动 (SiliconFlow) — bge-large-zh-v1.5, 1024 维
GBRAIN_OPENAI_API_KEY=sk-silicon-xxx
GBRAIN_OPENAI_BASE_URL=https://api.siliconflow.cn/v1
GBRAIN_EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
GBRAIN_EMBEDDING_DIMENSIONS=1024
```

> **注意：** 更换 embedding 模型或维度后，已有嵌入数据将失效，需要运行 `gbrain embed --all` 重新生成。

---

### 2. Query Expansion（查询扩展）

Query Expansion 使用 LLM 将用户查询改写为多个同义查询，提升搜索召回率。通过 OpenAI function calling 实现。

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `GBRAIN_EXPANSION_API_KEY` | API 密钥 | （不设置则禁用） |
| `GBRAIN_EXPANSION_BASE_URL` | API 基础 URL | OpenAI 官方 |
| `GBRAIN_EXPANSION_MODEL` | 模型名称 | （不设置则禁用） |

**功能影响：** 未配置时，查询扩展功能静默禁用，`gbrain query` 只使用原始查询进行搜索。搜索召回率会降低（无法从不同关键词角度检索），但功能不会报错。

**配置示例：**

```bash
# DeepSeek — 性价比高
GBRAIN_EXPANSION_API_KEY=sk-deepseek-xxx
GBRAIN_EXPANSION_BASE_URL=https://api.deepseek.com
GBRAIN_EXPANSION_MODEL=deepseek-chat

# 智谱 GLM-4-Flash — 免费额度
GBRAIN_EXPANSION_API_KEY=xxx.zhipu-xxx
GBRAIN_EXPANSION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GBRAIN_EXPANSION_MODEL=glm-4-flash

# OpenAI GPT-4o-mini
GBRAIN_EXPANSION_API_KEY=sk-proj-xxx
GBRAIN_EXPANSION_MODEL=gpt-4o-mini
```

---

### 3. LLM Chunking（语义分块）

LLM Chunking 使用 LLM 将长文档按语义主题自动分块，比简单按字数切分效果更好。通过 OpenAI function calling 实现。

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `GBRAIN_CHUNKER_API_KEY` | API 密钥 | （不设置则禁用） |
| `GBRAIN_CHUNKER_BASE_URL` | API 基础 URL | OpenAI 官方 |
| `GBRAIN_CHUNKER_MODEL` | 模型名称 | （不设置则禁用） |

**功能影响：** 未配置时，LLM 分块功能静默禁用，`gbrain import` 和 `gbrain put` 退化为简单分块（按 `maxChunkSize` 字数切分，尝试在段落/句子边界断开）。对大多数场景够用，但对结构复杂的文档（学术论文、法律文书）效果较差。

**配置示例：**

```bash
# DeepSeek
GBRAIN_CHUNKER_API_KEY=sk-deepseek-xxx
GBRAIN_CHUNKER_BASE_URL=https://api.deepseek.com
GBRAIN_CHUNKER_MODEL=deepseek-chat

# 智谱 GLM-4-Plus
GBRAIN_CHUNKER_API_KEY=xxx.zhipu-xxx
GBRAIN_CHUNKER_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GBRAIN_CHUNKER_MODEL=glm-4-plus
```

---

### 4. Transcription（语音转写）

语音转写服务用于 `gbrain transcribe` 命令和语音录入功能。支持 Groq Whisper 和 OpenAI Whisper 两种引擎，使用独立的环境变量，不与 Embedding 复用。

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `GBRAIN_TRANSCRIPTION_PROVIDER` | 转写引擎：`groq` 或 `openai` | 自动检测（优先 Groq） |
| `GBRAIN_TRANSCRIPTION_GROQ_API_KEY` | Groq API 密钥 | （Groq 引擎必填） |
| `GBRAIN_TRANSCRIPTION_GROQ_BASE_URL` | Groq API 基础 URL | Groq 官方 |
| `GBRAIN_TRANSCRIPTION_OPENAI_API_KEY` | OpenAI API 密钥 | （OpenAI Whisper 引擎必填） |
| `GBRAIN_TRANSCRIPTION_OPENAI_BASE_URL` | OpenAI API 基础 URL | OpenAI 官方 |

**Provider 选择逻辑：**

1. 如果设置了 `GBRAIN_TRANSCRIPTION_PROVIDER` → 使用指定引擎
2. 否则自动检测：优先 Groq（如果 `GBRAIN_TRANSCRIPTION_GROQ_API_KEY` 已设置），其次 OpenAI
3. 都未设置 → 转写功能不可用

**配置示例：**

```bash
# Groq Whisper — 速度快，成本低（推荐）
GBRAIN_TRANSCRIPTION_GROQ_API_KEY=gsk_xxx

# OpenAI Whisper — 精度高
GBRAIN_TRANSCRIPTION_PROVIDER=openai
GBRAIN_TRANSCRIPTION_OPENAI_API_KEY=sk-proj-xxx

# 同时配置两个引擎，通过 GBRAIN_TRANSCRIPTION_PROVIDER 切换
GBRAIN_TRANSCRIPTION_GROQ_API_KEY=gsk_xxx
GBRAIN_TRANSCRIPTION_OPENAI_API_KEY=sk-proj-xxx
GBRAIN_TRANSCRIPTION_PROVIDER=groq  # 当前使用 Groq
```


## 国产 Provider 快速参考

选 Provider 时，Embedding 必须有对应的 embedding 模型，Expansion/Chunking 只需要 chat 模型。

| Provider | Base URL | Embedding 模型 | 维度 | Chat 模型（用于 Expansion/Chunking） |
|----------|----------|---------------|------|--------------------------------------|
| 阿里百炼 (DashScope) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `text-embedding-v3` | 1024 | `qwen-plus`, `qwen-turbo` |
| 阿里百炼 (DashScope) | 同上 | `text-embedding-v2` | 1536 | 同上 |
| 智谱 (Zhipu) | `https://open.bigmodel.cn/api/paas/v4` | `embedding-3` | 2048 | `glm-4-plus`, `glm-4-flash` |
| 硅基流动 (SiliconFlow) | `https://api.siliconflow.cn/v1` | `BAAI/bge-large-zh-v1.5` | 1024 | `deepseek-ai/DeepSeek-V3` |
| DeepSeek | `https://api.deepseek.com` | — | — | `deepseek-chat` |

> **注意：** DeepSeek 不提供 embedding 模型，但提供高质量的 chat 模型，非常适合 Expansion 和 Chunking。

---

## 典型配置场景

### 场景一：全 OpenAI（最简单）

```bash
GBRAIN_OPENAI_API_KEY=sk-proj-xxx
# Embedding: OpenAI text-embedding-3-large (1536维)
# Expansion: 未配置，禁用
# Chunking:  未配置，使用简单分块
# Transcription: 未配置，不可用
```

### 场景二：Embedding 走 OpenAI + Expansion/Chunking 走 DeepSeek

```bash
# Embedding — OpenAI
GBRAIN_OPENAI_API_KEY=sk-proj-xxx
# 默认 text-embedding-3-large, 1536维

# Query Expansion — DeepSeek
GBRAIN_EXPANSION_API_KEY=sk-deepseek-xxx
GBRAIN_EXPANSION_BASE_URL=https://api.deepseek.com
GBRAIN_EXPANSION_MODEL=deepseek-chat

# LLM Chunking — DeepSeek
GBRAIN_CHUNKER_API_KEY=sk-deepseek-xxx
GBRAIN_CHUNKER_BASE_URL=https://api.deepseek.com
GBRAIN_CHUNKER_MODEL=deepseek-chat

# Transcription — Groq Whisper
GBRAIN_TRANSCRIPTION_GROQ_API_KEY=gsk_xxx
```

### 场景三：全国产 Provider（Embedding 走百炼 + Chat 走 DeepSeek/智谱）

```bash
# Embedding — 阿里百炼 DashScope
GBRAIN_OPENAI_API_KEY=sk-dashscope-xxx
GBRAIN_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
GBRAIN_EMBEDDING_MODEL=text-embedding-v3
GBRAIN_EMBEDDING_DIMENSIONS=1024

# Query Expansion — 智谱 GLM-4-Flash（免费额度）
GBRAIN_EXPANSION_API_KEY=xxx.zhipu-xxx
GBRAIN_EXPANSION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GBRAIN_EXPANSION_MODEL=glm-4-flash

# LLM Chunking — DeepSeek
GBRAIN_CHUNKER_API_KEY=sk-deepseek-xxx
GBRAIN_CHUNKER_BASE_URL=https://api.deepseek.com
GBRAIN_CHUNKER_MODEL=deepseek-chat

# Transcription — Groq Whisper
GBRAIN_TRANSCRIPTION_GROQ_API_KEY=gsk_xxx
```

### 场景四：Embedding 走智谱 + Expansion/Chunking 走 DeepSeek

```bash
# Embedding — 智谱 (2048维)
GBRAIN_OPENAI_API_KEY=xxx.zhipu-xxx
GBRAIN_OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GBRAIN_EMBEDDING_MODEL=embedding-3
GBRAIN_EMBEDDING_DIMENSIONS=2048

# Query Expansion — DeepSeek
GBRAIN_EXPANSION_API_KEY=sk-deepseek-xxx
GBRAIN_EXPANSION_BASE_URL=https://api.deepseek.com
GBRAIN_EXPANSION_MODEL=deepseek-chat

# LLM Chunking — DeepSeek（复用同一个 key）
GBRAIN_CHUNKER_API_KEY=sk-deepseek-xxx
GBRAIN_CHUNKER_BASE_URL=https://api.deepseek.com
GBRAIN_CHUNKER_MODEL=deepseek-chat

# Transcription — Groq Whisper
GBRAIN_TRANSCRIPTION_GROQ_API_KEY=gsk_xxx
```

---

## 常见问题

### Q: 更换 Embedding 模型后搜索结果变差了？

需要重新生成所有嵌入向量：

```bash
gbrain embed --all
```

### Q: Expansion 和 Chunking 可以用同一个 Provider 吗？

可以。设置相同的 `GBRAIN_EXPANSION_API_KEY` 和 `GBRAIN_CHUNKER_API_KEY` 即可。也可以使用不同的模型：

```bash
GBRAIN_EXPANSION_API_KEY=sk-xxx
GBRAIN_EXPANSION_BASE_URL=https://api.deepseek.com
GBRAIN_EXPANSION_MODEL=deepseek-chat       # 便宜，够用

GBRAIN_CHUNKER_API_KEY=sk-xxx
GBRAIN_CHUNKER_BASE_URL=https://api.deepseek.com
GBRAIN_CHUNKER_MODEL=deepseek-chat         # 需要理解文档结构
```

### Q: 不配置 Expansion/Chunking 会怎样？

- **不配置 Expansion**：`gbrain query` 只用原始查询搜索，召回率降低但不会报错。
- **不配置 Chunking**：`gbrain import` 使用简单分块（按字数切分），对结构简单的文档够用。

### Q: Embedding 走国产 provider 后 Whisper 转写报错了？

Transcription 已使用独立的环境变量（`GBRAIN_TRANSCRIPTION_*`），不再与 Embedding 共用 base URL。确保使用 `GBRAIN_TRANSCRIPTION_GROQ_API_KEY` 或 `GBRAIN_TRANSCRIPTION_OPENAI_API_KEY` 单独配置转写引擎。

### Q: 环境变量在哪里设置？

推荐在 `~/.blockcell/.env` 中设置。BlockCell gateway 启动时会加载该文件，gbrain 作为子进程自动继承。直接在 shell 中 export 也可以，但重启终端后失效。

### Q: 如何验证配置是否生效？

```bash
gbrain doctor --fast    # 检查 Embedding 配置
gbrain embed --stale    # 测试嵌入功能
gbrain query "test"     # 测试搜索（含 expansion）
```

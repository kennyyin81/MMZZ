# AI 推荐助手开发文档

> 当前文件名 `AI-BAR-RECOMMEND.md` 保留历史兼容。现在模块已不只推荐酒馆，也包含酒品推荐、AI 对话、SBTI 画像和历史会话。后续若允许改名，建议使用 `AI-ASSISTANT.md` 或 `AI-RECOMMENDATION.md`。

状态：开发中  
创建：2026-04-26  
最后整理：2026-05-13

## 文档定位

本文只记录 AI 推荐助手的专项设计、接口约定、Prompt、开发阶段和当前状态。

通用内容不要重复维护在本文：

| 内容 | 单一事实来源 |
|------|--------------|
| 全量 API 说明 | `docs/api.md` |
| 全量集合字段和索引 | `docs/database.md` |
| 工程开发规范 | `docs/DEVELOPMENT.md` |
| 产品业务规则 | `docs/PRD.md` |

## 目标与范围

AI 推荐助手基于用户饮酒偏好画像（SBTI）和实时对话意图，通过 TokenHub 大模型接口提供：

- 酒馆推荐
- 酒品推荐
- 酒类知识问答
- 日常闲聊
- 饮酒画像查看和调整引导
- 历史会话继续聊天

整体链路：

```text
用户点击 AI 入口
  -> 检查 SBTI
  -> 无画像则进入 5 题问卷
  -> 有画像则进入 AI 对话
  -> ai.chat 调用大模型
  -> 返回 reply + 结构化推荐卡片
  -> 异步分析对话并微调 SBTI
```

## 方案决策

| 决策项 | 当前方案 | 说明 |
|--------|----------|------|
| 用户画像 | SBTI 标签体系 | 口味、酒类、氛围、场景、预算、区域、禁忌 |
| 大模型 | TokenHub `deepseek-v4-flash` | OpenAI-compatible Chat Completions |
| 推荐架构 | 单次大模型调用 | Prompt 内完成意图识别和回复生成 |
| 酒馆数据源 | `bar_info` | 通过酒馆维护页管理，支持地图搜索填入 |
| 酒品数据源 | `wine_topic` | 复用酒百科内容 |
| 对话入口 | 首页 AI 悬浮入口 | 已接入，图标资源位于 `miniprogram/assets/quick/ai-wine-assistant.png` |
| 历史会话 | `ai_chat_session` | 支持列表和继续会话 |

当前采用单函数式 AI 对话，而不是拆成多节点工作流。原因是数据量较小、一次调用成本低、链路更容易联调。若酒馆/酒品候选明显增大，再考虑先做轻量意图判断和召回，再调用生成模型。

## 核心流程

### `ai.chat`

```text
aiChat(currentUser, payload)
  -> 加载或创建 session
  -> 加载用户 SBTI
  -> 加载酒馆和酒品候选
  -> 拼接最近历史消息
  -> 组装 system prompt
  -> 调用 TokenHub
  -> 解析 JSON
  -> 填充 recommended_bars / recommended_wines
  -> 追加会话消息
  -> 异步 analyzeSbti()
  -> 返回前端
```

### 意图分类

| 意图 | 标识 | 前端表现 |
|------|------|----------|
| 酒馆推荐 | `recommend_bar` | 文本 + 酒馆卡片 |
| 酒品推荐 | `recommend_wine` | 文本 + 酒品卡片 |
| 酒知识 | `knowledge` | 纯文本 |
| 闲聊 | `chitchat` | 纯文本 |
| 画像相关 | `sbti` | 文本 + 查看画像入口 |

> 早期文档里使用过 `recommend`，现在以代码和接口返回中的 `recommend_bar` / `recommend_wine` 为准。

## 大模型接入

后端通过 `cloudfunctions/api/src/ai-client.js` 封装 TokenHub 调用。

环境变量只配置在云函数环境中，不能写入代码仓库：

| 变量 | 说明 | 示例 |
|------|------|------|
| `TOKENHUB_API_KEY` | TokenHub API Key | `ak-***` |
| `TOKENHUB_MODEL` | 模型名 | `deepseek-v4-flash` |
| `TOKENHUB_BASE_URL` | Chat Completions 地址 | `https://tokenhub.tencentmaas.com/v1/chat/completions` |
| `AI_TIMEOUT_MS` | 请求超时时间，毫秒 | `25000` |

JSON 解析必须容错：

- 优先直接 `JSON.parse`
- 失败时尝试从 markdown 或自然语言中提取 JSON 块
- 仍失败时当作普通文本回复，意图降级为 `chitchat`

## SBTI 画像

### 画像维度

| 维度 | 字段 | 说明 |
|------|------|------|
| 口味偏好 | `taste_preferences` | 甜型、果味、清爽解渴、浓烈醇厚、酸爽开胃 |
| 酒类偏好 | `drink_types` | 鸡尾酒、精酿啤酒、威士忌/白兰地、红酒/白葡萄酒、清酒/梅酒、低度微醺饮品 |
| 氛围偏好 | `atmosphere` | 安静可聊天、有背景音乐、热闹有驻唱/DJ、有户外位置、有特色装修/主题 |
| 社交场景 | `social_scene` | 一个人放松、跟朋友小聚、约会、商务应酬、特殊纪念日 |
| 预算区间 | `budget_level` | `1`=50 以下，`2`=50-150，`3`=150-300，`4`=300+ |
| 常去区域 | `preferred_areas` | 对话微调提取，问卷不采集 |
| 禁忌标签 | `avoid_tags` | 如不喝白酒、不要太吵 |
| 额外备注 | `note` | 用户自由描述 |

### 初始问卷

1. 更喜欢哪类酒
2. 口味倾向
3. 一般什么场景去酒馆
4. 喜欢什么氛围
5. 人均预算

重测策略：重新测评覆盖旧画像，`version` 重置为 `1`，`preferred_areas` 和 `avoid_tags` 清空。

### 离线微调

`analyzeSbti()` 在 `ai.chat` 后异步执行：

```text
加载 session 对话 + 当前 SBTI
  -> 调用模型分析新偏好
  -> 仅 confidence=high 时合并
  -> 标签去重追加
  -> 超出上限时移除最旧标签
  -> version + 1
```

标签上限：

| 字段 | 最大保留 |
|------|----------|
| `taste_preferences` | 3 |
| `drink_types` | 4 |
| `atmosphere` | 3 |
| `social_scene` | 3 |
| `preferred_areas` | 5 |
| `avoid_tags` | 5 |

## 数据模型

AI 模块主要使用这些集合，完整字段和索引以 `docs/database.md` 为准：

| 集合 | 用途 |
|------|------|
| `user_sbti` | 当前用户饮酒画像 |
| `bar_info` | 酒馆基础数据；由酒馆维护页写入，前台和 AI 推荐共用 |
| `ai_chat_session` | AI 对话历史 |
| `wine_topic` | 酒品候选和酒百科内容 |

注意：`user_sbti.user_id` 当前对应用户 `openid`，不是 `user_profile._id`。

## API 摘要

完整接口说明以 `docs/api.md` 为准。

| Action | 说明 |
|--------|------|
| `sbti.get` | 获取当前用户画像 |
| `sbti.init` | 初始化画像 |
| `bar.list` | 酒馆列表 |
| `bar.getDetail` | 酒馆详情 |
| `admin.bar.list` | 酒馆维护列表 |
| `admin.bar.upsert` | 新增或更新酒馆 |
| `admin.bar.remove` | 下架酒馆 |
| `ai.chat` | 发送消息并获取 AI 回复 |
| `ai.getSession` | 获取会话详情 |
| `ai.listSessions` | 获取历史会话列表 |
| `admin.ai.testLLM` | 云端验证大模型调用 |

`ai.chat` 典型返回：

```json
{
  "session_id": "xxx",
  "intent": "recommend_bar",
  "reply": "根据你的喜好，推荐这几家...",
  "recommended_bar_ids": ["bar_001"],
  "recommended_bars": [],
  "recommended_wine_ids": ["wine_001"],
  "recommended_wines": [],
  "follow_up_question": "",
  "action_hint": ""
}
```

## Prompt 约定

主对话 Prompt 必须包含：

- 助手角色和能力边界
- 用户 SBTI JSON
- 精简后的酒馆候选
- 精简后的酒品候选
- 意图识别规则
- 严格 JSON 输出格式

输出字段：

```json
{
  "intent": "recommend_bar|recommend_wine|knowledge|chitchat|sbti",
  "reply": "给用户看的自然语言回复",
  "recommended_bar_ids": [],
  "recommended_wine_ids": [],
  "follow_up_question": ""
}
```

SBTI 微调 Prompt 必须限制标签枚举，并要求模型输出：

```json
{
  "new_taste_preferences": [],
  "new_drink_types": [],
  "new_atmosphere": [],
  "new_social_scene": [],
  "new_preferred_areas": [],
  "new_avoid_tags": [],
  "budget_level_change": null,
  "confidence": "low|medium|high",
  "reason": "分析依据"
}
```

## 前端页面与入口

| 页面/组件 | 路径 | 状态 |
|-----------|------|------|
| AI 对话 | `pages/ai/chat/index` | 已接入 |
| 历史会话 | `pages/ai/sessions/index` | 已接入 |
| SBTI 问卷 | `pages/ai/sbti-survey/index` | 已注册，仍需补齐闭环验证 |
| SBTI 画像 | `pages/ai/sbti-profile` | 待补齐 |
| 酒馆详情 | `pages/bar/detail` | 已接入 |
| AI 悬浮入口 | `pages/home/index` | 已接入，可拖拽 |

入口目标链路：

```text
点击 AI 入口
  -> callApi("sbti.get")
  -> null: 跳转 SBTI 问卷
  -> exists: 跳转 AI 对话
```

## 开发阶段

| 阶段 | 目标 | 当前状态 |
|------|------|----------|
| FT-1 | 基础设施：集合、环境变量、`callLLM()` | 已完成 |
| FT-2 | SBTI 画像全流程 | 部分完成 |
| FT-3 | AI 对话核心 + 酒馆详情 | 已完成 |
| FT-4 | 悬浮窗 + 入口串联 | 已完成 |
| FT-5 | SBTI 离线微调 | 待完成 |
| FT-6 | 错误兜底、体验打磨、回归 | 待完成 |

### 已完成

- `bar.list` / `bar.getDetail`
- `admin.ai.testLLM`
- `ai.chat`
- `ai.getSession` / `ai.listSessions`
- `pages/ai/chat/index`
- `pages/ai/sessions/index`
- `pages/bar/detail`
- 首页 AI 悬浮入口
- 酒馆维护页 `pages/admin/bar-info`
- 酒馆/酒品结构化推荐卡片
- AI 消息区固定布局和 Markdown 富文本展示

### 待完成

- SBTI 画像展示页
- SBTI 重测和画像入口闭环
- `analyzeSbti()` 高置信度画像微调
- 全链路回归测试

## 接入原则

1. 一次只注册一个新 action，部署后马上云端测试。
2. 公开只读接口可加入 `PUBLIC_ACTIONS`，需要用户身份的接口仍走 `ensureCurrentUser()`。
3. `wine.list` 原有接口必须保持可用，混合流中 `bar.list` 失败不能拖垮酒款展示。
4. 大模型异常必须兜底为可读文案，不能让前端停在永久 loading。
5. API Key 只放云函数环境变量，文档和代码示例不得出现真实密钥。

## 风险与注意事项

| 风险 | 应对 |
|------|------|
| 大模型响应慢 | 前端 loading，AI action 使用更长超时 |
| 返回非标准 JSON | `safeParseAIJson()` 容错 |
| 推荐数据太少 | Prompt 指示推荐最接近的结果 |
| 意图识别偏差 | 保留日志，持续调 prompt |
| 画像微调过度 | 仅 `confidence=high` 更新，并设置标签上限 |
| 调用成本 | 控制历史消息条数和候选数据大小 |

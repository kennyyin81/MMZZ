# AI 智能推荐酒馆 — 开发文档

> 状态：开发中  
> 创建：2026-04-26  
> 最后更新：2026-05-10

---

## 一、需求概述

基于用户饮酒偏好画像（SBTI）+ 实时对话意图，通过 TokenHub 大模型接口智能推荐酒馆。

### 整体流程

```
用户首次点击 AI 悬浮窗（首页/酒百科页）
        ↓
  SBTI 偏好问卷（5 题，强制完成）
        ↓
  生成初始画像 → 存入 user_sbti
        ↓
  进入 AI 对话页面
        ↓
  用户输入消息 → aiChat() 单函数处理
  （一次大模型调用，prompt 内置意图识别 + 推荐/知识/闲聊能力）
        ↓
  返回结果 → 前端按 intent 渲染
        ↓
  异步：离线分析对话 → 微调 SBTI
```

---

## 二、方案决策记录

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 用户画像体系 | 标签体系（非二分法） | 口味偏好 + 氛围偏好 + 预算区间 + 社交偏好等多维标签 |
| 大模型 | TokenHub `deepseek-v4-flash` | OpenAI-compatible `/v1/chat/completions`，云函数通过 Bearer API Key 调用 |
| 酒馆数据源 | 手动录入种子数据 | Demo 阶段几十家，直接在云数据库控制台录入 |
| AI 对话入口 | 悬浮窗 | 仅在首页和酒百科页显示 |
| SBTI 问卷触发 | 首次打开 AI 对话时强制完成 | 完成后才进入对话 |
| 酒馆维护 | 云数据库控制台直接操作 | Demo 阶段不做后台页面 |
| AI 核心架构 | **单函数 + Prompt 内置意图识别** | 一次大模型调用完成意图判断 + 回复生成，简洁高效 |

### 架构选型说明

Demo 阶段采用单函数方案而非 Subgraph 节点架构，原因：

- 酒馆数据量小（几十家），每次全量注入 prompt 可接受
- 单次 API 调用 = 省成本 + 低延迟
- 代码量约 150-200 行 vs Subgraph 的 400-500 行
- 当 `aiChat()` 函数超过 300 行或酒馆 > 200 家时再拆分为节点架构

---

## 三、AI 对话核心架构

### 3.1 `aiChat()` 单函数流程

```
aiChat(currentUser, payload)
  │
  ├── 1. 加载/创建会话（session）
  ├── 2. 加载用户 SBTI（每次从数据库读最新，确保拿到上轮异步微调后的画像）
  ├── 3. 加载酒馆数据（全量注入 prompt）
  │      ⚠ Demo 阶段每次都加载，因为意图识别由同一次模型调用完成，
  │        无法先判断意图再决定是否加载。20 家酒馆约 2-3K Token，成本可忽略。
  │        后续酒馆 >200 家时优化为：先关键词预判意图，recommend 才加载。
  ├── 4. 拼接历史对话（最近 10 轮）
  ├── 5. 组装 system prompt（含角色 + SBTI + 酒馆 + 意图规则 + 输出格式）
  ├── 6. 调用大模型 API（TokenHub，单次）
  ├── 7. 解析返回 JSON（intent / reply / bar_ids）
  ├── 8. 如果 intent=recommend，查表填充 recommended_bars 摘要
  ├── 9. 追加消息到 session，更新数据库
  ├── 10. 异步：调 analyzeSbti() 微调画像（不 await）
  └── 11. 返回结果给前端
```

### 3.2 意图分类（由模型在 prompt 中完成）

| 意图 | 标识 | 说明 | 前端渲染 |
|------|------|------|---------|
| 找酒馆 | `recommend` | 想去喝酒、找地方、推荐酒馆 | reply + 酒馆卡片 |
| 酒知识 | `knowledge` | 调酒方法、品鉴技巧、酒文化 | reply 纯文本 |
| 闲聊 | `chitchat` | 打招呼、感谢、告别 | reply 纯文本 |
| 画像相关 | `sbti` | 问口味画像、想改偏好 | reply + 「查看画像」按钮 |

### 3.3 后端伪代码

```js
async function aiChat(currentUser, payload) {
  const sessionId = payload.session_id || "";
  const userMessage = assertTextLength(payload.message, "消息", 500, true);

  // 1. 加载/创建 session
  let session = sessionId
    ? await getSession(sessionId, currentUser._id)
    : await createSession(currentUser._id);

  // 2~3. 加载 SBTI + 酒馆
  const [sbti, bars] = await Promise.all([
    getSbti(currentUser.openid),
    getActiveBars()
  ]);

  // 4. 历史消息（最近 10 轮）
  const history = (session.messages || []).slice(-20); // 20条 = 10轮对话

  // 5. 组装 prompt
  const systemPrompt = buildMainPrompt(sbti, bars);

  // 6. 调用大模型
  const aiRaw = await callLLM(systemPrompt, [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ]);

  // 7. 解析
  const parsed = safeParseAIJson(aiRaw);

  // 8. 填充酒馆摘要
  const recommendedBars = (parsed.recommended_bar_ids || [])
    .map(id => bars.find(b => b.bar_id === id))
    .filter(Boolean)
    .map(b => ({ bar_id: b.bar_id, name: b.name, area: b.area, avg_price: b.avg_price, highlights: b.highlights }));

  // 9. 存 session
  await appendMessages(session._id, userMessage, parsed, recommendedBars);

  // 10. 异步微调
  analyzeSbti(session._id, currentUser.openid).catch(console.error);

  // 11. 返回
  return {
    session_id: session._id,
    intent: parsed.intent || "chitchat",
    reply: parsed.reply || "抱歉，我没太理解，能再说一次吗？",
    recommended_bar_ids: parsed.recommended_bar_ids || [],
    recommended_bars: recommendedBars,
    follow_up_question: parsed.follow_up_question || "",
    action_hint: parsed.intent === "sbti" ? "open_sbti_profile" : ""
  };
}
```

### 3.4 JSON 解析容错

```js
function safeParseAIJson(raw) {
  try {
    // 尝试直接解析
    return JSON.parse(raw);
  } catch (e) {
    // 尝试提取 JSON 块（模型可能包了 markdown 代码块）
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) {}
    }
    // 兜底：当纯文本回复处理
    return {
      intent: "chitchat",
      reply: raw || "抱歉，我遇到了一点问题，请再试一次~",
      recommended_bar_ids: [],
      follow_up_question: ""
    };
  }
}
```

### 3.5 大模型调用方式

当前采用 TokenHub 的 OpenAI-compatible 接口，云函数中统一通过 `callLLM()` 封装调用。

> 安全要求：API Key 只配置在云函数环境变量中，不写入代码仓库或文档示例。

环境变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `TOKENHUB_API_KEY` | TokenHub API Key | `ak-***` |
| `TOKENHUB_MODEL` | 模型名 | `deepseek-v4-flash` |
| `TOKENHUB_BASE_URL` | Chat Completions 地址 | `https://tokenhub.tencentmaas.com/v1/chat/completions` |
| `AI_TIMEOUT_MS` | 请求超时时间，毫秒 | `25000` |

本地验证请求示例：

```bash
curl -X POST 'https://tokenhub.tencentmaas.com/v1/chat/completions' \
  -H "Authorization: Bearer $TOKENHUB_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "你好"}
    ],
    "stream": false
  }'
```

云函数封装约定：

```js
const aiRaw = await callLLM(systemPrompt, [
  { role: "user", content: userMessage }
]);
```

---

## 四、SBTI 用户画像设计

### 4.1 维度定义

| 维度 | 字段名 | 取值 | 说明 |
|------|--------|------|------|
| 口味偏好 | `taste_preferences` | `string[]` | 如 `["甜型", "果味"]` |
| 酒类偏好 | `drink_types` | `string[]` | 如 `["鸡尾酒", "精酿啤酒"]` |
| 氛围偏好 | `atmosphere` | `string[]` | 如 `["安静可聊天", "有背景音乐"]` |
| 社交场景 | `social_scene` | `string[]` | 如 `["跟朋友小聚", "约会"]` |
| 预算区间 | `budget_level` | `number` | `1`=50以下 `2`=50-150 `3`=150-300 `4`=300+ (人均/元) |
| 常去区域 | `preferred_areas` | `string[]` | 由离线微调从对话提取，问卷不采集 |
| 敏感/禁忌 | `avoid_tags` | `string[]` | 如 `["不喝白酒", "不要太吵"]` |
| 额外备注 | `note` | `string` | 用户自由描述 |

### 4.2 初始问卷（5 题）

**Q1：你更喜欢哪类酒？**（多选）
- 鸡尾酒 / 精酿啤酒 / 威士忌/白兰地 / 红酒/白葡萄酒 / 清酒/梅酒 / 低度微醺饮品 / 都想试试

**Q2：口味倾向？**（多选）
- 甜型 / 果味 / 清爽解渴 / 浓烈醇厚 / 酸爽开胃

**Q3：你一般什么场景去酒馆？**（多选）
- 一个人放松 / 跟朋友小聚 / 约会 / 商务应酬 / 特殊纪念日

**Q4：你喜欢什么氛围？**（多选）
- 安静可聊天 / 有背景音乐 / 热闹有驻唱/DJ / 有户外位置 / 有特色装修/主题

**Q5：人均预算大概是？**（单选）
- 50 元以下(1) / 50~150 元(2) / 150~300 元(3) / 300 元以上(4)

### 4.3 离线微调（`analyzeSbti`）

```js
async function analyzeSbti(sessionId, userId) {
  // 1. 加载 session 对话 + 当前 SBTI
  // 2. 组装分析 prompt，调用大模型
  // 3. 解析返回，仅 confidence=high 时合并新标签（受上限约束）
  // 4. user_sbti.version +1
}
```

### 4.4 标签数量上限

防止画像无限膨胀导致"什么都喜欢"失去区分度，每个维度设上限：

| 维度 | 字段 | 可选项总数 | 最大保留 |
|------|------|-----------|---------|
| 口味偏好 | `taste_preferences` | 5 | **3** |
| 酒类偏好 | `drink_types` | 6 | **4** |
| 氛围偏好 | `atmosphere` | 5 | **3** |
| 社交场景 | `social_scene` | 5 | **3** |
| 常去区域 | `preferred_areas` | 无限 | **5** |
| 排除标签 | `avoid_tags` | 无限 | **5** |

**合并逻辑**：新标签追加到末尾，超出上限时从头部（最旧的）移除。

```js
const SBTI_MAX_TAGS = {
  taste_preferences: 3,
  drink_types: 4,
  atmosphere: 3,
  social_scene: 3,
  preferred_areas: 5,
  avoid_tags: 5
};

function mergeTags(existing, newTags, maxTags) {
  const merged = [...existing];
  for (const tag of newTags) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  // 超出上限，移除最早加入的（头部）
  return merged.slice(-maxTags);
}
```

> 问卷初始化时不受此限制（用户选几个就存几个）。上限仅约束离线微调的追加行为。

**重测策略**：用户重新测评时覆盖旧画像，`version` 重置为 `1`，`preferred_areas` 和 `avoid_tags` 清空。

---

## 五、数据库设计

### 5.1 新增集合

#### `user_sbti`

```json
{
  "user_id": "o79ZI1zOGRmwzzekpWKtl_4T0-38",
  "taste_preferences": ["甜型", "果味"],
  "drink_types": ["鸡尾酒", "精酿啤酒"],
  "atmosphere": ["安静可聊天", "有背景音乐"],
  "social_scene": ["跟朋友小聚", "约会"],
  "budget_level": 2,
  "avoid_tags": [],
  "note": "",
  "version": 1,
  "created_at": "Date",
  "updated_at": "Date"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | String | 是 | 关联当前用户 `openid`，一对一 |
| `taste_preferences` | String[] | 是 | 可选值：`甜型`、`果味`、`清爽解渴`、`浓烈醇厚`、`酸爽开胃` |
| `drink_types` | String[] | 是 | 可选值：`鸡尾酒`、`精酿啤酒`、`威士忌/白兰地`、`红酒/白葡萄酒`、`清酒/梅酒`、`低度微醺饮品` |
| `atmosphere` | String[] | 是 | 可选值：`安静可聊天`、`有背景音乐`、`热闹有驻唱/DJ`、`有户外位置`、`有特色装修/主题` |
| `social_scene` | String[] | 是 | 可选值：`一个人放松`、`跟朋友小聚`、`约会`、`商务应酬`、`特殊纪念日` |
| `budget_level` | Number | 是 | `1`=50以下，`2`=50-150，`3`=150-300，`4`=300+ |
| `avoid_tags` | String[] | 否 | 默认 `[]` |
| `note` | String | 否 | 默认 `""` |
| `version` | Number | 是 | 初始 `1`，微调 +1，重测重置 `1` |

索引：`user_id`（唯一）

**标签统一规则**：`user_sbti` 的标签值必须与 `bar_info` 的对应字段使用完全相同的字符串。

#### `bar_info`

```json
{
  "bar_id": "bar_001",
  "name": "月色酒馆",
  "area": "广州天河",
  "address": "天河区xxx路xxx号",
  "latitude": 23.1291,
  "longitude": 113.2644,
  "phone": "020-12345678",
  "business_hours": "19:00-02:00",
  "avg_price": 150,
  "budget_level": 2,
  "bar_type": "清吧",
  "drink_types": ["鸡尾酒", "威士忌/白兰地"],
  "taste_tags": ["甜型", "果味", "浓烈醇厚"],
  "atmosphere_tags": ["安静可聊天", "有背景音乐", "有特色装修/主题"],
  "scene_tags": ["约会", "跟朋友小聚"],
  "highlights": "手工鸡尾酒、驻唱歌手、露台位",
  "description": "一句话介绍",
  "image_url": "",
  "images": [],
  "rating": 4.5,
  "is_active": true,
  "created_at": "Date",
  "updated_at": "Date"
}
```

索引：`bar_id`（唯一），`is_active`

#### `ai_chat_session`

```json
{
  "user_id": "o79ZI19XGcwriQRGR0Wpkw0JrRdE",
  "title": "想找安静的清吧",
  "messages": [
    { "role": "user", "content": "今晚想找个安静的地方", "time": "Date" },
    { "role": "assistant", "content": "推荐这几家...", "time": "Date",
      "intent": "recommend", "recommended_bar_ids": ["bar_001"] }
  ],
  "message_count": 2,
  "sbti_snapshot": {},
  "sbti_analyzed": false,
  "is_deleted": false,
  "created_at": "Date",
  "updated_at": "Date"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | String | 取用户首条消息前 20 字，默认 `"新对话"` |
| `messages[].intent` | String | 仅 assistant 消息有 |
| `messages[].recommended_bar_ids` | String[] | 仅 `intent=recommend` 时有值 |
| `sbti_snapshot` | Object | 会话创建时 SBTI 快照 |
| `sbti_analyzed` | Boolean | 是否已完成离线微调 |

索引：`user_id + created_at(desc)`

### 5.2 COLLECTIONS 注册

```js
const COLLECTIONS = {
  // ... 已有
  USER_SBTI: "user_sbti",
  BAR_INFO: "bar_info",
  AI_CHAT_SESSION: "ai_chat_session"
};
```

---

## 六、API 接口设计

| Action | 说明 | 入参 |
|--------|------|------|
| `sbti.get` | 获取当前用户 SBTI（不存在返回 null） | 无 |
| `sbti.init` | 初始化 SBTI（问卷提交） | `{ taste_preferences, drink_types, atmosphere, social_scene, budget_level }` |
| `sbti.update` | 手动修改 SBTI | 同上（部分字段） |
| `bar.list` | 酒馆列表 | `{ page_no, page_size, area? }` |
| `bar.getDetail` | 酒馆详情 | `{ bar_id }` |
| `ai.chat` | 发送消息，获取 AI 回复 | `{ session_id?, message }` |
| `ai.getSession` | 获取会话历史 | `{ session_id }` |
| `ai.listSessions` | 会话列表 | `{ page_no, page_size }` |

### `ai.chat` 返回结构

```json
{
  "session_id": "xxx",
  "intent": "recommend",
  "reply": "根据你的喜好，推荐这几家...",
  "recommended_bar_ids": ["bar_001", "bar_005"],
  "recommended_bars": [
    { "bar_id": "bar_001", "name": "月色酒馆", "area": "广州天河", "avg_price": 120, "highlights": "..." }
  ],
  "follow_up_question": "",
  "action_hint": ""
}
```

---

## 七、Prompt 设计

### 7.1 主对话 Prompt

```
你是「MMZZ 酒馆推荐助手」，一个懂酒、有趣、贴心的 AI 伙伴。

## 你的能力
1. 帮用户找到合适的酒馆（推荐）
2. 回答酒类相关知识（调酒、酒文化、品鉴等）
3. 日常闲聊（打招呼、感谢、告别等）

## 用户画像（SBTI）
{sbti_json}

## 酒馆数据库
{bar_list_json}

## 意图识别规则
根据用户消息判断意图：
- recommend：想找地方喝酒、想去酒馆、问哪里好喝、今晚去哪等
- knowledge：问酒类知识、调酒方法、品鉴技巧等
- chitchat：打招呼、闲聊、感谢、告别等
- sbti：问自己的口味画像、想改偏好等

## 输出格式（严格 JSON，不要包 markdown 代码块）
{
  "intent": "recommend|knowledge|chitchat|sbti",
  "reply": "给用户看的自然语言回复",
  "recommended_bar_ids": [],
  "follow_up_question": ""
}

## 各意图处理规则

### intent = recommend
- 结合画像和需求，从酒馆数据库推荐 1-3 家
- recommended_bar_ids 填入酒馆 bar_id
- reply 自然解释推荐理由
- 需求不明确时用 follow_up_question 追问

### intent = knowledge
- 专业但通俗，回复控制在 200 字内
- recommended_bar_ids 返回空数组

### intent = chitchat
- 亲切有趣，可主动引导"需要帮你推荐酒馆吗？"
- recommended_bar_ids 返回空数组

### intent = sbti
- 告诉用户在「我的饮酒画像」中查看和修改
- recommended_bar_ids 返回空数组
```

### 7.2 SBTI 微调分析 Prompt

```
你是用户画像分析专家。分析对话中用户新暴露的饮酒偏好。

## 当前画像
{current_sbti_json}

## 本轮对话
{conversation_json}

## 标签枚举（只能用以下值）
taste_preferences: 甜型、果味、清爽解渴、浓烈醇厚、酸爽开胃
drink_types: 鸡尾酒、精酿啤酒、威士忌/白兰地、红酒/白葡萄酒、清酒/梅酒、低度微醺饮品
atmosphere: 安静可聊天、有背景音乐、热闹有驻唱/DJ、有户外位置、有特色装修/主题
social_scene: 一个人放松、跟朋友小聚、约会、商务应酬、特殊纪念日

## 输出格式（严格 JSON）
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

无新信息时所有数组返回空，confidence 为 "low"。
```

---

## 八、前端页面设计

### 8.1 新增页面

| 页面 | 路径 | 功能 |
|------|------|------|
| SBTI 问卷 | `pages/ai/sbti-survey` | 5 题问卷 / 重新测评 |
| SBTI 画像 | `pages/ai/sbti-profile` | 查看画像 + 重测入口 |
| AI 对话 | `pages/ai/chat` | 对话 + 推荐结果 |
| 酒馆详情 | `pages/bar/detail` | 单个酒馆详情 |

### 8.2 悬浮窗组件

全局组件 `components/ai-float-button/`，在首页和酒百科页引用。

```
点击悬浮窗 → callApi("sbti.get")
  ├── null → 跳转问卷页
  └── 有数据 → 跳转对话页
```

### 8.3 SBTI 问卷页

```
Q1 → Q2 → Q3 → Q4 → Q5 → 提交 sbti.init
  ↓
mode=redo ? navigateBack → 画像页 : navigateTo → 对话页
```

### 8.4 SBTI 画像展示页

入口：「我的」页面新增「我的饮酒画像」。

- 各维度 chip 标签展示
- "画像已通过 N 次对话优化"（version - 1）
- 底部「重新测评」→ `sbti-survey?mode=redo`

### 8.5 AI 对话页

**前端渲染逻辑**：

```
收到 ai.chat 返回 → 读取 intent
  ├── recommend + bar_ids 非空 → reply 文本 + 酒馆卡片（点击跳转 bar/detail）
  ├── knowledge / chitchat     → reply 纯文本
  └── sbti                     → reply 文本 + 「查看我的画像」按钮
```

### 8.6 酒馆详情页

路径：`pages/bar/detail?bar_id=bar_001`

```
┌─────────────────────────────┐
│  月色酒馆                     │ ← 导航栏（酒馆名称）
├─────────────────────────────┤
│                             │
│  ┌───────────────────────┐  │
│  │      酒馆封面图片       │  │ ← image_url / 默认占位图
│  └───────────────────────┘  │
│                             │
│  月色酒馆            ⭐ 4.5  │ ← 名称 + 评分
│  清吧 · 人均 ¥120           │ ← bar_type + avg_price
│  距你 1.2 km                │ ← 实时计算距离
│                             │
│  ┌───────────────────────┐  │
│  │  📍 地址               │  │
│  │  天河区体育西路xxx号x楼  │  │ ← 点击复制 or 打开地图
│  │  📞 020-12345678       │  │ ← 点击拨打
│  │  🕐 19:00 - 02:00      │  │ ← business_hours
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │  🍷 酒类               │  │
│  │  鸡尾酒 · 红酒/白葡萄酒 │  │ ← drink_types chips
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │  🎵 氛围               │  │
│  │  安静可聊天 · 有背景音乐 │  │ ← atmosphere_tags chips
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │  ✨ 亮点               │  │
│  │  手工鸡尾酒、露台座位、  │  │ ← highlights
│  │  驻唱歌手（周五/六）     │  │
│  └───────────────────────┘  │
│                             │
│  天河闹中取静的小清吧，     │ ← description
│  适合两三好友小酌            │
│                             │
└─────────────────────────────┘
```

**展示字段**：

| 字段 | 来源 | 说明 |
|------|------|------|
| 封面图 | `image_url` | 无图时用默认占位 |
| 名称 | `name` | — |
| 评分 | `rating` | ⭐ 格式 |
| 类型 + 人均 | `bar_type` + `avg_price` | 如"清吧 · 人均¥120" |
| **距离** | 实时计算 | 见下方距离计算逻辑 |
| 地址 | `address` | 点击可复制或调起地图 |
| 电话 | `phone` | 点击拨打 `wx.makePhoneCall` |
| 营业时间 | `business_hours` | — |
| 酒类 | `drink_types` | chip 标签 |
| 氛围 | `atmosphere_tags` | chip 标签 |
| 亮点 | `highlights` | 文本 |
| 介绍 | `description` | 文本 |

**距离计算逻辑**：

```js
// 进入详情页时获取用户位置
onShow() {
  wx.getLocation({
    type: "gcj02",
    success: (res) => {
      const distance = calcDistance(
        res.latitude, res.longitude,
        this.data.bar.latitude, this.data.bar.longitude
      );
      this.setData({ distance }); // 如 "1.2 km" 或 "800 m"
    },
    fail: () => {
      this.setData({ distance: "" }); // 未授权时不显示距离
    }
  });
}

// Haversine 公式计算两点距离
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // 地球半径 km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
```

> 需要在 `app.json` 中声明 `"permission": { "scope.userLocation": { "desc": "用于计算你与酒馆的距离" } }`。用户拒绝授权时距离不显示，不影响其他功能。

---

## 九、开发阶段（FT 划分）

### FT-1：基础设施搭建

> **目标**：数据层就绪，TokenHub 大模型 API 可调通  
> **前置**：数据库集合已创建  
> **验收**：3 个集合已创建，酒馆有种子数据，`callLLM()` 能正常返回

| # | 任务 | 产出 |
|---|------|------|
| 1.1 | 获取 TokenHub API Key | `TOKENHUB_API_KEY` |
| 1.2 | 云数据库创建 `user_sbti` + `bar_info` + `ai_chat_session`，建索引 | 集合就绪 |
| 1.3 | 后端 `COLLECTIONS` 注册 3 个新集合 | `context.js` 更新 |
| 1.4 | 配置云函数环境变量 | `TOKENHUB_API_KEY` / `TOKENHUB_MODEL` / `TOKENHUB_BASE_URL` |
| 1.5 | 后端：`callLLM()` 封装（TokenHub HTTP POST） | 大模型调用函数 |
| 1.6 | 后端：`safeParseAIJson()` 容错解析 | JSON 解析函数 |
| 1.7 | 手动录入 10~20 家酒馆种子数据 | `bar_info` 有数据 |
| 1.8 | 测试：云函数中调用大模型 → 正常返回 | `admin.ai.testLLM` 调通 |

---

### FT-2：SBTI 画像全流程

> **目标**：用户可完成问卷、查看画像、重新测评  
> **前置**：FT-1（集合已创建）  
> **验收**：问卷提交 → 数据库有记录 → 画像页展示 → 重测覆盖

| # | 任务 | 产出 |
|---|------|------|
| 2.1 | 后端：`sbti.get` / `sbti.init` / `sbti.update` 接口 | 3 个 action |
| 2.2 | 前端：问卷页 `pages/ai/sbti-survey`（支持 `mode=redo`） | 页面四件套 |
| 2.3 | 前端：画像展示页 `pages/ai/sbti-profile` | 页面四件套 |
| 2.4 | 前端：「我的」页面新增「我的饮酒画像」入口 | 修改 profile/index |
| 2.5 | `app.json` 注册两个新页面 | 路由生效 |
| 2.6 | 测试：问卷 → 画像 → 重测 → 数据库验证 | 全流程走通 |

---

### FT-3：AI 对话核心 + 酒馆详情

> **目标**：用户能和 AI 对话，推荐意图返回酒馆卡片，其他意图返回纯文本  
> **前置**：FT-1（大模型可调用） + FT-2（SBTI 有数据）  
> **验收**：发消息 → AI 正确回复 → 推荐带酒馆卡片 → 卡片可点击看详情

| # | 任务 | 产出 |
|---|------|------|
| 3.1 | 后端：`aiChat()` 主函数（完整流程：加载数据 → 组装 prompt → 调大模型 → 解析 → 存 session） | 核心 action |
| 3.2 | 后端：`ai.getSession` / `ai.listSessions` 接口 | 2 个 action |
| 3.3 | 后端：`bar.list` / `bar.getDetail` 接口 | 2 个 action |
| 3.4 | 前端：AI 对话页 `pages/ai/chat`（消息列表 + 输入框 + loading） | 页面四件套 |
| 3.5 | 前端：按 intent 分支渲染（推荐卡片 / 纯文本 / 画像按钮） | 渲染逻辑 |
| 3.6 | 前端：酒馆详情页 `pages/bar/detail` | 页面四件套 |
| 3.7 | `app.json` 注册 `pages/ai/chat` 和 `pages/bar/detail` | 路由生效 |
| 3.8 | 联调：推荐/知识/闲聊/画像 4 种意图测试 | 全部意图走通 |

#### FT-3 当前接入记录（2026-05-10）

当前先跳过 FT-2 页面开发，`user_sbti` 由手动数据提供。注意：`user_sbti.user_id` 对应当前用户 `openid`，不是 `user_profile._id`。

已完成 / 已验证：

- `bar_info` 集合已可查，`bar.list` 云端测试通过。
- `bar.list` 当前作为公开 action，可跳过登录态，便于云端测试。
- `cloudfunctions/api/index.js` 保留了原登录态逻辑注释，测试完成后可恢复。
- 第二个 Tab `pages/wine/index` 已尝试接入混合流：前端同时调用 `wine.list` + `bar.list`，合并后随机打乱展示。
- 酒馆卡片目前只展示，不跳详情；点击先提示“酒馆详情待接入”。

当前暂缓 / 占位：

- `bar.getDetail` 暂不注册到 `router.js`。
- `ai.chat` / `ai.getSession` / `ai.listSessions` 暂不注册到 `router.js`。
- `admin.ai.testLLM` 暂不注册到 `router.js`。
- `cloudfunctions/api/src/handlers/ai.js`、`cloudfunctions/api/src/ai-client.js`、`miniprogram/pages/ai/`、`miniprogram/pages/bar/` 暂作为占位文件保留。

接入原则：

1. 一次只注册一个新 action，部署后马上云端测试。
2. 公开只读接口可加入 `PUBLIC_ACTIONS`，方便云端测试；需要用户身份的接口仍走 `ensureCurrentUser()`。
3. 如云函数出现 `writeRuntimeFile` / `InitFunction: 0ms`，优先回滚最近注册的 action，不要同时排查多个新增模块。
4. `wine.list` 原有接口必须保持可用；混合列表中 `bar.list` 失败不应拖垮酒款展示。

后续步骤：

| 顺序 | 动作 | 验收 |
|------|------|------|
| 1 | 确认第二个 Tab 混合展示稳定 | 酒款和酒馆都能出现；`bar.list` 失败时酒款仍可展示 |
| 2 | 最小接入 `bar.getDetail`，并加入 `PUBLIC_ACTIONS` | 云端测试 `bar.getDetail` 能返回 `bar_info` 单条记录 |
| 3 | 酒馆卡片点击跳转 `pages/bar/detail?bar_id=xxx` | 酒馆详情页能展示图片、地址、电话、标签、评分 |
| 4 | 恢复 `admin.ai.testLLM` | 小程序端调用能返回 `deepseek-v4-flash` 回复 |
| 5 | 接入 `ai.getSession` / `ai.listSessions` | 当前用户能读取自己的会话列表和历史 |
| 6 | 接入 `ai.chat` 基础版 | 能读取 `user_sbti(openid)` + `bar_info`，返回 reply 和推荐酒馆 |
| 7 | AI 对话页联调 | 推荐 / 知识 / 闲聊 / 画像相关 4 类意图走通 |

---

### FT-4：悬浮窗 + 入口串联

> **目标**：完整用户体验闭环  
> **前置**：FT-2 + FT-3  
> **验收**：悬浮窗 → 判断 SBTI → 问卷 or 对话 → 推荐 → 详情 → 画像

| # | 任务 | 产出 |
|---|------|------|
| 4.1 | 全局组件：`components/ai-float-button/` | 组件四件套 |
| 4.2 | 首页 + 酒百科页引入悬浮窗 | 入口可见 |
| 4.3 | 悬浮窗点击逻辑：检查 SBTI → 问卷 or 对话 | 串联逻辑 |
| 4.4 | 端到端测试：新用户完整流程 | 闭环验证 |

---

### FT-5：SBTI 离线微调

> **目标**：对话后自动优化画像  
> **前置**：FT-3  
> **验收**：多轮对话后 SBTI version 增长，新标签合理追加

| # | 任务 | 产出 |
|---|------|------|
| 5.1 | 后端：`analyzeSbti()` 完整实现（调大模型 + 解析 + 合并标签） | 异步函数 |
| 5.2 | 合并逻辑：去重追加，仅 `confidence=high` 更新，version +1 | 合并函数 |
| 5.3 | 测试：3~5 轮对话后检查画像变化 | 微调验证 |

---

### FT-6：收尾打磨

> **目标**：体验完善、错误兜底、文档同步  
> **前置**：FT-1 ~ FT-5

| # | 任务 | 产出 |
|---|------|------|
| 6.1 | 错误兜底：网络失败、模型超时、JSON 解析失败 | fallback 文案 |
| 6.2 | 对话轮数限制（单会话最多 20 轮） | 成本控制 |
| 6.3 | 更新 `DEVELOPMENT.md` / `api.md` / `database.md` | 文档同步 |
| 6.4 | 全流程回归测试 | 质量保证 |

---

## 十、FT 依赖关系

```
FT-1 基础设施
 ├──→ FT-2 SBTI 画像 ──┐
 │                      ├──→ FT-4 悬浮窗串联
 └──→ FT-3 AI 对话核心 ─┤
                        └──→ FT-5 离线微调

FT-6 收尾（依赖全部）
```

**可并行**：FT-1 完成后，FT-2 和 FT-3 的后端部分可同时开发。

---

## 十一、酒馆种子数据模板

```json
{
  "bar_id": "bar_001",
  "name": "月色酒馆",
  "area": "广州天河",
  "address": "天河区体育西路xxx号x楼",
  "latitude": 23.1291,
  "longitude": 113.2644,
  "phone": "020-12345678",
  "business_hours": "19:00-02:00",
  "avg_price": 120,
  "budget_level": 2,
  "bar_type": "清吧",
  "drink_types": ["鸡尾酒", "红酒/白葡萄酒"],
  "taste_tags": ["甜型", "果味"],
  "atmosphere_tags": ["安静可聊天", "有背景音乐", "有特色装修/主题"],
  "scene_tags": ["约会", "跟朋友小聚"],
  "highlights": "手工鸡尾酒、露台座位、驻唱歌手（周五/六）",
  "description": "天河闹中取静的小清吧，适合两三好友小酌",
  "image_url": "",
  "images": [],
  "rating": 4.5,
  "is_active": true,
  "created_at": "2026-04-26T00:00:00.000Z",
  "updated_at": "2026-04-26T00:00:00.000Z"
}
```

---

## 十二、风险 & 注意事项

| 风险 | 应对 |
|------|------|
| 大模型 API 响应慢（>5s） | loading 动画；云函数超时 30s |
| 大模型返回非标准 JSON | `safeParseAIJson()` 容错 + fallback |
| 酒馆数据太少 | prompt 指示"推荐最接近的" |
| 意图识别偏差 | prompt 中给出明确规则；观察日志持续优化 |
| SBTI 微调不稳定 | 仅 `confidence=high` 更新 |
| 调用成本 | `deepseek-v4-flash`；限 10 轮/会话 |

---

## 十三、当前状态

- [x] 需求确认
- [x] 方案设计
- [x] **FT-1：基础设施搭建**（集合已建，`callLLM()` 已通过 `deepseek-v4-flash` 联调）
- [ ] FT-2：SBTI 画像全流程
- [ ] FT-3：AI 对话核心 + 酒馆详情 ← 进行中（代码已补，待部署联调）
- [ ] FT-4：悬浮窗 + 入口串联
- [ ] FT-5：SBTI 离线微调
- [ ] FT-6：收尾打磨

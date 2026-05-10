const {
  db,
  _,
  COLLECTIONS,
  ROLE,
  assert,
  now,
  unwrapList,
  unwrapDoc,
  unwrapInsertId,
  buildPagination,
  requireRole,
  assertTextLength
} = require("../context");
const { callLLM, safeParseAIJson, getAIConfig } = require("../ai-client");

const VALID_INTENTS = ["recommend", "knowledge", "chitchat", "sbti"];

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\r\n、,，/|；;]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function pickBarForPrompt(bar) {
  return {
    bar_id: bar.bar_id,
    name: bar.name || "",
    area: bar.area || "",
    avg_price: Number(bar.avg_price || 0),
    budget_level: Number(bar.budget_level || 0),
    bar_type: bar.bar_type || "",
    drink_types: normalizeStringList(bar.drink_types),
    taste_tags: normalizeStringList(bar.taste_tags),
    atmosphere_tags: normalizeStringList(bar.atmosphere_tags),
    scene_tags: normalizeStringList(bar.scene_tags),
    highlights: bar.highlights || "",
    description: bar.description || "",
    rating: Number(bar.rating || 0)
  };
}

function summarizeBar(bar) {
  return {
    bar_id: bar.bar_id,
    name: bar.name || "",
    area: bar.area || "",
    address: bar.address || "",
    avg_price: Number(bar.avg_price || 0),
    budget_level: Number(bar.budget_level || 0),
    bar_type: bar.bar_type || "",
    highlights: bar.highlights || "",
    description: bar.description || "",
    image_url: bar.image_url || "",
    rating: Number(bar.rating || 0)
  };
}

function buildMainPrompt(sbti, bars) {
  return [
    "你是一个酒馆推荐助手，目标是根据用户饮酒画像和当前对话，给出自然、克制、可执行的建议。",
    "你需要同时完成意图识别与回复生成。",
    "只允许输出 JSON，不要输出 markdown，不要输出额外解释。",
    "JSON 格式固定为：",
    JSON.stringify({ intent: "recommend|knowledge|chitchat|sbti", reply: "给用户看的自然语言回复", recommended_bar_ids: [], follow_up_question: "" }),
    "intent 规则：recommend=找酒馆/推荐去哪喝；knowledge=酒知识；chitchat=闲聊；sbti=画像相关。",
    "如果 intent=recommend，只能从给定酒馆列表中选择 1-3 个 bar_id。需求不明确时可追问，但仍尽量推荐最接近的。",
    "如果不是 recommend，recommended_bar_ids 必须为空数组。",
    `用户饮酒画像：${JSON.stringify(sbti || {})}`,
    `可推荐酒馆列表：${JSON.stringify((bars || []).map(pickBarForPrompt))}`
  ].join("\n");
}

function normalizeAIResult(parsed, bars) {
  const result = parsed && typeof parsed === "object" ? parsed : {};
  const intent = VALID_INTENTS.includes(result.intent) ? result.intent : "chitchat";
  const barMap = (Array.isArray(bars) ? bars : []).reduce((acc, bar) => {
    if (bar && bar.bar_id) acc[bar.bar_id] = bar;
    return acc;
  }, {});
  const rawIds = Array.isArray(result.recommended_bar_ids) ? result.recommended_bar_ids : (Array.isArray(result.bar_ids) ? result.bar_ids : []);
  const ids = Array.from(new Set(rawIds
    .map((id) => String(id || "").trim())
    .filter((id) => id && barMap[id]))).slice(0, 3);

  return {
    intent,
    reply: String(result.reply || "抱歉，我没太理解，能再说一次吗？").trim(),
    recommended_bar_ids: intent === "recommend" ? ids : [],
    follow_up_question: String(result.follow_up_question || "").trim()
  };
}

async function getSbti(userId) {
  const res = await db.collection(COLLECTIONS.USER_SBTI).where({ user_id: userId }).limit(1).get();
  return unwrapDoc(res) || null;
}

async function getActiveBars() {
  const res = await db.collection(COLLECTIONS.BAR_INFO).where({ is_active: true }).limit(100).get();
  return unwrapList(res)
    .filter((item) => item && item.bar_id)
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
}

async function getSessionById(sessionId, userId) {
  const session = await db.collection(COLLECTIONS.AI_CHAT_SESSION).doc(sessionId).get().then(unwrapDoc).catch(() => null);
  assert(session && session.user_id === userId && !session.is_deleted, 3001, "会话不存在");
  return session;
}

async function createSession(userId, title, sbti) {
  const createdAt = now();
  const addRes = await db.collection(COLLECTIONS.AI_CHAT_SESSION).add({
    data: {
      user_id: userId,
      title: title || "新对话",
      messages: [],
      message_count: 0,
      sbti_snapshot: sbti || {},
      sbti_analyzed: false,
      is_deleted: false,
      created_at: createdAt,
      updated_at: createdAt
    }
  });
  return {
    _id: unwrapInsertId(addRes),
    user_id: userId,
    title: title || "新对话",
    messages: [],
    message_count: 0,
    sbti_snapshot: sbti || {},
    sbti_analyzed: false,
    is_deleted: false,
    created_at: createdAt,
    updated_at: createdAt
  };
}

async function aiChat(currentUser, payload) {
  const sessionId = String(payload.session_id || "").trim();
  const userMessage = assertTextLength(payload.message, "消息", 500, true);

  const [sbti, bars] = await Promise.all([
    getSbti(currentUser.openid),
    getActiveBars()
  ]);

  const session = sessionId
    ? await getSessionById(sessionId, currentUser._id)
    : await createSession(currentUser._id, userMessage.slice(0, 20) || "新对话", sbti);

  const history = (Array.isArray(session.messages) ? session.messages : [])
    .slice(-20)
    .map((item) => ({ role: item.role, content: item.content }))
    .filter((item) => item.content && ["user", "assistant"].includes(item.role));

  const aiRaw = await callLLM(
    buildMainPrompt(sbti, bars),
    history.concat({ role: "user", content: userMessage }),
    { temperature: 0.35 }
  );
  const parsed = normalizeAIResult(safeParseAIJson(aiRaw), bars);
  const barMap = bars.reduce((acc, bar) => {
    acc[bar.bar_id] = bar;
    return acc;
  }, {});
  const recommendedBars = parsed.recommended_bar_ids.map((id) => summarizeBar(barMap[id])).filter(Boolean);

  const messageTime = now();
  const nextMessages = (Array.isArray(session.messages) ? session.messages : []).concat([
    { role: "user", content: userMessage, time: messageTime },
    {
      role: "assistant",
      content: parsed.reply,
      time: messageTime,
      intent: parsed.intent,
      recommended_bar_ids: parsed.recommended_bar_ids,
      recommended_bars: recommendedBars,
      follow_up_question: parsed.follow_up_question
    }
  ]);

  await db.collection(COLLECTIONS.AI_CHAT_SESSION).doc(session._id).update({
    data: {
      messages: nextMessages,
      message_count: nextMessages.length,
      updated_at: messageTime
    }
  });

  return {
    session_id: session._id,
    intent: parsed.intent,
    reply: parsed.reply,
    recommended_bar_ids: parsed.recommended_bar_ids,
    recommended_bars: recommendedBars,
    follow_up_question: parsed.follow_up_question,
    action_hint: parsed.intent === "sbti" ? "open_sbti_profile" : ""
  };
}

async function getSession(currentUser, payload) {
  const sessionId = String(payload.session_id || "").trim();
  assert(sessionId, 2001, "session_id 不能为空");
  const session = await getSessionById(sessionId, currentUser._id);
  return { session };
}

async function listSessions(currentUser, payload) {
  const pager = buildPagination(payload || {});
  const res = await db.collection(COLLECTIONS.AI_CHAT_SESSION)
    .where({ user_id: currentUser._id })
    .limit(100)
    .get();
  const all = unwrapList(res)
    .filter((item) => item && !item.is_deleted)
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  const list = all.slice(pager.skip, pager.skip + pager.limit).map((item) => ({
    session_id: item._id,
    title: item.title || "新对话",
    message_count: Number(item.message_count || 0),
    updated_at: item.updated_at || item.created_at,
    last_message: ((item.messages || []).slice(-1)[0] || {}).content || ""
  }));
  return {
    list,
    total: all.length,
    page_no: pager.pageNo,
    page_size: pager.pageSize,
    has_more: pager.skip + list.length < all.length
  };
}

async function testLLM(currentUser, payload) {
  requireRole(currentUser, [ROLE.ADMIN, ROLE.SOMMELIER]);

  const message = assertTextLength(payload.message || "你好", "测试消息", 200, true);
  const reply = await callLLM(
    "You are a helpful assistant.",
    [{ role: "user", content: message }],
    { temperature: 0.2 }
  );
  const config = getAIConfig();

  return {
    model: config.model,
    endpoint: config.endpoint,
    reply
  };
}

module.exports = {
  aiChat,
  getSession,
  listSessions,
  testLLM
};
const {
  db,
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

function getAIClient() {
  return require("../ai-client");
}

const VALID_INTENTS = ["recommend", "recommend_bar", "recommend_wine", "knowledge", "chitchat", "sbti"];

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\r\n、,，/|；;]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeReplyText(value) {
  return String(value || "").trim();
}

function inferRecommendationIntent(message) {
  const text = String(message || "").trim();
  if (!text) return "";

  const asksRecommendation = /(推荐|适合|喝什么|喝点什么|来一杯|几款|一款|想喝|新手|低度|好入口|清爽|甜一点|苦一点|微醺)/.test(text);
  if (!asksRecommendation) return "";

  const asksPlace = /(酒馆|酒吧|bar|店|场所|去哪喝|哪里喝|附近|安静|聊天|约会|小酌)/i.test(text);
  const asksDrink = /(酒|鸡尾酒|啤酒|葡萄酒|威士忌|白兰地|金酒|伏特加|朗姆|龙舌兰|一杯|喝点什么|低度|好入口|清爽|甜一点|苦一点|微醺)/.test(text);

  if (asksPlace && !asksDrink) {
    return "recommend_bar";
  }
  if (asksDrink) {
    return "recommend_wine";
  }
  return asksPlace ? "recommend_bar" : "";
}

function pickFallbackWineIds(wines, message) {
  const text = String(message || "").toLowerCase();
  return (Array.isArray(wines) ? wines : [])
    .map((wine) => {
      const haystack = [
        wine.name,
        wine.category,
        wine.flavor,
        wine.base_spirit,
        wine.summary,
        wine.scene,
        wine.recommended_scenes,
        wine.target_audience,
        wine.taste_note
      ].join(" ").toLowerCase();
      let score = 0;
      normalizeStringList(text).forEach((word) => {
        if (word && haystack.includes(word)) score += 2;
      });
      if (/女生|低度|好入口|甜|果/.test(text) && /女生|低度|好入口|甜|果|清爽/.test(haystack)) score += 3;
      if (/苦|草本|酒感|经典/.test(text) && /苦|草本|酒感|经典/.test(haystack)) score += 3;
      return { wine, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.wine && item.wine.wine_id)
    .filter(Boolean)
    .slice(0, 3);
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

function pickWineForPrompt(wine) {
  return {
    wine_id: wine.wine_id,
    name: wine.name || "",
    category: wine.category || "",
    alcohol: wine.alcohol || "",
    flavor: normalizeStringList(wine.flavor),
    base_spirit: wine.base_spirit || "",
    ingredients: wine.ingredients || wine.main_ingredients || "",
    taste_note: wine.taste_note || "",
    summary: wine.summary || "",
    scene: wine.scene || wine.recommended_scenes || "",
    target_audience: wine.target_audience || "",
    keywords: normalizeStringList(wine.keywords),
    acidity: Number(wine.acidity || 0),
    sweetness: Number(wine.sweetness || 0),
    bitterness: Number(wine.bitterness || 0),
    spiciness: Number(wine.spiciness || 0)
  };
}

function summarizeWine(wine) {
  return {
    wine_id: wine.wine_id,
    name: wine.name || "",
    category: wine.category || "",
    alcohol: wine.alcohol || "",
    flavor: wine.flavor || "",
    summary: wine.summary || "",
    image_url: wine.image_url || "",
    base_spirit: wine.base_spirit || "",
    ingredients: wine.ingredients || wine.main_ingredients || "",
    main_ingredients: wine.main_ingredients || wine.ingredients || "",
    taste_note: wine.taste_note || "",
    scene: wine.scene || wine.recommended_scenes || "",
    recommended_scenes: wine.recommended_scenes || wine.scene || "",
    target_audience: wine.target_audience || "",
    acidity: Number(wine.acidity || 0),
    sweetness: Number(wine.sweetness || 0),
    bitterness: Number(wine.bitterness || 0),
    spiciness: Number(wine.spiciness || 0),
    average_rating: Number(wine.average_rating || 0),
    rating_count: Number(wine.rating_count || 0)
  };
}

function buildMainPrompt(sbti, bars, wines) {
  return [
    "你是一个酒馆与酒品推荐助手，目标是根据用户饮酒偏好和当前对话，给出自然、克制、可执行的建议。",
    "你需要先判断用户意图，再生成回复。酒知识问答和结构化推荐要分开处理，不要混淆。",
    "只允许输出 JSON，不要输出 JSON 外的额外解释。",
    "reply 和 follow_up_question 可使用少量 **重点** 强调，但不要使用标题、代码块、表格等复杂 markdown。",
    "JSON 格式固定为：",
    JSON.stringify({ intent: "recommend_bar|recommend_wine|knowledge|chitchat|sbti", reply: "给用户看的自然语言回复", recommended_bar_ids: [], recommended_wine_ids: [], follow_up_question: "" }),
    "intent 规则：recommend_bar=推荐去哪喝/找酒馆/场所；recommend_wine=推荐喝什么酒/酒品/鸡尾酒/啤酒/葡萄酒；knowledge=解释酒知识但不推荐具体库内酒品；chitchat=闲聊；sbti=偏好相关。",
    "用户明确要求推荐喝什么、适合喝什么、来一杯、喝点什么、低度/好入口/清爽/微醺等饮用建议时，必须判定为 recommend_wine，不要判定为 chitchat/chat/knowledge。",
    "用户明确要求推荐去哪喝、找酒馆/酒吧/附近/安静聊天/约会场所时，必须判定为 recommend_bar，不要判定为 chitchat/chat/knowledge。",
    "不要输出 chat 这个 intent；闲聊只能输出 chitchat。",
    "如果 intent=recommend_bar，只能从给定酒馆列表中选择 1-3 个 bar_id，recommended_wine_ids 必须为空数组。",
    "如果 intent=recommend_wine，只能从给定酒品列表中选择 1-3 个 wine_id，recommended_bar_ids 必须为空数组。",
    "如果 intent=knowledge/chitchat/sbti，recommended_bar_ids 和 recommended_wine_ids 都必须为空数组。",
    "如果用户只是问酒知识、概念、区别、怎么喝，不要强行推荐卡片；可以在 reply 中给建议。",
    `用户饮酒偏好：${JSON.stringify(sbti || {})}`,
    `可推荐酒馆列表：${JSON.stringify((bars || []).map(pickBarForPrompt))}`,
    `可推荐酒品列表：${JSON.stringify((wines || []).map(pickWineForPrompt))}`
  ].join("\n");
}

function normalizeAIResult(parsed, bars, wines, userMessage) {
  const result = parsed && typeof parsed === "object" ? parsed : {};
  const barMap = (Array.isArray(bars) ? bars : []).reduce((acc, bar) => {
    if (bar && bar.bar_id) acc[bar.bar_id] = bar;
    return acc;
  }, {});
  const wineMap = (Array.isArray(wines) ? wines : []).reduce((acc, wine) => {
    if (wine && wine.wine_id) acc[wine.wine_id] = wine;
    return acc;
  }, {});
  const rawBarIds = Array.isArray(result.recommended_bar_ids) ? result.recommended_bar_ids : (Array.isArray(result.bar_ids) ? result.bar_ids : []);
  const rawWineIds = Array.isArray(result.recommended_wine_ids) ? result.recommended_wine_ids : (Array.isArray(result.wine_ids) ? result.wine_ids : []);
  const barIds = Array.from(new Set(rawBarIds
    .map((id) => String(id || "").trim())
    .filter((id) => id && barMap[id]))).slice(0, 3);
  const wineIds = Array.from(new Set(rawWineIds
    .map((id) => String(id || "").trim())
    .filter((id) => id && wineMap[id]))).slice(0, 3);

  let intent = result.intent === "chat" ? "chitchat" : (VALID_INTENTS.includes(result.intent) ? result.intent : "chitchat");
  if (intent === "recommend") {
    intent = wineIds.length ? "recommend_wine" : "recommend_bar";
  }

  const explicitIntent = inferRecommendationIntent(userMessage);
  if (explicitIntent && intent === "chitchat") {
    intent = explicitIntent;
  }

  const finalWineIds = intent === "recommend_wine"
    ? (wineIds.length ? wineIds : pickFallbackWineIds(wines, userMessage))
    : [];

  return {
    intent,
    reply: normalizeReplyText(result.reply || "抱歉，我没太理解，能再说一次吗？"),
    recommended_bar_ids: intent === "recommend_bar" ? barIds : [],
    recommended_wine_ids: finalWineIds,
    follow_up_question: normalizeReplyText(result.follow_up_question || "")
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

async function getRecommendableWines() {
  const res = await db.collection(COLLECTIONS.WINE_TOPIC).limit(100).get();
  return unwrapList(res)
    .filter((item) => item && item.wine_id)
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
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

  const [sbti, bars, wines] = await Promise.all([
    getSbti(currentUser.openid),
    getActiveBars(),
    getRecommendableWines()
  ]);

  const session = sessionId
    ? await getSessionById(sessionId, currentUser._id)
    : await createSession(currentUser._id, userMessage.slice(0, 20) || "新对话", sbti);

  const history = (Array.isArray(session.messages) ? session.messages : [])
    .slice(-10)
    .map((item) => ({ role: item.role, content: item.content }))
    .filter((item) => item.content && ["user", "assistant"].includes(item.role));

  const { callLLM, safeParseAIJson } = getAIClient();
  const aiRaw = await callLLM(
    buildMainPrompt(sbti, bars, wines),
    history.concat({ role: "user", content: userMessage }),
    { temperature: 0.35 }
  );
  const parsed = normalizeAIResult(safeParseAIJson(aiRaw), bars, wines, userMessage);
  const barMap = bars.reduce((acc, bar) => {
    acc[bar.bar_id] = bar;
    return acc;
  }, {});
  const wineMap = wines.reduce((acc, wine) => {
    acc[wine.wine_id] = wine;
    return acc;
  }, {});
  const recommendedBars = parsed.recommended_bar_ids.map((id) => summarizeBar(barMap[id])).filter(Boolean);
  const recommendedWines = parsed.recommended_wine_ids.map((id) => summarizeWine(wineMap[id])).filter(Boolean);

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
      recommended_wine_ids: parsed.recommended_wine_ids,
      recommended_wines: recommendedWines,
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
    recommended_wine_ids: parsed.recommended_wine_ids,
    recommended_wines: recommendedWines,
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

async function ping() {
  return {
    ok: true,
    module: "ai",
    message: "AI handler loaded"
  };
}

async function testLLM(currentUser, payload) {
  // 云端测试没有登录态；currentUser 存在时仍按管理员/品酒师权限校验。
  if (currentUser) {
    requireRole(currentUser, [ROLE.ADMIN, ROLE.SOMMELIER]);
  }

  const { callLLM, getAIConfig } = getAIClient();
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
  ping,
  testLLM
};
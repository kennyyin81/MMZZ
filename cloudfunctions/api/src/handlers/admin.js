const {
  db,
  _,
  COLLECTIONS,
  ROLE,
  REQUEST_STATUS,
  INVITATION_STATUS,
  AppError,
  assert,
  now,
  unwrapList,
  unwrapDoc,
  unwrapInsertId,
  toInt,
  buildPagination,
  hasRole,
  requireRole,
  assertTextLength,
  makeRequestNo,
  getRequestMeta,
  briefUser,
  safeLogOperation,
  safeCreateNotification,
  getUserById,
  getBalanceByUserId,
  changePoints,
  countUnreadNotifications,
  getAssignedApplicantForApprover
} = require("../context");

const { sanitizeWineId, generateWineId, sortSimilarWineIdsBySimilarity } = require("./wine");

async function adminListWineTopics(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  let query = {};
  const keyword = String(payload.keyword || "").trim();
  if (keyword) {
    query.name = db.RegExp({ regexp: keyword, options: "i" });
  }
  const orderBy = String(payload.order_by || "name");
  const orderDir = String(payload.order_dir || "asc");
  const res = await db.collection(COLLECTIONS.WINE_TOPIC).where(query).orderBy(orderBy, orderDir === "desc" ? "desc" : "asc").get();
  return { list: unwrapList(res) };
}

async function adminUpsertWineTopic(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const name = assertTextLength(payload.name, "酒名", 50, true);
  // 如果没有提供 wine_id，则自动生成
  let wineId = sanitizeWineId(payload.wine_id);
  if (!wineId) {
    wineId = generateWineId(name);
  }
  const baseWine = {
    wine_id: wineId,
    name,
    category: assertTextLength(payload.category || "", "类别", 30, false),
    flavor: assertTextLength(payload.flavor || "", "风味标签", 80, false),
    base_spirit: assertTextLength(payload.base_spirit || "", "基酒", 30, false),
    acidity: toInt(payload.acidity, 0),
    sweetness: toInt(payload.sweetness, 0),
    bitterness: toInt(payload.bitterness, 0),
    spiciness: toInt(payload.spiciness, 0)
  };
  const sortedSimilarWineIds = await sortSimilarWineIdsBySimilarity(baseWine, payload.similar_wine_ids);
  const patch = {
    wine_id: wineId,
    name,
    category: baseWine.category,
    alcohol: assertTextLength(payload.alcohol || "", "酒精度", 20, false),
    flavor: baseWine.flavor,
    acidity: baseWine.acidity,
    sweetness: baseWine.sweetness,
    bitterness: baseWine.bitterness,
    spiciness: baseWine.spiciness,
      base_spirit: baseWine.base_spirit,
      ingredients: assertTextLength(payload.ingredients || payload.main_ingredients || "", "原料", 150, false),
      main_ingredients: assertTextLength(payload.ingredients || payload.main_ingredients || "", "原料", 150, false),
      keywords: "",
      taste_note: assertTextLength(payload.taste_note || "", "口感解读", 120, false),
      story: assertTextLength(payload.story || "", "背景故事", 200, false),
      similar_wine_ids: sortedSimilarWineIds,
      similar_recommendations: "",
      summary: assertTextLength(payload.summary || "", "一句话介绍", 100, false),
      image_url: String(payload.image_url || "").trim(),
      updated_at: now()
  };
  const existingRes = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: wineId }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  if (existing) {
    await db.collection(COLLECTIONS.WINE_TOPIC).doc(existing._id).update({ data: patch });
    return { wine_id: wineId, updated: true };
  }
  await db.collection(COLLECTIONS.WINE_TOPIC).add({ data: { ...patch, created_at: now() } });
  return { wine_id: wineId, created: true };
}

async function adminRemoveWineTopic(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const wineId = sanitizeWineId(payload.wine_id);
  const existingRes = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: wineId }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  assert(existing, 3001, "酒款不存在");
  await db.collection(COLLECTIONS.WINE_TOPIC).doc(existing._id).remove();
  return { success: true };
}

async function adminSearchUsers(currentUser, payload) {
  requireRole(currentUser, ROLE.ADMIN);
  const keyword = String(payload.keyword || "").trim();
  const where = keyword ? { nickname: db.RegExp({ regexp: keyword, options: "i" }) } : {};
  const res = await db.collection(COLLECTIONS.USER_PROFILE).where(where).limit(30).get();
  return { list: unwrapList(res) };
}

async function adminSetRoles(currentUser, payload) {
  requireRole(currentUser, ROLE.ADMIN);
  const userId = String(payload.user_id || "").trim();
  assert(userId, 2001, "user_id 不能为空");
  const roles = Array.isArray(payload.roles) ? Array.from(new Set(payload.roles.concat([ROLE.USER]))) : [ROLE.USER];
  await db.collection(COLLECTIONS.USER_PROFILE).doc(userId).update({
    data: {
      roles,
      updated_at: now()
    }
  });
  return { roles };
}

module.exports = {
  adminListWineTopics,
  adminUpsertWineTopic,
  adminRemoveWineTopic,
  adminSearchUsers,
  adminSetRoles
};

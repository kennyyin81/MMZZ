const {
  cloud,
  db,
  COLLECTIONS,
  assert,
  now,
  unwrapDoc,
  unwrapInsertId
} = require("../context");

async function getUserSbti(currentUser) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || (currentUser && currentUser.openid) || "";
  if (!openid) {
    return null;
  }
  try {
    const res = await db.collection(COLLECTIONS.USER_SBTI)
      .where({ user_id: openid })
      .limit(1)
      .get();
    return unwrapDoc(res);
  } catch (error) {
    console.error("getUserSbti error:", error);
    return null;
  }
}

async function initUserSbti(currentUser, payload) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || (currentUser && currentUser.openid) || "";
  assert(openid, 1001, "未登录");
  assert(Array.isArray(payload.taste_preferences) && payload.taste_preferences.length > 0, 2001, "口味偏好必填");
  assert(Array.isArray(payload.drink_types) && payload.drink_types.length > 0, 2001, "酒类偏好必填");
  assert(Array.isArray(payload.atmosphere) && payload.atmosphere.length > 0, 2001, "氛围偏好必填");
  assert(Array.isArray(payload.social_scene) && payload.social_scene.length > 0, 2001, "社交场景必填");
  const budgetAmount = Number(payload.budget_amount || payload.budget_level);
  assert(Number.isFinite(budgetAmount) && budgetAmount > 0, 2001, "预算金额必须大于 0");

  const nowTime = now();
  await db.collection(COLLECTIONS.USER_SBTI).where({ user_id: openid }).remove();
  const doc = {
    user_id: openid,
    taste_preferences: payload.taste_preferences,
    drink_types: payload.drink_types,
    atmosphere: payload.atmosphere,
    social_scene: payload.social_scene,
    budget_amount: budgetAmount,
    preferred_areas: [],
    avoid_tags: [],
    note: "",
    version: 1,
    created_at: nowTime,
    updated_at: nowTime
  };
  const addRes = await db.collection(COLLECTIONS.USER_SBTI).add({ data: doc });
  return { ...doc, _id: unwrapInsertId(addRes) };
}

module.exports = {
  getUserSbti,
  initUserSbti
};

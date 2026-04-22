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

function sanitizeWineId(value) {
  const text = String(value || "").trim();
  return text || null;
}

function generateWineId(name) {
  // 使用名称哈希 + 时间戳生成唯一 ID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `wine_${timestamp}_${random}`;
}

function normalizeWineKnowledge(payload) {
  if (Array.isArray(payload.knowledge)) {
    return payload.knowledge.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return [];
}

function normalizeStringList(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(/[\r\n、,，/|；;]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeWineIdList(value, currentWineId) {
  return normalizeStringList(value)
    .map((item) => sanitizeWineId(item))
    .filter((item) => item && item !== currentWineId)
    .slice(0, 20);
}

function getWineFlavorTags(value) {
  return normalizeStringList(value);
}

function getWineSimilarityScore(baseWine, candidateWine) {
  if (!candidateWine || !candidateWine.wine_id) return -1;
  const baseFlavorTags = getWineFlavorTags(baseWine.flavor);
  const candidateFlavorTags = getWineFlavorTags(candidateWine.flavor);
  const baseFlavorSet = new Set(baseFlavorTags);
  const overlapCount = candidateFlavorTags.filter((item) => baseFlavorSet.has(item)).length;
  const unionCount = new Set(baseFlavorTags.concat(candidateFlavorTags)).size || 1;
  const flavorScore = overlapCount ? Math.round((overlapCount / unionCount) * 100) : 0;
  const categoryScore = baseWine.category && candidateWine.category && baseWine.category === candidateWine.category ? 20 : 0;
  const baseSpiritScore = baseWine.base_spirit && candidateWine.base_spirit && baseWine.base_spirit === candidateWine.base_spirit ? 12 : 0;
  const tasteScore = ["acidity", "sweetness", "bitterness", "spiciness"].reduce((sum, key) => {
    const diff = Math.abs(Number(baseWine[key] || 0) - Number(candidateWine[key] || 0));
    return sum + (4 - diff);
  }, 0);
  return flavorScore * 100 + categoryScore * 10 + baseSpiritScore * 10 + tasteScore;
}

async function sortSimilarWineIdsBySimilarity(baseWine, similarWineIds) {
  const ids = normalizeWineIdList(similarWineIds, baseWine.wine_id);
  if (!ids.length) return [];
  const wineRes = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: _.in(ids) }).get();
  const wineMap = unwrapList(wineRes).reduce((acc, item) => {
    if (item && item.wine_id) acc[item.wine_id] = item;
    return acc;
  }, {});
  return ids
    .map((id) => wineMap[id])
    .filter(Boolean)
    .sort((a, b) => {
      const scoreDiff = getWineSimilarityScore(baseWine, b) - getWineSimilarityScore(baseWine, a);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    })
    .map((item) => item.wine_id)
    .slice(0, 3);
}

async function getWineCommentStats(wineId) {
  const commentRes = await db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: wineId }).get();
  const list = unwrapList(commentRes);
  const count = list.length;
  const totalRating = list.reduce((sum, item) => sum + Number(item.rating || 0), 0);
  return {
    rating_count: count,
    average_rating: count ? Number((totalRating / count).toFixed(1)) : 0
  };
}

async function getWineStatsMap(wineIds) {
  const ids = Array.from(new Set((Array.isArray(wineIds) ? wineIds : []).filter(Boolean)));
  if (!ids.length) return {};
  const commentRes = await db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: _.in(ids) }).get();
  const statsMap = {};
  unwrapList(commentRes).forEach((item) => {
    if (!statsMap[item.wine_id]) {
      statsMap[item.wine_id] = { rating_count: 0, total_rating: 0, comment_count: 0 };
    }
    statsMap[item.wine_id].rating_count += 1;
    statsMap[item.wine_id].total_rating += Number(item.rating || 0);
    if (String(item.content || "").trim()) {
      statsMap[item.wine_id].comment_count += 1;
    }
  });
  Object.keys(statsMap).forEach((wineId) => {
    const stats = statsMap[wineId];
    stats.average_rating = stats.rating_count ? Number((stats.total_rating / stats.rating_count).toFixed(1)) : 0;
    delete stats.total_rating;
  });
  return statsMap;
}

async function listWineTopics(currentUser) {
  const res = await db.collection(COLLECTIONS.WINE_TOPIC).orderBy("created_at", "desc").get();
  const raw = unwrapList(res).filter((item) => item && item.wine_id);
  
  if (!raw.length) {
    return { total: 0, list: [] };
  }

  const wineIds = raw.map((item) => item.wine_id);
  const statsMap = await getWineStatsMap(wineIds);

  // 组装结果
  const list = raw.map((topic) => {
    const stats = statsMap[topic.wine_id] || { rating_count: 0, average_rating: 0, comment_count: 0 };
    return {
      ...topic,
      average_rating: stats.average_rating,
      rating_count: stats.rating_count,
      comment_count: stats.comment_count
    };
  });

  return { total: list.length, list };
}

async function getWineTopicDetail(currentUser, payload) {
  const wineId = sanitizeWineId(payload.wine_id);
  const res = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: wineId }).limit(1).get();
  const topic = unwrapDoc(res);
  assert(topic, 3001, "酒款不存在");

  // 获取评论数据
  const commentRes = await db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: wineId }).get();
  const comments = unwrapList(commentRes);
  const ratingCount = comments.length;
  const totalRating = comments.reduce((sum, item) => sum + Number(item.rating || 0), 0);
  const averageRating = ratingCount ? Number((totalRating / ratingCount).toFixed(1)) : 0;
  const commentCount = comments.filter((item) => String(item.content || "").trim()).length;
  const favorite = await db.collection(COLLECTIONS.WINE_FAVORITE).where({ user_id: currentUser._id, wine_id: wineId }).limit(1).get().then(unwrapDoc);
  let similarWines = [];

  const similarWineIds = normalizeWineIdList(topic.similar_wine_ids, wineId);
  if (similarWineIds.length) {
    const [similarRes, similarStatsMap] = await Promise.all([
      db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: _.in(similarWineIds) }).get(),
      getWineStatsMap(similarWineIds)
    ]);
    const similarMap = unwrapList(similarRes).reduce((acc, item) => {
      if (item && item.wine_id) acc[item.wine_id] = item;
      return acc;
    }, {});
    similarWines = similarWineIds
      .map((item) => similarMap[item])
      .filter(Boolean)
      .map((item) => {
        const stats = similarStatsMap[item.wine_id] || { average_rating: 0, rating_count: 0, comment_count: 0 };
        return {
          wine_id: item.wine_id,
          name: item.name || "",
          category: item.category || "",
          alcohol: item.alcohol || "",
          image_url: item.image_url || "",
          average_rating: stats.average_rating,
          rating_count: stats.rating_count
        };
      });
  }

  return {
    wine: {
      ...topic,
      is_favorited: !!favorite,
      similar_wines: similarWines,
      average_rating: averageRating,
      rating_count: ratingCount,
      comment_count: commentCount
    }
  };
}

async function createWineComment(currentUser, payload) {
  const wineId = sanitizeWineId(payload.wine_id);
  const content = String(payload.content || "").trim();
  const rating = toInt(payload.rating, 0);
  assert(rating >= 1 && rating <= 5, 2001, "评分必须在1到5之间");
  const existed = await db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: wineId, user_id: currentUser._id }).limit(1).get();
  const existing = unwrapDoc(existed);
  if (existing) {
    await db.collection(COLLECTIONS.WINE_COMMENT).doc(existing._id).update({
      data: {
        content,
        rating
      }
    });
    return { comment_id: existing._id, updated: true };
  }
  const addRes = await db.collection(COLLECTIONS.WINE_COMMENT).add({
    data: {
      wine_id: wineId,
      user_id: currentUser._id,
      content,
      rating,
      created_at: now()
    }
  });
  return { comment_id: unwrapInsertId(addRes) };
}

async function upsertWineRating(currentUser, payload) {
  const wineId = sanitizeWineId(payload.wine_id);
  const rating = toInt(payload.rating, 0);
  assert(rating >= 1 && rating <= 5, 2001, "评分必须在1到5之间");
  const existed = await db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: wineId, user_id: currentUser._id }).limit(1).get();
  const existing = unwrapDoc(existed);
  if (existing) {
    await db.collection(COLLECTIONS.WINE_COMMENT).doc(existing._id).update({
      data: {
        rating
      }
    });
    return { comment_id: existing._id, updated: true };
  }
  const addRes = await db.collection(COLLECTIONS.WINE_COMMENT).add({
    data: {
      wine_id: wineId,
      user_id: currentUser._id,
      content: "",
      rating,
      created_at: now()
    }
  });
  return { comment_id: unwrapInsertId(addRes), created: true };
}

async function removeWineComment(currentUser, payload) {
  const commentId = String(payload.comment_id || "").trim();
  assert(commentId, 2001, "comment_id 不能为空");
  const comment = await db.collection(COLLECTIONS.WINE_COMMENT).doc(commentId).get().then(unwrapDoc);
  assert(comment, 3001, "评论不存在");
  assert(comment.user_id === currentUser._id, 1002, "只能删除自己的评论");
  await db.collection(COLLECTIONS.WINE_COMMENT).doc(commentId).remove();
  return { success: true };
}

async function toggleWineFavorite(currentUser, payload) {
  const wineId = sanitizeWineId(payload.wine_id);
  const wine = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: wineId }).limit(1).get().then(unwrapDoc);
  assert(wine, 3001, "酒款不存在");

  const existing = await db.collection(COLLECTIONS.WINE_FAVORITE)
    .where({ user_id: currentUser._id, wine_id: wineId })
    .limit(1)
    .get()
    .then(unwrapDoc);

  if (existing) {
    await db.collection(COLLECTIONS.WINE_FAVORITE).doc(existing._id).remove();
    return { wine_id: wineId, is_favorited: false };
  }

  await db.collection(COLLECTIONS.WINE_FAVORITE).add({
    data: {
      user_id: currentUser._id,
      wine_id: wineId,
      created_at: now()
    }
  });
  return { wine_id: wineId, is_favorited: true };
}

async function listMyFavoriteWines(currentUser, payload) {
  const pager = buildPagination(payload);
  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.WINE_FAVORITE).where({ user_id: currentUser._id }).count(),
    db.collection(COLLECTIONS.WINE_FAVORITE)
      .where({ user_id: currentUser._id })
      .orderBy("created_at", "desc")
      .skip(pager.skip)
      .limit(pager.limit)
      .get()
  ]);

  const favorites = unwrapList(listRes);
  const wineIds = favorites.map((item) => item.wine_id).filter(Boolean);
  if (!wineIds.length) {
    return { total: Number((countRes && countRes.total) || 0), list: [] };
  }

  const [wineRes, statsMap] = await Promise.all([
    db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: _.in(wineIds) }).get(),
    getWineStatsMap(wineIds)
  ]);
  const wineMap = unwrapList(wineRes).reduce((acc, item) => {
    if (item && item.wine_id) acc[item.wine_id] = item;
    return acc;
  }, {});

  const list = favorites
    .map((item) => {
      const wine = wineMap[item.wine_id];
      if (!wine) return null;
      const stats = statsMap[item.wine_id] || { rating_count: 0, average_rating: 0, comment_count: 0 };
      return {
        ...wine,
        favorite_id: item._id,
        favorite_created_at: item.created_at,
        is_favorited: true,
        rating_count: stats.rating_count,
        average_rating: stats.average_rating,
        comment_count: stats.comment_count
      };
    })
    .filter(Boolean);

  return {
    total: Number((countRes && countRes.total) || 0),
    list
  };
}

async function listWineComments(currentUser, payload) {
  const wineId = sanitizeWineId(payload.wine_id);
  const pager = buildPagination(payload);
  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: wineId }).count(),
    db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: wineId }).orderBy("created_at", "desc").skip(pager.skip).limit(pager.limit).get()
  ]);
  const list = unwrapList(listRes);
  const userIds = Array.from(new Set(list.map((item) => item.user_id).filter(Boolean)));
  let userMap = {};
  if (userIds.length) {
    const userRes = await db.collection(COLLECTIONS.USER_PROFILE).where({ _id: _.in(userIds) }).get();
    userMap = unwrapList(userRes).reduce((acc, item) => {
      acc[item._id] = item;
      return acc;
    }, {});
  }
  return {
    total: Number((countRes && countRes.total) || 0),
    list: list.map((item) => ({
      ...item,
      nickname: (userMap[item.user_id] && userMap[item.user_id].nickname) || "微信用户",
      avatar_url: (userMap[item.user_id] && userMap[item.user_id].avatar_url) || "",
      is_owner: item.user_id === currentUser._id
    }))
  };
}

module.exports = {
  sanitizeWineId,
  generateWineId,
  normalizeWineKnowledge,
  normalizeStringList,
  normalizeWineIdList,
  getWineFlavorTags,
  getWineSimilarityScore,
  sortSimilarWineIdsBySimilarity,
  getWineCommentStats,
  getWineStatsMap,
  listWineTopics,
  getWineTopicDetail,
  createWineComment,
  upsertWineRating,
  removeWineComment,
  toggleWineFavorite,
  listMyFavoriteWines,
  listWineComments
};

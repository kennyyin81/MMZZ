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

function getIngredientTags(value) {
  return normalizeStringList(value);
}

function getWineSimilarityScore(baseWine, candidateWine) {
  if (!candidateWine || !candidateWine.wine_id) return -1;
  if (baseWine.wine_id && candidateWine.wine_id && baseWine.wine_id === candidateWine.wine_id) return -1;

  // 1. 风味标签 Jaccard 相似度（权重最高）
  const baseFlavorTags = getWineFlavorTags(baseWine.flavor);
  const candidateFlavorTags = getWineFlavorTags(candidateWine.flavor);
  const baseFlavorSet = new Set(baseFlavorTags);
  const flavorOverlap = candidateFlavorTags.filter((item) => baseFlavorSet.has(item)).length;
  const flavorUnion = new Set(baseFlavorTags.concat(candidateFlavorTags)).size || 1;
  const flavorScore = flavorOverlap ? Math.round((flavorOverlap / flavorUnion) * 100) : 0;

  // 2. 类别匹配
  const categoryScore = baseWine.category && candidateWine.category && baseWine.category === candidateWine.category ? 20 : 0;

  // 3. 基酒匹配
  const baseSpiritScore = baseWine.base_spirit && candidateWine.base_spirit && baseWine.base_spirit === candidateWine.base_spirit ? 12 : 0;

  // 4. 原料 Jaccard 相似度
  const baseIngTags = getIngredientTags(baseWine.ingredients || baseWine.main_ingredients);
  const candidateIngTags = getIngredientTags(candidateWine.ingredients || candidateWine.main_ingredients);
  const baseIngSet = new Set(baseIngTags);
  const ingOverlap = candidateIngTags.filter((item) => baseIngSet.has(item)).length;
  const ingUnion = new Set(baseIngTags.concat(candidateIngTags)).size || 1;
  const ingredientScore = ingOverlap ? Math.round((ingOverlap / ingUnion) * 100) : 0;

  // 5. 口感维度相似度（差值越小越相似）
  const tasteScore = ["acidity", "sweetness", "bitterness", "spiciness"].reduce((sum, key) => {
    const diff = Math.abs(Number(baseWine[key] || 0) - Number(candidateWine[key] || 0));
    return sum + (4 - diff);
  }, 0);

  return flavorScore * 100 + categoryScore * 10 + baseSpiritScore * 10 + ingredientScore * 50 + tasteScore;
}

function chunkList(list, size) {
  const result = [];
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size));
  }
  return result;
}

async function fetchAllWineTopics() {
  const limit = 100;
  let skip = 0;
  let list = [];

  while (true) {
    const res = await db.collection(COLLECTIONS.WINE_TOPIC)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get();
    const batch = unwrapList(res);
    list = list.concat(batch);
    if (batch.length < limit) break;
    skip += limit;
  }

  return list;
}

async function fetchCommentsByWineIds(wineIds) {
  const ids = Array.from(new Set((Array.isArray(wineIds) ? wineIds : []).filter(Boolean)));
  if (!ids.length) return [];

  const chunks = chunkList(ids, 20);
  let comments = [];

  for (const chunk of chunks) {
    const limit = 100;
    let skip = 0;
    while (true) {
      const res = await db.collection(COLLECTIONS.WINE_COMMENT)
        .where({ wine_id: _.in(chunk) })
        .skip(skip)
        .limit(limit)
        .get();
      const batch = unwrapList(res);
      comments = comments.concat(batch);
      if (batch.length < limit) break;
      skip += limit;
    }
  }

  return comments;
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
  const comments = await fetchCommentsByWineIds(ids);
  const statsMap = {};
  comments.forEach((item) => {
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

function parseAlcoholValue(alcohol) {
  const text = String(alcohol || "");
  const match = text.match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function filterAndSortWineTopics(list, payload, statsMap, favCountMap) {
  const tasteFilterInput = String(payload.taste_filter || "all").trim();
  const ratingOrderInput = String(payload.rating_order || "none").trim();
  const alcoholOrderInput = String(payload.alcohol_order || "none").trim();
  const favoriteOrderInput = String(payload.favorite_order || "none").trim();
  const keyword = String(payload.keyword || "").trim().toLowerCase();
  const tasteFilter = ["all", "acidity", "sweetness", "bitterness", "spiciness"].includes(tasteFilterInput) ? tasteFilterInput : "all";
  const ratingOrder = ["none", "asc", "desc"].includes(ratingOrderInput) ? ratingOrderInput : "none";
  const alcoholOrder = ["none", "asc", "desc"].includes(alcoholOrderInput) ? alcoholOrderInput : "none";
  const favoriteOrder = ["none", "asc", "desc"].includes(favoriteOrderInput) ? favoriteOrderInput : "none";
  let result = Array.isArray(list) ? list.slice() : [];

  if (keyword) {
    result = result.filter((item) => String(item.name || "").toLowerCase().includes(keyword));
  }

  if (tasteFilter && tasteFilter !== "all") {
    result = result.filter((item) => Number(item[tasteFilter] || 0) >= 3);
  }

  if (ratingOrder !== "none" || alcoholOrder !== "none" || favoriteOrder !== "none") {
    result.sort((a, b) => {
      if (favoriteOrder !== "none") {
        const aFav = Number((favCountMap && favCountMap[a.wine_id]) || 0);
        const bFav = Number((favCountMap && favCountMap[b.wine_id]) || 0);
        const favDiff = aFav - bFav;
        if (favDiff !== 0) {
          return favoriteOrder === "asc" ? favDiff : -favDiff;
        }
      }
      if (ratingOrder !== "none") {
        const aStats = statsMap[a.wine_id] || {};
        const bStats = statsMap[b.wine_id] || {};
        const ratingDiff = Number(aStats.average_rating || 0) - Number(bStats.average_rating || 0);
        if (ratingDiff !== 0) {
          return ratingOrder === "asc" ? ratingDiff : -ratingDiff;
        }
      }
      if (alcoholOrder !== "none") {
        const alcoholDiff = parseAlcoholValue(a.alcohol) - parseAlcoholValue(b.alcohol);
        if (alcoholDiff !== 0) {
          return alcoholOrder === "asc" ? alcoholDiff : -alcoholDiff;
        }
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  return result;
}

async function listWineTopics(currentUser, payload) {
  const pager = buildPagination(payload || {});
  const raw = (await fetchAllWineTopics()).filter((item) => item && item.wine_id);
  
  if (!raw.length) {
    return { total: 0, page_no: pager.pageNo, page_size: pager.pageSize, has_more: false, list: [] };
  }

  const wineIds = raw.map((item) => item.wine_id);
  const statsMap = await getWineStatsMap(wineIds);

  // Build favorite count map
  const favCountMap = {};
  const favRes = await db.collection(COLLECTIONS.WINE_FAVORITE).where({ wine_id: _.in(wineIds) }).field({ wine_id: true }).get();
  (unwrapList(favRes) || []).forEach((item) => {
    favCountMap[item.wine_id] = (favCountMap[item.wine_id] || 0) + 1;
  });

  const filtered = filterAndSortWineTopics(raw, payload || {}, statsMap, favCountMap);
  const pageList = filtered.slice(pager.skip, pager.skip + pager.limit);

  const list = pageList.map((topic) => {
    const stats = statsMap[topic.wine_id] || { rating_count: 0, average_rating: 0, comment_count: 0 };
    return {
      ...topic,
      average_rating: stats.average_rating,
      rating_count: stats.rating_count,
      comment_count: stats.comment_count,
      favorite_count: favCountMap[topic.wine_id] || 0
    };
  });

  return {
    total: filtered.length,
    page_no: pager.pageNo,
    page_size: pager.pageSize,
    has_more: pager.skip + pager.limit < filtered.length,
    list
  };
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

async function computeAndSaveSimilarWines(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);

  const allWines = await fetchAllWineTopics();
  const validWines = allWines.filter((item) => item && item.wine_id);

  if (!validWines.length) {
    return { total: 0, updated: 0 };
  }

  // 预计算每款酒的相似度排名
  const updates = [];
  for (const base of validWines) {
    const scored = validWines
      .map((candidate) => ({
        wine_id: candidate.wine_id,
        score: getWineSimilarityScore(base, candidate)
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || String(a.wine_id).localeCompare(String(b.wine_id), "zh-CN"));

    const top3 = scored.slice(0, 3).map((item) => item.wine_id);

    const currentIds = normalizeWineIdList(base.similar_wine_ids, base.wine_id);
    const changed = top3.length !== currentIds.length || top3.some((id, i) => id !== currentIds[i]);

    if (changed) {
      updates.push({ _id: base._id, similar_wine_ids: top3 });
    }
  }

  // 分批并行写入数据库（每批5条）
  let updatedCount = 0;
  const batchSize = 5;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((item) =>
        db.collection(COLLECTIONS.WINE_TOPIC).doc(item._id).update({
          data: { similar_wine_ids: item.similar_wine_ids, updated_at: now() }
        })
      )
    );
    updatedCount += results.filter((r) => r.status === "fulfilled").length;
  }

  return { total: validWines.length, updated: updatedCount };
}

module.exports = {
  sanitizeWineId,
  generateWineId,
  normalizeWineKnowledge,
  normalizeStringList,
  normalizeWineIdList,
  getWineFlavorTags,
  getIngredientTags,
  getWineSimilarityScore,
  chunkList,
  fetchAllWineTopics,
  fetchCommentsByWineIds,
  sortSimilarWineIdsBySimilarity,
  getWineCommentStats,
  getWineStatsMap,
  parseAlcoholValue,
  filterAndSortWineTopics,
  computeAndSaveSimilarWines,
  listWineTopics,
  getWineTopicDetail,
  createWineComment,
  upsertWineRating,
  removeWineComment,
  toggleWineFavorite,
  listMyFavoriteWines,
  listWineComments
};

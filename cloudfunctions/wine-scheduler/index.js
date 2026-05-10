const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const WINE_TOPIC = "wine_topic";

function normalizeStringList(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(/[\r\n、,，/|；;]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function getWineSimilarityScore(baseWine, candidateWine) {
  if (!candidateWine || !candidateWine.wine_id) return -1;
  if (baseWine.wine_id && candidateWine.wine_id && baseWine.wine_id === candidateWine.wine_id) return -1;

  // 1. 风味标签 Jaccard 相似度
  const baseFlavorTags = normalizeStringList(baseWine.flavor);
  const candidateFlavorTags = normalizeStringList(candidateWine.flavor);
  const baseFlavorSet = new Set(baseFlavorTags);
  const flavorOverlap = candidateFlavorTags.filter((item) => baseFlavorSet.has(item)).length;
  const flavorUnion = new Set(baseFlavorTags.concat(candidateFlavorTags)).size || 1;
  const flavorScore = flavorOverlap ? Math.round((flavorOverlap / flavorUnion) * 100) : 0;

  // 2. 类别匹配
  const categoryScore = baseWine.category && candidateWine.category && baseWine.category === candidateWine.category ? 20 : 0;

  // 3. 基酒匹配
  const baseSpiritScore = baseWine.base_spirit && candidateWine.base_spirit && baseWine.base_spirit === candidateWine.base_spirit ? 12 : 0;

  // 4. 原料 Jaccard 相似度
  const baseIngTags = normalizeStringList(baseWine.ingredients || baseWine.main_ingredients);
  const candidateIngTags = normalizeStringList(candidateWine.ingredients || candidateWine.main_ingredients);
  const baseIngSet = new Set(baseIngTags);
  const ingOverlap = candidateIngTags.filter((item) => baseIngSet.has(item)).length;
  const ingUnion = new Set(baseIngTags.concat(candidateIngTags)).size || 1;
  const ingredientScore = ingOverlap ? Math.round((ingOverlap / ingUnion) * 100) : 0;

  // 5. 口感维度相似度
  const tasteScore = ["acidity", "sweetness", "bitterness", "spiciness"].reduce((sum, key) => {
    const diff = Math.abs(Number(baseWine[key] || 0) - Number(candidateWine[key] || 0));
    return sum + (4 - diff);
  }, 0);

  return flavorScore * 100 + categoryScore * 10 + baseSpiritScore * 10 + ingredientScore * 50 + tasteScore;
}

async function fetchAllWineTopics() {
  const limit = 100;
  let skip = 0;
  let list = [];

  while (true) {
    const res = await db.collection(WINE_TOPIC)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get();
    const batch = res.data || [];
    list = list.concat(batch);
    if (batch.length < limit) break;
    skip += limit;
  }

  return list;
}

function normalizeWineIdList(value, currentWineId) {
  return normalizeStringList(value)
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== currentWineId);
}

async function computeAndSaveSimilarWines() {
  const allWines = await fetchAllWineTopics();
  const validWines = allWines.filter((item) => item && item.wine_id);

  if (!validWines.length) {
    return { total: 0, updated: 0 };
  }

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

  let updatedCount = 0;
  const batchSize = 5;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((item) =>
        db.collection(WINE_TOPIC).doc(item._id).update({
          data: { similar_wine_ids: item.similar_wine_ids, updated_at: new Date() }
        })
      )
    );
    updatedCount += results.filter((r) => r.status === "fulfilled").length;
  }

  return { total: validWines.length, updated: updatedCount };
}

exports.main = async (event, context) => {
  const result = await computeAndSaveSimilarWines();
  console.log("wine-scheduler result:", JSON.stringify(result));
  return result;
};

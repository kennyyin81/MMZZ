const {
  db,
  COLLECTIONS,
  assert,
  unwrapList,
  unwrapDoc,
  buildPagination
} = require("../context");

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\r\n、,，/|；;]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeBar(bar) {
  return {
    ...bar,
    drink_types: normalizeStringList(bar.drink_types),
    taste_tags: normalizeStringList(bar.taste_tags),
    atmosphere_tags: normalizeStringList(bar.atmosphere_tags),
    scene_tags: normalizeStringList(bar.scene_tags),
    avg_price: Number(bar.avg_price || 0),
    budget_level: Number(bar.budget_level || 0),
    rating: Number(bar.rating || 0),
    latitude: Number(bar.latitude || 0),
    longitude: Number(bar.longitude || 0),
    images: Array.isArray(bar.images) ? bar.images : []
  };
}

async function fetchActiveBars() {
  const res = await db.collection(COLLECTIONS.BAR_INFO).where({ is_active: true }).limit(100).get();
  return unwrapList(res).filter((item) => item && item.bar_id).map(normalizeBar);
}

async function listBars(currentUser, payload) {
  const pager = buildPagination(payload || {});
  const area = String(payload.area || "").trim();
  const keyword = String(payload.keyword || "").trim().toLowerCase();
  let all = await fetchActiveBars();

  if (area) {
    all = all.filter((item) => String(item.area || "").includes(area));
  }
  if (keyword) {
    all = all.filter((item) => `${item.name || ""} ${item.area || ""} ${item.bar_type || ""}`.toLowerCase().includes(keyword));
  }

  all.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
  const list = all.slice(pager.skip, pager.skip + pager.limit);

  return {
    list,
    total: all.length,
    page_no: pager.pageNo,
    page_size: pager.pageSize,
    has_more: pager.skip + list.length < all.length
  };
}

async function getBarDetail(currentUser, payload) {
  const barId = String(payload.bar_id || "").trim();
  assert(barId, 2001, "bar_id 不能为空");
  const res = await db.collection(COLLECTIONS.BAR_INFO).where({ bar_id: barId, is_active: true }).limit(1).get();
  const bar = unwrapDoc(res);
  assert(bar, 3001, "酒馆不存在或已下架");
  return { bar: normalizeBar(bar) };
}

module.exports = {
  listBars,
  getBarDetail
};

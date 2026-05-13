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
  assertTextLength,
  toInt
} = require("../context");

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\r\n、,，/|；;]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function sanitizeBarId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function generateBarId(name) {
  const base = sanitizeBarId(name);
  return base || `bar-${Date.now()}`;
}

function compactText() {
  return Array.from(arguments)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function inferProvince(bar) {
  const explicit = String(bar.province || "").trim();
  if (explicit) return explicit;
  const text = compactText(bar.area, bar.address);
  const match = text.match(/([\u4e00-\u9fa5]{2,}(?:省|自治区|特别行政区))/);
  if (match) return match[1];
  if (/北京/.test(text)) return "北京市";
  if (/上海/.test(text)) return "上海市";
  if (/天津/.test(text)) return "天津市";
  if (/重庆/.test(text)) return "重庆市";
  if (/广州|深圳|佛山|东莞|珠海|惠州|中山/.test(text)) return "广东省";
  return "";
}

function inferCity(bar) {
  const explicit = String(bar.city || "").trim();
  if (explicit) return explicit;
  const text = compactText(bar.area, bar.address);
  const cityMatch = text.match(/([\u4e00-\u9fa5]{2,}市)/);
  if (cityMatch) return cityMatch[1];
  const knownCities = ["广州", "深圳", "佛山", "东莞", "珠海", "惠州", "中山", "北京", "上海", "天津", "重庆"];
  const found = knownCities.find((city) => text.includes(city));
  return found ? `${found}市` : "";
}

function normalizeBar(bar) {
  const province = inferProvince(bar);
  const city = inferCity(bar);
  return {
    ...bar,
    province,
    city,
    drink_types: normalizeStringList(bar.drink_types),
    taste_tags: normalizeStringList(bar.taste_tags),
    atmosphere_tags: normalizeStringList(bar.atmosphere_tags),
    scene_tags: normalizeStringList(bar.scene_tags),
    avg_price: Number(bar.avg_price || 0),
    budget_level: Number(bar.budget_level || 0),
    rating: Number(bar.average_rating || bar.rating || 0),
    average_rating: Number(bar.average_rating || bar.rating || 0),
    rating_count: Number(bar.rating_count || 0),
    latitude: Number(bar.latitude || 0),
    longitude: Number(bar.longitude || 0),
    images: Array.isArray(bar.images) ? bar.images : []
  };
}

async function fetchActiveBars() {
  const res = await db.collection(COLLECTIONS.BAR_INFO).where({ is_active: true }).limit(100).get();
  return unwrapList(res).filter((item) => item && item.bar_id).map(normalizeBar);
}

async function adminListBars(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const keyword = String(payload.keyword || "").trim().toLowerCase();
  const res = await db.collection(COLLECTIONS.BAR_INFO).limit(1000).get();
  let list = unwrapList(res).filter((item) => item && item.bar_id).map(normalizeBar);
  if (keyword) {
    list = list.filter((item) => compactText(
      item.name,
      item.province,
      item.city,
      item.area,
      item.address,
      item.bar_type
    ).toLowerCase().includes(keyword));
  }
  list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
  return { list };
}

async function adminUpsertBar(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const name = assertTextLength(payload.name, "酒馆名", 60, true);
  let barId = sanitizeBarId(payload.bar_id);
  if (!barId) {
    barId = generateBarId(name);
  }
  const imageUrl = String(payload.image_url || "").trim();
  const images = normalizeStringList(payload.images);
  if (imageUrl && !images.includes(imageUrl)) {
    images.unshift(imageUrl);
  }
  const patch = {
    bar_id: barId,
    name,
    province: assertTextLength(payload.province || "", "省份", 30, false),
    city: assertTextLength(payload.city || "", "城市", 30, false),
    area: assertTextLength(payload.area || "", "区域", 60, false),
    address: assertTextLength(payload.address || "", "地址", 120, false),
    latitude: Number(payload.latitude || 0),
    longitude: Number(payload.longitude || 0),
    phone: assertTextLength(payload.phone || "", "电话", 30, false),
    business_hours: assertTextLength(payload.business_hours || "", "营业时间", 80, false),
    avg_price: toInt(payload.avg_price, 0),
    budget_level: toInt(payload.budget_level, 0),
    bar_type: assertTextLength(payload.bar_type || "", "酒馆类型", 40, false),
    drink_types: normalizeStringList(payload.drink_types),
    taste_tags: normalizeStringList(payload.taste_tags),
    atmosphere_tags: normalizeStringList(payload.atmosphere_tags),
    scene_tags: normalizeStringList(payload.scene_tags),
    highlights: assertTextLength(payload.highlights || "", "推荐亮点", 200, false),
    description: assertTextLength(payload.description || "", "介绍", 500, false),
    image_url: imageUrl,
    images,
    is_active: payload.is_active === false ? false : true,
    updated_at: now()
  };
  if (!Number.isFinite(patch.latitude)) patch.latitude = 0;
  if (!Number.isFinite(patch.longitude)) patch.longitude = 0;

  const existingRes = await db.collection(COLLECTIONS.BAR_INFO).where({ bar_id: barId }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  if (existing) {
    await db.collection(COLLECTIONS.BAR_INFO).doc(existing._id).update({ data: patch });
    return { bar_id: barId, updated: true };
  }
  await db.collection(COLLECTIONS.BAR_INFO).add({
    data: Object.assign({}, patch, {
      rating: 0,
      average_rating: 0,
      rating_count: 0,
      created_at: now()
    })
  }).then(unwrapInsertId);
  return { bar_id: barId, created: true };
}

async function adminRemoveBar(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const barId = String(payload.bar_id || "").trim();
  assert(barId, 2001, "bar_id 不能为空");
  const existingRes = await db.collection(COLLECTIONS.BAR_INFO).where({ bar_id: barId }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  assert(existing, 3001, "酒馆不存在");
  await db.collection(COLLECTIONS.BAR_INFO).doc(existing._id).update({
    data: {
      is_active: false,
      updated_at: now()
    }
  });
  return { success: true };
}

async function listBars(currentUser, payload) {
  const pager = buildPagination(payload || {});
  const area = String(payload.area || "").trim();
  const province = String(payload.province || "").trim();
  const city = String(payload.city || "").trim();
  const keyword = String(payload.keyword || "").trim().toLowerCase();
  let all = await fetchActiveBars();
  const provinceOptions = Array.from(new Set(all.map((item) => item.province).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const cityOptions = Array.from(new Set(all
    .filter((item) => !province || item.province === province)
    .map((item) => item.city)
    .filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));

  if (province) {
    all = all.filter((item) => item.province === province);
  }
  if (city) {
    all = all.filter((item) => item.city === city);
  }
  if (area) {
    all = all.filter((item) => compactText(item.province, item.city, item.area, item.address).includes(area));
  }
  if (keyword) {
    all = all.filter((item) => compactText(item.name, item.province, item.city, item.area, item.address, item.bar_type).toLowerCase().includes(keyword));
  }

  all.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
  const list = all.slice(pager.skip, pager.skip + pager.limit);

  return {
    list,
    total: all.length,
    page_no: pager.pageNo,
    page_size: pager.pageSize,
    has_more: pager.skip + list.length < all.length,
    province_options: provinceOptions,
    city_options: cityOptions
  };
}

async function getBarDetail(currentUser, payload) {
  const barId = String(payload.bar_id || "").trim();
  assert(barId, 2001, "bar_id 不能为空");
  const res = await db.collection(COLLECTIONS.BAR_INFO).where({ bar_id: barId, is_active: true }).limit(1).get();
  const bar = unwrapDoc(res);
  assert(bar, 3001, "酒馆不存在或已下架");
  const normalized = normalizeBar(bar);
  if (currentUser) {
    const ratingRes = await db.collection(COLLECTIONS.BAR_RATING).where({
      bar_id: barId,
      user_id: currentUser._id
    }).limit(1).get();
    const myRating = unwrapDoc(ratingRes);
    normalized.my_rating = Number((myRating && myRating.rating) || 0);
  }
  return { bar: normalized };
}

async function computeBarRatingStats(barId) {
  const res = await db.collection(COLLECTIONS.BAR_RATING).where({ bar_id: barId }).limit(1000).get();
  const ratings = unwrapList(res).map((item) => Number(item.rating || 0)).filter((rating) => rating > 0);
  const ratingCount = ratings.length;
  const averageRating = ratingCount ? ratings.reduce((sum, rating) => sum + rating, 0) / ratingCount : 0;
  return {
    average_rating: Number(averageRating.toFixed(2)),
    rating_count: ratingCount
  };
}

async function upsertBarRating(currentUser, payload) {
  assert(currentUser, 1001, "未登录");
  const barId = String(payload.bar_id || "").trim();
  const rating = Number(payload.rating || 0);
  assert(barId, 2001, "bar_id 不能为空");
  assert(Number.isFinite(rating) && rating >= 1 && rating <= 5, 2001, "评分必须在 1 到 5 之间");

  const barRes = await db.collection(COLLECTIONS.BAR_INFO).where({ bar_id: barId, is_active: true }).limit(1).get();
  const bar = unwrapDoc(barRes);
  assert(bar, 3001, "酒馆不存在或已下架");

  const existingRes = await db.collection(COLLECTIONS.BAR_RATING).where({
    bar_id: barId,
    user_id: currentUser._id
  }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  if (existing) {
    await db.collection(COLLECTIONS.BAR_RATING).doc(existing._id).update({
      data: {
        rating,
        updated_at: now()
      }
    });
  } else {
    await db.collection(COLLECTIONS.BAR_RATING).add({
      data: {
        bar_id: barId,
        user_id: currentUser._id,
        rating,
        created_at: now(),
        updated_at: now()
      }
    }).then(unwrapInsertId);
  }

  const stats = await computeBarRatingStats(barId);
  await db.collection(COLLECTIONS.BAR_INFO).doc(bar._id).update({
    data: {
      average_rating: stats.average_rating,
      rating: stats.average_rating,
      rating_count: stats.rating_count,
      updated_at: now()
    }
  });
  return {
    ...stats,
    my_rating: rating
  };
}

module.exports = {
  adminListBars,
  adminUpsertBar,
  adminRemoveBar,
  listBars,
  getBarDetail,
  upsertBarRating
};

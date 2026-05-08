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

function normalizeDrinkDiaryDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const nowDate = new Date();
    return `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDrinkImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => {
      if (typeof item === "string") {
        const url = String(item || "").trim();
        return url ? { url, thumb: url } : null;
      }
      const url = String(item && item.url || "").trim();
      const thumb = String(item && (item.thumb || item.thumbnail || item.url) || "").trim();
      if (!url) return null;
      return {
        url,
        thumb: thumb || url
      };
    })
    .filter(Boolean)
    .slice(0, 9);
}

function normalizeDrinkTime(value) {
  const text = String(value || "").trim();
  if (text) return text;
  return now();
}

async function createDrinkDiaryRecord(currentUser, payload) {
  const recordDate = normalizeDrinkDiaryDate(payload.record_date || payload.date);
  const drinkName = assertTextLength(payload.drink_name || "未命名酒款", "酒名", 50, true);
  const drinkTime = normalizeDrinkTime(payload.drink_time);
  const price = Number(payload.price || 0);
  assert(Number.isFinite(price) && price >= 0, 2001, "价格必须为非负数");
  const remark = assertTextLength(payload.remark || "", "备注", 500, false);
  const tasteNote = assertTextLength(payload.taste_note || "", "口感", 200, false);
  const environmentNote = assertTextLength(payload.environment_note || "", "环境", 200, false);
  const otherNote = assertTextLength(payload.other_note || "", "其他", 200, false);
  const images = normalizeDrinkImages(payload.images);
  assert(images.length > 0, 2001, "至少上传一张图片");
  const thumbnailUrl = String(payload.thumbnail_url || images[0].thumb || images[0].url || "").trim();
  const locationName = String(payload.location_name || "").trim();
  const locationAddress = String(payload.location_address || "").trim();
  const locationLat = Number(payload.location_lat || 0);
  const locationLng = Number(payload.location_lng || 0);
  const alcohol = Number(payload.alcohol || 0);
  assert(!alcohol || (Number.isFinite(alcohol) && alcohol >= 0 && alcohol <= 100), 2001, "度数必须为0-100之间的数字");
  const addRes = await db.collection(COLLECTIONS.DRINK_DIARY).add({
    data: {
      user_id: currentUser._id,
      record_date: recordDate,
      record_month: recordDate.slice(0, 7),
      drink_name: drinkName,
      drink_time: drinkTime,
      price,
      alcohol,
      remark,
      taste_note: tasteNote,
      environment_note: environmentNote,
      other_note: otherNote,
      images,
      thumbnail_url: thumbnailUrl,
      location_name: locationName,
      location_address: locationAddress,
      location_lat: locationLat,
      location_lng: locationLng,
      is_deleted: false,
      created_at: now(),
      updated_at: now()
    }
  });
  return { record_id: unwrapInsertId(addRes) };
}

async function listDrinkDiaryByMonth(currentUser, payload) {
  const month = String(payload.month || "").trim();
  assert(/^\d{4}-\d{2}$/.test(month), 2001, "month 格式应为 YYYY-MM");
  const result = await db.collection(COLLECTIONS.DRINK_DIARY)
    .where({ user_id: currentUser._id, record_month: month, is_deleted: _.neq(true) })
    .orderBy("record_date", "asc")
    .orderBy("created_at", "asc")
    .get();
  return { list: unwrapList(result) };
}

async function listDrinkDiaryByDate(currentUser, payload) {
  const date = normalizeDrinkDiaryDate(payload.record_date || payload.date);
  const result = await db.collection(COLLECTIONS.DRINK_DIARY)
    .where({ user_id: currentUser._id, record_date: date, is_deleted: _.neq(true) })
    .orderBy("created_at", "desc")
    .get();
  return { list: unwrapList(result) };
}

async function getDrinkDiaryDetail(currentUser, payload) {
  const recordId = String(payload.record_id || "").trim();
  assert(recordId, 2001, "record_id 不能为空");
  const record = await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).get().then(unwrapDoc);
  assert(record && record.is_deleted !== true, 3001, "记录不存在");
  assert(record.user_id === currentUser._id, 1002, "权限不足");
  return { record };
}

async function updateDrinkDiaryRecord(currentUser, payload) {
  const recordId = String(payload.record_id || "").trim();
  assert(recordId, 2001, "record_id 不能为空");
  const existing = await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).get().then(unwrapDoc);
  assert(existing && existing.is_deleted !== true, 3001, "记录不存在");
  assert(existing.user_id === currentUser._id, 1002, "权限不足");

  const patch = { updated_at: now() };
  if (Object.prototype.hasOwnProperty.call(payload, "record_date") || Object.prototype.hasOwnProperty.call(payload, "date")) {
    const recordDate = normalizeDrinkDiaryDate(payload.record_date || payload.date);
    patch.record_date = recordDate;
    patch.record_month = recordDate.slice(0, 7);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "drink_name")) {
    patch.drink_name = assertTextLength(payload.drink_name, "酒名", 50, true);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "drink_time")) {
    patch.drink_time = normalizeDrinkTime(payload.drink_time);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "price")) {
    const price = Number(payload.price || 0);
    assert(Number.isFinite(price) && price >= 0, 2001, "价格必须为非负数");
    patch.price = price;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "alcohol")) {
    const alcohol = Number(payload.alcohol || 0);
    assert(!alcohol || (Number.isFinite(alcohol) && alcohol >= 0 && alcohol <= 100), 2001, "度数必须为0-100之间的数字");
    patch.alcohol = alcohol;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "remark")) {
    patch.remark = assertTextLength(payload.remark || "", "备注", 500, false);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "taste_note")) {
    patch.taste_note = assertTextLength(payload.taste_note || "", "口感", 200, false);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "environment_note")) {
    patch.environment_note = assertTextLength(payload.environment_note || "", "环境", 200, false);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "other_note")) {
    patch.other_note = assertTextLength(payload.other_note || "", "其他", 200, false);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "images")) {
    const images = normalizeDrinkImages(payload.images);
    assert(images.length > 0, 2001, "至少上传一张图片");
    patch.images = images;
    if (!Object.prototype.hasOwnProperty.call(payload, "thumbnail_url")) {
      patch.thumbnail_url = images[0].thumb || images[0].url;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "thumbnail_url")) {
    patch.thumbnail_url = String(payload.thumbnail_url || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(payload, "location_name")) {
    patch.location_name = String(payload.location_name || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(payload, "location_address")) {
    patch.location_address = String(payload.location_address || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(payload, "location_lat")) {
    patch.location_lat = Number(payload.location_lat || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "location_lng")) {
    patch.location_lng = Number(payload.location_lng || 0);
  }

  await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).update({ data: patch });
  return { success: true };
}

async function removeDrinkDiaryRecord(currentUser, payload) {
  const recordId = String(payload.record_id || "").trim();
  assert(recordId, 2001, "record_id 不能为空");
  const existing = await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).get().then(unwrapDoc);
  assert(existing && existing.is_deleted !== true, 3001, "记录不存在");
  assert(existing.user_id === currentUser._id, 1002, "权限不足");
  await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).update({
    data: {
      is_deleted: true,
      deleted_at: now(),
      updated_at: now()
    }
  });
  return { success: true };
}

module.exports = {
  normalizeDrinkDiaryDate,
  normalizeDrinkImages,
  normalizeDrinkTime,
  createDrinkDiaryRecord,
  listDrinkDiaryByMonth,
  listDrinkDiaryByDate,
  getDrinkDiaryDetail,
  updateDrinkDiaryRecord,
  removeDrinkDiaryRecord
};

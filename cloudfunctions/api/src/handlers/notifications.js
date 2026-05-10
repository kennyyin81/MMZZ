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

async function listMyNotifications(currentUser, payload) {
  const pager = buildPagination(payload);
  const baseWhere = { user_id: currentUser._id, is_deleted: _.neq(true) };
  const [countRes, unreadRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.NOTIFICATION).where(baseWhere).count(),
    db.collection(COLLECTIONS.NOTIFICATION).where({ ...baseWhere, read_at: null }).count(),
    db.collection(COLLECTIONS.NOTIFICATION).where(baseWhere).orderBy("created_at", "desc").skip(pager.skip).limit(pager.limit).get()
  ]);
  return {
    total: Number((countRes && countRes.total) || 0),
    unread_count: Number((unreadRes && unreadRes.total) || 0),
    list: unwrapList(listRes)
  };
}

async function markNotificationRead(currentUser, payload) {
  const id = String(payload.notification_id || payload.id || "").trim();
  assert(id, 2001, "notification_id 不能为空");
  const doc = await db.collection(COLLECTIONS.NOTIFICATION).doc(id).get().then(unwrapDoc);
  assert(doc, 3001, "通知不存在");
  assert(doc.user_id === currentUser._id, 1002, "权限不足");
  await db.collection(COLLECTIONS.NOTIFICATION).doc(id).update({ data: { read_at: now() } });
  return { success: true };
}

async function markAllNotificationsRead(currentUser) {
  const result = await db.collection(COLLECTIONS.NOTIFICATION).where({ user_id: currentUser._id, read_at: null, is_deleted: _.neq(true) }).update({ data: { read_at: now() } });
  return { updated: Number((result && result.stats && result.stats.updated) || 0) };
}

async function removeNotification(currentUser, payload) {
  const notificationId = String(payload.notification_id || payload.id || "").trim();
  assert(notificationId, 2001, "notification_id 不能为空");
  const doc = await db.collection(COLLECTIONS.NOTIFICATION).doc(notificationId).get().then(unwrapDoc);
  assert(doc, 3001, "通知不存在");
  assert(doc.user_id === currentUser._id, 1002, "权限不足");
  await db.collection(COLLECTIONS.NOTIFICATION).doc(notificationId).update({
    data: {
      is_deleted: true,
      deleted_at: now()
    }
  });
  return { success: true };
}

async function removeNotificationBatch(currentUser, payload) {
  const notificationIds = Array.isArray(payload.notification_ids) ? payload.notification_ids : [];
  const ids = notificationIds.map((item) => String(item || "").trim()).filter(Boolean);
  assert(ids.length > 0, 2001, "notification_ids 不能为空");
  const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
  const result = await db.collection(COLLECTIONS.NOTIFICATION).where({
    _id: _.in(uniqueIds),
    user_id: currentUser._id,
    is_deleted: _.neq(true)
  }).update({
    data: {
      is_deleted: true,
      deleted_at: now()
    }
  });
  return { success: true, updated: Number((result && result.stats && result.stats.updated) || 0) };
}

module.exports = {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  removeNotification,
  removeNotificationBatch
};

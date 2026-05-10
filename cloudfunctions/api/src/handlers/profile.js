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

async function updateCurrentProfile(currentUser, payload) {
  const patch = { updated_at: now() };
  if (Object.prototype.hasOwnProperty.call(payload, "nickname")) {
    patch.nickname = assertTextLength(payload.nickname, "昵称", 20, true);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "avatar_url")) {
    patch.avatar_url = String(payload.avatar_url || "").trim();
  }
  await db.collection(COLLECTIONS.USER_PROFILE).doc(currentUser._id).update({ data: patch });
  await safeLogOperation(currentUser._id, "profile.update", "user_profile", currentUser._id, patch);
  return { success: true };
}

module.exports = {
  updateCurrentProfile
};

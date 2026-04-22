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

async function listPointsLedger(currentUser, payload) {
  const pager = buildPagination(payload);
  const where = { user_id: currentUser._id };
  if (payload.change_type) {
    where.change_type = payload.change_type;
  }
  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.POINTS_LEDGER).where(where).count(),
    db.collection(COLLECTIONS.POINTS_LEDGER).where(where).orderBy("created_at", "desc").skip(pager.skip).limit(pager.limit).get()
  ]);
  return {
    total: Number((countRes && countRes.total) || 0),
    list: unwrapList(listRes)
  };
}

async function adjustPointsByApprover(currentUser, payload) {
  const assignedUser = await getAssignedApplicantForApprover(currentUser._id);
  assert(assignedUser, 3002, "当前没有被审批人");
  assert(assignedUser._id !== currentUser._id, 3003, "不能给自己调分");

  const adjustType = String(payload.adjust_type || "").trim();
  const rawPoints = toInt(payload.points, 0);
  const remark = assertTextLength(payload.remark || "", "调整说明", 100, true);

  assert(["add", "subtract"].includes(adjustType), 2001, "adjust_type 不合法");
  assert(rawPoints !== 0, 2001, "调整积分不能为0");

  const points = Math.abs(rawPoints);
  const changeValue = adjustType === "subtract" ? -points : points;
  const latestBalance = await changePoints(
    assignedUser._id,
    changeValue,
    "manual_adjust",
    makeRequestNo("MA"),
    remark,
    currentUser._id,
    { allowNegativeBalance: true }
  );

  await safeCreateNotification(
    assignedUser._id,
    "points_adjusted",
    adjustType === "add" ? "审批人已为你加分" : "审批人已为你减分",
    `${currentUser.nickname || "审批人"}已${adjustType === "add" ? "增加" : "扣减"}你的积分`,
    {
      adjust_type: adjustType,
      change_points: changeValue,
      balance_after: latestBalance,
      operator_user_id: currentUser._id
    }
  );

  await safeLogOperation(currentUser._id, "points.adjustByApprover", COLLECTIONS.USER_PROFILE, assignedUser._id, {
    adjust_type: adjustType,
    change_points: changeValue,
    balance_after: latestBalance,
    remark
  });

  return {
    assigned_user: briefUser(assignedUser),
    change_points: changeValue,
    balance: latestBalance
  };
}

module.exports = {
  listPointsLedger,
  adjustPointsByApprover
};

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

const { normalizeRequest } = require("./requests");

async function enrichWithApplicantNickname(list) {
  const ids = Array.from(new Set(list.map((item) => item.user_id).filter(Boolean)));
  if (!ids.length) return list;
  const userRes = await db.collection(COLLECTIONS.USER_PROFILE).where({ _id: _.in(ids) }).get();
  const userMap = unwrapList(userRes).reduce((acc, item) => {
    acc[item._id] = item;
    return acc;
  }, {});
  return list.map((item) => ({
    ...item,
    applicant_nickname: (userMap[item.user_id] && userMap[item.user_id].nickname) || "微信用户"
  }));
}

async function listPendingRequests(currentUser, payload) {
  const assignedUser = await getAssignedApplicantForApprover(currentUser._id);
  if (!assignedUser) {
    return { total: 0, list: [] };
  }
  const pager = buildPagination(payload);
  const filterType = String(payload.request_type || "").trim();
  const targetTypes = filterType ? [filterType] : ["earn", "drink", "todo"];
  let list = [];
  for (const type of targetTypes) {
    const meta = getRequestMeta(type);
    const result = await db.collection(meta.collection)
      .where({ approver_user_id: currentUser._id, status: REQUEST_STATUS.PENDING })
      .orderBy("submitted_at", "desc")
      .get();
    list = list.concat(unwrapList(result).map((item) => normalizeRequest(type, item)));
  }
  list = await enrichWithApplicantNickname(list);
  list.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
  return {
    total: list.length,
    list: list.slice(pager.skip, pager.skip + pager.limit)
  };
}

async function listPendingTodoWorks(currentUser, payload) {
  const pager = buildPagination(payload);
  const where = {
    approver_user_id: currentUser._id
  };
  if (payload.status) {
    where.status = String(payload.status).trim();
  }
  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.TODO_WORK).where(where).count(),
    db.collection(COLLECTIONS.TODO_WORK).where(where).orderBy("submitted_at", "desc").skip(pager.skip).limit(pager.limit).get()
  ]);
  const list = await enrichWithApplicantNickname(unwrapList(listRes).map((item) => normalizeRequest("todo", item)));
  return {
    total: Number((countRes && countRes.total) || 0),
    list
  };
}

async function listApprovalHistory(currentUser, payload) {
  const pager = buildPagination(payload);
  const where = { approver_user_id: currentUser._id, is_deleted_by_approver: _.neq(true) };
  if (payload.request_type) where.request_type = payload.request_type;
  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.APPROVAL_RECORD).where(where).count(),
    db.collection(COLLECTIONS.APPROVAL_RECORD).where(where).orderBy("decided_at", "desc").skip(pager.skip).limit(pager.limit).get()
  ]);
  const list = unwrapList(listRes);
  const applicantIds = Array.from(new Set(list.map((item) => item.applicant_user_id).filter(Boolean)));
  let userMap = {};
  if (applicantIds.length) {
    const userRes = await db.collection(COLLECTIONS.USER_PROFILE).where({ _id: _.in(applicantIds) }).get();
    userMap = unwrapList(userRes).reduce((acc, item) => {
      acc[item._id] = item;
      return acc;
    }, {});
  }
  return {
    total: Number((countRes && countRes.total) || 0),
    list: list.map((item) => ({
      ...item,
      applicant_nickname: (userMap[item.applicant_user_id] && userMap[item.applicant_user_id].nickname) || "微信用户"
    }))
  };
}

async function removeApprovalHistory(currentUser, payload) {
  const approvalId = String(payload.approval_id || payload.id || "").trim();
  assert(approvalId, 2001, "approval_id 不能为空");
  const record = await db.collection(COLLECTIONS.APPROVAL_RECORD).doc(approvalId).get().then(unwrapDoc);
  assert(record, 3001, "审批记录不存在");
  assert(record.approver_user_id === currentUser._id, 1002, "权限不足");
  await db.collection(COLLECTIONS.APPROVAL_RECORD).doc(approvalId).update({
    data: {
      is_deleted_by_approver: true,
      deleted_at: now()
    }
  });
  return { success: true };
}

async function removeApprovalHistoryBatch(currentUser, payload) {
  const approvalIds = Array.isArray(payload.approval_ids) ? payload.approval_ids : [];
  const ids = approvalIds.map((item) => String(item || "").trim()).filter(Boolean);
  assert(ids.length > 0, 2001, "approval_ids 不能为空");
  const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
  const result = await db.collection(COLLECTIONS.APPROVAL_RECORD).where({
    _id: _.in(uniqueIds),
    approver_user_id: currentUser._id,
    is_deleted_by_approver: _.neq(true)
  }).update({
    data: {
      is_deleted_by_approver: true,
      deleted_at: now()
    }
  });
  return { success: true, updated: Number((result && result.stats && result.stats.updated) || 0) };
}

async function decideRequest(currentUser, payload) {
  const meta = getRequestMeta(payload.request_type);
  const requestId = String(payload.request_id || "").trim();
  const decision = String(payload.decision || "").trim();
  const comment = assertTextLength(payload.comment || "", "审批意见", 200, false);
  assert(requestId, 2001, "request_id 不能为空");
  assert([REQUEST_STATUS.APPROVED, REQUEST_STATUS.REJECTED].includes(decision), 2001, "decision 不合法");

  const request = await db.collection(meta.collection).doc(requestId).get().then(unwrapDoc);
  assert(request, 3001, "申请不存在");
  assert(request.approver_user_id === currentUser._id, 1002, "当前申请不属于你审批");
  assert(request.user_id !== currentUser._id, 3003, "不能审批自己的申请");
  assert(request.status === REQUEST_STATUS.PENDING, 3002, "当前状态不可审批");

  let finalDecision = decision;
  let approvalComment = comment;
  let latestBalance = null;
  let insufficientBalance = false;
  let currentBalance = null;

  if (decision === REQUEST_STATUS.APPROVED) {
    if (payload.request_type === "earn") {
      latestBalance = await changePoints(
        request.user_id,
        Number(request.requested_points || 0),
        meta.pointsSourceType,
        requestId,
        request.behavior_type || "加分申请通过",
        currentUser._id,
        { allowNegativeBalance: true }
      );
    } else if (payload.request_type === "drink") {
      currentBalance = await getBalanceByUserId(request.user_id);
      if (currentBalance < Number(request.cost_points || 0)) {
        finalDecision = REQUEST_STATUS.REJECTED;
        approvalComment = comment || "余额不足，已自动拒绝";
        insufficientBalance = true;
      } else {
        latestBalance = await changePoints(
          request.user_id,
          -Number(request.cost_points || 0),
          meta.pointsSourceType,
          requestId,
          request.reason || "喝酒申请通过",
          currentUser._id
        );
      }
    } else if (payload.request_type === "todo" && request.is_rewarded) {
      latestBalance = await changePoints(
        request.user_id,
        Number(request.reward_points || 0),
        meta.pointsSourceType,
        requestId,
        request.title || "待办工作加分通过",
        currentUser._id,
        { allowNegativeBalance: true }
      );
    }
  }

  const approvalRes = await db.collection(COLLECTIONS.APPROVAL_RECORD).add({
    data: {
      request_type: payload.request_type,
      request_id: requestId,
      request_no: request.request_no,
      applicant_user_id: request.user_id,
      approver_user_id: currentUser._id,
      decision: finalDecision,
      comment: approvalComment,
      decided_at: now()
    }
  });

  await db.collection(meta.collection).doc(requestId).update({
    data: {
      status: finalDecision,
      approval_id: unwrapInsertId(approvalRes),
      decided_at: now(),
      updated_at: now()
    }
  });

  const applicant = await getUserById(request.user_id);
  await safeCreateNotification(request.user_id, "approval_result", finalDecision === REQUEST_STATUS.APPROVED ? "申请已通过" : "申请已拒绝", `${currentUser.nickname || "审批人"}已处理你的${payload.request_type === "earn" ? "加分" : payload.request_type === "todo" ? "待办" : "喝酒"}申请`, {
    request_type: payload.request_type,
    request_id: requestId,
    decision: finalDecision
  });
  await safeLogOperation(currentUser._id, "approval.decide", meta.collection, requestId, {
    decision: finalDecision,
    comment: approvalComment,
    applicant: applicant ? applicant.nickname : request.user_id
  });

  if (insufficientBalance) {
    throw new AppError(4001, "余额不足，已自动拒绝", {
      latest_balance: currentBalance
    });
  }

  return {
    decision: finalDecision,
    latest_balance: latestBalance
  };
}

module.exports = {
  enrichWithApplicantNickname,
  listPendingRequests,
  listPendingTodoWorks,
  listApprovalHistory,
  removeApprovalHistory,
  removeApprovalHistoryBatch,
  decideRequest
};

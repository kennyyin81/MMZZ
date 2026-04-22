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

async function createEarnRequest(currentUser, payload) {
  const behaviorType = assertTextLength(payload.behavior_type, "行为类型", 30, true);
  const description = assertTextLength(payload.description, "申请说明", 200, true);
  const requestedPoints = toInt(payload.requested_points, 0);
  assert(requestedPoints > 0, 2001, "申请积分必须大于0");
  assert(currentUser.approver_user_id, 3002, "请先绑定审批人");
  const addRes = await db.collection(COLLECTIONS.EARN_REQUEST).add({
    data: {
      request_no: makeRequestNo("ER"),
      user_id: currentUser._id,
      approver_user_id: currentUser.approver_user_id,
      behavior_type: behaviorType,
      description,
      requested_points: requestedPoints,
      status: REQUEST_STATUS.PENDING,
      approval_id: "",
      submitted_at: now(),
      updated_at: now()
    }
  });
  await safeCreateNotification(currentUser.approver_user_id, "approval_pending", "新的加分申请", `${currentUser.nickname || "微信用户"}提交了加分申请`, {
    request_type: "earn",
    request_id: unwrapInsertId(addRes)
  });
  return { request_id: unwrapInsertId(addRes), status: REQUEST_STATUS.PENDING };
}

async function createDrinkRequest(currentUser, payload) {
  const reason = assertTextLength(payload.reason, "申请原因", 200, true);
  const costPoints = toInt(payload.cost_points, 0);
  assert(costPoints > 0, 2001, "鎵ｅ噺绉垎蹇呴』澶т簬0");
  assert(currentUser.approver_user_id, 3002, "请先绑定审批人");
  const balance = await getBalanceByUserId(currentUser._id);
  assert(balance >= costPoints, 4001, "积分不足，无法提交申请");
  const pendingExisting = await db.collection(COLLECTIONS.DRINK_REQUEST)
    .where({ user_id: currentUser._id, status: REQUEST_STATUS.PENDING })
    .limit(1)
    .get();
  assert(!unwrapDoc(pendingExisting), 3004, "你已有待审批的喝酒申请");
  const addRes = await db.collection(COLLECTIONS.DRINK_REQUEST).add({
    data: {
      request_no: makeRequestNo("DR"),
      user_id: currentUser._id,
      approver_user_id: currentUser.approver_user_id,
      reason,
      cost_points: costPoints,
      status: REQUEST_STATUS.PENDING,
      approval_id: "",
      submitted_at: now(),
      updated_at: now()
    }
  });
  await safeCreateNotification(currentUser.approver_user_id, "approval_pending", "新的喝酒申请", `${currentUser.nickname || "微信用户"}提交了喝酒申请`, {
    request_type: "drink",
    request_id: unwrapInsertId(addRes)
  });
  return { request_id: unwrapInsertId(addRes), status: REQUEST_STATUS.PENDING, cost_points: costPoints };
}

async function createTodoWork(currentUser, payload) {
  const title = assertTextLength(payload.title, "鏍囬", 50, true);
  const description = assertTextLength(payload.description || "", "鎻忚堪", 200, false);
  const isRewarded = !!payload.is_rewarded;
  const rewardPoints = isRewarded ? toInt(payload.reward_points, 0) : 0;
  if (isRewarded) {
    assert(currentUser.approver_user_id, 3002, "请先绑定审批人");
    assert(rewardPoints > 0, 2001, "加分工作必须填写奖励积分");
  }

  const submittedAt = now();
  const addRes = await db.collection(COLLECTIONS.TODO_WORK).add({
    data: {
      request_no: makeRequestNo("TD"),
      user_id: currentUser._id,
      approver_user_id: isRewarded ? currentUser.approver_user_id : "",
      title,
      description,
      is_rewarded: isRewarded,
      reward_points: rewardPoints,
      status: "todo",
      approval_id: "",
      submitted_at: submittedAt,
      completed_at: null,
      decided_at: null,
      updated_at: submittedAt
    }
  });

  return {
    request_id: unwrapInsertId(addRes),
    status: "todo",
    is_rewarded: isRewarded
  };
}

async function completeTodoWork(currentUser, payload) {
  const todoId = String(payload.todo_id || "").trim();
  assert(todoId, 2001, "todo_id 不能为空");
  const todo = await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).get().then(unwrapDoc);
  assert(todo, 3001, "待办不存在");
  assert(todo.user_id === currentUser._id, 1002, "权限不足");
  assert(todo.status === "todo", 3002, "当前状态不可完成");

  const completedAt = now();

  if (todo.is_rewarded) {
    // 加分工作：标记完成并提交审批
    await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).update({
      data: {
        status: REQUEST_STATUS.PENDING,
        completed_at: completedAt,
        updated_at: completedAt
      }
    });
    await safeCreateNotification(
      todo.approver_user_id,
      "approval_pending",
      "新的待办加分工作",
      `${currentUser.nickname || "微信用户"}完成了一项加分工作待审批`,
      { request_type: "todo", request_id: todoId }
    );
    return { status: REQUEST_STATUS.PENDING, message: "已提交审批" };
  } else {
    // 不加分工作：直接标记完成
    await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).update({
      data: {
        status: "completed",
        completed_at: completedAt,
        decided_at: completedAt,
        updated_at: completedAt
      }
    });
    return { status: "completed", message: "已完成" };
  }
}

async function removeTodoWork(currentUser, payload) {
  const todoId = String(payload.todo_id || "").trim();
  assert(todoId, 2001, "todo_id 不能为空");
  const todo = await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).get().then(unwrapDoc);
  assert(todo, 3001, "待办不存在");
  assert(todo.user_id === currentUser._id, 1002, "权限不足");
  assert(todo.status === "todo" || todo.status === "completed", 3002, "审批中的待办不可删除");
  await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).remove();
  return { success: true };
}

async function reopenTodoWork(currentUser, payload) {
  const todoId = String(payload.todo_id || "").trim();
  assert(todoId, 2001, "todo_id 不能为空");
  const todo = await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).get().then(unwrapDoc);
  assert(todo, 3001, "待办不存在");
  assert(todo.user_id === currentUser._id, 1002, "权限不足");
  assert(todo.status === "completed", 3002, "褰撳墠鐘舵€佷笉鍙噸鏂版墦寮€");
  await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).update({
    data: {
      status: "todo",
      completed_at: null,
      decided_at: null,
      updated_at: now()
    }
  });
  return { status: "todo", message: "宸查噸鏂版墦寮€" };
}

async function updateTodoWork(currentUser, payload) {
  const todoId = String(payload.todo_id || "").trim();
  assert(todoId, 2001, "todo_id 不能为空");
  const todo = await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).get().then(unwrapDoc);
  assert(todo, 3001, "待办不存在");
  assert(todo.user_id === currentUser._id, 1002, "权限不足");
  assert(todo.status === "todo", 3002, "只能编辑待完成状态的待办");

  const title = assertTextLength(payload.title, "鏍囬", 50, true);
  const description = assertTextLength(payload.description || "", "鎻忚堪", 200, false);
  const isRewarded = !!payload.is_rewarded;
  const rewardPoints = isRewarded ? toInt(payload.reward_points, 0) : 0;

  if (isRewarded) {
    assert(currentUser.approver_user_id, 3002, "请先绑定审批人");
    assert(rewardPoints > 0, 2001, "加分工作必须填写奖励积分");
  }

  await db.collection(COLLECTIONS.TODO_WORK).doc(todoId).update({
    data: {
      title,
      description,
      is_rewarded: isRewarded,
      reward_points: rewardPoints,
      approver_user_id: isRewarded ? currentUser.approver_user_id : "",
      updated_at: now()
    }
  });

  return { success: true };
}

async function withdrawRequest(currentUser, payload) {
  const meta = getRequestMeta(payload.request_type);
  const requestId = String(payload.request_id || "").trim();
  assert(requestId, 2001, "request_id 不能为空");
  const request = await db.collection(meta.collection).doc(requestId).get().then(unwrapDoc);
  assert(request, 3001, "申请不存在");
  assert(request.user_id === currentUser._id, 1002, "权限不足");
  assert(request.status === REQUEST_STATUS.PENDING, 3002, "当前状态不可撤回");
  await db.collection(meta.collection).doc(requestId).update({
    data: {
      status: REQUEST_STATUS.WITHDRAWN,
      updated_at: now()
    }
  });
  await safeLogOperation(currentUser._id, "request.withdraw", meta.collection, requestId, { request_type: payload.request_type });
  return { status: REQUEST_STATUS.WITHDRAWN };
}

function normalizeRequest(type, request) {
  const base = {
    ...request,
    request_id: request._id || request.request_id || "",
    request_type: type
  };
  if (type === "earn") {
    base.title = request.behavior_type;
    base.points = Number(request.requested_points || 0);
  } else if (type === "drink") {
    base.title = request.reason;
    base.points = Number(request.cost_points || 0);
  } else if (type === "todo") {
    base.title = request.title;
    base.points = Number(request.reward_points || 0);
  }
  return base;
}

async function listMyRequests(currentUser, payload) {
  const pager = buildPagination(payload);
  const type = String(payload.request_type || "").trim();
  const status = String(payload.status || "").trim();
  const types = type ? [type] : ["earn", "drink"];
  let list = [];
  for (const currentType of types) {
    const meta = getRequestMeta(currentType);
    const where = { user_id: currentUser._id };
    if (status) where.status = status;
    const result = await db.collection(meta.collection).where(where).orderBy("submitted_at", "desc").get();
    list = list.concat(unwrapList(result).map((item) => normalizeRequest(currentType, item)));
  }
  list.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
  const total = list.length;
  return {
    total,
    list: list.slice(pager.skip, pager.skip + pager.limit)
  };
}

async function listMyTodoWorks(currentUser, payload) {
  const pager = buildPagination(payload);
  const where = { user_id: currentUser._id };

  const dateStr = String(payload.date || "").trim();
  if (dateStr) {
    const start = new Date(dateStr + "T00:00:00.000+08:00");
    const end = new Date(dateStr + "T23:59:59.999+08:00");
    where.submitted_at = _.gte(start).and(_.lte(end));
  }

  if (payload.status) {
    where.status = String(payload.status).trim();
  }

  const [countRes, pendingCount] = await Promise.all([
    db.collection(COLLECTIONS.TODO_WORK).where(where).count(),
    db.collection(COLLECTIONS.TODO_WORK)
      .where({
        user_id: currentUser._id,
        status: _.in(["todo", "pending"])
      })
      .count()
  ]);

  const total = Number((countRes && countRes.total) || 0);
  const totalPendingCount = Number((pendingCount && pendingCount.total) || 0);

  // 获取所有数据用于排序（优先未完成，其次按时间）
  const listRes = await db.collection(COLLECTIONS.TODO_WORK).where(where).orderBy("submitted_at", "desc").get();
  const allList = unwrapList(listRes).map((item) => normalizeRequest("todo", item));

  // 排序：未完成优先，其次按时间倒序
  allList.sort((a, b) => {
    const aIsTodo = a.status === "todo" || a.status === "pending";
    const bIsTodo = b.status === "todo" || b.status === "pending";
    if (aIsTodo && !bIsTodo) return -1;
    if (!aIsTodo && bIsTodo) return 1;
    return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
  });

  return {
    total,
    pending_count: totalPendingCount,
    list: allList.slice(pager.skip, pager.skip + pager.limit)
  };
}

async function getRequestDetail(currentUser, payload) {
  const meta = getRequestMeta(payload.request_type);
  const requestId = String(payload.request_id || "").trim();
  assert(requestId, 2001, "request_id 不能为空");
  const request = await db.collection(meta.collection).doc(requestId).get().then(unwrapDoc);
  assert(request, 3001, "申请不存在");
  const isApplicant = request.user_id === currentUser._id;
  const isApprover = request.approver_user_id === currentUser._id;
  const isAdmin = hasRole(currentUser, ROLE.ADMIN);
  assert(isApplicant || isApprover || isAdmin, 1002, "权限不足");
  const approvalRes = await db.collection(COLLECTIONS.APPROVAL_RECORD)
    .where({ request_type: payload.request_type, request_id: requestId })
    .limit(1)
    .get();
  const applicant = await getUserById(request.user_id);
  return {
    request: {
      ...normalizeRequest(payload.request_type, request),
      applicant_nickname: (applicant && applicant.nickname) || "微信用户"
    },
    approval: unwrapDoc(approvalRes)
  };
}

module.exports = {
  createEarnRequest,
  createDrinkRequest,
  createTodoWork,
  completeTodoWork,
  removeTodoWork,
  reopenTodoWork,
  updateTodoWork,
  withdrawRequest,
  normalizeRequest,
  listMyRequests,
  listMyTodoWorks,
  getRequestDetail
};

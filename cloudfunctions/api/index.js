const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  USER_PROFILE: "user_profile",
  POINTS_ACCOUNT: "points_account",
  POINTS_LEDGER: "points_ledger",
  EARN_REQUEST: "earn_request",
  DRINK_REQUEST: "drink_request",
  TODO_WORK: "todo_work",
  APPROVAL_RECORD: "approval_record",
  APPROVER_INVITATION: "approver_invitation",
  OPERATION_LOG: "operation_log",
  NOTIFICATION: "notification",
  WINE_TOPIC: "wine_topic",
  WINE_COMMENT: "wine_comment",
  WINE_FAVORITE: "wine_favorite",
  DRINK_DIARY: "drink_diary"
};

const ROLE = {
  USER: "USER",
  APPROVER: "APPROVER",
  ADMIN: "ADMIN",
  SOMMELIER: "SOMMELIER"
};

const REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn"
};

const INVITATION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELLED: "cancelled"
};

class AppError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data || {};
  }
}

function ok(data) {
  return { code: 0, message: "ok", data: data || {} };
}

function fail(code, message, data) {
  return { code, message, data: data || {} };
}

function assert(condition, code, message, data) {
  if (!condition) {
    throw new AppError(code, message, data);
  }
}

function now() {
  return new Date();
}

function unwrapList(result) {
  if (!result) return [];
  if (Array.isArray(result.data)) return result.data;
  if (result.list && Array.isArray(result.list)) return result.list;
  return [];
}

function unwrapDoc(result) {
  if (result && result.data && !Array.isArray(result.data)) {
    return result.data;
  }
  const list = unwrapList(result);
  return list[0] || null;
}

function unwrapInsertId(result) {
  return (result && (result._id || result.id)) || "";
}

function toInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function buildPagination(payload) {
  const pageNo = Math.max(1, toInt(payload.page_no, 1));
  const pageSize = Math.min(50, Math.max(1, toInt(payload.page_size, 20)));
  return {
    pageNo,
    pageSize,
    skip: (pageNo - 1) * pageSize,
    limit: pageSize
  };
}

function hasRole(user, role) {
  return Array.isArray(user.roles) && user.roles.includes(role);
}

function requireRole(user, roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  const okRole = list.some((role) => hasRole(user, role));
  assert(okRole, 1002, "权限不足");
}

function assertTextLength(value, label, max, required) {
  const text = String(value || "").trim();
  if (required) {
    assert(!!text, 2001, `${label}不能为空`);
  }
  assert(text.length <= max, 2001, `${label}长度不能超过${max}个字符`);
  return text;
}

function makeRequestNo(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
}

function getRequestMeta(type) {
  if (type === "earn") {
    return {
      type,
      prefix: "ER",
      collection: COLLECTIONS.EARN_REQUEST,
      pointsSourceType: "earn_request"
    };
  }
  if (type === "drink") {
    return {
      type,
      prefix: "DR",
      collection: COLLECTIONS.DRINK_REQUEST,
      pointsSourceType: "drink_request"
    };
  }
  if (type === "todo") {
    return {
      type,
      prefix: "TD",
      collection: COLLECTIONS.TODO_WORK,
      pointsSourceType: "todo_work"
    };
  }
  throw new AppError(2001, "request_type 不合法");
}

function briefUser(user) {
  if (!user) return null;
  return {
    user_id: user._id,
    nickname: user.nickname || "微信用户",
    avatar_url: user.avatar_url || ""
  };
}

async function safeLogOperation(operatorUserId, action, targetType, targetId, payload) {
  try {
    await db.collection(COLLECTIONS.OPERATION_LOG).add({
      data: {
        operator_user_id: operatorUserId,
        action,
        target_type: targetType,
        target_id: targetId,
        payload: payload || {},
        created_at: now()
      }
    });
  } catch (error) {
    console.error("safeLogOperation failed", action, targetType, targetId, error.message);
  }
}

async function safeCreateNotification(userId, type, title, content, extra) {
  if (!userId) return;
  try {
    await db.collection(COLLECTIONS.NOTIFICATION).add({
      data: {
        user_id: userId,
        type,
        title,
        content,
        extra: extra || {},
        read_at: null,
        is_deleted: false,
        created_at: now()
      }
    });
  } catch (error) {
    console.error("safeCreateNotification failed", userId, type, error.message);
  }
}

async function getUserById(userId) {
  if (!userId) return null;
  return db.collection(COLLECTIONS.USER_PROFILE).doc(userId).get().then(unwrapDoc).catch(() => null);
}

async function getUserByOpenId(openid) {
  const result = await db.collection(COLLECTIONS.USER_PROFILE).where({ openid }).limit(1).get();
  return unwrapDoc(result);
}

async function ensurePointsAccount(userId) {
  const existing = await db.collection(COLLECTIONS.POINTS_ACCOUNT).where({ user_id: userId }).limit(1).get();
  const found = unwrapDoc(existing);
  if (found) {
    return found;
  }
  try {
    await db.collection(COLLECTIONS.POINTS_ACCOUNT).add({
      data: {
        user_id: userId,
        balance: 0,
        version: 0,
        updated_at: now()
      }
    });
  } catch (error) {
    if (!String(error && error.message).includes("duplicate key")) {
      throw error;
    }
  }
  const latest = await db.collection(COLLECTIONS.POINTS_ACCOUNT).where({ user_id: userId }).limit(1).get();
  return unwrapDoc(latest);
}

async function getBalanceByUserId(userId) {
  const account = await ensurePointsAccount(userId);
  return Number((account && account.balance) || 0);
}

async function changePoints(userId, changePoints, sourceType, sourceId, remark, operatorUserId, options) {
  const account = await ensurePointsAccount(userId);
  const balance = Number(account.balance || 0);
  const nextBalance = balance + Number(changePoints || 0);
  const allowNegativeBalance = !!(options && options.allowNegativeBalance);
  assert(allowNegativeBalance || nextBalance >= 0, 4001, "积分余额不足");

  await db.collection(COLLECTIONS.POINTS_ACCOUNT).doc(account._id).update({
    data: {
      balance: nextBalance,
      version: _.inc(1),
      updated_at: now()
    }
  });

  await db.collection(COLLECTIONS.POINTS_LEDGER).add({
    data: {
      user_id: userId,
      change_type: changePoints >= 0 ? "earn" : "redeem",
      change_points: Number(changePoints),
      balance_after: nextBalance,
      source_type: sourceType,
      source_id: sourceId,
      remark: remark || "",
      operator_user_id: operatorUserId || userId,
      created_at: now()
    }
  });

  return nextBalance;
}

async function countUnreadNotifications(userId) {
  const result = await db.collection(COLLECTIONS.NOTIFICATION).where({ user_id: userId, read_at: null, is_deleted: _.neq(true) }).count();
  return Number((result && result.total) || 0);
}

async function getAssignedApplicantForApprover(approverUserId) {
  const result = await db.collection(COLLECTIONS.USER_PROFILE).where({ approver_user_id: approverUserId }).limit(2).get();
  const list = unwrapList(result);
  return list[0] || null;
}

async function getMyApproverRelation(currentUser) {
  const myApprover = currentUser.approver_user_id ? await getUserById(currentUser.approver_user_id) : null;
  const assignedUser = await getAssignedApplicantForApprover(currentUser._id);
  const incomingRes = await db.collection(COLLECTIONS.APPROVER_INVITATION)
    .where({ invitee_user_id: currentUser._id, status: INVITATION_STATUS.PENDING })
    .orderBy("created_at", "desc")
    .get();
  const outgoingRes = await db.collection(COLLECTIONS.APPROVER_INVITATION)
    .where({ inviter_user_id: currentUser._id, status: INVITATION_STATUS.PENDING })
    .orderBy("created_at", "desc")
    .limit(1)
    .get();

  const incomingList = unwrapList(incomingRes);
  const outgoing = unwrapDoc(outgoingRes);
  const inviterIds = incomingList.map((item) => item.inviter_user_id).filter(Boolean);
  const inviteeIds = outgoing ? [outgoing.invitee_user_id] : [];
  const relatedIds = Array.from(new Set(inviterIds.concat(inviteeIds)));
  let usersMap = {};
  if (relatedIds.length) {
    const userResult = await db.collection(COLLECTIONS.USER_PROFILE).where({ _id: _.in(relatedIds) }).get();
    usersMap = unwrapList(userResult).reduce((acc, item) => {
      acc[item._id] = item;
      return acc;
    }, {});
  }

  return {
    my_approver: briefUser(myApprover),
    assigned_user: briefUser(assignedUser),
    incoming_invitations: incomingList.map((item) => ({
      invitation_id: item._id,
      created_at: item.created_at,
      inviter: briefUser(usersMap[item.inviter_user_id])
    })),
    outgoing_invitation: outgoing
      ? {
          invitation_id: outgoing._id,
          created_at: outgoing.created_at,
          invitee: briefUser(usersMap[outgoing.invitee_user_id])
        }
      : null
  };
}

async function getAssignedUserSummary(currentUser) {
  const assignedUser = await getAssignedApplicantForApprover(currentUser._id);
  assert(assignedUser, 3002, "当前没有被审批人");
  const balance = await getBalanceByUserId(assignedUser._id);
  return {
    ...briefUser(assignedUser),
    balance
  };
}

async function ensureCurrentUser(event) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  assert(openid, 1001, "未登录");
  let user = await getUserByOpenId(openid);
  const inputUserInfo = event.userInfo || {};
  const nickname = String(inputUserInfo.nickName || inputUserInfo.nickname || "").trim();
  const avatarUrl = String(inputUserInfo.avatarUrl || inputUserInfo.avatar_url || "").trim();

  if (!user) {
    const addRes = await db.collection(COLLECTIONS.USER_PROFILE).add({
      data: {
        openid,
        nickname: nickname || "微信用户",
        avatar_url: avatarUrl || "",
        roles: [ROLE.USER],
        status: "active",
        approver_user_id: "",
        approver_assigned_at: null,
        created_at: now(),
        updated_at: now()
      }
    });
    user = {
      _id: unwrapInsertId(addRes),
      openid,
      nickname: nickname || "微信用户",
      avatar_url: avatarUrl || "",
      roles: [ROLE.USER],
      status: "active",
      approver_user_id: ""
    };
  } else if (nickname || avatarUrl) {
    const patch = { updated_at: now() };
    if (nickname) patch.nickname = nickname;
    if (avatarUrl) patch.avatar_url = avatarUrl;
    await db.collection(COLLECTIONS.USER_PROFILE).doc(user._id).update({ data: patch });
    user = { ...user, ...patch };
  }

  // 并行执行所有查询操作
  const [balance, unreadCount, assignedUser, myApprover] = await Promise.all([
    getBalanceByUserId(user._id),
    countUnreadNotifications(user._id),
    getAssignedApplicantForApprover(user._id),
    user.approver_user_id ? getUserById(user.approver_user_id) : Promise.resolve(null)
  ]);

  return {
    ...user,
    user_id: user._id,
    balance,
    can_approve: !!assignedUser,
    unread_notification_count: unreadCount,
    my_approver: briefUser(myApprover),
    assigned_user: briefUser(assignedUser)
  };
}

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

async function searchApproverUsers(currentUser, payload) {
  const keyword = assertTextLength(payload.keyword, "关键词", 20, true);
  const result = await db.collection(COLLECTIONS.USER_PROFILE)
    .where({ nickname: db.RegExp({ regexp: keyword, options: "i" }), status: "active" })
    .limit(20)
    .get();
  const list = unwrapList(result)
    .filter((item) => item._id !== currentUser._id)
    .map((item) => ({
      user_id: item._id,
      nickname: item.nickname || "微信用户",
      avatar_url: item.avatar_url || "",
      roles: item.roles || []
    }));
  return { list };
}

async function inviteApprover(currentUser, payload) {
  const targetUserId = String(payload.target_user_id || "").trim();
  assert(targetUserId, 2001, "target_user_id 不能为空");
  assert(targetUserId !== currentUser._id, 2001, "不能邀请自己作为审批人");
  assert(!currentUser.approver_user_id, 3002, "你已绑定审批人");
  const assignedUser = await getAssignedApplicantForApprover(targetUserId);
  assert(!assignedUser, 3002, "对方已在审批其他用户");
  const pendingMine = await db.collection(COLLECTIONS.APPROVER_INVITATION)
    .where({ inviter_user_id: currentUser._id, status: INVITATION_STATUS.PENDING })
    .limit(1)
    .get();
  assert(!unwrapDoc(pendingMine), 3002, "你已有待处理邀请");

  const addRes = await db.collection(COLLECTIONS.APPROVER_INVITATION).add({
    data: {
      inviter_user_id: currentUser._id,
      invitee_user_id: targetUserId,
      status: INVITATION_STATUS.PENDING,
      created_at: now(),
      updated_at: now()
    }
  });
  await safeCreateNotification(targetUserId, "approver_invite", "审批邀请", `${currentUser.nickname || "微信用户"}邀请你作为审批人`, {
    invitation_id: unwrapInsertId(addRes),
    inviter_user_id: currentUser._id
  });
  return { invitation_id: unwrapInsertId(addRes) };
}

async function respondApproverInvitation(currentUser, payload) {
  const invitationId = String(payload.invitation_id || "").trim();
  const decision = String(payload.decision || "").trim();
  assert(invitationId, 2001, "invitation_id 不能为空");
  assert(["accepted", "rejected"].includes(decision), 2001, "decision 不合法");
  const invite = await db.collection(COLLECTIONS.APPROVER_INVITATION).doc(invitationId).get().then(unwrapDoc);
  assert(invite, 3001, "邀请不存在");
  assert(invite.invitee_user_id === currentUser._id, 1002, "权限不足");
  assert(invite.status === INVITATION_STATUS.PENDING, 3002, "邀请状态已变更");

  if (decision === "accepted") {
    const inviter = await getUserById(invite.inviter_user_id);
    assert(inviter, 3001, "邀请人不存在");
    assert(!inviter.approver_user_id, 3002, "邀请人已绑定审批人");
    const assignedUser = await getAssignedApplicantForApprover(currentUser._id);
    assert(!assignedUser, 3002, "你已在审批其他用户");
    await db.collection(COLLECTIONS.USER_PROFILE).doc(inviter._id).update({
      data: {
        approver_user_id: currentUser._id,
        approver_assigned_at: now(),
        updated_at: now()
      }
    });
    await safeCreateNotification(inviter._id, "approver_invite_result", "审批邀请已接受", `${currentUser.nickname || "微信用户"}已接受你的审批邀请`, {
      invitation_id: invitationId,
      decision
    });
  } else {
    await safeCreateNotification(invite.inviter_user_id, "approver_invite_result", "审批邀请已拒绝", `${currentUser.nickname || "微信用户"}已拒绝你的审批邀请`, {
      invitation_id: invitationId,
      decision
    });
  }

  await db.collection(COLLECTIONS.APPROVER_INVITATION).doc(invitationId).update({
    data: {
      status: decision === "accepted" ? INVITATION_STATUS.ACCEPTED : INVITATION_STATUS.REJECTED,
      updated_at: now()
    }
  });

  return { success: true };
}

async function cancelApproverInvitation(currentUser, payload) {
  const invitationId = String(payload.invitation_id || "").trim();
  assert(invitationId, 2001, "invitation_id 不能为空");
  const invite = await db.collection(COLLECTIONS.APPROVER_INVITATION).doc(invitationId).get().then(unwrapDoc);
  assert(invite, 3001, "邀请不存在");
  assert(invite.inviter_user_id === currentUser._id, 1002, "权限不足");
  assert(invite.status === INVITATION_STATUS.PENDING, 3002, "邀请状态已变更");
  await db.collection(COLLECTIONS.APPROVER_INVITATION).doc(invitationId).update({
    data: {
      status: INVITATION_STATUS.CANCELLED,
      updated_at: now()
    }
  });
  await safeCreateNotification(invite.invitee_user_id, "approver_invite_cancelled", "审批邀请已取消", `${currentUser.nickname || "微信用户"}已取消审批邀请`, {
    invitation_id: invitationId
  });
  return { success: true };
}

async function countPendingRequestsBetween(applicantUserId, approverUserId) {
  const [earnCount, drinkCount] = await Promise.all([
    db.collection(COLLECTIONS.EARN_REQUEST).where({ user_id: applicantUserId, approver_user_id: approverUserId, status: REQUEST_STATUS.PENDING }).count(),
    db.collection(COLLECTIONS.DRINK_REQUEST).where({ user_id: applicantUserId, approver_user_id: approverUserId, status: REQUEST_STATUS.PENDING }).count()
  ]);
  return Number((earnCount && earnCount.total) || 0) + Number((drinkCount && drinkCount.total) || 0);
}

async function unbindApprover(currentUser) {
  assert(currentUser.approver_user_id, 3002, "当前未绑定审批人");
  const pendingCount = await countPendingRequestsBetween(currentUser._id, currentUser.approver_user_id);
  assert(pendingCount === 0, 3002, "存在待审批申请，暂不能解绑");
  await db.collection(COLLECTIONS.USER_PROFILE).doc(currentUser._id).update({
    data: {
      approver_user_id: "",
      approver_assigned_at: null,
      updated_at: now()
    }
  });
  await safeCreateNotification(currentUser.approver_user_id, "approver_unbind", "审批关系已解除", `${currentUser.nickname || "微信用户"}已解除审批关系`, {
    applicant_user_id: currentUser._id
  });
  return { success: true };
}

async function unbindAssignedUser(currentUser) {
  const assignedUser = await getAssignedApplicantForApprover(currentUser._id);
  assert(assignedUser, 3002, "当前没有被审批人");
  const pendingCount = await countPendingRequestsBetween(assignedUser._id, currentUser._id);
  assert(pendingCount === 0, 3002, "存在待审批申请，暂不能解绑");
  await db.collection(COLLECTIONS.USER_PROFILE).doc(assignedUser._id).update({
    data: {
      approver_user_id: "",
      approver_assigned_at: null,
      updated_at: now()
    }
  });
  await safeCreateNotification(assignedUser._id, "approver_unbind", "审批关系已解除", `${currentUser.nickname || "微信用户"}已解除审批关系`, {
    approver_user_id: currentUser._id
  });
  return { success: true };
}

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
        currentUser._id
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
        currentUser._id
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
  const images = normalizeDrinkImages(payload.images);
  assert(images.length > 0, 2001, "至少上传一张图片");
  const thumbnailUrl = String(payload.thumbnail_url || images[0].thumb || images[0].url || "").trim();
  const addRes = await db.collection(COLLECTIONS.DRINK_DIARY).add({
    data: {
      user_id: currentUser._id,
      record_date: recordDate,
      record_month: recordDate.slice(0, 7),
      drink_name: drinkName,
      drink_time: drinkTime,
      price,
      remark,
      images,
      thumbnail_url: thumbnailUrl,
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
  if (Object.prototype.hasOwnProperty.call(payload, "remark")) {
    patch.remark = assertTextLength(payload.remark || "", "备注", 500, false);
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

function getWineSimilarityScore(baseWine, candidateWine) {
  if (!candidateWine || !candidateWine.wine_id) return -1;
  const baseFlavorTags = getWineFlavorTags(baseWine.flavor);
  const candidateFlavorTags = getWineFlavorTags(candidateWine.flavor);
  const baseFlavorSet = new Set(baseFlavorTags);
  const overlapCount = candidateFlavorTags.filter((item) => baseFlavorSet.has(item)).length;
  const unionCount = new Set(baseFlavorTags.concat(candidateFlavorTags)).size || 1;
  const flavorScore = overlapCount ? Math.round((overlapCount / unionCount) * 100) : 0;
  const categoryScore = baseWine.category && candidateWine.category && baseWine.category === candidateWine.category ? 20 : 0;
  const baseSpiritScore = baseWine.base_spirit && candidateWine.base_spirit && baseWine.base_spirit === candidateWine.base_spirit ? 12 : 0;
  const tasteScore = ["acidity", "sweetness", "bitterness", "spiciness"].reduce((sum, key) => {
    const diff = Math.abs(Number(baseWine[key] || 0) - Number(candidateWine[key] || 0));
    return sum + (4 - diff);
  }, 0);
  return flavorScore * 100 + categoryScore * 10 + baseSpiritScore * 10 + tasteScore;
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
  const commentRes = await db.collection(COLLECTIONS.WINE_COMMENT).where({ wine_id: _.in(ids) }).get();
  const statsMap = {};
  unwrapList(commentRes).forEach((item) => {
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

async function listWineTopics(currentUser) {
  const res = await db.collection(COLLECTIONS.WINE_TOPIC).orderBy("created_at", "desc").get();
  const raw = unwrapList(res).filter((item) => item && item.wine_id);
  
  if (!raw.length) {
    return { total: 0, list: [] };
  }

  const wineIds = raw.map((item) => item.wine_id);
  const statsMap = await getWineStatsMap(wineIds);

  // 组装结果
  const list = raw.map((topic) => {
    const stats = statsMap[topic.wine_id] || { rating_count: 0, average_rating: 0, comment_count: 0 };
    return {
      ...topic,
      average_rating: stats.average_rating,
      rating_count: stats.rating_count,
      comment_count: stats.comment_count
    };
  });

  return { total: list.length, list };
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



async function adminListWineTopics(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  let query = {};
  const keyword = String(payload.keyword || "").trim();
  if (keyword) {
    query.name = db.RegExp({ regexp: keyword, options: "i" });
  }
  const orderBy = String(payload.order_by || "name");
  const orderDir = String(payload.order_dir || "asc");
  const res = await db.collection(COLLECTIONS.WINE_TOPIC).where(query).orderBy(orderBy, orderDir === "desc" ? "desc" : "asc").get();
  return { list: unwrapList(res) };
}

async function adminUpsertWineTopic(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const name = assertTextLength(payload.name, "酒名", 50, true);
  // 如果没有提供 wine_id，则自动生成
  let wineId = sanitizeWineId(payload.wine_id);
  if (!wineId) {
    wineId = generateWineId(name);
  }
  const baseWine = {
    wine_id: wineId,
    name,
    category: assertTextLength(payload.category || "", "类别", 30, false),
    flavor: assertTextLength(payload.flavor || "", "风味标签", 80, false),
    base_spirit: assertTextLength(payload.base_spirit || "", "基酒", 30, false),
    acidity: toInt(payload.acidity, 0),
    sweetness: toInt(payload.sweetness, 0),
    bitterness: toInt(payload.bitterness, 0),
    spiciness: toInt(payload.spiciness, 0)
  };
  const sortedSimilarWineIds = await sortSimilarWineIdsBySimilarity(baseWine, payload.similar_wine_ids);
  const patch = {
    wine_id: wineId,
    name,
    category: baseWine.category,
    alcohol: assertTextLength(payload.alcohol || "", "酒精度", 20, false),
    flavor: baseWine.flavor,
    acidity: baseWine.acidity,
    sweetness: baseWine.sweetness,
    bitterness: baseWine.bitterness,
    spiciness: baseWine.spiciness,
    base_spirit: baseWine.base_spirit,
    ingredients: assertTextLength(payload.ingredients || payload.main_ingredients || "", "原料", 150, false),
    main_ingredients: assertTextLength(payload.ingredients || payload.main_ingredients || "", "原料", 150, false),
    keywords: "",
    target_audience: assertTextLength(payload.target_audience || "", "适合人群", 120, false),
    recommended_scenes: assertTextLength(payload.scene || payload.recommended_scenes || "", "适合场景", 120, false),
    taste_note: assertTextLength(payload.taste_note || "", "口感解读", 120, false),
    story: assertTextLength(payload.story || "", "背景故事", 200, false),
    similar_wine_ids: sortedSimilarWineIds,
    similar_recommendations: "",
    scene: assertTextLength(payload.scene || payload.recommended_scenes || "", "适合场景", 120, false),
    summary: assertTextLength(payload.summary || "", "一句话介绍", 100, false),
    image_url: String(payload.image_url || "").trim(),
    updated_at: now()
  };
  const existingRes = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: wineId }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  if (existing) {
    await db.collection(COLLECTIONS.WINE_TOPIC).doc(existing._id).update({ data: patch });
    return { wine_id: wineId, updated: true };
  }
  await db.collection(COLLECTIONS.WINE_TOPIC).add({ data: { ...patch, created_at: now() } });
  return { wine_id: wineId, created: true };
}

async function adminRemoveWineTopic(currentUser, payload) {
  requireRole(currentUser, ROLE.SOMMELIER);
  const wineId = sanitizeWineId(payload.wine_id);
  const existingRes = await db.collection(COLLECTIONS.WINE_TOPIC).where({ wine_id: wineId }).limit(1).get();
  const existing = unwrapDoc(existingRes);
  assert(existing, 3001, "酒款不存在");
  await db.collection(COLLECTIONS.WINE_TOPIC).doc(existing._id).remove();
  return { success: true };
}

async function adminSearchUsers(currentUser, payload) {
  requireRole(currentUser, ROLE.ADMIN);
  const keyword = String(payload.keyword || "").trim();
  const where = keyword ? { nickname: db.RegExp({ regexp: keyword, options: "i" }) } : {};
  const res = await db.collection(COLLECTIONS.USER_PROFILE).where(where).limit(30).get();
  return { list: unwrapList(res) };
}

async function adminSetRoles(currentUser, payload) {
  requireRole(currentUser, ROLE.ADMIN);
  const userId = String(payload.user_id || "").trim();
  assert(userId, 2001, "user_id 不能为空");
  const roles = Array.isArray(payload.roles) ? Array.from(new Set(payload.roles.concat([ROLE.USER]))) : [ROLE.USER];
  await db.collection(COLLECTIONS.USER_PROFILE).doc(userId).update({
    data: {
      roles,
      updated_at: now()
    }
  });
  return { roles };
}

async function handleAction(currentUser, action, payload) {
  switch (action) {
    case "auth.getCurrentUser":
      return ok(currentUser);
    case "points.listLedger":
      return ok(await listPointsLedger(currentUser, payload));
    case "points.adjustByApprover":
      return ok(await adjustPointsByApprover(currentUser, payload));
    case "profile.update":
      return ok(await updateCurrentProfile(currentUser, payload));
    case "approver.getMyRelation":
      return ok(await getMyApproverRelation(currentUser));
    case "approver.getAssignedUserSummary":
      return ok(await getAssignedUserSummary(currentUser));
    case "approver.searchUsers":
      return ok(await searchApproverUsers(currentUser, payload));
    case "approver.invite":
      return ok(await inviteApprover(currentUser, payload));
    case "approver.respondInvitation":
      return ok(await respondApproverInvitation(currentUser, payload));
    case "approver.cancelInvitation":
      return ok(await cancelApproverInvitation(currentUser, payload));
    case "approver.unbind":
      return ok(await unbindApprover(currentUser));
    case "approver.unbindAssignedUser":
      return ok(await unbindAssignedUser(currentUser));
    case "request.createEarn":
      return ok(await createEarnRequest(currentUser, payload));
    case "request.createDrink":
      return ok(await createDrinkRequest(currentUser, payload));
    case "todo.create":
      return ok(await createTodoWork(currentUser, payload));
    case "todo.complete":
      return ok(await completeTodoWork(currentUser, payload));
    case "todo.remove":
      return ok(await removeTodoWork(currentUser, payload));
    case "todo.reopen":
      return ok(await reopenTodoWork(currentUser, payload));
    case "todo.update":
      return ok(await updateTodoWork(currentUser, payload));
    case "request.withdraw":
      return ok(await withdrawRequest(currentUser, payload));
    case "request.listMine":
      return ok(await listMyRequests(currentUser, payload));
    case "todo.listMine":
      return ok(await listMyTodoWorks(currentUser, payload));
    case "request.getDetail":
      return ok(await getRequestDetail(currentUser, payload));
    case "approval.listPending":
      return ok(await listPendingRequests(currentUser, payload));
    case "todo.listPending":
      return ok(await listPendingTodoWorks(currentUser, payload));
    case "approval.listHistory":
      return ok(await listApprovalHistory(currentUser, payload));
    case "approval.removeHistory":
      return ok(await removeApprovalHistory(currentUser, payload));
    case "approval.decide":
      return ok(await decideRequest(currentUser, payload));
    case "notification.listMine":
      return ok(await listMyNotifications(currentUser, payload));
    case "notification.markRead":
      return ok(await markNotificationRead(currentUser, payload));
    case "notification.markAllRead":
      return ok(await markAllNotificationsRead(currentUser));
    case "notification.remove":
      return ok(await removeNotification(currentUser, payload));
    case "drinkDiary.create":
      return ok(await createDrinkDiaryRecord(currentUser, payload));
    case "drinkDiary.listByMonth":
      return ok(await listDrinkDiaryByMonth(currentUser, payload));
    case "drinkDiary.listByDate":
      return ok(await listDrinkDiaryByDate(currentUser, payload));
    case "drinkDiary.getDetail":
      return ok(await getDrinkDiaryDetail(currentUser, payload));
    case "drinkDiary.update":
      return ok(await updateDrinkDiaryRecord(currentUser, payload));
    case "drinkDiary.remove":
      return ok(await removeDrinkDiaryRecord(currentUser, payload));
    case "wine.list":
      return ok(await listWineTopics(currentUser));
    case "wine.getDetail":
      return ok(await getWineTopicDetail(currentUser, payload));
    case "wine.favorite.toggle":
      return ok(await toggleWineFavorite(currentUser, payload));
    case "wine.favorite.listMine":
      return ok(await listMyFavoriteWines(currentUser, payload));
    case "wine.comment.list":
      return ok(await listWineComments(currentUser, payload));
    case "wine.comment.create":
      return ok(await createWineComment(currentUser, payload));
    case "wine.rating.upsert":
      return ok(await upsertWineRating(currentUser, payload));
    case "wine.comment.remove":
      return ok(await removeWineComment(currentUser, payload));
    case "admin.wine.list":
      return ok(await adminListWineTopics(currentUser, payload));
    case "admin.wine.upsert":
      return ok(await adminUpsertWineTopic(currentUser, payload));
    case "admin.wine.remove":
      return ok(await adminRemoveWineTopic(currentUser, payload));
    case "admin.user.search":
      return ok(await adminSearchUsers(currentUser, payload));
    case "admin.user.setRoles":
      return ok(await adminSetRoles(currentUser, payload));
    default:
      throw new AppError(2001, "未知 action");
  }
}

exports.main = async (event) => {
  try {
    const action = String((event && event.action) || "").trim();
    assert(action, 2001, "action 不能为空");
    const currentUser = await ensureCurrentUser(event || {});
    return await handleAction(currentUser, action, (event && event.payload) || {});
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, error.message, error.data);
    }
    console.error("unhandled error", error);
    return fail(5000, error.message || "系统异常", { stack: error.stack });
  }
};


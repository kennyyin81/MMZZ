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
  const result = await db.collection(COLLECTIONS.NOTIFICATION).where({
    user_id: userId,
    read_at: null,
    is_deleted: _.neq(true),
    type: _.neq("approval_pending")
  }).count();
  return Number((result && result.total) || 0);
}

async function getAssignedApplicantForApprover(approverUserId) {
  const result = await db.collection(COLLECTIONS.USER_PROFILE).where({ approver_user_id: approverUserId }).limit(2).get();
  const list = unwrapList(result);
  return list[0] || null;
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

module.exports = {
  cloud,
  db,
  _,
  COLLECTIONS,
  ROLE,
  REQUEST_STATUS,
  INVITATION_STATUS,
  AppError,
  ok,
  fail,
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
  getUserByOpenId,
  ensurePointsAccount,
  getBalanceByUserId,
  changePoints,
  countUnreadNotifications,
  getAssignedApplicantForApprover,
  ensureCurrentUser
};

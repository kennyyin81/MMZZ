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

module.exports = {
  getMyApproverRelation,
  getAssignedUserSummary,
  searchApproverUsers,
  inviteApprover,
  respondApproverInvitation,
  cancelApproverInvitation,
  countPendingRequestsBetween,
  unbindApprover,
  unbindAssignedUser
};

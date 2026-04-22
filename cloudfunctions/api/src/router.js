const { AppError, ok } = require("./context");
const profile = require("./handlers/profile");
const points = require("./handlers/points");
const approver = require("./handlers/approver");
const requests = require("./handlers/requests");
const approval = require("./handlers/approval");
const notifications = require("./handlers/notifications");
const drinkDiary = require("./handlers/drink-diary");
const wine = require("./handlers/wine");
const admin = require("./handlers/admin");

const handlers = {
  "auth.getCurrentUser": async (currentUser) => currentUser,
  "points.listLedger": points.listPointsLedger,
  "points.adjustByApprover": points.adjustPointsByApprover,
  "profile.update": profile.updateCurrentProfile,
  "approver.getMyRelation": approver.getMyApproverRelation,
  "approver.getAssignedUserSummary": approver.getAssignedUserSummary,
  "approver.searchUsers": approver.searchApproverUsers,
  "approver.invite": approver.inviteApprover,
  "approver.respondInvitation": approver.respondApproverInvitation,
  "approver.cancelInvitation": approver.cancelApproverInvitation,
  "approver.unbind": approver.unbindApprover,
  "approver.unbindAssignedUser": approver.unbindAssignedUser,
  "request.createEarn": requests.createEarnRequest,
  "request.createDrink": requests.createDrinkRequest,
  "todo.create": requests.createTodoWork,
  "todo.complete": requests.completeTodoWork,
  "todo.remove": requests.removeTodoWork,
  "todo.reopen": requests.reopenTodoWork,
  "todo.update": requests.updateTodoWork,
  "request.withdraw": requests.withdrawRequest,
  "request.listMine": requests.listMyRequests,
  "todo.listMine": requests.listMyTodoWorks,
  "request.getDetail": requests.getRequestDetail,
  "approval.listPending": approval.listPendingRequests,
  "todo.listPending": approval.listPendingTodoWorks,
  "approval.listHistory": approval.listApprovalHistory,
  "approval.removeHistory": approval.removeApprovalHistory,
  "approval.removeHistoryBatch": approval.removeApprovalHistoryBatch,
  "approval.decide": approval.decideRequest,
  "notification.listMine": notifications.listMyNotifications,
  "notification.markRead": notifications.markNotificationRead,
  "notification.markAllRead": notifications.markAllNotificationsRead,
  "notification.remove": notifications.removeNotification,
  "notification.removeBatch": notifications.removeNotificationBatch,
  "drinkDiary.create": drinkDiary.createDrinkDiaryRecord,
  "drinkDiary.listByMonth": drinkDiary.listDrinkDiaryByMonth,
  "drinkDiary.listByDate": drinkDiary.listDrinkDiaryByDate,
  "drinkDiary.getDetail": drinkDiary.getDrinkDiaryDetail,
  "drinkDiary.update": drinkDiary.updateDrinkDiaryRecord,
  "drinkDiary.remove": drinkDiary.removeDrinkDiaryRecord,
  "wine.list": wine.listWineTopics,
  "wine.getDetail": wine.getWineTopicDetail,
  "wine.favorite.toggle": wine.toggleWineFavorite,
  "wine.favorite.listMine": wine.listMyFavoriteWines,
  "wine.comment.list": wine.listWineComments,
  "wine.comment.create": wine.createWineComment,
  "wine.rating.upsert": wine.upsertWineRating,
  "wine.comment.remove": wine.removeWineComment,
  "admin.wine.list": admin.adminListWineTopics,
  "admin.wine.upsert": admin.adminUpsertWineTopic,
  "admin.wine.remove": admin.adminRemoveWineTopic,
  "admin.user.search": admin.adminSearchUsers,
  "admin.user.setRoles": admin.adminSetRoles
};

async function handleAction(currentUser, action, payload) {
  const handler = handlers[action];
  if (!handler) {
    throw new AppError(2001, "未知 action");
  }
  return ok(await handler(currentUser, payload || {}));
}

module.exports = {
  handleAction,
  handlers
};

const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");

const REQUEST_TYPE_LABEL = {
  earn: "加分",
  drink: "喝酒",
  todo: "待办"
};

function isUnknownActionError(err) {
  const message = String((err && err.message) || "");
  return message.includes("未知action") || message.includes("unknown action");
}

function getFallbackText(item) {
  const type = String(item.type || "").trim();
  const extra = item.extra || {};
  const requestTypeLabel = REQUEST_TYPE_LABEL[extra.request_type] || "申请";

  if (type === "approver_invite") {
    return { title: "审批邀请", content: "你收到了一个新的审批邀请。" };
  }
  if (type === "approver_invite_result") {
    if (extra.decision === "accepted") {
      return { title: "审批邀请已接受", content: "你的审批邀请已被接受。" };
    }
    if (extra.decision === "rejected") {
      return { title: "审批邀请已拒绝", content: "你的审批邀请已被拒绝。" };
    }
    return { title: "审批邀请结果", content: "你的审批邀请状态有更新。" };
  }
  if (type === "approver_invite_cancelled") {
    return { title: "审批邀请已取消", content: "对方已取消审批邀请。" };
  }
  if (type === "approver_unbind") {
    return { title: "审批关系已解除", content: "你与对方的审批关系已解除。" };
  }
  if (type === "approval_pending") {
    return { title: `新的${requestTypeLabel}申请`, content: `有一条${requestTypeLabel}申请等待你处理。` };
  }
  if (type === "approval_result") {
    const decisionLabel = extra.decision === "approved" ? "已通过" : extra.decision === "rejected" ? "已拒绝" : "有结果";
    return { title: `申请${decisionLabel}`, content: `你的${requestTypeLabel}申请${decisionLabel}。` };
  }
  if (type === "points_adjusted") {
    const actionLabel = extra.adjust_type === "subtract" ? "减分" : "加分";
    const pointsText = typeof extra.change_points === "number" ? `${extra.change_points > 0 ? "+" : ""}${extra.change_points}` : "";
    return { title: `审批人已为你${actionLabel}`, content: pointsText ? `你的积分发生变更：${pointsText}。` : "你的积分已被审批人直接调整。" };
  }
  return { title: "系统消息", content: "你有一条新的系统消息。" };
}

function normalizeNotificationText(item) {
  const title = String(item.title || "").trim();
  const content = String(item.content || "").trim();
  const fallback = getFallbackText(item);

  // For known notification types, always render standardized text to avoid
  // historical dirty data affecting display.
  if (String(item.type || "").trim() && fallback.title !== "系统消息") {
    return fallback;
  }

  if (!title || !content) {
    return fallback;
  }

  return {
    title,
    content
  };
}

function applySelection(list, selectedIds) {
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return (Array.isArray(list) ? list : []).map((item) => ({
    ...item,
    selected: selectedSet.has(item._id)
  }));
}

Page({
  data: {
    list: [],
    pageNo: 1,
    pageSize: 20,
    total: 0,
    unreadCount: 0,
    loading: false,
    finished: false,
    marking: false,
    deletingId: "",
    selectedIds: [],
    batchDeleting: false,
    allSelected: false
  },

  onShow() {
    this.resetAndLoad();
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.finished) {
      this.loadList();
    }
  },

  resetAndLoad() {
    this.setData({
      list: [],
      pageNo: 1,
      total: 0,
      unreadCount: 0,
      finished: false,
      selectedIds: [],
      allSelected: false
    });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const data = await callApi("notification.listMine", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        ...normalizeNotificationText(item),
        created_at_text: formatDateTime(item.created_at),
        read: !!item.read_at
      }));
      const merged = applySelection(this.data.list.concat(list), this.data.selectedIds);
      const total = Number(data.total || 0);
      this.setData({
        list: merged,
        total,
        unreadCount: Number(data.unread_count || 0),
        finished: merged.length >= total,
        pageNo: this.data.pageNo + 1,
        allSelected: merged.length > 0 && this.data.selectedIds.length > 0 && merged.every((item) => this.data.selectedIds.includes(item._id))
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async markNotificationReadById(notificationId) {
    if (!notificationId) return;
    await callApi("notification.markRead", {
      notification_id: notificationId
    });
  },

  async markRead(e) {
    const notificationId = e.currentTarget.dataset.id;
    if (!notificationId || this.data.marking) return;

    this.setData({ marking: true });
    try {
      await this.markNotificationReadById(notificationId);
      this.resetAndLoad();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ marking: false });
    }
  },

  async markAllRead() {
    if (this.data.marking || this.data.unreadCount <= 0) return;

    this.setData({ marking: true });
    try {
      await callApi("notification.markAllRead");
      wx.showToast({
        title: "已全部标记已读",
        icon: "success"
      });
      this.resetAndLoad();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ marking: false });
    }
  },

  async removeNotification(e) {
    const notificationId = e.currentTarget.dataset.id;
    if (!notificationId || this.data.deletingId) return;
    this.setData({ deletingId: notificationId });
    try {
      await callApi("notification.remove", {
        notification_id: notificationId
      });
      wx.showToast({
        title: "已删除",
        icon: "success"
      });
      this.resetAndLoad();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ deletingId: "" });
    }
  },

  async openNotification(e) {
    const notificationId = e.currentTarget.dataset.id;
    const type = String(e.currentTarget.dataset.type || "").trim();
    const requestType = String(e.currentTarget.dataset.requestType || "").trim();
    const requestId = String(e.currentTarget.dataset.requestId || "").trim();
    const current = this.data.list.find((item) => item._id === notificationId);

    try {
      if (current && !current.read) {
        await this.markNotificationReadById(notificationId);
      }

      if (type === "approval_pending" && requestType && requestId) {
        wx.navigateTo({
          url: `/pages/approval/detail?requestType=${requestType}&requestId=${requestId}`
        });
        return;
      }

      if (type === "approval_result" && requestType && requestId) {
        wx.navigateTo({
          url: `/pages/request/detail?requestType=${requestType}&requestId=${requestId}`
        });
        return;
      }

      if (type === "points_adjusted") {
        wx.navigateTo({
          url: "/pages/points/ledger"
        });
        return;
      }

      if (["approver_invite", "approver_invite_result", "approver_invite_cancelled", "approver_unbind"].includes(type)) {
        wx.navigateTo({
          url: "/pages/profile/relation"
        });
        return;
      }

      if (current && !current.read) {
        this.resetAndLoad();
      }
    } catch (err) {
      showError(err);
    }
  },

  toggleSelectOne(e) {
    const notificationId = e.currentTarget.dataset.id;
    if (!notificationId) return;
    const selected = this.data.selectedIds.includes(notificationId)
      ? this.data.selectedIds.filter((item) => item !== notificationId)
      : this.data.selectedIds.concat(notificationId);
    this.setData({
      list: applySelection(this.data.list, selected),
      selectedIds: selected,
      allSelected: this.data.list.length > 0 && selected.length === this.data.list.length
    });
  },

  toggleSelectAll() {
    if (!this.data.list.length) return;
    if (this.data.allSelected) {
      this.setData({
        list: applySelection(this.data.list, []),
        selectedIds: [],
        allSelected: false
      });
      return;
    }
    const selected = this.data.list.map((item) => item._id);
    this.setData({
      list: applySelection(this.data.list, selected),
      selectedIds: selected,
      allSelected: true
    });
  },

  async removeSelectedNotifications() {
    if (this.data.batchDeleting || !this.data.selectedIds.length) return;
    this.setData({ batchDeleting: true });
    try {
      try {
        await callApi("notification.removeBatch", {
          notification_ids: this.data.selectedIds
        });
      } catch (err) {
        if (!isUnknownActionError(err)) throw err;
        for (const notificationId of this.data.selectedIds) {
          await callApi("notification.remove", {
            notification_id: notificationId
          });
        }
      }
      wx.showToast({
        title: "已批量删除",
        icon: "success"
      });
      this.resetAndLoad();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ batchDeleting: false });
    }
  }
});

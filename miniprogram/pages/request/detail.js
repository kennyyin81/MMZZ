const { callApi, showError } = require("../../utils/api");
const {
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  formatDateTime,
  getStatusClass
} = require("../../utils/const");

Page({
  data: {
    requestType: "",
    requestId: "",
    request: null,
    approval: null,
    userId: "",
    approver: null,
    loading: false,
    withdrawing: false,
    // 编辑模式
    editing: false,
    editTitle: "",
    editDescription: "",
    editIsRewarded: false,
    editRewardPoints: 1,
    saving: false
  },

  onLoad(options) {
    this.setData({
      requestType: options.requestType || "",
      requestId: options.requestId || ""
    });
  },

  onShow() {
    this.loadAll();
  },

  async loadAll() {
    this.setData({ loading: true, editing: false });
    try {
      const [user, detail] = await Promise.all([
        callApi("auth.getCurrentUser"),
        callApi("request.getDetail", {
          request_type: this.data.requestType,
          request_id: this.data.requestId
        })
      ]);

      const request = detail.request || {};
      request.request_type_label = REQUEST_TYPE_LABEL[request.request_type] || request.request_type;
      request.status_label = REQUEST_STATUS_LABEL[request.status] || request.status;
      request.status_class = getStatusClass(request.status);
      request.submitted_at_text = formatDateTime(request.submitted_at);
      request.decided_at_text = formatDateTime(request.decided_at);

      const approval = detail.approval
        ? {
            ...detail.approval,
            decided_at_text: formatDateTime(detail.approval.decided_at),
            decision_label: detail.approval.decision === "approved" ? "已通过" : "已拒绝",
            decision_class: detail.approval.decision === "approved" ? "status-approved" : "status-rejected"
          }
        : null;

      this.setData({
        userId: user.user_id,
        approver: user.my_approver || null,
        request,
        approval,
        editTitle: request.title || "",
        editDescription: request.description || "",
        editIsRewarded: !!request.is_rewarded,
        editRewardPoints: request.reward_points || 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  canEdit() {
    const request = this.data.request;
    if (!request) return false;
    return request.request_type === "todo" && request.status === "todo" && request.user_id === this.data.userId;
  },

  startEdit() {
    if (!this.canEdit()) return;
    const request = this.data.request;
    this.setData({
      editing: true,
      editTitle: request.title || "",
      editDescription: request.description || "",
      editIsRewarded: !!request.is_rewarded,
      editRewardPoints: request.reward_points || 1
    });
  },

  cancelEdit() {
    this.setData({ editing: false });
  },

  onTitleInput(e) {
    this.setData({ editTitle: e.detail.value });
  },

  onDescInput(e) {
    this.setData({ editDescription: e.detail.value });
  },

  onRewardSwitch(e) {
    const checked = !!e.detail.value;
    if (checked && !this.data.approver) {
      wx.showToast({
        title: "请先绑定审批人",
        icon: "none"
      });
      this.setData({ editIsRewarded: false });
      return;
    }
    this.setData({ editIsRewarded: checked });
  },

  onRewardInput(e) {
    const val = Number(String(e.detail.value || "").replace(/[^\d]/g, "")) || 0;
    this.setData({ editRewardPoints: val });
  },

  async saveEdit() {
    if (this.data.saving) return;
    const title = String(this.data.editTitle || "").trim();
    if (!title) {
      wx.showToast({ title: "请输入标题", icon: "none" });
      return;
    }
    if (this.data.editIsRewarded && !this.data.approver) {
      wx.showToast({ title: "请先绑定审批人", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    try {
      await callApi("todo.update", {
        todo_id: this.data.requestId,
        title,
        description: this.data.editDescription,
        is_rewarded: this.data.editIsRewarded,
        reward_points: this.data.editIsRewarded ? this.data.editRewardPoints : 0
      });
      wx.showToast({ title: "已保存", icon: "success" });
      this.setData({ editing: false });
      this.loadAll();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ saving: false });
    }
  },

  canWithdraw() {
    const request = this.data.request;
    if (!request) return false;
    return request.status === "pending" && request.user_id === this.data.userId;
  },

  async withdraw() {
    if (this.data.withdrawing) return;
    if (!this.canWithdraw()) return;

    this.setData({ withdrawing: true });
    try {
      await callApi("request.withdraw", {
        request_type: this.data.requestType,
        request_id: this.data.requestId
      });
      wx.showToast({ title: "已撤回", icon: "success" });
      this.loadAll();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ withdrawing: false });
    }
  },

  async completeTodo() {
    const request = this.data.request;
    if (!request || request.status !== "todo") return;

    try {
      const result = await callApi("todo.complete", { todo_id: this.data.requestId });
      wx.showToast({ title: result.message, icon: "success" });
      this.loadAll();
    } catch (err) {
      showError(err);
    }
  },

  async deleteTodo() {
    const request = this.data.request;
    if (!request) return;

    wx.showModal({
      title: "删除待办",
      content: `确认删除「${request.title}」？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await callApi("todo.remove", { todo_id: this.data.requestId });
            wx.showToast({ title: "已删除", icon: "success" });
            setTimeout(() => wx.navigateBack(), 500);
          } catch (err) {
            showError(err);
          }
        }
      }
    });
  },

  async reopenTodo() {
    const request = this.data.request;
    if (!request || request.status !== "completed") return;

    try {
      await callApi("todo.reopen", { todo_id: this.data.requestId });
      wx.showToast({ title: "已重新打开", icon: "success" });
      this.loadAll();
    } catch (err) {
      showError(err);
    }
  }
});

const { callApi, showError } = require("../../utils/api");

function toPositiveInt(value) {
  const parsed = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

Page({
  data: {
    reason: "",
    costPoints: 1,
    balance: 0,
    approver: null,
    insufficient: false,
    canSubmit: false,
    submitting: false
  },

  onShow() {
    this.loadPageData();
  },

  async loadPageData() {
    try {
      const userData = await callApi("auth.getCurrentUser");
      const balance = Number(userData.balance || 0);
      const costPoints = Math.max(1, Number(this.data.costPoints || 1));
      const hasApprover = !!userData.my_approver;
      const insufficient = balance < costPoints;

      this.setData({
        costPoints,
        balance,
        approver: userData.my_approver || null,
        insufficient,
        canSubmit: hasApprover && costPoints > 0 && !insufficient
      });
    } catch (err) {
      showError(err);
    }
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value });
  },

  onCostPointsInput(e) {
    const costPoints = toPositiveInt(e.detail.value);
    const insufficient = costPoints > 0 && this.data.balance < costPoints;
    this.setData({
      costPoints,
      insufficient,
      canSubmit: !!this.data.approver && costPoints > 0 && !insufficient
    });
  },

  async submit() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.approver) {
      wx.showToast({
        title: "请先在我的页面绑定审批人",
        icon: "none"
      });
      return;
    }
    if (!this.data.costPoints || this.data.costPoints <= 0) {
      wx.showToast({
        title: "请输入本次消耗积分",
        icon: "none"
      });
      return;
    }
    if (this.data.insufficient) {
      wx.showToast({
        title: "积分不足，无法提交申请",
        icon: "none"
      });
      return;
    }

    this.setData({ submitting: true });
    try {
      const result = await callApi("request.createDrink", {
        reason: this.data.reason,
        cost_points: this.data.costPoints
      });
      wx.showToast({ title: "提交成功", icon: "success" });
      setTimeout(() => {
        wx.navigateTo({
          url: `/pages/request/detail?requestType=drink&requestId=${result.request_id}`
        });
      }, 450);
    } catch (err) {
      showError(err);
      if (err.code === 4001 || err.code === 3005) {
        this.loadPageData();
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});

const { callApi, showError } = require("../../utils/api");

Page({
  data: {
    behaviorType: "",
    description: "",
    requestedPoints: 1,
    approver: null,
    canSubmit: false,
    submitting: false
  },

  onShow() {
    this.loadApprover();
  },

  async loadApprover() {
    try {
      const data = await callApi("auth.getCurrentUser");
      this.setData({
        approver: data.my_approver || null,
        canSubmit: !!data.my_approver
      });
    } catch (err) {
      showError(err);
    }
  },

  onBehaviorInput(e) {
    this.setData({ behaviorType: e.detail.value });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
  },

  onPointsInput(e) {
    this.setData({ requestedPoints: e.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.canSubmit) {
      wx.showToast({
        title: "请先在个人中心绑定审批人",
        icon: "none"
      });
      return;
    }

    this.setData({ submitting: true });
    try {
      await callApi("request.createEarn", {
        behavior_type: this.data.behaviorType,
        description: this.data.description,
        requested_points: Number(this.data.requestedPoints)
      });
      wx.showToast({ title: "提交成功", icon: "success" });
      setTimeout(() => {
        wx.navigateTo({ url: "/pages/request/my-list" });
      }, 500);
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ submitting: false });
    }
  }
});

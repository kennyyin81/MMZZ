const { callApi, showError } = require("../../utils/api");

Page({
  data: {
    title: "",
    description: "",
    isRewarded: false,
    rewardPoints: 1,
    approver: null,
    submitting: false
  },

  onShow() {
    this.loadUser();
  },

  async loadUser() {
    try {
      const user = await callApi("auth.getCurrentUser");
      this.setData({
        approver: user.my_approver || null
      });
    } catch (err) {
      showError(err);
    }
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value });
  },

  onRewardSwitch(e) {
    this.setData({ isRewarded: !!e.detail.value });
  },

  onRewardPointsInput(e) {
    const rewardPoints = Number(String(e.detail.value || "").replace(/[^\d]/g, "")) || 0;
    this.setData({ rewardPoints });
  },

  async submit() {
    if (this.data.submitting) return;
    const title = String(this.data.title || "").trim();
    if (!title) {
      wx.showToast({ title: "请输入标题", icon: "none" });
      return;
    }
    if (this.data.isRewarded && !this.data.approver) {
      wx.showToast({
        title: "请先绑定审批人",
        icon: "none"
      });
      return;
    }
    if (this.data.isRewarded && this.data.rewardPoints <= 0) {
      wx.showToast({ title: "请输入奖励积分", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      await callApi("todo.create", {
        title,
        description: this.data.description,
        is_rewarded: this.data.isRewarded,
        reward_points: this.data.isRewarded ? this.data.rewardPoints : 0
      });
      wx.showToast({
        title: "已创建",
        icon: "success"
      });
      setTimeout(() => {
        wx.switchTab({
          url: "/pages/request/my-list"
        });
      }, 400);
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ submitting: false });
    }
  }
});

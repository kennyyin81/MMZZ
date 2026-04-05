const { callApi, showError } = require("../../utils/api");

Page({
  data: {
    loading: false,
    submitting: false,
    assignedUser: null,
    adjustType: "add",
    points: 1,
    remark: "",
    canSubmit: false
  },

  onShow() {
    this.loadAssignedUser();
  },

  async loadAssignedUser() {
    this.setData({ loading: true });
    try {
      const data = await callApi("approver.getAssignedUserSummary");
      this.setData({
        assignedUser: data || null,
        canSubmit: !!(data && data.user_id)
      });
    } catch (err) {
      this.setData({
        assignedUser: null,
        canSubmit: false
      });
      if (!err || err.code !== 3002) {
        showError(err);
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  switchAdjustType(e) {
    const adjustType = e.currentTarget.dataset.type;
    if (!adjustType || adjustType === this.data.adjustType) return;
    const currentPoints = Number(this.data.points || 0);
    let nextPoints = currentPoints;
    if (adjustType === "subtract" && currentPoints > 0) {
      nextPoints = -currentPoints;
    } else if (adjustType === "add" && currentPoints < 0) {
      nextPoints = Math.abs(currentPoints);
    }
    this.setData({
      adjustType,
      points: nextPoints
    });
  },

  onPointsInput(e) {
    const text = String(e.detail.value || "").replace(/[^\d-]/g, "");
    const normalized = text.startsWith("-") ? `-${text.slice(1).replace(/-/g, "")}` : text.replace(/-/g, "");
    const points = Number(normalized) || 0;
    this.setData({ points });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.canSubmit) {
      wx.showToast({ title: "当前没有被审批人", icon: "none" });
      return;
    }
    if (Number(this.data.points || 0) === 0) {
      wx.showToast({ title: "请输入调整积分", icon: "none" });
      return;
    }
    if (!String(this.data.remark || "").trim()) {
      wx.showToast({ title: "请输入调整说明", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const data = await callApi("points.adjustByApprover", {
        adjust_type: this.data.adjustType,
        points: this.data.points,
        remark: this.data.remark
      });
      const assignedUser = this.data.assignedUser
        ? {
            ...this.data.assignedUser,
            balance: Number(data.balance || 0)
          }
        : null;

      this.setData({
        assignedUser,
        points: this.data.adjustType === "subtract" ? -1 : 1,
        remark: ""
      });

      wx.showToast({
        title: this.data.adjustType === "add" ? "加分成功" : "减分成功",
        icon: "success"
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ submitting: false });
    }
  }
});

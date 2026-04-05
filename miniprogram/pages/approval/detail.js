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
    comment: "",
    loading: false,
    submitting: false
  },

  onLoad(options) {
    this.setData({
      requestType: options.requestType || "",
      requestId: options.requestId || ""
    });
  },

  onShow() {
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.requestType || !this.data.requestId) {
      wx.showToast({
        title: "审批单参数缺失",
        icon: "none"
      });
      return;
    }

    this.setData({ loading: true });
    try {
      const detail = await callApi("request.getDetail", {
        request_type: this.data.requestType,
        request_id: this.data.requestId
      });

      const rawRequest = detail.request || {};
      const rawApproval = detail.approval || null;

      const request = {
        ...rawRequest,
        request_type_label: REQUEST_TYPE_LABEL[rawRequest.request_type] || rawRequest.request_type || "-",
        status_label: REQUEST_STATUS_LABEL[rawRequest.status] || rawRequest.status || "-",
        status_class: getStatusClass(rawRequest.status),
        submitted_at_text: formatDateTime(rawRequest.submitted_at),
        decided_at_text: formatDateTime(rawRequest.decided_at)
      };

      const approval = rawApproval
        ? {
            ...rawApproval,
            decision_label: rawApproval.decision === "approved" ? "已通过" : "已拒绝",
            decision_class: rawApproval.decision === "approved" ? "status-approved" : "status-rejected",
            decided_at_text: formatDateTime(rawApproval.decided_at)
          }
        : null;

      this.setData({
        request,
        approval
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onCommentInput(e) {
    this.setData({
      comment: e.detail.value
    });
  },

  async decide(e) {
    if (this.data.submitting) return;

    const decision = e.currentTarget.dataset.decision;
    if (!decision) return;

    this.setData({ submitting: true });
    try {
      await callApi("approval.decide", {
        request_type: this.data.requestType,
        request_id: this.data.requestId,
        decision,
        comment: this.data.comment.trim()
      });

      wx.showToast({
        title: "审批成功",
        icon: "success"
      });

      this.setData({ comment: "" });
      this.loadDetail();
    } catch (err) {
      if (err && err.code === 4001) {
        wx.showToast({
          title: "余额不足，已自动拒绝",
          icon: "none",
          duration: 2200
        });
        this.loadDetail();
      } else {
        showError(err);
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});

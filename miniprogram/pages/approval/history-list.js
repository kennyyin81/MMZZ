const { callApi, showError } = require("../../utils/api");
const { REQUEST_TYPE_LABEL, formatDateTime } = require("../../utils/const");

const TYPE_OPTIONS = [
  { label: "全部", value: "" },
  { label: "加分申请", value: "earn" },
  { label: "喝酒申请", value: "drink" },
  { label: "待办工作", value: "todo" }
];

function isUnknownActionError(err) {
  const message = String((err && err.message) || "");
  return message.includes("未知action") || message.includes("unknown action");
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
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    list: [],
    pageNo: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    finished: false,
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

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value || 0) });
    this.resetAndLoad();
  },

  resetAndLoad() {
    this.setData({
      list: [],
      pageNo: 1,
      total: 0,
      finished: false,
      selectedIds: [],
      allSelected: false
    });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const requestType = this.data.typeOptions[this.data.typeIndex].value;
      const data = await callApi("approval.listHistory", {
        request_type: requestType,
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        request_type_label: REQUEST_TYPE_LABEL[item.request_type] || item.request_type,
        decision_label: item.decision === "approved" ? "已通过" : "已拒绝",
        decision_class: item.decision === "approved" ? "status-approved" : "status-rejected",
        decided_at_text: formatDateTime(item.decided_at)
      }));
      const merged = applySelection(this.data.list.concat(list), this.data.selectedIds);
      const total = Number(data.total || 0);
      this.setData({
        list: merged,
        total,
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

  goDetail(e) {
    const requestType = e.currentTarget.dataset.type;
    const requestId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/approval/detail?requestType=${requestType}&requestId=${requestId}`
    });
  },

  async removeHistory(e) {
    const approvalId = e.currentTarget.dataset.id;
    if (!approvalId || this.data.deletingId) return;
    this.setData({ deletingId: approvalId });
    try {
      await callApi("approval.removeHistory", {
        approval_id: approvalId
      });
      wx.showToast({ title: "已删除", icon: "success" });
      this.resetAndLoad();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ deletingId: "" });
    }
  },

  toggleSelectOne(e) {
    const approvalId = e.currentTarget.dataset.id;
    if (!approvalId) return;
    const selected = this.data.selectedIds.includes(approvalId)
      ? this.data.selectedIds.filter((item) => item !== approvalId)
      : this.data.selectedIds.concat(approvalId);
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

  async removeSelectedHistories() {
    if (this.data.batchDeleting || !this.data.selectedIds.length) return;
    this.setData({ batchDeleting: true });
    try {
      try {
        await callApi("approval.removeHistoryBatch", {
          approval_ids: this.data.selectedIds
        });
      } catch (err) {
        if (!isUnknownActionError(err)) throw err;
        for (const approvalId of this.data.selectedIds) {
          await callApi("approval.removeHistory", {
            approval_id: approvalId
          });
        }
      }
      wx.showToast({ title: "已批量删除", icon: "success" });
      this.resetAndLoad();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ batchDeleting: false });
    }
  }
});

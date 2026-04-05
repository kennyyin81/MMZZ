const { callApi, showError } = require("../../utils/api");
const {
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  formatDateTime,
  getStatusClass
} = require("../../utils/const");

const TYPE_OPTIONS = [
  { label: "全部", value: "" },
  { label: "加分申请", value: "earn" },
  { label: "喝酒申请", value: "drink" },
  { label: "待办工作", value: "todo" }
];

Page({
  data: {
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    list: [],
    pageNo: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    finished: false
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

  goHistory() {
    wx.navigateTo({
      url: "/pages/approval/history-list"
    });
  },

  resetAndLoad() {
    this.setData({
      list: [],
      pageNo: 1,
      total: 0,
      finished: false
    });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const requestType = this.data.typeOptions[this.data.typeIndex].value;
      const data = await callApi("approval.listPending", {
        request_type: requestType,
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        request_type_label: REQUEST_TYPE_LABEL[item.request_type] || item.request_type,
        status_label: REQUEST_STATUS_LABEL[item.status] || item.status,
        status_class: getStatusClass(item.status),
        submitted_at_text: formatDateTime(item.submitted_at)
      }));
      const merged = this.data.list.concat(list);
      const total = Number(data.total || 0);
      this.setData({
        list: merged,
        total,
        finished: merged.length >= total,
        pageNo: this.data.pageNo + 1
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
  }
});

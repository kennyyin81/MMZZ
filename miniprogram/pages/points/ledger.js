const { callApi, showError } = require("../../utils/api");
const { formatDateTime, formatPointsChange, getLedgerSourceLabel } = require("../../utils/const");

Page({
  data: {
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
      const data = await callApi("points.listLedger", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });

      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: formatDateTime(item.created_at),
        source_type_label: getLedgerSourceLabel(item.source_type),
        change_text: formatPointsChange(item.change_points),
        change_class: Number(item.change_points) >= 0 ? "ledger-positive" : "ledger-negative"
      }));
      const nextList = this.data.list.concat(list);
      const total = Number(data.total || 0);
      const finished = nextList.length >= total;

      this.setData({
        list: nextList,
        total,
        finished,
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  }
});

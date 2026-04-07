const { callApi, showError } = require("../../utils/api");
const { formatDateTime, openPage } = require("../../utils/const");
const { mergeWineMeta } = require("../../utils/wine-data");

function decorateWine(item) {
  const wine = mergeWineMeta(item || {});
  return {
    ...wine,
    averageRatingText: Number(wine.average_rating || 0).toFixed(1),
    favorite_created_at_text: formatDateTime(wine.favorite_created_at)
  };
}

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
      const data = await callApi("wine.favorite.listMine", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map(decorateWine);
      const nextList = this.data.list.concat(list);
      const total = Number(data.total || 0);
      this.setData({
        list: nextList,
        total,
        finished: nextList.length >= total,
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    openPage(`/pages/wine/detail?wineId=${wineId}`);
  }
});

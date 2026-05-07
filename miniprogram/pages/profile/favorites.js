const { callApi, showError } = require("../../utils/api");
const { formatDateTime, openPage } = require("../../utils/const");
const { mergeWineMeta } = require("../../utils/wine-data");

function timeAgo(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDateTime(value);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return formatDateTime(value);
}

function decorateWine(item) {
  const wine = mergeWineMeta(item || {});
  return {
    ...wine,
    averageRatingText: Number(wine.average_rating || 0) > 0 ? Number(wine.average_rating).toFixed(1) : "暂无",
    favorite_created_at_text: formatDateTime(wine.favorite_created_at)
  };
}

Page({
  data: {
    activeTab: "wine",
    // 酒款收藏
    wineList: [],
    winePageNo: 1,
    winePageSize: 20,
    wineTotal: 0,
    wineLoading: false,
    wineFinished: false,
    // 动态收藏
    postList: [],
    postPageNo: 1,
    postPageSize: 10,
    postTotal: 0,
    postLoading: false,
    postFinished: false
  },

  onShow() {
    this.resetAndLoad();
  },

  onReachBottom() {
    if (this.data.activeTab === "wine") {
      if (!this.data.wineLoading && !this.data.wineFinished) {
        this.loadWineList();
      }
    } else {
      if (!this.data.postLoading && !this.data.postFinished) {
        this.loadPostList();
      }
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === "wine" && !this.data.wineList.length) {
      this.resetWineAndLoad();
    } else if (tab === "post" && !this.data.postList.length) {
      this.resetPostAndLoad();
    }
  },

  resetAndLoad() {
    if (this.data.activeTab === "wine") {
      this.resetWineAndLoad();
    } else {
      this.resetPostAndLoad();
    }
  },

  resetWineAndLoad() {
    this.setData({
      wineList: [],
      winePageNo: 1,
      wineTotal: 0,
      wineFinished: false
    });
    this.loadWineList();
  },

  resetPostAndLoad() {
    this.setData({
      postList: [],
      postPageNo: 1,
      postTotal: 0,
      postFinished: false
    });
    this.loadPostList();
  },

  async loadWineList() {
    this.setData({ wineLoading: true });
    try {
      const data = await callApi("wine.favorite.listMine", {
        page_no: this.data.winePageNo,
        page_size: this.data.winePageSize
      });
      const list = (data.list || []).map(decorateWine);
      const nextList = this.data.wineList.concat(list);
      const total = Number(data.total || 0);
      this.setData({
        wineList: nextList,
        wineTotal: total,
        wineFinished: nextList.length >= total,
        winePageNo: this.data.winePageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ wineLoading: false });
    }
  },

  async loadPostList() {
    this.setData({ postLoading: true });
    try {
      const data = await callApi("square.favorite.listMine", {
        page_no: this.data.postPageNo,
        page_size: this.data.postPageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: timeAgo(item.created_at),
        favorite_created_at_text: formatDateTime(item.favorite_created_at)
      }));
      const nextList = this.data.postList.concat(list);
      const total = Number(data.total || 0);
      this.setData({
        postList: nextList,
        postTotal: total,
        postFinished: nextList.length >= total,
        postPageNo: this.data.postPageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ postLoading: false });
    }
  },

  goWineDetail(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    openPage(`/pages/wine/detail?wineId=${wineId}`);
  },

  goPostDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    openPage(`/pages/square/detail?postId=${id}`);
  }
});

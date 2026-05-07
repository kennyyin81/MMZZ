const { callApi, showError } = require("../../utils/api");
const { formatDateTime, openPage } = require("../../utils/const");

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

Page({
  data: {
    list: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    loading: false,
    finished: false,
    needRefresh: false
  },

  onShow() {
    if (this.data.needRefresh || wx.getStorageSync("my_posts_need_refresh")) {
      wx.removeStorageSync("my_posts_need_refresh");
      this.resetAndLoad();
    } else if (!this.data.list.length) {
      this.resetAndLoad();
    }
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
      finished: false,
      needRefresh: false
    });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const data = await callApi("square.listMine", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: timeAgo(item.created_at)
      }));
      const nextList = this.data.list.concat(list);
      this.setData({
        list: nextList,
        total: Number(data.total || 0),
        finished: nextList.length >= Number(data.total || 0),
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  goPostDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ needRefresh: true });
    openPage(`/pages/square/detail?postId=${id}`);
  }
});

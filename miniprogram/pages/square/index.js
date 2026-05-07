const { callApi, showError } = require("../../utils/api");
const { syncTabBar, formatDateTime } = require("../../utils/const");

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
    loading: false,
    list: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    finished: false,
    needRefresh: false
  },

  onLoad() {
    this.loadPosts();
  },

  onShow() {
    syncTabBar("/pages/square/index");
    if (this.data.needRefresh || wx.getStorageSync("square_need_refresh")) {
      wx.removeStorageSync("square_need_refresh");
      this.refreshPosts();
    }
  },

  onPullDownRefresh() {
    this.refreshPosts().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.finished && !this.data.loading) {
      this.loadPosts();
    }
  },

  async loadPosts() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const data = await callApi("square.list", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: timeAgo(item.created_at)
      }));
      const merged = this.data.list.concat(list);
      this.setData({
        list: merged,
        total: Number(data.total || 0),
        finished: merged.length >= Number(data.total || 0),
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async refreshPosts() {
    this.setData({ needRefresh: false, pageNo: 1, list: [], finished: false });
    await this.loadPosts();
  },

  goPostDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ needRefresh: true });
    wx.navigateTo({ url: `/pages/square/detail?postId=${id}` });
  },

  async onLikeTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = this.data.list.find((p) => p._id === id);
    if (!item) return;
    try {
      const res = await callApi("square.like.toggle", { post_id: id });
      const index = this.data.list.findIndex((p) => p._id === id);
      if (index < 0) return;
      const isLiked = !!res.is_liked;
      const likeCount = Number(item.like_count || 0) + (isLiked ? 1 : -1);
      this.setData({
        [`list[${index}].is_liked`]: isLiked,
        [`list[${index}].like_count`]: Math.max(0, likeCount)
      });
    } catch (err) {
      showError(err);
    }
  }
});

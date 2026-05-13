const { callApi, showError } = require("../../utils/api");
const { syncTabBar, smartTimeAgo } = require("../../utils/const");

function splitColumns(list) {
  const left = [];
  const right = [];
  list.forEach((item, i) => {
    if (i % 2 === 0) left.push(item);
    else right.push(item);
  });
  return { left, right };
}

Page({
  data: {
    loading: false,
    list: [],
    leftList: [],
    rightList: [],
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
      const list = (data.list || []).map((item) => Object.assign({}, item, {
        created_at_text: smartTimeAgo(item.created_at)
      }));
      const merged = this.data.list.concat(list);
      const { left, right } = splitColumns(merged);
      this.setData({
        list: merged,
        leftList: left,
        rightList: right,
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
    this.setData({ needRefresh: false, pageNo: 1, list: [], leftList: [], rightList: [], finished: false });
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
      const updated = this.data.list.slice();
      updated[index] = Object.assign({}, updated[index], {
        is_liked: isLiked,
        like_count: Math.max(0, likeCount)
      });
      const { left, right } = splitColumns(updated);
      this.setData({ list: updated, leftList: left, rightList: right });
    } catch (err) {
      showError(err);
    }
  },

  onShareAppMessage() {
    return {
      title: "酒友广场 - 发现身边的酒友动态",
      path: "/pages/square/index"
    };
  }
});

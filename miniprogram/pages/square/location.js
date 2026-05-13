const { callApi, showError } = require("../../utils/api");
const { smartTimeAgo } = require("../../utils/const");

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
    locationName: "",
    locationText: "",
    loading: false,
    list: [],
    leftList: [],
    rightList: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    finished: false
  },

  onLoad(options) {
    const locationName = decodeURIComponent(String(options.locationName || "")).trim();
    const locationText = decodeURIComponent(String(options.locationText || "")).trim();
    if (!locationName) {
      wx.showToast({ title: "缺少地点信息", icon: "none" });
      return;
    }
    this.setData({ locationName, locationText });
    wx.setNavigationBarTitle({ title: locationText || locationName });
    this.loadPosts();
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
      const data = await callApi("square.listByLocation", {
        location_name: this.data.locationName,
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
    this.setData({ pageNo: 1, list: [], leftList: [], rightList: [], finished: false });
    await this.loadPosts();
  },

  goPostDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
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
      title: `${this.data.locationText || this.data.locationName} - 酒友广场`,
      path: `/pages/square/location?locationName=${encodeURIComponent(this.data.locationName)}&locationText=${encodeURIComponent(this.data.locationText)}`
    };
  },

  onShareTimeline() {
    return {
      title: `${this.data.locationText || this.data.locationName} - 酒友广场`,
      query: `locationName=${encodeURIComponent(this.data.locationName)}&locationText=${encodeURIComponent(this.data.locationText)}`
    };
  }
});

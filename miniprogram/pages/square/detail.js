const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");

Page({
  data: {
    postId: "",
    post: null,
    loading: false,
    hasLoaded: false,
    comments: [],
    commentInput: "",
    pageNo: 1,
    pageSize: 20,
    total: 0,
    finished: false,
    deleting: false
  },

  onLoad(options) {
    const postId = String(options.postId || "").trim();
    this.setData({ postId });
  },

  onShow() {
    if (this.data.postId && !this.data.hasLoaded) {
      this.loadDetail();
    }
  },

  async loadDetail() {
    this.setData({ loading: true, comments: [], pageNo: 1, finished: false });
    try {
      const data = await callApi("square.getDetail", { post_id: this.data.postId });
      const post = data.post || {};
      post.created_at_text = formatDateTime(post.created_at);
      this.setData({ post, hasLoaded: true });
      await this.loadComments();
    } catch (err) {
      showError(err);
      this.setData({ hasLoaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadComments() {
    try {
      const data = await callApi("square.comment.list", {
        post_id: this.data.postId,
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: formatDateTime(item.created_at)
      }));
      const merged = this.data.comments.concat(list);
      this.setData({
        comments: merged,
        total: Number(data.total || 0),
        finished: merged.length >= Number(data.total || 0),
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    }
  },

  onReachBottom() {
    if (!this.data.finished && !this.data.loading) {
      this.loadComments();
    }
  },

  onCommentInput(e) {
    this.setData({ commentInput: e.detail.value });
  },

  async submitComment() {
    const content = String(this.data.commentInput || "").trim();
    if (!content) {
      wx.showToast({ title: "请输入评论", icon: "none" });
      return;
    }
    try {
      await callApi("square.comment.create", {
        post_id: this.data.postId,
        content
      });
      wx.showToast({ title: "已评论", icon: "success" });
      this.setData({ commentInput: "" });
      await this.loadDetail();
    } catch (err) {
      showError(err);
    }
  },

  async toggleLike() {
    if (!this.data.post) return;
    try {
      const res = await callApi("square.like.toggle", { post_id: this.data.postId });
      const post = { ...this.data.post };
      post.is_liked = !!res.is_liked;
      post.like_count = Math.max(0, Number(post.like_count || 0) + (post.is_liked ? 1 : -1));
      this.setData({ post });
    } catch (err) {
      showError(err);
    }
  },

  async toggleFavorite() {
    if (!this.data.post) return;
    try {
      const res = await callApi("square.favorite.toggle", { post_id: this.data.postId });
      const post = { ...this.data.post };
      post.is_favorited = !!res.is_favorited;
      post.favorite_count = Math.max(0, Number(post.favorite_count || 0) + (post.is_favorited ? 1 : -1));
      this.setData({ post });
      wx.showToast({ title: post.is_favorited ? "已收藏" : "已取消收藏", icon: "success" });
    } catch (err) {
      showError(err);
    }
  },

  async removeComment(e) {
    const commentId = e.currentTarget.dataset.id;
    if (!commentId) return;
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: "删除后不可恢复",
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes.confirm) return;
    try {
      await callApi("square.comment.remove", { comment_id: commentId });
      wx.showToast({ title: "已删除", icon: "success" });
      await this.loadDetail();
    } catch (err) {
      showError(err);
    }
  },

  async removePost() {
    if (!this.data.post || this.data.deleting) return;
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: "删除广场动态不会删除原喝酒记录，确定删除吗？",
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes.confirm) return;
    this.setData({ deleting: true });
    try {
      await callApi("square.remove", { post_id: this.data.postId });
      wx.showToast({ title: "已删除", icon: "success" });
      wx.setStorageSync("square_need_refresh", true);
      wx.setStorageSync("my_posts_need_refresh", true);
      setTimeout(() => wx.navigateBack({ delta: 1 }), 400);
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ deleting: false });
    }
  },

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const images = this.data.post.images || [];
    const urls = images.map((item) => item.url).filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: urls[index] || urls[0], urls });
  }
});

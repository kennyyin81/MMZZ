const { callApi, showError } = require("../../utils/api");
const { smartTimeAgo } = require("../../utils/const");

const REPLY_PREVIEW_COUNT = 1;

function groupComments(flatList) {
  const topLevel = [];
  const replyMap = {};
  flatList.forEach((item) => {
    if (item.reply_to_id) {
      if (!replyMap[item.reply_to_id]) replyMap[item.reply_to_id] = [];
      replyMap[item.reply_to_id].push(item);
    } else {
      topLevel.push(item);
    }
  });
  return topLevel.map((parent) => {
    const allReplies = replyMap[parent.comment_id] || [];
    return {
      ...parent,
      replies: allReplies,
      reply_count: allReplies.length,
      displayReplies: allReplies.slice(0, REPLY_PREVIEW_COUNT),
      hiddenReplyCount: Math.max(0, allReplies.length - REPLY_PREVIEW_COUNT),
      expanded: allReplies.length <= REPLY_PREVIEW_COUNT
    };
  });
}

Page({
  data: {
    postId: "",
    post: null,
    loading: false,
    hasLoaded: false,
    comments: [],
    commentInput: "",
    commentFocus: false,
    replyToId: "",
    replyToNickname: "",
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
      post.created_at_text = smartTimeAgo(post.created_at);
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
        created_at_text: smartTimeAgo(item.created_at),
        like_count: Number(item.like_count || 0),
        is_liked: !!item.is_liked,
        reply_to_nickname: item.reply_to_nickname || ""
      }));
      const merged = this.data.comments.concat(list);
      const grouped = groupComments(merged);
      this.setData({
        comments: grouped,
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

  focusCommentInput() {
    this.setData({ commentFocus: true });
  },

  onCommentBlur() {
    this.setData({ commentFocus: false });
  },

  replyToComment(e) {
    const id = e.currentTarget.dataset.id;
    const nickname = e.currentTarget.dataset.nickname || "微信用户";
    this.setData({ replyToId: id, replyToNickname: nickname, commentFocus: true });
  },

  clearReply() {
    this.setData({ replyToId: "", replyToNickname: "" });
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
      const payload = {
        post_id: this.data.postId,
        content
      };
      if (this.data.replyToId) {
        payload.reply_to_id = this.data.replyToId;
      }
      await callApi("square.comment.create", payload);
      wx.showToast({ title: "已评论", icon: "success" });
      this.setData({ commentInput: "", commentFocus: false, replyToId: "", replyToNickname: "" });
      await this.loadDetail();
    } catch (err) {
      showError(err);
    }
  },

  toggleReplies(e) {
    const commentId = e.currentTarget.dataset.id;
    const index = this.data.comments.findIndex((c) => c.comment_id === commentId);
    if (index < 0) return;
    const comment = this.data.comments[index];
    const expanded = !comment.expanded;
    const displayReplies = expanded ? comment.replies : comment.replies.slice(0, REPLY_PREVIEW_COUNT);
    this.setData({
      [`comments[${index}].expanded`]: expanded,
      [`comments[${index}].displayReplies`]: displayReplies
    });
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

  async toggleCommentLike(e) {
    const commentId = e.currentTarget.dataset.id;
    if (!commentId) return;
    try {
      const res = await callApi("square.comment.like.toggle", { comment_id: commentId });
      const isLiked = !!res.is_liked;
      this._updateCommentLike(commentId, isLiked);
    } catch (err) {
      showError(err);
    }
  },

  _updateCommentLike(commentId, isLiked) {
    const comments = this.data.comments;
    for (let i = 0; i < comments.length; i++) {
      if (comments[i].comment_id === commentId) {
        const likeCount = Number(comments[i].like_count || 0) + (isLiked ? 1 : -1);
        this.setData({
          [`comments[${i}].is_liked`]: isLiked,
          [`comments[${i}].like_count`]: Math.max(0, likeCount)
        });
        return;
      }
      const replies = comments[i].replies || [];
      for (let j = 0; j < replies.length; j++) {
        if (replies[j].comment_id === commentId) {
          const likeCount = Number(replies[j].like_count || 0) + (isLiked ? 1 : -1);
          this.setData({
            [`comments[${i}].replies[${j}].is_liked`]: isLiked,
            [`comments[${i}].replies[${j}].like_count`]: Math.max(0, likeCount)
          });
          return;
        }
      }
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
  },

  goLocation() {
    const post = this.data.post;
    if (!post || !post.location_name) return;
    const name = encodeURIComponent(post.location_name);
    const text = encodeURIComponent(post.location_text || post.location_name);
    wx.navigateTo({ url: `/pages/square/location?locationName=${name}&locationText=${text}` });
  },

  onShareAppMessage() {
    const post = this.data.post || {};
    return {
      title: post.drink_name ? `${post.drink_name} - 酒友广场` : "酒友广场动态",
      path: `/pages/square/detail?postId=${this.data.postId}`,
      imageUrl: post.cover_url || ""
    };
  },

  onShareTimeline() {
    const post = this.data.post || {};
    return {
      title: post.drink_name ? `${post.drink_name} - 酒友广场` : "酒友广场动态",
      query: `postId=${this.data.postId}`,
      imageUrl: post.cover_url || ""
    };
  }
});

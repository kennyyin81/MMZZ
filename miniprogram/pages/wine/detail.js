const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");
const { mergeWineMeta } = require("../../utils/wine-data");

const TASTE_LEVELS = {
  acidity: ["几乎无酸", "微酸清新", "酸度平衡", "酸感明显", "酸爽突出"],
  sweetness: ["几乎不甜", "微甜柔和", "甜度平衡", "甜感明显", "香甜浓郁"],
  bitterness: ["几乎不苦", "微苦回甘", "苦度平衡", "苦感明显", "苦韵突出"],
  spiciness: ["几乎不辣", "微辣顺口", "辛感适中", "辛辣明显", "烈感强劲"]
};

function buildStars(count) {
  return Array.from({ length: 5 }, (_, index) => ({
    value: index + 1,
    active: index < count
  }));
}

function decorateWine(wine) {
  const merged = mergeWineMeta(wine || {});
  return {
    ...merged,
    averageRatingText: Number(merged.average_rating || 0).toFixed(1),
    ratingStars: buildStars(Math.round(Number(merged.average_rating || 0))),
    acidityText: TASTE_LEVELS.acidity[merged.acidity] || "",
    sweetnessText: TASTE_LEVELS.sweetness[merged.sweetness] || "",
    bitternessText: TASTE_LEVELS.bitterness[merged.bitterness] || "",
    spicinessText: TASTE_LEVELS.spiciness[merged.spiciness] || ""
  };
}

Page({
  data: {
    wineId: "",
    wine: null,
    comments: [],
    commentInput: "",
    selectedRating: 5,
    ratingOptions: buildStars(5),
    loading: false,
    hasLoaded: false,
    sending: false,
    ratingSaving: false,
    deletingCommentId: "",
    hasMyComment: false,
    pageNo: 1,
    pageSize: 20,
    total: 0,
    finished: false
  },

  onLoad(options) {
    const wineId = (options && (options.wineId || options.wine_id)) || "";
    this.setData({ wineId });
  },

  onShow() {
    if (!this.data.wineId) return;
    this.loadAll();
  },

  onReachBottom() {
    if (this.data.wineId && !this.data.finished && !this.data.loading) {
      this.loadComments();
    }
  },

  async loadAll() {
    if (!this.data.wineId) return;
    this.setData({
      comments: [],
      pageNo: 1,
      total: 0,
      finished: false,
      loading: true
    });
    try {
      const data = await callApi("wine.getDetail", {
        wine_id: this.data.wineId
      });
      this.setData({
        wine: decorateWine(data.wine || {}),
        hasLoaded: true
      });
      await this.loadComments();
    } catch (err) {
      showError(err);
      this.setData({ hasLoaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadComments() {
    if (!this.data.wineId) return;
    try {
      const data = await callApi("wine.comment.list", {
        wine_id: this.data.wineId,
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        comment_id: item.comment_id || item._id,
        user: {
          user_id: item.user_id,
          nickname: item.nickname || "微信用户",
          avatar_url: item.avatar_url || ""
        },
        created_at_text: formatDateTime(item.created_at),
        ratingStars: buildStars(Number(item.rating || 0))
      }));
      const merged = this.data.comments.concat(list);
      const total = Number(data.total || 0);
      const myComment = merged.find((item) => item.is_owner) || null;
      const patch = {
        comments: merged,
        total,
        finished: merged.length >= total,
        pageNo: this.data.pageNo + 1
      };
      if (myComment) {
        const myRating = Number(myComment.rating || 5);
        patch.hasMyComment = true;
        patch.selectedRating = myRating;
        patch.ratingOptions = buildStars(myRating);
      } else {
        patch.hasMyComment = false;
      }
      this.setData(patch);
    } catch (err) {
      showError(err);
    }
  },

  onCommentInput(e) {
    this.setData({
      commentInput: e.detail.value
    });
  },

  chooseRating(e) {
    const rating = Number(e.currentTarget.dataset.value || 5);
    this.setData({
      selectedRating: rating,
      ratingOptions: buildStars(rating)
    });
    this.saveRating(rating);
  },

  async saveRating(rating) {
    if (!this.data.wineId || this.data.ratingSaving) return;
    this.setData({ ratingSaving: true });
    try {
      await callApi("wine.rating.upsert", {
        wine_id: this.data.wineId,
        rating
      });
      await this.loadAll();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ ratingSaving: false });
    }
  },

  async submitComment() {
    if (!this.data.wineId || this.data.sending) return;

    const content = String(this.data.commentInput || "").trim();

    this.setData({ sending: true });
    try {
      await callApi("wine.comment.create", {
        wine_id: this.data.wineId,
        content,
        rating: this.data.selectedRating
      });
      wx.showToast({
        title: "已保存评价",
        icon: "success"
      });
      this.setData({
        commentInput: "",
        selectedRating: 5,
        ratingOptions: buildStars(5)
      });
      await this.loadAll();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ sending: false });
    }
  },

  async removeComment(e) {
    const commentId = e.currentTarget.dataset.id;
    if (!commentId || this.data.deletingCommentId) return;

    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: "删除后无法恢复，本次评分也会一并移除。",
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes.confirm) return;

    this.setData({ deletingCommentId: commentId });
    try {
      await callApi("wine.comment.remove", {
        comment_id: commentId
      });
      wx.showToast({
        title: "已删除",
        icon: "success"
      });
      await this.loadAll();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ deletingCommentId: "" });
    }
  }
});

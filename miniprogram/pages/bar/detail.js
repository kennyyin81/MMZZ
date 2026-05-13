const { callApi, showError } = require("../../utils/api");

function buildStars(count) {
  return Array.from({ length: 5 }, (_, index) => ({
    value: index + 1,
    active: index < count
  }));
}

function normalizeImages(bar) {
  const seen = new Set();
  const list = [];
  const pushImage = (item) => {
    const url = typeof item === "string" ? item : String((item && (item.url || item.fileID || item.file_id)) || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    list.push({
      url,
      thumb: typeof item === "object" && item ? (item.thumb || item.thumbnail || url) : url
    });
  };

  if (bar.image_url) pushImage(bar.image_url);
  (Array.isArray(bar.images) ? bar.images : []).forEach(pushImage);
  return list;
}

function decorateBar(bar) {
  const images = normalizeImages(bar || {});
  const rating = Number(bar.average_rating || bar.rating || 0);
  const myRating = Number(bar.my_rating || 0);
  return {
    ...(bar || {}),
    images,
    cover_url: (images[0] && images[0].url) || "",
    drink_types: Array.isArray(bar.drink_types) ? bar.drink_types : [],
    taste_tags: Array.isArray(bar.taste_tags) ? bar.taste_tags : [],
    atmosphere_tags: Array.isArray(bar.atmosphere_tags) ? bar.atmosphere_tags : [],
    scene_tags: Array.isArray(bar.scene_tags) ? bar.scene_tags : [],
    ratingText: rating > 0 ? rating.toFixed(1) : "暂无",
    ratingStars: buildStars(Math.round(rating)),
    rating_count: Number(bar.rating_count || 0),
    my_rating: myRating,
    priceText: Number(bar.avg_price || 0) > 0 ? `人均 ¥${Number(bar.avg_price || 0)}` : "人均暂无"
  };
}

Page({
  data: {
    barId: "",
    bar: null,
    selectedRating: 5,
    ratingOptions: buildStars(5),
    ratingSaving: false,
    loading: false,
    hasLoaded: false
  },

  onLoad(options) {
    const barId = String((options && (options.bar_id || options.barId)) || "").trim();
    this.setData({ barId });
    if (!barId) {
      showError(new Error("缺少酒馆ID"));
      return;
    }
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.barId) return;
    this.setData({ loading: true });
    try {
      const data = await callApi("bar.getDetail", { bar_id: this.data.barId });
      const bar = decorateBar(data.bar || {});
      const selectedRating = Number(bar.my_rating || 5);
      this.setData({
        bar,
        selectedRating,
        ratingOptions: buildStars(selectedRating),
        hasLoaded: true
      });
      if (bar.name) {
        wx.setNavigationBarTitle({ title: bar.name });
      }
    } catch (err) {
      showError(err);
      this.setData({ hasLoaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const images = (this.data.bar && this.data.bar.images) || [];
    const urls = images.map((item) => item.url).filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: urls[index] || urls[0], urls });
  },

  callPhone() {
    const phone = this.data.bar && this.data.bar.phone;
    if (!phone) {
      wx.showToast({ title: "暂无电话", icon: "none" });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  copyAddress() {
    const address = this.data.bar && this.data.bar.address;
    if (!address) return;
    wx.setClipboardData({ data: address });
  },

  openMap() {
    const bar = this.data.bar || {};
    const latitude = Number(bar.latitude || 0);
    const longitude = Number(bar.longitude || 0);
    if (!latitude || !longitude) {
      wx.showToast({ title: "暂无定位", icon: "none" });
      return;
    }
    wx.openLocation({
      latitude,
      longitude,
      name: bar.name || "酒馆位置",
      address: bar.address || "",
      scale: 16
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
    if (!this.data.barId || this.data.ratingSaving) return;
    this.setData({ ratingSaving: true });
    try {
      const data = await callApi("bar.rating.upsert", {
        bar_id: this.data.barId,
        rating
      });
      const nextBar = this.data.bar ? {
        ...this.data.bar,
        average_rating: data.average_rating,
        rating: data.average_rating,
        ratingText: Number(data.average_rating || 0) > 0 ? Number(data.average_rating).toFixed(1) : "暂无",
        ratingStars: buildStars(Math.round(Number(data.average_rating || 0))),
        rating_count: Number(data.rating_count || 0),
        my_rating: Number(data.my_rating || rating)
      } : null;
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.barRatingChanged = true;
      }
      this.setData({ bar: nextBar });
      wx.showToast({ title: "已保存评分", icon: "success" });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ ratingSaving: false });
    }
  },

  onShareAppMessage() {
    const bar = this.data.bar || {};
    return {
      title: bar.name ? `${bar.name} - AI 酒馆推荐` : "AI 酒馆推荐",
      path: `/pages/bar/detail?bar_id=${this.data.barId}`,
      imageUrl: bar.cover_url || ""
    };
  }
});

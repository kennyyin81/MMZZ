const { callApi, showError } = require("../../utils/api");

Page({
  data: {
    recordId: "",
    record: null,
    loading: false,
    publishing: false,
    coverIndex: 0,
    locationVisibility: "name",
    showOtherNote: true,
    visibilityOptions: [
      { value: "name", label: "显示店名" },
      { value: "area", label: "只显示城市或区域" },
      { value: "hidden", label: "不显示地点" }
    ]
  },

  onLoad(options) {
    const recordId = String(options.recordId || "").trim();
    if (!recordId) {
      showError(new Error("缺少记录ID"));
      wx.navigateBack({ delta: 1 });
      return;
    }
    this.setData({ recordId });
  },

  onShow() {
    if (this.data.recordId && !this.data.record) {
      this.loadRecord();
    }
  },

  async loadRecord() {
    this.setData({ loading: true });
    try {
      const data = await callApi("drinkDiary.getDetail", { record_id: this.data.recordId });
      const record = data.record || {};
      if (record.is_shared_to_square) {
        wx.showToast({ title: "该记录已分享到广场", icon: "none" });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 1200);
        return;
      }
      this.setData({ record });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onCoverSelect(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    this.setData({ coverIndex: index });
  },

  onVisibilityChange(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ locationVisibility: value });
  },

  onShowOtherNoteChange(e) {
    this.setData({ showOtherNote: !!e.detail.value });
  },

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const images = this.data.record.images || [];
    const urls = images.map((item) => item.url).filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: urls[index] || urls[0], urls });
  },

  async publishToSquare() {
    if (this.data.publishing) return;
    this.setData({ publishing: true });
    try {
      const res = await callApi("square.create", {
        record_id: this.data.recordId,
        cover_index: this.data.coverIndex,
        location_visibility: this.data.locationVisibility,
        show_other_note: this.data.showOtherNote
      });
      wx.showToast({ title: "已分享到广场", icon: "success" });
      wx.setStorageSync("square_need_refresh", true);
      wx.setStorageSync("square_navigate_detail", res.post_id);
      setTimeout(() => {
        wx.navigateBack({ delta: 2 });
      }, 400);
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ publishing: false });
    }
  }
});

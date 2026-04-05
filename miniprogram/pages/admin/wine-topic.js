const { callApi, showError } = require("../../utils/api");

const TASTE_LEVELS = {
  acidity: ["几乎无酸", "微酸清新", "酸度平衡", "酸感明显", "酸爽突出"],
  sweetness: ["几乎不甜", "微甜柔和", "甜度平衡", "甜感明显", "香甜浓郁"],
  bitterness: ["几乎不苦", "微苦回甘", "苦度平衡", "苦感明显", "苦韵突出"],
  spiciness: ["几乎不辣", "微辣顺口", "辛感适中", "辛辣明显", "烈感强劲"]
};

const SORT_OPTIONS = [
  { label: "名称升序", value: "name:asc" },
  { label: "名称降序", value: "name:desc" },
  { label: "更新时间降序", value: "updated_at:desc" }
];

function getEmptyForm() {
  return {
    name: "",
    category: "",
    alcohol: "",
    flavor: "",
    acidity: 0,
    sweetness: 0,
    bitterness: 0,
    spiciness: 0,
    summary: "",
    image_url: ""
  };
}

function buildPreview(form) {
  return {
    name: form.name || "酒名",
    category: form.category || "类别",
    alcohol: form.alcohol || "酒精度",
    flavor: form.flavor || "",
    acidity: TASTE_LEVELS.acidity[form.acidity] || "",
    sweetness: TASTE_LEVELS.sweetness[form.sweetness] || "",
    bitterness: TASTE_LEVELS.bitterness[form.bitterness] || "",
    spiciness: TASTE_LEVELS.spiciness[form.spiciness] || "",
    summary: form.summary || "一句话介绍这款酒的特色",
    image: form.image_url || ""
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    uploading: false,
    list: [],
    editingWineId: "",
    form: getEmptyForm(),
    previewWine: buildPreview(getEmptyForm()),
    tasteLevels: TASTE_LEVELS,
    sortOptions: SORT_OPTIONS.map((item) => item.label),
    selectedSortLabel: SORT_OPTIONS[0].label,
    keyword: "",
    sortValue: SORT_OPTIONS[0].value
  },

  onShow() {
    this.loadList();
  },

  syncPreview() {
    this.setData({
      previewWine: buildPreview(this.data.form)
    });
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const [orderBy, orderDir] = String(this.data.sortValue || "name:asc").split(":");
      const data = await callApi("admin.wine.list", {
        keyword: this.data.keyword,
        order_by: orderBy,
        order_dir: orderDir
      });
      this.setData({ list: data.list || [] });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
    this.syncPreview();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onTasteChange(e) {
    const field = e.currentTarget.dataset.field;
    const index = Number(e.detail.value || 0);
    this.setData({ [`form.${field}`]: index });
    this.syncPreview();
  },

  onSortChange(e) {
    const target = SORT_OPTIONS[Number(e.detail.value || 0)] || SORT_OPTIONS[0];
    this.setData({
      sortValue: target.value,
      selectedSortLabel: target.label
    });
    this.loadList();
  },

  editItem(e) {
    const wineId = e.currentTarget.dataset.id;
    const target = this.data.list.find((item) => item.wine_id === wineId);
    if (!target) return;
    const form = {
      name: target.name || "",
      category: target.category || "",
      alcohol: target.alcohol || "",
      flavor: target.flavor || "",
      acidity: Number(target.acidity || 0),
      sweetness: Number(target.sweetness || 0),
      bitterness: Number(target.bitterness || 0),
      spiciness: Number(target.spiciness || 0),
      summary: target.summary || "",
      image_url: target.image_url || ""
    };
    this.setData({
      editingWineId: wineId,
      form,
      previewWine: buildPreview(form)
    });
  },

  resetForm() {
    const form = getEmptyForm();
    this.setData({
      editingWineId: "",
      form,
      previewWine: buildPreview(form)
    });
  },

  async uploadImage() {
    if (this.data.uploading) return;
    this.setData({ uploading: true });
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"]
      });
      const file = chooseRes.tempFiles && chooseRes.tempFiles[0];
      if (!file || !file.tempFilePath) {
        throw new Error("未选择图片");
      }
      const suffixMatch = file.tempFilePath.match(/\.[^.]+$/);
      const suffix = suffixMatch ? suffixMatch[0] : ".png";
      const wineId = this.data.editingWineId || `new-${Date.now()}`;
      const cloudPath = `wine-topics/${wineId}/${Date.now()}${suffix}`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: file.tempFilePath
      });

      this.setData({ "form.image_url": uploadRes.fileID });
      this.syncPreview();
      wx.showToast({ title: "图片已上传", icon: "success" });
    } catch (err) {
      if (err && err.errMsg && err.errMsg.includes("cancel")) return;
      showError(err);
    } finally {
      this.setData({ uploading: false });
    }
  },

  async submitForm() {
    if (this.data.saving) return;
    const name = String(this.data.form.name || "").trim();
    if (!name) {
      wx.showToast({ title: "请输入酒名", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const payload = {
        name,
        category: String(this.data.form.category || "").trim(),
        alcohol: String(this.data.form.alcohol || "").trim(),
        flavor: String(this.data.form.flavor || "").trim(),
        acidity: Number(this.data.form.acidity || 0),
        sweetness: Number(this.data.form.sweetness || 0),
        bitterness: Number(this.data.form.bitterness || 0),
        spiciness: Number(this.data.form.spiciness || 0),
        summary: String(this.data.form.summary || "").trim(),
        image_url: String(this.data.form.image_url || "").trim()
      };
      // 编辑时带上 wine_id
      if (this.data.editingWineId) {
        payload.wine_id = this.data.editingWineId;
      }
      await callApi("admin.wine.upsert", payload);
      wx.showToast({
        title: this.data.editingWineId ? "已更新" : "已新增",
        icon: "success"
      });
      this.resetForm();
      await this.loadList();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ saving: false });
    }
  },

  async removeItem(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: "删除后该酒款会被移除。",
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes.confirm) return;

    try {
      await callApi("admin.wine.remove", { wine_id: wineId });
      wx.showToast({ title: "已删除", icon: "success" });
      if (this.data.editingWineId === wineId) {
        this.resetForm();
      }
      await this.loadList();
    } catch (err) {
      showError(err);
    }
  }
});

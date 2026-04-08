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

function splitTags(value) {
  return String(value || "")
    .split(/[\r\n、,，/|；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getWineSimilarityScore(baseWine, candidateWine) {
  if (!candidateWine || !candidateWine.wine_id) return -1;
  const baseFlavorTags = splitTags(baseWine.flavor);
  const candidateFlavorTags = splitTags(candidateWine.flavor);
  const baseFlavorSet = new Set(baseFlavorTags);
  const overlapCount = candidateFlavorTags.filter((item) => baseFlavorSet.has(item)).length;
  const unionCount = new Set(baseFlavorTags.concat(candidateFlavorTags)).size || 1;
  const flavorScore = overlapCount ? Math.round((overlapCount / unionCount) * 100) : 0;

  const categoryScore = baseWine.category && candidateWine.category && baseWine.category === candidateWine.category ? 20 : 0;
  const baseSpiritScore = baseWine.base_spirit && candidateWine.base_spirit && baseWine.base_spirit === candidateWine.base_spirit ? 12 : 0;
  const tasteScore = ["acidity", "sweetness", "bitterness", "spiciness"].reduce((sum, key) => {
    const diff = Math.abs(Number(baseWine[key] || 0) - Number(candidateWine[key] || 0));
    return sum + (4 - diff);
  }, 0);

  return flavorScore * 100 + categoryScore * 10 + baseSpiritScore * 10 + tasteScore;
}

function sortWineIdsBySimilarity(baseWine, wineIds, wineList) {
  const idSet = new Set(Array.isArray(wineIds) ? wineIds : []);
  const candidates = (Array.isArray(wineList) ? wineList : []).filter((item) => item && idSet.has(item.wine_id));
  return candidates
    .sort((a, b) => {
      const scoreDiff = getWineSimilarityScore(baseWine, b) - getWineSimilarityScore(baseWine, a);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    })
    .map((item) => item.wine_id)
    .slice(0, 3);
}

function buildTasteScale(level) {
  const safeLevel = Math.max(0, Math.min(4, Number(level || 0)));
  return Array.from({ length: 5 }, (_, index) => ({
    key: index,
    active: index <= safeLevel
  }));
}

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
    base_spirit: "",
    ingredients: "",
    taste_note: "",
    story: "",
    similar_wine_ids: [],
    summary: "",
    image_url: ""
  };
}

function getSimilarWineOptions(baseWine, list, editingWineId, selectedIds) {
  const picked = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.wine_id && item.wine_id !== editingWineId)
    .sort((a, b) => {
      const scoreDiff = getWineSimilarityScore(baseWine, b) - getWineSimilarityScore(baseWine, a);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    })
    .map((item) => ({
      wine_id: item.wine_id,
      name: item.name || "未命名酒款",
      selected: picked.has(item.wine_id)
    }));
}

function buildPreview(form, wineList) {
  const similarMap = (Array.isArray(wineList) ? wineList : []).reduce((acc, item) => {
    if (item && item.wine_id) acc[item.wine_id] = item;
    return acc;
  }, {});

  return {
    name: form.name || "酒名",
    category: form.category || "类别",
    alcohol: form.alcohol || "酒精度",
    flavorTags: splitTags(form.flavor),
    summary: form.summary || "一句话介绍这款酒的特色",
    image: form.image_url || "",
    base_spirit: form.base_spirit || "",
    ingredients: form.ingredients || "",
    taste_note: form.taste_note || "",
    story: form.story || "",
    similarWines: (Array.isArray(form.similar_wine_ids) ? form.similar_wine_ids : [])
      .map((wineId) => similarMap[wineId])
      .filter(Boolean)
      .map((item) => ({
        wine_id: item.wine_id,
        name: item.name || "未命名酒款"
      })),
    tasteMetrics: [
      { key: "acidity", label: "酸", text: TASTE_LEVELS.acidity[form.acidity] || "", steps: buildTasteScale(form.acidity) },
      { key: "sweetness", label: "甜", text: TASTE_LEVELS.sweetness[form.sweetness] || "", steps: buildTasteScale(form.sweetness) },
      { key: "bitterness", label: "苦", text: TASTE_LEVELS.bitterness[form.bitterness] || "", steps: buildTasteScale(form.bitterness) },
      { key: "spiciness", label: "辣", text: TASTE_LEVELS.spiciness[form.spiciness] || "", steps: buildTasteScale(form.spiciness) }
    ]
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    uploading: false,
    list: [],
    allWineList: [],
    editingWineId: "",
    form: getEmptyForm(),
    previewWine: buildPreview(getEmptyForm(), []),
    similarWineOptions: [],
    tasteLevels: TASTE_LEVELS,
    sortOptions: SORT_OPTIONS.map((item) => item.label),
    selectedSortLabel: SORT_OPTIONS[0].label,
    keyword: "",
    sortValue: SORT_OPTIONS[0].value
  },

  onShow() {
    this.loadList();
  },

  syncPreview(extraData) {
    const form = (extraData && extraData.form) || this.data.form;
    const editingWineId = typeof (extraData && extraData.editingWineId) === "string" ? extraData.editingWineId : this.data.editingWineId;
    const allWineList = (extraData && extraData.allWineList) || this.data.allWineList;
    const orderedSimilarWineIds = sortWineIdsBySimilarity(form, form.similar_wine_ids, allWineList);
    const nextForm = orderedSimilarWineIds.join("|") === (Array.isArray(form.similar_wine_ids) ? form.similar_wine_ids.join("|") : "")
      ? form
      : { ...form, similar_wine_ids: orderedSimilarWineIds };
    this.setData({
      form: nextForm,
      previewWine: buildPreview(nextForm, allWineList),
      similarWineOptions: getSimilarWineOptions(nextForm, allWineList, editingWineId, nextForm.similar_wine_ids)
    });
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const [orderBy, orderDir] = String(this.data.sortValue || "name:asc").split(":");
      const [filteredData, allData] = await Promise.all([
        callApi("admin.wine.list", {
          keyword: this.data.keyword,
          order_by: orderBy,
          order_dir: orderDir
        }),
        callApi("admin.wine.list", {
          keyword: "",
          order_by: "name",
          order_dir: "asc"
        })
      ]);
      const list = filteredData.list || [];
      const allWineList = allData.list || [];
      this.setData({ list, allWineList });
      this.syncPreview({ allWineList });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const form = {
      ...this.data.form,
      [field]: e.detail.value
    };
    this.setData({ form });
    this.syncPreview({ form });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onTasteChange(e) {
    const field = e.currentTarget.dataset.field;
    const form = {
      ...this.data.form,
      [field]: Number(e.detail.value || 0)
    };
    this.setData({ form });
    this.syncPreview({ form });
  },

  toggleSimilarWine(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    const current = Array.isArray(this.data.form.similar_wine_ids) ? this.data.form.similar_wine_ids.slice() : [];
    const next = current.includes(wineId)
      ? current.filter((item) => item !== wineId)
      : current.concat(wineId);
    const form = {
      ...this.data.form,
      similar_wine_ids: sortWineIdsBySimilarity(this.data.form, next, this.data.allWineList).slice(0, 3)
    };
    this.setData({ form });
    this.syncPreview({ form });
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
      base_spirit: target.base_spirit || "",
      ingredients: target.ingredients || target.main_ingredients || "",
      taste_note: target.taste_note || "",
      story: target.story || "",
      similar_wine_ids: Array.isArray(target.similar_wine_ids) ? target.similar_wine_ids.slice() : [],
      summary: target.summary || "",
      image_url: target.image_url || ""
    };
    this.setData({
      editingWineId: wineId,
      form
    });
    this.syncPreview({ form, editingWineId: wineId });
  },

  resetForm() {
    const form = getEmptyForm();
    this.setData({
      editingWineId: "",
      form
    });
    this.syncPreview({ form, editingWineId: "" });
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
      const form = {
        ...this.data.form,
        image_url: uploadRes.fileID
      };
      this.setData({ form });
      this.syncPreview({ form });
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
        base_spirit: String(this.data.form.base_spirit || "").trim(),
        ingredients: String(this.data.form.ingredients || "").trim(),
        taste_note: String(this.data.form.taste_note || "").trim(),
        story: String(this.data.form.story || "").trim(),
        similar_wine_ids: Array.isArray(this.data.form.similar_wine_ids) ? this.data.form.similar_wine_ids : [],
        summary: String(this.data.form.summary || "").trim(),
        image_url: String(this.data.form.image_url || "").trim()
      };
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

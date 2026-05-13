const { callApi, showError } = require("../../utils/api");

function splitTags(value) {
  return String(value || "")
    .split(/[\r\n、,，/|；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinTags(value) {
  return Array.isArray(value) ? value.join("、") : String(value || "");
}

function inferLocationParts(name, address) {
  const text = `${address || ""} ${name || ""}`;
  const provinceMatch = text.match(/([\u4e00-\u9fa5]{2,}(?:省|自治区|特别行政区))/);
  const cityMatch = text.match(/([\u4e00-\u9fa5]{2,}市)/);
  const areaMatch = text.match(/([\u4e00-\u9fa5]{2,}(?:区|县|镇|街道))/);
  let province = provinceMatch ? provinceMatch[1] : "";
  let city = cityMatch ? cityMatch[1] : "";

  if (!province) {
    if (/北京/.test(text)) province = "北京市";
    if (/上海/.test(text)) province = "上海市";
    if (/天津/.test(text)) province = "天津市";
    if (/重庆/.test(text)) province = "重庆市";
    if (/广州|深圳|佛山|东莞|珠海|惠州|中山/.test(text)) province = "广东省";
  }
  if (!city) {
    const knownCities = ["广州", "深圳", "佛山", "东莞", "珠海", "惠州", "中山", "北京", "上海", "天津", "重庆"];
    const found = knownCities.find((item) => text.includes(item));
    city = found ? `${found}市` : "";
  }

  return {
    province,
    city,
    area: areaMatch ? areaMatch[1] : ""
  };
}

function getEmptyForm() {
  return {
    name: "",
    province: "",
    city: "",
    area: "",
    address: "",
    latitude: "",
    longitude: "",
    phone: "",
    business_hours: "",
    avg_price: "",
    budget_level: 0,
    bar_type: "",
    drink_types: "",
    taste_tags: "",
    atmosphere_tags: "",
    scene_tags: "",
    highlights: "",
    description: "",
    image_url: "",
    images: "",
    is_active: true
  };
}

function buildPreview(form) {
  const imageList = splitTags(form.images);
  if (form.image_url && !imageList.includes(form.image_url)) {
    imageList.unshift(form.image_url);
  }
  return {
    name: form.name || "酒馆名",
    areaText: [form.province, form.city, form.area].filter(Boolean).join(" · ") || "所在区域",
    metaText: [form.bar_type || "酒馆类型", form.avg_price ? `人均 ¥${form.avg_price}` : "人均暂无"].filter(Boolean).join(" · "),
    image: form.image_url || "",
    highlights: form.highlights || "用一句话写清楚这家酒馆最值得推荐的点。",
    description: form.description || "",
    address: form.address || "详细地址",
    phone: form.phone || "暂无电话",
    business_hours: form.business_hours || "营业时间待补充",
    imageCount: imageList.length,
    isActive: form.is_active
  };
}

function formFromBar(bar) {
  return {
    name: bar.name || "",
    province: bar.province || "",
    city: bar.city || "",
    area: bar.area || "",
    address: bar.address || "",
    latitude: bar.latitude ? String(bar.latitude) : "",
    longitude: bar.longitude ? String(bar.longitude) : "",
    phone: bar.phone || "",
    business_hours: bar.business_hours || "",
    avg_price: bar.avg_price ? String(bar.avg_price) : "",
    budget_level: Number(bar.budget_level || 0),
    bar_type: bar.bar_type || "",
    drink_types: joinTags(bar.drink_types),
    taste_tags: joinTags(bar.taste_tags),
    atmosphere_tags: joinTags(bar.atmosphere_tags),
    scene_tags: joinTags(bar.scene_tags),
    highlights: bar.highlights || "",
    description: bar.description || "",
    image_url: bar.image_url || "",
    images: joinTags((Array.isArray(bar.images) ? bar.images : []).map((item) => {
      return typeof item === "string" ? item : String((item && (item.url || item.fileID || item.file_id)) || "");
    }).filter(Boolean)),
    is_active: bar.is_active !== false
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    uploading: false,
    list: [],
    allBarList: [],
    editingBarId: "",
    form: getEmptyForm(),
    previewBar: buildPreview(getEmptyForm()),
    keyword: ""
  },

  onShow() {
    this.loadList();
  },

  syncPreview(extraData) {
    const form = (extraData && extraData.form) || this.data.form;
    this.setData({
      previewBar: buildPreview(form)
    });
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const data = await callApi("admin.bar.list", { keyword: "" });
      const allBarList = data.list || [];
      const keyword = String(this.data.keyword || "").trim().toLowerCase();
      const list = keyword ? this.filterList(allBarList, keyword) : allBarList;
      this.setData({ list, allBarList });
      this.syncPreview();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  filterList(list, keyword) {
    return (Array.isArray(list) ? list : []).filter((item) => {
      return [
        item.name,
        item.province,
        item.city,
        item.area,
        item.address,
        item.bar_type
      ].join(" ").toLowerCase().includes(keyword);
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const form = Object.assign({}, this.data.form);
    form[field] = e.detail.value;
    this.setData({ form });
    this.syncPreview({ form });
  },

  onActiveChange(e) {
    const form = Object.assign({}, this.data.form, {
      is_active: Boolean(e.detail.value)
    });
    this.setData({ form });
    this.syncPreview({ form });
  },

  onSearchInput(e) {
    const keyword = String(e.detail.value || "").trim().toLowerCase();
    const list = keyword ? this.filterList(this.data.allBarList, keyword) : this.data.allBarList;
    this.setData({
      keyword: e.detail.value,
      list
    });
  },

  async chooseMapLocation() {
    try {
      const res = await wx.chooseLocation({});
      if (!res || (!res.name && !res.address)) return;
      const locationName = String(res.name || "").trim();
      const address = String(res.address || "").trim();
      const parts = inferLocationParts(locationName, address);
      const form = Object.assign({}, this.data.form, {
        name: this.data.form.name || locationName,
        province: parts.province || this.data.form.province,
        city: parts.city || this.data.form.city,
        area: parts.area || this.data.form.area,
        address: address || this.data.form.address,
        latitude: res.latitude ? String(res.latitude) : this.data.form.latitude,
        longitude: res.longitude ? String(res.longitude) : this.data.form.longitude
      });
      this.setData({ form });
      this.syncPreview({ form });
    } catch (err) {
      if (err && err.errMsg && err.errMsg.includes("cancel")) return;
      if (err && err.errMsg && err.errMsg.includes("auth")) {
        wx.showModal({
          title: "需要位置权限",
          content: "请在设置中允许使用位置信息",
          confirmText: "去设置",
          success: (modalRes) => {
            if (modalRes.confirm) wx.openSetting();
          }
        });
        return;
      }
      showError(err);
    }
  },

  editItem(e) {
    const barId = e.currentTarget.dataset.id;
    const target = this.data.allBarList.find((item) => item.bar_id === barId);
    if (!target) return;
    const form = formFromBar(target);
    this.setData({
      editingBarId: barId,
      form
    });
    this.syncPreview({ form });
  },

  resetForm() {
    const form = getEmptyForm();
    this.setData({
      editingBarId: "",
      form
    });
    this.syncPreview({ form });
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
      const barId = this.data.editingBarId || `new-${Date.now()}`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `bar-info/${barId}/${Date.now()}${suffix}`,
        filePath: file.tempFilePath
      });
      const form = Object.assign({}, this.data.form, {
        image_url: uploadRes.fileID
      });
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
      wx.showToast({ title: "请输入酒馆名", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const payload = {
        name,
        province: String(this.data.form.province || "").trim(),
        city: String(this.data.form.city || "").trim(),
        area: String(this.data.form.area || "").trim(),
        address: String(this.data.form.address || "").trim(),
        latitude: Number(this.data.form.latitude || 0),
        longitude: Number(this.data.form.longitude || 0),
        phone: String(this.data.form.phone || "").trim(),
        business_hours: String(this.data.form.business_hours || "").trim(),
        avg_price: Number(this.data.form.avg_price || 0),
        budget_level: Number(this.data.form.budget_level || 0),
        bar_type: String(this.data.form.bar_type || "").trim(),
        drink_types: splitTags(this.data.form.drink_types),
        taste_tags: splitTags(this.data.form.taste_tags),
        atmosphere_tags: splitTags(this.data.form.atmosphere_tags),
        scene_tags: splitTags(this.data.form.scene_tags),
        highlights: String(this.data.form.highlights || "").trim(),
        description: String(this.data.form.description || "").trim(),
        image_url: String(this.data.form.image_url || "").trim(),
        images: splitTags(this.data.form.images),
        is_active: this.data.form.is_active !== false
      };
      if (this.data.editingBarId) {
        payload.bar_id = this.data.editingBarId;
      }
      await callApi("admin.bar.upsert", payload);
      wx.showToast({
        title: this.data.editingBarId ? "已更新" : "已新增",
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
    const barId = e.currentTarget.dataset.id;
    if (!barId) return;
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认下架",
        content: "下架后前台酒馆列表和详情将不再展示这家酒馆。",
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes.confirm) return;

    try {
      await callApi("admin.bar.remove", { bar_id: barId });
      wx.showToast({ title: "已下架", icon: "success" });
      if (this.data.editingBarId === barId) {
        this.resetForm();
      }
      await this.loadList();
    } catch (err) {
      showError(err);
    }
  }
});

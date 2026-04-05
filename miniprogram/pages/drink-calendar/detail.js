const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");

function pad(value) {
  return String(value).padStart(2, "0");
}

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getCurrentTime() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function splitDateTime(value) {
  const text = value ? formatDateTime(value) : `${getToday()} ${getCurrentTime()}:00`;
  const parts = text.split(" ");
  const date = parts[0] || getToday();
  const time = (parts[1] || `${getCurrentTime()}:00`).slice(0, 5);
  return { date, time };
}

async function compressAndUpload(localPath, cloudPrefix) {
  const compressed = await wx.compressImage({ src: localPath, quality: 50 }).catch(() => ({ tempFilePath: localPath }));
  const suffix = (localPath.match(/\.[^.]+$/) || [".jpg"])[0];
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const originUpload = await wx.cloud.uploadFile({
    cloudPath: `${cloudPrefix}/origin-${stamp}${suffix}`,
    filePath: localPath
  });
  const thumbUpload = await wx.cloud.uploadFile({
    cloudPath: `${cloudPrefix}/thumb-${stamp}${suffix}`,
    filePath: compressed.tempFilePath || localPath
  });
  return { url: originUpload.fileID, thumb: thumbUpload.fileID };
}

Page({
  data: {
    loading: false,
    saving: false,
    deleting: false,
    uploading: false,
    mode: "edit",
    initialDate: "",
    initialTime: "",
    createInitialized: false,
    recordId: "",
    form: {
      drink_name: "",
      record_date: "",
      drink_time_hm: "",
      price: "0",
      remark: "",
      images: []
    }
  },

  onLoad(options) {
    const recordId = String(options.recordId || "").trim();
    const mode = String(options.mode || "").trim();
    const initialDate = String(options.date || "").trim();
    const initialTime = String(options.time || "").trim();
    this.setData({
      recordId,
      mode: recordId ? "edit" : (mode === "create" ? "create" : "edit"),
      initialDate,
      initialTime
    });
  },

  onShow() {
    if (this.data.recordId) {
      this.loadDetail();
      return;
    }
    if (this.data.mode === "create") {
      if (!this.data.createInitialized) {
        const date = this.data.initialDate || getToday();
        const time = this.data.initialTime || getCurrentTime();
        this.setData({
          createInitialized: true,
          form: {
            drink_name: "",
            record_date: date,
            drink_time_hm: time,
            price: "0",
            remark: "",
            images: []
          }
        });
      }
      return;
    }
    showError(new Error("记录不存在"));
    wx.navigateBack({ delta: 1 });
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const data = await callApi("drinkDiary.getDetail", { record_id: this.data.recordId });
      const record = data.record || {};
      const dt = splitDateTime(record.drink_time);
      this.setData({
        form: {
          drink_name: record.drink_name || "",
          record_date: record.record_date || dt.date,
          drink_time_hm: dt.time,
          price: String(record.price || 0),
          remark: record.remark || "",
          images: Array.isArray(record.images) ? record.images : []
        }
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ "form.record_date": e.detail.value });
  },

  onTimeChange(e) {
    this.setData({ "form.drink_time_hm": e.detail.value });
  },

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const images = this.data.form.images || [];
    const urls = images.map((item) => item.url).filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: urls[index] || urls[0], urls });
  },

  removeImage(e) {
    const currentDataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const targetDataset = (e && e.target && e.target.dataset) || {};
    const rawIndex = currentDataset.index !== undefined ? currentDataset.index : targetDataset.index;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) {
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
      return;
    }
    const images = (this.data.form.images || []).slice();
    if (index >= images.length) {
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
      return;
    }
    images.splice(index, 1);
    this.setData({ "form.images": images });
    wx.showToast({ title: "已删除图片", icon: "none" });
  },

  async addImages() {
    if (this.data.uploading) return;
    const current = this.data.form.images || [];
    const remain = Math.max(0, 9 - current.length);
    if (remain <= 0) {
      wx.showToast({ title: "最多上传9张", icon: "none" });
      return;
    }

    const action = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: ["拍照", "从相册上传"],
        success: resolve,
        fail: () => resolve(null)
      });
    });
    if (!action || typeof action.tapIndex !== "number") return;

    const sourceType = action.tapIndex === 0 ? ["camera"] : ["album"];
    this.setData({ uploading: true });
    try {
      const chooseRes = await wx.chooseMedia({
        count: Math.min(remain, 6),
        mediaType: ["image"],
        sourceType
      });
      const files = chooseRes.tempFiles || [];
      const uploaded = [];
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        if (!f || !f.tempFilePath) continue;
        const uploadPrefix = this.data.recordId
          ? `drink-diary/${this.data.recordId}`
          : `drink-diary/new/${this.data.form.record_date || getToday()}`;
        const item = await compressAndUpload(f.tempFilePath, uploadPrefix);
        uploaded.push(item);
      }
      this.setData({ "form.images": current.concat(uploaded).slice(0, 9) });
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes("cancel"))) {
        showError(err);
      }
    } finally {
      this.setData({ uploading: false });
    }
  },

  async saveRecord() {
    if (this.data.saving) return;
    const form = this.data.form;
    const drinkName = String(form.drink_name || "").trim();
    if (!drinkName) {
      wx.showToast({ title: "请输入酒名", icon: "none" });
      return;
    }
    const price = Number(form.price || 0);
    if (!Number.isFinite(price) || price < 0) {
      wx.showToast({ title: "价格格式不正确", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    try {
      const payload = {
        record_date: form.record_date || getToday(),
        drink_name: drinkName,
        drink_time: `${form.record_date || getToday()} ${form.drink_time_hm || getCurrentTime()}:00`,
        price,
        remark: String(form.remark || "").trim(),
        images: Array.isArray(form.images) ? form.images : [],
        thumbnail_url: (form.images && form.images[0] && (form.images[0].thumb || form.images[0].url)) || ""
      };

      if (this.data.recordId) {
        await callApi("drinkDiary.update", {
          record_id: this.data.recordId,
          ...payload
        });
        wx.showToast({ title: "已保存", icon: "success" });
        this.loadDetail();
      } else {
        const createRes = await callApi("drinkDiary.create", {
          date: payload.record_date,
          drink_name: payload.drink_name,
          drink_time: payload.drink_time,
          price: payload.price,
          remark: payload.remark,
          images: payload.images,
          thumbnail_url: payload.thumbnail_url
        });
        const newId = String((createRes && createRes.record_id) || "").trim();
        if (!newId) {
          throw new Error("创建记录失败");
        }
        this.setData({
          recordId: newId,
          mode: "edit"
        });
        wx.showToast({ title: "已创建", icon: "success" });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/home/index" });
        }, 260);
      }
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ saving: false });
    }
  },

  async removeRecord() {
    if (!this.data.recordId) return;
    if (this.data.deleting) return;
    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: "确认删除",
        content: "删除后不可恢复，确定删除这条记录吗？",
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!confirmRes.confirm) return;

    this.setData({ deleting: true });
    try {
      await callApi("drinkDiary.remove", { record_id: this.data.recordId });
      wx.showToast({ title: "已删除", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 400);
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ deleting: false });
    }
  }
});

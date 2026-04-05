const { callApi, showError } = require("../../utils/api");

Page({
  data: {
    user: null,
    nicknameInput: "",
    loading: false,
    saving: false,
    uploading: false
  },

  onShow() {
    this.loadUser();
  },

  async loadUser(userInfo) {
    this.setData({ loading: true });
    try {
      const userData = await callApi("auth.getCurrentUser", {}, userInfo);
      this.setData({
        user: userData,
        nicknameInput: userData.nickname || ""
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onNicknameBlur(e) {
    const nickname = String(e.detail.value || "").trim();
    if (!nickname || nickname === this.data.user?.nickname) return;
    this.saveNicknameInternal(nickname);
  },

  async saveNicknameInternal(nickname) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await callApi("profile.update", { nickname });
      wx.showToast({
        title: "昵称已保存",
        icon: "success"
      });
      await this.loadUser();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ saving: false });
    }
  },

  async onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;
    if (this.data.uploading) return;
    this.setData({ uploading: true });

    try {
      const suffixMatch = avatarUrl.match(/\.[^.]+$/);
      const suffix = suffixMatch ? suffixMatch[0] : ".png";
      const userId = (this.data.user && this.data.user.user_id) || "unknown";
      const cloudPath = `avatars/${userId}/${Date.now()}${suffix}`;

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: avatarUrl
      });

      await callApi("profile.update", {
        avatar_url: uploadRes.fileID
      });

      wx.showToast({
        title: "头像已更新",
        icon: "success"
      });
      await this.loadUser();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ uploading: false });
    }
  }
});

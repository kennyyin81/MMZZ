const { callApi, showError } = require("../../utils/api");
const { ROLE_LABEL, formatRoles } = require("../../utils/const");

const BASE_ROLES = ["USER", "APPROVER", "ADMIN", "SOMMELIER"];

Page({
  data: {
    keyword: "",
    users: [],
    selectedUserId: "",
    selectedRoles: ["USER"],
    roleOptions: [],
    searching: false,
    saving: false
  },

  onLoad() {
    this.syncRoleOptions();
  },

  syncRoleOptions() {
    const roleOptions = BASE_ROLES.map((role) => ({
      role,
      label: ROLE_LABEL[role] || role,
      checked: this.data.selectedRoles.includes(role)
    }));
    this.setData({ roleOptions });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  async searchUsers() {
    if (this.data.searching) return;
    this.setData({ searching: true });
    try {
      const data = await callApi("admin.user.search", {
        keyword: this.data.keyword,
        page_no: 1,
        page_size: 20
      });
      const users = (data.list || []).map((item) => ({
        ...item,
        rolesText: formatRoles(item.roles)
      }));
      this.setData({ users });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ searching: false });
    }
  },

  selectUser(e) {
    const userId = e.currentTarget.dataset.id;
    const rawRoles = e.currentTarget.dataset.roles;
    let roles = ["USER"];
    if (Array.isArray(rawRoles) && rawRoles.length) {
      roles = rawRoles;
    } else if (typeof rawRoles === "string" && rawRoles) {
      roles = rawRoles.split(",").map((item) => item.trim()).filter(Boolean);
    }
    this.setData({
      selectedUserId: userId,
      selectedRoles: roles.length ? roles : ["USER"]
    });
    this.syncRoleOptions();
  },

  onUserIdInput(e) {
    this.setData({ selectedUserId: e.detail.value });
  },

  onRolesChange(e) {
    const roles = e.detail.value || [];
    this.setData({
      selectedRoles: roles.length ? roles : ["USER"]
    });
    this.syncRoleOptions();
  },

  async saveRoles() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await callApi("admin.user.setRoles", {
        user_id: this.data.selectedUserId,
        roles: this.data.selectedRoles
      });
      wx.showToast({ title: "保存成功", icon: "success" });
      this.searchUsers();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ saving: false });
    }
  }
});

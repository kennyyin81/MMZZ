const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");

function formatRelation(data) {
  const relation = data || {};
  const outgoing = relation.outgoing_invitation
    ? {
        ...relation.outgoing_invitation,
        created_at_text: formatDateTime(relation.outgoing_invitation.created_at)
      }
    : null;
  return {
    ...relation,
    outgoing_invitation: outgoing
  };
}

Page({
  data: {
    relation: null,
    searchKeyword: "",
    searchResults: [],
    searched: false,
    loading: false,
    searching: false,
    inviting: false,
    handlingInvite: false
  },

  onShow() {
    this.loadRelation();
  },

  async loadRelation() {
    this.setData({ loading: true });
    try {
      const relationData = await callApi("approver.getMyRelation");
      this.setData({ relation: formatRelation(relationData) });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onSearchInput(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  async searchUsers() {
    const keyword = String(this.data.searchKeyword || "").trim();
    if (!keyword) {
      wx.showToast({
        title: "请输入昵称关键词",
        icon: "none"
      });
      return;
    }

    if (this.data.searching) return;
    this.setData({ searching: true, searched: true });
    try {
      const data = await callApi("approver.searchUsers", { keyword });
      this.setData({
        searchResults: data.list || []
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ searching: false });
    }
  },

  async inviteApprover(e) {
    const targetUserId = e.currentTarget.dataset.userId;
    if (!targetUserId || this.data.inviting) return;

    this.setData({ inviting: true });
    try {
      await callApi("approver.invite", {
        target_user_id: targetUserId
      });
      wx.showToast({
        title: "邀请已发送",
        icon: "success"
      });
      await this.loadRelation();
      this.setData({ searchResults: [] });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ inviting: false });
    }
  },

  async cancelInvitation() {
    const relation = this.data.relation || {};
    const outgoing = relation.outgoing_invitation;
    if (!outgoing || this.data.handlingInvite) return;

    this.setData({ handlingInvite: true });
    try {
      await callApi("approver.cancelInvitation", {
        invitation_id: outgoing.invitation_id
      });
      wx.showToast({
        title: "邀请已取消",
        icon: "success"
      });
      await this.loadRelation();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ handlingInvite: false });
    }
  }
});

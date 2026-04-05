const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");

function formatRelation(data) {
  const relation = data || {};
  const incoming = Array.isArray(relation.incoming_invitations)
    ? relation.incoming_invitations.map((item) => ({
        ...item,
        created_at_text: formatDateTime(item.created_at)
      }))
    : [];
  const outgoing = relation.outgoing_invitation
    ? {
        ...relation.outgoing_invitation,
        created_at_text: formatDateTime(relation.outgoing_invitation.created_at)
      }
    : null;
  return {
    ...relation,
    incoming_invitations: incoming,
    outgoing_invitation: outgoing
  };
}

Page({
  data: {
    loading: false,
    relation: null,
    handlingInvite: false,
    unbinding: false
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

  async handleInvitation(e) {
    const invitationId = e.currentTarget.dataset.invitationId;
    const decision = e.currentTarget.dataset.decision;
    if (!invitationId || !decision || this.data.handlingInvite) return;

    this.setData({ handlingInvite: true });
    try {
      await callApi("approver.respondInvitation", {
        invitation_id: invitationId,
        decision
      });
      wx.showToast({
        title: decision === "accepted" ? "已接受" : "已拒绝",
        icon: "success"
      });
      await this.loadRelation();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ handlingInvite: false });
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
  },

  async unbindApprover() {
    if (this.data.unbinding) return;
    this.setData({ unbinding: true });
    try {
      await callApi("approver.unbind");
      wx.showToast({
        title: "已解绑审批人",
        icon: "success"
      });
      await this.loadRelation();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ unbinding: false });
    }
  },

  async unbindAssignedUser() {
    if (this.data.unbinding) return;
    this.setData({ unbinding: true });
    try {
      await callApi("approver.unbindAssignedUser");
      wx.showToast({
        title: "已解除审批关系",
        icon: "success"
      });
      await this.loadRelation();
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ unbinding: false });
    }
  }
});

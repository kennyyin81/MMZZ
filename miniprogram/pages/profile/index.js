const { callApi, showError } = require("../../utils/api");
const { formatRoles, formatDateTime, syncTabBar, openPage } = require("../../utils/const");

function formatUser(data) {
  const roles = Array.isArray(data.roles) ? data.roles.slice() : [];
  if (data.can_approve && !roles.includes("APPROVER")) {
    roles.push("APPROVER");
  }
  return {
    ...data,
    roles,
    rolesText: formatRoles(roles)
  };
}

function formatRelation(data) {
  const relation = data || {};
  const incoming = Array.isArray(relation.incoming_invitations)
    ? relation.incoming_invitations.map((item) => ({
        ...item,
        created_at_text: formatDateTime(item.created_at)
      }))
    : [];
  return {
    ...relation,
    incoming_invitations: incoming
  };
}

Page({
  data: {
    loading: false,
    user: null,
    relation: null
  },

  onShow() {
    syncTabBar("/pages/profile/index");
    this.loadAll();
  },

  async loadAll(userInfo) {
    this.setData({ loading: true });
    try {
      const [userData, relationData] = await Promise.all([
        callApi("auth.getCurrentUser", {}, userInfo),
        callApi("approver.getMyRelation")
      ]);
      this.setData({
        user: formatUser(userData),
        relation: formatRelation(relationData)
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  goRelationPage() {
    openPage("/pages/profile/relation");
  },

  goInvitationPage() {
    openPage("/pages/profile/invitation");
  },

  goEditProfilePage() {
    openPage("/pages/profile/edit");
  }
});

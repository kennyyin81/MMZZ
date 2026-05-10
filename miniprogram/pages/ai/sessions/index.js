const { callApi, showError } = require("../../../utils/api");
const { smartTimeAgo } = require("../../../utils/const");

function normalizeSession(item) {
  return {
    ...item,
    title: item.title || "新对话",
    last_message: item.last_message || "暂无消息",
    message_count: Number(item.message_count || 0),
    updated_at_text: smartTimeAgo(item.updated_at || item.created_at)
  };
}

Page({
  data: {
    list: [],
    pageNo: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    finished: false
  },

  onShow() {
    if (!this.data.list.length) {
      this.resetAndLoad();
    }
  },

  onPullDownRefresh() {
    this.resetAndLoad().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.finished) {
      this.loadList();
    }
  },

  resetAndLoad() {
    this.setData({
      list: [],
      pageNo: 1,
      total: 0,
      finished: false
    });
    return this.loadList();
  },

  async loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const data = await callApi("ai.listSessions", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map(normalizeSession);
      const merged = this.data.list.concat(list);
      const total = Number(data.total || 0);
      this.setData({
        list: merged,
        total,
        finished: merged.length >= total,
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  openSession(e) {
    const sessionId = e.currentTarget.dataset.id;
    if (!sessionId) return;
    wx.redirectTo({ url: `/pages/ai/chat/index?session_id=${sessionId}` });
  },

  newSession() {
    wx.redirectTo({ url: "/pages/ai/chat/index" });
  }
});

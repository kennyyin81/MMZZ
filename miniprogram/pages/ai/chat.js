const { callApi, showError } = require("../../utils/api");
const { formatDateTime } = require("../../utils/const");

function makeViewId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeMessage(item) {
  const role = item.role === "assistant" ? "assistant" : "user";
  const recommendedBars = Array.isArray(item.recommended_bars) ? item.recommended_bars : [];
  return {
    ...item,
    role,
    isUser: role === "user",
    isAssistant: role === "assistant",
    content: item.content || "",
    recommended_bars: recommendedBars,
    hasRecommendedBars: recommendedBars.length > 0,
    time_text: item.time ? formatDateTime(item.time).slice(5, 16) : "",
    _view_id: makeViewId(role)
  };
}

Page({
  data: {
    sessionId: "",
    messages: [],
    inputValue: "",
    loading: false,
    sending: false,
    scrollIntoView: "",
    hasLoaded: false
  },

  onLoad(options) {
    const sessionId = String((options && (options.sessionId || options.session_id)) || "").trim();
    if (sessionId) {
      this.setData({ sessionId });
      this.loadSession();
    } else {
      this.setData({ hasLoaded: true });
    }
  },

  async loadSession() {
    if (!this.data.sessionId) return;
    this.setData({ loading: true });
    try {
      const data = await callApi("ai.getSession", { session_id: this.data.sessionId });
      const session = data.session || {};
      const messages = (Array.isArray(session.messages) ? session.messages : []).map(normalizeMessage);
      this.setData({ messages, hasLoaded: true }, () => this.scrollToBottom());
      if (session.title) {
        wx.setNavigationBarTitle({ title: session.title });
      }
    } catch (err) {
      showError(err);
      this.setData({ hasLoaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  scrollToBottom() {
    const last = this.data.messages[this.data.messages.length - 1];
    if (last && last._view_id) {
      this.setData({ scrollIntoView: last._view_id });
    }
  },

  async sendMessage() {
    if (this.data.sending) return;
    const content = String(this.data.inputValue || "").trim();
    if (!content) {
      wx.showToast({ title: "请输入想聊的内容", icon: "none" });
      return;
    }

    const userMsg = normalizeMessage({ role: "user", content, time: new Date() });
    this.setData({
      inputValue: "",
      sending: true,
      messages: this.data.messages.concat(userMsg)
    }, () => this.scrollToBottom());

    try {
      const data = await callApi("ai.chat", {
        session_id: this.data.sessionId,
        message: content
      });
      const assistantMsg = normalizeMessage({
        role: "assistant",
        content: data.reply || "",
        time: new Date(),
        intent: data.intent || "chitchat",
        recommended_bar_ids: data.recommended_bar_ids || [],
        recommended_bars: data.recommended_bars || [],
        follow_up_question: data.follow_up_question || "",
        action_hint: data.action_hint || ""
      });
      this.setData({
        sessionId: data.session_id || this.data.sessionId,
        messages: this.data.messages.concat(assistantMsg)
      }, () => this.scrollToBottom());
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ sending: false });
    }
  },

  goBarDetail(e) {
    const barId = e.currentTarget.dataset.id;
    if (!barId) return;
    wx.navigateTo({ url: `/pages/bar/detail?bar_id=${barId}` });
  },

  openSbtiProfile() {
    wx.showToast({ title: "画像页由 FT-2 接入", icon: "none" });
  }
});

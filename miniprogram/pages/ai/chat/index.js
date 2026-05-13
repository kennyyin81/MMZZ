const { callApi, showError } = require("../../../utils/api");
const { formatDateTime } = require("../../../utils/const");
const { mergeWineMeta } = require("../../../utils/wine-data");

function makeViewId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function makeTextNodes(text) {
  const parts = String(text || "").split("\n");
  return parts.reduce((nodes, part, index) => {
    if (part) {
      nodes.push({ type: "text", text: part });
    }
    if (index < parts.length - 1) {
      nodes.push({ name: "br" });
    }
    return nodes;
  }, []);
}

function splitTags(value) {
  return String(value || "")
    .split(/[\r\n、,，/|；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function parseMarkdownNodes(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const nodes = [];
  const pattern = /(\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|`([^`\n]+)`)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push.apply(nodes, makeTextNodes(text.slice(lastIndex, match.index)));
    }
    const boldText = match[2] || match[3];
    const codeText = match[4];
    if (boldText) {
      nodes.push({
        name: "span",
        attrs: { style: "font-weight: 700;" },
        children: makeTextNodes(boldText)
      });
    } else if (codeText) {
      nodes.push({
        name: "span",
        attrs: { style: "padding: 2px 5px; border-radius: 4px; background: rgba(99,102,241,0.10); color: #4f46e5;" },
        children: [{ type: "text", text: codeText }]
      });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push.apply(nodes, makeTextNodes(text.slice(lastIndex)));
  }
  return nodes.length ? nodes : makeTextNodes(text);
}

function normalizeMessage(item) {
  const role = item.role === "assistant" ? "assistant" : "user";
  const recommendedBars = Array.isArray(item.recommended_bars) ? item.recommended_bars : [];
  const recommendedWines = (Array.isArray(item.recommended_wines) ? item.recommended_wines : []).map((wine) => {
    const merged = mergeWineMeta(wine || {});
    return Object.assign({}, merged, {
      flavorTags: splitTags(merged.flavor),
      sceneText: merged.scene || merged.recommended_scenes || "",
      averageRatingText: Number(merged.average_rating || 0) > 0 ? Number(merged.average_rating).toFixed(1) : "暂无"
    });
  });
  return Object.assign({}, item, {
    role,
    isUser: role === "user",
    isAssistant: role === "assistant",
    content: item.content || "",
    content_nodes: parseMarkdownNodes(item.content),
    follow_up_question: item.follow_up_question || "",
    follow_up_nodes: parseMarkdownNodes(item.follow_up_question),
    recommended_bars: recommendedBars,
    recommended_wines: recommendedWines,
    hasRecommendedBars: recommendedBars.length > 0,
    hasRecommendedWines: recommendedWines.length > 0,
    time_text: item.time ? formatDateTime(item.time).slice(5, 16) : "",
    _view_id: makeViewId(role)
  });
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
        recommended_wine_ids: data.recommended_wine_ids || [],
        recommended_wines: data.recommended_wines || [],
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

  goWineDetail(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    wx.navigateTo({ url: `/pages/wine/detail?wineId=${wineId}` });
  },

  openSessions() {
    wx.navigateTo({ url: "/pages/ai/sessions/index" });
  },

  openSbtiProfile() {
    wx.navigateTo({ url: "/pages/ai/sbti-survey/index" });
  }
});

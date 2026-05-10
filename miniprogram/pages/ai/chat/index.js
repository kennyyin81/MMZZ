const { callApi } = require("../../../utils/api");

Page({
  data: {
    messages: [],
    inputText: '',
    loading: false,
    sessionId: '',
    toView: '',
    userAvatar: '我'
  },

  onLoad() {
    // 初始化欢迎消息
    this.addMessage('ai', '你好！我是你的酒馆推荐助手。告诉我你想找什么样的酒馆，或者有任何问题都可以问我！');
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async sendMessage() {
    const { inputText, messages, sessionId } = this.data;
    if (!inputText.trim() || this.data.loading) return;

    // 添加用户消息
    this.addMessage('user', inputText);
    const userInput = inputText.trim();
    this.setData({ inputText: '', loading: true });

    try {
      const res = await callApi('ai.chat', {
        message: userInput,
        session_id: sessionId
      });

      this.setData({ sessionId: res.session_id });

      // 添加 AI 回复
      this.addMessage('ai', res.reply, res.recommended_bars);
    } catch (error) {
      this.addMessage('ai', '抱歉，我遇到了一点问题，请再试一次~');
    } finally {
      this.setData({ loading: false });
    }
  },

  addMessage(role, content, recommendedBars = null) {
    const { messages } = this.data;
    const msgIndex = messages.length;
    
    messages.push({
      role,
      content,
      recommended_bars: recommendedBars,
      time: new Date().toISOString()
    });

    this.setData({
      messages,
      toView: `msg-${msgIndex}`
    });
  },

  goToBarDetail(e) {
    const barId = e.currentTarget.dataset.barId;
    wx.navigateTo({ url: `/pages/bar/detail?bar_id=${barId}` });
  }
});

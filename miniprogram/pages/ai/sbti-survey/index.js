const { callApi } = require("../../../utils/api");

Page({
  data: {
    currentQuestion: 0,
    currentQuestionOptions: [],
    questions: [
      {
        question: "你更喜欢哪类酒？",
        key: "drink_types",
        options: [
          "鸡尾酒",
          "精酿啤酒",
          "威士忌/白兰地",
          "红酒/白葡萄酒",
          "清酒/梅酒",
          "低度微醺饮品",
          "都想试试"
        ],
        answers: []
      },
      {
        question: "口味倾向？",
        key: "taste_preferences",
        options: [
          "甜型",
          "果味",
          "清爽解腻",
          "浓烈醇厚",
          "酸爽开胃"
        ],
        answers: []
      },
      {
        question: "你一般什么场景去酒馆？",
        key: "social_scene",
        options: [
          "一个人放松",
          "跟朋友小聚",
          "约会",
          "商务应酬",
          "特殊纪念日"
        ],
        answers: []
      },
      {
        question: "你喜欢什么氛围？",
        key: "atmosphere",
        options: [
          "安静可聊天",
          "有背景音乐",
          "热闹有驻唱/DJ",
          "有户外位置",
          "有特色装修/主题"
        ],
        answers: []
      },
      {
        question: "你的人均预算大概是多少？",
        key: "budget_amount",
        inputType: "number",
        placeholder: "请输入金额数字",
        unit: "元",
        value: ""
      }
    ],
    hasAnswer: false,
    mode: "init"
  },

  onLoad(options) {
    this.setData({
      mode: options.mode || "init"
    });
    this.updateCurrentOptions();
  },

  updateCurrentOptions() {
    const { currentQuestion, questions } = this.data;
    const currentQ = questions[currentQuestion];
    if (!currentQ) return;

    if (currentQ.inputType === "number") {
      this.setData({
        currentQuestionOptions: [],
        hasAnswer: this.hasQuestionAnswer(currentQ)
      });
      return;
    }

    const optionsWithStatus = currentQ.options.map((option) => ({
      label: option,
      value: option,
      selected: currentQ.answers.includes(option)
    }));

    this.setData({
      currentQuestionOptions: optionsWithStatus,
      hasAnswer: this.hasQuestionAnswer(currentQ)
    });
  },

  hasQuestionAnswer(question) {
    if (!question) return false;
    if (question.inputType === "number") {
      const value = Number(question.value);
      return Number.isFinite(value) && value > 0;
    }
    return Array.isArray(question.answers) && question.answers.length > 0;
  },

  toggleOption(e) {
    const option = e.currentTarget.dataset.option;
    const { currentQuestion, questions } = this.data;
    const currentQ = questions[currentQuestion];

    let newAnswers;
    if (currentQ.single) {
      newAnswers = [option];
    } else {
      const index = currentQ.answers.indexOf(option);
      if (index > -1) {
        newAnswers = currentQ.answers.slice(0, index).concat(currentQ.answers.slice(index + 1));
      } else {
        newAnswers = currentQ.answers.concat(option);
      }
    }

    const newQuestions = questions.map((q, idx) => {
      if (idx === currentQuestion) {
        return Object.assign({}, q, {
          answers: newAnswers
        });
      }
      return q;
    });

    this.setData({
      questions: newQuestions,
      hasAnswer: newAnswers.length > 0
    });

    this.updateCurrentOptions();
  },

  onBudgetInput(e) {
    const value = String(e.detail.value || "").replace(/[^\d]/g, "");
    const { currentQuestion, questions } = this.data;
    const newQuestions = questions.map((q, idx) => {
      if (idx === currentQuestion) {
        return Object.assign({}, q, {
          value
        });
      }
      return q;
    });

    this.setData({
      questions: newQuestions,
      hasAnswer: Number(value) > 0
    });
  },

  prevQuestion() {
    if (this.data.currentQuestion > 0) {
      const prevIndex = this.data.currentQuestion - 1;
      const prevQuestion = this.data.questions[prevIndex];
      this.setData({
        currentQuestion: prevIndex,
        hasAnswer: this.hasQuestionAnswer(prevQuestion)
      });
      this.updateCurrentOptions();
    }
  },

  nextQuestion() {
    const { currentQuestion, questions } = this.data;

    if (currentQuestion < questions.length - 1) {
      const nextIndex = currentQuestion + 1;
      const nextQuestion = questions[nextIndex];
      this.setData({
        currentQuestion: nextIndex,
        hasAnswer: this.hasQuestionAnswer(nextQuestion)
      });
      this.updateCurrentOptions();
    } else {
      this.submitSurvey();
    }
  },

  async submitSurvey() {
    const { questions } = this.data;
    const formData = {};

    questions.forEach((q) => {
      if (q.key === "budget_amount") {
        formData[q.key] = Number(q.value || 0);
      } else {
        formData[q.key] = q.answers;
      }
    });

    wx.showLoading({ title: "提交中", mask: true });

    try {
      await callApi("sbti.init", formData);
      wx.hideLoading();

      wx.showToast({
        title: "提交成功",
        icon: "success",
        duration: 1500
      });

      setTimeout(() => {
        if (this.data.mode === "redo") {
          wx.navigateBack();
        } else {
          wx.redirectTo({ url: "/pages/ai/chat/index" });
        }
      }, 1500);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || error.errMsg || "提交失败，请重试",
        icon: "none",
        duration: 2000
      });
    }
  }
});

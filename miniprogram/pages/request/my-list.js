const { callApi, showError } = require("../../utils/api");
const { syncTabBar } = require("../../utils/const");

function formatTime(date) {
  if (!date) return "";
  const d = new Date(date);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

Page({
  data: {
    todoList: [],
    pageNo: 1,
    pageSize: 50,
    total: 0,
    pendingCount: 0,
    loading: false,
    finished: false,
    selectedDate: "", // 空表示显示全部
    todayDate: ""
  },

  onLoad() {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({ todayDate: today });
  },

  onShow() {
    syncTabBar("/pages/request/my-list");
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.finished) {
      this.loadMore();
    }
  },

  onDateChange(e) {
    const selectedDate = e.detail.value;
    this.setData({
      selectedDate,
      todoList: [],
      pageNo: 1,
      finished: false
    });
    this.loadList();
  },

  clearDateFilter() {
    this.setData({
      selectedDate: "",
      todoList: [],
      pageNo: 1,
      finished: false
    });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const params = {
        page_no: 1,
        page_size: this.data.pageSize
      };
      // 只有选择了日期才传 date 参数
      if (this.data.selectedDate) {
        params.date = this.data.selectedDate;
      }
      const data = await callApi("todo.listMine", params);
      this.setData({
        todoList: this.formatList(data.list || []),
        total: Number(data.total || 0),
        pendingCount: Number(data.pending_count || 0),
        finished: (data.list || []).length < this.data.pageSize,
        pageNo: 2
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    this.setData({ loading: true });
    try {
      const params = {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      };
      if (this.data.selectedDate) {
        params.date = this.data.selectedDate;
      }
      const data = await callApi("todo.listMine", params);
      const list = this.formatList(data.list || []);
      this.setData({
        todoList: this.data.todoList.concat(list),
        finished: list.length < this.data.pageSize,
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  formatList(list) {
    return list.map((item) => ({
      ...item,
      date_text: formatDate(item.submitted_at),
      submitted_at_text: formatTime(item.submitted_at),
      completed_at_text: formatTime(item.completed_at || item.decided_at),
      status_text: this.getStatusText(item.status)
    }));
  },

  getStatusText(status) {
    const map = {
      "todo": "待完成",
      "completed": "已完成",
      "pending": "待审批",
      "approved": "已通过",
      "rejected": "未通过"
    };
    return map[status] || status;
  },

  async toggleComplete(e) {
    const { id, status, rewarded } = e.currentTarget.dataset;
    
    if (status === "todo") {
      try {
        const result = await callApi("todo.complete", { todo_id: id });
        wx.showToast({ title: result.message, icon: "success" });
        this.loadList();
      } catch (err) {
        showError(err);
      }
    } else if (status === "completed") {
      try {
        await callApi("todo.reopen", { todo_id: id });
        wx.showToast({ title: "已重新打开", icon: "success" });
        this.loadList();
      } catch (err) {
        showError(err);
      }
    }
  },

  async removeTodo(e) {
    const { id, title } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除待办",
      content: `确认删除「${title}」？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await callApi("todo.remove", { todo_id: id });
            wx.showToast({ title: "已删除", icon: "success" });
            this.loadList();
          } catch (err) {
            showError(err);
          }
        }
      }
    });
  },

  goCreateTodo() {
    wx.navigateTo({ url: "/pages/todo/create" });
  },

  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/request/detail?requestType=todo&requestId=${id}`
    });
  }
});

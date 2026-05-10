const { callApi, showError } = require("../../utils/api");
const { smartTimeAgo, openPage } = require("../../utils/const");

function splitColumns(list) {
  const left = [];
  const right = [];
  list.forEach((item, i) => {
    if (i % 2 === 0) left.push(item);
    else right.push(item);
  });
  return { left, right };
}

Page({
  data: {
    list: [],
    leftList: [],
    rightList: [],
    pageNo: 1,
    pageSize: 10,
    total: 0,
    loading: false,
    finished: false,
    needRefresh: false
  },

  onShow() {
    if (this.data.needRefresh || wx.getStorageSync("my_posts_need_refresh")) {
      wx.removeStorageSync("my_posts_need_refresh");
      this.resetAndLoad();
    } else if (!this.data.list.length) {
      this.resetAndLoad();
    }
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.finished) {
      this.loadList();
    }
  },

  resetAndLoad() {
    this.setData({
      list: [],
      leftList: [],
      rightList: [],
      pageNo: 1,
      total: 0,
      finished: false,
      needRefresh: false
    });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const data = await callApi("square.listMine", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: smartTimeAgo(item.created_at)
      }));
      const nextList = this.data.list.concat(list);
      const { left, right } = splitColumns(nextList);
      this.setData({
        list: nextList,
        leftList: left,
        rightList: right,
        total: Number(data.total || 0),
        finished: nextList.length >= Number(data.total || 0),
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  goPostDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ needRefresh: true });
    openPage(`/pages/square/detail?postId=${id}`);
  }
});

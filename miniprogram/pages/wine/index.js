const { callApi, showError } = require("../../utils/api");
const { mergeWineMeta } = require("../../utils/wine-data");
const { openPage, syncTabBar } = require("../../utils/const");

const TASTE_LEVELS = {
  acidity: ["几乎无酸", "微酸清新", "酸度平衡", "酸感明显", "酸爽突出"],
  sweetness: ["几乎不甜", "微甜柔和", "甜度平衡", "甜感明显", "香甜浓郁"],
  bitterness: ["几乎不苦", "微苦回甘", "苦度平衡", "苦感明显", "苦韵突出"],
  spiciness: ["几乎不辣", "微辣顺口", "辛感适中", "辛辣明显", "烈感强劲"]
};

const TASTE_FILTER_OPTIONS = [
  { label: "全部口感", value: "all" },
  { label: "偏酸", value: "acidity" },
  { label: "偏甜", value: "sweetness" },
  { label: "偏苦", value: "bitterness" },
  { label: "偏辣", value: "spiciness" }
];

const ORDER_OPTIONS = [
  { label: "默认", value: "none" },
  { label: "升序", value: "asc" },
  { label: "降序", value: "desc" }
];

const PAGE_SIZE = 20;

function decorateWine(item) {
  const wine = mergeWineMeta(item);
  return {
    ...wine,
    averageRatingText: Number(wine.average_rating || 0).toFixed(1),
    acidityText: TASTE_LEVELS.acidity[wine.acidity] || "",
    sweetnessText: TASTE_LEVELS.sweetness[wine.sweetness] || "",
    bitternessText: TASTE_LEVELS.bitterness[wine.bitterness] || "",
    spicinessText: TASTE_LEVELS.spiciness[wine.spiciness] || ""
  };
}

Page({
  data: {
    list: [],
    loading: false,
    loadingMore: false,
    hasLoaded: false,
    hasMore: true,
    pageNo: 1,
    total: 0,
    tasteFilterOptions: TASTE_FILTER_OPTIONS.map((item) => item.label),
    tasteFilterIndex: 0,
    ratingOrderOptions: ORDER_OPTIONS.map((item) => item.label),
    ratingOrderIndex: 0,
    alcoholOrderOptions: ORDER_OPTIONS.map((item) => item.label),
    alcoholOrderIndex: 0
  },

  onShow() {
    syncTabBar("/pages/wine/index");
    if (!this.data.hasLoaded) {
      this.refreshList();
    }
  },

  onPullDownRefresh() {
    this.refreshList().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    this.loadNextPage();
  },

  getFilterPayload(pageNo) {
    return {
      page_no: pageNo,
      page_size: PAGE_SIZE,
      taste_filter: TASTE_FILTER_OPTIONS[this.data.tasteFilterIndex].value,
      rating_order: ORDER_OPTIONS[this.data.ratingOrderIndex].value,
      alcohol_order: ORDER_OPTIONS[this.data.alcoholOrderIndex].value
    };
  },

  async refreshList() {
    this.setData({
      loading: true,
      hasMore: true,
      pageNo: 1,
      list: []
    });
    try {
      const data = await callApi("wine.list", this.getFilterPayload(1));
      const list = (data.list || [])
        .filter((item) => item && item.wine_id)
        .map(decorateWine);
      this.setData({
        list,
        hasLoaded: true,
        hasMore: !!data.has_more,
        pageNo: 1,
        total: Number(data.total || 0)
      });
    } catch (err) {
      showError(err);
      this.setData({ hasLoaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadNextPage() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const nextPage = this.data.pageNo + 1;
    this.setData({ loadingMore: true });
    try {
      const data = await callApi("wine.list", this.getFilterPayload(nextPage));
      const list = (data.list || [])
        .filter((item) => item && item.wine_id)
        .map(decorateWine);
      this.setData({
        list: this.data.list.concat(list),
        hasMore: !!data.has_more,
        pageNo: nextPage,
        total: Number(data.total || this.data.total || 0)
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  onTasteFilterChange(e) {
    this.setData({ tasteFilterIndex: Number(e.detail.value || 0) });
    this.refreshList();
  },

  onRatingOrderChange(e) {
    this.setData({ ratingOrderIndex: Number(e.detail.value || 0) });
    this.refreshList();
  },

  onAlcoholOrderChange(e) {
    this.setData({ alcoholOrderIndex: Number(e.detail.value || 0) });
    this.refreshList();
  },

  goDetail(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    openPage(`/pages/wine/detail?wineId=${wineId}`);
  }
});

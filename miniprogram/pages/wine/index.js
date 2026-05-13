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

const SORT_OPTIONS = [
  { label: "默认", rating: "none", favorite: "none" },
  { label: "评分最高", rating: "desc", favorite: "none" },
  { label: "评分最低", rating: "asc", favorite: "none" },
  { label: "收藏最多", rating: "none", favorite: "desc" },
  { label: "收藏最少", rating: "none", favorite: "asc" }
];

const VIEW_MODES = [
  { label: "酒馆", value: "bar" },
  { label: "酒款", value: "wine" }
];

const CHINA_PROVINCES = [
  "北京市",
  "天津市",
  "河北省",
  "山西省",
  "内蒙古自治区",
  "辽宁省",
  "吉林省",
  "黑龙江省",
  "上海市",
  "江苏省",
  "浙江省",
  "安徽省",
  "福建省",
  "江西省",
  "山东省",
  "河南省",
  "湖北省",
  "湖南省",
  "广东省",
  "广西壮族自治区",
  "海南省",
  "重庆市",
  "四川省",
  "贵州省",
  "云南省",
  "西藏自治区",
  "陕西省",
  "甘肃省",
  "青海省",
  "宁夏回族自治区",
  "新疆维吾尔自治区",
  "香港特别行政区",
  "澳门特别行政区",
  "台湾省"
];

const PAGE_SIZE = 20;

function decorateWine(item) {
  const wine = mergeWineMeta(item);
  return {
    ...wine,
    item_type: "wine",
    item_key: `wine_${wine.wine_id}`,
    isWine: true,
    isBar: false,
    placeholderText: "酒",
    averageRatingText: Number(wine.average_rating || 0) > 0 ? Number(wine.average_rating).toFixed(1) : "暂无",
    acidityText: TASTE_LEVELS.acidity[wine.acidity] || "",
    sweetnessText: TASTE_LEVELS.sweetness[wine.sweetness] || "",
    bitternessText: TASTE_LEVELS.bitterness[wine.bitterness] || "",
    spicinessText: TASTE_LEVELS.spiciness[wine.spiciness] || ""
  };
}

function getBarCover(item) {
  if (item.image_url) return item.image_url;
  const first = Array.isArray(item.images) ? item.images[0] : null;
  if (typeof first === "string") return first;
  return (first && (first.thumb || first.url)) || "";
}

function decorateBar(item) {
  return {
    ...item,
    item_type: "bar",
    item_key: `bar_${item.bar_id}`,
    isWine: false,
    isBar: true,
    image: getBarCover(item),
    placeholderText: String(item.name || "酒馆").slice(0, 2),
    averageRatingText: Number(item.rating || 0) > 0 ? Number(item.rating).toFixed(1) : "暂无",
    ratingCountText: Number(item.rating_count || 0) > 0 ? `${Number(item.rating_count)} 人评分` : "暂无评分",
    summary: item.description || item.highlights || "",
    locationText: [item.province, item.city, item.area].filter(Boolean).join(" · ") || "未知区域",
    metaText: `${[item.province, item.city, item.area].filter(Boolean).join(" · ") || "未知区域"}${item.bar_type ? ` · ${item.bar_type}` : ""}${item.avg_price ? ` · 人均¥${item.avg_price}` : ""}`
  };
}

Page({
  data: {
    modeOptions: VIEW_MODES.map((item) => item.label),
    modeIndex: 0,
    activeMode: "bar",
    list: [],
    loading: false,
    loadingMore: false,
    hasLoaded: false,
    hasMore: true,
    pageNo: 1,
    total: 0,
    showBackTop: false,
    tasteFilterOptions: TASTE_FILTER_OPTIONS.map((item) => item.label),
    tasteFilterIndex: 0,
    alcoholOrderOptions: ORDER_OPTIONS.map((item) => item.label),
    alcoholOrderIndex: 0,
    sortOptions: SORT_OPTIONS.map((item) => item.label),
    sortIndex: 0,
    provinceOptions: ["全部省份"].concat(CHINA_PROVINCES),
    provinceIndex: 0,
    cityOptions: ["全部城市"],
    cityIndex: 0,
    keyword: ""
  },

  onShow() {
    syncTabBar("/pages/wine/index");
    const app = getApp();
    const shouldRefreshBarRating = !!(app && app.globalData && app.globalData.barRatingChanged);
    if (shouldRefreshBarRating && this.data.activeMode === "bar") {
      app.globalData.barRatingChanged = false;
      this.refreshList();
      return;
    }
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

  onPageScroll(e) {
    const show = e.scrollTop > 300;
    if (show !== this.data.showBackTop) {
      this.setData({ showBackTop: show });
    }
  },

  onBackTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  getFilterPayload(pageNo) {
    const sortOption = SORT_OPTIONS[this.data.sortIndex] || SORT_OPTIONS[0];
    return {
      page_no: pageNo,
      page_size: PAGE_SIZE,
      keyword: String(this.data.keyword || "").trim(),
      taste_filter: TASTE_FILTER_OPTIONS[this.data.tasteFilterIndex].value,
      rating_order: sortOption.rating,
      favorite_order: sortOption.favorite,
      alcohol_order: ORDER_OPTIONS[this.data.alcoholOrderIndex].value
    };
  },

  getBarPayload(pageNo) {
    return {
      page_no: pageNo,
      page_size: PAGE_SIZE,
      keyword: String(this.data.keyword || "").trim(),
      province: this.data.provinceIndex > 0 ? this.data.provinceOptions[this.data.provinceIndex] : "",
      city: this.data.cityIndex > 0 ? this.data.cityOptions[this.data.cityIndex] : ""
    };
  },

  async loadWinePage(pageNo) {
    const data = await callApi("wine.list", this.getFilterPayload(pageNo));
    const list = (data.list || [])
      .filter((item) => item && item.wine_id)
      .map(decorateWine);

    return {
      list,
      hasMore: !!data.has_more,
      total: Number(data.total || 0)
    };
  },

  async loadBarPage(pageNo) {
    const data = await callApi("bar.list", this.getBarPayload(pageNo));
    const list = (data.list || [])
      .filter((item) => item && item.bar_id)
      .map(decorateBar);
    const cityOptions = ["全部城市"].concat(data.city_options || []);

    if (pageNo === 1) {
      this.setData({
        cityOptions,
        cityIndex: Math.min(this.data.cityIndex, cityOptions.length - 1)
      });
    }
    return {
      list,
      hasMore: !!data.has_more,
      total: Number(data.total || 0)
    };
  },

  loadCurrentPage(pageNo) {
    return this.data.activeMode === "bar" ? this.loadBarPage(pageNo) : this.loadWinePage(pageNo);
  },

  async refreshList() {
    this.setData({
      loading: true,
      hasMore: true,
      pageNo: 1,
      list: []
    });
    try {
      const data = await this.loadCurrentPage(1);
      this.setData({
        list: data.list,
        hasLoaded: true,
        hasMore: data.hasMore,
        pageNo: 1,
        total: data.total
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
      const data = await this.loadCurrentPage(nextPage);
      this.setData({
        list: this.data.list.concat(data.list),
        hasMore: data.hasMore,
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

  onModeChange(e) {
    const modeIndex = Number(e.currentTarget.dataset.index || 0);
    const option = VIEW_MODES[modeIndex] || VIEW_MODES[0];
    if (option.value === this.data.activeMode) return;
    this.setData({
      modeIndex,
      activeMode: option.value,
      keyword: ""
    });
    this.refreshList();
  },

  onAlcoholOrderChange(e) {
    this.setData({ alcoholOrderIndex: Number(e.detail.value || 0) });
    this.refreshList();
  },

  onSortChange(e) {
    this.setData({ sortIndex: Number(e.detail.value || 0) });
    this.refreshList();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearchConfirm() {
    this.refreshList();
  },

  onProvinceChange(e) {
    this.setData({
      provinceIndex: Number(e.detail.value || 0),
      cityIndex: 0
    });
    this.refreshList();
  },

  onCityChange(e) {
    this.setData({ cityIndex: Number(e.detail.value || 0) });
    this.refreshList();
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    const type = e.currentTarget.dataset.type;
    if (!id) return;
    if (type === "bar") {
      openPage(`/pages/bar/detail?bar_id=${id}`);
      return;
    }
    openPage(`/pages/wine/detail?wineId=${id}`);
  }
});

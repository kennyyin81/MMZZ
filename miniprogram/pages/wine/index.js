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

function parseAlcoholValue(alcohol) {
  const text = String(alcohol || "");
  const match = text.match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function applyFiltersAndSort(rawList, tasteFilter, ratingOrder, alcoholOrder) {
  let list = Array.isArray(rawList) ? rawList.slice() : [];

  if (tasteFilter && tasteFilter !== "all") {
    list = list.filter((item) => Number(item[tasteFilter] || 0) >= 3);
  }

  if (ratingOrder !== "none" || alcoholOrder !== "none") {
    list.sort((a, b) => {
      if (ratingOrder !== "none") {
        const ra = Number(a.average_rating || 0);
        const rb = Number(b.average_rating || 0);
        if (ra !== rb) {
          return ratingOrder === "asc" ? ra - rb : rb - ra;
        }
      }
      if (alcoholOrder !== "none") {
        const aa = parseAlcoholValue(a.alcohol);
        const ab = parseAlcoholValue(b.alcohol);
        if (aa !== ab) {
          return alcoholOrder === "asc" ? aa - ab : ab - aa;
        }
      }
      return 0;
    });
  }

  return list;
}

Page({
  data: {
    rawList: [],
    list: [],
    loading: false,
    hasLoaded: false,
    tasteFilterOptions: TASTE_FILTER_OPTIONS.map((item) => item.label),
    tasteFilterIndex: 0,
    ratingOrderOptions: ORDER_OPTIONS.map((item) => item.label),
    ratingOrderIndex: 0,
    alcoholOrderOptions: ORDER_OPTIONS.map((item) => item.label),
    alcoholOrderIndex: 0
  },

  onShow() {
    syncTabBar("/pages/wine/index");
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const data = await callApi("wine.list");
      const rawList = (data.list || [])
        .filter((item) => item && item.wine_id)
        .map(decorateWine);
      this.setData({
        rawList,
        hasLoaded: true
      });
      this.applyCurrentFilters();
    } catch (err) {
      showError(err);
      this.setData({ hasLoaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyCurrentFilters() {
    const tasteFilter = TASTE_FILTER_OPTIONS[this.data.tasteFilterIndex].value;
    const ratingOrder = ORDER_OPTIONS[this.data.ratingOrderIndex].value;
    const alcoholOrder = ORDER_OPTIONS[this.data.alcoholOrderIndex].value;
    this.setData({
      list: applyFiltersAndSort(this.data.rawList, tasteFilter, ratingOrder, alcoholOrder)
    });
  },

  onTasteFilterChange(e) {
    this.setData({ tasteFilterIndex: Number(e.detail.value || 0) });
    this.applyCurrentFilters();
  },

  onRatingOrderChange(e) {
    this.setData({ ratingOrderIndex: Number(e.detail.value || 0) });
    this.applyCurrentFilters();
  },

  onAlcoholOrderChange(e) {
    this.setData({ alcoholOrderIndex: Number(e.detail.value || 0) });
    this.applyCurrentFilters();
  },

  goDetail(e) {
    const wineId = e.currentTarget.dataset.id;
    if (!wineId) return;
    openPage(`/pages/wine/detail?wineId=${wineId}`);
  }
});

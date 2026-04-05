const WINE_META = {
  "red-wine": {
    image: "/assets/wines/red-wine.svg",
    accent: "#8f2332",
    badge: "果香 / 单宁"
  },
  whisky: {
    image: "/assets/wines/whisky.svg",
    accent: "#b86f2b",
    badge: "桶陈 / 烟熏"
  },
  sake: {
    image: "/assets/wines/sake.svg",
    accent: "#3f7d6f",
    badge: "米香 / 清透"
  },
  "craft-beer": {
    image: "/assets/wines/craft-beer.svg",
    accent: "#d9a11b",
    badge: "酒花 / 麦芽"
  }
};

function getWineMeta(wineId) {
  return WINE_META[wineId] || {
    image: "",
    accent: "#8c5a18",
    badge: "风味探索"
  };
}

function mergeWineMeta(item) {
  const meta = getWineMeta(item.wine_id);
  return {
    ...item,
    image: item.image_url || meta.image,
    accent: meta.accent,
    badge: meta.badge
  };
}

module.exports = {
  WINE_META,
  getWineMeta,
  mergeWineMeta
};

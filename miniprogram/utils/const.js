const REQUEST_TYPE = {
  EARN: "earn",
  DRINK: "drink",
  TODO: "todo"
};

const REQUEST_TYPE_LABEL = {
  earn: "加分申请",
  drink: "喝酒申请",
  todo: "待办工作"
};

const ROLE_LABEL = {
  USER: "普通用户",
  APPROVER: "审批人",
  ADMIN: "管理员",
  SOMMELIER: "品酒师"
};

const REQUEST_STATUS_LABEL = {
  pending: "待审批",
  approved: "已批准",
  rejected: "未通过",
  withdrawn: "已撤回"
};

const LEDGER_SOURCE_LABEL = {
  earn_request: "加分入账",
  drink_request: "喝酒扣分",
  todo_work: "待办加分",
  manual_adjust: "人工调整"
};

const TAB_PAGES = [
  "/pages/home/index",
  "/pages/wine/index",
  "/pages/request/my-list",
  "/pages/profile/index"
];

function formatRoles(roles) {
  const list = Array.isArray(roles) ? roles : [];
  if (!list.length) return "-";
  return list.map((role) => ROLE_LABEL[role] || role).join("、");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseDateValue(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = String(value || "").trim();
  if (!text) return new Date("");

  let normalized = text.replace(/\.\d+$/, "");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    normalized = normalized.replace(/-/g, "/");
  }
  return new Date(normalized);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  ].join(" ");
}

function getStatusClass(status) {
  if (status === "approved") return "status-approved";
  if (status === "pending") return "status-pending";
  if (status === "withdrawn") return "status-withdrawn";
  return "status-rejected";
}

function getLedgerSourceLabel(sourceType) {
  return LEDGER_SOURCE_LABEL[sourceType] || sourceType || "-";
}

function formatPointsChange(value) {
  const points = Number(value || 0);
  return points > 0 ? `+${points}` : `${points}`;
}

function openPage(url) {
  if (!url) return;

  const [basePath, queryString] = String(url).split("?");
  if (TAB_PAGES.includes(basePath)) {
    if (queryString) {
      const app = getApp();
      app.globalData = app.globalData || {};
      app.globalData.pendingTabRoute = {
        path: basePath,
        query: queryString
      };
    }
    wx.switchTab({ url: basePath });
    return;
  }

  wx.navigateTo({ url });
}

function syncTabBar(selected) {
  const pages = getCurrentPages();
  if (!pages.length) return;

  const currentPage = pages[pages.length - 1];
  if (!currentPage || typeof currentPage.getTabBar !== "function") return;

  const tabBar = currentPage.getTabBar();
  if (!tabBar || typeof tabBar.setData !== "function") return;
  tabBar.setData({ selected });
}

module.exports = {
  REQUEST_TYPE,
  REQUEST_TYPE_LABEL,
  ROLE_LABEL,
  REQUEST_STATUS_LABEL,
  LEDGER_SOURCE_LABEL,
  TAB_PAGES,
  formatRoles,
  formatDateTime,
  formatPointsChange,
  getStatusClass,
  getLedgerSourceLabel,
  openPage,
  syncTabBar
};

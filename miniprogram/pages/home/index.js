const { callApi, showError } = require("../../utils/api");
const { formatRoles, openPage, syncTabBar, formatDateTime } = require("../../utils/const");

function pad(value) {
  return String(value).padStart(2, "0");
}

function buildDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function getTodayDate() {
  const now = new Date();
  return buildDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function getNowTimeText() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatHourMinute(value) {
  const text = formatDateTime(value);
  if (!text || text === "-") return "--:--";
  const parts = String(text).split(" ");
  const timePart = parts[1] || "";
  if (!timePart) return "--:--";
  return timePart.slice(0, 5);
}

function monthLabel(year, month) {
  return `${year}年${pad(month)}月`;
}

function formatUser(data) {
  const roles = Array.isArray(data.roles) ? data.roles.slice() : [];
  if (data.can_approve && !roles.includes("APPROVER")) {
    roles.push("APPROVER");
  }
  return {
    ...data,
    roles,
    rolesText: formatRoles(roles)
  };
}

function groupByDate(list) {
  return (Array.isArray(list) ? list : []).reduce((acc, item) => {
    const date = String(item.record_date || "").trim();
    if (!date) return acc;
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {});
}

function buildMonthWeeks(year, month, recordsByDate) {
  const today = getTodayDate();
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ key: `empty-${i}`, inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = buildDate(year, month, day);
    const records = recordsByDate[date] || [];
    cells.push({
      key: date,
      inMonth: true,
      isToday: date === today,
      day,
      date,
      records,
      thumbnails: records.slice(0, 2).map((item) => item.thumbnail_url || (item.images && item.images[0] && (item.images[0].thumb || item.images[0].url)) || ""),
      extraCount: records.length > 2 ? records.length - 2 : 0
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, inMonth: false });
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

Page({
  data: {
    loading: false,
    user: null,
    canApprove: false,
    isAdmin: false,
    isSommelier: false,
    unreadNotificationCount: 0,
    pendingCount: 0,
    loadError: "",
    calendarLoading: false,
    calendarUploading: false,
    calendarYear: 0,
    calendarMonth: 0,
    calendarMonthLabel: "",
    calendarWeeks: [],
    selectedCalendarDate: "",
    showCalendarDayPanel: false,
    calendarDayRecords: []
  },

  onShow() {
    syncTabBar("/pages/home/index");
    this.initCalendarBase();
    this.loadPage();
    this.loadHomeCalendarRecords();
  },

  initCalendarBase() {
    if (this.data.calendarYear && this.data.calendarMonth) return;
    const now = new Date();
    this.setData({
      calendarYear: now.getFullYear(),
      calendarMonth: now.getMonth() + 1,
      selectedCalendarDate: getTodayDate()
    });
  },

  async loadPage(userInfo) {
    this.setData({ loading: true, loadError: "" });
    try {
      const [userData, pendingData] = await Promise.all([
        callApi("auth.getCurrentUser", {}, userInfo),
        callApi("approval.listPending", {
          page_no: 1,
          page_size: 1
        }).catch(() => ({ total: 0 }))
      ]);

      const user = formatUser(userData);

      this.setData({
        user,
        canApprove: !!user.can_approve,
        isAdmin: (user.roles || []).includes("ADMIN"),
        isSommelier: (user.roles || []).includes("SOMMELIER"),
        unreadNotificationCount: Number(user.unread_notification_count || 0),
        pendingCount: Number(pendingData.total || 0)
      });

      getApp().globalData.currentUser = user;
    } catch (err) {
      this.setData({
        user: null,
        pendingCount: 0,
        unreadNotificationCount: 0,
        loadError: (err && err.message) || "首页加载失败"
      });
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadHomeCalendarRecords() {
    const { calendarYear, calendarMonth } = this.data;
    if (!calendarYear || !calendarMonth) return;
    this.setData({ calendarLoading: true });
    try {
      const monthText = `${calendarYear}-${pad(calendarMonth)}`;
      const data = await callApi("drinkDiary.listByMonth", { month: monthText });
      const recordsByDate = groupByDate(data.list || []);
      const weeks = buildMonthWeeks(calendarYear, calendarMonth, recordsByDate);
      this.setData({
        calendarWeeks: weeks,
        calendarMonthLabel: monthLabel(calendarYear, calendarMonth)
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ calendarLoading: false });
    }
  },

  switchCalendarMonth(e) {
    const step = Number(e.currentTarget.dataset.step || 0);
    if (!step) return;
    let year = this.data.calendarYear;
    let month = this.data.calendarMonth + step;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    this.setData({
      calendarYear: year,
      calendarMonth: month,
      selectedCalendarDate: buildDate(year, month, 1),
      showCalendarDayPanel: false
    });
    this.loadHomeCalendarRecords();
  },

  async openCalendarDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({
      selectedCalendarDate: date,
      showCalendarDayPanel: true,
      calendarDayRecords: []
    });
    try {
      const data = await callApi("drinkDiary.listByDate", { date });
      const list = (data.list || []).map((item) => ({
        ...item,
        drink_time_text: formatHourMinute(item.drink_time),
        thumbnail_url: item.thumbnail_url || (item.images && item.images[0] && (item.images[0].thumb || item.images[0].url)) || ""
      }));
      this.setData({ calendarDayRecords: list });
    } catch (err) {
      showError(err);
    }
  },

  closeCalendarDayPanel() {
    this.setData({ showCalendarDayPanel: false });
  },

  stopCalendarPanelTap() {},

  goDrinkRecordDetail(e) {
    const recordId = e.currentTarget.dataset.id;
    if (!recordId) return;
    wx.navigateTo({ url: `/pages/drink-calendar/detail?recordId=${recordId}` });
  },

  addCalendarCup() {
    const today = getTodayDate();
    wx.navigateTo({ url: `/pages/drink-calendar/detail?mode=create&date=${today}&time=${getNowTimeText()}` });
  },

  retryLoad() {
    this.loadPage();
    this.loadHomeCalendarRecords();
  },

  goTo(e) {
    const url = e.currentTarget.dataset.url;
    openPage(url);
  },

  goPointsLedger() {
    openPage("/pages/points/ledger");
  },

  goPendingApprovals() {
    openPage("/pages/approval/pending-list");
  },

  goNotifications() {
    openPage("/pages/notification/list");
  }
});

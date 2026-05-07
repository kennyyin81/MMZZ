Component({
  data: {
    selected: "/pages/home/index",
    tabs: [
      {
        pagePath: "/pages/home/index",
        text: "首页",
        icon: "/assets/tab/home.svg",
        activeIcon: "/assets/tab/home-active.svg"
      },
      {
        pagePath: "/pages/wine/index",
        text: "酒馆",
        icon: "/assets/tab/wine.svg",
        activeIcon: "/assets/tab/wine-active.svg"
      },
      {
        pagePath: "/pages/profile/index",
        text: "我的",
        icon: "/assets/tab/profile.svg",
        activeIcon: "/assets/tab/profile-active.svg"
      }
    ]
  },

  methods: {
    switchTab(e) {
      const url = e.currentTarget.dataset.path;
      if (!url || url === this.data.selected) return;
      this.setData({ selected: url });
      wx.switchTab({ url });
    }
  }
});

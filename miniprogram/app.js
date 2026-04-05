let cloudConfig = {};

try {
  cloudConfig = require("./config/cloud");
} catch (error) {
  cloudConfig = {};
}

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }

    if (!cloudConfig.env) {
      console.error("请在 miniprogram/config/cloud.js 中配置云环境 env");
      return;
    }

    wx.cloud.init({
      env: cloudConfig.env,
      traceUser: true
    });
  },
  globalData: {
    currentUser: null
  }
});

const DEFAULT_TIMEOUT_MS = 30000;
const AI_TIMEOUT_MS = 60000;

function getTimeout(action) {
  return String(action || "").startsWith("ai.") ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function callApi(action, payload, userInfo) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: "api",
      timeout: getTimeout(action),
      data: {
        action,
        payload: payload || {},
        userInfo: userInfo || {}
      },
      success: (res) => {
        const result = (res && res.result) || {};
        if (typeof result.code !== "number") {
          reject(new Error("后端返回格式不正确"));
          return;
        }

        if (result.code !== 0) {
          const err = new Error(result.message || "请求失败");
          err.code = result.code;
          err.data = result.data || {};
          reject(err);
          return;
        }

        resolve(result.data || {});
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

function showError(err) {
  const text = (err && err.message) || "请求失败";
  wx.showToast({
    title: text,
    icon: "none",
    duration: 2200
  });
}

module.exports = {
  callApi,
  showError
};

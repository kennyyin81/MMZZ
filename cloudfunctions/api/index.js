const { AppError, assert, fail, ensureCurrentUser } = require("./src/context");
const { handleAction } = require("./src/router");

const PUBLIC_ACTIONS = new Set([
  "bar.list"
]);

exports.main = async (event) => {
  try {
    const action = String((event && event.action) || "").trim();
    assert(action, 2001, "action 不能为空");
    // 原登录态逻辑：所有 action 都先获取当前用户。公开接口联调完成后可恢复为这一行。
    // const currentUser = await ensureCurrentUser(event || {});
    const currentUser = PUBLIC_ACTIONS.has(action) ? null : await ensureCurrentUser(event || {});
    return await handleAction(currentUser, action, (event && event.payload) || {});
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, error.message, error.data);
    }
    console.error("unhandled error", error);
    return fail(5000, error.message || "系统异常", { stack: error.stack });
  }
};

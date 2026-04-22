const { AppError, assert, fail, ensureCurrentUser } = require("./src/context");
const { handleAction } = require("./src/router");

exports.main = async (event) => {
  try {
    const action = String((event && event.action) || "").trim();
    assert(action, 2001, "action 不能为空");
    const currentUser = await ensureCurrentUser(event || {});
    return await handleAction(currentUser, action, (event && event.payload) || {});
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, error.message, error.data);
    }
    console.error("unhandled error", error);
    return fail(5000, error.message || "系统异常", { stack: error.stack });
  }
};

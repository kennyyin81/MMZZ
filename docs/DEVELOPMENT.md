# MMZZ 项目开发文档

> 微信云开发小程序 — 积分管理 + 酒款社区 + 个人喝酒记录

---

## 一、项目概览

| 项目 | 说明 |
|------|------|
| 框架 | 微信小程序原生开发 |
| 后端 | 微信云开发（云函数 + 云数据库） |
| AppID | `wx69a835c4567727ab` |
| 基础库 | `3.14.2` |
| 云函数超时 | 30 秒 |
| 依赖 | `wx-server-sdk ^3.0.1` |

### 产品定位

将积分管理、审批流程、站内消息、酒款浏览互动、个人喝酒日历记录整合到一个小程序中。

---

## 二、目录结构

```
MMZZ/
├── cloudfunctions/
│   └── api/                    # 唯一云函数，所有接口的入口
│       ├── index.js            # 云函数主文件（约 1987 行，单文件路由）
│       └── package.json
├── miniprogram/
│   ├── app.js                  # 应用入口，云环境初始化
│   ├── app.json                # 页面路由 & TabBar 配置
│   ├── app.wxss               # 全局样式（设计系统基础，约 393 行）
│   ├── sitemap.json
│   ├── assets/                 # SVG 图标资源
│   │   ├── quick/             # 首页快捷入口图标（9 个）
│   │   ├── tab/               # TabBar 图标（8 个，含 active 态）
│   │   └── wines/             # 酒款默认封面（4 个）
│   ├── components/             # 全局组件
│   │   ├── ui-empty-state/     # 空状态占位组件
│   │   └── ui-skeleton/        # 骨架屏组件
│   ├── config/
│   │   └── cloud.js            # 云环境配置（不提交到仓库）
│   ├── custom-tab-bar/         # 自定义 TabBar
│   ├── pages/                  # 23 个页面
│   │   ├── home/               # 首页
│   │   ├── wine/               # 酒款列表 & 详情
│   │   ├── request/            # 申请记录（待办列表、加分/喝酒申请、历史）
│   │   ├── profile/            # 个人中心（资料编辑、审批关系、收藏）
│   │   ├── points/             # 积分（流水、直接调分）
│   │   ├── todo/               # 创建待办
│   │   ├── approval/           # 审批（待审批、历史、详情）
│   │   ├── notification/       # 消息中心
│   │   ├── drink-calendar/     # 喝酒日历记录详情
│   │   └── admin/              # 管理后台（用户角色、酒款维护）
│   └── utils/
│       ├── api.js              # 云函数调用封装（callApi / showError）
│       ├── const.js            # 常量定义 & 工具函数（约 140 行）
│       └── wine-data.js        # 酒款静态元数据（默认封面 / 配色）
└── docs/
    ├── PRD.md                  # 产品需求文档
    ├── database.md             # 数据库设计文档
    ├── api.md                  # API 接口文档
    └── DEVELOPMENT.md          # 本文档
```

---

## 三、角色体系

| 角色 | 标识 | 权限 |
|------|------|------|
| 普通用户 | `USER` | 提交申请、查看积分、浏览酒款、维护个人记录 |
| 审批人 | `APPROVER` | 审批绑定用户的申请与加分工作、直接调分 |
| 管理员 | `ADMIN` | 维护用户角色 |
| 品酒师 | `SOMMELIER` | 维护酒款内容 |

- 新用户注册时默认角色为 `[USER]`
- 一个用户可同时拥有多个角色
- 角色由 `ADMIN` 通过后台页面设置

---

## 四、页面路由 & TabBar

### 4.1 TabBar（自定义）

| 序号 | Tab | 路径 | 说明 |
|------|-----|------|------|
| 0 | 首页 | `pages/home/index` | 个人信息、积分、待审批、喝酒日历 |
| 1 | 酒百科 | `pages/wine/index` | 酒款列表 |
| 2 | 记录 | `pages/request/my-list` | 待办工作列表 |
| 3 | 我的 | `pages/profile/index` | 个人中心 |

### 4.2 全部页面清单

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `pages/home/index` | 个人信息、积分统计、待审批入口、快捷入口、内嵌喝酒日历 |
| 喝酒日历详情 | `pages/drink-calendar/detail` | 单条喝酒记录的创建/编辑/删除 |
| 酒款列表 | `pages/wine/index` | 浏览所有酒款，支持口感筛选 & 排序 |
| 酒款详情 | `pages/wine/detail` | 收藏、评分、留言、相似推荐 |
| 记录列表 | `pages/request/my-list` | 待办工作列表与日期筛选 |
| 加分申请 | `pages/request/earn-create` | 创建加分申请 |
| 喝酒申请 | `pages/request/drink-create` | 创建喝酒申请 |
| 申请详情 | `pages/request/detail` | 申请 / 待办详情，支持编辑/撤回/删除 |
| 申请历史 | `pages/request/history` | 查看历史申请，按类型和状态筛选 |
| 积分流水 | `pages/points/ledger` | 积分收支明细 |
| 直接调分 | `pages/points/adjust` | 审批人直接加/减分 |
| 创建待办 | `pages/todo/create` | 新建待办工作 |
| 个人中心 | `pages/profile/index` | 我的主页 |
| 我的收藏 | `pages/profile/favorites` | 收藏的酒款列表 |
| 审批关系 | `pages/profile/relation` | 查看/管理审批关系 |
| 邀请审批人 | `pages/profile/invitation` | 搜索并邀请审批人 |
| 编辑资料 | `pages/profile/edit` | 修改昵称/头像 |
| 待审批列表 | `pages/approval/pending-list` | 审批人查看待审批项 |
| 审批历史 | `pages/approval/history-list` | 审批人查看已处理审批，支持批量删除 |
| 审批详情 | `pages/approval/detail` | 审批操作页 |
| 消息中心 | `pages/notification/list` | 站内消息、一键已读、批量删除 |
| 用户角色管理 | `pages/admin/user-role` | ADMIN 设置用户角色 |
| 酒款维护 | `pages/admin/wine-topic` | SOMMELIER 维护酒款内容 |

---

## 五、技术架构

### 5.1 前端架构

```
┌─────────────────────────────────────────────┐
│                   app.js                     │
│       (云环境初始化 + globalData)             │
├─────────────────────────────────────────────┤
│            utils/api.js                      │
│     callApi(action, payload) → Promise       │
│     showError(err) → Toast                   │
├─────────────────────────────────────────────┤
│            utils/const.js                    │
│   常量 / 格式化 / 页面跳转 / TabBar 同步      │
├─────────────────────────────────────────────┤
│            utils/wine-data.js                │
│   酒款默认封面 / 配色 / mergeWineMeta()       │
├─────────────────────────────────────────────┤
│              23 个页面                        │
│     每个页面 = .js + .json + .wxml + .wxss   │
├─────────────────────────────────────────────┤
│         components（全局复用）                 │
│     ui-empty-state / ui-skeleton             │
├─────────────────────────────────────────────┤
│         custom-tab-bar（底部导航）             │
│     4 个 Tab，SVG 图标，路径驱动高亮           │
└─────────────────────────────────────────────┘
```

### 5.2 后端架构（单云函数路由）

```
前端 callApi("action.name", payload)
        ↓
  wx.cloud.callFunction({ name: "api" })
        ↓
  cloudfunctions/api/index.js
        ↓
  exports.main → ensureCurrentUser → handleAction(switch/case)
        ↓
  各业务函数 → 返回 { code, message, data }
```

**关键设计：**

- **单一云函数**：所有接口由 `cloudfunctions/api/index.js` 一个文件承载
- **统一路由**：通过 `action` 字段分发到对应处理函数
- **统一鉴权**：每次请求都经过 `ensureCurrentUser()`，自动创建/更新用户
- **统一返回**：`{ code: 0, message: "ok", data: {} }` 成功；`code !== 0` 为错误
- **自定义错误**：`AppError` 类，支持 `code + message + data`

### 5.3 错误码体系

| 错误码 | 含义 | 使用场景 |
|--------|------|----------|
| 0 | 成功 | 正常返回 |
| 1001 | 未登录 | `ensureCurrentUser` 获取 openid 失败 |
| 1002 | 权限不足 | `requireRole()` 检查不通过 / 非本人操作 |
| 2001 | 参数校验失败 | `assert()` / `assertTextLength()` 不通过 |
| 3001 | 资源不存在 | 查询文档为 null |
| 3002 | 业务状态冲突 | 状态不允许当前操作（已绑定/已有邀请等） |
| 3003 | 自操作限制 | 不能审批自己、不能给自己调分 |
| 3004 | 重复操作 | 已有待审批的喝酒申请 |
| 4001 | 积分余额不足 | 喝酒申请余额校验 / 审批时自动拒绝 |
| 5000 | 系统异常 | 未预期的运行时错误 |

---

## 六、数据库设计

共 **14** 个集合，全部使用 `ADMINONLY` 权限，前端统一通过云函数访问。

### 6.1 集合总览

| 集合 | 用途 | 关键索引 |
|------|------|----------|
| `user_profile` | 用户资料、角色、审批关系 | `openid`(唯一), `approver_user_id` |
| `points_account` | 积分余额快照 | `user_id`(唯一) |
| `points_ledger` | 积分流水 | `user_id+created_at`, `source_type+source_id` |
| `earn_request` | 加分申请 | `request_no`(唯一), `user_id+submitted_at`, `status+submitted_at` |
| `drink_request` | 喝酒申请 | `request_no`(唯一), `user_id+submitted_at`, `status+submitted_at`, `user_id+status` |
| `todo_work` | 待办工作 & 加分工作 | `request_no`(唯一), `user_id+submitted_at`, `approver_user_id+status` |
| `approval_record` | 审批动作记录 | `request_type+request_id`(唯一), `approver_user_id+decided_at` |
| `approver_invitation` | 审批关系邀请 | `inviter_user_id+status`, `invitee_user_id+status` |
| `operation_log` | 操作日志 | - |
| `notification` | 站内消息 | `user_id+created_at`, `user_id+read_at` |
| `drink_diary` | 喝酒日历记录 | `user_id+record_month+record_date+created_at` 等 |
| `wine_topic` | 酒款内容 | `wine_id`(唯一) |
| `wine_comment` | 酒款评论 & 评分 | `wine_id+created_at`, `user_id+created_at` |
| `wine_favorite` | 用户收藏 | `user_id+wine_id`(唯一), `user_id+created_at` |

### 6.2 核心数据关系

```
user_profile ─┬── 1:1 ──── points_account（积分余额）
              ├── 1:N ──── points_ledger（积分流水）
              ├── 1:N ──── earn_request（加分申请）
              ├── 1:N ──── drink_request（喝酒申请）
              ├── 1:N ──── todo_work（待办工作）
              ├── 1:N ──── notification（站内消息）
              ├── 1:N ──── drink_diary（喝酒日历）
              ├── 1:N ──── wine_comment（酒评/评分）
              └── 1:N ──── wine_favorite（收藏）

user_profile ─── approver_user_id → user_profile（审批关系：1:1）
earn_request ─── approval_id → approval_record
drink_request ── approval_id → approval_record
todo_work ────── approval_id → approval_record
wine_topic ──── similar_wine_ids → wine_topic[]（相似推荐，最多 3）
```

### 6.3 字段删除策略

| 策略 | 集合 | 说明 |
|------|------|------|
| **软删除** | `notification`, `drink_diary` | `is_deleted: true` + `deleted_at` |
| **逻辑隐藏** | `approval_record` | `is_deleted_by_approver: true`（仅审批人侧隐藏） |
| **硬删除** | `todo_work`, `wine_comment`, `wine_favorite` | 直接 `.remove()` |

---

## 七、API 接口速查

### 7.1 统一调用方式

```js
const { callApi, showError } = require("../../utils/api");

// 基本调用
try {
  const data = await callApi("action.name", { key: "value" });
  // data 即 result.data
} catch (err) {
  showError(err);
}

// 错误码判断
try {
  await callApi("request.createDrink", { reason, cost_points });
} catch (err) {
  if (err.code === 4001) {
    // 积分不足，特殊处理
  }
  showError(err);
}
```

### 7.2 接口分类

#### 用户 & 积分

| Action | 说明 |
|--------|------|
| `auth.getCurrentUser` | 获取当前用户信息（含积分、角色、审批关系、未读消息数） |
| `profile.update` | 修改昵称/头像 |
| `points.listLedger` | 积分流水列表 |
| `points.adjustByApprover` | 审批人直接调分 |

#### 申请 & 审批

| Action | 说明 |
|--------|------|
| `request.createEarn` | 创建加分申请 |
| `request.createDrink` | 创建喝酒申请 |
| `request.listMine` | 我的申请列表 |
| `request.getDetail` | 申请/待办详情 |
| `request.withdraw` | 撤回申请 |
| `approval.listPending` | 待审批列表 |
| `approval.listHistory` | 审批历史 |
| `approval.decide` | 审批通过/拒绝 |
| `approval.removeHistory` | 删除单条审批记录 |
| `approval.removeHistoryBatch` | 批量删除审批记录 |

#### 待办工作

| Action | 说明 |
|--------|------|
| `todo.create` | 创建待办 |
| `todo.update` | 编辑待办 |
| `todo.complete` | 标记完成（加分工作转审批） |
| `todo.reopen` | 重新打开 |
| `todo.remove` | 删除待办 |
| `todo.listMine` | 我的待办列表 |
| `todo.listPending` | 审批人待审批的待办 |

#### 审批关系

| Action | 说明 |
|--------|------|
| `approver.getMyRelation` | 查看审批关系 |
| `approver.getAssignedUserSummary` | 获取被审批对象摘要 |
| `approver.searchUsers` | 搜索用户 |
| `approver.invite` | 发送审批邀请 |
| `approver.respondInvitation` | 接受/拒绝邀请 |
| `approver.cancelInvitation` | 取消邀请 |
| `approver.unbind` | 解绑审批人 |
| `approver.unbindAssignedUser` | 解绑被审批人 |

#### 通知

| Action | 说明 |
|--------|------|
| `notification.listMine` | 我的消息列表 |
| `notification.markRead` | 标记已读 |
| `notification.markAllRead` | 一键已读 |
| `notification.remove` | 删除单条消息 |
| `notification.removeBatch` | 批量删除消息 |

#### 喝酒日历

| Action | 说明 |
|--------|------|
| `drinkDiary.create` | 创建喝酒记录 |
| `drinkDiary.listByMonth` | 按月查询（日历视图） |
| `drinkDiary.listByDate` | 按日查询 |
| `drinkDiary.getDetail` | 记录详情 |
| `drinkDiary.update` | 更新记录 |
| `drinkDiary.remove` | 删除记录 |

#### 酒款（前台）

| Action | 说明 |
|--------|------|
| `wine.list` | 酒款列表（含评分统计） |
| `wine.getDetail` | 酒款详情（含收藏状态、相似推荐） |
| `wine.favorite.toggle` | 收藏/取消收藏 |
| `wine.favorite.listMine` | 我的收藏列表 |
| `wine.comment.list` | 酒款评论列表 |
| `wine.comment.create` | 创建/更新评论 |
| `wine.rating.upsert` | 仅更新评分 |
| `wine.comment.remove` | 删除自己的评论 |

#### 管理后台

| Action | 说明 | 权限 |
|--------|------|------|
| `admin.wine.list` | 酒款维护列表 | SOMMELIER |
| `admin.wine.upsert` | 新增/编辑酒款 | SOMMELIER |
| `admin.wine.remove` | 删除酒款 | SOMMELIER |
| `admin.user.search` | 搜索用户 | ADMIN |
| `admin.user.setRoles` | 设置用户角色 | ADMIN |

---

## 八、核心业务流程

### 8.1 积分生命周期

```
加分申请（earn_request）        喝酒申请（drink_request）
     │                               │
     ▼                               ▼
  审批人审批                       审批人审批
     │                               │
  通过 → +积分入账              通过 → -积分扣减
  拒绝 → 无变化                 拒绝 → 无变化（余额不足自动拒绝）
     │                               │
     └──────── points_ledger ─────────┘
                    │
         审批人直接调分（manual_adjust）
           允许正负分、允许负余额
```

### 8.2 待办工作流程

```
创建待办 → status: todo
     │
     ├── 普通工作：标记完成 → status: completed
     │                        重新打开 → status: todo
     │
     └── 加分工作：标记完成 → status: pending（进入审批）
                              │
                        审批人审批
                              │
                        通过 → status: approved + 积分入账
                        拒绝 → status: rejected
```

### 8.3 审批关系建立

```
用户 A 搜索用户 B → 发送邀请 → approver_invitation(pending)
                                    │
                              用户 B 处理
                                    │
                              接受 → A.approver_user_id = B._id
                              拒绝 → 邀请关闭
```

**约束：**
- 一个用户只能有一个审批人
- 一个审批人只能绑定一个用户
- 有待审批申请时不能解绑

### 8.4 通知类型

| 类型 | 触发场景 | 消息中心点击跳转 |
|------|----------|-----------------|
| `approval_pending` | 新申请提交 | → 审批详情 |
| `approval_result` | 审批结果 | → 申请详情 |
| `approver_invite` | 收到审批邀请 | → 审批关系 |
| `approver_invite_result` | 邀请被接受/拒绝 | → 审批关系 |
| `approver_invite_cancelled` | 邀请被取消 | → 审批关系 |
| `approver_unbind` | 审批关系解除 | → 审批关系 |
| `points_adjusted` | 审批人直接调分 | → 积分流水 |

> `approval_pending` 类型不计入首页"未读消息"计数，避免与"待我审批"重复提醒。

---

## 九、后端工具函数详解（云函数代码地图）

`cloudfunctions/api/index.js` 内主要工具函数一览，新增功能时可直接复用：

### 9.1 通用工具

| 函数 | 行号范围 | 说明 |
|------|----------|------|
| `ok(data)` | ~54 | 包装成功返回 `{ code: 0, message: "ok", data }` |
| `fail(code, msg, data)` | ~58 | 包装失败返回 |
| `assert(condition, code, msg)` | ~62 | 断言，不满足则抛出 `AppError` |
| `assertTextLength(value, label, max, required)` | ~117 | 文本参数校验（非空 + 长度） |
| `now()` | ~68 | 返回当前时间 `new Date()` |
| `toInt(value, fallback)` | ~91 | 安全转整数 |
| `buildPagination(payload)` | ~96 | 从 `page_no` / `page_size` 构造分页参数 |

### 9.2 数据库操作

| 函数 | 说明 |
|------|------|
| `unwrapList(result)` | 从查询结果中提取数组 |
| `unwrapDoc(result)` | 从查询结果中提取单条文档 |
| `unwrapInsertId(result)` | 从 add 结果中提取 `_id` |

### 9.3 用户相关

| 函数 | 说明 |
|------|------|
| `ensureCurrentUser(event)` | 统一鉴权入口，返回完整用户对象（含 balance、roles、approver 等） |
| `getUserById(userId)` | 按 `_id` 查用户 |
| `getUserByOpenId(openid)` | 按 openid 查用户 |
| `briefUser(user)` | 提取用户摘要 `{ user_id, nickname, avatar_url }` |
| `hasRole(user, role)` | 判断用户是否拥有某角色 |
| `requireRole(user, roles)` | 要求用户拥有指定角色，否则抛错 |

### 9.4 积分相关

| 函数 | 说明 |
|------|------|
| `ensurePointsAccount(userId)` | 确保积分账户存在 |
| `getBalanceByUserId(userId)` | 查询余额 |
| `changePoints(userId, points, sourceType, sourceId, remark, operator, options)` | 变更积分并写流水 |

> `changePoints` 的 `options.allowNegativeBalance = true` 可允许负余额。

### 9.5 通知与日志

| 函数 | 说明 |
|------|------|
| `safeCreateNotification(userId, type, title, content, extra)` | 发送站内消息（失败不阻塞主流程） |
| `safeLogOperation(operatorUserId, action, targetType, targetId, payload)` | 记录操作日志（失败不阻塞） |

### 9.6 申请相关

| 函数 | 说明 |
|------|------|
| `getRequestMeta(type)` | 根据 `earn`/`drink`/`todo` 返回集合名、前缀等元信息 |
| `normalizeRequest(type, request)` | 统一申请数据结构（补充 `title`、`points` 等） |
| `makeRequestNo(prefix)` | 生成请求编号如 `ER17142...` |
| `enrichWithApplicantNickname(list)` | 批量填充申请人昵称 |

---

## 十、前端工具函数

### 10.1 `utils/api.js`

| 函数 | 说明 |
|------|------|
| `callApi(action, payload, userInfo)` | 统一调用云函数，返回 Promise。`code !== 0` 时 reject，`err.code` 可用于判断错误类型 |
| `showError(err)` | 统一错误 Toast（2200ms，icon: none） |

### 10.2 `utils/const.js`

| 导出 | 类型 | 说明 |
|------|------|------|
| `REQUEST_TYPE` | Object | `{ EARN: "earn", DRINK: "drink", TODO: "todo" }` |
| `REQUEST_TYPE_LABEL` | Object | `{ earn: "加分申请", drink: "喝酒申请", todo: "待办工作" }` |
| `ROLE_LABEL` | Object | `{ USER: "普通用户", APPROVER: "审批人", ADMIN: "管理员", SOMMELIER: "品酒师" }` |
| `REQUEST_STATUS_LABEL` | Object | `{ pending: "待审批", approved: "已批准", rejected: "未通过", withdrawn: "已撤回" }` |
| `LEDGER_SOURCE_LABEL` | Object | `{ earn_request: "加分入账", drink_request: "喝酒扣分", todo_work: "待办加分", manual_adjust: "人工调整" }` |
| `TAB_PAGES` | Array | 四个 TabBar 页面路径 |
| `formatRoles(roles)` | Function | 角色数组 → 中文字符串，如 `"普通用户、审批人"` |
| `formatDateTime(value)` | Function | 日期 → `"YYYY-MM-DD HH:mm:ss"`，支持 Date/number/string |
| `formatPointsChange(value)` | Function | `5` → `"+5"`，`-3` → `"-3"` |
| `getStatusClass(status)` | Function | 状态 → CSS 类名（`status-approved` / `status-pending` / `status-rejected`） |
| `getLedgerSourceLabel(type)` | Function | 积分来源类型 → 中文 |
| `openPage(url)` | Function | 智能页面跳转：TabBar 页走 `switchTab`，其余走 `navigateTo` |
| `syncTabBar(selected)` | Function | 同步自定义 TabBar 选中态，在每个 Tab 页的 `onShow` 中调用 |

### 10.3 `utils/wine-data.js`

| 导出 | 说明 |
|------|------|
| `WINE_META` | 4 款默认酒的配色和图标 `{ image, accent, badge }` |
| `getWineMeta(wineId)` | 按 wineId 获取元数据（无匹配时返回默认值） |
| `mergeWineMeta(item)` | 将 `wine_topic` 文档与元数据合并，`image_url` 优先 |

---

## 十一、全局组件使用指南

### 11.1 `ui-empty-state` — 空状态

已在 `app.json` 全局注册，任意页面直接使用。

```xml
<!-- 基本用法 -->
<ui-empty-state title="暂无内容" description="当前没有可展示的数据" />

<!-- 紧凑模式（减少上边距） -->
<ui-empty-state title="暂无记录" description="还没有相关记录" compact="{{true}}" />
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `title` | String | `"暂无内容"` | 标题 |
| `description` | String | `"当前没有可展示的数据"` | 描述文字 |
| `compact` | Boolean | `false` | 紧凑模式 |

### 11.2 `ui-skeleton` — 骨架屏

```xml
<!-- 基本用法：带媒体块 + 3 行 -->
<ui-skeleton wx:if="{{loading}}" />

<!-- 纯文本骨架（无媒体块），5 行 -->
<ui-skeleton rows="{{5}}" media="{{false}}" />
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `rows` | Number | `3` | 骨架行数 |
| `media` | Boolean | `true` | 是否显示媒体占位块 |

---

## 十二、全局样式 class 速查（app.wxss）

### 12.1 布局容器

| Class | 说明 |
|-------|------|
| `.container` | 页面主容器，`padding: 36rpx`，底部留 196rpx 给 TabBar |
| `.card` / `.list-card` | 白色卡片，圆角 32rpx，内边距 36rpx，微阴影 |
| `.hero-card` | 渐变背景卡片，用于首页 hero 区域 |
| `.row` | flex 水平布局，两端对齐 |
| `.actions` | 按钮组容器，flex + wrap |
| `.section-head` | 区域标题行（标题 + 右侧操作），底部 26rpx margin |
| `.stat-grid` | 两列网格，用于统计数据展示 |
| `.quick-grid` | 两列网格，用于快捷入口 |
| `.toolbar` | 工具栏，flex + wrap + gap |

### 12.2 文字

| Class | 说明 |
|-------|------|
| `.title` | 大标题，50rpx，font-weight 800 |
| `.section-title` / `.card-title` | 区域标题，36rpx，font-weight 800 |
| `.subtitle` | 副标题，24rpx，灰色 |
| `.muted` | 辅助文字，灰色 |
| `.field-label` | 表单字段标签，24rpx，font-weight 700 |
| `.field-hint` | 表单字段提示，22rpx，浅灰 |

### 12.3 交互组件

| Class | 说明 |
|-------|------|
| `.btn` / `button[type="primary"]` | 主按钮，88rpx 高，主色 `#4f46e5`，圆角 22rpx |
| `.ghost-btn` | 幽灵按钮，74rpx 高，灰底浅边框 |
| `button[size="mini"]` | 小按钮，72rpx 高 |
| `.input-shell` | 输入框外壳，88rpx 最小高，圆角 20rpx |
| `.textarea` | 多行输入，最小高 200rpx |
| `.badge` / `.chip` | 标签/徽章，圆角 999rpx |
| `.chip-row` | 标签行容器，flex + wrap + gap |

### 12.4 卡片与面板

| Class | 说明 |
|-------|------|
| `.stat-card` / `.quick-card` | 统计卡 / 快捷入口卡，灰底 `#f8fafc` |
| `.surface-panel` | 面板容器，顶部 20rpx margin |
| `.toolbar-item` | 工具栏条目，灰底圆角 |

### 12.5 状态色

| Class | 色值 | 用途 |
|-------|------|------|
| `.status-pending` | `#b45309` | 待审批 |
| `.status-approved` | `#047857` | 已通过 |
| `.status-rejected` / `.status-withdrawn` | `#b91c1c` | 已拒绝/已撤回 |

### 12.6 动画

| Class | 说明 |
|-------|------|
| `.reveal-card` | 入场动画 `fadeUp` 360ms |
| `.reveal-delay-1` | 延迟 80ms |
| `.reveal-delay-2` | 延迟 140ms |
| `.reveal-delay-3` | 延迟 200ms |

### 12.7 触摸反馈

| Class | 说明 |
|-------|------|
| `.tap-card` / `.tap-soft` / `.tap-btn` | 声明可触摸（transition 预设） |
| `.is-pressed` | 按下态：缩放 0.985 + 半透明 |
| `.is-pressed-soft` | 轻按下态：下移 2rpx |

### 12.8 媒体

| Class | 说明 |
|-------|------|
| `.media-frame` | 媒体框容器，280rpx 高，渐变灰底 |
| `.wine-cover` / `.featured-image` / `.preview-image` | 图片填充 100% |
| `.wine-preview` | 酒款预览卡，356rpx 宽，用于横向滚动 |
| `.scroll-x` | 横向滚动容器（`white-space: nowrap`） |

---

## 十三、设计规范

### 13.1 颜色体系

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色 | `#4f46e5` | Indigo 600，按钮 / TabBar 选中 |
| 主色阴影 | `rgba(79, 70, 229, 0.18)` | 按钮阴影 |
| 正文 | `#0f172a` | Slate 900 |
| 次文 | `#64748b` | Slate 500 |
| 辅助文 | `#6b7280` | Gray 500 |
| 背景 | `#f5f6f8` | 全局页面背景 |
| 卡片背景 | `#ffffff` / `#f8fafc` | 白色 / Slate 50 |
| 边框 | `rgba(148, 163, 184, 0.08~0.22)` | 半透明灰 |
| 审批通过 | `#047857` | Green 700 |
| 待审批 | `#b45309` | Amber 700 |
| 拒绝/撤回 | `#b91c1c` | Red 700 |

### 13.2 布局规范

- 页面容器：`padding: 36rpx`，`padding-bottom: 196rpx`（为 TabBar 留空）
- 卡片圆角：`32rpx`（大卡片）、`26rpx`（子卡片）、`22rpx`（按钮）
- 统计网格：`grid-template-columns: repeat(2, 1fr)`
- 字体：`"SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif`

---

## 十四、开发指南

### 14.1 环境搭建

1. 克隆项目
2. 复制 `miniprogram/config/cloud.example.js` → `miniprogram/config/cloud.js`
3. 填入真实云环境 ID：
   ```js
   module.exports = { env: "your-cloud-env-id" };
   ```
4. 微信开发者工具导入项目
5. 部署云函数 `cloudfunctions/api`
6. 按 `docs/database.md` 创建集合和索引
7. 重新编译小程序

### 14.2 新增页面（完整步骤）

以新增一个 `pages/example/index` 页面为例：

**Step 1：创建页面四件套**

```
miniprogram/pages/example/
├── index.js
├── index.json
├── index.wxml
└── index.wxss
```

**Step 2：`index.json` — 页面配置**

```json
{
  "navigationBarTitleText": "示例页面"
}
```

> 全局组件 `ui-empty-state` / `ui-skeleton` 已在 `app.json` 注册，无需再声明。

**Step 3：`index.js` — 页面逻辑模板**

```js
const { callApi, showError } = require("../../utils/api");
const { formatDateTime, openPage, syncTabBar } = require("../../utils/const");

Page({
  data: {
    loading: false,
    list: [],
    // 分页
    pageNo: 1,
    pageSize: 20,
    total: 0,
    finished: false
  },

  onShow() {
    // 如果是 TabBar 页面，需要同步选中态
    // syncTabBar("/pages/example/index");
    this.resetAndLoad();
  },

  // 触底加载更多
  onReachBottom() {
    if (!this.data.loading && !this.data.finished) {
      this.loadList();
    }
  },

  resetAndLoad() {
    this.setData({ list: [], pageNo: 1, total: 0, finished: false });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const data = await callApi("your.action", {
        page_no: this.data.pageNo,
        page_size: this.data.pageSize
      });
      const list = (data.list || []).map((item) => ({
        ...item,
        created_at_text: formatDateTime(item.created_at)
      }));
      const merged = this.data.list.concat(list);
      const total = Number(data.total || 0);
      this.setData({
        list: merged,
        total,
        finished: merged.length >= total,
        pageNo: this.data.pageNo + 1
      });
    } catch (err) {
      showError(err);
    } finally {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    openPage(`/pages/example/detail?id=${id}`);
  }
});
```

**Step 4：`index.wxml` — 页面模板**

```xml
<view class="container">
  <!-- 骨架屏 -->
  <ui-skeleton wx:if="{{loading && !list.length}}" />

  <!-- 列表 -->
  <view wx:for="{{list}}" wx:key="_id"
    class="card reveal-card reveal-delay-{{index % 3}}"
    data-id="{{item._id}}" bindtap="goDetail">
    <view class="card-title">{{item.title}}</view>
    <view class="subtitle">{{item.created_at_text}}</view>
  </view>

  <!-- 空状态 -->
  <ui-empty-state wx:if="{{!loading && !list.length}}"
    title="暂无数据" description="当前没有可展示的数据" />

  <!-- 列表底部 -->
  <view wx:if="{{finished && list.length}}" class="list-end muted">
    已加载全部
  </view>
</view>
```

**Step 5：注册页面路径**

在 `miniprogram/app.json` 的 `pages` 数组中添加：

```json
"pages/example/index"
```

### 14.3 新增 API 接口（完整步骤）

**Step 1：编写后端业务函数**

在 `cloudfunctions/api/index.js` 中，找到 `handleAction()` 之前的位置，添加业务函数：

```js
async function myNewFeature(currentUser, payload) {
  // 1. 参数校验
  const title = assertTextLength(payload.title, "标题", 50, true);
  const points = toInt(payload.points, 0);
  assert(points > 0, 2001, "积分必须大于0");

  // 2. 权限校验（如需特定角色）
  // requireRole(currentUser, ROLE.ADMIN);

  // 3. 业务逻辑
  const addRes = await db.collection("your_collection").add({
    data: {
      user_id: currentUser._id,
      title,
      points,
      created_at: now(),
      updated_at: now()
    }
  });

  // 4. 发通知（可选）
  await safeCreateNotification(
    targetUserId,
    "your_type",
    "通知标题",
    "通知内容",
    { extra_key: "extra_value" }
  );

  // 5. 记日志（可选）
  await safeLogOperation(currentUser._id, "your.action", "your_collection", unwrapInsertId(addRes), {});

  return { id: unwrapInsertId(addRes) };
}
```

**Step 2：注册 action 路由**

在 `handleAction()` 的 `switch` 中添加：

```js
case "your.newAction":
  return ok(await myNewFeature(currentUser, payload));
```

**Step 3：前端调用**

```js
const data = await callApi("your.newAction", { title: "xxx", points: 10 });
```

**Step 4：更新文档**

- `docs/api.md` 中添加接口说明
- 如新增集合，同步更新 `docs/database.md`

### 14.4 新增数据集合

1. 在云控制台创建集合，权限设为 `ADMINONLY`
2. 在 `cloudfunctions/api/index.js` 的 `COLLECTIONS` 常量中注册：
   ```js
   const COLLECTIONS = {
     // ... 已有集合
     YOUR_COLLECTION: "your_collection"
   };
   ```
3. 创建必要索引（在云控制台 → 数据库 → 集合 → 索引管理）
4. 更新 `docs/database.md` 文档

### 14.5 新增通知类型

1. **后端**：在业务函数中调用 `safeCreateNotification()`
   ```js
   await safeCreateNotification(userId, "your_new_type", "标题", "内容", { key: "value" });
   ```

2. **前端消息中心**：在 `pages/notification/list.js` 的 `getFallbackText()` 中添加渲染逻辑：
   ```js
   if (type === "your_new_type") {
     return { title: "你的标题", content: "你的内容描述。" };
   }
   ```

3. **前端消息点击跳转**：在 `openNotification()` 中添加跳转：
   ```js
   if (type === "your_new_type") {
     wx.navigateTo({ url: "/pages/your-page/index" });
     return;
   }
   ```

### 14.6 新增首页快捷入口

在 `pages/home/index.wxml` 的快捷入口区域添加卡片，通常搭配条件渲染：

```xml
<view wx:if="{{someCondition}}" class="quick-card tap-card"
  data-url="/pages/your-page/index" bindtap="goTo">
  <image class="quick-icon" src="/assets/quick/your-icon.svg" />
  <text class="quick-text">入口名称</text>
</view>
```

图标文件放到 `miniprogram/assets/quick/` 目录下。

### 14.7 新增全局组件

1. 在 `miniprogram/components/` 下创建组件目录（四件套）
2. 在 `app.json` 的 `usingComponents` 中注册：
   ```json
   "usingComponents": {
     "ui-empty-state": "/components/ui-empty-state/index",
     "ui-skeleton": "/components/ui-skeleton/index",
     "your-component": "/components/your-component/index"
   }
   ```
3. 任意页面直接使用 `<your-component />`

### 14.8 编码约定

| 规则 | 说明 |
|------|------|
| **前端调后端** | 统一通过 `callApi()`，**禁止直接** `wx.cloud.database()` |
| **权限校验** | 后端使用 `requireRole()` / `hasRole()` |
| **参数校验** | 后端使用 `assert()` + `assertTextLength()` |
| **分页** | 使用 `buildPagination(payload)`，前端传 `page_no` + `page_size` |
| **日期格式** | 日期字符串 `YYYY-MM-DD`，月份 `YYYY-MM`，时间戳用 `new Date()` |
| **软删除** | `notification` / `drink_diary` 用 `is_deleted` 标记 |
| **硬删除** | `todo_work` / `wine_comment` / `wine_favorite` 直接 `.remove()` |
| **操作日志** | 关键操作用 `safeLogOperation()` |
| **消息通知** | 用 `safeCreateNotification()`（失败不阻塞主流程） |
| **TabBar 同步** | 每个 Tab 页的 `onShow` 首行调 `syncTabBar("/pages/xxx/index")` |
| **页面跳转** | 使用 `openPage(url)`，自动判断 switchTab / navigateTo |
| **列表项动画** | 卡片加 `class="card reveal-card"`，配合 `reveal-delay-N` |
| **按钮状态** | 提交中设 `submitting: true`，按钮检查 `if (this.data.submitting) return` |
| **表单加载** | 使用 `loading` 控制骨架屏显示 |

---

## 十五、典型代码模式

### 15.1 带筛选的列表页

参考 `pages/wine/index.js`：

```js
// data 中维护筛选索引 + 原始列表
data: {
  rawList: [],         // 原始完整数据
  list: [],            // 筛选 & 排序后的展示数据
  filterIndex: 0       // 筛选选项索引
}

// 加载后先存 rawList，再应用筛选
async loadList() {
  const data = await callApi("xxx.list");
  this.setData({ rawList: data.list || [] });
  this.applyCurrentFilters();
}

// 筛选变化时重新计算
onFilterChange(e) {
  this.setData({ filterIndex: Number(e.detail.value || 0) });
  this.applyCurrentFilters();
}
```

### 15.2 勾选 + 批量操作

参考 `pages/notification/list.js`：

```js
data: {
  selectedIds: [],
  allSelected: false,
  batchDeleting: false
}

// 工具函数：给列表项打 selected 标记
function applySelection(list, selectedIds) {
  const set = new Set(selectedIds);
  return list.map((item) => ({ ...item, selected: set.has(item._id) }));
}

// 单选切换
toggleSelectOne(e) {
  const id = e.currentTarget.dataset.id;
  const selected = this.data.selectedIds.includes(id)
    ? this.data.selectedIds.filter((x) => x !== id)
    : this.data.selectedIds.concat(id);
  this.setData({
    list: applySelection(this.data.list, selected),
    selectedIds: selected,
    allSelected: this.data.list.length > 0 && selected.length === this.data.list.length
  });
}

// 全选切换
toggleSelectAll() {
  if (this.data.allSelected) {
    this.setData({ list: applySelection(this.data.list, []), selectedIds: [], allSelected: false });
  } else {
    const selected = this.data.list.map((item) => item._id);
    this.setData({ list: applySelection(this.data.list, selected), selectedIds: selected, allSelected: true });
  }
}

// 批量删除（带 fallback 兼容）
async removeSelected() {
  try {
    await callApi("xxx.removeBatch", { ids: this.data.selectedIds });
  } catch (err) {
    if (err.message.includes("未知action")) {
      for (const id of this.data.selectedIds) {
        await callApi("xxx.remove", { id });
      }
    } else { throw err; }
  }
}
```

### 15.3 图片上传

参考 `pages/drink-calendar/detail.js`：

```js
// 压缩 + 双上传（原图 + 缩略图）
async function compressAndUpload(localPath, cloudPrefix) {
  const compressed = await wx.compressImage({ src: localPath, quality: 50 })
    .catch(() => ({ tempFilePath: localPath }));
  const suffix = (localPath.match(/\.[^.]+$/) || [".jpg"])[0];
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const [originUpload, thumbUpload] = await Promise.all([
    wx.cloud.uploadFile({ cloudPath: `${cloudPrefix}/origin-${stamp}${suffix}`, filePath: localPath }),
    wx.cloud.uploadFile({ cloudPath: `${cloudPrefix}/thumb-${stamp}${suffix}`, filePath: compressed.tempFilePath })
  ]);
  return { url: originUpload.fileID, thumb: thumbUpload.fileID };
}
```

### 15.4 确认弹窗（Promise 化）

```js
const res = await new Promise((resolve) => {
  wx.showModal({
    title: "确认删除",
    content: "删除后不可恢复",
    success: resolve,
    fail: () => resolve({ confirm: false })
  });
});
if (!res.confirm) return;
// 执行删除...
```

### 15.5 页面间参数传递

```js
// 跳转时带参数
wx.navigateTo({ url: `/pages/detail/index?id=${id}&type=${type}` });

// 目标页接收
onLoad(options) {
  this.setData({
    id: options.id || "",
    type: options.type || ""
  });
}
```

---

## 十六、核心业务流程

### 16.1 积分生命周期

```
加分申请（earn_request）        喝酒申请（drink_request）
     │                               │
     ▼                               ▼
  审批人审批                       审批人审批
     │                               │
  通过 → +积分入账              通过 → -积分扣减
  拒绝 → 无变化                 拒绝 → 无变化（余额不足自动拒绝）
     │                               │
     └──────── points_ledger ─────────┘
                    │
         审批人直接调分（manual_adjust）
           允许正负分、允许负余额
```

### 16.2 待办工作流程

```
创建待办 → status: todo
     │
     ├── 普通工作：标记完成 → status: completed
     │                        重新打开 → status: todo
     │
     └── 加分工作：标记完成 → status: pending（进入审批）
                              │
                        审批人审批
                              │
                        通过 → status: approved + 积分入账
                        拒绝 → status: rejected
```

### 16.3 审批关系建立

```
用户 A 搜索用户 B → 发送邀请 → approver_invitation(pending)
                                    │
                              用户 B 处理
                                    │
                              接受 → A.approver_user_id = B._id
                              拒绝 → 邀请关闭
```

---

## 十七、新增功能 Checklist

每次新增功能时，按以下清单逐项检查：

### 后端

- [ ] 业务函数写在 `cloudfunctions/api/index.js` 中
- [ ] 在 `handleAction()` 的 `switch/case` 注册 action
- [ ] 参数校验使用 `assert()` / `assertTextLength()`
- [ ] 如需权限控制，使用 `requireRole()`
- [ ] 如需新集合，在 `COLLECTIONS` 中注册并在云控制台创建
- [ ] 如涉及积分变更，使用 `changePoints()` 并写流水
- [ ] 如需通知用户，使用 `safeCreateNotification()`
- [ ] 关键操作使用 `safeLogOperation()` 记录日志

### 前端

- [ ] 页面四件套：`.js` + `.json` + `.wxml` + `.wxss`
- [ ] 在 `app.json` 的 `pages` 数组中注册
- [ ] 使用 `callApi()` 调用后端，`showError()` 处理异常
- [ ] TabBar 页面在 `onShow` 中调用 `syncTabBar()`
- [ ] 页面跳转使用 `openPage()`（自动判断 switchTab / navigateTo）
- [ ] 列表页实现 `loading` + 骨架屏 + 空状态 + 触底加载
- [ ] 提交按钮使用 `submitting` 状态防重复点击
- [ ] 样式遵循全局 class（`.card`、`.btn`、`.reveal-card` 等）
- [ ] 卡片配合 `reveal-card` + `reveal-delay-N` 入场动画

### 文档

- [ ] 更新 `docs/api.md`（新接口说明）
- [ ] 更新 `docs/database.md`（新集合/新字段）
- [ ] 更新 `docs/PRD.md`（产品规则变更）
- [ ] 更新 `README.md` 版本记录

---

## 十八、已知注意事项

### 18.1 单文件云函数

当前所有后端逻辑集中在 `cloudfunctions/api/index.js`（约 1987 行）。随着业务增长，建议考虑拆分为模块化结构：

```
cloudfunctions/api/
├── index.js            # 入口 & 路由
├── lib/
│   ├── auth.js         # 用户认证
│   ├── points.js       # 积分逻辑
│   ├── request.js      # 申请逻辑
│   ├── todo.js         # 待办逻辑
│   ├── approval.js     # 审批逻辑
│   ├── notification.js # 通知逻辑
│   ├── diary.js        # 喝酒日历
│   ├── wine.js         # 酒款逻辑
│   └── admin.js        # 管理后台
└── utils/
    ├── db.js           # 数据库工具
    └── errors.js       # 错误定义
```

### 18.2 编码问题

部分中文字符串存在 UTF-8 编码损坏：

| 位置 | 乱码 | 正确含义 |
|------|------|----------|
| `createDrinkRequest` (~616行) | `鎵ｅ噺绉垎蹇呴』澶т簬0` | 扣减积分必须大于0 |
| `createTodoWork` (~646行) | `鏍囬` / `鎻忚堪` | 标题 / 描述 |
| `reopenTodoWork` (~739行) | `褰撳墠鐘舵€佷笉鍙噸鏂版墦寮€` | 当前状态不可重新打开 |
| `reopenTodoWork` (~748行) | `宸查噸鏂版墦寮€` | 已重新打开 |
| `updateTodoWork` (~759行) | `鏍囬` / `鎻忚堪` | 标题 / 描述 |

修改时需还原为正确中文。

### 18.3 并发安全

- `points_account` 使用 `version` 字段做乐观锁，但 `changePoints()` 未做 CAS 校验
- 高并发场景下积分变更可能出现竞态，建议后续引入事务或 CAS 机制

### 18.4 分页限制

- 云数据库单次查询最多 100 条
- `listMyRequests` / `listPendingRequests` 当前先全量查询再内存分页，数据量增大后需优化

### 18.5 云函数部署注意

- 修改 `cloudfunctions/api/index.js` 后需在微信开发者工具中**右键 → 上传并部署**
- 部署后立即生效，无需重新编译小程序
- 建议每次部署前在本地先测试逻辑

---

## 十九、版本记录

| 日期 | 更新内容 |
|------|----------|
| 2026-04-10 | 消息中心 & 审批历史支持勾选、全选、批量删除；消息中心顶部文案调整为"一键已读" |
| 2026-04-09 | 负积分时加分可正常入账；未读消息不重复统计待审批；审批类消息支持跳转详情；隐藏单号 |
| 2026-04-08 | 首页头部样式优化；待办"加分设置"改为"加分工作"；加分开关改绿色；记录页隐藏状态和时间 |
| 2026-04-07 | 酒详情收藏图标；我的收藏；相似推荐（最多 3 个）；酒详情新增基酒、原料、口感解读、背景故事 |
| 2026-04-05 | 首页快捷入口"直接调分"；新增 `/pages/points/adjust` |

---

## 二十、后续开发建议

| 优先级 | 建议 | 说明 |
|--------|------|------|
| 高 | 云函数模块拆分 | 单文件近 2000 行，可读性和维护性下降 |
| 高 | 积分变更加事务锁 | 防止并发竞态导致积分不一致 |
| 高 | 修复编码损坏 | 清理云函数中的乱码字符串（见 18.2） |
| 中 | 列表查询改分页 | 部分接口全量查询 + 内存排序，数据量大后性能下降 |
| 中 | 图片压缩 / CDN | 喝酒日历和酒款图片较大，建议云存储 + 缩略图 |
| 低 | 单元测试 | 核心业务函数缺少测试覆盖 |
| 低 | TypeScript 迁移 | 提升代码类型安全性 |

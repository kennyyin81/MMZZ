# MMZZ 项目开发指南

> 微信云开发小程序：积分审批 + 酒款内容 + 微醺记录 + 酒友广场 + AI 推荐助手

最后整理：2026-05-13

## 文档边界

本文件是项目的工程总览和开发约定，不承载完整业务字段、完整 API 参数或 AI 专项方案。

| 文档 | 职责 |
|------|------|
| `README.md` | 项目启动、集合清单、近期更新和基础验证入口 |
| `docs/PRD.md` | 产品目标、角色、业务规则和页面范围 |
| `docs/api.md` | 后端 action、入参、返回值和接口规则 |
| `docs/database.md` | 云数据库集合、字段、索引和删除策略 |
| `docs/AI-BAR-RECOMMEND.md` | AI 酒馆/酒品推荐助手、SBTI 画像和大模型接入方案 |
| `docs/DEVELOPMENT.md` | 工程结构、开发规范、常用流程和维护注意事项 |

### 冗余整理结论

- `DEVELOPMENT.md` 不再重复维护完整 API 清单和数据库字段，避免和 `api.md`、`database.md` 分叉。
- AI 相关的详细 prompt、SBTI 字段、FT 计划放在 `AI-BAR-RECOMMEND.md`，本文件只保留入口说明。
- 核心业务流程只保留一份，不再在文档内重复出现。
- 已移除旧的“单文件云函数”主描述，当前后端已经模块化到 `src/handlers/`。

### 文件命名评估

- `DEVELOPMENT.md`：名称准确，定位为工程开发指南。
- `AI-BAR-RECOMMEND.md`：名称偏窄。当前内容已经覆盖酒馆推荐、酒品推荐、AI 对话、SBTI 画像和历史会话。若后续允许重命名，建议改为 `AI-ASSISTANT.md` 或 `AI-RECOMMENDATION.md`。

## 项目概览

| 项目 | 说明 |
|------|------|
| 框架 | 微信小程序原生开发 |
| 后端 | 微信云开发（云函数 + 云数据库） |
| AppID | `wx69a835c4567727ab` |
| 基础库 | `3.14.2` |
| 云函数 | `cloudfunctions/api`、`cloudfunctions/wine-scheduler` |
| 主要依赖 | `wx-server-sdk ^3.0.1` |

产品定位：把积分管理、审批流程、站内消息、酒款浏览互动、个人喝酒记录、酒友广场和 AI 推荐整合到同一个小程序体验中。

## 目录结构

```text
points-wine-miniapp/
├── cloudfunctions/
│   ├── api/
│   │   ├── index.js              # 云函数入口
│   │   ├── src/
│   │   │   ├── context.js        # 云开发初始化、集合、错误、通用工具
│   │   │   ├── router.js         # action 到 handler 的映射
│   │   │   ├── ai-client.js      # 大模型调用封装
│   │   │   └── handlers/         # 按业务域拆分的处理函数
│   │   └── package.json
│   └── wine-scheduler/           # 酒款相似推荐定时任务
├── miniprogram/
│   ├── app.js
│   ├── app.json                  # 页面路由、TabBar、权限声明
│   ├── app.wxss                  # 全局样式
│   ├── assets/
│   ├── components/
│   ├── custom-tab-bar/
│   ├── pages/
│   └── utils/
│       ├── api.js                # callApi / showError
│       ├── const.js              # 常量、格式化、跳转、TabBar 同步
│       └── wine-data.js          # 酒款默认封面和元数据
└── docs/
```

## 角色体系

| 角色 | 标识 | 权限 |
|------|------|------|
| 普通用户 | `USER` | 提交申请、查看积分、浏览酒款、维护个人记录 |
| 审批人 | `APPROVER` | 审批绑定用户的申请与加分工作、直接调分 |
| 管理员 | `ADMIN` | 保留系统管理权限标识；当前已移除前台“角色管理”入口 |
| 品酒师 | `SOMMELIER` | 维护酒款内容和酒馆内容 |

新用户默认拥有 `USER`。同一用户可以同时拥有多个角色。

## 页面与导航

当前自定义 TabBar：

| Tab | 路径 | 说明 |
|-----|------|------|
| 首页 | `pages/home/index` | 个人信息、积分、审批入口、微醺日历 |
| 酒馆 | `pages/wine/index` | 酒馆/酒款分栏浏览，支持酒馆按省市筛选 |
| 广场 | `pages/square/index` | 酒友动态内容流 |
| 我的 | `pages/profile/index` | 个人资料、收藏、动态、关系管理 |

完整页面列表以 `miniprogram/app.json` 为准。新增页面时必须同步注册到 `pages` 数组。

## 技术架构

### 前端调用链

```text
页面 / 组件
  -> require("../../utils/api").callApi(action, payload)
  -> wx.cloud.callFunction({ name: "api" })
  -> 后端统一返回 { code, message, data }
```

约定：

- 前端禁止直接调用 `wx.cloud.database()` 访问业务集合。
- 异常统一交给 `showError(err)` 或页面自己的错误态处理。
- AI 相关 action 的前端超时时间在 `utils/api.js` 中放宽到 60 秒。
- TabBar 页面在 `onShow` 中同步自定义 TabBar 选中态。

### 后端调用链

```text
cloudfunctions/api/index.js
  -> ensureCurrentUser(event)
  -> src/router.js handleAction(currentUser, action, payload)
  -> src/handlers/*.js
  -> return { code: 0, message: "ok", data }
```

重要文件：

| 文件 | 说明 |
|------|------|
| `src/context.js` | `COLLECTIONS`、`ROLE`、`AppError`、`assert`、`buildPagination`、`changePoints` 等 |
| `src/router.js` | 所有 action 的注册表 |
| `src/handlers/*.js` | 各业务域处理函数 |
| `src/ai-client.js` | TokenHub/OpenAI-compatible 调用封装 |

## 后端开发约定

新增接口时按以下顺序处理：

1. 在合适的 `src/handlers/*.js` 中实现业务函数。
2. 从 `src/context.js` 复用 `assert`、`assertTextLength`、`buildPagination`、`requireRole` 等工具。
3. 在 `src/router.js` 注册 action。
4. 如需新集合，在 `COLLECTIONS` 中注册，并更新 `docs/database.md`。
5. 如需新接口文档，更新 `docs/api.md`。

常用规则：

| 场景 | 约定 |
|------|------|
| 参数校验 | `assert()`、`assertTextLength()`、`toInt()` |
| 权限校验 | `requireRole()`、`hasRole()` |
| 分页 | `buildPagination(payload)`，前端传 `page_no`、`page_size` |
| 积分变更 | 统一使用 `changePoints()` 并写入 `points_ledger` |
| 通知 | 使用 `safeCreateNotification()`，失败不阻塞主流程 |
| 操作日志 | 关键操作使用 `safeLogOperation()` |
| 软删除 | 按 `database.md` 中集合策略执行 |

## 前端开发约定

新增页面四件套：

```text
miniprogram/pages/example/
├── index.js
├── index.json
├── index.wxml
└── index.wxss
```

页面常用模式：

- 列表页维护 `loading`、`pageNo`、`pageSize`、`finished`。
- 首屏加载时显示 `ui-skeleton`。
- 空数据时使用 `ui-empty-state`。
- 提交按钮使用 `submitting` 防重复点击。
- 页面跳转优先用 `openPage(url)`，由工具函数判断 `switchTab` 或 `navigateTo`。
- 可触摸卡片使用全局 `tap-card` / `tap-soft` 等触摸反馈类。

## 样式与组件

全局组件已在 `app.json` 注册：

| 组件 | 路径 | 用途 |
|------|------|------|
| `ui-empty-state` | `/components/ui-empty-state/index` | 空状态 |
| `ui-skeleton` | `/components/ui-skeleton/index` | 骨架屏 |

全局样式在 `miniprogram/app.wxss` 中维护。新增样式优先复用已有 class，避免每个页面重复定义卡片、按钮、状态色和列表底部样式。

## 核心业务流程

### 积分生命周期

```text
加分申请 / 加分工作
  -> 审批通过
  -> changePoints(+points)
  -> points_account 更新 + points_ledger 流水

喝酒申请
  -> 审批通过
  -> 余额足够时 changePoints(-points)
  -> 余额不足时自动拒绝

审批人直接调分
  -> points.adjustByApprover
  -> source_type = manual_adjust
  -> 允许负数调整和负余额
```

### 待办工作

```text
普通待办：todo -> completed -> 可 reopen
加分工作：todo -> pending -> approved/rejected
```

未绑定审批人时，前端不允许开启加分工作。

### 酒友广场

```text
drink_diary 记录
  -> square.create
  -> square_post
  -> 回写 drink_diary.is_shared_to_square / square_post_id
```

同一条喝酒记录不能重复发布。删除广场动态不会删除原喝酒记录。

### AI 推荐助手

AI 专项设计见 `docs/AI-BAR-RECOMMEND.md`。工程上关注：

- `ai.chat`、`ai.getSession`、`ai.listSessions`
- `bar.list`、`bar.getDetail`
- `sbti.get`、`sbti.init`
- TokenHub 环境变量只能配置在云函数环境中，不能写入仓库

### 内容维护后台

首页会按角色展示维护入口：

| 入口 | 页面 | 权限 | 说明 |
|------|------|------|------|
| 酒款维护 | `pages/admin/wine-topic` | `SOMMELIER` | 新增/编辑/删除酒款，维护封面、口味刻度、相似酒款等 |
| 酒馆维护 | `pages/admin/bar-info` | `SOMMELIER` | 新增/编辑/下架酒馆，维护省市区域、地址、电话、营业时间、人均和图片 |

酒馆维护页支持 `wx.chooseLocation` 地图搜索填入：选中地点后回填酒馆名、地址、经纬度，并尽量从地址解析省份、城市和区域。经纬度与标签字段当前不在页面展示，但仍会保留并提交，避免编辑老数据时误清空。

## 本地与云端配置

启动前：

1. 复制 `miniprogram/config/cloud.example.js` 为 `miniprogram/config/cloud.js`。
2. 在 `cloud.js` 中填入真实云环境 `env`。
3. 微信开发者工具导入项目。
4. 创建 `docs/database.md` 中列出的集合和索引。
5. 部署 `cloudfunctions/api` 和 `cloudfunctions/wine-scheduler`。
6. 重新编译小程序。

AI 功能还需要在云函数环境变量中配置：

| 变量 | 说明 |
|------|------|
| `TOKENHUB_API_KEY` | TokenHub API Key |
| `TOKENHUB_MODEL` | 模型名，如 `deepseek-v4-flash` |
| `TOKENHUB_BASE_URL` | Chat Completions 地址 |
| `AI_TIMEOUT_MS` | AI 请求超时时间 |

## 新增功能 Checklist

后端：

- [ ] handler 已实现
- [ ] action 已注册到 `src/router.js`
- [ ] 参数校验完整
- [ ] 权限校验完整
- [ ] 积分、通知、日志等副作用符合约定
- [ ] 新集合已更新 `COLLECTIONS` 和 `docs/database.md`
- [ ] 新接口已更新 `docs/api.md`

前端：

- [ ] 页面四件套齐全
- [ ] 页面已注册到 `app.json`
- [ ] 统一通过 `callApi()` 调用后端
- [ ] loading、empty、error、submitting 状态完整
- [ ] TabBar 页面同步选中态
- [ ] 关键路径已在微信开发者工具中验证

文档：

- [ ] 产品规则变化更新 `docs/PRD.md`
- [ ] API 变化更新 `docs/api.md`
- [ ] 数据结构变化更新 `docs/database.md`
- [ ] AI 方案变化更新 `docs/AI-BAR-RECOMMEND.md`
- [ ] 重要版本变化更新 `README.md`

## 已知注意事项

| 问题 | 说明 | 建议 |
|------|------|------|
| 积分并发 | `points_account.version` 已存在，但 `changePoints()` 未做 CAS 校验 | 高并发前引入事务或 CAS |
| 列表分页 | 部分旧接口可能仍有全量查询后内存分页 | 数据量增大前改为数据库分页 |
| AI 超时 | 大模型调用链路比普通接口慢 | 保持前端 loading 和后端超时兜底 |
| Babel helper 缺失 | 小程序环境缺少部分 `@babel/runtime` helper | 页面 JS 避免数组/对象展开语法，优先使用 `concat`、`Object.assign`、`push.apply` |
| 文档分叉 | API/DB 细节容易和总开发文档重复 | 以 `api.md`、`database.md` 为单一事实来源 |
| 云函数部署 | 修改后端后需在微信开发者工具中上传并部署 | 部署后立即做最小 action 验证 |

## 后续建议

| 优先级 | 建议 |
|--------|------|
| 高 | 为 `changePoints()` 引入事务或 CAS，避免积分竞态 |
| 高 | 补齐 SBTI 画像页、重测流程和画像入口闭环 |
| 中 | 清理历史文档与实际代码不一致的内容 |
| 中 | 梳理列表接口分页策略 |
| 低 | 为核心 handler 增加可运行的单元测试 |

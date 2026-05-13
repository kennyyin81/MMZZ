# API 说明

所有接口统一通过云函数 `api` 调用。

后端实现结构：

- `cloudfunctions/api/index.js`：云函数入口，负责统一鉴权、错误处理和调用路由
- `cloudfunctions/api/src/router.js`：维护 `action` 到处理函数的映射
- `cloudfunctions/api/src/context.js`：云开发初始化、数据库实例、常量和公共工具
- `cloudfunctions/api/src/handlers/`：按业务域拆分具体处理逻辑

统一请求格式：

```json
{
  "action": "xxx",
  "payload": {}
}
```

统一返回格式：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

## 用户与积分

### `auth.getCurrentUser`

返回当前用户信息，常用字段：

- `balance`
- `roles`
- `my_approver`
- `assigned_user`
- `can_approve`
- `unread_notification_count`

补充：

- `unread_notification_count` 当前不包含 `approval_pending` 类型，避免与"待我审批"重复提醒

### `profile.update`

更新当前用户资料。

入参：

- `nickname`：昵称，最长 20
- `avatar_url`：头像地址

说明：

- 两个参数均为可选，仅传入的字段会被更新

### `points.listLedger`

查询当前用户积分流水。

### `approver.getAssignedUserSummary`

查询当前审批人绑定的被审批对象摘要，用于"直接调分"页。

返回字段：

- `user_id`
- `nickname`
- `avatar_url`
- `balance`

### `points.adjustByApprover`

审批人直接为当前绑定用户加分或减分。

入参：

```json
{
  "adjust_type": "subtract",
  "points": -5,
  "remark": "本周值日未完成"
}
```

规则：

- `adjust_type` 仅支持 `add`、`subtract`
- `points` 不能为 `0`
- 减分允许传负数，后端会按调整类型归一化
- 当前余额和调整后余额都允许为负数

## 申请与审批

### `request.createEarn`

创建加分申请。

### `request.createDrink`

创建喝酒申请。

规则：

- `cost_points` 必须为正整数
- 提交时会先校验当前积分余额是否足够

### `request.listMine`

查询当前用户自己的申请列表。

### `request.getDetail`

查询单条申请或待办详情。

### `request.withdraw`

撤回自己的待审批申请。

### `approval.listPending`

查询当前审批人负责的待审批申请。

### `approval.listHistory`

查询当前审批人的历史审批记录。

### `approval.decide`

审批通过或拒绝申请。

补充规则：

- `earn` 与加分 `todo` 在审批通过时允许当前余额和结果余额为负数
- `drink` 仍会在余额不足时自动拒绝

### `approval.removeHistory`

删除当前审批人的历史审批记录，仅做前台隐藏。

### `approval.removeHistoryBatch`

批量删除当前审批人的历史审批记录，仅做前台隐藏。

## 待办工作

### `todo.create`

创建待办工作。

入参：

```json
{
  "title": "整理仓库",
  "description": "完成样品清点",
  "is_rewarded": true,
  "reward_points": 3
}
```

说明：

- `is_rewarded=false` 表示普通工作
- `is_rewarded=true` 表示加分工作
- 加分工作完成后进入审批流程
- 当前前端在开启加分时会先检查是否已绑定审批人

### `todo.listMine`

查询当前用户自己的待办列表。

常用参数：

- `date`
- `page_no`
- `page_size`

返回字段：

- `list`
- `total`
- `pending_count`

### `todo.update`

编辑待办内容，仅限待完成状态。

入参：

```json
{
  "todo_id": "xxx",
  "title": "新标题",
  "description": "新描述",
  "is_rewarded": true,
  "reward_points": 5
}
```

前端交互补充：

- 编辑页开启加分时，会先检查当前用户是否已绑定审批人
- 未绑定审批人时，前端不允许开启加分

### `todo.complete`

标记待办完成。

- 普通工作：状态变为 `completed`
- 加分工作：状态变为 `pending`

### `todo.reopen`

重新打开已完成待办。

### `todo.remove`

删除待办。

### `todo.listPending`

查询当前审批人负责审批的待办工作。

## 审批关系

- `approver.getMyRelation`
- `approver.searchUsers`
- `approver.invite`
- `approver.respondInvitation`
- `approver.cancelInvitation`
- `approver.unbind`
- `approver.unbindAssignedUser`

## 通知

- `notification.listMine`
- `notification.markRead`
- `notification.markAllRead`
- `notification.remove`
- `notification.removeBatch`

补充：

- `points_adjusted` 表示审批人直接调分通知
- 通知中心中的 `approval_pending`、`approval_result`、`points_adjusted` 等消息，前端会按类型跳转到对应页面

## 微醺日历记录

### `drinkDiary.create`

创建喝酒记录。

入参核心字段：

- `drink_name`
- `record_date`
- `drink_time`
- `price`
- `alcohol`：度数，0-100
- `taste_note`
- `environment_note`
- `other_note`
- `images`
- `location_name`
- `location_address`
- `location_lat`
- `location_lng`

补充：

- `remark` 为旧版备注字段，仍兼容写入；新记录优先使用 `taste_note`、`environment_note`、`other_note`
- 旧记录若仅有 `remark` 且无新字段，前端会自动将 `remark` 迁移至 `other_note` 显示

### `drinkDiary.listByMonth`

按月份查询当前用户记录，用于首页微醺日历。

### `drinkDiary.listByDate`

按日期查询当前用户记录。

### `drinkDiary.getDetail`

查询单条喝酒记录详情。

### `drinkDiary.update`

更新单条喝酒记录。

支持更新的字段：

- `drink_name`、`record_date`、`drink_time`、`price`、`alcohol`
- `taste_note`、`environment_note`、`other_note`
- `remark`（兼容旧字段）
- `images`、`thumbnail_url`
- `location_name`、`location_address`、`location_lat`、`location_lng`

### `drinkDiary.remove`

删除单条喝酒记录。

## 酒款

### `wine.list`

分页查询前台可见酒款列表。

入参：

```json
{
  "page_no": 1,
  "page_size": 20,
  "taste_filter": "all",
  "rating_order": "none",
  "alcohol_order": "none"
}
```

说明：

- `taste_filter` 支持 `all`、`acidity`、`sweetness`、`bitterness`、`spiciness`
- `rating_order` 支持 `none`、`asc`、`desc`
- `alcohol_order` 支持 `none`、`asc`、`desc`

返回字段：

- `rating_count`
- `comment_count`
- `total`
- `page_no`
- `page_size`
- `has_more`

### `wine.getDetail`

查询单个酒款详情。

常用返回字段：

- `flavor`
- `acidity`
- `sweetness`
- `bitterness`
- `spiciness`
- `base_spirit`
- `ingredients`
- `taste_note`
- `story`
- `is_favorited`
- `similar_wines`
- `rating_count`
- `comment_count`

### `wine.favorite.toggle`

收藏或取消收藏当前酒款。

### `wine.favorite.listMine`

查询当前用户收藏的酒款列表。

### `wine.comment.list`

查询酒款评价列表。

### `wine.comment.create`

创建或更新当前用户对某款酒的评价。

### `wine.rating.upsert`

仅创建或更新评分。

### `wine.comment.remove`

删除当前用户自己的评价。

### `wine.comment.like.toggle`

点赞或取消点赞酒款评论。

入参：

- `comment_id`

返回字段：

- `is_liked`

## 酒款维护

### `admin.wine.list`

查询酒款维护列表。

### `admin.wine.upsert`

新增或编辑酒款。

入参核心字段：

- `name`
- `category`
- `alcohol`
- `flavor`
- `acidity`
- `sweetness`
- `bitterness`
- `spiciness`
- `base_spirit`
- `ingredients`
- `taste_note`
- `story`
- `similar_wine_ids`
- `summary`
- `image_url`

补充：

- `similar_wine_ids` 由算法自动计算，最多保留 3 个
- 酒款维护页"现有酒款"改为按名称搜索，客户端实时过滤

### `admin.wine.remove`

删除酒款记录。

### `admin.wine.recommendSimilar`

手动触发相似推荐算法，计算所有酒款的 Top-3 相似酒款并写入数据库。

返回字段：

- `updated`：本次更新的酒款数量

说明：

- 算法从风味标签（Jaccard 相似度 ×100）、类别（×10）、基酒（×10）、原料（×50）、口感（差值累加）五个维度加权评分
- 每款酒取得分最高的 3 款作为相似推荐
- 也可通过定时云函数 `wine-scheduler` 每周一凌晨 3 点自动执行

## 酒馆

### `admin.bar.list`

查询酒馆维护列表（需 SOMMELIER 角色）。

入参：

- `keyword`：可选，按酒馆名、省市区域、地址、类型模糊过滤

返回字段：

- `list`

说明：

- 维护列表会包含已下架酒馆，便于重新编辑和恢复展示。
- 前端酒馆维护页默认本地过滤列表，后端 `keyword` 保留给后续服务端搜索扩展。

### `admin.bar.upsert`

新增或更新酒馆（需 SOMMELIER 角色）。

入参：

- `bar_id`：更新时传入；新增时可省略，由后端生成
- `name`（必填）
- `province`
- `city`
- `area`
- `address`
- `latitude`
- `longitude`
- `phone`
- `business_hours`
- `avg_price`
- `budget_level`
- `bar_type`
- `drink_types`
- `taste_tags`
- `atmosphere_tags`
- `scene_tags`
- `highlights`
- `description`
- `image_url`
- `images`
- `is_active`：是否前台展示

前端维护页说明：

- “地图搜索填入”使用 `wx.chooseLocation`，可自动回填酒馆名、地址、经纬度，并尽量解析省份、城市和区域。
- 经纬度字段不在页面直接展示，但会随地图选择结果保存。
- `drink_types`、`taste_tags`、`atmosphere_tags`、`scene_tags` 当前不在维护页展示；后端仍保留字段，用于兼容历史数据和后续 AI 推荐扩展。

### `admin.bar.remove`

下架酒馆（需 SOMMELIER 角色）。

入参：

- `bar_id`（必填）

说明：

- 该接口不会物理删除 `bar_info`，只会将 `is_active` 置为 `false`

### `bar.list`

分页查询前台可见酒馆列表。

入参：

```json
{
  "page_no": 1,
  "page_size": 20,
  "province": "广东省",
  "city": "广州市",
  "keyword": "清吧"
}
```

说明：

- `province`、`city` 均可选，用于省市筛选
- `keyword` 会匹配酒馆名称、区域、地址和酒馆类型
- 返回的酒馆会补齐 `province`、`city` 字段；若数据库未显式维护，会从 `area` / `address` 中尽量推断

返回字段：

- `list`
- `total`
- `page_no`
- `page_size`
- `has_more`
- `province_options`：当前数据中的可选省份
- `city_options`：当前省份下的可选城市

### `bar.getDetail`

查询单个酒馆详情。

入参：

- `bar_id`

### `bar.rating.upsert`

创建或更新当前用户对酒馆的评分。

入参：

```json
{
  "bar_id": "bar_001",
  "rating": 5
}
```

规则：

- `rating` 必须在 1 到 5 之间
- 同一用户对同一酒馆只保留一条评分
- 提交后会回写 `bar_info.average_rating`、`bar_info.rating` 和 `bar_info.rating_count`

## 酒友广场

### `square.create`

创建广场动态，从喝酒记录分享。

入参：

- `record_id`（必填）
- `cover_index`：封面图索引，默认 0
- `location_visibility`：地点公开范围，`name` / `area` / `hidden`，默认 `name`
- `show_other_note`：是否展示"其他"笔记，默认 true

规则：

- 同一条喝酒记录不能重复发布广场动态
- 发布后会在 drink_diary 记录上写入 `is_shared_to_square=true` 和 `square_post_id`

### `square.list`

分页查询广场动态列表。

入参：

- `page_no`
- `page_size`

返回字段：

- 每条动态包含 `nickname`、`avatar_url`、`is_liked`、`is_favorited`、`location_text`

### `square.listByLocation`

按地点名称查询广场动态列表。

入参：

- `location_name`（必填）
- `page_no`
- `page_size`

返回字段：

- 与 `square.list` 格式一致

### `square.listMine`

查询当前用户发布的广场动态列表。

入参：

- `page_no`
- `page_size`

返回字段：

- 与 `square.list` 格式一致

### `square.favorite.listMine`

查询当前用户收藏的广场动态列表。

入参：

- `page_no`
- `page_size`

返回字段：

- 每条动态额外包含 `favorite_created_at`（收藏时间）

### `square.getDetail`

查询广场动态详情。

入参：

- `post_id`

### `square.like.toggle`

点赞或取消点赞。

入参：

- `post_id`

### `square.favorite.toggle`

收藏或取消收藏。

入参：

- `post_id`

### `square.comment.create`

创建评论。

入参：

- `post_id`
- `content`（必填，最长 200）
- `reply_to_id`：回复的评论 ID（可选）

### `square.comment.list`

查询评论列表。

入参：

- `post_id`
- `page_no`
- `page_size`

### `square.comment.remove`

删除自己的评论。

入参：

- `comment_id`

### `square.comment.like.toggle`

点赞或取消点赞广场评论。

入参：

- `comment_id`

返回字段：

- `is_liked`

### `square.updateFromRecord`

从喝酒记录同步更新已发布的广场动态。

入参：

- `record_id`（必填）

规则：

- 仅更新记录相关字段（酒名、价格、度数、口感、环境、其他笔记、图片），保留广场特有字段（推荐语、封面索引、其他笔记展示开关、地点公开范围）
- 喝酒记录必须已分享到广场

### `square.remove`

删除自己的广场动态。

入参：

- `post_id`

规则：

- 删除广场动态不会删除原喝酒记录
- 会清除 drink_diary 上的 `is_shared_to_square` 和 `square_post_id`

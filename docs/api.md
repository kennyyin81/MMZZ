# API 说明

所有接口通过云函数 `api` 调用。

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

## 用户相关

### `auth.getCurrentUser`

返回当前用户信息，包含：

- `balance`
- `roles`
- `my_approver`
- `assigned_user`
- `can_approve`
- `unread_notification_count`

### `points.listLedger`

查询当前用户积分流水。

### `points.adjustByApprover`

审批人直接为当前绑定的被审批对象加分或减分。

入参：

```json
{
  "adjust_type": "subtract",
  "points": -5,
  "remark": "本周值日未完成"
}
```

规则：

- 仅当前用户存在被审批对象时可调用
- `adjust_type` 仅支持 `add`、`subtract`
- `points` 不能为 `0`
- 加分可传正数，减分允许传负数，后端会按调整类型归一化处理
- 直接调分允许被审批对象当前余额为 `0` 或负数
- 直接调分后余额允许继续为负数

返回字段：

- `assigned_user`
- `change_points`
- `balance`

### `request.listMine`

查询当前用户自己的申请列表。

### `request.getDetail`

查询单个申请详情与审批结果。

## 申请相关

### `request.createEarn`

创建加分申请。

入参：

```json
{
  "behavior_type": "卫生",
  "description": "主动整理公共区域",
  "requested_points": 5
}
```

### `request.createDrink`

创建喝酒申请。

入参：

```json
{
  "reason": "周末聚餐",
  "cost_points": 8
}
```

规则：

- `cost_points` 必须为正整数
- 提交时会先校验当前积分余额是否足够
- 同一用户同一时间只能有 1 条待审批喝酒申请

### `request.withdraw`

撤回自己的待审批申请。

## 审批相关

### `approval.listPending`

查询当前审批人负责的待审批申请。

返回字段补充：

### `approval.removeHistory`

审批人删除自己的历史审批记录，仅做前台隐藏，不删除原始审批结论。

入参：
```json
{
  "approval_id": "xxx"
}
```

### `approver.getAssignedUserSummary`

查询当前审批人绑定的被审批对象摘要信息，用于“直接调分”页。

返回字段：

- `user_id`
- `nickname`
- `avatar_url`
- `balance`

### `notification.remove`

删除当前用户自己的消息，采用软删除。

入参：
```json
{
  "notification_id": "xxx"
}
```

## 酒款维护

### `admin.wine.upsert`

新增或编辑酒款。

入参：
```json
{
  "name": "黄酒",
  "category": "发酵酒",
  "alcohol": "14%",
  "flavor": "花香、木香",
  "acidity": 2,
  "sweetness": 3,
  "bitterness": 1,
  "spiciness": 0,
  "base_spirit": "金酒",
  "ingredients": "金巴利、甜味美思",
  "scene": "适合餐前喝,适合夜晚微醺",
  "target_audience": "适合喜欢苦口风味的人,新手慎入",
  "taste_note": "入口偏苦，后段有草本回甘",
  "story": "起源于意大利的经典餐前鸡尾酒",
  "similar_wine_ids": ["wine_101", "wine_205"],
  "summary": "红宝石色、苦感鲜明的经典餐前酒",
  "image_url": "cloud://xxx"
}
```

字段说明：

- `name`：酒名，必填，最长50字
- `category`：类别
- `alcohol`：酒精度
- `flavor`：风味标签
- `acidity`：酸度等级，0-4（对应5个级别）
- `sweetness`：甜度等级，0-4
- `bitterness`：苦度等级，0-4
- `spiciness`：辣度等级，0-4
- `base_spirit`：基酒
- `ingredients`：原料
- `scene`：适合场景，支持逗号或换行分隔的短句
- `target_audience`：适合人群，支持逗号或换行分隔的短句
- `taste_note`：口感解读
- `story`：背景故事
- `similar_wine_ids`：相似推荐酒款 ID 列表，最多 3 个，后端会按风味相近程度重新排序
- `summary`：一句话介绍，最长100字
- `image_url`：封面图片

说明：`wine_id` 由后端自动生成，无需手动传入。

### `admin.wine.list`

品酒师查询酒款列表。

入参：
```json
{
  "keyword": "黄",
  "order_by": "name",
  "order_dir": "asc"
}
```

### `admin.wine.remove`

删除酒款记录。

入参：
```json
{
  "wine_id": "xxx"
}
```

## 待办工作

### `todo.create`

创建待办工作，创建后状态为 `todo`（待完成）。

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

- `is_rewarded=false` 时为普通工作，完成后直接标记为已完成
- `is_rewarded=true` 时为加分工作，完成后提交审批，审批通过后加分

### `todo.listMine`

查询当前用户自己的待办工作记录。

入参：
```json
{
  "date": "2026-03-04",
  "page_no": 1,
  "page_size": 20
}
```

参数说明：

- `date`：可选，筛选指定日期的待办（使用中国时区 UTC+8）
- `page_no`：页码，默认 1
- `page_size`：每页数量，默认 20

返回字段：

- `list`：待办列表
- `total`：当前筛选条件下的总数
- `pending_count`：所有未完成的待办数量（不含日期筛选）

排序规则：

1. 优先展示未完成的待办（`todo`、`pending`）
2. 其次按创建时间倒序

### `todo.complete`

标记待办完成。

- 普通工作：状态变为 `completed`
- 加分工作：状态变为 `pending`，提交审批

入参：
```json
{
  "todo_id": "xxx"
}
```

### `todo.update`

编辑待办内容（仅限待完成状态）。

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

### `todo.reopen`

重新打开已完成的待办。

入参：
```json
{
  "todo_id": "xxx"
}
```

### `todo.remove`

删除待办（仅限待完成或已完成状态）。

入参：
```json
{
  "todo_id": "xxx"
}
```

### `todo.listPending`

查询当前审批人负责审批的待办工作。

- `applicant_nickname`

前端应优先显示 `applicant_nickname`，为空时再降级显示 `user_id`。

### `approval.decide`

审批通过或拒绝申请。

### `approval.listHistory`

查询当前审批人的历史审批记录。

## 审批关系相关

- `approver.getMyRelation`
- `approver.searchUsers`
- `approver.invite`
- `approver.respondInvitation`
- `approver.cancelInvitation`
- `approver.unbind`
- `approver.unbindAssignedUser`

## 通知相关

- `notification.listMine`
- `notification.markRead`
- `notification.markAllRead`

补充通知类型：

- `points_adjusted`：审批人直接调分通知

## 喝酒日历记录

### `drinkDiary.create`

创建喝酒记录。

入参：
```json
{
  "date": "2026-03-23",
  "drink_name": "精酿IPA",
  "drink_time": "2026-03-23 20:30:00",
  "price": 58,
  "remark": "果香明显",
  "images": [
    { "url": "cloud://xxx/origin.jpg", "thumb": "cloud://xxx/thumb.jpg" }
  ],
  "thumbnail_url": "cloud://xxx/thumb.jpg"
}
```

说明：

- `date`（或 `record_date`）格式为 `YYYY-MM-DD`
- `drink_name` 最长 50 字
- `remark` 最长 500 字
- `price` 为非负数

### `drinkDiary.listByMonth`

按月份查询当前用户记录（用于日历格子缩略图）。

入参：
```json
{
  "month": "2026-03"
}
```

### `drinkDiary.listByDate`

按日期查询当前用户记录（用于点击日期后的记录列表）。

入参：
```json
{
  "date": "2026-03-23"
}
```

### `drinkDiary.getDetail`

查询单条喝酒记录详情。

入参：
```json
{
  "record_id": "xxx"
}
```

### `drinkDiary.update`

更新单条喝酒记录。

入参：
```json
{
  "record_id": "xxx",
  "record_date": "2026-03-23",
  "drink_name": "精酿IPA",
  "drink_time": "2026-03-23 21:00:00",
  "price": 66,
  "remark": "口感更柔和",
  "images": [
    { "url": "cloud://xxx/origin-2.jpg", "thumb": "cloud://xxx/thumb-2.jpg" }
  ],
  "thumbnail_url": "cloud://xxx/thumb-2.jpg"
}
```

### `drinkDiary.remove`

删除单条喝酒记录（软删除）。

入参：
```json
{
  "record_id": "xxx"
}
```

## 酒款相关

### `wine.list`

查询前台可见的酒款列表。

返回字段：

- `rating_count`：评分人数
- `comment_count`：留言人数（有内容的评价）

### `wine.getDetail`

查询单个酒款详情。

返回字段：

- `acidity`、`sweetness`、`bitterness`、`spiciness`：口感等级（0-4）
- `flavor`：风味标签
- `base_spirit`：基酒
- `ingredients`：原料
- `scene`：适合场景
- `target_audience`：适合人群
- `taste_note`：口感解读
- `story`：背景故事
- `is_favorited`：当前用户是否已收藏
- `similar_wines`：相似推荐酒款列表，已按风味相近程度排序，最多 3 个
- `rating_count`：评分人数
- `comment_count`：留言人数

### `wine.favorite.toggle`

创建或取消当前用户对某款酒的收藏。

入参：
```json
{
  "wine_id": "xxx"
}
```

返回字段：

- `is_favorited`：本次操作后的收藏状态

### `wine.favorite.listMine`

查询当前用户的收藏酒款列表。

返回字段：

- `list`：收藏酒款列表
- `total`：收藏总数

### `wine.comment.list`

查询酒款评价列表。

### `wine.comment.create`

创建或更新当前用户对某款酒的评价。

入参：
```json
{
  "wine_id": "xxx",
  "rating": 5,
  "content": "口感不错"
}
```

规则：

- 同一用户对同一酒款最多 1 条评价，再次提交将更新原评价（`rating` 与 `content`）
- `rating` 必填，取值范围为 `1-5`
- `content` 可选，为空表示只评分不留言

### `wine.rating.upsert`

仅创建/更新当前用户对某款酒的评分（不依赖留言内容）。

入参：
```json
{
  "wine_id": "xxx",
  "rating": 4
}
```

规则：

- `rating` 必填，取值范围为 `1-5`
- 若该用户已有评价，则仅更新评分字段
- 若该用户尚无评价，则创建一条仅评分记录（`content` 为空）

### `wine.comment.remove`

删除当前用户自己的评价。

## 管理相关

### `admin.user.setRoles`

管理员设置用户角色。



## 品酒师相关

### `admin.wine.list`

品酒师查询酒百科维护列表。

### `admin.wine.upsert`

品酒师新增或编辑酒款。

### `admin.wine.remove`

品酒师下架酒款。

## 废弃接口

### `request.getDrinkCost`

已废弃。首页和喝酒申请页都不再依赖该接口。

## 2026-03-05 更新

### 酒款字段变更

新增字段：
- `flavor`：风味标签
- `acidity`：酸度等级（0-4）
- `sweetness`：甜度等级（0-4）
- `bitterness`：苦度等级（0-4）
- `spiciness`：辣度等级（0-4）

### 评价功能变更

- `wine.comment.create` 的 `content` 参数改为可选
- 返回值中 `rating_count` 表示评分人数，`comment_count` 表示有留言的人数

## 2026-03-22 更新

### 酒款字段调整

- `admin.wine.upsert` 不再维护 `scene` 字段
- 前台 `wine.getDetail` 不再依赖 `scene` 展示

### 评分与留言逻辑

- 新增 `wine.rating.upsert`：支持评分独立创建/更新
- `wine.comment.create` 从“仅创建”升级为“创建或更新”

## 2026-04-05 更新

### 审批人直接调分

- 新增 `approver.getAssignedUserSummary`
- 新增 `points.adjustByApprover`
- `points.adjustByApprover` 支持对被审批对象直接加分 / 减分
- 直接调分写入 `points_ledger`，其 `source_type` 为 `manual_adjust`
- 直接调分允许余额为负数

## 2026-04-07 更新

### 酒款内容扩展

- `admin.wine.upsert` 新增 `base_spirit`、`ingredients`、`scene`、`target_audience`、`taste_note`、`story`、`similar_wine_ids`
- `similar_wine_ids` 最多保留 3 个，保存时会按风味相近程度重新排序
- `wine.getDetail` 新增返回 `is_favorited` 与 `similar_wines`

### 酒款收藏

- 新增 `wine.favorite.toggle`
- 新增 `wine.favorite.listMine`

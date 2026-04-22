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

- `unread_notification_count` 当前不包含 `approval_pending` 类型，避免与“待我审批”重复提醒

### `points.listLedger`

查询当前用户积分流水。

### `approver.getAssignedUserSummary`

查询当前审批人绑定的被审批对象摘要，用于“直接调分”页。

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

## 喝酒日历记录

### `drinkDiary.create`

创建喝酒记录。

### `drinkDiary.listByMonth`

按月份查询当前用户记录，用于首页喝酒日历。

### `drinkDiary.listByDate`

按日期查询当前用户记录。

### `drinkDiary.getDetail`

查询单条喝酒记录详情。

### `drinkDiary.update`

更新单条喝酒记录。

### `drinkDiary.remove`

删除单条喝酒记录。

## 酒款

### `wine.list`

查询前台可见酒款列表。

返回字段：

- `rating_count`
- `comment_count`

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

- `similar_wine_ids` 最多保留 3 个
- 保存时会按风味相近程度重新排序
- `image_url` 建议使用 `1:1` 或 `4:5` 图片，尺寸不低于 `800 × 800`

### `admin.wine.remove`

删除酒款记录。

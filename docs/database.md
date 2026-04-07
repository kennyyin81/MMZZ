# 数据库设计

## 集合清单

- `user_profile`
- `points_account`
- `points_ledger`
- `earn_request`
- `drink_request`
- `todo_work`
- `approval_record`
- `approver_invitation`
- `operation_log`
- `notification`
- `drink_diary`
- `wine_topic`
- `wine_comment`
- `wine_favorite`

## 关键说明

- 微信云开发是文档型数据库，不需要预先建字段
- 只需创建集合和索引，字段会由云函数写入时自动生成
- 所有集合建议使用 `ADMINONLY`，前端统一走云函数

## 主要集合

### `user_profile`

用途：用户基础资料、角色与审批关系。

关键字段：

- `openid`
- `nickname`
- `avatar_url`
- `roles`
- `approver_user_id`
- `approver_assigned_at`

索引：

- `openid` 唯一
- `approver_user_id` 普通索引

### `points_account`

用途：积分余额快照。

关键字段：

- `user_id`
- `balance`
- `version`

索引：

- `user_id` 唯一

### `points_ledger`

用途：积分流水。

关键字段：

- `user_id`
- `change_type`
- `change_points`
- `balance_after`
- `source_type`
- `source_id`

索引：

- `user_id + created_at(desc)`
- `source_type + source_id`

补充说明：

- `source_type=manual_adjust` 表示审批人直接调分
- 该场景下 `change_points` 可为正数或负数
- 该场景下 `balance_after` 允许为负数

### `earn_request`

用途：加分申请。

关键字段：

- `request_no`
- `user_id`
- `approver_user_id`
- `behavior_type`
- `description`
- `requested_points`
- `status`

索引：

- `request_no` 唯一
- `user_id + submitted_at(desc)`
- `status + submitted_at(desc)`

### `drink_request`

用途：喝酒申请。

关键字段：

- `request_no`
- `user_id`
- `approver_user_id`
- `reason`
- `cost_points`
- `status`

说明：

- `cost_points` 由申请人提交时填写
- 提交时保存为快照，审批扣分按该值执行

索引：

- `request_no` 唯一
- `user_id + submitted_at(desc)`
- `status + submitted_at(desc)`
- `user_id + status`

注意：

- `user_id + status` 不能建成唯一索引

### `approval_record`

用途：审批动作记录。

关键字段：

- `request_type`
- `request_id`
- `applicant_user_id`
- `approver_user_id`
- `decision`
- `comment`
- `decided_at`

索引：

- `request_type + request_id` 唯一
- `approver_user_id + decided_at(desc)`

### `approver_invitation`

用途：审批关系邀请。

关键字段：

- `inviter_user_id`
- `invitee_user_id`
- `status`

索引：

- `inviter_user_id + status`
- `invitee_user_id + status`

### `notification`

用途：站内消息。

关键字段：

- `user_id`
- `title`
- `content`
- `payload`
- `read_at`
- `created_at`

索引：

- `user_id + created_at(desc)`
- `user_id + read_at`

补充说明：

- `type=points_adjusted` 表示审批人直接调分通知

### `drink_diary`

用途：喝酒日历记录（首页内嵌日历使用）。

关键字段：

- `user_id`
- `record_date`
- `record_month`
- `drink_name`
- `drink_time`
- `price`
- `remark`
- `images`
- `thumbnail_url`
- `is_deleted`
- `created_at`
- `updated_at`

索引（均为非唯一索引）：

- `idx_diary_user_month_date_created`：`user_id(asc) + record_month(asc) + record_date(asc) + created_at(asc)`
- `idx_diary_user_date_created`：`user_id(asc) + record_date(asc) + created_at(desc)`
- `idx_diary_user_created`：`user_id(asc) + created_at(desc)`
- `idx_diary_user_updated`：`user_id(asc) + updated_at(desc)`

### `wine_topic`

用途：酒百科内容。

关键字段：

- `wine_id`
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
- `scene`
- `target_audience`
- `taste_note`
- `story`
- `similar_wine_ids`
- `summary`
- `image_url`

索引：

- `wine_id` 唯一

### `wine_comment`

用途：酒款评论与评分。

关键字段：

- `wine_id`
- `user_id`
- `content`
- `rating`
- `created_at`

索引：

- `wine_id + created_at(desc)`
- `user_id + created_at(desc)`

### `wine_favorite`

用途：用户收藏酒款。

关键字段：

- `user_id`
- `wine_id`
- `created_at`

建议索引：

- `idx_favorite_user_wine`：`user_id(asc) + wine_id(asc)`，建议唯一
- `idx_favorite_user_created`：`user_id(asc) + created_at(desc)`

## 初始化说明

- 当前版本不需要初始化喝酒扣分配置
- `drink_request.cost_points` 由申请人提交时填写，并以申请单快照保存

## 2026-03-01 补充

### `approval_record`

新增软删除字段：

- `is_deleted_by_approver`
- `deleted_at`

### `notification`

新增软删除字段：

- `is_deleted`
- `deleted_at`

## 2026-03-02 待办工作

新增集合：

- `todo_work`

建议字段：

- `request_no`
- `user_id`
- `approver_user_id`
- `title`
- `description`
- `is_rewarded`
- `reward_points`
- `status`
- `approval_id`
- `submitted_at`
- `completed_at`
- `decided_at`
- `updated_at`

建议索引：

- `request_no` 唯一
- `user_id + submitted_at(desc)`
- `approver_user_id + status`
- `status + submitted_at(desc)`

## 2026-03-04 待办工作更新

### `todo_work` 状态说明

| 状态 | 说明 |
|------|------|
| `todo` | 待完成（默认状态） |
| `completed` | 已完成（普通工作） |
| `pending` | 待审批（加分工作完成后提交） |
| `approved` | 审批通过（加分已入账） |
| `rejected` | 审批拒绝 |

### 状态流转

```
普通工作: todo → completed（用户手动标记完成）
加分工作: todo → pending → approved/rejected
```

- 普通工作：用户点击完成即标记为 `completed`
- 加分工作：用户点击完成后状态变为 `pending`，提交审批人审批
- `completed` 状态可重新打开变为 `todo`
- `todo` 或 `completed` 状态可删除

### `todo_work` 字段更新

新增字段：

- `completed_at`：完成时间（用户标记完成的时间）

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_no` | string | 单号，格式 TD + 时间戳 + 随机数 |
| `user_id` | string | 创建者 ID |
| `approver_user_id` | string | 审批人 ID（加分工作必填） |
| `title` | string | 待办标题 |
| `description` | string | 待办描述 |
| `is_rewarded` | boolean | 是否加分工作 |
| `reward_points` | number | 奖励积分（加分工作必填） |
| `status` | string | 状态 |
| `approval_id` | string | 审批记录 ID |
| `submitted_at` | date | 创建时间 |
| `completed_at` | date | 完成时间 |
| `decided_at` | date | 审批时间 |
| `updated_at` | date | 更新时间 |

## 2026-04-05 审批人直接调分

### 涉及集合

- `points_ledger`
- `notification`
- `operation_log`

### `points_ledger` 补充

新增来源类型：

- `manual_adjust`：审批人直接调分

字段说明补充：

| 字段 | 类型 | 说明 |
|------|------|------|
| `change_points` | number | 本次调整积分，可正可负 |
| `balance_after` | number | 调整后余额，可为负数 |
| `operator_user_id` | string | 执行直接调分的审批人 ID |
| `remark` | string | 调分说明 |

### `notification` 补充

新增通知类型：

- `points_adjusted`

建议 `extra` 字段：

- `adjust_type`
- `change_points`
- `balance_after`
- `operator_user_id`

## 2026-04-07 酒款收藏与相似推荐

### `wine_topic` 补充

新增内容字段：

- `base_spirit`：基酒
- `ingredients`：原料
- `scene`：适合场景
- `target_audience`：适合人群
- `taste_note`：口感解读
- `story`：背景故事
- `similar_wine_ids`：相似推荐酒款 ID 列表，最多 3 个

补充说明：

- `similar_wine_ids` 从现有酒款中选择
- 保存时会按风味相近程度重新排序
- 详情页按排序结果展示相似推荐

### `wine_favorite` 补充

用途：

- 支持酒类详情页收藏 / 取消收藏
- 支持“我的收藏”列表查询

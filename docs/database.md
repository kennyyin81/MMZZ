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

## 通用说明

- 微信云开发为文档型数据库，不需要预先建字段
- 当前项目建议所有集合使用 `ADMINONLY`
- 前端统一通过云函数访问数据库

## 主要集合

### `user_profile`

用途：用户资料、角色、审批关系。

关键字段：

- `openid`
- `nickname`
- `avatar_url`
- `roles`
- `approver_user_id`

索引：

- `openid` 唯一
- `approver_user_id`

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

补充：

- `source_type=manual_adjust` 表示审批人直接调分
- 该场景允许正负分和负余额

### `earn_request`

用途：加分申请。

关键字段：

- `request_no`
- `user_id`
- `approver_user_id`
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

索引：

- `request_no` 唯一
- `user_id + submitted_at(desc)`
- `status + submitted_at(desc)`
- `user_id + status`

### `todo_work`

用途：待办工作与加分工作。

关键字段：

- `request_no`
- `user_id`
- `approver_user_id`
- `title`
- `description`
- `is_rewarded`
- `reward_points`
- `status`
- `submitted_at`
- `completed_at`
- `decided_at`
- `updated_at`

索引：

- `request_no` 唯一
- `user_id + submitted_at(desc)`
- `approver_user_id + status`
- `status + submitted_at(desc)`

状态：

- `todo`
- `completed`
- `pending`
- `approved`
- `rejected`

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

补充：

- `type=points_adjusted` 表示审批人直接调分通知

### `drink_diary`

用途：喝酒日历记录。

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

建议索引：

- `idx_diary_user_month_date_created`：`user_id(asc) + record_month(asc) + record_date(asc) + created_at(asc)`
- `idx_diary_user_date_created`：`user_id(asc) + record_date(asc) + created_at(desc)`
- `idx_diary_user_created`：`user_id(asc) + created_at(desc)`
- `idx_diary_user_updated`：`user_id(asc) + updated_at(desc)`

### `wine_topic`

用途：酒款内容。

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

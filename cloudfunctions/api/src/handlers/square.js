const {
  db,
  _,
  COLLECTIONS,
  AppError,
  assert,
  now,
  unwrapList,
  unwrapDoc,
  unwrapInsertId,
  toInt,
  buildPagination,
  assertTextLength,
  getUserById,
  briefUser
} = require("../context");

const LOCATION_VISIBILITY = ["name", "area", "hidden"];

function buildLocationText(post) {
  const visibility = post.location_visibility || "name";
  if (visibility === "hidden") return "";
  if (visibility === "area") {
    const addr = String(post.location_address || "").trim();
    if (!addr) return "";
    const parts = addr.split(/[省市区县镇]/);
    const filtered = parts.filter((p) => p.trim()).map((p) => p.trim());
    return filtered.slice(0, 2).join("·") || addr.slice(0, 12);
  }
  // "name" 模式：显示店名 + 完整地址
  const name = String(post.location_name || "").trim();
  const addr = String(post.location_address || "").trim();
  if (!name && !addr) return "";
  if (!addr || name === addr) return name;
  return `${name}（${addr}）`;
}

async function createSquarePost(currentUser, payload) {
  const recordId = String(payload.record_id || "").trim();
  assert(recordId, 2001, "record_id 不能为空");

  const record = await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).get().then(unwrapDoc);
  assert(record && record.is_deleted !== true, 3001, "喝酒记录不存在");
  assert(record.user_id === currentUser._id, 1002, "只能分享自己的记录");

  const existing = await db.collection(COLLECTIONS.SQUARE_POST)
    .where({ record_id: recordId, is_deleted: _.neq(true) })
    .limit(1).get();
  assert(!unwrapList(existing).length, 2001, "该记录已分享到广场，不能重复发布");

  const recommendation = assertTextLength(payload.recommendation || "", "推荐文案", 100, false);
  const locationVisibility = String(payload.location_visibility || "name").trim();
  assert(LOCATION_VISIBILITY.includes(locationVisibility), 2001, "地点公开范围不合法");
  const showOtherNote = payload.show_other_note !== false;

  const images = Array.isArray(record.images) ? record.images : [];
  const coverIndex = Math.max(0, Math.min(Number(payload.cover_index || 0), images.length - 1));
  const coverImage = images[coverIndex] || images[0] || {};
  const coverUrl = String(coverImage.url || coverImage.thumb || record.thumbnail_url || "").trim();

  const postData = {
    user_id: currentUser._id,
    record_id: recordId,
    drink_name: record.drink_name || "",
    price: Number(record.price || 0),
    alcohol: Number(record.alcohol || 0),
    taste_note: record.taste_note || "",
    environment_note: record.environment_note || "",
    other_note: showOtherNote ? (record.other_note || "") : "",
    show_other_note: showOtherNote,
    images,
    cover_url: coverUrl,
    cover_index: coverIndex,
    location_name: record.location_name || "",
    location_address: record.location_address || "",
    location_visibility: locationVisibility,
    location_text: buildLocationText({
      location_name: record.location_name || "",
      location_address: record.location_address || "",
      location_visibility: locationVisibility
    }),
    recommendation,
    like_count: 0,
    comment_count: 0,
    favorite_count: 0,
    is_deleted: false,
    created_at: now(),
    updated_at: now()
  };

  const addRes = await db.collection(COLLECTIONS.SQUARE_POST).add({ data: postData });
  const postId = unwrapInsertId(addRes);

  await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).update({
    data: {
      is_shared_to_square: true,
      square_post_id: postId,
      updated_at: now()
    }
  });

  return { post_id: postId };
}

async function listSquarePosts(currentUser, payload) {
  const { pageNo, pageSize, skip, limit } = buildPagination(payload);
  const where = { is_deleted: _.neq(true) };

  const [countResult, listResult] = await Promise.all([
    db.collection(COLLECTIONS.SQUARE_POST).where(where).count(),
    db.collection(COLLECTIONS.SQUARE_POST)
      .where(where)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get()
  ]);

  const total = Number((countResult && countResult.total) || 0);
  const rawList = unwrapList(listResult);

  const userIds = [...new Set(rawList.map((item) => item.user_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const userResults = await db.collection(COLLECTIONS.USER_PROFILE)
      .where({ _id: _.in(userIds) })
      .limit(100)
      .get();
    unwrapList(userResults).forEach((u) => {
      userMap[u._id] = u;
    });
  }

  const myLikeIds = new Set();
  if (currentUser && currentUser._id && rawList.length) {
    const postIds = rawList.map((p) => p._id);
    const likeResults = await db.collection(COLLECTIONS.SQUARE_LIKE)
      .where({ user_id: currentUser._id, post_id: _.in(postIds) })
      .limit(100)
      .get();
    unwrapList(likeResults).forEach((l) => myLikeIds.add(l.post_id));
  }

  const myFavIds = new Set();
  if (currentUser && currentUser._id && rawList.length) {
    const postIds = rawList.map((p) => p._id);
    const favResults = await db.collection(COLLECTIONS.SQUARE_FAVORITE)
      .where({ user_id: currentUser._id, post_id: _.in(postIds) })
      .limit(100)
      .get();
    unwrapList(favResults).forEach((f) => myFavIds.add(f.post_id));
  }

  const list = rawList.map((post) => {
    const user = userMap[post.user_id] || {};
    return {
      ...post,
      location_text: buildLocationText(post),
      nickname: user.nickname || "微信用户",
      avatar_url: user.avatar_url || "",
      is_liked: myLikeIds.has(post._id),
      is_favorited: myFavIds.has(post._id)
    };
  });

  return {
    list,
    total,
    page_no: pageNo,
    page_size: pageSize,
    has_more: skip + rawList.length < total
  };
}

async function getSquarePostDetail(currentUser, payload) {
  const postId = String(payload.post_id || "").trim();
  assert(postId, 2001, "post_id 不能为空");

  const post = await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).get().then(unwrapDoc);
  assert(post && post.is_deleted !== true, 3001, "动态不存在");

  const user = await getUserById(post.user_id);

  let isLiked = false;
  let isFavorited = false;
  if (currentUser && currentUser._id) {
    const likeRes = await db.collection(COLLECTIONS.SQUARE_LIKE)
      .where({ user_id: currentUser._id, post_id: postId }).limit(1).get();
    isLiked = unwrapList(likeRes).length > 0;
    const favRes = await db.collection(COLLECTIONS.SQUARE_FAVORITE)
      .where({ user_id: currentUser._id, post_id: postId }).limit(1).get();
    isFavorited = unwrapList(favRes).length > 0;
  }

  return {
    post: {
      ...post,
      location_text: buildLocationText(post),
      nickname: (user && user.nickname) || "微信用户",
      avatar_url: (user && user.avatar_url) || "",
      is_owner: currentUser && currentUser._id === post.user_id,
      is_liked: isLiked,
      is_favorited: isFavorited
    }
  };
}

async function toggleSquareLike(currentUser, payload) {
  const postId = String(payload.post_id || "").trim();
  assert(postId, 2001, "post_id 不能为空");

  const post = await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).get().then(unwrapDoc);
  assert(post && post.is_deleted !== true, 3001, "动态不存在");

  const existing = await db.collection(COLLECTIONS.SQUARE_LIKE)
    .where({ user_id: currentUser._id, post_id: postId })
    .limit(1).get();
  const found = unwrapList(existing);

  if (found.length) {
    await db.collection(COLLECTIONS.SQUARE_LIKE).doc(found[0]._id).remove();
    await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({
      data: { like_count: _.inc(-1), updated_at: now() }
    });
    return { is_liked: false };
  }

  await db.collection(COLLECTIONS.SQUARE_LIKE).add({
    data: {
      user_id: currentUser._id,
      post_id: postId,
      created_at: now()
    }
  });
  await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({
    data: { like_count: _.inc(1), updated_at: now() }
  });
  return { is_liked: true };
}

async function toggleSquareFavorite(currentUser, payload) {
  const postId = String(payload.post_id || "").trim();
  assert(postId, 2001, "post_id 不能为空");

  const post = await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).get().then(unwrapDoc);
  assert(post && post.is_deleted !== true, 3001, "动态不存在");

  const existing = await db.collection(COLLECTIONS.SQUARE_FAVORITE)
    .where({ user_id: currentUser._id, post_id: postId })
    .limit(1).get();
  const found = unwrapList(existing);

  if (found.length) {
    await db.collection(COLLECTIONS.SQUARE_FAVORITE).doc(found[0]._id).remove();
    await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({
      data: { favorite_count: _.inc(-1), updated_at: now() }
    });
    return { is_favorited: false };
  }

  await db.collection(COLLECTIONS.SQUARE_FAVORITE).add({
    data: {
      user_id: currentUser._id,
      post_id: postId,
      created_at: now()
    }
  });
  await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({
    data: { favorite_count: _.inc(1), updated_at: now() }
  });
  return { is_favorited: true };
}

async function createSquareComment(currentUser, payload) {
  const postId = String(payload.post_id || "").trim();
  assert(postId, 2001, "post_id 不能为空");
  const content = assertTextLength(payload.content, "评论", 200, true);

  const post = await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).get().then(unwrapDoc);
  assert(post && post.is_deleted !== true, 3001, "动态不存在");

  let replyToId = "";
  let replyToNickname = "";
  const rawReplyToId = String(payload.reply_to_id || "").trim();
  if (rawReplyToId) {
    const replyComment = await db.collection(COLLECTIONS.SQUARE_COMMENT).doc(rawReplyToId).get().then(unwrapDoc);
    if (replyComment && replyComment.is_deleted !== true) {
      replyToId = rawReplyToId;
      const replyUser = await getUserById(replyComment.user_id);
      replyToNickname = (replyUser && replyUser.nickname) || "微信用户";
    }
  }

  await db.collection(COLLECTIONS.SQUARE_COMMENT).add({
    data: {
      user_id: currentUser._id,
      post_id: postId,
      content,
      reply_to_id: replyToId,
      reply_to_nickname: replyToNickname,
      is_deleted: false,
      created_at: now()
    }
  });

  await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({
    data: { comment_count: _.inc(1), updated_at: now() }
  });

  return { success: true };
}

async function listSquareComments(currentUser, payload) {
  const postId = String(payload.post_id || "").trim();
  assert(postId, 2001, "post_id 不能为空");
  const { pageNo, pageSize, skip, limit } = buildPagination(payload);

  const [countResult, listResult] = await Promise.all([
    db.collection(COLLECTIONS.SQUARE_COMMENT)
      .where({ post_id: postId, is_deleted: _.neq(true) })
      .count(),
    db.collection(COLLECTIONS.SQUARE_COMMENT)
      .where({ post_id: postId, is_deleted: _.neq(true) })
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get()
  ]);

  const total = Number((countResult && countResult.total) || 0);
  const rawList = unwrapList(listResult);

  const userIds = [...new Set(rawList.map((item) => item.user_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const userResults = await db.collection(COLLECTIONS.USER_PROFILE)
      .where({ _id: _.in(userIds) })
      .limit(100)
      .get();
    unwrapList(userResults).forEach((u) => {
      userMap[u._id] = u;
    });
  }

  const list = rawList.map((comment) => {
    const user = userMap[comment.user_id] || {};
    return {
      ...comment,
      comment_id: comment._id,
      nickname: user.nickname || "微信用户",
      avatar_url: user.avatar_url || "",
      is_owner: currentUser && currentUser._id === comment.user_id,
      like_count: Number(comment.like_count || 0),
      is_liked: false
    };
  });

  if (currentUser && list.length) {
    const commentIds = list.map((c) => c.comment_id);
    const likeResults = await db.collection(COLLECTIONS.SQUARE_COMMENT_LIKE)
      .where({ user_id: currentUser._id, comment_id: _.in(commentIds) })
      .limit(100)
      .get();
    const likedIds = new Set(unwrapList(likeResults).map((l) => l.comment_id));
    list.forEach((item) => {
      item.is_liked = likedIds.has(item.comment_id);
    });
  }

  return { list, total, page_no: pageNo, page_size: pageSize };
}

async function toggleSquareCommentLike(currentUser, payload) {
  const commentId = String(payload.comment_id || "").trim();
  assert(commentId, 2001, "comment_id 不能为空");

  const comment = await db.collection(COLLECTIONS.SQUARE_COMMENT).doc(commentId).get().then(unwrapDoc);
  assert(comment && comment.is_deleted !== true, 3001, "评论不存在");

  const existing = await db.collection(COLLECTIONS.SQUARE_COMMENT_LIKE)
    .where({ user_id: currentUser._id, comment_id: commentId })
    .limit(1)
    .get();

  if (unwrapList(existing).length) {
    const likeDoc = unwrapList(existing)[0];
    await db.collection(COLLECTIONS.SQUARE_COMMENT_LIKE).doc(likeDoc._id).remove();
    await db.collection(COLLECTIONS.SQUARE_COMMENT).doc(commentId).update({
      data: { like_count: _.inc(-1) }
    });
    return { is_liked: false };
  }

  await db.collection(COLLECTIONS.SQUARE_COMMENT_LIKE).add({
    data: {
      user_id: currentUser._id,
      comment_id: commentId,
      created_at: now()
    }
  });
  await db.collection(COLLECTIONS.SQUARE_COMMENT).doc(commentId).update({
    data: { like_count: _.inc(1) }
  });
  return { is_liked: true };
}

async function removeSquareComment(currentUser, payload) {
  const commentId = String(payload.comment_id || "").trim();
  assert(commentId, 2001, "comment_id 不能为空");

  const comment = await db.collection(COLLECTIONS.SQUARE_COMMENT).doc(commentId).get().then(unwrapDoc);
  assert(comment, 3001, "评论不存在");
  assert(comment.user_id === currentUser._id, 1002, "只能删除自己的评论");

  await db.collection(COLLECTIONS.SQUARE_COMMENT).doc(commentId).update({
    data: { is_deleted: true }
  });

  await db.collection(COLLECTIONS.SQUARE_POST).doc(comment.post_id).update({
    data: { comment_count: _.inc(-1), updated_at: now() }
  });

  return { success: true };
}

async function listMySquarePosts(currentUser, payload) {
  const { pageNo, pageSize, skip, limit } = buildPagination(payload);
  const where = { user_id: currentUser._id, is_deleted: _.neq(true) };

  const [countResult, listResult] = await Promise.all([
    db.collection(COLLECTIONS.SQUARE_POST).where(where).count(),
    db.collection(COLLECTIONS.SQUARE_POST)
      .where(where)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get()
  ]);

  const total = Number((countResult && countResult.total) || 0);
  const rawList = unwrapList(listResult);

  const userIds = [...new Set(rawList.map((item) => item.user_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const userResults = await db.collection(COLLECTIONS.USER_PROFILE)
      .where({ _id: _.in(userIds) })
      .limit(100)
      .get();
    unwrapList(userResults).forEach((u) => {
      userMap[u._id] = u;
    });
  }

  const postIds = rawList.map((p) => p._id);

  const myLikeIds = new Set();
  if (postIds.length) {
    const likeResults = await db.collection(COLLECTIONS.SQUARE_LIKE)
      .where({ user_id: currentUser._id, post_id: _.in(postIds) })
      .limit(100)
      .get();
    unwrapList(likeResults).forEach((l) => myLikeIds.add(l.post_id));
  }

  const myFavIds = new Set();
  if (postIds.length) {
    const favResults = await db.collection(COLLECTIONS.SQUARE_FAVORITE)
      .where({ user_id: currentUser._id, post_id: _.in(postIds) })
      .limit(100)
      .get();
    unwrapList(favResults).forEach((f) => myFavIds.add(f.post_id));
  }

  const list = rawList.map((post) => {
    const user = userMap[post.user_id] || {};
    return {
      ...post,
      location_text: buildLocationText(post),
      nickname: user.nickname || "微信用户",
      avatar_url: user.avatar_url || "",
      is_liked: myLikeIds.has(post._id),
      is_favorited: myFavIds.has(post._id)
    };
  });

  return {
    list,
    total,
    page_no: pageNo,
    page_size: pageSize,
    has_more: skip + rawList.length < total
  };
}

async function listMyFavoritePosts(currentUser, payload) {
  const { pageNo, pageSize, skip, limit } = buildPagination(payload);

  const favWhere = { user_id: currentUser._id };
  const [favCountResult, favListResult] = await Promise.all([
    db.collection(COLLECTIONS.SQUARE_FAVORITE).where(favWhere).count(),
    db.collection(COLLECTIONS.SQUARE_FAVORITE)
      .where(favWhere)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get()
  ]);

  const total = Number((favCountResult && favCountResult.total) || 0);
  const favList = unwrapList(favListResult);

  if (!favList.length) {
    return { list: [], total, page_no: pageNo, page_size: pageSize, has_more: false };
  }

  const postIds = favList.map((f) => f.post_id);

  const postResults = await db.collection(COLLECTIONS.SQUARE_POST)
    .where({ _id: _.in(postIds), is_deleted: _.neq(true) })
    .limit(100)
    .get();
  const rawPosts = unwrapList(postResults);

  const userIds = [...new Set(rawPosts.map((item) => item.user_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const userResults = await db.collection(COLLECTIONS.USER_PROFILE)
      .where({ _id: _.in(userIds) })
      .limit(100)
      .get();
    unwrapList(userResults).forEach((u) => {
      userMap[u._id] = u;
    });
  }

  const myLikeIds = new Set();
  if (rawPosts.length) {
    const likeResults = await db.collection(COLLECTIONS.SQUARE_LIKE)
      .where({ user_id: currentUser._id, post_id: _.in(rawPosts.map((p) => p._id)) })
      .limit(100)
      .get();
    unwrapList(likeResults).forEach((l) => myLikeIds.add(l.post_id));
  }

  const list = rawPosts.map((post) => {
    const user = userMap[post.user_id] || {};
    const fav = favList.find((f) => f.post_id === post._id) || {};
    return {
      ...post,
      location_text: buildLocationText(post),
      nickname: user.nickname || "微信用户",
      avatar_url: user.avatar_url || "",
      is_liked: myLikeIds.has(post._id),
      is_favorited: true,
      favorite_created_at: fav.created_at || null
    };
  });

  return {
    list,
    total,
    page_no: pageNo,
    page_size: pageSize,
    has_more: skip + favList.length < total
  };
}

async function listSquarePostsByLocation(currentUser, payload) {
  const locationName = String(payload.location_name || "").trim();
  assert(locationName, 2001, "location_name 不能为空");
  const { pageNo, pageSize, skip, limit } = buildPagination(payload);
  const where = { location_name: locationName, is_deleted: _.neq(true) };

  const [countResult, listResult] = await Promise.all([
    db.collection(COLLECTIONS.SQUARE_POST).where(where).count(),
    db.collection(COLLECTIONS.SQUARE_POST)
      .where(where)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get()
  ]);

  const total = Number((countResult && countResult.total) || 0);
  const rawList = unwrapList(listResult);

  const userIds = [...new Set(rawList.map((item) => item.user_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const userResults = await db.collection(COLLECTIONS.USER_PROFILE)
      .where({ _id: _.in(userIds) })
      .limit(100)
      .get();
    unwrapList(userResults).forEach((u) => {
      userMap[u._id] = u;
    });
  }

  const myLikeIds = new Set();
  if (currentUser && currentUser._id && rawList.length) {
    const postIds = rawList.map((p) => p._id);
    const likeResults = await db.collection(COLLECTIONS.SQUARE_LIKE)
      .where({ user_id: currentUser._id, post_id: _.in(postIds) })
      .limit(100)
      .get();
    unwrapList(likeResults).forEach((l) => myLikeIds.add(l.post_id));
  }

  const myFavIds = new Set();
  if (currentUser && currentUser._id && rawList.length) {
    const postIds = rawList.map((p) => p._id);
    const favResults = await db.collection(COLLECTIONS.SQUARE_FAVORITE)
      .where({ user_id: currentUser._id, post_id: _.in(postIds) })
      .limit(100)
      .get();
    unwrapList(favResults).forEach((f) => myFavIds.add(f.post_id));
  }

  const list = rawList.map((post) => {
    const user = userMap[post.user_id] || {};
    return {
      ...post,
      location_text: buildLocationText(post),
      nickname: user.nickname || "微信用户",
      avatar_url: user.avatar_url || "",
      is_liked: myLikeIds.has(post._id),
      is_favorited: myFavIds.has(post._id)
    };
  });

  return {
    list,
    total,
    page_no: pageNo,
    page_size: pageSize,
    has_more: skip + rawList.length < total
  };
}

async function removeSquarePost(currentUser, payload) {
  const postId = String(payload.post_id || "").trim();
  assert(postId, 2001, "post_id 不能为空");

  const post = await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).get().then(unwrapDoc);
  assert(post && post.is_deleted !== true, 3001, "动态不存在");
  assert(post.user_id === currentUser._id, 1002, "只能删除自己的动态");

  await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({
    data: {
      is_deleted: true,
      deleted_at: now(),
      updated_at: now()
    }
  });

  if (post.record_id) {
    await db.collection(COLLECTIONS.DRINK_DIARY).doc(post.record_id).update({
      data: {
        is_shared_to_square: false,
        square_post_id: _.remove(),
        updated_at: now()
      }
    });
  }

  return { success: true };
}

async function updateSquarePostFromRecord(currentUser, payload) {
  const recordId = String(payload.record_id || "").trim();
  assert(recordId, 2001, "record_id 不能为空");

  const record = await db.collection(COLLECTIONS.DRINK_DIARY).doc(recordId).get().then(unwrapDoc);
  assert(record && record.is_deleted !== true, 3001, "喝酒记录不存在");
  assert(record.user_id === currentUser._id, 1002, "只能更新自己的记录");

  const postId = String(record.square_post_id || "").trim();
  assert(postId, 2001, "该记录尚未分享到广场");

  const post = await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).get().then(unwrapDoc);
  assert(post && post.is_deleted !== true, 3001, "广场动态不存在");

  const images = Array.isArray(record.images) ? record.images : [];
  const coverIndex = Math.max(0, Math.min(Number(post.cover_index || 0), images.length - 1));
  const coverImage = images[coverIndex] || images[0] || {};
  const coverUrl = String(coverImage.url || coverImage.thumb || record.thumbnail_url || "").trim();

  const showOtherNote = post.show_other_note !== false;
  const locationVisibility = post.location_visibility || "name";

  const patch = {
    drink_name: record.drink_name || "",
    price: Number(record.price || 0),
    alcohol: Number(record.alcohol || 0),
    taste_note: record.taste_note || "",
    environment_note: record.environment_note || "",
    other_note: showOtherNote ? (record.other_note || "") : "",
    images,
    cover_url: coverUrl,
    location_name: record.location_name || "",
    location_address: record.location_address || "",
    location_text: buildLocationText({
      location_name: record.location_name || "",
      location_address: record.location_address || "",
      location_visibility: locationVisibility
    }),
    updated_at: now()
  };

  await db.collection(COLLECTIONS.SQUARE_POST).doc(postId).update({ data: patch });
  return { success: true };
}

module.exports = {
  createSquarePost,
  updateSquarePostFromRecord,
  listSquarePosts,
  listSquarePostsByLocation,
  listMySquarePosts,
  listMyFavoritePosts,
  getSquarePostDetail,
  toggleSquareLike,
  toggleSquareFavorite,
  createSquareComment,
  listSquareComments,
  toggleSquareCommentLike,
  removeSquareComment,
  removeSquarePost
};

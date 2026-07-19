const BlogPost = require('../models/BlogPost.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const generateUniqueSlug = async (baseSlug, excludeId) => {
  let slug = baseSlug;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const filter = excludeId ? { slug, _id: { $ne: excludeId } } : { slug };
    const existing = await BlogPost.findOne(filter);
    if (!existing) return slug;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
};

const getPublishedPosts = catchAsync(async (req, res) => {
  const posts = await BlogPost.find({ isPublished: true }).sort({ publishedAt: -1 });
  return success(res, { posts });
});

const getPostBySlug = catchAsync(async (req, res) => {
  const post = await BlogPost.findOne({ slug: req.params.slug, isPublished: true });
  if (!post) return error(res, 'Post not found.', 404);
  return success(res, { post });
});

const getAllPostsAdmin = catchAsync(async (req, res) => {
  const posts = await BlogPost.find().sort({ createdAt: -1 });
  return success(res, { posts });
});

const createPost = catchAsync(async (req, res) => {
  const { title, slug, excerpt, category, content, coverImage, readTime, isPublished, publishedAt } = req.body;
  if (!title || !excerpt || !category || !content) {
    return error(res, 'title, excerpt, category, and content are required.', 400);
  }

  const uniqueSlug = await generateUniqueSlug(slugify(slug || title));

  const post = await BlogPost.create({
    slug: uniqueSlug,
    title,
    excerpt,
    category,
    content,
    coverImage: coverImage || '',
    readTime: readTime || '',
    isPublished: isPublished !== undefined ? isPublished : true,
    publishedAt: publishedAt || Date.now(),
  });

  return success(res, { post }, 'Post created.', 201);
});

const updatePost = catchAsync(async (req, res) => {
  const { title, slug, excerpt, category, content, coverImage, readTime, isPublished, publishedAt } = req.body;

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (excerpt !== undefined) updates.excerpt = excerpt;
  if (category !== undefined) updates.category = category;
  if (content !== undefined) updates.content = content;
  if (coverImage !== undefined) updates.coverImage = coverImage;
  if (readTime !== undefined) updates.readTime = readTime;
  if (isPublished !== undefined) updates.isPublished = isPublished;
  if (publishedAt !== undefined) updates.publishedAt = publishedAt;

  if (slug !== undefined && slug !== '') {
    updates.slug = await generateUniqueSlug(slugify(slug), req.params.id);
  }

  const post = await BlogPost.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!post) return error(res, 'Post not found.', 404);

  return success(res, { post }, 'Post updated.');
});

const deletePost = catchAsync(async (req, res) => {
  const post = await BlogPost.findByIdAndDelete(req.params.id);
  if (!post) return error(res, 'Post not found.', 404);
  return success(res, {}, 'Post deleted.');
});

module.exports = { getPublishedPosts, getPostBySlug, getAllPostsAdmin, createPost, updatePost, deletePost };

const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true },
    excerpt: { type: String, required: true },
    category: { type: String, required: true },
    content: { type: String, required: true },
    coverImage: { type: String, default: '' },
    readTime: { type: String, default: '' },
    isPublished: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlogPost', blogPostSchema);

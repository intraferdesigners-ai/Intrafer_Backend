const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    images: [{ type: String }],
    beforeImage: { type: String, default: '' },
    afterImage:  { type: String, default: '' },
    projectType: { type: String, required: true },
    location: { type: String, default: '' },
    completedYear: { type: Number },
    isPublished: { type: Boolean, default: false },
    style: { type: String, default: '' },
    budget: { type: String, default: '' },
    timeline: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    // Auto-approved on upload — moderation is a post-hoc admin takedown tool
    // (inappropriate content, fake work, etc.), not a pre-listing review gate.
    moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    rejectionReason: { type: String, default: '' },
  },
  { timestamps: true }
);

projectSchema.index({ vendorId: 1, isPublished: 1 });
projectSchema.index({ moderationStatus: 1 });

module.exports = mongoose.model('Project', projectSchema);

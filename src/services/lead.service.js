const Vendor = require('../models/Vendor.model');

const findMatchingVendors = ({ city, projectType, limit = 3 }) => {
  return Vendor.find({
    'location.city': { $regex: new RegExp(city, 'i') },
    specializations: { $regex: new RegExp(projectType, 'i') },
    isApproved: true,
    isListingEnabled: true,
  })
    .sort({ rating: -1, totalLeads: 1 })
    .limit(limit)
    .populate('userId', 'name email phone');
};

module.exports = { findMatchingVendors };

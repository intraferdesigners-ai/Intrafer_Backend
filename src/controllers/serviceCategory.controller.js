const ServiceCategory = require('../models/ServiceCategory.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

// Public lookup for the SEO taxonomy's category hub pages (/[category]/,
// see app/(public)/[category]/page.jsx). isActive: false behaves like
// "not found" — inactive categories aren't real public URLs.
const getServiceCategoryBySlug = catchAsync(async (req, res) => {
  const category = await ServiceCategory.findOne({ slug: req.params.slug, isActive: true }).select(
    'name slug schemaOrgType isActive'
  );
  if (!category) return error(res, 'Category not found.', 404);
  return success(res, { category });
});

module.exports = { getServiceCategoryBySlug };

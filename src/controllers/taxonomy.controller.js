const City = require('../models/City.model');
const Category = require('../models/Category.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Cities ──────────────────────────────────────────────────────────────

const getCities = catchAsync(async (req, res) => {
  const cities = await City.find().sort({ name: 1 });
  return success(res, { cities });
});

const getPublicCities = catchAsync(async (req, res) => {
  const cities = await City.find({ isActive: true }).sort({ name: 1 });
  return success(res, { cities });
});

const createCity = catchAsync(async (req, res) => {
  const { name } = req.body;
  if (!name) return error(res, 'name is required.', 400);

  const normalizedName = name.trim();
  const existing = await City.findOne({ name: { $regex: `^${escapeRegex(normalizedName)}$`, $options: 'i' } });
  if (existing) return error(res, 'A city with this name already exists.', 400);

  const city = await City.create({ name: normalizedName });
  return success(res, { city }, 'City created.', 201);
});

const updateCity = catchAsync(async (req, res) => {
  const { name, isActive } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (isActive !== undefined) updates.isActive = isActive;

  const city = await City.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!city) return error(res, 'City not found.', 404);

  return success(res, { city }, 'City updated.');
});

const deleteCity = catchAsync(async (req, res) => {
  const city = await City.findByIdAndDelete(req.params.id);
  if (!city) return error(res, 'City not found.', 404);
  return success(res, {}, 'City deleted.');
});

// ── Categories ──────────────────────────────────────────────────────────

const getCategories = catchAsync(async (req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  return success(res, { categories });
});

const getPublicCategories = catchAsync(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({ name: 1 });
  return success(res, { categories });
});

const createCategory = catchAsync(async (req, res) => {
  const { name } = req.body;
  if (!name) return error(res, 'name is required.', 400);

  const normalizedName = name.trim();
  const existing = await Category.findOne({ name: { $regex: `^${escapeRegex(normalizedName)}$`, $options: 'i' } });
  if (existing) return error(res, 'A category with this name already exists.', 400);

  const category = await Category.create({ name: normalizedName });
  return success(res, { category }, 'Category created.', 201);
});

const updateCategory = catchAsync(async (req, res) => {
  const { name, isActive } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (isActive !== undefined) updates.isActive = isActive;

  const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!category) return error(res, 'Category not found.', 404);

  return success(res, { category }, 'Category updated.');
});

const deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) return error(res, 'Category not found.', 404);
  return success(res, {}, 'Category deleted.');
});

module.exports = {
  getCities, getPublicCities, createCity, updateCity, deleteCity,
  getCategories, getPublicCategories, createCategory, updateCategory, deleteCategory,
};

const paginate = (query, totalDocs) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  const totalPages = Math.ceil(totalDocs / limit);

  return { skip, limit, page, totalPages };
};

module.exports = paginate;

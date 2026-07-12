const Visitor    = require('../models/Visitor.model');
const Vendor     = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');

exports.captureVisitor = catchAsync(async (req, res) => {
  const { sessionId, name, contact, city, userAgent } = req.body;

  if (!sessionId)
    return res.status(400).json({ success: false, message: 'Session ID required' });

  const isPhone    = /^[6-9]\d{9}$/.test((contact || '').replace(/\s/g, ''));
  const isEmail    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact || '');
  const contactType = isPhone ? 'phone' : isEmail ? 'email' : '';

  const visitor = await Visitor.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        name:         (name || '').trim(),
        contact:      (contact || '').trim(),
        contactType,
        city:         city || '',
        isIdentified: true,
        source:       'popup',
        userAgent:    userAgent || '',
      },
    },
    { upsert: true, new: true }
  );

  res.json({ success: true, message: 'Thank you! We will be in touch.', data: { visitor } });
});

exports.trackVendorInterest = catchAsync(async (req, res) => {
  const { sessionId, vendorId, source } = req.body;

  if (!sessionId || !vendorId)
    return res.status(400).json({ success: false, message: 'Missing required fields' });

  const vendor  = await Vendor.findById(vendorId).select('businessName');
  const visitor = await Visitor.findOne({ sessionId });

  if (visitor) {
    const existing = visitor.vendorInterests.find(
      (v) => v.vendorId.toString() === vendorId
    );

    if (existing) {
      await Visitor.updateOne(
        { sessionId, 'vendorInterests.vendorId': vendorId },
        {
          $inc: { 'vendorInterests.$.clickCount': 1 },
          $set: {
            'vendorInterests.$.lastClick': new Date(),
            'vendorInterests.$.source':    source || 'card',
          },
        }
      );
    } else {
      await Visitor.updateOne(
        { sessionId },
        {
          $push: {
            vendorInterests: {
              vendorId,
              vendorName: vendor?.businessName || '',
              clickCount: 1,
              firstClick: new Date(),
              lastClick:  new Date(),
              source:     source || 'card',
            },
          },
        }
      );
    }
  } else {
    await Visitor.create({
      sessionId,
      vendorInterests: [{
        vendorId,
        vendorName: vendor?.businessName || '',
        clickCount: 1,
        firstClick: new Date(),
        lastClick:  new Date(),
        source:     source || 'card',
      }],
    });
  }

  await Vendor.findByIdAndUpdate(vendorId, { $inc: { profileViews: 1 } });

  res.json({ success: true });
});

exports.getSession = catchAsync(async (req, res) => {
  const visitor = await Visitor.findOne({ sessionId: req.params.sessionId });
  res.json({ success: true, data: { visitor } });
});

exports.getAllVisitors = catchAsync(async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;

  const [visitors, total] = await Promise.all([
    Visitor.find({ isIdentified: true })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('vendorInterests.vendorId', 'businessName'),
    Visitor.countDocuments({ isIdentified: true }),
  ]);

  res.json({
    success: true,
    data: { visitors, total, page, totalPages: Math.ceil(total / limit) },
  });
});

exports.getVisitorStats = catchAsync(async (req, res) => {
  const [totalVisitors, identified, phoneContacts, emailContacts, topVendors, cityBreakdown] =
    await Promise.all([
      Visitor.countDocuments(),
      Visitor.countDocuments({ isIdentified: true }),
      Visitor.countDocuments({ contactType: 'phone' }),
      Visitor.countDocuments({ contactType: 'email' }),
      Visitor.aggregate([
        { $unwind: '$vendorInterests' },
        { $group: {
          _id:            '$vendorInterests.vendorId',
          name:           { $first: '$vendorInterests.vendorName' },
          totalClicks:    { $sum: '$vendorInterests.clickCount' },
          uniqueVisitors: { $sum: 1 },
        }},
        { $sort: { totalClicks: -1 } },
        { $limit: 10 },
      ]),
      Visitor.aggregate([
        { $match: { isIdentified: true, city: { $ne: '' } } },
        { $group: { _id: '$city', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

  res.json({
    success: true,
    data: {
      totalVisitors,
      identified,
      phoneContacts,
      emailContacts,
      conversionRate: totalVisitors > 0
        ? ((identified / totalVisitors) * 100).toFixed(1) + '%'
        : '0%',
      topVendors,
      cityBreakdown,
    },
  });
});

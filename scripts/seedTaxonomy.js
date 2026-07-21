const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const City = require('../src/models/City.model');
const Category = require('../src/models/Category.model');

// Mirrors Intrafer_Frontend/components/ui/CitySelect.jsx's INDIAN_CITIES array
// (excluding "Other").
const CITIES = [
  'Agra', 'Ahmedabad', 'Ajmer', 'Aligarh', 'Allahabad', 'Amravati', 'Amritsar',
  'Aurangabad', 'Bangalore', 'Bareilly', 'Bhopal', 'Bhubaneswar', 'Chandigarh',
  'Chennai', 'Coimbatore', 'Dehradun', 'Delhi NCR', 'Faridabad', 'Ghaziabad',
  'Goa', 'Gurugram', 'Guwahati', 'Gwalior', 'Howrah', 'Hubli', 'Hyderabad',
  'Indore', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jammu', 'Jodhpur', 'Kanpur',
  'Kochi', 'Kolkata', 'Kozhikode', 'Lucknow', 'Ludhiana', 'Madurai', 'Mangalore',
  'Meerut', 'Mumbai', 'Mysore', 'Nagpur', 'Nashik', 'Navi Mumbai', 'Noida',
  'Patna', 'Pune', 'Raipur', 'Rajkot', 'Ranchi', 'Srinagar', 'Surat', 'Thane',
  'Thiruvananthapuram', 'Tiruchirappalli', 'Udaipur', 'Vadodara', 'Varanasi',
  'Vijayawada', 'Visakhapatnam',
];

// Mirrors Intrafer_Frontend/components/vendor/VendorSearch.jsx's
// SPECIALIZATION_OPTIONS array (excluding "All").
const CATEGORIES = [
  'Residential', 'Modular Kitchen', 'Living Room', 'Office Interiors',
  'Commercial', 'Bedroom', 'Bathroom', 'Full Home Interior',
];

async function seedCollection(Model, names, label) {
  let created = 0;
  let skipped = 0;

  for (const name of names) {
    const existing = await Model.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await Model.create({ name });
    created += 1;
  }

  console.log(`${label}: ${created} created, ${skipped} skipped (already existed).`);
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  await seedCollection(City, CITIES, 'Cities');
  await seedCollection(Category, CATEGORIES, 'Categories');

  console.log('\nSeed complete.');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

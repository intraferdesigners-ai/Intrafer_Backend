// Step 1 of the SEO restructuring project ("Intrafer.in — Structured Data
// Tasks" doc): seeds the 12 service categories that will back the future
// category/state/city URL hierarchy, each with its schema.org business type.
// Pure data-model foundation — not wired into any route yet.
//
// Upserts by slug, so it's safe to re-run: existing docs get their
// name/schemaOrgType refreshed, nothing is duplicated.
//
// Usage:
//   node scripts/seedCategoryTaxonomy.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const ServiceCategory = require('../src/models/ServiceCategory.model');

const CATEGORIES = [
  { slug: 'interior-designers', name: 'Interior Designers', schemaOrgType: 'HomeAndConstructionBusiness' },
  { slug: 'architects', name: 'Architects', schemaOrgType: 'HomeAndConstructionBusiness' },
  { slug: 'home-decorators', name: 'Home Decorators', schemaOrgType: 'HomeAndConstructionBusiness' },
  { slug: 'home-renovation', name: 'Home Renovation', schemaOrgType: 'GeneralContractor' },
  { slug: 'modular-kitchen', name: 'Modular Kitchen', schemaOrgType: 'GeneralContractor' },
  { slug: 'furniture', name: 'Furniture', schemaOrgType: 'FurnitureStore' },
  { slug: 'lighting', name: 'Lighting', schemaOrgType: 'HomeAndConstructionBusiness' },
  { slug: 'false-ceiling', name: 'False Ceiling', schemaOrgType: 'GeneralContractor' },
  { slug: 'wallpaper', name: 'Wallpaper', schemaOrgType: 'HousePainter' },
  { slug: 'painting', name: 'Painting', schemaOrgType: 'HousePainter' },
  { slug: 'home-automation', name: 'Home Automation', schemaOrgType: 'Electrician' },
  { slug: 'landscaping', name: 'Landscaping', schemaOrgType: 'HomeAndConstructionBusiness' },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let created = 0;
  let updated = 0;

  for (const { slug, name, schemaOrgType } of CATEGORIES) {
    const existed = await ServiceCategory.exists({ slug });
    await ServiceCategory.findOneAndUpdate(
      { slug },
      { $set: { name, schemaOrgType, isActive: true } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    if (existed) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  console.log(`Categories: ${created} created, ${updated} updated (already existed). Total: ${CATEGORIES.length}`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

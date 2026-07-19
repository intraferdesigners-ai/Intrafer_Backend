const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const BlogPost = require('../src/models/BlogPost.model');

// Mirrors Intrafer_Frontend/lib/blog-data.js's BLOG_POSTS array. Copied inline
// (rather than required across repos) so this script has no dependency on the
// frontend checkout being present alongside the backend at deploy/seed time.
const BLOG_POSTS = [
  {
    slug: 'modular-kitchen-cost-guide-2026',
    title: 'Modular Kitchen Cost Guide 2026: What to Expect in Bangalore',
    excerpt: 'Everything you need to know about modular kitchen costs — materials, finishes, brands, and how to get the best value for your budget.',
    category: 'Kitchen',
    readTime: '5 min read',
    date: 'June 2026',
    image: '/images/blog/modular-kitchen.jpg',
    content: `
      <h2>What Does a Modular Kitchen Cost in Bangalore in 2026?</h2>
      <p>A modular kitchen in Bangalore typically costs between <strong>₹1.5 lakhs and ₹8 lakhs</strong> depending on size, materials, and fittings. The wide range reflects the vast difference between entry-level laminates and imported acrylic shutters with soft-close hardware from Blum or Häfele.</p>

      <h2>Cost Per Linear Foot by Material</h2>
      <p>The most useful way to estimate kitchen costs is by linear foot (running feet) of cabinetry. Here are current Bangalore market rates:</p>
      <ul>
        <li><strong>BWR Plywood + Laminate shutters:</strong> ₹1,100 – ₹1,600 per sq ft</li>
        <li><strong>MDF + Membrane/Acrylic shutters:</strong> ₹1,600 – ₹2,400 per sq ft</li>
        <li><strong>Imported acrylic + SS/PU finish:</strong> ₹2,800 – ₹5,000+ per sq ft</li>
      </ul>
      <p>A standard 10-foot straight kitchen with 20 sq ft of cabinetry (upper + lower combined) in mid-range materials typically costs ₹3.2 – ₹4.8 lakhs including countertop, fittings, and installation.</p>

      <h2>Layout: L-Shaped vs U-Shaped vs Straight</h2>
      <p><strong>Straight kitchens</strong> are the most affordable and work well in small 1BHK apartments. They have a single work wall, making them cost-efficient but limiting in workspace. Budget: ₹1.5 – ₹3.5 lakhs.</p>
      <p><strong>L-Shaped kitchens</strong> are the most popular choice for 2BHK and 3BHK homes. Two adjoining walls maximize workspace and storage. This is the sweet spot for value. Budget: ₹2.5 – ₹5.5 lakhs.</p>
      <p><strong>U-Shaped kitchens</strong> work in larger homes and offer maximum storage and workflow efficiency. They require at least 8×10 feet of floor space. Budget: ₹4 – ₹9 lakhs.</p>

      <h2>Hardware Brands: Where to Spend and Where to Save</h2>
      <p>The quality of your hardware — hinges, drawer channels, lift systems — determines how long your kitchen lasts. <strong>Hettich, Häfele, and Blum</strong> are the three most trusted German brands available in India. Blum soft-close drawer channels cost 2–3x more than local alternatives but last 20+ years with 50,000-cycle ratings.</p>
      <p>A practical approach: use branded hardware for high-use components (drawers, pull-outs, hinges) and save on less-critical items like cabinet interiors.</p>

      <h2>5 Ways to Save Without Compromising Quality</h2>
      <p>1. Choose 18mm BWR plywood for the carcass (structure) instead of cheaper particle board — it lasts much longer in humid conditions. 2. Skip the island if you have less than 100 sq ft of kitchen area. 3. Use a quartz countertop instead of granite or marble — better durability, easier maintenance. 4. Invest in a good chimney — it protects your cabinetry from grease. 5. Get at least 3 quotes from verified designers before finalising.</p>
    `,
  },
  {
    slug: 'false-ceiling-types-cost-ideas',
    title: 'False Ceiling: Types, Cost & Design Ideas for Indian Homes',
    excerpt: 'Gypsum, POP, wooden, or metal? A complete guide to false ceiling types, costs per sqft, and the best designs for living rooms and bedrooms.',
    category: 'Living Room',
    readTime: '4 min read',
    date: 'May 2026',
    image: '/images/blog/false-ceiling.jpg',
    content: `
      <h2>Why a False Ceiling Changes Everything</h2>
      <p>A false ceiling does more than hide ugly pipes and wires. It redefines the proportions of a room, creates zones for indirect lighting, improves acoustics, and dramatically elevates the perceived quality of a space. For most Indian homes, adding a false ceiling is the single highest-impact design intervention per rupee spent.</p>

      <h2>False Ceiling Types Compared</h2>
      <p><strong>Gypsum board (drywall)</strong> is the most popular choice in urban Indian homes. It's smooth, paintable, moisture-resistant (use moisture-resistant boards in bathrooms), and can be shaped into curves and coves. It holds up well in most climates and is the best base for concealed LED cove lighting.</p>
      <p><strong>POP (Plaster of Paris)</strong> is the traditional choice and excels at intricate moulding and classical designs. It's heavier than gypsum and takes longer to install, but skilled plasterers can create bespoke designs that gypsum panels can't replicate. POP is favored for heritage-style homes and large formal areas.</p>
      <p><strong>Wooden slat ceilings</strong> are an emerging trend. Teak, pine, or WPC (wood-plastic composite) slats add warmth and texture. They work beautifully in bedrooms and study rooms. WPC is the better choice — it's moisture-resistant, termite-proof, and cheaper than solid wood.</p>
      <p><strong>Stretch PVC ceilings</strong> are waterproof, seamless, and available in glossy or matte finishes. They're ideal for bathrooms and kitchen areas, though their industrial look doesn't suit every home.</p>

      <h2>Cost Per Sqft in Bangalore (2026)</h2>
      <ul>
        <li><strong>Basic gypsum (flat, painted):</strong> ₹65 – ₹95 per sqft</li>
        <li><strong>Gypsum with cove lighting:</strong> ₹120 – ₹180 per sqft</li>
        <li><strong>POP moulding (complex):</strong> ₹150 – ₹250 per sqft</li>
        <li><strong>WPC slat ceiling:</strong> ₹200 – ₹350 per sqft</li>
        <li><strong>Stretch PVC:</strong> ₹180 – ₹280 per sqft</li>
      </ul>

      <h2>Which Rooms Benefit Most</h2>
      <p><strong>Living room:</strong> The biggest visual impact. A gypsum false ceiling with a perimeter cove (for warm indirect LEDs) and a central spotlight cluster transforms the feel of a living room instantly.</p>
      <p><strong>Master bedroom:</strong> A recessed gypsum ceiling over the bed area creates a hotel-suite aesthetic. Add a dimmer on the cove lights for ambient evening lighting.</p>
      <p><strong>Kitchen:</strong> A basic gypsum false ceiling hides the chimney duct and wiring. Keep it flat — avoid complex designs in kitchens where grease and steam are present.</p>

      <h2>Indirect Lighting Design Tips</h2>
      <p>The cove lighting channel should be minimum 8–10 cm deep and angled at 45° to wash the wall evenly. Use warm white (2700–3000K) LEDs in bedrooms and living rooms. A good false ceiling designer includes the LED strip in their quote — insist on this to avoid surprises.</p>
    `,
  },
  {
    slug: 'master-bedroom-design-complete-guide',
    title: 'Master Bedroom Design: The Complete Guide for 2026',
    excerpt: 'From wardrobe layouts to lighting design — everything you need to create a master bedroom that feels like a luxury hotel suite.',
    category: 'Bedroom',
    readTime: '6 min read',
    date: 'May 2026',
    image: '/images/blog/bedroom-design.jpg',
    content: `
      <h2>The Master Bedroom: Your Home's Most Important Room</h2>
      <p>You spend a third of your life in your bedroom. Yet most homeowners treat it as an afterthought, spending lavishly on public spaces like the living room while the bedroom gets a coat of paint and whatever furniture fits. In 2026, the trend is reversing — master bedrooms are becoming sanctuaries, designed with the same care as the finest hotel suites.</p>

      <h2>Getting the Layout Right</h2>
      <p>A master bedroom should have three zones: the sleeping zone (bed + bedside tables), the storage zone (wardrobes), and ideally a dressing zone (vanity + mirror). In most Indian apartments, the master bedroom is 12×14 feet or larger, which is enough to create all three zones with careful furniture placement.</p>
      <p>Leave a minimum 3 feet of circulation space on both sides of the bed. The wardrobe should ideally face the bed — this creates a natural dressing workflow and allows you to see the full wardrobe interior from the bed.</p>

      <h2>Wardrobe Design: Walk-In vs Built-In</h2>
      <p>For bedrooms under 180 sqft, built-in wardrobes are the practical choice. A 7–8 foot wide wardrobe with a combination of hanging space, drawers, and shelving serves most couples comfortably. Sliding doors save floor space but limit simultaneous access.</p>
      <p>If you have a 3BHK or larger, a walk-in wardrobe (minimum 6×8 feet) is worth the investment. It keeps the bedroom uncluttered and makes the morning routine far more pleasant. Budget ₹2–5 lakhs for a well-designed walk-in with good lighting.</p>

      <h2>Lighting: The Detail That Makes the Difference</h2>
      <p>Layer your bedroom lighting across three levels. Ambient light (recessed spots or a pendant) for overall illumination. Task light (bedside wall sconces or pendants) for reading. Accent light (cove LEDs, wardrobe interior lighting) for atmosphere.</p>
      <p>Install dimmers on all bedroom circuits — the ability to drop light levels from 100% to 20% is what separates a functional bedroom from a restful one. Warm white (2700K) is the correct colour temperature for bedrooms.</p>

      <h2>Materials That Feel Luxurious</h2>
      <p>Texture is everything in a bedroom. Combine matte painted walls with a textured wallpaper headboard panel. Use linen or velvet for upholstered headboards. Engineered wood flooring (6–8mm wear layer) adds warmth underfoot that no tile can match. A quality mattress and linen set, while not interior design, completes the hotel-suite feeling more than any piece of furniture.</p>
    `,
  },
  {
    slug: 'living-room-interior-design-tips',
    title: '10 Living Room Design Tips That Make Small Spaces Feel Larger',
    excerpt: 'Smart furniture placement, mirror tricks, lighting hacks — proven tips from top Bangalore designers to maximize your living room.',
    category: 'Living Room',
    readTime: '4 min read',
    date: 'April 2026',
    image: '/images/blog/living-room-tips.jpg',
    content: `
      <h2>Small Living Rooms Need Smarter Design, Not More Space</h2>
      <p>Most apartments in Bangalore have living rooms between 160–240 sqft. That's not a lot, but it's enough to create a beautifully functional space with the right choices. The biggest mistakes we see in small living rooms are furniture that's too large, too many pieces, and poor lighting. These 10 tips address all three.</p>

      <h2>Furniture: Scale and Floating Placement</h2>
      <p>Choose a sofa that's 65–70% of the room's width — not larger. A sofa that touches both walls feels cramped. Float the sofa 12–18 inches from the wall (even in a small room) to create depth. Use a loveseat or a 2-seater instead of a 3-seater in rooms under 180 sqft. Raise furniture off the floor — legs on sofas and coffee tables reveal floor area and make a room feel larger.</p>
      <p>Replace bulky TV units with a floating TV panel — the revealed floor beneath it is worth more than any other design choice in a small living room.</p>

      <h2>Mirrors: The Designer's Cheat Code</h2>
      <p>A floor-to-ceiling mirror on one wall visually doubles the room. Position it across from a window to reflect natural light. A mirror on the entry wall extends the visual depth of the room from the moment you walk in.</p>

      <h2>Colour and Light</h2>
      <p>Light walls expand space visually. Use the same colour (or very similar tones) on walls and ceiling to remove the boundary and raise perceived ceiling height. Limit your material palette to 3–4 materials maximum — complexity makes small spaces feel cluttered.</p>
      <p>Use multiple light sources at different heights instead of a single overhead fixture. A floor lamp, table lamp, and accent lights create depth and layers that make a space feel larger and more dynamic than any overhead fitting can.</p>
    `,
  },
  {
    slug: 'bathroom-renovation-trends-2026',
    title: 'Bathroom Renovation Trends 2026: From Functional to Luxurious',
    excerpt: 'Walk-in showers, floating vanities, backlit mirrors — the bathroom renovation trends transforming Indian homes this year.',
    category: 'Bathroom',
    readTime: '3 min read',
    date: 'April 2026',
    image: '/images/blog/bathroom-trends.jpg',
    content: `
      <h2>The Bathroom is Having a Moment</h2>
      <p>Indian homeowners are increasingly treating the master bathroom as a luxury retreat. Inspired by boutique hotel bathrooms and global design trends, 2026 is seeing a surge in investment in premium bathroom renovation across Bangalore, Mumbai, and Delhi NCR. Here are the trends driving this shift.</p>

      <h2>Walk-In Showers Replace Shower Enclosures</h2>
      <p>Traditional shower enclosures with their aluminium frames and curtains are being replaced by frameless walk-in showers. A 3-foot minimum width, a rain shower head, and a handheld shower combined with large-format wall tiles (600×1200mm is the current favourite) creates a spa-like experience. Budget for this upgrade: ₹80,000 – ₹1.8 lakhs including waterproofing, tiles, and fittings.</p>

      <h2>Floating Vanities and Countertop Basins</h2>
      <p>Wall-mounted (floating) vanities reveal the floor beneath them, making bathrooms feel larger. Paired with a countertop basin — a vessel that sits atop the vanity — they create the signature look of luxury hotel bathrooms. Quartz countertops with integrated basin surrounds are the practical choice; they're non-porous and easy to clean.</p>

      <h2>Backlit Mirrors and Warm Lighting</h2>
      <p>A simple LED backlit mirror changes the entire character of a bathroom. The soft halo of light behind the mirror eliminates the harsh shadows created by overhead lighting. Combined with warm-toned tiles and wooden accessories, it creates a welcoming atmosphere rather than a clinical one. Budget: ₹8,000 – ₹25,000 for a quality backlit mirror.</p>
    `,
  },
  {
    slug: 'complete-home-interior-cost-guide',
    title: 'Complete Home Interior Cost Guide: 1BHK to 4BHK in India',
    excerpt: 'Transparent pricing breakdown for every room — what essential, premium, and luxury finishes actually cost in 2026.',
    category: 'Guide',
    readTime: '7 min read',
    date: 'March 2026',
    image: '/images/blog/cost-guide.jpg',
    content: `
      <h2>How Much Does Interior Design Really Cost?</h2>
      <p>The most common question we hear at Intrafer is "how much will it cost?" The honest answer is: it depends. But that doesn't mean you should go in blind. This guide gives you transparent, market-verified cost ranges for every room in your home, across three quality tiers — Essential, Premium, and Luxury.</p>

      <h2>Quality Tiers Explained</h2>
      <p><strong>Essential (Value):</strong> ISI-marked plywood, laminate shutters, domestic fittings. Good quality, functional, lasts 8–12 years. Best for rental properties and first homes with tight budgets.</p>
      <p><strong>Premium (Best Value):</strong> BWR or marine plywood, acrylic/membrane shutters, Hettich or Häfele hardware. Excellent quality, beautiful finishes, lasts 15–20 years. This is the sweet spot for most homeowners.</p>
      <p><strong>Luxury (Ultra-Premium):</strong> Italian or imported materials, Blum hardware throughout, custom designs, designer lighting. Museum quality, unlimited durability. For those for whom budget is not the primary consideration.</p>

      <h2>Cost by Room (Bangalore 2026)</h2>
      <p><strong>Modular Kitchen:</strong> Essential ₹1.5L | Premium ₹2.8L | Luxury ₹5L+</p>
      <p><strong>Master Bedroom (wardrobe + false ceiling + lights):</strong> Essential ₹1L | Premium ₹1.9L | Luxury ₹3.5L</p>
      <p><strong>Living Room (TV unit + false ceiling + sofa area):</strong> Essential ₹80K | Premium ₹1.5L | Luxury ₹2.8L</p>
      <p><strong>Bathroom renovation:</strong> Essential ₹40K | Premium ₹80K | Luxury ₹1.5L+</p>
      <p><strong>Full 2BHK (all rooms):</strong> Essential ₹8–12L | Premium ₹15–22L | Luxury ₹30–50L+</p>

      <h2>Hidden Costs to Plan For</h2>
      <p>Always budget an additional 10–15% for civil work (hacking, waterproofing), 5% for electrical upgrades, and 3–5% for unexpected site conditions. Interior design fees (if separate from execution) range from 5–15% of the project value. Many firms include this in the turnkey cost — always ask upfront.</p>

      <h2>How to Get the Best Value</h2>
      <p>Get a minimum of 3 detailed quotations from verified designers. Ensure each quote specifies brand names for all hardware and materials. A lower quote that uses unbranded fittings is often more expensive in the long run. Verify the designer's previous work personally — visit a completed project if possible, not just portfolio images.</p>
    `,
  },
];

function parseDisplayDate(display) {
  // "June 2026" -> Date for the 1st of that month; falls back to now if unparsable.
  const parsed = new Date(`1 ${display}`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let created = 0;
  let skipped = 0;

  for (const post of BLOG_POSTS) {
    const existing = await BlogPost.findOne({ slug: post.slug });
    if (existing) {
      skipped += 1;
      continue;
    }

    await BlogPost.create({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      content: post.content,
      coverImage: post.image,
      readTime: post.readTime,
      isPublished: true,
      publishedAt: parseDisplayDate(post.date),
    });
    created += 1;
  }

  console.log(`\nSeed complete — ${created} post(s) created, ${skipped} skipped (already existed).`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

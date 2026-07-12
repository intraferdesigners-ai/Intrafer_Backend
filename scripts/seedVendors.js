const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Project = require('../src/models/Project.model');

const VENDORS = [
  {
    user: {
      name: 'Priya Sharma',
      email: 'priya@artstudiointeriors.com',
      phone: '9845012345',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Art Studio Interiors',
      profilePhoto: '',
      description:
        'Award-winning studio with 12 years of experience transforming residential and commercial spaces across Bangalore. We specialise in bespoke modern interiors that balance aesthetics with functionality. Our team of 15 designers has completed over 400 projects.',
      specializations: ['Residential', 'Modular Kitchen', 'Living Room', 'False Ceiling', 'Full Home Interior'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560001', lat: 12.9716, lng: 77.5946 },
      rating: 4.9,
      reviewCount: 87,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80',
        'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
        'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=80',
      ],
      totalLeads: 42,
      wonLeads: 32,
    },
    projects: [
      {
        title: 'Modern 3BHK - Whitefield',
        description:
          'Complete home interior for a 1800 sqft 3BHK apartment. Includes modular kitchen with island counter, master bedroom with walk-in wardrobe, and false ceiling with indirect lighting throughout.',
        projectType: 'Residential',
        style: 'Modern',
        location: 'Whitefield, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
          'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
        ],
      },
      {
        title: 'Luxury Villa - Sarjapur Road',
        description:
          'Full home interior for a 4500 sqft villa. Premium Italian marble flooring, custom joinery, imported fixtures, and a chef\'s kitchen with Häfele hardware throughout.',
        projectType: 'Full Home Interior',
        style: 'Luxury',
        location: 'Sarjapur, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=800&q=80',
          'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80',
          'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=800&q=80',
        ],
      },
      {
        title: 'Minimalist Office - Koramangala',
        description:
          '2000 sqft tech startup office. Open floor plan with collaborative zones, private cabins, and a premium reception. Acoustic panels and ergonomic furniture throughout.',
        projectType: 'Office Interiors',
        style: 'Minimalist',
        location: 'Koramangala, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
          'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
          'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Rahul Mehta',
      email: 'rahul@designnestbangalore.com',
      phone: '9880123456',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Design Nest',
      profilePhoto: '',
      description:
        'Contemporary interior design studio focused on Scandinavian and minimalist aesthetics. 8 years of experience, 200+ projects delivered across Bangalore with an average 4.8 rating. We believe in clean lines, natural materials, and spaces that breathe.',
      specializations: ['Residential', 'Bedroom', 'Living Room', 'Scandinavian', 'Minimalist'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560034', lat: 12.9352, lng: 77.6244 },
      rating: 4.8,
      reviewCount: 64,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
        'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800&q=80',
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800&q=80',
      ],
      totalLeads: 35,
      wonLeads: 25,
    },
    projects: [
      {
        title: 'Scandinavian 2BHK - HSR Layout',
        description:
          '900 sqft 2BHK transformed with Scandinavian aesthetics. White oak flooring, linen upholstery, minimal clutter design with smart hidden storage throughout.',
        projectType: 'Residential',
        style: 'Scandinavian',
        location: 'HSR Layout, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
          'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800&q=80',
          'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800&q=80',
        ],
      },
      {
        title: 'Minimalist Master Bedroom - Indiranagar',
        description:
          'Serene master bedroom with custom walk-in wardrobe, integrated study nook, and Japanese-inspired tatami platform bed. Warm neutral palette with linen and natural wood.',
        projectType: 'Bedroom',
        style: 'Minimalist',
        location: 'Indiranagar, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=800&q=80',
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
          'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&q=80',
        ],
      },
      {
        title: 'Open Living Dining - Jayanagar',
        description:
          'Seamless open-plan living and dining space for a 1200 sqft apartment. Custom sofa, built-in display shelving, and a dining area with pendant lighting.',
        projectType: 'Living Room',
        style: 'Contemporary',
        location: 'Jayanagar, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
          'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=80',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Sneha Kapoor',
      email: 'sneha@luxespacesinteriors.com',
      phone: '9741234567',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Luxe Spaces',
      profilePhoto: '',
      description:
        'Premium luxury interior design for discerning clients. We work exclusively on high-end residential projects above ₹25 lakhs. Italian furniture, imported materials, and bespoke craftsmanship define every Luxe Spaces project. 10 years, 150 luxury projects.',
      specializations: ['Luxury', 'Full Home Interior', 'Residential', 'Modular Kitchen', 'Bathroom'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560071', lat: 12.9698, lng: 77.75 },
      rating: 4.9,
      reviewCount: 52,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=800&q=80',
        'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80',
        'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800&q=80',
      ],
      totalLeads: 28,
      wonLeads: 22,
    },
    projects: [
      {
        title: 'Penthouse Interior - Embassy Golf Links',
        description:
          '6000 sqft penthouse with panoramic city views. Bespoke Italian furniture, Venetian plaster walls, custom lighting design by a Berlin lighting architect, and a show kitchen with Miele appliances.',
        projectType: 'Full Home Interior',
        style: 'Luxury',
        location: 'Embassy Golf Links, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=800&q=80',
          'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80',
          'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800&q=80',
        ],
      },
      {
        title: 'Luxury Modular Kitchen - Prestige Lakeside',
        description:
          'Chef\'s kitchen with Häfele pull-outs, Blum hinges, quartz countertops, and integrated Bosch appliances. Island counter with bar seating for 4. Custom lacquered shutters.',
        projectType: 'Modular Kitchen',
        style: 'Luxury',
        location: 'Prestige Lakeside, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
          'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=80',
          'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80',
        ],
      },
      {
        title: 'Spa Bathroom - Brigade Residences',
        description:
          'Master bathroom transformation inspired by Bali luxury resorts. Natural stone cladding, freestanding bathtub, rain shower, and custom vanity with vessel sink.',
        projectType: 'Bathroom',
        style: 'Luxury',
        location: 'Brigade Residences, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=800&q=80',
          'https://images.unsplash.com/photo-1620626011761-996317702149?w=800&q=80',
          'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Arun Nair',
      email: 'arun@urbancanvasdesign.com',
      phone: '9632109876',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Urban Canvas',
      profilePhoto: '',
      description:
        'Contemporary design studio specialising in urban apartments and co-living spaces. We combine smart storage solutions with bold design choices to make compact spaces feel expansive. 6 years, 180 projects, average completion in 45 days.',
      specializations: ['Residential', '1BHK', '2BHK', 'Modular Kitchen', 'Space Saving'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560095', lat: 13.0358, lng: 77.597 },
      rating: 4.7,
      reviewCount: 93,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
        'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
        'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=80',
      ],
      totalLeads: 48,
      wonLeads: 32,
    },
    projects: [
      {
        title: 'Smart 1BHK - Hebbal',
        description:
          '550 sqft 1BHK with every inch optimised. Murphy bed with integrated study table, modular kitchen with breakfast counter, and hidden storage under the sofa. Feels like 900 sqft.',
        projectType: 'Residential',
        style: 'Contemporary',
        location: 'Hebbal, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
          'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80',
        ],
      },
      {
        title: 'Industrial 2BHK - Yelahanka',
        description:
          'Raw industrial aesthetic with exposed brick, metal shelving, and concrete-look tiles. A modern loft feel in a standard apartment. Dark palette with strategic warm lighting.',
        projectType: 'Residential',
        style: 'Industrial',
        location: 'Yelahanka, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
          'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=800&q=80',
          'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&q=80',
        ],
      },
      {
        title: 'Co-living Space - Electronic City',
        description:
          '8-bed co-living space with individual privacy pods, shared kitchen, and a community lounge. Maximised usable space with clever bunk configurations and shared storage.',
        projectType: 'Residential',
        style: 'Contemporary',
        location: 'Electronic City, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
          'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
          'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Divya Krishnan',
      email: 'divya@ecohomedecor.com',
      phone: '9543219876',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Eco Home Decor',
      profilePhoto: '',
      description:
        'Sustainable interior design using eco-friendly materials, reclaimed wood, and natural fabrics. We source locally and design with minimal environmental impact. Biophilic design specialists — bringing nature indoors. 7 years, 120 projects.',
      specializations: ['Residential', 'Sustainable', 'Biophilic', 'Living Room', 'Bedroom'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560041', lat: 12.9279, lng: 77.6271 },
      rating: 4.8,
      reviewCount: 41,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
        'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
        'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=800&q=80',
      ],
      totalLeads: 22,
      wonLeads: 15,
    },
    projects: [
      {
        title: 'Biophilic Living Room - JP Nagar',
        description:
          'A living room that breathes. Living green walls, reclaimed teak wood shelving, natural jute rugs, and linen upholstery. Air-purifying plants integrated throughout the design.',
        projectType: 'Living Room',
        style: 'Bohemian',
        location: 'JP Nagar, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
          'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=800&q=80',
          'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
        ],
      },
      {
        title: 'Sustainable 3BHK - Banashankari',
        description:
          'Full home using only FSC-certified wood, VOC-free paints, and recycled glass countertops. Solar-integrated lighting controls and rainwater harvesting-compatible bathroom fittings.',
        projectType: 'Residential',
        style: 'Contemporary',
        location: 'Banashankari, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
          'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&q=80',
        ],
      },
      {
        title: 'Bohemian Bedroom - Basavanagudi',
        description:
          'Eclectic bohemian bedroom with vintage Indian textiles, macramé wall art, terracotta pots, and a hand-painted accent wall. Maximalist with soul.',
        projectType: 'Bedroom',
        style: 'Bohemian',
        location: 'Basavanagudi, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=800&q=80',
          'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&q=80',
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Vikram Shetty',
      email: 'vikram@kitchenkulture.com',
      phone: '9876501234',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Kitchen Kulture',
      profilePhoto: '',
      description:
        "Bangalore's specialist modular kitchen studio. We only do kitchens — and we do them exceptionally well. German and Italian hardware, 30+ finish options, 10-year warranty on all work. If your kitchen matters to you, we are your studio. 9 years, 350+ kitchens.",
      specializations: ['Modular Kitchen', 'Pantry', 'Dining Area', 'Kitchen Storage'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560017', lat: 12.985, lng: 77.5533 },
      rating: 4.9,
      reviewCount: 118,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
        'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=80',
        'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80',
      ],
      totalLeads: 50,
      wonLeads: 38,
    },
    projects: [
      {
        title: 'L-Shaped Kitchen with Island - Malleshwaram',
        description:
          '270cm L-shaped kitchen with a 120cm island breakfast counter. Matt black handles, stone grey shutters, white quartz countertop, and a fully integrated Siemens appliance suite.',
        projectType: 'Modular Kitchen',
        style: 'Modern',
        location: 'Malleshwaram, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
          'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=80',
          'https://images.unsplash.com/photo-1556909172-54557c7e4fb7?w=800&q=80',
        ],
      },
      {
        title: 'U-Shaped Chef Kitchen - Rajajinagar',
        description:
          'Professional-grade U-shaped kitchen for a home chef. 6-burner Faber hob, tall unit with Häfele pull-outs, spice rack carousel, and a walk-in pantry with pull-out drawers.',
        projectType: 'Modular Kitchen',
        style: 'Contemporary',
        location: 'Rajajinagar, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80',
          'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=80',
          'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
        ],
      },
      {
        title: 'Compact Kitchen + Dining - Vijayanagar',
        description:
          'Small 150sqft kitchen maximised with floor-to-ceiling cabinetry, integrated dining table that folds down from the wall, and a peninsula counter doubling as breakfast bar.',
        projectType: 'Modular Kitchen',
        style: 'Contemporary',
        location: 'Vijayanagar, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1556909172-54557c7e4fb7?w=800&q=80',
          'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=80',
          'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Meera Iyer',
      email: 'meera@officecraftdesign.com',
      phone: '9123456789',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Office Craft',
      profilePhoto: '',
      description:
        'Dedicated commercial interior design studio. We design offices that improve productivity, reflect brand culture, and create environments people want to work in. Clients include 40+ startups and established enterprises across Bangalore. 11 years experience.',
      specializations: ['Office Interiors', 'Commercial', 'Co-working', 'Conference Rooms', 'Reception'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560103', lat: 12.9065, lng: 77.6475 },
      rating: 4.7,
      reviewCount: 76,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
        'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80',
      ],
      totalLeads: 38,
      wonLeads: 27,
    },
    projects: [
      {
        title: 'Tech Startup Office - Outer Ring Road',
        description:
          '5000 sqft office for a Series B startup. Open collaboration zones, 8 private focus pods, a creative war room with writable walls, gaming area, and a café-style pantry.',
        projectType: 'Office Interiors',
        style: 'Modern',
        location: 'Outer Ring Road, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
          'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
          'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80',
        ],
      },
      {
        title: 'Law Firm Interior - MG Road',
        description:
          '3000 sqft premium law firm interior. Mahogany panelling, leather seating, a boardroom for 20, and individual partner cabins with acoustic privacy. Traditional prestige meets modern ergonomics.',
        projectType: 'Office Interiors',
        style: 'Traditional',
        location: 'MG Road, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&q=80',
          'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
          'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80',
        ],
      },
      {
        title: 'Co-working Space - Indiranagar',
        description:
          'Boutique co-working space for 80 members. Hot desks, 6 meeting pods, 2 phone booths, and a rooftop terrace. Designed to feel like a premium hotel lobby, not a typical office.',
        projectType: 'Co-working',
        style: 'Contemporary',
        location: 'Indiranagar, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=80',
          'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
          'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
        ],
      },
    ],
  },
  {
    user: {
      name: 'Karthik Reddy',
      email: 'karthik@vaastuhomedesign.com',
      phone: '9901234567',
      passwordHash: 'Vendor@1234',
      role: 'vendor',
    },
    vendor: {
      businessName: 'Vaastu Home Design',
      profilePhoto: '',
      description:
        'Traditional Indian interior design infused with Vaastu principles. We create homes that are not just beautiful but harmonious — balancing modern aesthetics with ancient wisdom. Specialists in traditional, ethnic, and Indo-contemporary styles. 14 years, 300+ homes.',
      specializations: ['Traditional', 'Ethnic', 'Vaastu', 'Pooja Room', 'Full Home Interior'],
      location: { city: 'Bangalore', state: 'Karnataka', pincode: '560076', lat: 12.8456, lng: 77.6603 },
      rating: 4.8,
      reviewCount: 134,
      isApproved: true,
      isListingEnabled: true,
      portfolioImages: [
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
        'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
        'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
      ],
      totalLeads: 45,
      wonLeads: 34,
    },
    projects: [
      {
        title: 'Traditional South Indian Villa - Bannerghatta',
        description:
          '4BHK villa with authentic South Indian design elements — teak wood columns, antique brass fixtures, hand-painted Tanjore art panels, and a traditional courtyard-inspired central living area.',
        projectType: 'Full Home Interior',
        style: 'Traditional',
        location: 'Bannerghatta Road, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
          'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
          'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
        ],
      },
      {
        title: 'Vaastu-Compliant 3BHK - BTM Layout',
        description:
          'Complete home redesigned for Vaastu compliance. Kitchen in southeast, master bedroom in southwest, pooja room in northeast. Natural materials, earthy palette, and brass accents throughout.',
        projectType: 'Residential',
        style: 'Traditional',
        location: 'BTM Layout, Bangalore',
        completedYear: 2025,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
          'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
        ],
      },
      {
        title: 'Ethnic Pooja Room - Kanakapura Road',
        description:
          'Custom-designed pooja room with hand-carved teak mandap, brass oil lamps, Kerala mural-style painting on the backdrop, and concealed storage for puja essentials.',
        projectType: 'Pooja Room',
        style: 'Traditional',
        location: 'Kanakapura Road, Bangalore',
        completedYear: 2024,
        isPublished: true,
        images: [
          'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
          'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
        ],
      },
    ],
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Clear all vendor users and their related data
  const vendorUsers = await User.find({ role: 'vendor' });
  const vendorUserIds = vendorUsers.map((u) => u._id);
  const existingVendors = await Vendor.find({ userId: { $in: vendorUserIds } });
  const vendorIds = existingVendors.map((v) => v._id);

  await Project.deleteMany({ vendorId: { $in: vendorIds } });
  await Vendor.deleteMany({ _id: { $in: vendorIds } });
  await User.deleteMany({ role: 'vendor' });
  console.log('Cleared existing vendor data');

  const results = [];

  for (const data of VENDORS) {
    // Create user — pre-save hook hashes passwordHash with bcryptjs (saltRounds 12)
    const user = await User.create(data.user);
    const vendor = await Vendor.create({ ...data.vendor, userId: user._id });
    const projects = await Promise.all(
      data.projects.map((p) => Project.create({ ...p, vendorId: vendor._id }))
    );
    results.push({ user, vendor, projectCount: projects.length });
  }

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                          SEED COMPLETE — 8 VENDORS CREATED                  │');
  console.log('├──────────────────────────────┬──────────┬─────────┬─────────┬───────────────┤');
  console.log('│ Business Name                │ Rating   │ Reviews │Projects │ City          │');
  console.log('├──────────────────────────────┼──────────┼─────────┼─────────┼───────────────┤');

  for (const { vendor, projectCount } of results) {
    const name = vendor.businessName.padEnd(28);
    const rating = String(vendor.rating).padEnd(8);
    const reviews = String(vendor.reviewCount).padEnd(7);
    const proj = String(projectCount).padEnd(7);
    const city = (vendor.location?.city || '').padEnd(13);
    console.log(`│ ${name} │ ${rating} │ ${reviews} │ ${proj} │ ${city} │`);
  }

  console.log('└──────────────────────────────┴──────────┴─────────┴─────────┴───────────────┘');
  console.log(`\nTotal vendors: ${results.length}`);
  console.log(`Total projects: ${results.reduce((s, r) => s + r.projectCount, 0)}`);
  console.log('All vendor passwords: Vendor@1234\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

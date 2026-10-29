// RoboShop product catalogue: the only source of catalogue data, stored in MongoDB.
//
// Runs once automatically when MongoDB is set up on an empty volume (mounted into
// /docker-entrypoint-initdb.d as 20-catalog.js; it does not depend on the application
// user script). Re-run it at any time to add new products to an existing database:
//   kubectl -n roboshop-ai exec -i deploy/mongodb -- sh -c 'mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < services/mongodb/catalog.js
//   npm run catalog:import          # Node driver, uses MONGODB_URL / MONGODB_DATABASE
//
// Insert-only: a product whose SKU already exists is left untouched, so admin edits,
// prices, stock, archived flags and revisions in MongoDB always win. To change a live
// product, use the admin console. After editing this file, run
// `npm run catalog:configmap` to refresh the Kubernetes ConfigMap copy.

// BEGIN CATALOG DATA (a JSON array: keep it valid JSON)
const CATALOG = [
  {
    "slug": "atlas-x1",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "Atlas X1",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "Atlas X1",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "ATLAS-X1",
    "name": "Atlas X1",
    "description": "Meet Atlas X1, part of the RoboShop robotics collection.",
    "price": 999,
    "instock": 38,
    "categories": [
      "humanoid",
      "robot"
    ],
    "image": "/product-media/atlas-x1.png"
  },
  {
    "slug": "novaclean-pro",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "NovaClean Pro",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "NovaClean Pro",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "NOVACLEAN-PRO",
    "name": "NovaClean Pro",
    "description": "Meet NovaClean Pro, part of the RoboShop robotics collection.",
    "price": 241,
    "instock": 30,
    "categories": [
      "cleaning",
      "robot"
    ],
    "image": "/product-media/novaclean-pro.png"
  },
  {
    "slug": "titanlift-t500",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "TitanLift T500",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "TitanLift T500",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "TITANLIFT-T500",
    "name": "TitanLift T500",
    "description": "Meet TitanLift T500, part of the RoboShop robotics collection.",
    "price": 857,
    "instock": 50,
    "categories": [
      "warehouse",
      "robot"
    ],
    "image": "/product-media/titanlift-t500.png"
  },
  {
    "slug": "scout-rover-s3",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "Scout Rover S3",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "Scout Rover S3",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "SCOUT-ROVER-S3",
    "name": "Scout Rover S3",
    "description": "Meet Scout Rover S3, part of the RoboShop robotics collection.",
    "price": 383,
    "instock": 43,
    "categories": [
      "exploration",
      "robot"
    ],
    "image": "/product-media/scout-rover-s3.png"
  },
  {
    "slug": "guardian-g7",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "Guardian G7",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "Guardian G7",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "GUARDIAN-G7",
    "name": "Guardian G7",
    "description": "Meet Guardian G7, part of the RoboShop robotics collection.",
    "price": 620,
    "instock": 50,
    "categories": [
      "security",
      "robot"
    ],
    "image": "/product-media/guardian-g7.png"
  },
  {
    "slug": "mechaarm-m6",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "MechaArm M6",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "MechaArm M6",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "MECHAARM-M6",
    "name": "MechaArm M6",
    "description": "Meet MechaArm M6, part of the RoboShop robotics collection.",
    "price": 762,
    "instock": 23,
    "categories": [
      "robotic arm",
      "robot"
    ],
    "image": "/product-media/mechaarm-m6.png"
  },
  {
    "slug": "companion-c2",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "Companion C2",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "Companion C2",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "COMPANION-C2",
    "name": "Companion C2",
    "description": "Meet Companion C2, part of the RoboShop robotics collection.",
    "price": 525,
    "instock": 26,
    "categories": [
      "companion",
      "robot"
    ],
    "image": "/product-media/companion-c2.png"
  },
  {
    "slug": "agrobot-a200",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "AgroBot A200",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "AgroBot A200",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "AGROBOT-A200",
    "name": "AgroBot A200",
    "description": "Meet AgroBot A200, part of the RoboShop robotics collection.",
    "price": 715,
    "instock": 35,
    "categories": [
      "agriculture",
      "robot"
    ],
    "image": "/product-media/agrobot-a200.png"
  },
  {
    "slug": "swiftcarry-d4",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "SwiftCarry D4",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "SwiftCarry D4",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "SWIFTCARRY-D4",
    "name": "SwiftCarry D4",
    "description": "Meet SwiftCarry D4, part of the RoboShop robotics collection.",
    "price": 573,
    "instock": 37,
    "categories": [
      "delivery",
      "robot"
    ],
    "image": "/product-media/swiftcarry-d4.png"
  },
  {
    "slug": "edubot-spark",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "EduBot Spark",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "EduBot Spark",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "EDUBOT-SPARK",
    "name": "EduBot Spark",
    "description": "Meet EduBot Spark, part of the RoboShop robotics collection.",
    "price": 99,
    "instock": 29,
    "categories": [
      "education",
      "robot"
    ],
    "image": "/product-media/edubot-spark.png"
  },
  {
    "slug": "mediassist-m10",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "MediAssist M10",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "MediAssist M10",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "MEDIASSIST-M10",
    "name": "MediAssist M10",
    "description": "Meet MediAssist M10, part of the RoboShop robotics collection.",
    "price": 904,
    "instock": 28,
    "categories": [
      "logistics",
      "robot"
    ],
    "image": "/product-media/mediassist-m10.png"
  },
  {
    "slug": "chefmate-c8",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "ChefMate C8",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "ChefMate C8",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "CHEFMATE-C8",
    "name": "ChefMate C8",
    "description": "Meet ChefMate C8, part of the RoboShop robotics collection.",
    "price": 478,
    "instock": 42,
    "categories": [
      "kitchen",
      "robot"
    ],
    "image": "/product-media/chefmate-c8.png"
  },
  {
    "slug": "aquascout-r2",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "AquaScout R2",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "AquaScout R2",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "AQUASCOUT-R2",
    "name": "AquaScout R2",
    "description": "Meet AquaScout R2, part of the RoboShop robotics collection.",
    "price": 431,
    "instock": 20,
    "categories": [
      "inspection",
      "robot"
    ],
    "image": "/product-media/aquascout-r2.png"
  },
  {
    "slug": "fireshield-f5",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "FireShield F5",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "FireShield F5",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "FIRESHIELD-F5",
    "name": "FireShield F5",
    "description": "Meet FireShield F5, part of the RoboShop robotics collection.",
    "price": 952,
    "instock": 31,
    "categories": [
      "inspection",
      "robot"
    ],
    "image": "/product-media/fireshield-f5.png"
  },
  {
    "slug": "buildbot-b300",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "BuildBot B300",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "BuildBot B300",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "BUILDBOT-B300",
    "name": "BuildBot B300",
    "description": "Meet BuildBot B300, part of the RoboShop robotics collection.",
    "price": 810,
    "instock": 24,
    "categories": [
      "construction",
      "robot"
    ],
    "image": "/product-media/buildbot-b300.png"
  },
  {
    "slug": "solarsweep-s6",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "SolarSweep S6",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "SolarSweep S6",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "SOLARSWEEP-S6",
    "name": "SolarSweep S6",
    "description": "Meet SolarSweep S6, part of the RoboShop robotics collection.",
    "price": 288,
    "instock": 20,
    "categories": [
      "cleaning",
      "robot"
    ],
    "image": "/product-media/solarsweep-s6.png"
  },
  {
    "slug": "petpal-p3",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "PetPal P3",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "PetPal P3",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "PETPAL-P3",
    "name": "PetPal P3",
    "description": "Meet PetPal P3, part of the RoboShop robotics collection.",
    "price": 146,
    "instock": 43,
    "categories": [
      "companion",
      "robot"
    ],
    "image": "/product-media/petpal-p3.png"
  },
  {
    "slug": "aeroinspect-a9",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "AeroInspect A9",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "AeroInspect A9",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "AEROINSPECT-A9",
    "name": "AeroInspect A9",
    "description": "Meet AeroInspect A9, part of the RoboShop robotics collection.",
    "price": 667,
    "instock": 37,
    "categories": [
      "aerial",
      "robot"
    ],
    "image": "/product-media/aeroinspect-a9.png"
  },
  {
    "slug": "shelfsense-r8",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "ShelfSense R8",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "ShelfSense R8",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "SHELFSENSE-R8",
    "name": "ShelfSense R8",
    "description": "Meet ShelfSense R8, part of the RoboShop robotics collection.",
    "price": 336,
    "instock": 29,
    "categories": [
      "retail",
      "robot"
    ],
    "image": "/product-media/shelfsense-r8.png"
  },
  {
    "slug": "lawnpilot-l4",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "LawnPilot L4",
    "productType": "complete robot",
    "catalogueVersion": "demo-20-inr-v2",
    "specifications": {
      "Model": "LawnPilot L4",
      "Product type": "Robot",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "imageAttribution": {
      "credit": "AI-generated concept render; not a manufacturer photograph"
    },
    "collection": "demo",
    "archived": false,
    "sku": "LAWNPILOT-L4",
    "name": "LawnPilot L4",
    "description": "Meet LawnPilot L4, part of the RoboShop robotics collection.",
    "price": 194,
    "instock": 34,
    "categories": [
      "gardening",
      "robot"
    ],
    "image": "/product-media/lawnpilot-l4.png"
  },
  {
    "slug": "poolpro-p7",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "PoolPro P7",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "PoolPro P7",
      "Product type": "Robot",
      "Intended use": "Pool floor and wall cleaning",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "POOLPRO-P7",
    "name": "PoolPro P7",
    "description": "An underwater cleaning robot for home swimming pools. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 559,
    "instock": 27,
    "categories": [
      "cleaning",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "windowglide-w3",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "WindowGlide W3",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "WindowGlide W3",
      "Product type": "Robot",
      "Intended use": "Window and glass cleaning",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "WINDOWGLIDE-W3",
    "name": "WindowGlide W3",
    "description": "A window cleaning robot for glass panes, mirrors and glass doors. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 329,
    "instock": 33,
    "categories": [
      "cleaning",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "codecub-k1",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "CodeCub K1",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "CodeCub K1",
      "Product type": "Robot",
      "Intended use": "Introductory coding for children",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "CODECUB-K1",
    "name": "CodeCub K1",
    "description": "A coding robot for children learning sequences, loops and problem solving. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 149,
    "instock": 46,
    "categories": [
      "education",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "stemstar-s5",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "STEMStar S5",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "STEMStar S5",
      "Product type": "Robot",
      "Intended use": "Classroom STEM projects",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "STEMSTAR-S5",
    "name": "STEMStar S5",
    "description": "A classroom STEM rover for group robotics and science projects. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 279,
    "instock": 38,
    "categories": [
      "education",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "gripmate-g2",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "GripMate G2",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "GripMate G2",
      "Product type": "Robot",
      "Intended use": "Desktop pick-and-place practice",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "GRIPMATE-G2",
    "name": "GripMate G2",
    "description": "A desktop robotic arm for pick-and-place practice and automation lessons. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 689,
    "instock": 22,
    "categories": [
      "robotic arm",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "harvesthand-h6",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "HarvestHand H6",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "HarvestHand H6",
      "Product type": "Robot",
      "Intended use": "Fruit and vegetable picking",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "HARVESTHAND-H6",
    "name": "HarvestHand H6",
    "description": "A harvesting robot for picking fruit and vegetables in orchards and greenhouses. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 879,
    "instock": 21,
    "categories": [
      "agriculture",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "patrolpaw-q4",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "PatrolPaw Q4",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "PatrolPaw Q4",
      "Product type": "Robot",
      "Intended use": "Site patrol and monitoring",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "PATROLPAW-Q4",
    "name": "PatrolPaw Q4",
    "description": "A four-legged patrol robot for monitoring offices, campuses and warehouses. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 949,
    "instock": 24,
    "categories": [
      "security",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "carecompanion-e1",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "CareCompanion E1",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "CareCompanion E1",
      "Product type": "Robot",
      "Intended use": "Daily reminders and company for older adults",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "CARECOMPANION-E1",
    "name": "CareCompanion E1",
    "description": "A companion robot that offers reminders, conversation and check-ins for older adults. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 599,
    "instock": 30,
    "categories": [
      "companion",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "palletmover-m8",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "PalletMover M8",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "PalletMover M8",
      "Product type": "Robot",
      "Intended use": "Moving pallets and totes",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "PALLETMOVER-M8",
    "name": "PalletMover M8",
    "description": "A warehouse robot that moves pallets and totes between storage and dispatch. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 799,
    "instock": 26,
    "categories": [
      "warehouse",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "skysurvey-d2",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "SkySurvey D2",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "SkySurvey D2",
      "Product type": "Robot",
      "Intended use": "Aerial survey and mapping",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "SKYSURVEY-D2",
    "name": "SkySurvey D2",
    "description": "An aerial survey drone for mapping fields, roofs and construction sites. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 739,
    "instock": 29,
    "categories": [
      "aerial",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "pipecrawl-i3",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "PipeCrawl I3",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "PipeCrawl I3",
      "Product type": "Robot",
      "Intended use": "Pipe and duct inspection",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "PIPECRAWL-I3",
    "name": "PipeCrawl I3",
    "description": "An inspection crawler for pipes, ducts and other confined spaces. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 619,
    "instock": 25,
    "categories": [
      "inspection",
      "robot"
    ],
    "image": "/images/placeholder.png"
  },
  {
    "slug": "brewbot-b1",
    "currency": "INR",
    "priceType": "sale",
    "showcase": false,
    "fulfilment": "simulated",
    "demo": true,
    "synthetic": false,
    "model": "BrewBot B1",
    "productType": "complete robot",
    "catalogueVersion": "demo-32-inr-v3",
    "specifications": {
      "Model": "BrewBot B1",
      "Product type": "Robot",
      "Intended use": "Coffee and drink preparation",
      "Collection": "RoboShop",
      "Specification status": "Detailed hardware specifications pending supplier confirmation"
    },
    "collection": "demo",
    "archived": false,
    "sku": "BREWBOT-B1",
    "name": "BrewBot B1",
    "description": "A countertop kitchen robot that prepares coffee and other drinks. Demo listing; hardware specifications are pending supplier confirmation.",
    "price": 449,
    "instock": 35,
    "categories": [
      "kitchen",
      "robot"
    ],
    "image": "/images/placeholder.png"
  }
];
// END CATALOG DATA

const target = db.getSiblingDB((typeof process !== 'undefined' && process.env.MONGODB_DATABASE) || 'roboshop');
const products = target.getCollection('products');
products.createIndex({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });
const result = products.bulkWrite(CATALOG.map(product => ({
  updateOne: { filter: { _id: product.sku }, update: { $setOnInsert: { ...product, revision: 1 } }, upsert: true },
})));
print(`RoboShop catalog: ${result.upsertedCount} of ${CATALOG.length} products inserted; existing products unchanged.`);

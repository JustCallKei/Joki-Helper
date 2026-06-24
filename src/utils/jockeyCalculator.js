const { prisma } = require('../database');

// V4 Race Awakening fragment costs per gear upgrade (from KB)
const V4_FRAGMENT_COSTS = {
  0: 0,     // Gear 0 → 1: 0 fragments (trial only)
  1: 3000,  // Gear 1 → 2: 3,000 fragments
  2: 3500,  // Gear 2 → 3: 3,500 fragments
  3: 4000   // Gear 3 → 4: 4,000 fragments (Max / Full Gear)
};

// Fighting style prerequisites for Godhuman
const GODHUMAN_STYLE_PREREQS = [
  { name: 'Superhuman', masteryRequired: 400, optionKey: 'superhumanMastery' },
  { name: 'Death Step', masteryRequired: 400, optionKey: 'deathStepMastery' },
  { name: 'Sharkman Karate', masteryRequired: 400, optionKey: 'sharkmanKarateMastery' },
  { name: 'Electric Claw', masteryRequired: 400, optionKey: 'electricClawMastery' },
  { name: 'Dragon Talon', masteryRequired: 400, optionKey: 'dragonTalonMastery' }
];

// Sword prerequisites for CDK
const CDK_SWORD_PREREQS = [
  { name: 'Yama', masteryRequired: 350, hasKey: 'hasYama', masteryKey: 'yamaMastery' },
  { name: 'Tushita', masteryRequired: 350, hasKey: 'hasTushita', masteryKey: 'tushitaMastery' }
];

// Sword prerequisites for TTK
const TTK_SWORD_PREREQS = [
  { name: 'Wando', masteryRequired: 300, hasKey: 'hasWando', masteryKey: 'wandoMastery' },
  { name: 'Shisui', masteryRequired: 300, hasKey: 'hasShisui', masteryKey: 'shisuiMastery' },
  { name: 'Saddi', masteryRequired: 300, hasKey: 'hasSaddi', masteryKey: 'saddiMastery' }
];

/**
 * Detects which sea the player is in based on level.
 */
function detectSea(level) {
  if (level <= 700) return 'Sea 1 (First Sea)';
  if (level <= 1500) return 'Sea 2 (Second Sea)';
  return 'Sea 3 (Third Sea)';
}

/**
 * Calculates leveling price with sea-based pricing.
 * Sea 1 (1-700) has a cheaper rate than Sea 2/3 (700-2550).
 */
function calculateLevelingPrice(fromLevel, toLevel, sea1Rate, sea23Rate) {
  if (toLevel <= fromLevel) return { total: 0, breakdown: [] };

  const SEA_BOUNDARY = 700;
  const breakdown = [];
  let total = 0;

  if (fromLevel < SEA_BOUNDARY && toLevel <= SEA_BOUNDARY) {
    // Entirely within Sea 1
    const levels = toLevel - fromLevel;
    const cost = Math.ceil((levels / 100) * sea1Rate);
    total += cost;
    breakdown.push({ sea: 'Sea 1', from: fromLevel, to: toLevel, levels, cost });
  } else if (fromLevel >= SEA_BOUNDARY) {
    // Entirely within Sea 2/3
    const levels = toLevel - fromLevel;
    const cost = Math.ceil((levels / 100) * sea23Rate);
    total += cost;
    breakdown.push({ sea: 'Sea 2/3', from: fromLevel, to: toLevel, levels, cost });
  } else {
    // Crosses the Sea 1 → Sea 2 boundary
    const sea1Levels = SEA_BOUNDARY - fromLevel;
    const sea1Cost = Math.ceil((sea1Levels / 100) * sea1Rate);
    total += sea1Cost;
    breakdown.push({ sea: 'Sea 1', from: fromLevel, to: SEA_BOUNDARY, levels: sea1Levels, cost: sea1Cost });

    const sea23Levels = toLevel - SEA_BOUNDARY;
    const sea23Cost = Math.ceil((sea23Levels / 100) * sea23Rate);
    total += sea23Cost;
    breakdown.push({ sea: 'Sea 2/3', from: SEA_BOUNDARY, to: toLevel, levels: sea23Levels, cost: sea23Cost });
  }

  return { total, breakdown };
}

/**
 * Calculates accumulated V4 fragment costs for a gear range.
 */
function calculateV4Fragments(fromGear, toGear) {
  let totalFragments = 0;
  const breakdown = [];

  for (let gear = fromGear; gear < toGear; gear++) {
    const fragments = V4_FRAGMENT_COSTS[gear] ?? 0;
    totalFragments += fragments;
    breakdown.push({ upgrade: `Gear ${gear} → ${gear + 1}`, fragments });
  }

  return { totalFragments, breakdown };
}

/**
 * Calculates the joki cost for mastery grinding.
 */
function calculateMasteryCost(currentMastery, targetMastery, ratePer100) {
  if (currentMastery >= targetMastery) return 0;
  const missing = targetMastery - currentMastery;
  return Math.ceil((missing / 100) * ratePer100);
}

/**
 * Main jockey price calculator with Universal Thinking Logic.
 *
 * 3-step logic applied automatically:
 * 1. CHECK PREREQUISITES — detect if user meets base requirements
 * 2. ACCUMULATE RESOURCES — sum total costs from start to target
 * 3. AUTO-DETECT — apply logic to all Blox Fruits categories
 *
 * @param {number} currentLevel - Player's current level (1-2550)
 * @param {number|null} targetLevel - Target level for leveling orders
 * @param {string[]} selectedItemNames - List of item/service names from pricelist
 * @param {object} options - Additional context (mastery levels, owned items, V4 gear info, etc.)
 */
async function calculateJockeyPrice(currentLevel, targetLevel, selectedItemNames = [], options = {}) {
  // If user has pulled the lever, they must be at least level 1500 (Sea 3)
  if (options && options.hasPullLever === true) {
    if (currentLevel === undefined || currentLevel === null || currentLevel < 1500) {
      currentLevel = 1500;
    }
  }

  // --- Validations ---
  if (currentLevel !== undefined && currentLevel !== null) {
    if (isNaN(currentLevel) || currentLevel < 1 || currentLevel > 2550) {
      throw new Error("Gagal menghitung harga: Jika currentLevel diisi, harus angka valid antara 1-2550.");
    }
  }
  if (targetLevel && (isNaN(targetLevel) || targetLevel < 1 || targetLevel > 2550)) {
    throw new Error('invalid_target');
  }
  if (targetLevel && (currentLevel === undefined || currentLevel === null)) {
    throw new Error("Gagal menghitung harga: Joki Leveling membutuhkan 'currentLevel'. Silakan tanyakan ke user level mereka saat ini berapa.");
  }
  if (targetLevel && currentLevel && targetLevel < currentLevel) {
    throw new Error('target_lower');
  }

  // --- Load all price items from DB (or use provided cache) ---
  const allPriceItems = options.priceItems || await prisma.priceItem.findMany();

  const normalizeName = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const aliasMap = {
    godhuman: ['god human', 'godhuman', 'gh'],
    cdk: ['cursed dual katana', 'cdk'],
    ttk: ['true triple katana', 'ttk'],
    'soul guitar': ['soul guitar'],
    'sanguine art': ['sanguine art', 'sanguine'],
    'race v4 full gear': ['race v4 full gear', 'v4 full gear', 'full gear'],
    '1 race v4 gear': ['1 race v4 gear', '1 gear', 'v4 gear'],
    'pull lever race v4': ['pull lever race v4', 'pull lever', 'lever v4']
  };

  const findItem = (name) => {
    const query = normalizeName(name);
    if (!query) return null;

    const exact = allPriceItems.find(item => normalizeName(item.name) === query);
    if (exact) return exact;

    const aliases = aliasMap[query] || Object.entries(aliasMap)
      .find(([canonical, values]) => canonical === query || values.includes(query))?.[1] || [];

    for (const alias of aliases) {
      const aliasNorm = normalizeName(alias);
      const match = allPriceItems.find(item => {
        const itemNorm = normalizeName(item.name);
        return itemNorm === aliasNorm || itemNorm.includes(aliasNorm) || aliasNorm.includes(itemNorm);
      });
      if (match) return match;
    }

    return allPriceItems.find(item => {
      const itemNorm = normalizeName(item.name);
      return itemNorm.includes(query) || query.includes(itemNorm);
    }) || null;
  };

  // --- Look up pricing rates from DB ---
  const sea1Config = findItem('100 Level (Sea 1)');
  const sea23Config = findItem('100 Level (Sea 2/3)');
  const sea1Rate = sea1Config ? sea1Config.basePrice : 3000;
  const sea23Rate = sea23Config ? sea23Config.basePrice : 4000;

  const swordMasteryConfig = findItem('100 Mastery (Sword)');
  const swordMasteryRate = swordMasteryConfig ? swordMasteryConfig.basePrice : 3000;

  const fragOwnConfig = findItem('1000 Fragments');
  const fragWorkerConfig = findItem('1000 Fragments (Fruit Worker)');
  const fragOwnRate = fragOwnConfig ? fragOwnConfig.basePrice : 1000;
  const fragWorkerRate = fragWorkerConfig ? fragWorkerConfig.basePrice : 2000;

  // --- Result accumulators ---
  let totalPrice = 0;
  let effectiveLevel = currentLevel;
  const itemDetails = [];
  const prerequisites = [];
  const alerts = [];

  // --- Process each selected item ---
  for (const itemName of selectedItemNames) {
    const dbItem = findItem(itemName);

    if (!dbItem) {
      alerts.push({
        type: 'ITEM_NOT_FOUND',
        name: itemName,
        note: `Item "${itemName}" tidak ditemukan di database pricelist. Minta admin menambahkannya.`
      });
      continue;
    }

    const requirements = JSON.parse(dbItem.requirements || '[]');

    // Parse level requirement from requirements array (e.g. "Level 2200+")
    let levelReq = 0;
    for (const req of requirements) {
      const match = req.match(/Level\s+(\d+)\+/i);
      if (match) {
        levelReq = parseInt(match[1], 10);
        break;
      }
    }

    // ==============================================
    // RACE V4 LOGIC
    // ==============================================
    const isV4Item = itemName.toLowerCase().includes('v4');
    const hasV4GearInfo = options.v4CurrentGear !== undefined || options.v4TargetGear !== undefined;
    const isV4GearUpgrade = isV4Item &&
                            (itemName.toLowerCase().includes('gear') || itemName.toLowerCase().includes('trial') || hasV4GearInfo) &&
                            !itemName.toLowerCase().includes('latihan') &&
                            !itemName.toLowerCase().includes('train');

    if (isV4GearUpgrade) {
      let v4From = options.v4CurrentGear ?? 0;
      let v4To = options.v4TargetGear ?? 4;
      const fruitSource = options.v4FruitSource || 'sendiri';

      // Auto-detect targets based on item names if not explicitly specified
      if (itemName.toLowerCase().includes('full gear')) {
        v4To = 4;
      } else if (itemName.toLowerCase().includes('1 gear')) {
        v4To = Math.min(v4From + 1, 4);
      }

      // Enforce max gear 4 and valid range
      if (v4From > 4) v4From = 4;
      if (v4To > 4) v4To = 4;
      if (v4From < 0) v4From = 0;
      if (v4To < v4From) v4To = v4From;

      // Prerequisite: Pull Lever
      if (options.hasPullLever === false) {
        const pullLeverItem = findItem('Pull Lever (Race V4)');
        const plPrice = pullLeverItem ? pullLeverItem.basePrice : 10000;
        prerequisites.push({
          type: 'PULL_LEVER',
          name: 'Pull Lever (Race V4)',
          price: plPrice,
          note: 'Harus pull lever di Temple of Time dulu sebelum bisa mulai V4.'
        });
        totalPrice += plPrice;
      }

      // Calculate accumulated fragments across gear range
      const fragResult = calculateV4Fragments(v4From, v4To);
      const fragRate = fruitSource === 'worker' ? fragWorkerRate : fragOwnRate;
      const fragPurchaseCost = Math.ceil((fragResult.totalFragments / 1000) * fragRate);

      // For per-gear items (e.g. "Dapatkan 1 Gear"), multiply by number of gears
      const numGears = v4To - v4From;
      const isPerGearItem = itemName.toLowerCase().includes('1 gear');
      const itemTotal = isPerGearItem ? dbItem.basePrice * numGears : dbItem.basePrice;

      itemDetails.push({
        name: itemName,
        unitPrice: dbItem.basePrice,
        quantity: isPerGearItem ? numGears : 1,
        itemTotal,
        v4GearUpgrade: `Gear ${v4From} → Gear ${v4To}`,
        fragmentsNeeded: fragResult.totalFragments,
        fragmentBreakdown: fragResult.breakdown,
        fragmentPurchaseCost: fragPurchaseCost,
        fruitSource,
        note: fragResult.totalFragments > 0
          ? `Butuh ${fragResult.totalFragments.toLocaleString()} fragments (Rp ${fragPurchaseCost.toLocaleString()} jika beli dari kita, fruit ${fruitSource}).`
          : 'Tidak butuh fragment untuk upgrade ini.'
      });

      totalPrice += itemTotal;
      continue;
    }

    // ==============================================
    // GODHUMAN LOGIC
    // ==============================================
    if (itemName.toLowerCase().includes('godhuman')) {
      // Check level prerequisite (1500+)
      if (effectiveLevel === undefined || effectiveLevel < 1500) {
        if (effectiveLevel === undefined) throw new Error("Gagal menghitung harga: Godhuman butuh minimal level 1500. Silakan tanyakan ke user level mereka saat ini berapa.");
        
        const lvlResult = calculateLevelingPrice(effectiveLevel, 1500, sea1Rate, sea23Rate);
        prerequisites.push({
          type: 'LEVELING',
          name: 'Joki Level ke 1500 (syarat Godhuman)',
          from: effectiveLevel,
          to: 1500,
          price: lvlResult.total,
          breakdown: lvlResult.breakdown
        });
        totalPrice += lvlResult.total;
        effectiveLevel = 1500;
      }

      // Check fighting style masteries
      const masteryDetails = [];
      for (const prereq of GODHUMAN_STYLE_PREREQS) {
        const currentMastery = options[prereq.optionKey];
        if (currentMastery !== undefined && currentMastery !== null && currentMastery < prereq.masteryRequired) {
          const cost = calculateMasteryCost(currentMastery, prereq.masteryRequired, swordMasteryRate);
          masteryDetails.push({
            style: prereq.name,
            currentMastery,
            targetMastery: prereq.masteryRequired,
            missingMastery: prereq.masteryRequired - currentMastery,
            cost
          });
          totalPrice += cost;
        }
      }

      if (masteryDetails.length > 0) {
        prerequisites.push({
          type: 'MASTERY_GRIND',
          name: 'Mastery Fighting Style untuk Godhuman',
          details: masteryDetails,
          totalCost: masteryDetails.reduce((sum, d) => sum + d.cost, 0)
        });
      }

      itemDetails.push({
        name: itemName,
        unitPrice: dbItem.basePrice,
        quantity: 1,
        itemTotal: dbItem.basePrice,
        masteryPrereqs: masteryDetails,
        requirements
      });
      totalPrice += dbItem.basePrice;
      continue;
    }

    // ==============================================
    // CDK (CURSED DUAL KATANA) LOGIC
    // ==============================================
    if (itemName.toLowerCase().includes('cdk') || itemName.toLowerCase().includes('cursed dual katana')) {
      // Check level prerequisite (2200+)
      if (effectiveLevel === undefined || effectiveLevel < 2200) {
        if (effectiveLevel === undefined) throw new Error("Gagal menghitung harga: CDK butuh minimal level 2200. Silakan tanyakan ke user level mereka saat ini berapa.");
        
        const lvlResult = calculateLevelingPrice(effectiveLevel, 2200, sea1Rate, sea23Rate);
        prerequisites.push({
          type: 'LEVELING',
          name: 'Joki Level ke 2200 (syarat CDK)',
          from: effectiveLevel,
          to: 2200,
          price: lvlResult.total,
          breakdown: lvlResult.breakdown
        });
        totalPrice += lvlResult.total;
        effectiveLevel = 2200;
      }

      // Check sword prerequisites (Yama & Tushita)
      const swordDetails = [];
      for (const prereq of CDK_SWORD_PREREQS) {
        const hasWeapon = options[prereq.hasKey];
        const currentMastery = options[prereq.masteryKey];

        if (hasWeapon === false) {
          // Need to acquire weapon AND grind mastery from 0
          const weaponItem = findItem(prereq.name);
          const weaponPrice = weaponItem ? weaponItem.basePrice : 15000;
          const masteryCost = calculateMasteryCost(0, prereq.masteryRequired, swordMasteryRate);
          swordDetails.push({
            weapon: prereq.name,
            owned: false,
            acquirePrice: weaponPrice,
            currentMastery: 0,
            targetMastery: prereq.masteryRequired,
            masteryCost,
            totalCost: weaponPrice + masteryCost
          });
          totalPrice += weaponPrice + masteryCost;
        } else if (currentMastery !== undefined && currentMastery !== null && currentMastery < prereq.masteryRequired) {
          // Weapon owned but mastery too low
          const masteryCost = calculateMasteryCost(currentMastery, prereq.masteryRequired, swordMasteryRate);
          swordDetails.push({
            weapon: prereq.name,
            owned: true,
            acquirePrice: 0,
            currentMastery,
            targetMastery: prereq.masteryRequired,
            masteryCost,
            totalCost: masteryCost
          });
          totalPrice += masteryCost;
        }
      }

      if (swordDetails.length > 0) {
        prerequisites.push({
          type: 'WEAPON_MASTERY',
          name: 'Persiapan Pedang untuk CDK',
          details: swordDetails,
          totalCost: swordDetails.reduce((sum, d) => sum + d.totalCost, 0)
        });
      }

      itemDetails.push({
        name: itemName,
        unitPrice: dbItem.basePrice,
        quantity: 1,
        itemTotal: dbItem.basePrice,
        swordPrereqs: swordDetails,
        requirements
      });
      totalPrice += dbItem.basePrice;
      continue;
    }

    // ==============================================
    // TTK (TRUE TRIPLE KATANA) LOGIC
    // ==============================================
    if (itemName.toLowerCase().includes('ttk') || itemName.toLowerCase().includes('true triple katana')) {
      // Check level prerequisite (700+)
      if (effectiveLevel === undefined || effectiveLevel < 700) {
        if (effectiveLevel === undefined) throw new Error("Gagal menghitung harga: TTK butuh minimal level 700. Silakan tanyakan ke user level mereka saat ini berapa.");
        
        const lvlResult = calculateLevelingPrice(effectiveLevel, 700, sea1Rate, sea23Rate);
        prerequisites.push({
          type: 'LEVELING',
          name: 'Joki Level ke 700 (syarat TTK)',
          from: effectiveLevel,
          to: 700,
          price: lvlResult.total,
          breakdown: lvlResult.breakdown
        });
        totalPrice += lvlResult.total;
        effectiveLevel = 700;
      }

      // Check sword prerequisites (Wando, Shisui, Saddi)
      const swordDetails = [];
      for (const prereq of TTK_SWORD_PREREQS) {
        const hasWeapon = options[prereq.hasKey];
        const currentMastery = options[prereq.masteryKey];

        if (hasWeapon === false) {
          const legendaryItem = findItem('Legendary Sword (per pedang)');
          const weaponPrice = legendaryItem ? legendaryItem.basePrice : 8000;
          const masteryCost = calculateMasteryCost(0, prereq.masteryRequired, swordMasteryRate);
          swordDetails.push({
            weapon: prereq.name,
            owned: false,
            acquirePrice: weaponPrice,
            currentMastery: 0,
            targetMastery: prereq.masteryRequired,
            masteryCost,
            totalCost: weaponPrice + masteryCost
          });
          totalPrice += weaponPrice + masteryCost;
        } else if (currentMastery !== undefined && currentMastery !== null && currentMastery < prereq.masteryRequired) {
          const masteryCost = calculateMasteryCost(currentMastery, prereq.masteryRequired, swordMasteryRate);
          swordDetails.push({
            weapon: prereq.name,
            owned: true,
            acquirePrice: 0,
            currentMastery,
            targetMastery: prereq.masteryRequired,
            masteryCost,
            totalCost: masteryCost
          });
          totalPrice += masteryCost;
        }
      }

      if (swordDetails.length > 0) {
        prerequisites.push({
          type: 'WEAPON_MASTERY',
          name: 'Persiapan Pedang untuk TTK',
          details: swordDetails,
          totalCost: swordDetails.reduce((sum, d) => sum + d.totalCost, 0)
        });
      }

      itemDetails.push({
        name: itemName,
        unitPrice: dbItem.basePrice,
        quantity: 1,
        itemTotal: dbItem.basePrice,
        swordPrereqs: swordDetails,
        requirements
      });
      totalPrice += dbItem.basePrice;
      continue;
    }

    // ==============================================
    // SOUL GUITAR LOGIC
    // ==============================================
    if (itemName.toLowerCase().includes('soul guitar')) {
      // Check level prerequisite (2300+)
      if (effectiveLevel === undefined || effectiveLevel < 2300) {
        if (effectiveLevel === undefined) throw new Error("Gagal menghitung harga: Soul Guitar butuh minimal level 2300. Silakan tanyakan ke user level mereka saat ini berapa.");
        
        const lvlResult = calculateLevelingPrice(effectiveLevel, 2300, sea1Rate, sea23Rate);
        prerequisites.push({
          type: 'LEVELING',
          name: 'Joki Level ke 2300 (syarat Soul Guitar)',
          from: effectiveLevel,
          to: 2300,
          price: lvlResult.total,
          breakdown: lvlResult.breakdown
        });
        totalPrice += lvlResult.total;
        effectiveLevel = 2300;
      }

      // Choose variant based on materials ownership
      const hasMaterials = options.soulGuitarMaterialsProvided;
      let variant = dbItem;

      if (hasMaterials === true) {
        const withMatItem = findItem('Soul Guitar (Dengan Bahan)');
        if (withMatItem) variant = withMatItem;
      } else if (hasMaterials === false) {
        const noMatItem = findItem('Soul Guitar (Tanpa Bahan)');
        if (noMatItem) variant = noMatItem;
      }

      itemDetails.push({
        name: variant.name,
        unitPrice: variant.basePrice,
        quantity: 1,
        itemTotal: variant.basePrice,
        materialsProvided: hasMaterials,
        requirements: JSON.parse(variant.requirements || '[]')
      });
      totalPrice += variant.basePrice;
      continue;
    }

    // ==============================================
    // SANGUINE ART LOGIC
    // ==============================================
    if (itemName.toLowerCase().includes('sanguine')) {
      // Check level prerequisite (1500+)
      if (effectiveLevel === undefined || effectiveLevel < 1500) {
        if (effectiveLevel === undefined) throw new Error("Gagal menghitung harga: Sanguine Art butuh minimal level 1500. Silakan tanyakan ke user level mereka saat ini berapa.");
        
        const lvlResult = calculateLevelingPrice(effectiveLevel, 1500, sea1Rate, sea23Rate);
        prerequisites.push({
          type: 'LEVELING',
          name: 'Joki Level ke 1500 (syarat Sanguine Art)',
          from: effectiveLevel,
          to: 1500,
          price: lvlResult.total,
          breakdown: lvlResult.breakdown
        });
        totalPrice += lvlResult.total;
        effectiveLevel = 1500;
      }

      // Choose variant based on Leviathan Heart ownership
      const hasHeart = options.hasLeviathanHeart;
      let variant = dbItem;

      if (hasHeart === false) {
        const fullItem = findItem('Sanguine Art (dari awal)');
        if (fullItem) variant = fullItem;
      }

      itemDetails.push({
        name: variant.name,
        unitPrice: variant.basePrice,
        quantity: 1,
        itemTotal: variant.basePrice,
        hasLeviathanHeart: hasHeart,
        requirements: JSON.parse(variant.requirements || '[]')
      });
      totalPrice += variant.basePrice;
      continue;
    }

    // ==============================================
    // GENERIC ITEM LOGIC (FALLBACK)
    // Auto-add leveling if item requires a higher level
    // ==============================================
    if (levelReq > 0 && (effectiveLevel === undefined || effectiveLevel < levelReq)) {
      if (effectiveLevel === undefined) throw new Error(`Gagal menghitung harga: ${itemName} butuh minimal level ${levelReq}. Silakan tanyakan ke user level mereka saat ini berapa.`);
      
      const lvlResult = calculateLevelingPrice(effectiveLevel, levelReq, sea1Rate, sea23Rate);
      prerequisites.push({
        type: 'LEVELING',
        name: `Joki Level ke ${levelReq} (syarat ${itemName})`,
        from: effectiveLevel,
        to: levelReq,
        price: lvlResult.total,
        breakdown: lvlResult.breakdown
      });
      totalPrice += lvlResult.total;
      effectiveLevel = levelReq;
    }

    itemDetails.push({
      name: itemName,
      unitPrice: dbItem.basePrice,
      quantity: 1,
      itemTotal: dbItem.basePrice,
      requiredLevel: levelReq,
      requirements
    });
    totalPrice += dbItem.basePrice;
  }

  // --- Process explicit leveling request ---
  // Uses effectiveLevel to avoid double-counting prereq leveling
  let levelingResult = null;
  if (targetLevel && targetLevel > effectiveLevel) {
    levelingResult = calculateLevelingPrice(effectiveLevel, targetLevel, sea1Rate, sea23Rate);
    totalPrice += levelingResult.total;
    effectiveLevel = targetLevel;
  }

  // --- Return comprehensive result ---
  return {
    currentLevel,
    currentSea: detectSea(currentLevel),
    targetLevel: targetLevel || null,
    targetSea: targetLevel ? detectSea(targetLevel) : null,
    effectiveTargetLevel: effectiveLevel,
    leveling: levelingResult,
    items: itemDetails,
    prerequisites,
    alerts,
    totalPrice,
    pricingRates: {
      sea1Per100Levels: sea1Rate,
      sea23Per100Levels: sea23Rate,
      swordMasteryPer100: swordMasteryRate,
      fragmentOwnPer1k: fragOwnRate,
      fragmentWorkerPer1k: fragWorkerRate
    }
  };
}

module.exports = {
  calculateJockeyPrice
};

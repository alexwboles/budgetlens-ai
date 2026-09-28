/* BudgetLens categorization engine — works in browser AND node (no deps). */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.BudgetLens = Object.assign(root.BudgetLens || {}, factory());
})(typeof self !== "undefined" ? self : this, function () {

  var CATEGORIES = [
    { id: "income", name: "Income", icon: "💰", keywords: ["payroll", "salary", "direct dep", "paycheck", "employer", "wages", "bonus", "refund"] },
    { id: "housing", name: "Housing", icon: "🏠", keywords: ["rent", "mortgage", "landlord", "property mgmt", "hoa", "apartment", "lease"] },
    { id: "groceries", name: "Groceries", icon: "🛒", keywords: ["whole foods", "trader joe", "kroger", "safeway", "aldi", "publix", "wegmans", "food lion", "costco", "grocery", "supermarket", "market basket"] },
    { id: "dining", name: "Dining Out", icon: "🍽️", keywords: ["restaurant", "mcdonald", "starbucks", "chipotle", "pizza", "doordash", "ubereats", "grubhub", "cafe", "coffee", "burger", "taco", "sushi", "diner", "bistro", "bakery", "dunkin", "panera", "chick-fil-a", "subway", "kfc", "wendy", "eatery", "bar & grill"] },
    { id: "transport", name: "Transport", icon: "🚗", keywords: ["uber", "lyft", "shell", "exxon", "chevron", "bp ", " gas", "parking", "metro", "transit", "toll", "amtrak", "airlines", "hertz", "enterprise", "sunoco", "wawa"] },
    { id: "utilities", name: "Utilities", icon: "💡", keywords: ["electric", "con ed", "coned", "power", "water dept", "xfinity", "comcast", "verizon", "t-mobile", "spectrum", "internet", "phone bill", "at&t", "gas bill", "utility"] },
    { id: "subscriptions", name: "Subscriptions", icon: "🔁", keywords: ["netflix", "streamflix", "spotify", "hulu", "disney", "apple.com/bill", "icloud", "prime", "audible", "patreon", "youtube premium", "dropbox", "adobe", "membership", "subscription"] },
    { id: "entertainment", name: "Entertainment", icon: "🎬", keywords: ["cinema", "theater", "theatre", "amc", "concert", "ticketmaster", "steam", "nintendo", "xbox", "playstation", "bowling", "golf", "museum", "zoo"] },
    { id: "shopping", name: "Shopping", icon: "🛍️", keywords: ["amazon", "target", "best buy", "ikea", "home depot", "lowes", "macy", "nordstrom", "zara", "h&m", "ebay", "etsy", "walmart", "costco", "dollar"] },
    { id: "health", name: "Health", icon: "⚕️", keywords: ["cvs", "walgreens", "pharmacy", "dentist", "doctor", "hospital", "clinic", "urgent care", "copay", "vision", "lenscrafters", "rite aid"] },
    { id: "travel", name: "Travel", icon: "✈️", keywords: ["hotel", "marriott", "hilton", "airbnb", "expedia", "booking.com", "airline", "resort", "motel", "vrbo"] },
    { id: "fees", name: "Fees", icon: "⚠️", keywords: ["overdraft", "atm fee", "late fee", "annual fee", "service charge", "interest charge", "nsf fee", "penalty"] }
  ];

  function normalizeMerchant(desc) {
    var s = String(desc || "").toUpperCase();
    s = s.replace(/\d{3,}/g, " ");            // long numbers (phone, ref)
    s = s.replace(/[#*]/g, " ");
    s = s.replace(/\b(STORE|POS|DEBIT|CREDIT|PURCHASE|RECURRING|AUTOPAY)\b/g, " ");
    s = s.replace(/\s{2,}/g, " ").trim();
    s = s.replace(/[\s\-.,]+$/, "");              // trailing punctuation left by number stripping
    // keep first 2 meaningful tokens so "AMAZON MKTPLACE US" -> "AMAZON MKTPLACE"
    var parts = s.split(" ").filter(Boolean);
    return parts.slice(0, 2).join(" ");
  }

  function categorize(description) {
    var text = " " + String(description || "").toLowerCase() + " ";
    var best = null, bestHits = 0, bestLen = 0;
    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      var hits = 0, longest = 0;
      for (var j = 0; j < cat.keywords.length; j++) {
        var kw = cat.keywords[j];
        if (text.indexOf(kw) !== -1) { hits++; if (kw.length > longest) longest = kw.length; }
      }
      if (hits > bestHits || (hits === bestHits && longest > bestLen)) {
        best = cat; bestHits = hits; bestLen = longest;
      }
    }
    if (!best || bestHits === 0) {
      return { category: "other", name: "Other", icon: "📦", confidence: "low" };
    }
    var confidence = (bestHits >= 2 || bestLen >= 6) ? "high" : "medium";
    return { category: best.id, name: best.name, icon: best.icon, confidence: confidence };
  }

  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return { id: "other", name: "Other", icon: "📦" };
  }

  return {
    CATEGORIES: CATEGORIES,
    categorize: categorize,
    categoryById: categoryById,
    normalizeMerchant: normalizeMerchant
  };
});

"""Normalisation of free-text medication and diet entries in ShanghaiT2DM.

The vocabulary was built by inspecting every distinct entry in the dataset.
Diet "carbohydrate-dense grams" is a keyword heuristic, not a nutrient
calculation, and is documented as such.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# --- Insulin ----------------------------------------------------------------
# (pattern, category, fraction of units that act as prandial/fast insulin).
# Order matters: premixed names contain rapid-analogue names.
_INSULIN_RULES: list[tuple[str, str, float]] = [
    (r"aspart\s*70\s*/\s*30|novomix\s*30", "premixed", 0.30),
    (r"aspart\s*50\s*/\s*50|novomix\s*50", "premixed", 0.50),
    (r"humulin\s*70\s*/\s*30", "premixed", 0.30),
    (r"humalog\s*mix\s*25|lispro\s*25", "premixed", 0.25),
    (r"humalog\s*mix\s*50|lispro\s*50", "premixed", 0.50),
    (r"novolin\s*30\s*r|gansulin\s*30\s*r|scilin\s*m\s*30", "premixed", 0.30),
    (r"novolin\s*50\s*r|gansulin\s*50\s*r|scilin\s*m\s*50", "premixed", 0.50),
    (r"gansulin\s*40\s*r", "premixed", 0.40),
    (r"degludec|detemir|glargine|glarigine|\bnph\b|humulin\s*n|novolin\s*n", "basal", 0.0),
    (r"aspart|glulisine|lispro|humalog|novorapid|apidra", "rapid", 1.0),
    (r"novolin\s*r|gansulin\s*r|humulin\s*r|regular", "short", 1.0),
]


@dataclass(frozen=True)
class InsulinDose:
    name: str
    category: str
    units: float
    fast_units: float
    basal_units: float


def classify_insulin(name: str) -> tuple[str, float]:
    n = name.lower().replace("\xa0", " ")
    for pattern, category, fast in _INSULIN_RULES:
        if re.search(pattern, n):
            return category, fast
    return "unknown", 0.5


def parse_insulin(text: str) -> list[InsulinDose]:
    """Parse e.g. 'insulin glargine, 10 IU, Humulin 70/30, 12 IU'."""
    t = str(text).replace("\xa0", " ")
    doses: list[InsulinDose] = []
    pos = 0
    for m in re.finditer(r"([\d.]+)\s*IU", t, flags=re.IGNORECASE):
        name = t[pos : m.start()].strip(" ,;")
        pos = m.end()
        try:
            units = float(m.group(1))
        except ValueError:
            continue
        category, fast = classify_insulin(name)
        doses.append(InsulinDose(name, category, units, units * fast, units * (1 - fast)))
    return doses


# --- Non-insulin glucose-lowering agents ------------------------------------
ORAL_CLASSES: dict[str, tuple[str, ...]] = {
    "biguanide": ("metformin",),
    "agi": ("acarbose", "voglibose", "miglitol"),
    "sulfonylurea": ("gliclazide", "glimepiride", "glipizide", "glibenclamide", "glyburide", "gliquidone"),
    "glinide": ("repaglinide", "nateglinide", "mitiglinide"),
    "dpp4": ("sitagliptin", "saxagliptin", "linagliptin", "vildagliptin", "alogliptin"),
    "sglt2": ("dapagliflozin", "canagliflozin", "empagliflozin", "ertugliflozin", "henagliflozin"),
    "tzd": ("pioglitazone", "rosiglitazone"),
    "glp1": ("liraglutide", "dulaglutide", "semaglutide", "exenatide", "loxenatide", "lixisenatide", "beinaglutide"),
}
SECRETAGOGUES = ("sulfonylurea", "glinide")


def oral_classes(text: str) -> set[str]:
    t = str(text).lower()
    return {cls for cls, names in ORAL_CLASSES.items() if any(n in t for n in names)}


def regimen_flags(text: str) -> dict[str, int]:
    """Drug-class flags from the clinical summary's 'Hypoglycemic Agents'."""
    t = str(text).lower()
    flags = {f"rx_{cls}": int(cls in oral_classes(t)) for cls in ORAL_CLASSES}
    flags["rx_insulin"] = int(
        bool(re.search(r"insulin|novolin|humulin|gansulin|scilin|degludec|glargine|detemir|aspart|glulisine|lispro", t))
    )
    return flags


# --- Diet ---------------------------------------------------------------------
_CARB_KEYWORDS = (
    "rice", "grain", "bread", "bun", "noodle", "cereal", "porridge", "congee", "corn",
    "taro", "potato", "wonton", "dumpling", "biscuit", "cake", "pancake", "oat", "millet",
    "yam", "pumpkin", "buckwheat", "flour", "pasta", "toast", "cracker", "meal replacement",
    "apple", "orange", "pear", "peach", "banana", "grape", "watermelon", "kiwi", "fruit",
    "date", "mango", "lychee", "persimmon", "sugar", "honey", "juice", "lotus root",
)
_CARB_EXCLUDE = ("leaves", "leaf", "gluten", "pepper", "corn oil", "datum")


@dataclass(frozen=True)
class Meal:
    total_grams: float | None
    carb_dense_grams: float | None
    n_items: int
    described: bool


def parse_diet(text: str) -> Meal:
    t = str(text).strip()
    if not t or t.lower() == "data not available":
        return Meal(None, None, 0, False)
    total = 0.0
    carb = 0.0
    n_with_grams = 0
    items = [x.strip() for x in re.split(r"[\n;]+", t) if x.strip()]
    for item in items:
        m = re.match(r"^(.*?)\s*([\d.]+)\s*(g|ml)\b", item, flags=re.IGNORECASE)
        if not m:
            continue
        name = m.group(1).lower()
        try:
            grams = float(m.group(2))
        except ValueError:
            continue
        n_with_grams += 1
        total += grams
        if any(k in name for k in _CARB_KEYWORDS) and not any(x in name for x in _CARB_EXCLUDE):
            carb += grams
    if n_with_grams == 0:
        return Meal(None, None, len(items), True)
    return Meal(total, carb, len(items), True)

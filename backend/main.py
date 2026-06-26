"""
Wardrobe App Backend — FastAPI + Google Gemini (free tier)
Deploy on Render.com free tier (512MB RAM, spins down on idle)
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os, json, base64, re, random, hashlib, time
from datetime import datetime, timedelta
import httpx

app = FastAPI(title="Wardrobe AI API", version="1.0.0")

# Allow all origins (frontend is on GitHub Pages)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── GEMINI CONFIGURATION ──────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-1.5-flash"  # Free tier: 15 RPM, 1M tokens/day
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
)

# ─── CLOUDINARY CONFIGURATION ──────────────────────────────────────────────
# Set these in Render dashboard → Environment Variables
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY    = os.getenv("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET", "")

# ─── REQUEST MODELS ────────────────────────────────────────────────────────
class ImageAnalysisRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"

class WardrobeItem(BaseModel):
    id: str
    name: str
    category: str
    color: Optional[str] = None
    texture: Optional[str] = None
    occasions: Optional[List[str]] = []
    seasons: Optional[List[str]] = []
    wearCount: int = 0

class WearEntry(BaseModel):
    date: str
    itemIds: Optional[List[str]] = []

class RecommendRequest(BaseModel):
    items: List[WardrobeItem]
    wearHistory: Optional[List[WearEntry]] = []
    context: Optional[Dict[str, Any]] = {}

class CombinationRequest(BaseModel):
    item: WardrobeItem
    wardrobe: List[WardrobeItem]

class GapAnalysisRequest(BaseModel):
    items: List[WardrobeItem]
    wearHistory: Optional[List[WearEntry]] = []

# ─── HEALTH CHECK ──────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "ok", "service": "Wardrobe AI API"}

@app.get("/health")
async def health():
    return {"status": "healthy", "gemini_configured": bool(GEMINI_API_KEY)}

# ─── IMAGE ANALYSIS ────────────────────────────────────────────────────────
@app.post("/analyze-image")
async def analyze_image(req: ImageAnalysisRequest):
    """
    Analyze a clothing image using Gemini Vision.
    Extracts: category, colors (with hex), texture, occasions, seasons, style notes.
    Falls back gracefully if Gemini API is unavailable.
    """
    if not GEMINI_API_KEY:
        return _fallback_analysis()

    prompt = """Analyze this clothing item image. Respond ONLY with a valid JSON object.

{
  "category": "one of: top, bottom, footwear, outerwear, accessory, formal, ethnic, innerwear",
  "category_label": "human-readable label like 'Polo T-shirt' or 'Chinos'",
  "description": "concise name like 'White Oxford Shirt' or 'Navy Blue Slim Fit Trousers'",
  "primary_color": "primary color name",
  "colors": [
    {"name": "color name", "hex": "#RRGGBB", "percentage": 60}
  ],
  "texture": "fabric/material like Cotton, Polyester, Denim, Silk, Linen, Wool, Leather, Synthetic",
  "pattern": "Solid, Striped, Checked, Printed, Plain",
  "occasions": ["office", "casual", "formal", "party", "gym", "ethnic"],
  "seasons": ["all", "summer", "winter", "monsoon"],
  "fit": "Slim fit / Regular fit / Oversized / etc.",
  "style_notes": "One sentence style tip or combination suggestion."
}

Be concise. Return valid JSON only — no markdown, no explanation."""

    try:
        payload = {
            "contents": [{
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": req.mime_type,
                            "data": req.image_base64
                        }
                    },
                    {"text": prompt}
                ]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 500
            }
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(GEMINI_URL, json=payload)

        if res.status_code != 200:
            return _fallback_analysis()

        data = res.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        # Extract JSON from response
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if not json_match:
            return _fallback_analysis()

        result = json.loads(json_match.group())
        return result

    except Exception as e:
        print(f"Gemini analysis error: {e}")
        return _fallback_analysis()


def _fallback_analysis():
    return {
        "category": "",
        "category_label": "Unknown item",
        "description": "",
        "primary_color": "",
        "colors": [],
        "texture": "",
        "pattern": "Solid",
        "occasions": [],
        "seasons": ["all"],
        "fit": "",
        "style_notes": "Please fill in the details manually."
    }

# ─── RECOMMENDATION ENGINE ─────────────────────────────────────────────────
@app.post("/recommend")
async def recommend(req: RecommendRequest):
    """
    Generate outfit recommendations.
    Priority: AI (Gemini) → rule-based fallback
    """
    if not req.items:
        raise HTTPException(400, "No wardrobe items provided")

    if GEMINI_API_KEY and len(req.items) >= 2:
        try:
            return await _ai_recommend(req)
        except Exception as e:
            print(f"AI recommend failed, using fallback: {e}")

    return _rule_based_recommend(req)


async def _ai_recommend(req: RecommendRequest):
    recently_worn_ids = set()
    for entry in (req.wearHistory or [])[:7]:
        recently_worn_ids.update(entry.itemIds or [])

    season = req.context.get("season", "all") if req.context else "all"

    items_summary = []
    for item in req.items:
        items_summary.append({
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "color": item.color or "unknown",
            "texture": item.texture or "unknown",
            "occasions": item.occasions or [],
            "wearCount": item.wearCount,
            "recentlyWorn": item.id in recently_worn_ids
        })

    prompt = f"""You are a personal stylist. Create 3 office-appropriate outfit combinations for today ({season} season in India).

Available wardrobe items:
{json.dumps(items_summary, indent=2)}

Recently worn item IDs (avoid repeating): {list(recently_worn_ids)}

Return ONLY a JSON object:
{{
  "primary": {{
    "itemIds": ["id1", "id2", "id3"],
    "rationale": "one sentence why this works",
    "score": 0.9
  }},
  "alternatives": [
    {{
      "itemIds": ["id1", "id4"],
      "rationale": "brief reason",
      "score": 0.8
    }},
    {{
      "itemIds": ["id2", "id5"],
      "rationale": "brief reason",
      "score": 0.75
    }}
  ]
}}

Rules:
- Each outfit needs at minimum a top + bottom
- Prefer items not recently worn
- Consider color harmony (avoid clashing colors)
- Only use IDs from the provided items list
- Return valid JSON only"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 600}
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(GEMINI_URL, json=payload)

    data = res.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if not json_match:
        raise ValueError("No JSON in response")

    return json.loads(json_match.group())


def _rule_based_recommend(req: RecommendRequest):
    """Fallback rule-based outfit recommender."""
    items = req.items
    recently_worn = set()
    for entry in (req.wearHistory or [])[:5]:
        recently_worn.update(entry.itemIds or [])

    def score_item(item: WardrobeItem) -> float:
        s = 1.0
        if item.id in recently_worn:
            s *= 0.3
        if item.wearCount == 0:
            s *= 1.5
        elif item.wearCount < 3:
            s *= 1.2
        # Prefer office-appropriate
        if "office" in (item.occasions or []):
            s *= 1.3
        return s

    by_cat = {}
    for item in items:
        by_cat.setdefault(item.category, []).append(item)

    def pick_best(cat):
        pool = by_cat.get(cat, [])
        if not pool:
            return None
        return max(pool, key=score_item)

    def build_outfit(exclude_ids=set()):
        pool = [i for i in items if i.id not in exclude_ids]
        mini_cats = {}
        for i in pool:
            mini_cats.setdefault(i.category, []).append(i)

        outfit_ids = []
        top = max(mini_cats.get("top", []) or mini_cats.get("formal", []), key=score_item, default=None)
        bottom = max(mini_cats.get("bottom", []), key=score_item, default=None)
        shoe = max(mini_cats.get("footwear", []), key=score_item, default=None)

        if top: outfit_ids.append(top.id)
        if bottom: outfit_ids.append(bottom.id)
        if shoe: outfit_ids.append(shoe.id)

        if not outfit_ids:
            outfit_ids = [pool[0].id] if pool else []

        return outfit_ids

    primary_ids = build_outfit()
    alt1_ids = build_outfit(set(primary_ids[:1]))
    alt2_ids = build_outfit(set(primary_ids[:2]))

    return {
        "primary": {
            "itemIds": primary_ids,
            "rationale": "Selected based on wear frequency — fresher items prioritized.",
            "score": 0.85
        },
        "alternatives": [
            {"itemIds": alt1_ids, "rationale": "Alternative combination.", "score": 0.75},
            {"itemIds": alt2_ids, "rationale": "Another option for variety.", "score": 0.70}
        ]
    }

# ─── COMBINATIONS ──────────────────────────────────────────────────────────
@app.post("/combinations")
async def combinations(req: CombinationRequest):
    """Find items from the wardrobe that combine well with a given item."""
    if not req.wardrobe:
        return {"combinations": []}

    if GEMINI_API_KEY:
        try:
            return await _ai_combinations(req)
        except Exception as e:
            print(f"AI combinations failed: {e}")

    return _rule_combinations(req)


async def _ai_combinations(req: CombinationRequest):
    prompt = f"""As a stylist, find the best items from this wardrobe to pair with:
Item: {req.item.name} ({req.item.category}, {req.item.color}, occasions: {req.item.occasions})

Available items:
{json.dumps([{"id": i.id, "name": i.name, "category": i.category, "color": i.color, "occasions": i.occasions} for i in req.wardrobe], indent=2)}

Return ONLY JSON:
{{
  "combinations": [
    {{"id": "item_id", "reason": "brief styling reason"}},
    ...
  ]
}}

Return 4-6 best matches. Only include IDs from the list. JSON only."""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.5, "maxOutputTokens": 400}
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(GEMINI_URL, json=payload)
    data = res.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if not json_match:
        raise ValueError("No JSON")
    return json.loads(json_match.group())


def _rule_combinations(req: CombinationRequest):
    """Color harmony + category complementarity rules."""
    target_cat = req.item.category
    # What pairs with what
    complement = {
        "top": ["bottom", "footwear", "outerwear", "accessory"],
        "bottom": ["top", "footwear", "outerwear"],
        "footwear": ["top", "bottom"],
        "outerwear": ["top", "bottom"],
        "formal": ["bottom", "footwear"],
        "ethnic": ["accessory", "footwear"],
        "accessory": ["top", "bottom", "formal"]
    }
    good_cats = complement.get(target_cat, [])
    combos = [
        {"id": i.id, "reason": f"Pairs as {i.category}"}
        for i in req.wardrobe
        if i.category in good_cats
    ]
    return {"combinations": combos[:8]}

# ─── GAP ANALYSIS ──────────────────────────────────────────────────────────
@app.post("/gap-analysis")
async def gap_analysis(req: GapAnalysisRequest):
    """Identify wardrobe gaps and shopping recommendations."""
    if GEMINI_API_KEY and len(req.items) >= 3:
        try:
            return await _ai_gap_analysis(req)
        except Exception as e:
            print(f"AI gap analysis failed: {e}")

    return _rule_gap_analysis(req)


async def _ai_gap_analysis(req: GapAnalysisRequest):
    item_summary = []
    for i in req.items:
        item_summary.append({
            "category": i.category, "name": i.name,
            "color": i.color, "occasions": i.occasions,
            "seasons": i.seasons, "wearCount": i.wearCount
        })

    prompt = f"""As a wardrobe consultant, analyze this wardrobe for gaps and improvement areas.

Current wardrobe ({len(req.items)} items):
{json.dumps(item_summary, indent=2)}

Wear history entries: {len(req.wearHistory or [])} days tracked

Return ONLY a JSON object with wardrobe gap recommendations:
{{
  "gaps": [
    {{
      "icon": "emoji",
      "title": "Gap title",
      "reason": "Specific reason why this gap exists based on the actual wardrobe",
      "priority": "high|medium|low",
      "suggestion": "Specific item to buy"
    }}
  ]
}}

Give 3-6 specific, actionable gaps. Consider:
- Category imbalance (too many tops, no formal wear, etc.)
- Color gaps (all dark, no neutrals, etc.)
- Occasion coverage (no gym wear, no formal, etc.)
- Versatility (items that work for multiple occasions)
- Indian context (ethnic wear, seasonal needs)

JSON only, no markdown."""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.6, "maxOutputTokens": 700}
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(GEMINI_URL, json=payload)
    data = res.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if not json_match:
        raise ValueError("No JSON")
    return json.loads(json_match.group())


def _rule_gap_analysis(req: GapAnalysisRequest):
    cats = {}
    colors = set()
    occasions = set()
    never_worn = 0

    for i in req.items:
        cats[i.category] = cats.get(i.category, 0) + 1
        if i.color:
            colors.add(i.color.lower())
        for occ in (i.occasions or []):
            occasions.add(occ)
        if i.wearCount == 0:
            never_worn += 1

    gaps = []

    ideal = {"top": 7, "bottom": 5, "footwear": 3, "outerwear": 2}
    emoji_map = {"top": "👕", "bottom": "👖", "footwear": "👟", "outerwear": "🧥"}
    for cat, min_count in ideal.items():
        have = cats.get(cat, 0)
        if have < min_count:
            gaps.append({
                "icon": emoji_map[cat],
                "title": f"Need more {cat}s",
                "reason": f"You have {have}, recommended minimum is {min_count}.",
                "priority": "high" if have < min_count // 2 else "medium",
                "suggestion": f"Buy {min_count - have} more {cat}(s)"
            })

    if "formal" not in cats and "formal" not in occasions:
        gaps.append({
            "icon": "👔", "title": "No formal wear",
            "reason": "No formal items found. A formal shirt + trousers covers office and events.",
            "priority": "medium", "suggestion": "Add a formal shirt and trousers"
        })
    if "ethnic" not in cats:
        gaps.append({
            "icon": "🥻", "title": "No ethnic wear",
            "reason": "No ethnic wear for occasions like festivals and weddings.",
            "priority": "low", "suggestion": "Add at least one ethnic outfit"
        })
    if never_worn > len(req.items) * 0.4:
        gaps.append({
            "icon": "💤", "title": f"{never_worn} unworn items",
            "reason": "A significant portion of your wardrobe has never been worn.",
            "priority": "medium",
            "suggestion": "Wear existing items before buying new ones"
        })

    return {"gaps": gaps[:6]}

# ─── CLOUDINARY DELETE ─────────────────────────────────────────────────────
class DeleteImageRequest(BaseModel):
    public_id: str

@app.post("/delete-image")
async def delete_image(req: DeleteImageRequest):
    """
    Delete an image from Cloudinary using a signed request.
    The API secret lives only on the backend — never exposed to the browser.
    """
    if not all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
        # Cloudinary not configured — silently succeed (image stays but user sees no error)
        return {"deleted": False, "reason": "Cloudinary not configured"}

    timestamp = int(time.time())
    # Build the signature: SHA1 of "public_id=...&timestamp=...{api_secret}"
    sig_payload = f"public_id={req.public_id}&timestamp={timestamp}{CLOUDINARY_API_SECRET}"
    signature = hashlib.sha1(sig_payload.encode()).hexdigest()

    form = {
        "public_id": req.public_id,
        "timestamp": str(timestamp),
        "api_key": CLOUDINARY_API_KEY,
        "signature": signature,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/image/destroy",
                data=form
            )
        data = res.json()
        return {"deleted": data.get("result") == "ok"}
    except Exception as e:
        # Non-fatal — item is removed from Firestore regardless
        print(f"Cloudinary delete error: {e}")
        return {"deleted": False}

// ─── WARDROBE APP — MAIN APPLICATION LOGIC ───────────────────────────────
import {
  auth, db, googleProvider,
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET
} from "./firebase-config.js";

import {
  signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── CLOUDINARY UPLOAD ─────────────────────────────────────────────────────
// No SDK needed — Cloudinary has a simple unsigned upload REST API.
// Photos go directly from the browser to Cloudinary; we only store the URL in Firestore.
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "wardrobe");

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );
  if (!res.ok) throw new Error("Cloudinary upload failed: " + res.status);
  const data = await res.json();
  // Return both the CDN URL and the public_id (needed to delete later)
  return { url: data.secure_url, publicId: data.public_id };
}

async function deleteFromCloudinary(publicId) {
  // Deletion from the browser requires a signed request, so we route it
  // through the Render backend which holds the API secret.
  if (!publicId) return;
  try {
    await fetch(`${API_URL}/delete-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_id: publicId })
    });
  } catch (e) {
    console.warn("Cloudinary delete failed (image may remain):", e);
  }
}

// ─── BACKEND API URL ───────────────────────────────────────────────────────
// Set this to your Render backend URL after deploying
const API_URL = "https://wardrobe-api-6h2a.onrender.com";

// ─── APP STATE ─────────────────────────────────────────────────────────────
let currentUser = null;
let wardrobeItems = [];
let savedOutfits = [];
let wearLog = [];
let selectedPhotoFile = null;
let selectedPhotoBase64 = null;
let currentFilterCat = "all";
let logSelectedItems = new Set();
let currentItemForDetail = null;

// ─── DOM HELPERS ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const showToast = (msg, dur = 2500) => {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), dur);
};
const showLoading = (msg = "Loading...") => {
  $("loading-text").textContent = msg;
  $("loading").style.display = "flex";
};
const hideLoading = () => { $("loading").style.display = "none"; };
const showModal = id => { $(id).style.display = "flex"; };
const hideModal = id => { $(id).style.display = "none"; };

// ─── AUTH ──────────────────────────────────────────────────────────────────
$("google-signin-btn").addEventListener("click", async () => {
  try {
    showLoading("Signing in...");
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    hideLoading();
    showToast("Sign-in failed: " + e.message);
  }
});

onAuthStateChanged(auth, user => {
  hideLoading();
  if (user) {
    currentUser = user;
    $("auth-screen").classList.remove("active");
    $("app-screen").classList.add("active");

    // Set avatar
    if (user.photoURL) {
      $("user-avatar").src = user.photoURL;
    }
    const initials = (user.displayName || user.email || "U")
      .split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    $("user-initials").textContent = initials;
    $("user-initials").style.display = "flex";

    loadAll();
  } else {
    currentUser = null;
    $("app-screen").classList.remove("active");
    $("auth-screen").classList.add("active");
  }
});

$("user-menu-btn").addEventListener("click", async () => {
  if (confirm("Sign out?")) {
    await signOut(auth);
  }
});

// ─── NAVIGATION ────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
    $(`tab-${tab}`).classList.add("active");
    if (tab === "home") renderSuggestions();
    if (tab === "log") renderLog();
    if (tab === "gaps") renderGaps();
  });
});

// ─── LOAD ALL DATA ─────────────────────────────────────────────────────────
async function loadAll() {
  if (!currentUser) return;
  const uid = currentUser.uid;

  // Live listener for wardrobe items
  onSnapshot(
    query(collection(db, "users", uid, "items"), orderBy("createdAt", "desc")),
    snap => {
      wardrobeItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderWardrobeGrid();
      renderStats();
      renderSuggestions();
    }
  );

  // Live listener for outfits
  onSnapshot(
    query(collection(db, "users", uid, "outfits"), orderBy("createdAt", "desc")),
    snap => {
      savedOutfits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderOutfits();
    }
  );

  // Live listener for wear log
  onSnapshot(
    query(collection(db, "users", uid, "wearlog"), orderBy("date", "desc")),
    snap => {
      wearLog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderLog();
    }
  );

  $("today-date").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long"
  });
}

// ─── WARDROBE GRID ─────────────────────────────────────────────────────────
function renderWardrobeGrid(filter = currentFilterCat) {
  const grid = $("wardrobe-grid");
  const items = filter === "all"
    ? wardrobeItems
    : wardrobeItems.filter(i => i.category === filter);

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span>👗</span>
        <p>${filter === "all" ? "Your wardrobe is empty" : "No " + filter + " items yet"}</p>
        ${filter === "all" ? '<button class="btn-primary" id="add-first-item">Add your first item</button>' : ""}
      </div>`;
    $("add-first-item")?.addEventListener("click", () => showModal("add-item-modal"));
    return;
  }

  grid.innerHTML = items.map(item => `
    <div class="clothing-card" data-id="${item.id}">
      ${item.photoUrl
        ? `<img src="${item.photoUrl}" alt="${item.name}" loading="lazy">`
        : `<div class="card-emoji">${getCategoryEmoji(item.category)}</div>`}
      <div class="card-label">${item.name}</div>
      ${item.primaryColor ? `<span class="color-dot" style="background:${item.colorHex || '#888'}"></span>` : ""}
    </div>`).join("");

  grid.querySelectorAll(".clothing-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = wardrobeItems.find(i => i.id === card.dataset.id);
      if (item) showItemDetail(item);
    });
  });
}

// Filter chips
document.querySelectorAll(".filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentFilterCat = chip.dataset.cat;
    renderWardrobeGrid(currentFilterCat);
  });
});

// ─── STATS ─────────────────────────────────────────────────────────────────
function renderStats() {
  $("stat-items").textContent = wardrobeItems.length;
  $("stat-outfits").textContent = savedOutfits.length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLog = wearLog.find(l => l.date === todayStr);
  $("stat-worn").textContent = todayLog ? (todayLog.items?.length || 0) : 0;
}

// ─── SUGGESTIONS (HOME TAB) ────────────────────────────────────────────────
async function renderSuggestions() {
  if (wardrobeItems.length < 2) {
    $("today-outfit").innerHTML = `
      <div class="outfit-placeholder">
        <span>✨</span>
        <p>Add at least 2 clothing items to get outfit suggestions</p>
      </div>`;
    $("alt-outfits").innerHTML = "";
    return;
  }

  try {
    const payload = {
      items: wardrobeItems.map(i => ({
        id: i.id, name: i.name, category: i.category,
        color: i.primaryColor, texture: i.texture,
        occasions: i.occasions, seasons: i.seasons,
        wearCount: i.wearCount || 0
      })),
      wearHistory: wearLog.slice(0, 14).map(l => ({ date: l.date, itemIds: l.items })),
      context: { date: new Date().toISOString(), season: getCurrentSeason() }
    };

    const res = await fetch(`${API_URL}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    renderHeroOutfit(data.primary);
    renderAltOutfits(data.alternatives || []);
  } catch {
    // Fallback: local rule-based suggestion
    const suggestion = localSuggestOutfit();
    renderHeroOutfit(suggestion);
    renderAltOutfits([]);
  }
  renderStats();
}

function renderHeroOutfit(outfit) {
  if (!outfit || !outfit.itemIds?.length) return;
  const items = outfit.itemIds.map(id => wardrobeItems.find(i => i.id === id)).filter(Boolean);
  if (!items.length) return;

  $("today-outfit").innerHTML = `
    <div class="outfit-hero-built">
      <div class="outfit-hero-items">
        ${items.map(item => `
          <div class="outfit-hero-item">
            ${item.photoUrl
              ? `<img src="${item.photoUrl}" alt="${item.name}">`
              : `<div class="hero-emoji">${getCategoryEmoji(item.category)}</div>`}
            <p>${item.name}</p>
          </div>`).join("")}
      </div>
      ${outfit.rationale ? `<p class="outfit-rationale">✨ ${outfit.rationale}</p>` : ""}
      <div class="outfit-hero-actions">
        <button class="btn-secondary" id="hero-log-btn">📅 Log this</button>
        <button class="btn-primary" id="hero-save-btn">♥ Save</button>
      </div>
    </div>`;

  $("hero-log-btn")?.addEventListener("click", () => logOutfitDirectly(outfit.itemIds));
  $("hero-save-btn")?.addEventListener("click", () => saveOutfit(outfit.itemIds, outfit.rationale));
}

function renderAltOutfits(alts) {
  if (!alts.length) {
    $("alt-outfits").innerHTML = "";
    return;
  }
  $("alt-outfits").innerHTML = alts.slice(0, 4).map(outfit => {
    const items = (outfit.itemIds || []).map(id => wardrobeItems.find(i => i.id === id)).filter(Boolean);
    return `
      <div class="outfit-card">
        <div class="outfit-items-row">
          ${items.slice(0, 3).map(item =>
            item.photoUrl
              ? `<img class="outfit-item-thumb" src="${item.photoUrl}" alt="${item.name}">`
              : `<div class="outfit-item-placeholder">${getCategoryEmoji(item.category)}</div>`
          ).join("")}
        </div>
        <div class="outfit-meta">
          <span class="outfit-meta-text">${items.map(i => i.name).join(" + ")}</span>
          ${outfit.score ? `<span class="outfit-score">${Math.round(outfit.score * 100)}%</span>` : ""}
        </div>
      </div>`;
  }).join("");
}

$("refresh-suggest-btn").addEventListener("click", () => {
  showToast("Finding new outfits...");
  renderSuggestions();
});

// ─── LOCAL FALLBACK SUGGESTION LOGIC ──────────────────────────────────────
function localSuggestOutfit() {
  const tops = wardrobeItems.filter(i => i.category === "top");
  const bottoms = wardrobeItems.filter(i => i.category === "bottom");
  const footwear = wardrobeItems.filter(i => i.category === "footwear");
  const todayStr = new Date().toISOString().slice(0, 10);
  const recentIds = new Set(
    wearLog.slice(0, 3).flatMap(l => l.items || [])
  );

  // Prefer least-worn items not worn recently
  const pickLeastWorn = arr => {
    const notRecent = arr.filter(i => !recentIds.has(i.id));
    const pool = notRecent.length ? notRecent : arr;
    return pool.sort((a, b) => (a.wearCount || 0) - (b.wearCount || 0))[0];
  };

  const selectedIds = [];
  const top = pickLeastWorn(tops);
  const bottom = pickLeastWorn(bottoms);
  const shoe = pickLeastWorn(footwear);
  if (top) selectedIds.push(top.id);
  if (bottom) selectedIds.push(bottom.id);
  if (shoe) selectedIds.push(shoe.id);
  if (!selectedIds.length && wardrobeItems.length) {
    selectedIds.push(...wardrobeItems.slice(0, 2).map(i => i.id));
  }

  return {
    itemIds: selectedIds,
    rationale: "Balanced pick based on wear frequency — items you haven't worn recently."
  };
}

// ─── ADD ITEM MODAL ────────────────────────────────────────────────────────
$("add-item-btn").addEventListener("click", () => {
  resetAddModal();
  showModal("add-item-modal");
});
$("add-first-item")?.addEventListener("click", () => {
  resetAddModal();
  showModal("add-item-modal");
});

function resetAddModal() {
  selectedPhotoFile = null;
  selectedPhotoBase64 = null;
  $("photo-preview").style.display = "none";
  $("photo-placeholder").style.display = "flex";
  $("ai-analysis").style.display = "none";
  $("item-category").value = "";
  $("item-name").value = "";
  $("item-color").value = "";
  $("item-brand").value = "";
  document.querySelectorAll("#occasion-chips .chip-toggle, #season-chips .chip-toggle")
    .forEach(c => c.classList.remove("selected"));
}

// Photo capture
$("take-photo-btn").addEventListener("click", () => {
  $("photo-input").setAttribute("capture", "environment");
  $("photo-input").click();
});
$("upload-photo-btn").addEventListener("click", () => {
  $("photo-input").removeAttribute("capture");
  $("photo-input").click();
});
$("retake-btn").addEventListener("click", () => {
  selectedPhotoFile = null; selectedPhotoBase64 = null;
  $("photo-preview").style.display = "none";
  $("photo-placeholder").style.display = "flex";
  $("ai-analysis").style.display = "none";
});

$("photo-input").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  selectedPhotoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    selectedPhotoBase64 = ev.target.result.split(",")[1];
    $("preview-img").src = ev.target.result;
    $("photo-preview").style.display = "block";
    $("photo-placeholder").style.display = "none";
  };
  reader.readAsDataURL(file);
});

// Chip toggles
document.querySelectorAll(".chip-toggle").forEach(chip => {
  chip.addEventListener("click", () => chip.classList.toggle("selected"));
});

// ─── AI ANALYZE ────────────────────────────────────────────────────────────
$("analyze-btn").addEventListener("click", async () => {
  if (!selectedPhotoBase64) {
    showToast("Please take or upload a photo first");
    return;
  }
  showLoading("Analyzing your clothing with AI...");
  try {
    const res = await fetch(`${API_URL}/analyze-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: selectedPhotoBase64 })
    });
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    displayAnalysis(data);

    // Auto-fill fields if empty
    if (!$("item-category").value && data.category) {
      $("item-category").value = data.category;
    }
    if (!$("item-name").value && data.description) {
      $("item-name").value = data.description;
    }
    if (data.primary_color) {
      $("item-color").value = data.primary_color;
    }
  } catch (e) {
    showToast("AI analysis failed. You can still fill in details manually.");
    console.error(e);
  } finally {
    hideLoading();
  }
});

function displayAnalysis(data) {
  $("ai-analysis").style.display = "block";
  const swatches = (data.colors || []).map(c =>
    `<span class="color-swatch">
      <span class="color-swatch-dot" style="background:${c.hex}"></span>${c.name}
    </span>`
  ).join(", ");

  $("analysis-content").innerHTML = `
    <div class="analysis-item">
      <div class="analysis-label">Category</div>
      <div class="analysis-value">${data.category_label || "—"}</div>
    </div>
    <div class="analysis-item">
      <div class="analysis-label">Fabric / Texture</div>
      <div class="analysis-value">${data.texture || "—"}</div>
    </div>
    <div class="analysis-item" style="grid-column:1/-1">
      <div class="analysis-label">Colors Detected</div>
      <div class="analysis-value">${swatches || "—"}</div>
    </div>
    <div class="analysis-item">
      <div class="analysis-label">Best For</div>
      <div class="analysis-value">${(data.occasions || []).join(", ") || "—"}</div>
    </div>
    <div class="analysis-item">
      <div class="analysis-label">Season</div>
      <div class="analysis-value">${(data.seasons || []).join(", ") || "—"}</div>
    </div>
    ${data.style_notes ? `
    <div class="analysis-item" style="grid-column:1/-1">
      <div class="analysis-label">Style Notes</div>
      <div class="analysis-value">${data.style_notes}</div>
    </div>` : ""}
  `;

  // Store for saving
  $("analyze-btn").dataset.analysisJson = JSON.stringify(data);
}

// ─── SAVE ITEM ─────────────────────────────────────────────────────────────
$("save-item-btn").addEventListener("click", async () => {
  const name = $("item-name").value.trim();
  const category = $("item-category").value;
  if (!name) { showToast("Please enter a name"); return; }
  if (!category) { showToast("Please select a category"); return; }

  showLoading("Saving item...");
  try {
    let photoUrl = null;
    let photoPublicId = null;   // Cloudinary public_id, used if user deletes the item

    if (selectedPhotoFile) {
      showLoading("Uploading photo to Cloudinary...");
      const uploaded = await uploadToCloudinary(selectedPhotoFile);
      photoUrl = uploaded.url;
      photoPublicId = uploaded.publicId;
    }

    const analysisStr = $("analyze-btn").dataset.analysisJson;
    const analysis = analysisStr ? JSON.parse(analysisStr) : {};

    const occasions = [...document.querySelectorAll("#occasion-chips .chip-toggle.selected")]
      .map(c => c.dataset.val);
    const seasons = [...document.querySelectorAll("#season-chips .chip-toggle.selected")]
      .map(c => c.dataset.val);

    const itemData = {
      name,
      category,
      primaryColor: $("item-color").value.trim() || analysis.primary_color || "",
      colorHex: analysis.colors?.[0]?.hex || "",
      colors: analysis.colors || [],
      texture: analysis.texture || "",
      brand: $("item-brand").value.trim(),
      occasions: occasions.length ? occasions : (analysis.occasions || []),
      seasons: seasons.length ? seasons : (analysis.seasons || []),
      styleNotes: analysis.style_notes || "",
      photoUrl,
      photoPublicId,          // stored so we can delete from Cloudinary later
      wearCount: 0,
      lastWorn: null,
      createdAt: serverTimestamp()
    };

    await addDoc(
      collection(db, "users", currentUser.uid, "items"),
      itemData
    );

    hideModal("add-item-modal");
    resetAddModal();
    showToast("Item added! 👗");
  } catch (e) {
    showToast("Failed to save: " + e.message);
    console.error(e);
  } finally {
    hideLoading();
  }
});

// Close modal buttons
document.querySelectorAll(".close-modal-btn").forEach(btn => {
  btn.addEventListener("click", () => hideModal(btn.dataset.modal));
});
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) hideModal(overlay.id);
  });
});

// ─── ITEM DETAIL ────────────────────────────────────────────────────────────
function showItemDetail(item) {
  currentItemForDetail = item;
  $("detail-title").textContent = item.name;

  const wearCountText = item.wearCount
    ? `Worn ${item.wearCount} time${item.wearCount !== 1 ? "s" : ""}${item.lastWorn ? " · Last: " + formatDate(item.lastWorn) : ""}`
    : "Never worn";

  $("item-detail-body").innerHTML = `
    <div class="detail-img-wrap">
      ${item.photoUrl
        ? `<img src="${item.photoUrl}" alt="${item.name}">`
        : `<div class="big-emoji">${getCategoryEmoji(item.category)}</div>`}
    </div>
    <div class="wear-count-badge">📅 ${wearCountText}</div>
    <div class="detail-props">
      <div class="detail-prop">
        <div class="detail-prop-label">Category</div>
        <div class="detail-prop-value">${item.category || "—"}</div>
      </div>
      <div class="detail-prop">
        <div class="detail-prop-label">Color</div>
        <div class="detail-prop-value">
          ${item.colorHex ? `<span class="color-swatch-dot" style="background:${item.colorHex};width:14px;height:14px;display:inline-block;border-radius:50%;vertical-align:-2px;margin-right:4px"></span>` : ""}
          ${item.primaryColor || "—"}
        </div>
      </div>
      ${item.texture ? `<div class="detail-prop">
        <div class="detail-prop-label">Texture</div>
        <div class="detail-prop-value">${item.texture}</div>
      </div>` : ""}
      ${item.brand ? `<div class="detail-prop">
        <div class="detail-prop-label">Brand</div>
        <div class="detail-prop-value">${item.brand}</div>
      </div>` : ""}
    </div>
    ${item.occasions?.length ? `
    <div class="detail-tags">
      ${item.occasions.map(o => `<span class="detail-tag">🏢 ${o}</span>`).join("")}
      ${(item.seasons || []).map(s => `<span class="detail-tag">🌤 ${s}</span>`).join("")}
    </div>` : ""}
    ${item.styleNotes ? `<p style="font-size:13px;color:var(--text2);margin-top:10px;line-height:1.5">${item.styleNotes}</p>` : ""}
    <div class="combo-section" id="combo-section-loading">
      <h4>Goes well with...</h4>
      <div class="combo-row">
        <p style="font-size:13px;color:var(--text3)">Loading combinations...</p>
      </div>
    </div>`;

  showModal("item-detail-modal");
  loadCombinations(item);
}

async function loadCombinations(item) {
  try {
    const payload = {
      item: {
        id: item.id, name: item.name, category: item.category,
        color: item.primaryColor, texture: item.texture,
        occasions: item.occasions
      },
      wardrobe: wardrobeItems
        .filter(i => i.id !== item.id)
        .map(i => ({
          id: i.id, name: i.name, category: i.category,
          color: i.primaryColor, texture: i.texture,
          occasions: i.occasions
        }))
    };

    const res = await fetch(`${API_URL}/combinations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error();
    const data = await res.json();
    renderCombinations(data.combinations || []);
  } catch {
    // Fallback: suggest items of complementary categories
    const comboItems = wardrobeItems
      .filter(i => i.id !== item.id && i.category !== item.category)
      .slice(0, 6);
    renderCombinations(comboItems.map(i => ({ id: i.id, reason: i.category })));
  }
}

function renderCombinations(combos) {
  const section = $("combo-section-loading");
  if (!section) return;
  if (!combos.length) {
    section.querySelector(".combo-row").innerHTML =
      `<p style="font-size:13px;color:var(--text3)">Add more items to see combinations.</p>`;
    return;
  }
  const row = combos.slice(0, 8).map(c => {
    const i = wardrobeItems.find(w => w.id === c.id);
    if (!i) return "";
    return `
      <div class="combo-card" data-id="${i.id}">
        ${i.photoUrl
          ? `<img src="${i.photoUrl}" alt="${i.name}">`
          : `<div class="combo-emoji">${getCategoryEmoji(i.category)}</div>`}
        <span>${i.name}</span>
      </div>`;
  }).join("");
  section.querySelector(".combo-row").innerHTML = row;
}

$("delete-item-btn").addEventListener("click", async () => {
  if (!currentItemForDetail || !confirm("Delete this item?")) return;
  showLoading("Deleting...");
  try {
    // Delete photo from Cloudinary (via backend, which holds the API secret)
    if (currentItemForDetail.photoPublicId) {
      await deleteFromCloudinary(currentItemForDetail.photoPublicId);
    }
    await deleteDoc(doc(db, "users", currentUser.uid, "items", currentItemForDetail.id));
    hideModal("item-detail-modal");
    showToast("Item deleted");
  } catch (e) {
    showToast("Error: " + e.message);
  } finally {
    hideLoading();
  }
});

$("find-combo-btn").addEventListener("click", () => {
  if (!currentItemForDetail) return;
  showToast("Finding outfit combos...");
  renderSuggestions();
  hideModal("item-detail-modal");
  document.querySelector('.nav-btn[data-tab="home"]').click();
});

// ─── SAVE / LOG OUTFIT ─────────────────────────────────────────────────────
async function saveOutfit(itemIds, rationale = "") {
  if (!currentUser || !itemIds?.length) return;
  try {
    await addDoc(collection(db, "users", currentUser.uid, "outfits"), {
      itemIds,
      rationale,
      createdAt: serverTimestamp()
    });
    showToast("Outfit saved! ♥");
  } catch (e) {
    showToast("Failed to save outfit");
  }
}

async function logOutfitDirectly(itemIds) {
  if (!currentUser || !itemIds?.length) return;
  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    await addDoc(collection(db, "users", currentUser.uid, "wearlog"), {
      date: todayStr,
      items: itemIds,
      loggedAt: serverTimestamp()
    });
    // Update wear counts
    for (const id of itemIds) {
      const item = wardrobeItems.find(i => i.id === id);
      if (item) {
        await updateDoc(doc(db, "users", currentUser.uid, "items", id), {
          wearCount: (item.wearCount || 0) + 1,
          lastWorn: todayStr
        });
      }
    }
    showToast("Outfit logged for today! 📅");
  } catch (e) {
    showToast("Failed to log outfit");
  }
}

// ─── OUTFITS TAB ────────────────────────────────────────────────────────────
function renderOutfits() {
  const list = $("outfits-list");
  if (!savedOutfits.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span>👔</span>
        <p>No outfits saved yet</p>
        <p class="empty-hint">Get a suggestion on the Home tab and save it!</p>
      </div>`;
    return;
  }
  list.innerHTML = savedOutfits.map(outfit => {
    const items = (outfit.itemIds || []).map(id => wardrobeItems.find(i => i.id === id)).filter(Boolean);
    return `
      <div class="saved-outfit-card">
        <div class="saved-outfit-header">
          <span class="saved-outfit-name">${items.map(i => i.name).join(" + ")}</span>
          <span class="saved-outfit-date">${formatDate(outfit.createdAt)}</span>
        </div>
        <div class="outfit-items-row">
          ${items.map(item =>
            item.photoUrl
              ? `<img class="outfit-item-thumb" src="${item.photoUrl}" alt="${item.name}">`
              : `<div class="outfit-item-placeholder">${getCategoryEmoji(item.category)}</div>`
          ).join("")}
        </div>
        ${outfit.rationale ? `<p style="font-size:12px;color:var(--text2);padding:0 12px 10px;line-height:1.4">${outfit.rationale}</p>` : ""}
        <div style="display:flex;gap:8px;padding:0 12px 12px">
          <button class="btn-secondary" style="flex:1;font-size:13px" onclick="wearOutfit('${outfit.id}')">📅 Wear today</button>
          <button class="btn-danger" style="padding:8px 14px;font-size:13px" onclick="deleteOutfit('${outfit.id}')">Delete</button>
        </div>
      </div>`;
  }).join("");
}

$("create-outfit-btn").addEventListener("click", () => {
  // Open log modal to pick items as a manual outfit
  openLogModal(true);
});

window.wearOutfit = async (outfitId) => {
  const outfit = savedOutfits.find(o => o.id === outfitId);
  if (!outfit) return;
  await logOutfitDirectly(outfit.itemIds);
};

window.deleteOutfit = async (outfitId) => {
  if (!confirm("Delete this outfit?")) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "outfits", outfitId));
    showToast("Outfit deleted");
  } catch { showToast("Error deleting"); }
};

// ─── LOG TAB ────────────────────────────────────────────────────────────────
function renderLog() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEntry = wearLog.find(l => l.date === todayStr);
  const worn = $("today-worn");

  if (todayEntry?.items?.length) {
    const items = todayEntry.items.map(id => wardrobeItems.find(i => i.id === id)).filter(Boolean);
    worn.innerHTML = items.map(item => `
      <div class="worn-chip">
        ${item.photoUrl ? `<img src="${item.photoUrl}" alt="${item.name}">` : getCategoryEmoji(item.category)}
        ${item.name}
      </div>`).join("");
  } else {
    worn.innerHTML = `<span style="font-size:13px;color:var(--text3)">Nothing logged yet</span>`;
  }

  // History
  const hist = $("wear-history");
  const historyEntries = wearLog.filter(l => l.date !== todayStr).slice(0, 20);
  if (!historyEntries.length) {
    hist.innerHTML = `<p style="font-size:13px;color:var(--text3);text-align:center;padding:16px">No wear history yet</p>`;
    return;
  }
  hist.innerHTML = historyEntries.map(entry => {
    const items = (entry.items || []).map(id => wardrobeItems.find(i => i.id === id)).filter(Boolean);
    return `
      <div class="history-day">
        <div class="history-day-date">${formatDate(entry.date)}</div>
        <div class="history-day-items">
          ${items.map(i => `<span class="history-item-tag">${i.name}</span>`).join("")}
        </div>
      </div>`;
  }).join("");
}

$("log-worn-btn").addEventListener("click", () => openLogModal(false));

function openLogModal(saveAsOutfit = false) {
  logSelectedItems.clear();
  const grid = $("log-item-grid");
  grid.innerHTML = wardrobeItems.map(item => `
    <div class="clothing-card" data-log-id="${item.id}">
      ${item.photoUrl
        ? `<img src="${item.photoUrl}" alt="${item.name}" loading="lazy">`
        : `<div class="card-emoji">${getCategoryEmoji(item.category)}</div>`}
      <div class="card-label">${item.name}</div>
    </div>`).join("");

  grid.querySelectorAll(".clothing-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.logId;
      if (logSelectedItems.has(id)) {
        logSelectedItems.delete(id);
        card.classList.remove("selected");
      } else {
        logSelectedItems.add(id);
        card.classList.add("selected");
      }
    });
  });

  $("confirm-log-btn").dataset.asOutfit = saveAsOutfit;
  showModal("log-modal");
}

$("confirm-log-btn").addEventListener("click", async () => {
  const ids = [...logSelectedItems];
  if (!ids.length) { showToast("Select at least one item"); return; }
  const asOutfit = $("confirm-log-btn").dataset.asOutfit === "true";
  await logOutfitDirectly(ids);
  if (asOutfit) await saveOutfit(ids, "Manually created outfit");
  hideModal("log-modal");
});

// ─── GAPS TAB ───────────────────────────────────────────────────────────────
$("analyze-gaps-btn").addEventListener("click", runGapAnalysis);
$("run-gap-btn")?.addEventListener("click", runGapAnalysis);

async function renderGaps() {
  // Render existing gap data if available — user triggers fresh analysis
  if (!wardrobeItems.length) {
    $("gap-analysis").innerHTML = `
      <div class="empty-state">
        <span>🛍️</span>
        <p>Add clothes to discover wardrobe gaps</p>
      </div>`;
    return;
  }
  runGapAnalysis();
}

async function runGapAnalysis() {
  if (wardrobeItems.length < 3) {
    showToast("Add more items to get gap analysis");
    return;
  }
  showLoading("Analyzing your wardrobe...");
  try {
    const payload = {
      items: wardrobeItems.map(i => ({
        id: i.id, name: i.name, category: i.category,
        color: i.primaryColor, occasions: i.occasions,
        seasons: i.seasons, wearCount: i.wearCount || 0
      })),
      wearHistory: wearLog.slice(0, 30).map(l => ({ date: l.date, itemIds: l.items }))
    };

    const res = await fetch(`${API_URL}/gap-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error();
    const data = await res.json();
    displayGaps(data.gaps || []);
  } catch {
    const localGaps = runLocalGapAnalysis();
    displayGaps(localGaps);
  } finally {
    hideLoading();
  }
}

function runLocalGapAnalysis() {
  const cats = {};
  wardrobeItems.forEach(i => { cats[i.category] = (cats[i.category] || 0) + 1; });
  const gaps = [];

  const idealCounts = {
    top: 7, bottom: 5, footwear: 3, outerwear: 2, accessory: 3
  };
  Object.entries(idealCounts).forEach(([cat, ideal]) => {
    const have = cats[cat] || 0;
    if (have < ideal) {
      gaps.push({
        icon: getCategoryEmoji(cat),
        title: `More ${cat}s`,
        reason: `You have ${have} ${cat}${have !== 1 ? "s" : ""} but aim for at least ${ideal} to have variety across the week.`,
        priority: have < ideal / 2 ? "high" : "medium"
      });
    }
  });

  // Check for season gaps
  const hasSummer = wardrobeItems.some(i => (i.seasons || []).includes("summer"));
  const hasWinter = wardrobeItems.some(i => (i.seasons || []).includes("winter"));
  if (!hasSummer) gaps.push({ icon: "☀️", title: "Summer wear", reason: "No summer-specific items found — consider light cottons and breathable fabrics.", priority: "medium" });
  if (!hasWinter) gaps.push({ icon: "🧥", title: "Winter / formal layer", reason: "No winter-specific items. A versatile jacket can double as office wear.", priority: "low" });

  // Rarely worn items
  const rarelyWorn = wardrobeItems.filter(i => (i.wearCount || 0) === 0).slice(0, 3);
  if (rarelyWorn.length > 2) {
    gaps.push({
      icon: "💤", title: "Unworn items",
      reason: `${rarelyWorn.length} items have never been worn. Try incorporating them before buying new ones.`,
      priority: "low"
    });
  }

  return gaps;
}

function displayGaps(gaps) {
  const container = $("gap-analysis");
  if (!gaps.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span>✅</span>
        <p>Your wardrobe looks well-rounded!</p>
        <p class="empty-hint">Keep wearing and logging to track patterns.</p>
      </div>`;
    return;
  }
  container.innerHTML = gaps.map(gap => `
    <div class="gap-card">
      <div class="gap-card-header">
        <div class="gap-icon">${gap.icon}</div>
        <div>
          <div class="gap-title">${gap.title}</div>
          <div class="gap-reason">${gap.reason}</div>
          <span class="gap-priority ${gap.priority}">${gap.priority.toUpperCase()} priority</span>
        </div>
      </div>
    </div>`).join("");
}

// ─── UTILS ─────────────────────────────────────────────────────────────────
function getCategoryEmoji(cat) {
  const map = {
    top: "👕", bottom: "👖", footwear: "👟", outerwear: "🧥",
    accessory: "👜", formal: "👔", ethnic: "🥻", innerwear: "🩲"
  };
  return map[cat] || "👗";
}

function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return "summer";
  if (month >= 6 && month <= 9) return "monsoon";
  if (month >= 10 && month <= 11) return "autumn";
  return "winter";
}

function formatDate(val) {
  if (!val) return "";
  if (typeof val === "string") return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (val?.toDate) return val.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return String(val);
}

// ─── PWA SERVICE WORKER ────────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

# 👗 Wardrobe — Smart Closet App (v2 — No Firebase Storage)

A full-stack digital wardrobe manager with AI-powered outfit suggestions, wear tracking, and gap analysis. **100% free. No billing required.**

## What Changed from v1

Firebase Storage now requires a paid Blaze plan for new projects (September 2024 change). This version replaces it with **Cloudinary** — free, no credit card, 25 GB storage, no hard-block on overages.

## Architecture (All Free, No Credit Card)

| Service | Role | Free Limits |
|---------|------|------------|
| **GitHub Pages** | Frontend hosting | Unlimited |
| **Firebase Auth** | Google sign-in | Unlimited |
| **Firestore** | Database (Spark plan) | 50K reads/day, 20K writes/day |
| **Cloudinary** | Photo storage + CDN | 25 GB storage, 25 GB bandwidth/month |
| **Render.com** | FastAPI backend | 512 MB, spins down on idle |
| **Google Gemini Flash** | AI vision + recommendations | 15 RPM, 1M tokens/day |

**Firebase used only for Auth + Firestore — Spark plan is sufficient, no billing needed.**

---

## Setup Guide

### Step 1 — Firebase (Auth + Firestore only)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → name it → Create

#### Enable Authentication
- **Authentication** → **Get started** → **Sign-in method** → Enable **Google**

#### Create Firestore
- **Firestore Database** → **Create database** → **Test mode** → pick region

**Do NOT enable Storage** — we're not using it.

#### Security Rules (Firestore)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

#### Get your config
- ⚙️ Project Settings → **Your apps** → **Add app** → Web
- Copy the `firebaseConfig` values

---

### Step 2 — Cloudinary (Photo Storage)

1. Go to [cloudinary.com](https://cloudinary.com/users/register_free)
2. Sign up with Google — **no credit card needed**
3. From your dashboard, note your **Cloud Name** (shown at top, e.g. `dxyz1234`)

#### Create an unsigned upload preset
- Settings (⚙️) → **Upload** tab → scroll to **Upload presets** → **Add upload preset**
- **Signing mode**: `Unsigned`
- **Preset name**: `wardrobe_unsigned` (or any name)
- **Folder**: `wardrobe` (optional)
- Save

#### Get API credentials (for backend delete)
- Settings → **Access Keys** → copy **API Key** and **API Secret**

---

### Step 3 — Gemini API Key (Free)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. **Get API Key** → **Create API key**
3. Free: 15 requests/minute, 1 million tokens/day

---

### Step 4 — Deploy Backend on Render

1. Create account at [render.com](https://render.com) (free, no credit card)
2. **New → Web Service** → connect your GitHub repo
3. Settings:
   - **Root directory**: `backend`
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free
4. **Environment Variables** → Add all four:
   ```
   GEMINI_API_KEY          = your_gemini_key
   CLOUDINARY_CLOUD_NAME   = your_cloud_name
   CLOUDINARY_API_KEY      = your_api_key
   CLOUDINARY_API_SECRET   = your_api_secret
   ```
5. Deploy → note your URL: `https://your-app.onrender.com`

---

### Step 5 — Configure Frontend

Edit `frontend/firebase-config.js`:
```javascript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  // No storageBucket needed!
};

export const CLOUDINARY_CLOUD_NAME = "your_cloud_name";
export const CLOUDINARY_UPLOAD_PRESET = "wardrobe_unsigned";
```

Edit `frontend/app.js` line 14:
```javascript
const API_URL = "https://your-app.onrender.com";
```

---

### Step 6 — Deploy Frontend on GitHub Pages

1. Push `frontend/` contents to a GitHub repo root
2. Repo Settings → **Pages** → Deploy from branch → `main` / `root`
3. Live at: `https://yourusername.github.io/wardrobe-app`
4. Add this URL to Firebase → Authentication → **Authorized domains**

---

### Step 7 — Install on Mobile (PWA)

**Android**: Open in Chrome → 3-dot menu → Add to Home Screen
**iOS**: Open in Safari → Share → Add to Home Screen

---

## How Photo Upload Works

```
Phone camera
    ↓
Browser (your GitHub Pages app)
    ↓ direct upload (no backend hop)
Cloudinary CDN
    ↓ returns secure HTTPS URL
Firestore (stores the URL + all metadata)
```

Photos upload directly from the browser to Cloudinary — the backend is not involved in uploads, only in deletes (because deletion requires the API secret, which must stay server-side).

---

## Environment Variables Summary

| Variable | Where set | Value source |
|----------|-----------|-------------|
| `GEMINI_API_KEY` | Render | aistudio.google.com |
| `CLOUDINARY_CLOUD_NAME` | Render | Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Render | Cloudinary Settings → Access Keys |
| `CLOUDINARY_API_SECRET` | Render | Cloudinary Settings → Access Keys |
| `CLOUDINARY_CLOUD_NAME` | `firebase-config.js` | Same cloud name |
| `CLOUDINARY_UPLOAD_PRESET` | `firebase-config.js` | The preset name you created |

---

## Cost Breakdown

| Service | Monthly Cost |
|---------|-------------|
| GitHub Pages | **₹0** |
| Firebase Spark (Auth + Firestore) | **₹0** |
| Cloudinary Free | **₹0** |
| Render free tier | **₹0** |
| Gemini Flash API | **₹0** |
| **Total** | **₹0 / month** |


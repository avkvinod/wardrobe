// ─── FIREBASE CONFIGURATION ───────────────────────────────────────────────
// Firebase is used ONLY for Auth + Firestore (no Storage needed)
// Get config from: Firebase Console → Project Settings → Your Apps → Web
// Spark (free) plan is fully sufficient — no billing required

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3rQSx6cOU33Wnc1aQOpgaJsqOygr26SE",
  authDomain: "wardrobe-2e29b.firebaseapp.com",
  projectId: "wardrobe-2e29b",
  storageBucket: "wardrobe-2e29b.firebasestorage.app",
  messagingSenderId: "859791675869",
  appId: "1:859791675869:web:9352f432faeff08e0da634"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// ─── CLOUDINARY CONFIGURATION ─────────────────────────────────────────────
// Sign up free at cloudinary.com (Google login, no credit card)
// Dashboard → Settings → Upload → Add upload preset → Mode: Unsigned
// Then copy your Cloud Name and the preset name here

export const CLOUDINARY_CLOUD_NAME = "de5atf1p0";  // e.g. "dxyz1234"
export const CLOUDINARY_UPLOAD_PRESET = "wardrobe_unsigned";  // the preset you create

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Public web config — safe to expose client-side. Access is controlled by
// Firestore security rules, not by keeping this secret. See README.md
// before making this site public.
const firebaseConfig = {
  apiKey: "AIzaSyBpo5_pNOssRM8M2GVBZDV5lmpiM2pbbPw",
  authDomain: "memory-album---for-her.firebaseapp.com",
  projectId: "memory-album---for-her",
  storageBucket: "memory-album---for-her.firebasestorage.app",
  messagingSenderId: "513437177420",
  appId: "1:513437177420:web:3bfa2e054f1d267c7dc6e9",
  measurementId: "G-3NJV7GHCWF",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

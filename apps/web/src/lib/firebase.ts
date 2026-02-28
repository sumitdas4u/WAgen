import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyCrzTsEgA1YxdnVeD5w3OVtGOi4v4nIWJk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "wagenai.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "wagenai",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "wagenai.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "356083940870",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:356083940870:web:412c695b8dbf61d9b04d87",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-RH3S2YW5NF"
};

const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

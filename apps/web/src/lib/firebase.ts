import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { API_URL } from "./api";

type FirebaseWebConfig = {
  apiKey?: string | null;
  authDomain?: string | null;
  projectId?: string | null;
  storageBucket?: string | null;
  messagingSenderId?: string | null;
  appId?: string | null;
  measurementId?: string | null;
};

const envFirebaseConfig: FirebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

function getInvalidFirebaseConfig(config: FirebaseWebConfig): string[] {
  return Object.entries({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId
  })
    .filter(([, value]) => !value || value.includes("your_") || value.includes("your-"))
    .map(([key]) => key);
}

async function loadFirebaseConfig(): Promise<FirebaseWebConfig> {
  if (getInvalidFirebaseConfig(envFirebaseConfig).length === 0) {
    return envFirebaseConfig;
  }

  const response = await fetch(`${API_URL}/api/public/config`);
  if (!response.ok) {
    throw new Error(`Firebase web config could not be loaded from API: ${response.status}`);
  }

  const payload = await response.json() as { firebase?: FirebaseWebConfig };
  return payload.firebase ?? {};
}

const firebaseConfig = await loadFirebaseConfig();
const invalidFirebaseConfig = getInvalidFirebaseConfig(firebaseConfig);
if (invalidFirebaseConfig.length > 0) {
  throw new Error(`Firebase web config from API env is missing or still using placeholder values: ${invalidFirebaseConfig.join(", ")}`);
}

const firebaseOptions: FirebaseOptions = {
  apiKey: firebaseConfig.apiKey ?? undefined,
  authDomain: firebaseConfig.authDomain ?? undefined,
  projectId: firebaseConfig.projectId ?? undefined,
  storageBucket: firebaseConfig.storageBucket ?? undefined,
  messagingSenderId: firebaseConfig.messagingSenderId ?? undefined,
  appId: firebaseConfig.appId ?? undefined,
  measurementId: firebaseConfig.measurementId ?? undefined
};

const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseOptions);

export const firebaseAuth = getAuth(firebaseApp);

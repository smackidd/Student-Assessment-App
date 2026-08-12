import { getApps, initializeApp } from "firebase/app";

const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV;
const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const expectedProjectIds: Record<string, string> = {
  production: "student-assessment-2d869",
  test: "student-assessment-test"
};

const isLocalHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".local") ||
  /^127\./.test(hostname) ||
  /^10\./.test(hostname) ||
  /^192\.168\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname);

if (
  appEnvironment &&
  expectedProjectIds[appEnvironment] &&
  firebaseProjectId !== expectedProjectIds[appEnvironment]
) {
  throw new Error(
    `Firebase environment mismatch: ${appEnvironment} must use ${expectedProjectIds[appEnvironment]}.`
  );
}

if (
  typeof window !== "undefined" &&
  isLocalHostname(window.location.hostname) &&
  firebaseProjectId === expectedProjectIds.production
) {
  throw new Error(
    "Local application sessions must use the student-assessment-test Firebase project."
  );
}

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: firebaseProjectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const dataConnectConfig = {
  service: process.env.NEXT_PUBLIC_FIREBASE_DATA_CONNECT_SERVICE_ID ?? "student-assessment",
  location: process.env.NEXT_PUBLIC_FIREBASE_DATA_CONNECT_LOCATION ?? "northamerica-northeast1",
  connector: process.env.NEXT_PUBLIC_FIREBASE_DATA_CONNECT_CONNECTOR_ID ?? "student-assessment"
};

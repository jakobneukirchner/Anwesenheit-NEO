// js/firebase-init.js
// Firebase Initialisierung via Netlify Environment Variables

const firebaseConfig = {
  apiKey:            window.FIREBASE_API_KEY,
  authDomain:        window.FIREBASE_AUTH_DOMAIN,
  projectId:         window.FIREBASE_PROJECT_ID,
  storageBucket:     window.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: window.FIREBASE_MESSAGING_SENDER_ID,
  appId:             window.FIREBASE_APP_ID,
  measurementId:     window.FIREBASE_MEASUREMENT_ID
};

window.firebaseApp  = firebase.initializeApp(firebaseConfig);
window.firebaseAuth = firebase.auth();
window.firestore    = firebase.firestore();

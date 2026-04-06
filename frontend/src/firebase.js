import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCweCqzHBKsaxu2FjrIbH4JiV8CztNX5K8",
  authDomain: "prixo-46167.firebaseapp.com",
  projectId: "prixo-46167",
  storageBucket: "prixo-46167.firebasestorage.app",
  messagingSenderId: "290122465322",
  appId: "1:290122465322:web:1c7c95e5abebce164b4353"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'europe-west1'); // Match function region

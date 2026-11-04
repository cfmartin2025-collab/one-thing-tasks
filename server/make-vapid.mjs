// Prints a fresh VAPID key pair as JSON: { publicKey, privateJwk }. Used once by tools/deploy-push.ps1.
import { makeVapidKeys } from "./src/webpush.js";
const k = await makeVapidKeys();
process.stdout.write(JSON.stringify(k));

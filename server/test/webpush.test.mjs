// Checks the push encryption by decrypting it the way a browser does (RFC 8291),
// and checks the VAPID signature against the public key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64u, unb64u, makeVapidKeys, vapidAuth, encryptPayload, sendPush } from "../src/webpush.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const concat = (...p) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));

// A fake browser subscription with its private key kept, so we can decrypt.
async function fakeBrowser() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, sub: { endpoint: "https://push.example.com/send/abc", keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}
async function browserDecrypt(b, body) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, b.kp.privateKey, 256));
  const prkKey = await hmac(b.auth, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode("WebPush: info\0"), b.pub, asPub, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, cipher));
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return dec.decode(plain.slice(0, -1));
}

test("base64url round trip", () => {
  const b = crypto.getRandomValues(new Uint8Array(65));
  assert.deepEqual(unb64u(b64u(b)), b);
});

test("payload decrypts in the browser's way", async () => {
  const b = await fakeBrowser();
  const body = await encryptPayload(b.sub, '{"title":"One Thing","body":"pick up girls"}');
  assert.equal(body[16] * 2 ** 24 + body[17] * 2 ** 16 + body[18] * 2 ** 8 + body[19], 4096);
  assert.equal(await browserDecrypt(b, body), '{"title":"One Thing","body":"pick up girls"}');
});

test("VAPID token is signed by the key and aimed at the push service", async () => {
  const v = await makeVapidKeys();
  const h = await vapidAuth("https://web.push.apple.com/QGuQyavXutnMqf", v.publicKey, v.privateJwk, "https://example.com/");
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  const claims = JSON.parse(dec.decode(unb64u(m[2])));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.ok(claims.exp > Date.now() / 1000);
  const pub = await crypto.subtle.importKey("raw", unb64u(m[4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(m[3]), enc.encode(m[1] + "." + m[2]));
  assert.ok(ok, "signature verifies");
});

test("sendPush sends the right headers and flags dead subscriptions", async () => {
  const b = await fakeBrowser();
  const v = await makeVapidKeys();
  let seen;
  const fake = async (url, init) => { seen = { url, init }; return new Response(null, { status: 410 }); };
  const r = await sendPush(b.sub, { title: "x", body: "y" }, { ...v, subject: "https://example.com/" }, fake);
  assert.equal(seen.url, b.sub.endpoint);
  assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
  assert.match(seen.init.headers.Authorization, /^vapid t=/);
  assert.equal(r.gone, true);
  assert.deepEqual(JSON.parse(await browserDecrypt(b, seen.init.body)), { title: "x", body: "y" });
});

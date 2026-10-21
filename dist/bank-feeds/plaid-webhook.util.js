"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AGE_SECONDS = void 0;
exports.webhookKeyId = webhookKeyId;
exports.verifyPlaidWebhook = verifyPlaidWebhook;
const crypto = __importStar(require("crypto"));
exports.MAX_AGE_SECONDS = 5 * 60;
function b64url(part) {
    return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function webhookKeyId(token) {
    const [head] = token.split('.');
    try {
        const header = JSON.parse(b64url(head).toString('utf8'));
        return header.alg === 'ES256' && header.kid ? header.kid : null;
    }
    catch {
        return null;
    }
}
function verifyPlaidWebhook(token, key, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
    const parts = token.split('.');
    if (parts.length !== 3)
        return 'not a JWT';
    if (!webhookKeyId(token))
        return 'not an ES256 token';
    if (key.expired_at)
        return 'key expired';
    let publicKey;
    try {
        publicKey = crypto.createPublicKey({
            key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
            format: 'jwk',
        });
    }
    catch {
        return 'unusable key';
    }
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    const ok = crypto.verify('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64url(parts[2]));
    if (!ok)
        return 'bad signature';
    let payload;
    try {
        payload = JSON.parse(b64url(parts[1]).toString('utf8'));
    }
    catch {
        return 'unreadable payload';
    }
    if (typeof payload.iat !== 'number' ||
        nowSeconds - payload.iat > exports.MAX_AGE_SECONDS) {
        return 'too old';
    }
    const digest = crypto.createHash('sha256').update(rawBody).digest('hex');
    const claimed = String(payload.request_body_sha256 ?? '');
    if (claimed.length !== digest.length ||
        !crypto.timingSafeEqual(Buffer.from(claimed), Buffer.from(digest))) {
        return 'body does not match';
    }
    return null;
}
//# sourceMappingURL=plaid-webhook.util.js.map
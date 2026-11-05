"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.explainPlaidError = explainPlaidError;
exports.plaidErrorDetail = plaidErrorDetail;
const EXPLAINED = {
    ITEM_LOGIN_REQUIRED: [
        'Your bank needs you to sign in again — the password changed, or the bank asks for it from time to time.',
        'Click "Sign in again" and log in to your bank.',
    ],
    PENDING_EXPIRATION: [
        'Your bank will stop sharing with us soon unless you sign in again.',
        'Click "Sign in again" and log in to your bank.',
    ],
    PENDING_DISCONNECT: [
        'Your bank will stop sharing with us soon unless you sign in again.',
        'Click "Sign in again" and log in to your bank.',
    ],
    INVALID_CREDENTIALS: [
        'Your bank did not accept the username or password.',
        'Click "Sign in again" and enter the login you use on your bank\'s website.',
    ],
    INVALID_MFA: [
        'The security code or answer was not accepted by your bank.',
        'Click "Sign in again" and enter the newest code your bank sends you.',
    ],
    MFA_NOT_SUPPORTED: [
        'Your bank asked for a kind of security check we cannot answer for you.',
        'Click "Sign in again"; if it happens again, upload this account\'s statements instead.',
    ],
    ITEM_LOCKED: [
        'Your bank locked the login after too many tries.',
        'Unlock it on your bank\'s website (or call them), then click "Sign in again".',
    ],
    USER_SETUP_REQUIRED: [
        'Your bank wants you to finish something on its website first (a new agreement, a security question, a password change).',
        'Log in to your bank\'s website, finish what it asks, then click "Sign in again".',
    ],
    NO_ACCOUNTS: [
        'No account is shared from this bank login any more.',
        'Click "Change accounts" and pick the accounts to bring in.',
    ],
    ACCESS_NOT_GRANTED: [
        'Your bank was not allowed to share the transactions.',
        'Click "Sign in again" and allow transactions when your bank asks.',
    ],
    USER_PERMISSION_REVOKED: [
        'Access was turned off at your bank (in its list of connected apps).',
        'Disconnect it here and connect the bank again to resume.',
    ],
    USER_ACCOUNT_REVOKED: [
        'Access to this account was turned off at your bank.',
        'Disconnect it here and connect the bank again to resume.',
    ],
    ITEM_NOT_SUPPORTED: [
        'This bank or account type cannot be connected automatically.',
        "Upload this account's statements instead.",
    ],
    INSTITUTION_DOWN: [
        "Your bank's systems are down right now — nothing is wrong with your connection.",
        'Nothing to do: we try again by ourselves. If it lasts more than a day, let us know.',
    ],
    INSTITUTION_NOT_RESPONDING: [
        'Your bank did not answer in time — nothing is wrong with your connection.',
        'Nothing to do: we try again by ourselves. If it lasts more than a day, let us know.',
    ],
    INSTITUTION_NOT_AVAILABLE: [
        'Your bank cannot be reached through our bank-feed provider right now.',
        'Nothing to do: we try again by ourselves. If it lasts more than a day, upload the statements instead.',
    ],
    INSTITUTION_NO_LONGER_SUPPORTED: [
        'Your bank no longer supports connecting this way.',
        "Upload this account's statements instead.",
    ],
    PRODUCT_NOT_READY: [
        'Your bank is still preparing your transactions.',
        'Nothing to do — they arrive by themselves, usually within a few hours.',
    ],
    TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION: [
        'Your bank changed some transactions while we were downloading them.',
        'Nothing to do: we try again by ourselves.',
    ],
    RATE_LIMIT_EXCEEDED: [
        'We asked your bank for updates too often in a short time.',
        'Nothing to do: we try again by ourselves in a little while.',
    ],
    INTERNAL_SERVER_ERROR: [
        'Our bank-feed provider had a problem on its side.',
        'Nothing to do: we try again by ourselves. If it lasts more than a day, let us know.',
    ],
    PLANNED_MAINTENANCE: [
        'Our bank-feed provider is down for planned maintenance.',
        'Nothing to do: we try again by ourselves once it is back.',
    ],
};
const FALLBACK = [
    'Your bank connection stopped working.',
    'Click "Refresh now" to try again. If it still fails, click "Sign in again", or let us know and we will look at it.',
];
function explainPlaidError(code) {
    const [what, todo] = (code && EXPLAINED[code]) || FALLBACK;
    return `${what} ${todo}`;
}
function plaidErrorDetail(code, message) {
    const text = [code, message].filter(Boolean).join(': ');
    return text ? text.slice(0, 2000) : null;
}
//# sourceMappingURL=plaid-error.util.js.map
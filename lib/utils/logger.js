// lib/utils/logger.js

/**
 * Scrive un messaggio di log standard su stderr per non interferire con stdout.
 */
const log = (message) => {
    process.stderr.write(`[info]${message}\n`);
};

/**
 * Scrive un messaggio di errore su stderr.
 */
const error = (message, err = null) => {
    process.stderr.write(`❌ ERROR: ${message}\n`);
    if (err && process.env.NODE_ENV !== 'production') {
        process.stderr.write(`${err.stack || err}\n`);
    }
};

/**
 * Scrive un messaggio di avviso su stderr.
 */
const warn = (message) => {
    process.stderr.write(`⚠️ WARNING: ${message}\n`);
};

export { log, error, warn };
// /lib/utils/logger.js

const log = (message) => {
    process.stdout.write(`${message}\n`);
};

const error = (message, err = null) => {
    process.stderr.write(`❌ ERROR: ${message}\n`);
    if (err && process.env.NODE_ENV !== 'production') {
        process.stderr.write(`${err.stack || err}\n`);
    }
};

const warn = (message) => {
    process.stderr.write(`⚠️ WARNING: ${message}\n`);
};

export { log, error, warn };
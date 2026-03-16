const fs = require('fs');
const path = require('path');

function findPath(filename) {
    const possiblePaths = [
        path.resolve(filename),
        path.resolve(__dirname, filename),
        path.resolve(process.cwd(), filename),
        path.resolve(__dirname, '../' + filename),
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p))
            return p;
    }
}

module.exports = { findPath };

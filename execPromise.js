// execPromise.js - Promise-based execution of shell commands
const util = require('util');
const { exec } = require('child_process');

// Create a promise-based exec function
const execPromise = util.promisify(exec);

module.exports = { execPromise };
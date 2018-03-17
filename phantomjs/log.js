const _ = require('../util.js');
const chalk = require('chalk');
/**
 * log
 * @param {string} msg
 * @param {number} type
 */
function log(msg, type) {
    type = type || _.log.DEBUG;
    console.log(chalk.green(type) + chalk.yellow(msg));
};
module.exports = log;
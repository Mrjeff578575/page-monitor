const puppeteer = require('puppeteer');
const devices = require('puppeteer/DeviceDescriptors');
const iPhone = devices['iPhone 6'];
const fs = require('fs');
const URL = require('url');

const _ = require('../util.js');
const diff = require('./diff.js');
const walk = require('./walk.js');
const highlight = require('./highlight.js');

let BROWSER = null;
let PAGE = null;

// generate communication token
const TOKEN = _.unique();

// constant values
const LATEST_LOG_FILENAME = 'latest.log';
const SCREENSHOT_FILENAME = 'screenshot';
const INFO_FILENAME = 'info.json';
const TREE_FILENAME = 'tree.json';
const HIGHLIGHT_HTML_FILENAME = 'highlight.html';
/**
 * log
 * @param {string} msg
 * @param {number} type
 */
function log(msg, type) {
    type = type || _.log.DEBUG;
    console.log(type + msg);
};

const FORMAT_MAP = {
    png  : 'png',
    gif  : 'gif',
    jpeg : 'jpeg',
    jpg  : 'jpeg',
    pdf  : 'pdf'
};

class M {
    /**
     * Constructor
     * @param {object} options
     * @constructor
     */
    constructor(opts, browser) {
        this.browser = browser;
        this.token = TOKEN;
        this.options = opts;
        this.options.diff.changeType = {
            ADD:    1,  // 0001
            REMOVE: 2,  // 0010
            STYLE:  4,  // 0100
            TEXT:   8   // 1000
        };
        this.root = opts.path.dir;
        this.latest = this.root + '/' + LATEST_LOG_FILENAME;
    }
    /**
     * get info of the latest save
     * @returns {object|boolean}
     */
    getLatestTree(url) {
        const urlPath = URL.parse(url).pathname.replace('/', '_');
        return new Promise((resolve, reject) => {
            if(fs.existsSync(this.latest)){
                var time = fs.readFileSync(this.latest).toString().trim();
                if(time){
                    // TODO: 支持多页面
                    var tree = this.root + '/' + time + '/' + urlPath + '_' + TREE_FILENAME;
                    if(fs.existsSync(tree)){
                        var content = fs.readFileSync(tree).toString().trim();
                        resolve({
                            time: time,
                            file: tree,
                            content: content
                        });
                    }
                }
            }
            resolve(false);
        })
    }

    /**
     * get render options
     * @returns {{ext: string, format: 'png'|'gif'|'jpeg'|'pdf', quality: number}}
     */
    getRenderOptions() {
        // var render = this.options.render || {};
        // var f = String(render.format).toLowerCase();
        // var format = FORMAT_MAP[f] || 'png';
        // var quality = render.quality || 80;
        // var ext = (render.ext || f).toLowerCase();
        return {
            ext: 'png',
            // format: format,
            // quality: quality
        };
    }

    /**
     * save capture
     * @param {webpage} page
     * @param {string} url
     * @param {string|object} tree
     * @param {array} rect
     * @param {string|number} time
     * @returns {{time: number, dir: string, screenshot: string}}
     */
    save(page, url, tree, rect) {
        return new Promise((resolve, reject) => {
            time = time || Date.now();
            if(_.is(tree, 'Object')){
                tree = JSON.stringify(tree);
            }
            var dir = this.root + '/' + time;
            console.log('DIR: ', dir);
            if (fs.existsSync(dir)) {
                reject('file exits');
                return;
            }
            fs.mkdir(dir, async (err) => {
                if (!err) {
                    log('save capture [' + dir + ']');
                    const opt = this.getRenderOptions();
                    const urlPath = URL.parse(url).pathname.replace(/\//g, '_');
                    const screenshot = `${dir}/${urlPath}_${SCREENSHOT_FILENAME}.${opt.ext}`;
                    log('screenshot [' + screenshot + ']');
                    log(`rect [${rect}]`);
                    await page.evaluate(function(){
                        const elem = document.documentElement;
                        elem.style.backgroundColor = '#fff';
                    });
                    //capture
                    await page.screenshot({
                        path: screenshot,
                        clip: {
                            x: rect[0],
                            y: rect[1],
                            width: rect[2],
                            height: rect[3]
                        }
                    });
                    fs.writeFileSync(dir + '/' + urlPath + '_' + TREE_FILENAME, tree);
                    fs.writeFileSync(dir + '/' + urlPath + '_' + INFO_FILENAME, JSON.stringify({
                        time: time,
                        url: url
                    }));
                    fs.writeFileSync(this.latest, time);
                    resolve({
                        time: time,
                        dir: dir,
                        screenshot: screenshot
                    });
                } else {
                    throw new Error(`Error: [${err}] unable to make directory [${dir}]`);
                    reject(err);
                }
            })
        })
    }


    /**
     * highlight the changes
     * @param {string|number} left
     * @param {string|number} right
     * @param {Array} diff
     * @param {Array} lOffset
     * @param {Array} rOffset
     * @param {Function} callback
     */
    highlight(left, right, diff, lOffset, rOffset, callback) {
        log('diff [' + left + '] width [' + right + ']');
        log('has [' + diff.length + '] changes');
        const render = this.getRenderOptions();
        const lScreenshot = this.root + '/' + left + '/' + SCREENSHOT_FILENAME + '.' + render.ext;
        const rScreenshot = this.root + '/' + right + '/' + SCREENSHOT_FILENAME + '.' + render.ext;
        const dScreenshot = this.root + '/diff/' + left + '-' + right + '.' + render.ext;
        if (!fs.existsSync(this.root + '/diff/')) {
            fs.mkdirSync(this.root + '/diff/');
        }
        const html = __dirname + '/' + HIGHLIGHT_HTML_FILENAME;
        let url = 'file://' + '' + html + '?';
        // TODO: 利用Resemble.js进行像素对比
        // var diff = resemble(lScreenshot).compareTo(rScreenshot).ignoreColors().onComplete(function(data){
        //     console.log(data);
        //     /*
        //     {
        //     misMatchPercentage : 100, // %
        //     isSameDimensions: true, // or false
        //     dimensionDifference: { width: 0, height: -1 }, // defined if dimensions are not the same
        //     getImageDataUrl: function(){}
        //     }
        //     */
        // });
        url += [
            lScreenshot,
            rScreenshot,
            _.getTimeString(left),
            _.getTimeString(right)
        ].join('|');
        log('start highlight [' + url + ']');
        let self = this, options = self.options;
        this.createPage(url, async (page) => {
            log('highlight done');
            const count = await page.evaluate(highlight, self.token, diff, lOffset, rOffset, options.diff);
            var info = {
                left,
                right,
                screenshot: dScreenshot,
                count,
            };
            await page.screenshot({
                path: dScreenshot
                // clip: {
                //     x: rect[0],
                //     y: rect[1],
                //     width: rect[2],
                //     height: rect[3]
                // }
            });
            callback(info);
        });
    };

    /**
     * page capture
     * @param {string} url
     * @param {boolean} needDiff
     */
    async capture(url, needDiff) {
        if(needDiff) log('need diff');
        const self = this;
        const options = self.options;
        log('loading: ' + url);
        this.createPage(url, async (page) => {
            log('loaded: ' + url);
            log('walk tree');
            const right = await page.evaluate(walk, self.token, options.walk);
            const rect = right.rect;
            const json = JSON.stringify(right);
            const latest = await self.getLatestTree(url);
            if(latest.content === json){
                // no change, not capture and diff
                log('no change');
            } else if(latest === false || !needDiff) {
                // only capture
                await this.save(page, url, json, rect);
            } else {
                // diff with lastest capture
                var left = JSON.parse(latest.content);
                right = JSON.parse(json);
                var ret = diff(left, right, options.diff);
                if(ret.length){
                    var info = await this.save(page, url, json, rect, now);
                    var lOffset = { x: left.rect[0], y: left.rect[1] };
                    var rOffset = { x: right.rect[0], y: right.rect[1] };
                    self.highlight(latest.time, now, ret, lOffset, rOffset, function(diff){
                        info.diff = diff;
                        log(JSON.stringify(info), _.log.INFO);
                    });
                } else {
                    log('no change');
                }
            }
            await this.close(page);
        });
    }

    /**
     * get tree object by time
     * @param {string|number} time
     * @returns {object|undefined}
     */
    getTree(time) {
        //const filePath = url.replace('/', '').split('.').join('');
        const file = this.root + '/' + time + '/' + TREE_FILENAME;
        if(fs.existsSync(file)){
            return JSON.parse(fs.readFileSync(file));
        }
    }

    /**
     * page diff
     * @param {string} left
     * @param {string} right
     */
    diff(left, right) {
        var self = this;
        var options = self.options;
        var lTree = this.getTree(left);
        var rTree = this.getTree(right);
        try {
            if(lTree && rTree){
                var ret = diff(lTree, rTree, options.diff);
                if(ret.length){
                    var lOffset = { x: lTree.rect[0], y: lTree.rect[1] };
                    var rOffset = { x: rTree.rect[0], y: rTree.rect[1] };
                    self.highlight(left, right, ret, lOffset, rOffset, function(diff){
                        var info = { diff };
                        log(JSON.stringify(info), _.log.INFO);
                    });
                } else {
                    log('no change', _.log.WARNING);
                }
            } else if(lTree){
                throw new Error('missing right record [' + right + ']');
            } else {
                throw new Error('missing left record [' + right + ']');
            }
        } catch (e){
            console.log(e)
        }

        this.close(page);
    }

    async close(page) {
        // only close page
        try {
            console.log('close page and browser');
            await page.close();
        } catch (e) {
            console.log(e);
        }

    }
    
    /**
     * create webpage and bind events
     * @param {string} url
     * @param {Function} onload
     */
    async createPage(url, callback){
        const options = this.options.page.viewportOpts || {};
        const page = await this.browser.newPage();
        await page.emulate(iPhone);
        await page.goto(url);
        page.on('error', (msg, trace) => {
            var msgStack = [ msg ];
            if (trace && trace.length) {
                msgStack.push('TRACE:');
                trace.forEach(function(t) {
                    msgStack.push(' -> ' + (t.file || t.sourceURL) + ': ' + t.line + (t.function ? ' (in function ' + t.function +')' : ''));
                });
            }
            log(msgStack.join('\n'), _.log.ERROR);
            this.close(page);
        });
        page.on('console', (msg) => {
            for (let i = 0; i < msg.args().length; ++i) {
                console.log(`${i}: ${msg.args()[i]}`);
            }
        });
        callback(page);
    }
}
module.exports = M;
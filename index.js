var child_process = require('child_process');
var spawn = child_process.spawn;
var fs = require('fs');
var path = require('path');
var Url = require('url');
var util = require("util");
var DEFAULT_DATA_DIRNAME = process.cwd();
var PHANTOMJS_SCRIPT_DIR = path.join(__dirname, 'phantomjs');
var PHANTOMJS_SCRIPT_FILE = path.join(PHANTOMJS_SCRIPT_DIR, 'index.js');
var _ = require('./util.js');
var EventEmitter = require('./NewEventEmitter.js');
const puppeteer = require('puppeteer');
const M = require('./phantomjs/index.js');

const CAPTURE_MODE = 1;
const DIFF_MODE = 2;

/**
 * log
 * @param {string} msg
 * @param {number} type
 */
function log(msg, type) {
    type = type || _.log.DEBUG;
    console.log(type + msg);
};
/**
 * mkdir -p
 * @param {String} path
 * @param {Number} mode
 */
function mkdirp(path, mode){
    if (typeof mode === 'undefined') {
        //511 === 0777
        mode = 511 & (~process.umask());
    }
    if(fs.existsSync(path)) return;
    path.replace(/\\/g, '/').split('/').reduce(function(prev, next) {
        if(prev && !fs.existsSync(prev)) {
            fs.mkdirSync(prev, mode);
        }
        return prev + '/' + next;
    });
    if(!fs.existsSync(path)) {
        fs.mkdirSync(path, mode);
    }
}

/**
 * base64 encode
 * @param {String|Buffer} data
 * @returns {String}
 */
function base64(data){
    if(data instanceof Buffer){
        //do nothing for quickly determining.
    } else if(data instanceof Array){
        data = new Buffer(data);
    } else {
        //convert to string.
        data = new Buffer(String(data || ''));
    }
    return data.toString('base64');
}

/**
 * merge settings
 * @param {Object} settings
 * @returns {*}
 */
function mergeSettings(settings){
    var defaultSettings = {
        protocol: 'http',
        page: {
            viewportOpts: {
                width: 375,
                height: 667,
                isMobile: true,
            }
        },
        walk: {
            invisibleElements : [
                'applet', 'area', 'audio', 'base', 'basefont',
                'bdi', 'bdo', 'big', 'br', 'center', 'colgroup',
                'datalist', 'form', 'frameset', 'head', 'link',
                'map', 'meta', 'noframes', 'noscript', 'optgroup',
                'option', 'param', 'rp', 'rt', 'ruby', 'script',
                'source', 'style', 'title', 'track', 'xmp'
            ],
            ignoreChildrenElements: [
                'img', 'canvas', 'input', 'textarea', 'audio',
                'video', 'hr', 'embed', 'object', 'progress',
                'select', 'table'
            ],
            styleFilters: [
                'margin-left', 'margin-top', 'margin-right', 'margin-bottom',
                'border-left-color', 'border-left-style', 'border-left-width',
                'border-top-color', 'border-top-style', 'border-top-width',
                'border-right-color', 'border-right-style', 'border-right-width',
                'border-bottom-color', 'border-bottom-style', 'border-bottom-width',
                'border-top-left-radius', 'border-top-right-radius',
                'border-bottom-left-radius', 'border-bottom-right-radius',
                'padding-left', 'padding-top', 'padding-right', 'padding-bottom',
                'background-color', 'background-image', 'background-repeat',
                'background-size', 'background-position',
                'list-style-image', 'list-style-position', 'list-style-type',
                'outline-color', 'outline-style', 'outline-width',
                'font-size', 'font-family', 'font-weight', 'font-style', 'line-height',
                'box-shadow', 'clear', 'color', 'display', 'float', 'opacity', 'text-align',
                'text-decoration', 'text-indent', 'text-shadow', 'vertical-align', 'visibility',
                'position'
            ],
            // attributes to mark an element
            attributeFilters: [ 'id', 'class' ],
            excludeSelectors: [],
            removeSelectors: [],          // remove elements before walk
            ignoreTextSelectors: [],      // ignore content change of text node or image change
            ignoreStyleSelectors: [],     // ignore style change
            ignoreChildrenSelectors: [],  //
            root: 'body'
        },
        diff: {
            // LCS diff priority, `head` or `tail`
            priority: 'head',
            // highlight mask styles
            highlight: {
                add: {
                    title: '新增(Added)',
                    backgroundColor: 'rgba(127, 255, 127, 0.3)',
                    borderColor: '#090',
                    color: '#060',
                    textShadow: '0 1px 1px rgba(0, 0, 0, 0.3)'
                },
                remove: {
                    title: '删除(Removed)',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    borderColor: '#999',
                    color: '#fff'
                },
                style: {
                    title: '样式(Style)',
                    backgroundColor: 'rgba(255, 0, 0, 0.3)',
                    borderColor: '#f00',
                    color: '#f00'
                },
                text: {
                    title: '文本(Text)',
                    backgroundColor: 'rgba(255, 255, 0, 0.3)',
                    borderColor: '#f90',
                    color: '#c30'
                }
            }
        },
        events: {
            init: function(token){
                /*
                    do something before page init,
                    @see http://phantomjs.org/api/webpage/handler/on-initialized.html
                */
            },
            beforeWalk: function(token){
                /*
                    do something before walk dom tree,
                    retrun a number to delay screenshot
                 */
            }
        },
        path: {
            root: DEFAULT_DATA_DIRNAME, // data and screenshot save path root

            // save path format, it can be a string
            // like this: '{hostname}/{port}/{pathname}/{query}{hash}'
            format: function(url, opt){
                return opt.hostname;
            }
        }
    };

    // special handling of events
    if(settings && settings.events){
        _.map(settings.events, function(key, value){
            if(typeof value === 'function'){
                value = value.toString().replace(/^(function\s+)anonymous(?=\()/, '$1');
                settings.events[key] = value;
            }
        });
    }
    return _.merge(defaultSettings, settings || {});
}

/**
 *
 * @param {String} path
 * @returns {String}
 */
function escapePath(path){
    if(path === '/'){
        return '-';
    } else {
        return path.replace(/^\//, '').replace(/^\.|[\\\/:*?"<>|]/g, '-');
    }
}

/**
 * path format
 * @param {String|Function} pattern
 * @param {String} url
 * @param {Object} opt
 * @returns {String}
 */
function format(pattern, url, opt){
    switch (typeof pattern){
        case 'function':
            return pattern(url, opt);
        case 'string':
            var pth = [];
            String(pattern).split('/').forEach(function(item){
                pth.push(item.replace(/\{(\w+)\}/g, function(m, $1){
                    return escapePath((opt[$1] || ''));
                }));
            });
            return pth.join('/');
        default :
            throw new Error('unsupport format');
    }
}

function Flattern(arr){
    var newArr = arr.reduce(function(pre, cur){
        return pre.concat(cur)
    });
    return newArr;
}

const LOG_VALUE_MAP ={};
const logTypes = (function(){
    var types = [];
    _.map(_.log, function(key, value){
        LOG_VALUE_MAP[value] = key.toLowerCase();
        types.push(_.escapeReg(value));
    });
    return types.join('|');
})();
const LOG_SPLIT_REG = new RegExp('(?:^|[\r\n]+)(?=' + logTypes + ')');
const LOG_TYPE_REG = new RegExp('^(' + logTypes + ')');

class Monitor {
    /**
     * Monitor Class Constructor
     * @param {String} url
     * @param {Object} options
     * @constructor
    */
    constructor(options) {
        EventEmitter.call(this);
        options = mergeSettings(options);
        this.hosts = options.hosts;
        this.protocol = options.protocol;
        this.pathToCompare = options.pathToCompare;
        this.running = false;
        this.hosts.forEach(host => {
            const pathDir = path.join(DEFAULT_DATA_DIRNAME, host);
            if(!fs.existsSync(pathDir)){
                mkdirp(pathDir);
            }
        })
        this.urls = Flattern(this.hosts.map(host => this.pathToCompare.map(p => this.protocol + '://' + host + p)));
        this.options = options;
    }
    /**
     * init log
     * @private
     */
    _initLog() {
        var log = this.log = {};
        _.map(_.log, function(key){
            log[key.toLowerCase()] = [];
        });
    }

    /**
     * TODO: need to capture multiple urls
     * capture webpage and diff
     * @param {Function} callback
     * @param {Boolean} noDiff
     * @returns {*}
     */
    capture(callback, noDiff) {
        if(this.running) return;
        this.running = true;
        const self = this;
        this._initLog();
        return this.run(
            [
                CAPTURE_MODE,
                this.urls,
                JSON.stringify(this.options)
            ],
            function(code, log){
                self.running = false;
                callback.call(self, code, log);
            }
        );
    }


    /**
     * TODO: need change to diff two files or two times
     * diff with two times
     * @param {Number|String|Date} left
     * @param {Number|String|Date} right
     * @param {Function} callback
     * @returns {*}
     */
    diff(time, callback) {
        if(this.running) return;
        this.running = true;
        const self = this;
        this._initLog();
        return this.run( 
            [
                DIFF_MODE, 
                time,
                JSON.stringify(this.options)
            ],
            function(code, log){
                self.running = false;
                callback.call(self, code, log);
            }
        );
    }

    /**
     * spawn chromeheadless
     * @param {Array} args
     * @param {Function} callback
     * @returns {*}
     * @private
     */
    async run(args, callback){
        const mode = parseInt(args[0]);
        log('mode: ' + mode);
        try {
            puppeteer.launch().then(async browser => {
                if(mode === CAPTURE_MODE){ 
                    // capture
                    let m = new M(JSON.parse(args[2]), browser);
                    if (Array.isArray(this.urls)) {
                        const time = Date.now();
                        const captures = this.urls.map(async (url, index) => {
                            return await m.capture(url, time);
                        })
                        Promise.all(captures).then(async () => {
                            console.log('####')
                            await browser.close(); 
                        })
                    } else {
                        throw new TypeError('urls must be array');
                    }
                } else if(mode === DIFF_MODE){ 
                    // diff only
                    let m = new M(JSON.parse(args[2]), browser);
                    m.diff(args[1]);
                }
            });
        } catch (e) {
            console.log(e)
        }


        
        //const childProcess = await browser.process();
        // try {
        //     const childProcess = spawn(PHANTOMJS_SCRIPT_FILE, arr);
        //     childProcess.stdout.on('data', this._parseLog.bind(this));
        //     childProcess.stderr.on('data', this._parseLog.bind(this));
        //     childProcess.on('exit', function(code){
        //         callback(code);
        //     });
        //     return childProcess;
        // } catch(e) {
        //     console.log(e)
        // }

    
    };

    

    /**
     * parse log from phantom
     * @param {String} msg
     * @private
     */
    _parseLog(msg) {
        var self = this;
        String(msg || '').split(LOG_SPLIT_REG).forEach(function(item){
            item = item.trim();
            if(item){
                var type = 'debug';
                item = item.replace(LOG_TYPE_REG, function(m, $1){
                    type = LOG_VALUE_MAP[$1] || type;
                    return '';
                });
                self.emit(type, item);
                if(self.log.hasOwnProperty(type)){
                    self.log[type].push(item);
                }
            }
        });
    };


}

// inherit from EventEmitter
util.inherits(Monitor, EventEmitter);

module.exports = Monitor;
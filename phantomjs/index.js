const puppeteer = require("puppeteer");
const devices = require("puppeteer/DeviceDescriptors");
const iPhone = devices["iPhone 6"];
const fs = require("fs");
const URL = require("url");
const log = require("./log.js");
const path = require("path");

const _ = require("../util.js");
const diff = require("./diff.js");
const walk = require("./walk.js");
const highlight = require("./highlight.js");

let BROWSER = null;
let PAGE = null;

// generate communication token
const TOKEN = _.unique();

// constant values
const LATEST_FILENAME = "latest";
const LATEST_LOG_FILENAME = "latest.log";
const CACHE_JSON_FILENAME = "cache.json";
const SCREENSHOT_FILENAME = "screenshot";
const INFO_FILENAME = "info.json";
const TREE_FILENAME = "tree.json";
const HIGHLIGHT_HTML_FILENAME = "highlight.html";

const FORMAT_MAP = {
  png: "png",
  gif: "gif",
  jpeg: "jpeg",
  jpg: "jpeg",
  pdf: "pdf"
};

function Flattern(arr) {
  var newArr = arr.reduce(function(pre, cur) {
    return pre.concat(cur);
  });
  return newArr;
}

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
    this.latest = LATEST_FILENAME + "/" + LATEST_LOG_FILENAME;
    this.cacheFile = LATEST_FILENAME + "/" + CACHE_JSON_FILENAME;
    this.root = opts.path.root;
    this.options.diff.changeType = {
      ADD: 1, // 0001
      REMOVE: 2, // 0010
      STYLE: 4, // 0100
      TEXT: 8 // 1000
    };
  }
  /**
   * get info of the latest save
   * @returns {object|boolean}
   */
  getLatestTree(url) {
    const urlPath = URL.parse(url).pathname.replace("/", "_");
    const root = URL.parse(url).host;
    if (fs.existsSync(this.latest)) {
      const manifest = JSON.parse(
        fs
          .readFileSync(this.latest)
          .toString()
          .trim()
      );
      const time = manifest[url];
      if (time) {
        // TODO: 支持多页面
        var tree = root + "/" + time + "/" + urlPath + "_" + TREE_FILENAME;
        if (fs.existsSync(tree)) {
          var content = fs
            .readFileSync(tree)
            .toString()
            .trim();
          return {
            time: time,
            file: tree,
            content: content
          };
        }
      }
    }
    return false;
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
      ext: "png"
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
  save(page, url, tree, rect, time) {
    return new Promise(async (resolve, reject) => {
      if (_.is(tree, "Object")) {
        tree = JSON.stringify(tree);
      }
      const { host, pathname } = URL.parse(url);
      const root = host;
      const dir = root + "/" + time;
      const pathNameDir = dir + "/" + pathname.replace(/\//g, "_");
      const urlPath = pathname.replace(/\//g, "_");
      if (fs.existsSync(dir + "/" + urlPath + "_" + TREE_FILENAME)) {
        reject("file exits");
        return;
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }
      if (!fs.existsSync(pathNameDir)) {
        fs.mkdirSync(pathNameDir);
      }
      log(`SAVE CAPTURE [${dir}]`);
      const opt = this.getRenderOptions();
      const screenshot = `${pathNameDir}/${SCREENSHOT_FILENAME}.${opt.ext}`;
      log("SCREENSHOT [" + screenshot + "]");
      log(`RECT [${rect}]`);
      await page.evaluate(function() {
        const elem = document.documentElement;
        elem.style.backgroundColor = "#fff";
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
      fs.writeFileSync(pathNameDir + "/" + TREE_FILENAME, tree);
      fs.writeFileSync(
        pathNameDir + "/" + INFO_FILENAME,
        JSON.stringify({
          time: time,
          url: url
        })
      );
      this.saveToFile(url, time);
      resolve({
        time: time,
        dir: dir,
        screenshot: screenshot
      });
    });
  }

  saveToFile(url, time) {
    const pathname = URL.parse(url).pathname.replace("/", "");
    if (fs.existsSync(this.latest)) {
      const manifest = this.parseJSONFromFile(this.latest);
      manifest[url] = time;
      fs.writeFileSync(this.latest, JSON.stringify(manifest));
    } else {
      const manifest = {};
      manifest[url] = time;
      fs.writeFileSync(this.latest, JSON.stringify(manifest));
    }
    //cache {time => path => url} mapping
    if (fs.existsSync(this.cacheFile)) {
      const manifest = this.parseJSONFromFile(this.cacheFile);
      console.log(manifest[time], pathname);
      if (manifest[time] && Array.isArray(manifest[time][pathname])) {
        console.log(111);
        manifest[time][pathname].push(url);
      } else if (manifest[time]) {
        manifest[time][pathname] = [url];
      } else {
        const hostManifest = {};
        hostManifest[pathname] = [url];
        manifest[time] = hostManifest;
      }
      fs.writeFileSync(this.cacheFile, JSON.stringify(manifest));
    } else {
      const manifest = {};
      const hostManifest = {};
      hostManifest[pathname] = [url];
      manifest[time] = hostManifest;
      fs.writeFileSync(this.cacheFile, JSON.stringify(manifest));
    }
  }

  parseJSONFromFile(filePath) {
    return JSON.parse(
      fs
        .readFileSync(filePath)
        .toString()
        .trim()
    );
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
  async highlight(time, pathName, diff, lOffset, rOffset) {
    const root = this.root;
    const { left, right } = this.getPathDirByTimeAndPath(time, pathName);
    log("diff [" + left.url + "] width [" + right.url + "]");
    log("has [" + diff.length + "] changes");
    const render = this.getRenderOptions();
    const lScreenshot =
      left.pathNameDir + "/" + SCREENSHOT_FILENAME + "." + render.ext;
    const rScreenshot =
      right.pathNameDir + "/" + SCREENSHOT_FILENAME + "." + render.ext;
    const dScreenshot =
      root +
      "/diff/" +
      URL.parse(left.url).pathname.replace("/", "") +
      "." +
      render.ext;

    if (!fs.existsSync(root + "/diff/")) {
      fs.mkdirSync(root + "/diff/");
    }
    const html = __dirname + "/" + HIGHLIGHT_HTML_FILENAME;
    let url = "file://" + "" + html + "?";
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
      path.relative(path.dirname(html), lScreenshot),
      path.relative(path.dirname(html), rScreenshot),
      URL.parse(left.url).host,
      URL.parse(right.url).host
    ].join("|");
    log("start highlight [" + url + "]");
    const options = this.options;
    const page = await this.createPage(url);
    log("highlight done");
    const count = await page.evaluate(
      highlight,
      this.token,
      diff,
      lOffset,
      rOffset,
      options.diff
    );
    var info = {
      left,
      right,
      screenshot: dScreenshot,
      count
    };
    // log('==== START WALK TREE====');
    // const { rect } = await page.evaluate(walk, this.token, options.walk);
    // log('====  END  WALK TREE====');
    log("====  Start Screenshot ====");
    log(`Screenshot Path: [${dScreenshot}]`);
    await page.screenshot({
      path: dScreenshot
      // clip: {
      //     x: rect[0],
      //     y: rect[1],
      //     width: rect[2],
      //     height: rect[3]
      // }
    });
    log("====  End Screenshot ====");
    await this.close(page);
    return info;
  }

  /**
   * page capture
   * @param {string} url
   * @param {boolean} needDiff
   */
  async capture(url, time) {
    const options = this.options;
    log(`Loading Page: [${url}]`);
    const page = await this.createPage(url);
    log(`Loadded Page: [${url}]`);
    log("==== START WALK TREE====");
    const right = await page.evaluate(walk, this.token, options.walk);
    log("====  END  WALK TREE====");
    const rect = right.rect;
    const json = JSON.stringify(right);
    const latest = this.getLatestTree(url);
    console.log("latest", latest);
    if (latest.content === json) {
      // no change, not capture and diff
      log("No CHANGE");
    } else if (latest === false) {
      // only capture
      await this.save(page, url, json, rect, time);
    } else {
      // diff with lastest capture
      // const left = JSON.parse(latest.content);
      // right = JSON.parse(json);
      // const ret = diff(left, right, options.diff);
      // if(ret.length){
      //     var info = await this.save(page, url, json, rect, now);
      //     var lOffset = { x: left.rect[0], y: left.rect[1] };
      //     var rOffset = { x: right.rect[0], y: right.rect[1] };
      //     this.highlight(latest.time, now, ret, lOffset, rOffset, function(diff){
      //         info.diff = diff;
      //         log(JSON.stringify(info), _.log.INFO);
      //     });
      // } else {
      //     log('No CHANGE');
      // }
    }
    await this.close(page);
  }

  /**
   * get tree object by time
   * @param {string} url
   * @param {string|number} time
   * @returns {object|undefined}
   */
  getTree(url, time) {
    const root = URL.parse(url).host;
    const dir = root + "/" + time;
    const pathNameDir = dir + "/" + URL.parse(url).pathname.replace(/\//g, "_");
    const file = pathNameDir + "/" + TREE_FILENAME;
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file));
    }
  }

  getPathDirByTimeAndPath(time, pathName) {
    const cacheUrls = this.getCacheFile(time);
    const dirList = cacheUrls[pathName].map(url => {
      const root = URL.parse(url).host;
      const dir = root + "/" + time;
      const pathNameDir =
        dir + "/" + URL.parse(url).pathname.replace(/\//g, "_");
      return {
        pathNameDir: pathNameDir,
        url
      };
    });
    return {
      left: dirList[0],
      right: dirList[1]
    };
  }

  getCacheFile(time) {
    if (fs.existsSync(this.cacheFile)) {
      return this.parseJSONFromFile(this.cacheFile)[time];
    }
    return false;
  }

  /**
   * TODO: support multiple page diff
   * page diff
   * @param {string} time
   */
  diff(time) {
    var options = this.options;
    const cacheUrls = this.getCacheFile(time);
    console.log(cacheUrls);
    const treeList = Object.keys(cacheUrls).map(key => {
      const trees = cacheUrls[key].map(url => this.getTree(url, time));
      return {
        pathName: key,
        trees
      };
    });
    console.log(treeList);
    treeList.forEach(async ({ trees, pathName }) => {
      const lTree = trees[0];
      const rTree = trees[1];
      try {
        if (lTree && rTree) {
          var ret = diff(lTree, rTree, options.diff);
          if (ret.length) {
            var lOffset = { x: lTree.rect[0], y: lTree.rect[1] };
            var rOffset = { x: rTree.rect[0], y: rTree.rect[1] };
            const info = await this.highlight(
              time,
              pathName,
              ret,
              lOffset,
              rOffset
            );
            log(JSON.stringify(info), _.log.INFO);
          } else {
            log("no change", _.log.WARNING);
          }
        } else if (lTree) {
          throw new Error("missing right record [" + right + "]");
        } else {
          throw new Error("missing left record [" + right + "]");
        }
      } catch (e) {
        console.log(e);
      }
    });
  }

  /**
   * create webpage and bind events
   * @param {string} url
   * @param {Function} onload
   */
  async createPage(url) {
    const options = this.options.page.viewportOpts || {};
    const page = await this.browser.newPage();
    await page.emulate(iPhone);
    await page.goto(url);
    page.on("error", async (msg, trace) => {
      var msgStack = [msg];
      if (trace && trace.length) {
        msgStack.push("TRACE:");
        trace.forEach(function(t) {
          msgStack.push(
            " -> " +
              (t.file || t.sourceURL) +
              ": " +
              t.line +
              (t.function ? " (in function " + t.function + ")" : "")
          );
        });
      }
      log(msgStack.join("\n"), _.log.ERROR);
      await this.close(page);
    });
    page.on("console", msg => {
      for (let i = 0; i < msg.args().length; ++i) {
        const jsHandleValue = msg.args()[i];
        jsHandleValue.jsonValue().then(value => {
          log(`=======${i}=======`);
          console.log(value);
        });
      }
    });
    return page;
  }

  async close(page) {
    // only close page
    try {
      log("close page and browser");
      await page.close();
    } catch (e) {
      log(`ERROR: ${e}`);
    }
  }
}
module.exports = M;

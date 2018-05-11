const Monitor = require('./index.js');
process.on('unhandledRejection', (reason, p) => {
    console.error('检测到有未catch到的Promise: ', p, ' reason: ', reason);
});

var monitor = new Monitor({
    protocol: 'http',
    hosts: ['store.meituan.com', 'store.sjst.test.sankuai.com'],
    pathToCompare: ['/home', '/cart', '/user']
});

monitor.on('debug', function (data) {
    console.log('[DEBUG] ' + data);
});

monitor.on('error', function (data) {
    console.error('[ERROR] ' + data);
});

// monitor.capture(function(code){
//     console.log('[DONE] exit [' + code + ']');
// }, true);

monitor.diff(1526032257109, function(code){
    console.log(monitor.log.info); // diff result
    console.log('[DONE] exit [' + code + ']');
});
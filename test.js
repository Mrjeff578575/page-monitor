const Monitor = require('./index.js');
var monitor = new Monitor({
    url: 'https://store.meituan.com/home'
});
monitor.on('debug', function (data) {
    console.log('[DEBUG] ' + data);
});
monitor.on('error', function (data) {
    console.error('[ERROR] ' + data);
});
// monitor.capture(function(code){
//     console.log(monitor.log.info); // diff result
//     console.log('[DONE] exit [' + code + ']');
// });
monitor.diff(1521169517821, 1521170762927, function(code){
    console.log(monitor.log.info); // diff result
    console.log('[DONE] exit [' + code + ']');
});
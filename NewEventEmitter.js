/**
 * why not events.EventEmitter?
 * because it can NOT emit an 'error' event,
 * but i need, fuck off.
 * @constructor
 */
var EventEmitter = function(){
    this._listeners = {};
};

/**
 * add event listener
 * @param {string} type
 * @param {Function} callback
 */
EventEmitter.prototype.on = function(type, callback){
    if(!this._listeners.hasOwnProperty(type)){
        this._listeners[type] = [];
    }
    this._listeners[type].push(callback);
};

/**
 * remove event listener
 * @param {string} type
 * @param {Function} callback
 */
EventEmitter.prototype.off = function(type, callback){
    if(this._listeners.hasOwnProperty(type)){
        var listeners = [];
        for(var i = 0, len = this._listeners[type].length; i < len; i++){
            var listener = this._listeners[type][i];
            if(listener !== callback){
                listeners.push(listener);
            }
        }
        this._listeners[type] = listeners;
    }
};

/**
 * dispatch event
 * @param {string} type
 */
EventEmitter.prototype.emit = function(type){
    if(this._listeners.hasOwnProperty(type)){
        var args = [].splice.call(arguments, 1);
        var self = this;
        this._listeners[type].forEach(function(callback){
            callback.apply(self, args);
        });
    }
};
module.exports = EventEmitter;
var serialport = require('serialport');
var util = require('util');
var EventEmitter = require('events');

var debug = function() {};

function WaterRower( opts ) {
  var opts = opts || {};
  EventEmitter.call(this);
  this.comPort = opts.port || "";
  this.baudRate = opts.baudRate || 115200;
  this.pollRate = opts.pollRate || 800;

  debug("Creating new water rower");
  debug("\tlistening on port " + this.comPort);
  debug('\tlistening at rate ' + this.rate);
  debug('\tpolling at rate ' + this.pollRate);

  this.serialPort = new serialport.SerialPort( this.comPort, {
    baudrate: this.baudRate,
    disconnectedCallback: function () { this.emit('disconnect'); }.bind(this),
    parser: serialport.parsers.readline("\n")
  });

  this.serialPort.on("error", function( err ) {
    debug('port ' + this.comPort + ' error ' + err);
    this.emit('error', err);
  }.bind(this));
  this.serialPort.on("open", function () {
    debug('port ' + this.comPort + ' open');
    this.serialPort.write('USB\r\n', function(err, res){
      if (err) {
        this.emit('error', err);
      } else {
        this.emit('connect');
      }
    }.bind(this));
  }.bind(this));
  this.serialPort.on("closed", function () {
    debug('port ' + this.comPort + ' closed');
    this.emit('disconnect');
  }.bind(this));
  this.serialPort.on("data", function(data) {
    var trimmedData = data.trim();
    debug('port ' + this.port + ' read ' + trimmedData );
    this.dispatchRWMessage( data );
  }.bind(this));

  //function e() { this.emit('row', {row:1}); setTimeout(e.bind(this), 1000); };
}
util.inherits(WaterRower, EventEmitter);

WaterRower.prototype.dispatchRWMessage = function( msg ) {
  debug('port ' + this.port + ' dispatch ' + msg );
};

module.exports = function( opts ){
  var opts = opts || {};

  if (opts.debug) {
    debug = console.log;
  }
  return {
    WaterRower: WaterRower
  };
}

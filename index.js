var serialport = require('serialport');
var util = require('util');
var EventEmitter = require('events');

var debug = function() {};

var kStates = {
  disconnected: 'disconnected',
  connected: 'connected',

};

function WaterRower( opts ) {
  var opts = opts || {};
  EventEmitter.call(this);

  this.state = kStates.disconnected;
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
    this.state = kStates.disconnected;
  }.bind(this));
  this.serialPort.on("open", function () {
    debug('port ' + this.comPort + ' open');

    // tell the waterrower that we're wanting to talk to it.
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
    this.state = kStates.disconnected;
  }.bind(this));
  this.serialPort.on("data", function(data) {
    var trimmedData = data.trim();
    debug('port ' + this.comPort + ' read ' + trimmedData );
    this.ingestRWMessage( data );
  }.bind(this));
}
util.inherits(WaterRower, EventEmitter);

WaterRower.prototype.ingestRWMessage = function( msg ) {
  debug('port ' + this.comPort + ' dispatch ' + msg );
  if (this.state === kStates.disconnected) {
    if (msg === '_WR_\r\n') {
      this.state = kStates.connected;
    }
  } else if (this.state === kStates.connected) {
  }
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

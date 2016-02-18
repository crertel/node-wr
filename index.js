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
  this.lastPing = null;
  this.stateHandler = this.stateDisconnected;

  this.readings = {
    strokeCount: 0,
    totalSpeed: 0,
    averageSpeed: 0,
    distance: 0,
    heartRate: 0
  };

  debug("Creating new water rower");
  debug("\tlistening on port " + this.comPort);
  debug('\tlistening at rate ' + this.rate);
  debug('\tpolling at rate ' + this.pollRate);

  this.serialPort = new serialport.SerialPort( this.comPort, {
    baudrate: this.baudRate,
    disconnectedCallback: function () { this.emit('disconnect'); }.bind(this),
    parser: serialport.parsers.readline("\r\n")
  });

  this.serialPort.on("open", function () {
    debug('port ' + this.comPort + ' open');

    // tell the waterrower that we're wanting to talk to it.
    this.serialPort.write('USB\r\n');
  }.bind(this));

  this.serialPort.on("data", function(data) {
    var trimmedData = data.trim();
    debug('port ' + this.comPort + ' read ' + trimmedData );
    this.ingestMessage( data );
  }.bind(this));

  this.serialPort.on("closed", function () {
    debug('port ' + this.comPort + ' closed');
    this.emit('disconnect');
  }.bind(this));

  this.serialPort.on("error", function( err ) {
    debug('port ' + this.comPort + ' error ' + err);
    this.emit('error', err);
  }.bind(this));
}
util.inherits(WaterRower, EventEmitter);

var msgOnline = /^_WR_$/;
var msgPing = /^PING$/;
var msgError = /^ERROR$/;
var msgStrokeStart = /^SS$/;
var msgStrokeEnd = /^SE$/;
var msgStrokePulse = /^P([\dA-Fa-f]{2})$/;
var msgStrokeCount = /^IDD140([\dA-Fa-f]{4})$/;
var msgTotalSpeed = /^IDD148([\dA-Fa-f]{4})$/;
var msgAverageSpeed = /^IDD14A([\dA-Fa-f]{4})$/;
var msgDistance = /^IDD057([\dA-Fa-f]{4})$/;
var msgHeartrate = /^IDD1A0([\dA-Fa-f]{4})$/;

WaterRower.prototype.ingestMessage = function( msg ) {
  debug('port ' + this.comPort + ' dispatch ' + msg );

  // we consider *any* message, not just PING, as a confirmation of the controllers existence
  this.lastPing = Date.now();

  switch(true) {

    case msgError.test(msg):          this.emit('error', 'error from water rower');
                                      break;
    case msgStrokeStart.test(msg):    this.emit('stroke start');
                                      break;
    case msgStrokeEnd.test(msg):      this.emit('stroke end');
                                      break;
    case msgPing.test(msg):           // fallthrough
    default:                          this.stateHandler = this.stateHandler( msg );
                                      break;
  }
};

WaterRower.prototype.stateDisconnected = function ( msg ) {
  debug('in state disconnected ' + msg);

  if ( msgOnline.test(msg) ) {
    this.emit('connect');
    this.serialPort.emit('data', "let's start this party");
    return this.stateConnected;
  } else {
    return this.stateDisconnected;
  }
}

WaterRower.prototype.stateConnected = function ( msg ) {
  debug('in state connected');
  // in the conected state, we only care about starting the stroke_count chain
  this.emit('readings', this.readings);
  this.serialPort.write('IRD1400\r\n');
  return this.stateAwaitingStrokeCount;
}

WaterRower.prototype.stateAwaitingStrokeCount = function ( msg ) {
  debug('in state awaiting stroke count');

  var matches = msg.match(msgStrokeCount);
  if (matches){
    // parse out the stroke count in the 'IDD140??\r\n' message,
    this.readings.strokeCount = Number.parseInt( matches[1], 16);

    this.serialPort.write('IRD148\r\n');
    return this.stateAwaitingTotalSpeed;
  } else {
    return this.stateAwaitingStrokeCount;
  }
}

WaterRower.prototype.stateAwaitingTotalSpeed = function ( msg ) {
  debug('in state awaiting total speed');

  var matches = msg.match(msgTotalSpeed);
  if (matches){
    // parse out the total speed in the 'IDD148??\r\n' message,
    this.readings.totalSpeed = Number.parseInt( matches[1], 16);

    this.serialPort.write('IRD14A\r\n');
    return this.stateAwaitingAverageSpeed;
  } else {
    return this.stateAwaitingTotalSpeed;
  }
}

WaterRower.prototype.stateAwaitingAverageSpeed = function ( msg ) {
  debug('in state awaiting average speed');

  var matches = msg.match(msgAverageSpeed);
  if (matches) {
    // parse out the average speed in the 'IDD057??\r\n' message,
    this.readings.averageSpeed = Number.parseInt( matches[1], 16);

    this.serialPort.write('IRD057\r\n');
    return this.stateAwaitingDistance;
  } else {
    return this.stateAwaitingAverageSpeed;
  }
}

WaterRower.prototype.stateAwaitingDistance = function ( msg ) {
  debug('in state awaiting distance');

  var matches = msg.match(msgDistance);
  if (matches){
    // parse out the distance in the 'IDD057??\r\n' message,
    this.readings.distance = Number.parseInt( matches[1], 16);

    this.serialPort.write('IRD1A0\r\n');
    return this.stateAwaitingHeartrate;
  } else {
    return this.stateAwaitingDistance;
  }
}

WaterRower.prototype.stateAwaitingHeartrate = function ( msg ) {
  debug('in state awaiting heart rate');

  var matches = msg.match(msgHeartrate);
  if (matches){
    // parse out the stroke count in the 'IDD057??\r\n' message,
    this.readings.heartRate = Number.parseInt( matches[1], 16);

    this.serialPort.write('IRD057\r\n');
    return this.stateConnected;
  } else {
    return this.stateAwaitingHeartrate;
  }
}

module.exports = function( opts ){
  var opts = opts || {};

  if (opts.debug) {
    debug = console.log;
  }
  return {
    WaterRower: WaterRower
  };
}

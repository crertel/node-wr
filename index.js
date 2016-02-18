var serialport = require('serialport');
var util = require('util');
var EventEmitter = require('events');

var debug = function() {};

var kStates = {
  disconnected: 'disconnected',
  connected: 'connected',
  expectStrokeCount: 'expectStrokeCount',
  expectTotalSpeed: 'expectTotalSpeed',
  expectAverageSpeed: 'expectAverageSpeed',
  expectDistance: 'expectDistance',
  expectHeartRate: 'expectHeartRate'
};

function WaterRower( opts ) {
  var opts = opts || {};
  EventEmitter.call(this);

  this.state = kStates.disconnected;
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
    parser: serialport.parsers.readline("\n")
  });

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

  this.serialPort.on("data", function(data) {
    var trimmedData = data.trim();
    debug('port ' + this.comPort + ' read ' + trimmedData );
    this.ingestMessage( data );
  }.bind(this));

  this.serialPort.on("closed", function () {
    debug('port ' + this.comPort + ' closed');
    this.emit('disconnect');
    this.state = kStates.disconnected;
  }.bind(this));

  this.serialPort.on("error", function( err ) {
    debug('port ' + this.comPort + ' error ' + err);
    this.emit('error', err);
    this.state = kStates.disconnected;
  }.bind(this));
}
util.inherits(WaterRower, EventEmitter);

var msgPing = /^PING\r\n$/;
var msgError = /^ERROR\r\n$/;
var msgStrokeStart = /^SS\r\n$/;
var msgStrokeEnd = /^SE\r\n$/;
var msgStrokePulse = /^P(\d|[A-Fa-f]){2}\r\n$/;
var msgStrokeCount = /^IDD140(\d|[A-Fa-f]){2}\r\n$/;
var msgTotalSpeed = /^IDD148(\d|[A-Fa-f]){2}\r\n$/;
var msgAverageSpeed = /^IDD14A(\d|[A-Fa-f]){2}\r\n$/;
var msgDistance = /^IDD057(\d|[A-Fa-f]){2}\r\n$/;
var msgHeartrate = /^IDD1A0(\d|[A-Fa-f]){2}\r\n$/;

WaterRower.prototype.ingestMessage = function( msg ) {
  debug('port ' + this.comPort + ' dispatch ' + msg );

  // we consider *any* message, not just PING, as a confirmation of the controllers existence
  this.lastPing = Date.now();

  switch(true) {
    case msgPing.test(msg):           break;
    case msgError.test(msg):          this.emit('error', 'error from water rower');
                                      break;
    case msgStrokeStart.test(msg):    this.emit('stroke start');
                                      break;
    case msgStrokeEnd.test(msg):      this.emit('stroke end');
                                      break;
    default:                          this.stateHandler = this.stateHandler( msg );
                                      break;
  }
};

WaterRower.prototype.stateDisconnected = function ( msg ) {
  return (msg==='_WR_\r\n') ? this.stateConnected : this.stateDisconnected;
}

WaterRower.prototype.stateConnected = function ( msg ) {
  // in the conected state, we only care about starting the stroke_count chain
  this.emit('readings', this.readings);  
  this.serialPort.write('IRD1400\r\n');
  return this.stateAwaitingStrokeCount;
}

WaterRower.prototype.stateAwaitingStrokeCount = function ( msg ) {
  // when awaiting stroke count, we only care about a certain message
  if (msgStrokeCount.test(msg)){
    // parse out the stroke count in the 'IDD140??\r\n' message,
    this.readings.strokeCount = Number.parseInt( msg.substring(6), 16);

    this.serialPort.write('IRD148\r\n');
    return this.stateAwaitingTotalSpeed;
  } else {
    return this.stateAwaitingStrokeCount;
  }
}

WaterRower.prototype.stateAwaitingTotalSpeed = function ( msg ) {
  // when awaiting stroke count, we only care about a certain message
  if (msgTotalSpeed.test(msg)){
    // parse out the total speed in the 'IDD148??\r\n' message,
    this.readings.totalSpeed = Number.parseInt( msg.substring(6), 16);

    this.serialPort.write('IRD14A\r\n');
    return this.stateAwaitingAverageSpeed;
  } else {
    return this.stateAwaitingTotalSpeed;
  }
}

WaterRower.prototype.stateAwaitingAverageSpeed = function ( msg ) {
  // when awaiting stroke count, we only care about a certain message
  if (msgAverageSpeed.test(msg)){
    // parse out the stroke count in the 'IDD057??\r\n' message,
    this.readings.averageSpeed = Number.parseInt( msg.substring(6), 16);

    this.serialPort.write('IRD057\r\n');
    return this.stateAwaitingDistance;
  } else {
    return this.stateAwaitingAverageSpeed;
  }
}

WaterRower.prototype.stateAwaitingDistance = function ( msg ) {
  // when awaiting stroke count, we only care about a certain message
  if (msgAverageSpeed.test(msg)){
    // parse out the stroke count in the 'IDD057??\r\n' message,
    this.readings.averageSpeed = Number.parseInt( msg.substring(6), 16);

    this.serialPort.write('IRD1A0\r\n');
    return this.stateAwaitingHeartrate;
  } else {
    return this.stateAwaitingDistance;
  }
}

WaterRower.prototype.stateAwaitingHeartrate = function ( msg ) {
  // when awaiting stroke count, we only care about a certain message
  if (msgAverageSpeed.test(msg)){
    // parse out the stroke count in the 'IDD057??\r\n' message,
    this.readings.averageSpeed = Number.parseInt( msg.substring(6), 16);

    this.serialPort.write('IRD057\r\n');
    return this.conected;
  } else {
    return this.stateAwaitingDistance;
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

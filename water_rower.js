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
    strokeAvgTime: 0,     // ?
    strokeAvgPull: 0,     // ?
    strokeCount: 0,       // number
    totalSpeed: 0,        // cm/s
    averageSpeed: 0,      // cm/s
    distance: 0,          // m
    heartRate: 0          // bpm
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
var msgOkay = /^OK$/;
var msgInteractive = /^AIA$/;
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
var msgStrokeInfo = /^IDD142([\dA-Fa-f]{2})([\dA-Fa-f]{2})$/;
var msgKeypress = /^AK([123456789Rr]{1})$/;

WaterRower.prototype.ingestMessage = function( msg ) {
  debug('port ' + this.comPort + ' dispatch ' + msg );

  // we consider *any* message, not just PING, as a confirmation of the controllers existence
  this.lastPing = Date.now();

  // handle key presses
  var keypress = msg.match(msgKeypress);
  if (keypress) {
    this.emit('keypad', keypress[1] );
  } else {
    // handle other messages
    switch(true) {
      case msgStrokeStart.test(msg):    this.emit('stroke start');
                                        break;
      case msgStrokeEnd.test(msg):      this.emit('stroke end');
                                        break;
      case msgPing.test(msg):           // fallthrough
      case msgError.test(msg):          // fallthrough
      default:                          this.stateHandler = this.stateHandler( msg );
                                        break;
    }

  }
};

WaterRower.prototype.shutdown = function () {
  debug('requesting shutdown');
  this.stateHandler = this.stateShuttingDown;
}

WaterRower.prototype.stateShuttingDown = function () {
  debug('in state shutdown');
  this.serialPort.write('EXIT\r\n');
  return this.stateShuttingDown;
}

WaterRower.prototype.stateDisconnected = function ( msg ) {
  debug('in state disconnected ' + msg);

  if ( msgOnline.test(msg) ) {
    this.emit('connect');
    //this.serialPort.emit('data', "let's start this party");
    this.serialPort.write('RESET\r\n');

    return this.statePreconnect1;
  } else {
    return this.stateDisconnected;
  }
}

WaterRower.prototype.statePreconnect1 = function ( msg ) {
  debug('in state preconnect 1' + msg);

  if ( msgOkay.test(msg) ) {
    this.serialPort.write('AIS\r\n');
    return this.statePreconnect2;
  } else {
    return this.statePreconnect1;
  }
}

WaterRower.prototype.statePreconnect2 = function ( msg ) {
  debug('in state preconnect 2' + msg);

  if ( msgInteractive.test(msg) ) {
    this.emit('connect');
    this.serialPort.emit('data', "let's start this party");
    return this.stateConnected;
  } else {
    return this.statePreconnect2;
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
    this.readings.heartRate = Number.parseInt( matches[1], 16);

    this.serialPort.write('IRD142\r\n');
    return this.stateAwaitingStrokeInfo;
  } else {
    return this.stateAwaitingHeartrate;
  }
}

WaterRower.prototype.stateAwaitingStrokeInfo = function ( msg ) {
  debug('in state awaiting heart rate');

  var matches = msg.match(msgStrokeInfo);
  if (matches){
    this.readings.strokeAvgTime = Number.parseInt( matches[1], 16);
    this.readings.strokeAvgPull = Number.parseInt( matches[2], 16);

    this.serialPort.write('IRD057\r\n');
    return this.stateConnected;
  } else {
    return this.stateAwaitingStrokeInfo;
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

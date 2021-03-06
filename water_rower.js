var serialport = require('serialport');
var util = require('util');
var EventEmitter = require('events');

var debug = function() {};

function WaterRower( opts ) {
  var opts = opts || {};
  EventEmitter.call(this);

  this.comPort = opts.port || "";
  this.baudRate = opts.baudRate || 19200;//115200;
  this.pollRate = opts.pollRate || 800;
  this.lastPing = null;
  this.stateHandler = this.stateDisconnected;

  this.readings = {
    strokesPerMinute: 0,  // "stroke_pull is first subtracted from stroke_average then a modifier of 1.25 multipled by the result to generate the ratio value for display"
    strokeCount: 0,       // number
    totalSpeed: 0,        // cm/s
    averageSpeed: 0,      // cm/s
    distance: 0,          // m
    heartRate: 0,         // bpm
    displayTimeSeconds: 0,
    displayTimeMinutes: 0,
    displayTimeHours: 0
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
var msgStrokeRate = /^IDS1A9([\dA-Fa-f]{2})$/;
var msgKeypress = /^AK([123456789Rr]{1})$/;
var msgWorkoutTime = /^IDT1E1([\dA-Fa-f]{2})([\dA-Fa-f]{2})([\dA-Fa-f]{2})$/;

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

var kMsgWriteDelay = 25; // wait at least 25 milleseconds as per manual
WaterRower.prototype.delayedWrite = function( msg ) {
  setTimeout( function() {
    this.serialPort.write(msg);
  }.bind(this), kMsgWriteDelay);
}

WaterRower.prototype.stateShuttingDown = function () {
  debug('in state shutdown');
  this.delayedWrite('EXIT\r\n');
  return this.stateShuttingDown;
}

WaterRower.prototype.stateDisconnected = function ( msg ) {
  debug('in state disconnected ' + msg);

  if ( msgOnline.test(msg) ) {
    this.emit('connect');
    this.delayedWrite('RESET\r\n');

    return this.statePreconnect;
  } else {
    return this.stateDisconnected;
  }
}

WaterRower.prototype.statePreconnect = function ( msg ) {
  debug('in state preconnect' + msg);

  if ( msgOkay.test(msg) ) {
    this.emit('connect');
    this.serialPort.emit('data', "let's start this party");
    return this.stateConnected;
  } else {
    return this.statePreconnect;
  }
}

WaterRower.prototype.stateConnected = function ( msg ) {
  debug('in state connected');
  // in the conected state, we only care about starting the stroke_count chain
  this.emit('readings', this.readings);
  this.delayedWrite('IRD1400\r\n');
  return this.stateAwaitingStrokeCount;
}

WaterRower.prototype.stateAwaitingStrokeCount = function ( msg ) {
  debug('in state awaiting stroke count');

  var matches = msg.match(msgStrokeCount);
  if (matches){
    // parse out the stroke count in the 'IDD140??\r\n' message,
    this.readings.strokeCount = Number.parseInt( matches[1], 16);

    this.delayedWrite('IRD148\r\n');
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

    this.delayedWrite('IRD14A\r\n');
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

    this.delayedWrite('IRD057\r\n');
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

    this.delayedWrite('IRD1A0\r\n');
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

    //this.delayedWrite('IRD142\r\n');
    this.delayedWrite('IRS1A9\r\n');
    return this.stateAwaitingStrokeInfo;
  } else {
    return this.stateAwaitingHeartrate;
  }
}

WaterRower.prototype.stateAwaitingStrokeInfo = function ( msg ) {
  debug('in state awaiting stroke info');

  var matches = msg.match(msgStrokeRate);
  if (matches){
    this.readings.strokesPerMinute = Number.parseInt( matches[1], 16);

    this.delayedWrite('IRT1E1\r\n');
    return this.stateAwaitingWorkoutTime;
  } else {
    return this.stateAwaitingStrokeInfo;
  }
}

WaterRower.prototype.stateAwaitingWorkoutTime = function ( msg ) {
  debug('in state awaiting total workout time');

  var matches = msg.match(msgWorkoutTime);
  if (matches){
    this.readings.displayTimeSeconds =  Number.parseInt( matches[3], 10);
    this.readings.displayTimeMinutes =  Number.parseInt( matches[2], 10);
    this.readings.displayTimeHours =    Number.parseInt( matches[1], 10);

    this.delayedWrite('IRD057\r\n');
    return this.stateConnected;
  } else {
    return this.stateAwaitingWorkoutTime;
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

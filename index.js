var parseArgs = require('minimist');
var argv = parseArgs( process.argv , {
  number: [ 'port' ],
  string: [ 'comport' ],
  boolean: [ 'debug']
});

var port = argv.port || 'NULL';
var debug = argv.debug || false;
var comport = argv.comport;

console.log('Starting water rower.');
console.log('\tPort: ', argv.port);
console.log('\tCom port: ', argv.comport);
console.log('\tDebug: ', debug);


var server = require('http').createServer()
var ws = require('ws');
var url = require('url')
var WebSocketServer = ws.Server
var wsServer = new WebSocketServer({ server: server });

var wr = require('./water_rower.js')({ debug: debug} );
var express = require('express');
var app = express();
app.get('/', express.static(__dirname+'/public') );

var rower;

function broadcastClients(msg){
  wsServer.clients.forEach( function(client) {
    client.send( JSON.stringify(msg), function(err) {
      if (err) {
        console.log(err.toString());
      }
    });
  });
}

function setupRower() {
  rower = new wr.WaterRower({ port: comport });
  rower.on('readings', function(msg) {
    broadcastClients( {
      type: 'readings',
      data: msg
    })
  });
  rower.on('keypad', function(msg){
    type: 'keypad',
    data: msg
  });
}

wsServer.on('connection', function connection(sock) {
  var location = url.parse(sock.upgradeReq.url, true);

  sock.on('close', function _accounceDisconnect(){
    console.log("Socket disconnect.");
  });

  sock.on('message', function _socketMessage(msg){
    console.log("Socket sent message: ", msg.toString() );
    try {
      var parsedMsg = JSON.parse(msg);
      if (parsedMsg.msg === 'reset rower') {
        setupRower();
      }
    } catch (e) {
      console.log('Error handling message: ', e.toString());
    }
  });

  console.log("Socket connect.");
});

server.on('request', app);
server.listen(port, function () {
  console.log('Listening on ' + server.address().port)
});

process.on('SIGINT', function() {
  console.log("\nSIGINT (Ctrl+C)");
  if (rower) {
    rower.shutdown();
  }
});

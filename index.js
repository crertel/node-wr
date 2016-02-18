var server = require('http').createServer()
var wr = require('./water_rower.js')({ debug: false} );
var ws = require('ws');
var url = require('url')
var WebSocketServer = ws.Server
var wsServer = new WebSocketServer({ server: server });

var parseArgs = require('minimist');
var argv = parseArgs( process.argv , {
  number: [ 'port' ],
  string: [ 'comport' ],
  boolean: [ 'debug']
});

var port = argv.port || 'NULL';
var debug = argv.debug || false;
var comport = argv.comport;

var rower = new wr.WaterRower({ port: comport });

var express = require('express');
var app = express();
app.get('/', function(req, res) {
  res.status(200).send('Hello, world!');
});

wsServer.on('connection', function connection(sock) {
  var location = url.parse(ws.upgradeReq.url, true);
  var updateListener = function(msg) {
    sock.send( JSON.stringify(msg) );
  };

  rower.on('readings', updateListener);

  sock.on('disconnect', function() {
    rower.removeListener(updateListener);
    console.log("Socket disconnect.");
  });

  console.log("Socket connect.");
});


console.log('Starting water rower.');
server.on('request', app);
server.listen(port, function () {
  console.log('Listening on ' + server.address().port)
});

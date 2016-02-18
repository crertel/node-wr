var wr = require('./index.js')({ debug: false} );
var ws = require('ws');

var parseArgs = require('minimist');
var argv = parseArgs( process.argv , {
  number: [ 'port' ],
  string: [ 'compart' ],
  boolean: [ 'debug']
});

var portname = argv.port || 'NULL';
var debug = argv.debug || false;
var comport = argv.comport;

var rower = new wr.WaterRower({ port: comport });


var express = require('express');
var app = express();
app.get('/', function(req, res) {
  res.status(200).send('Hello, world!');
});

console.log('Starting water rower.');
app.listen( port, function () {
  console.log('Starting water rower server.');
});

module.exports = GoodApacheLog


var fs = require('fs')
var Path = require('path')
var debug = require('debug')('good:apache:log')
var Stream = require('stream')

var Hoek = require('hoek');
var Joi = require('joi');
var Squeeze = require('good-squeeze').Squeeze;

var LogFormat = require('./format.js')

var DEFAULTS = {format:'combined', separator:'\n', hup:true}
var SinkSchema = [Joi.string().required(), Joi.object().type(Stream.Stream).required()];
var OptionsSchema = Joi.alternatives().try(
  SinkSchema,
  Joi.object().keys({
    file  : SinkSchema,
    format: Joi.string(),
    separator: Joi.string(),
    hup: Joi.boolean()
  })
)


function GoodApacheLog (events, config) {
  if (!(this instanceof GoodApacheLog))
    return new GoodApacheLog(events, config)

  debug('Initialize log', {events:events, config:config})

  config = config || false
  Joi.assert(config, OptionsSchema, 'Invalid options');

  if (typeof config == 'string' || config instanceof Stream.Stream)
    config = { file: config }

  this._settings = Hoek.applyToDefaultsWithShallow(DEFAULTS, config, ['file'])
  debug('Settings: %j', this._settings)

  // Only process "response" events.
  if (!events.response)
    throw new Error('Invalid events; must configure "response" events, e.g. "response":"*"')

  this._streams = {
    squeeze: Squeeze({response:events.response}),
    formatter: LogFormat(null, this._settings)
  }
}

GoodApacheLog.prototype.init = function (stream, emitter, callback) {
  var self = this
  debug('Init')

  if (!self._settings.hup)
    debug('No listen to SIGHUP')
  else {
    debug('Listen to SIGHUP')
    self._onSigHUP = onSigHUP
    process.on('SIGHUP', onSigHUP)
    emitter.on('stop', function() {
      debug('Events stopped; remove onSigHUP listener')
      process.removeListener('SIGHUP', onSigHUP)
    })
  }

  function onSigHUP() {
    debug('Received SIGHUP')
    self._reopen()
  }

  self._streams.write = self._buildWriteStream()
  self._streams.read = stream
  self._pipeline()

  callback()
}

GoodApacheLog.prototype._buildWriteStream = function () {
  var self = this
  debug('buildWriteStream')

  if (self._settings.file instanceof Stream.Stream)
    return self._settings.file;

  var result = fs.createWriteStream(self._settings.file, {flags:'a', end:false, encoding:'utf8'})
  result.once('error', function (er) {
    console.error(er)
    self._teardown()
  })

  return result
}

GoodApacheLog.prototype._reopen = function() {
  debug('Re-open log file')
  this._teardown()
  this._streams.write = this._buildWriteStream()
  this._pipeline()
}

GoodApacheLog.prototype._pipeline = function() {
  this._streams.read
    .pipe(this._streams.squeeze)
    .pipe(this._streams.formatter)
    .pipe(this._streams.write)
}

GoodApacheLog.prototype._teardown = function() {
  this._streams.formatter.unpipe(this._streams.write)
  this._streams.squeeze.unpipe(this._streams.formatter)
  this._streams.read.unpipe(this._streams.squeeze)
}

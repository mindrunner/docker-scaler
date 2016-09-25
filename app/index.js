#!/usr/bin/node
'use strict';

const fs         = require('fs'),
    path         = require('path'),
    dockerScaler = require('./src/dockerscaler');

if (!fs.existsSync('./config/config.json')) {
  throw new Error("config/config.json does not exist.");
}

var config = require(process.env.CONFIG || './config/config.json');

var scaler = new dockerScaler.DockerScaler(config);

// Load plugins
var plugins = fs.readdirSync(path.resolve(__dirname, "plugins"));
for(var i in plugins) {
  var plugin = require("./plugins/" + plugins[i]);
  scaler.loadPlugin(plugin);
}

scaler.init();

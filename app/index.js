#!/usr/bin/node
'use strict';

const fs         = require('fs'),
    dockerScaler = require('./src/dockerscaler');

if (!fs.existsSync('./config/config.json')) {
  throw new Error("config/config.json does not exist.");
}

var config = require('./config/config.json');

new dockerScaler.DockerScaler(config);

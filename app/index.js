#!/usr/bin/env node
'use strict';

const fs = require('fs'),
    path = require('path'),
    dockerScaler = require('./src/dockerscaler');

if (!fs.existsSync('./config/config.json')) {
    throw new Error("config/config.json does not exist.");
}

const config = require(process.env.CONFIG || './config/config.json');

const scaler = new dockerScaler.DockerScaler(config);

scaler.init();

// Load plugins
const plugins = fs.readdirSync(path.resolve(__dirname, "plugins"));
for (const i in plugins) {
    const plugin = require("./plugins/" + plugins[i]);
    scaler.loadPlugin(plugin);
}

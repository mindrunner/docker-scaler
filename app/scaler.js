#!/usr/bin/env node

const fs = require('fs'),
    DockerScaler = require('./src/docker-scaler');

if (!fs.existsSync('./config/config.json')) {
    throw new Error("config/config.json does not exist.");
}
const config = require(process.env.CONFIG || './config/config.json');
new DockerScaler(config).init();


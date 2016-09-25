'use strict';

const fs = require('fs'),
    async = require('asyncawait/async'),
    await = require('asyncawait/await'),
    network = require('network'),
    portscanner = require('portscanner');

module.exports = async(function (scaler) {
    console.log("Loading assign random port plugin...");

    scaler.hooks.beforeCreate.push(function(args, config) {
        var container = args[1],
            containerConfig = args[2];

        if(container.randomPorts != undefined && Array.isArray(container.randomPorts)) {
            for(var i in container.randomPorts) {
                var extPort = await(getRandomOpenPort(config.minPort, config.maxPort));
                var port = container.randomPorts[i] + "/tcp";
                containerConfig.PortBindings[port] = [{
                  HostIp: "0.0.0.0",
                  HostPort: extPort.toString()
                }];

                containerConfig.Env.push("RANDOM_PORT" + i + "=" + extPort);
            }
        }
    });
});

function getRandomOpenPort(minPort, maxPort) {
    return new Promise(function (resolve, reject) {
      var host = "127.0.0.1";

      if(fs.existsSync('/.dockerenv')) {
          network.get_gateway_ip(function(err, ip) {
              if(err) {
                  throw new Error("Couldn't get gateway ip: " + err);
              }
              portscanner.findAPortNotInUse(minPort, maxPort, host, callback);
          });
      } else {
          portscanner.findAPortNotInUse(minPort, maxPort, host, callback);
      }

      function callback(err, port) {
          if(err) {
              return reject(err);
          }

          resolve(port);
      }
    });
}

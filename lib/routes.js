'use strict';

var packJSON = require('../package.json'),
    Hoek = require('hoek-boom');

exports.register = function (server, options, next) {

    server.route({
        method: 'GET',
        path: '/',
        handler: function (req, reply) {
            var result = {};

            result.packageName = packJSON.name;
            result.versions = Hoek.applyToDefaults(process.versions, {
                app: packJSON.version
            });

            result = Hoek.applyToDefaults(result, req.server.app.state.identifyMe());

            reply(result);
        }
    });

    server.route({
        method: 'GET',
        path: '/nodes',
        handler: function (req, reply) {
            var time = Date.now(),
                result = req.server.app.state.getNodeList().map(function (node) {
                return {
                    name: node.nodeName,
                    hostname: node.nodeHostname,
                    port: node.nodePort << 0,
                    master: node.isMaster,
                    uptime: (time - node.startUpDate) / 1000,
                    serverId: node.serverId,
                    priority: node.priority
                }
            });

            reply(result);
        }
    });

    next();
};

exports.register.attributes = {
    name: packJSON.name + '-api-routes',
    version: packJSON.version
};
'use strict';

var packJSON = require('../package.json'),
    Hoek = require('hoek-boom'),
    BPromise = require('bluebird');

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
                    };
                });

            reply(result);
        }
    });

    server.route({
        method: 'GET',
        path: '/node/demote',
        handler: function (req, reply) {
            var app = req.server.app,
                response = {demoted: true, wasMaster: false};

            response.wasMaster = app.state.demote();

            if (!response.wasMaster) {
                return reply(response);
            }

            app.beginElection().then(function () {
                var ok;

                if (!app.state.isMaster && response.wasMaster) {
                    ok = BPromise.each(app.state.cluster, function (client) {
                        return client.emitPromise('notify-master-demoted', app.state.nodeName);
                    });
                } else {
                    // return reply(response);
                    ok = BPromise.resolve();
                }

                return ok.then(function () {
                    reply(response);
                });
            }).catch(reply);
        }
    });

    server.route({
        method: 'GET',
        path: '/node/promote',
        handler: function (req, reply) {
            var app = req.server.app,
                response = {promoted: true, wasMaster: false},
                ok = BPromise.resolve();

            response.wasMaster = app.state.promote();

            if (response.wasMaster) {
                return reply(response);
            }

            ok = ok.then(function () {
                var clients = app.state.getMasterClient();

                if (clients.length < 1) {
                    return;
                }

                return BPromise.each(clients, function (client) {
                    return client.emitPromise('master-demote', app.state.nodeName);
                });
            });

            ok.then(function () {
                return app.beginElection().then(function () {
                    var ok;

                    if (app.state.isMaster && !response.wasMaster) {
                        ok = BPromise.each(app.state.cluster, function (client) {
                            return client.emitPromise('notify-master-promoted', app.state.nodeName);
                        });
                    } else {
                        // we could just reply here
                        // return reply(response)
                        ok = BPromise.resolve();
                    }

                    return ok.then(function () {
                        reply(response);
                    });
                });
            }).catch(reply);
        }
    });

    server.route({
        method: 'GET',
        path: '/agents',
        handler: function (req, reply) {
            reply(req.server.app.state.agents);
        }
    });

    server.route({
        method: 'GET',
        path: '/agents/{id}',
        handler: function (req, reply) {
            reply(req.server.app.state.agents[req.params.id]);
        }
    });

    server.route({
        method: 'GET',
        path: '/jobs',
        handler: function (req, reply) {
            reply(req.server.app.state.jobs);
        }
    });

    server.route({
        method: 'GET',
        path: '/jobs/{name}',
        handler: function (req, reply) {
            reply(req.server.app.state.jobs[req.params.name]);
        }
    });

    server.route({
        method: 'GET',
        path: '/locks',
        handler: function (req, reply) {
            reply(req.server.app.state.shared);
        }
    });

    next();
};

exports.register.attributes = {
    name: packJSON.name + '-api-routes',
    version: packJSON.version
};

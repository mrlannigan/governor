'use strict';

var Bunyan = require('bunyan'),
    BPromise = require('bluebird'),
    Application = require('../lib/application'),
    socketClient = require('socket.io-client'),
    log = require('../lib/log');


exports.agentConnect = function () {
    //todo: make this port configurable
    var agenturl = 'http://localhost:8080/agent',
        agentconnection = socketClient(agenturl, {autoConnect: false});

    agentconnection.open();

    // promisify the emit... always requires an ack
    agentconnection.emitPromise = function () {
        var args = [],
            argsLength = arguments.length << 0,
            i = 0;

        for (; i < argsLength; i++) {
            args[i] = arguments[i];
        }

        return new BPromise(function (resolve) {
            args.push(function (data) {
                resolve(data);
            });
            agentconnection.emit.apply(agentconnection, args);
        });
    };

    return agentconnection;
};

var createServer = exports.createServer = function (args) {

    var logger = Bunyan.createLogger({
            name: 'governor',
            streams: [{
                stream: process.stdout,
                level: Bunyan.ERROR
            }],
            serializers: log.serializers
        }),
        startupLogger = logger.child({startup: true});


    var app = new Application();
    app.setArguments(args)
        .setLogger(logger, startupLogger)
        .setNodeName(args.n);

    return app.listen().then(function () {
        logger.info('application listening');

        return BPromise.resolve()
            .delay(500)
            .then(function () {
                app.beginElection();
            })
            .catch(BPromise.CancellationError, function () {
                logger.err('already found elected master');
            })
            .then(function () {
                return app;
            });

    }).catch(function (err) {
        startupLogger.info({err: err}, 'application failed to listen');
    });
};

/**
 * add port
 * @param count
 * @returns {*}
 */
exports.createServers = function (count) {
    var portindex = 0,
        nameindex = 0,
        proms = [],
        nodes = [],
        priority = count;

    while (portindex < count) {
        nodes.push('localhost:808' + portindex++);
    }

    while (nameindex < count) {

        proms.push(createServer({
            priority: priority--,
            nodeHostname: '127.0.0.1',
            // make this port configurable
            port: 8080 + nameindex,
            n: 'testhost' + nameindex++,
            nodes: nodes
        }));
    }

    return BPromise.all(proms);
};
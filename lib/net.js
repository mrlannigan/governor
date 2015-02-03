'use strict';

var os = require('os'),
    SocketServer = require('socket.io'),
    socketClient = require('socket.io-client'),
    util = require('util'),
    Hapi = require('hapi'),
    Hoek = require('hoek-boom'),
    BPromise = require('bluebird'),
    Emitter = require('events').EventEmitter,
    AgentController = require('./agentController'),
    GovernorController = require('./governorController');

function Net() {
    this.NAMESPACE_GOVERNOR = '/governor';
    this.NAMESPACE_AGENT = '/agent';
    this.identificationKeys = ['priority', 'uptime', 'nodeName', 'nodeHostname', 'nodePort', 'isMaster', 'serverId', 'startUpDate'];
}

util.inherits(Net, Emitter);

Net.prototype.getNetworkAddress = function () {
    var nets = os.networkInterfaces(),
        result = '127.0.0.1';

    Object.keys(nets).some(function (netInterface) {
        var candidate;

        netInterface = nets[netInterface];

        candidate = netInterface.filter(function (item) {
            return item.family === 'IPv4' && !item.internal;
        }).shift();

        if (candidate) {
            result = candidate.address;
            return true;
        }
    });

    return result;
};

Net.prototype.createServer = function CreateServer(port, options, logger) {
    var defaults = {serveClient: true},
        config = Hoek.applyToDefaults(defaults, options),
        server,
        io,
        self = this;

    server = new Hapi.Server();
    server.connection({
        host: '0.0.0.0',
        port: port
    });
    io = new SocketServer(server.listener, config);

    function promisifySocket(socket) {
        socket.onPromise = function (eventname, fn) {
            socket.on(eventname, function () {
                var args = [],
                    argsLength = arguments.length << 0,
                    i = 0,
                    callback;

                for (; i < argsLength; i++) {
                    args[i] = arguments[i];
                }

                callback = args.pop();

                function finished(resp) {
                    var err;
                    if (resp instanceof Error) {
                        err = {
                            message: resp.message,
                            isError: true
                        };
                        return callback(err);
                    }
                    callback(resp);
                }

                fn.apply(socket, args).done(finished, finished);
            });
        };
    }

    // bind events on Governor Namespace
    io.of(this.NAMESPACE_GOVERNOR).on('connection', function (socket) {
        promisifySocket(socket);

        var governorController = new GovernorController(logger, server);
        governorController.initialize(socket, self.identificationKeys);
    });

    // bind events on Agent Namespace
    io.of(this.NAMESPACE_AGENT).on('connection', function (socket) {
        promisifySocket(socket);

        var agentController = new AgentController(logger, server);
        agentController.initialize(socket);
    });

    server.register = BPromise.promisify(server.register);

    server.route({
        method: 'GET',
        path: '/',
        handler: function (req, reply) {
            reply().redirect('/api');
        }
    });

    return server.register(require('./routes'), {
        routes: {
            prefix: '/api'
        }
    }).then(function () {
        return server;
    });
};

Net.prototype.createConnection = function CreateConnection(node, options, logger, state) {
    var defaults = {autoConnect: false},
        config = Hoek.applyToDefaults(defaults, options),
        connection,
        url,
        self = this;

    url = 'http://' + node + this.NAMESPACE_GOVERNOR;

    connection = socketClient(url, config);

    connection.on('connect', function () {
        logger.info({event: 'connect'}, 'node connected');
    });

    connection.on('connect_error', function (err) {
        logger.info({event: 'connect_error', err: err}, 'node connection error');
    });

    connection.on('error', function (err) {
        logger.info({event: 'error', err: err}, 'node error');
    });

    connection.on('reconnect', function () {
        logger.info({event: 'reconnect'}, 'node reconnection success');

        connection.identify(state.identifyMe());
    });

    connection.open();

    // promisify the emit... always requires an ack
    connection.emitPromise = function () {
        var args = [],
            argsLength = arguments.length << 0,
            i = 0;

        for (; i < argsLength; i++) {
            args[i] = arguments[i];
        }

        return new BPromise(function (resolve, reject) {
            args.push(function (data) {
                var err;
                if (data && data.isError) {
                    err = new Error(data.message);
                    return reject(err);
                }
                resolve(data);
            });
            connection.emit.apply(connection, args);
        });
    };

    // exchange identifications
    connection.identify = function (identification) {
        return connection.emitPromise('identify', identification).then(function (data) {
            if (!data) {
                return BPromise.reject(new Error('Missing data'));
            }

            if (!data.hasOwnProperty('nodeName')) {
                return BPromise.reject(new Error('Invalid data payload'));
            }


            self.identificationKeys.forEach(function (key) {
                if (data.hasOwnProperty(key)) {
                    connection[key] = data[key];
                }
            });

            connection.identification = data;

            return connection;
        });
    };

    return BPromise.resolve(connection);
};

module.exports = Net;

'use strict';

var util = require('util'),
    crypto = require('crypto'),
    dns = require('dns'),
    url = require('url'),
    Emitter = require('events').EventEmitter,
    State = require('./state'),
    Net = require('./net'),
    BPromise = require('bluebird'),
    dnsLookup = BPromise.promisify(dns.lookup);

function Application() {
    this.log = null;
    this.args = null;

    this.state = new State();
    this.net = new Net();

    this.id = crypto.randomBytes(6).toString('base64').slice(0, 9)
        .replace(/\+/g, '0')
        .replace(/\//g, '0');
    this.state.serverId = this.id;

    this.ipAddress = this.net.getNetworkAddress();
}

util.inherits(Application, Emitter);

Application.prototype.setLogger = function (logger, startupLogger) {
    this.log = logger;
    this.startupLog = startupLogger || logger;

    return this;
};

Application.prototype.setArguments = function (args) {
    this.args = args;

    this.state.priority = args.priority;
    this.state.nodeHostname = this.state.nodeHostname || this.ipAddress;
    this.state.nodePort = args.port;

    return this;
};

Application.prototype.setNodeName = function (name) {
    if (!this.state) {
        throw new Error('State not yet constructed in Application');
    }

    this.state.setNodeName(name);

    return this;
};

Application.prototype.listen = function () {
    var self = this,
        ok = BPromise.resolve();

    ok = ok.then(function () {
        return self.net.createServer(self.args.port, {}, self.log.child({})).then(function (server) {
            server.app = self;

            server.start = BPromise.promisify(server.start);
            self.state.server = server;
        });
    });

    ok = ok.then(function () {
        return self.state.server.start();
    });

    ok = ok.delay(100);

    ok = ok.then(function () {
        return BPromise.each(self.args.nodes, function (node) {
            var urlParse = url.parse('http://' + node),
                hostname = urlParse.hostname,
                port = Number(urlParse.port);

            return dnsLookup(hostname, 4).spread(function (ipAddress) {
                if ((ipAddress === '127.0.0.1' || ipAddress === self.ipAddress) && port === self.args.port) {
                    // same machine and port... don't connect
                    self.state.nodeHostname = hostname;
                    self.state.nodePort = port;
                    return;
                }

                return self.net.createConnection(node, {}, self.log.child({node: node}), self.state).then(function (connection) {
                    self.state.cluster.push(connection);
                });
            });
        });
    });

    return ok;
};

Application.prototype.close = function () {
    var self = this,
        ok = BPromise.resolve();

    ok = ok.then(function () {
        return BPromise.resolve(self.state.cluster).each(function (socket) {
            socket.close();
        });
    });

    ok = ok.then(function () {
        // could promisify this...
        self.state.server.stop();
    }).delay(500);

    return ok;
};

Application.prototype.beginElection = function () {
    var self = this,
        ok,
        identifyCluster,
        logger = self.log.child({election: true}),
        identification = self.state.identifyMe();

    identifyCluster = self.state.cluster.map(function (client) {
        if (client.io.readyState === 'closed') {
            return false;
        }
        return client.identify(identification).tap(function (client) {
            logger.debug({client: client}, 'identified');
        });
    }).filter(function (client) {
        return client;
    });

    // execute identify of all connected governors
    ok = BPromise.all(identifyCluster)
        .cancellable()
        .tap(function (clients) {
            logger.debug({identified: clients.length}, 'done identifying');
        });

    // double check and make sure someone isn't already master
    ok = ok.then(function (clients) {
        var currentMaster = clients.reduce(function (prev, client) {
            return prev + (client.isMaster ? client.nodeName : '');
        }, '');

        if (currentMaster !== '') {
            self.state.currentMaster = currentMaster;
            logger.debug({currentMaster: currentMaster}, 'identified existing master');
            ok.cancel('identified existing master');
        }

        return clients;
    });

    // append current processes identification to list for sorting
    ok = ok.then(function (clients) {
        clients.push(identification);

        return clients;
    });

    // sort identifications (first in list is master)
    ok = ok.then(function (clients) {
        return self.state.sortClusterList(clients);
    });

    // log the client order
    ok = ok.tap(function (clients) {
        logger.info({
            names: clients.map(function (client) {
                return client.nodeName;
            })
        }, 'sorted clients');
    });

    // handle master selection
    ok = ok
        .get(0) // get the first one (aka the master)
        .then(function (client) {
            // check if itself is master
            if (client.nodeName !== identification.nodeName) {
                // not master, so defer and do nothing additional
                logger.info({client: client}, 'identified to not be the master');
                return client;
            }

            logger.info({client: client}, 'identified to be the master, notify everyone');
            self.state.isMaster = true;

            var broadcast = self.state.cluster.map(function (client) {
                return client.emitPromise('elected', identification.nodeName).tap(function () {
                    logger.debug({client: client}, 'notified of new master');
                });
            });

            return BPromise.all(broadcast).tap(function () {
                logger.debug('notified all governors of new master');
            });
        });

    return ok;
};

module.exports = Application;

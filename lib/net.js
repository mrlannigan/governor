'use strict';

var os = require('os'),
    SocketServer = require('socket.io'),
    SocketClient = require('socket.io-client'),
    util = require('util'),
    Hapi = require('hapi'),
    Hoek = require('hoek-boom'),
    BPromise = require('bluebird'),
    Emitter = require('events').EventEmitter;

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

    // Governor Namespace
    io.of(this.NAMESPACE_GOVERNOR).on('connection', function (socket) {
        var socketLogger = logger.child({socket: socket, type: 'governor'});
        socketLogger.info('connection made');

        socket.on('identify', function (data, callback) {
            if (data) {
                self.identificationKeys.forEach(function (key) {
                    if (data.hasOwnProperty(key)) {
                        socket[key] = data[key];
                    }
                });

                socket.identification = data;
                socketLogger = logger.child({socket: socket});
            }

            callback(server.app.state.identifyMe());
        });

        socket.on('elected', function (nodeName, callback) {
            socketLogger.info({nodeName: nodeName}, 'identified new master');
            server.app.state.currentMaster = nodeName;

            if (server.app.state.nodeName != nodeName) {
                server.app.state.cluster = server.app.state.cluster.map(function (client) {
                    client.isMaster = client.nodeName == nodeName;

                    return client;
                });
            }

            callback();
        });

        socket.on('master-demote', function (requestingNode, callback) {

            if (!server.app.state.isMaster) {
                // ignore event
                return;
            }

            socketLogger.info({requestingNode: requestingNode}, 'demoting myself');
            server.app.state.demote();
            callback && callback();
        });

        socket.on('notify-master-demoted', function (masterName, callback) {
            socketLogger.info({demoted: masterName}, 'master demoted');
            server.app.state.currentMaster = null;

            server.app.beginElection().done(function () {
                callback();
            }, function (err) {
                socketLogger.error({err: err}, 'error during election');
                callback();
            });
        });

        socket.on('notify-master-promoted', function (masterName, callback) {
            socketLogger.info({promoted: masterName}, 'master promoted');
            server.app.state.currentMaster = null;

            server.app.beginElection().done(function () {
                callback();
            }, function (err) {
                socketLogger.error({err: err}, 'error during election');
                callback();
            });
        });

        socket.on('disconnect', function () {
            socketLogger.info({
                node: socket.nodeName,
                currentMaster: server.app.state.currentMaster,
                newElection: socket.nodeName == server.app.state.currentMaster
            }, 'disconnected');

            if (socket.nodeName == server.app.state.currentMaster) {
                server.app.state.currentMaster = null;
                server.app.state.cluster = server.app.state.cluster.map(function (client) {
                    client.isMaster = false;

                    return client;
                });

                setTimeout(function () {
                    socketLogger.info('beginning new election');
                    server.app.beginElection();
                }, 1000);
            }
        });

        // place locks in state then check version number, if bad, send send-shared-state to master gov
        socket.on('cluster-place-locks', function (lockData, date, newVersion, callback) {
            var status = server.app.state.handleLocks(lockData, date);

            if (status.version !== newVersion) {
                server.app.state.getMasterClient().emitPromise('send-shared-state')
                    .then(function (sharedState) {
                        server.app.state.shared = sharedState;
                    });
            }
            callback();
        });

        // slave governor asking master for state
        socket.on('send-shared-state', function (callback) {
            // todo: log this, so we can see how often we are out of sync!
            callback(server.app.state.shared);
        });

        socket.on('cluster-identify-agent', function (agentname, callback) {
            socketLogger.info(agentname, 'agent identified');
            var agents = server.app.state.agents;
            if (!agents[agentname]) {
                agents[agentname] = {
                    jobs: {},
                    active_jobs: []
                };
            }
            callback();
        });

        socket.on('cluster-register-job', function (jobname, callback) {
            var jobs = server.app.state.jobs;

            callback = callback || function () {
            };

            if (!jobs[jobname]) {
                jobs[jobname] = {
                    active_jobs: []
                };
            }
            callback();
        });

    });

    // Agent Namespace
    io.of(this.NAMESPACE_AGENT).on('connection', function (socket) {

        var socketLogger = logger.child({socket: socket, type: 'agent'});
        socketLogger.info('agent connection made');

        socket.on('identify', function (agentname, callback) {
            socketLogger.info(agentname, 'agent identified');
            var agents = server.app.state.agents;
            if (!agents[agentname]) {
                agents[agentname] = {
                    jobs: {},
                    active_jobs: []
                };
                server.app.state.clusterEmit('cluster-identify-agent', agentname);
            }
            callback();
        });

        // ToDo: will agents be sending this explicitly, or is this just what happens when the socket is broken?
        socket.on('disconnect', function () {
            // hrm how do we know which one disconnected?
            // we could ping all of the agents and clear out the ones that don't respond?
        });

        // this is called when an agent gets a new job.  it verifies that it is allowed to work on it
        // and sets locks if required
        //ToDo: propagate the state change to the other governors
        socket.on('handle-locks', function (lockData, date, callback) {
            if (typeof date === 'function') {
                callback = date;
                date = Date.now();
            }
            var status = server.app.state.handleLocks(lockData, date);

            server.app.state.clusterEmit('cluster-place-locks', lockData, date, status.version);

            callback(status);
        });

        //ToDo: organize these jobs by agent
        socket.on('register-job', function (jobname, agentname, callback) {
            var jobs = server.app.state.jobs,
                agents = server.app.state.agents,
                agent = agents[agentname];

            if (!jobs[jobname]) {
                jobs[jobname] = {
                    active_jobs: [],
                    stats: {
                        count: 0,
                        avg_response_time: 0
                    }
                };
            }
            if (!agent) {
                agent = agents[agentname] = {
                    jobs: {},
                    active_jobs: []
                };


            }
            if (!agent.jobs[jobname]) {
                agent.jobs[jobname] = {
                    completed: 0,
                    avg_duration: 0,
                    active_jobs: []
                };
            }

            server.app.state.clusterEmit('cluster-register-job', jobname);

            callback();
        });

        socket.on('job-start', function (jobname, agentname, callback) {
            var jobs = server.app.state.jobs,
                agents = server.app.state.agents,
                job = {name: jobname, start: Date.now()},
                agent = agents[agentname];


            if (!agents) {
                // agent isn't registered yet
                return socket.emitPromise('identify', agentname)
                    .then(function () {
                        socket.emit('job-start', jobname, agentname, callback);
                    });
            }

            if (!jobs[jobname]) {
                // this job isn't registered yet
                return socket.emitPromise('register-job', jobname, agentname)
                    .then(function () {
                        socket.emit('job-start', jobname, agentname, callback);
                    });
            }


            // put job into active state
            jobs[jobname].active_jobs.push(job);
            // we probably don't need the job in both places, guess we will see
            agent.jobs[jobname].active_jobs.push(job);
            agent.active_jobs.push(job);
            callback();
        });
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

    connection = SocketClient(url, config);

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

        return new BPromise(function (resolve) {
            args.push(function (data) {
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

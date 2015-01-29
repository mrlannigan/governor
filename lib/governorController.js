'use strict';


var baseController = require('./baseController'),
    governorController = Object.create(baseController),
    BPromise = require('bluebird');

module.exports = governorController;

governorController.initialize = function (logger, socket, server, identificationkeys) {
    var socketLogger = logger.child({socket: socket, type: 'governor'}),
        self = this;


    this.init(logger, server);

    socketLogger.info('connection made');

    socket.on('identify', function (data, callback) {
        if (data) {
            identificationkeys.forEach(function (key) {
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

        if (server.app.state.nodeName !== nodeName) {
            server.app.state.cluster = server.app.state.cluster.map(function (client) {
                client.isMaster = client.nodeName === nodeName;

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
        if (callback) {
            callback();
        }
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
            newElection: socket.nodeName === server.app.state.currentMaster
        }, 'disconnected');

        if (socket.nodeName === server.app.state.currentMaster) {
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
    socket.onPromise('cluster-place-locks', function (lockData, date, agentname, newVersion) {
        return BPromise.try(function () {
            var status = server.app.state.handleLocks(lockData, date, agentname);


            if (status.version !== newVersion) {
                return syncSharedState();
            }
        });
    });

    socket.onPromise('cluster-start-job', function (job) {
        return BPromise.resolve(self.startJob(job.agent, job.name, job.start, job.id));
    });

    socket.onPromise('cluster-end-job', function (id, date, lockData, newVersion) {
        return BPromise.try(function () {

            var status;

            self.endJob(id, date);
            status = server.app.state.removeLocks(lockData);

            if (status.version !== newVersion) {
                return syncSharedState();
            }
        });
    });

    // slave governor asking master for state
    socket.on('send-shared-state', function (callback) {
        // todo: log this, so we can see how often we are out of sync!
        callback(server.app.state.shared);
    });

    socket.on('cluster-identify-agent', function (agentname, callback) {
        socketLogger.info(agentname, 'agent identified');
        self.registerAgent(agentname);
        callback();
    });

    socket.on('cluster-register-job', function (agentname, jobname, callback) {
        self.registerJob(jobname);
        self.registerAgentJob(agentname, jobname);
        callback();
    });

    socket.onPromise('cluster-clear-agent-locks', function (agentname, newVersion) {
        return BPromise.try(function () {
            var status = server.app.state.clearAgentLocks(agentname);

            if (status.version !== newVersion) {
                return syncSharedState();
            }
        });
    });

    function syncSharedState() {
        return server.app.state.getMasterClient().emitPromise('send-shared-state')
            .then(function (sharedState) {
                server.app.state.shared = sharedState;
            });
    }

};
